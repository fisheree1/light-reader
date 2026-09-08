use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};

const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:11434";
const LOCALHOST_ENDPOINT: &str = "http://localhost:11434";

pub struct OllamaState {
    client: Client,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl OllamaState {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build the local Ollama HTTP client"),
            cancellations: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    available: bool,
    models: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCommandError {
    code: &'static str,
    message: &'static str,
}

impl AiCommandError {
    fn provider_unavailable() -> Self {
        Self {
            code: "AI_PROVIDER_UNAVAILABLE",
            message: "Unable to connect to the local Ollama service.",
        }
    }

    fn request_failed() -> Self {
        Self {
            code: "AI_REQUEST_FAILED",
            message: "The local model request failed.",
        }
    }

    fn invalid_endpoint() -> Self {
        Self {
            code: "AI_PROVIDER_UNAVAILABLE",
            message: "Only the local Ollama endpoint is allowed.",
        }
    }

    fn timeout() -> Self {
        Self {
            code: "AI_REQUEST_TIMEOUT",
            message: "The local model request timed out.",
        }
    }
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatRequest {
    schema_version: u8,
    run_id: String,
    endpoint: String,
    model: String,
    system_prompt: String,
    prompt: String,
    max_output_chars: usize,
}

#[derive(Debug, Deserialize)]
struct OllamaChatChunk {
    #[serde(default)]
    done: bool,
    #[serde(default)]
    message: Option<OllamaMessage>,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    #[serde(default)]
    content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AiStreamEvent {
    OutputDelta {
        delta: String,
    },
    Usage {
        #[serde(rename = "inputTokens")]
        input_tokens: Option<u64>,
        #[serde(rename = "outputTokens")]
        output_tokens: Option<u64>,
    },
    Completed,
}

#[tauri::command]
pub async fn ai_ollama_status(
    endpoint: String,
    state: State<'_, OllamaState>,
) -> Result<OllamaStatus, AiCommandError> {
    let base = validate_endpoint(&endpoint)?;
    let response = state
        .client
        .get(
            base.join("api/tags")
                .map_err(|_| AiCommandError::invalid_endpoint())?,
        )
        .send()
        .await
        .map_err(map_request_error)?;
    if !response.status().is_success() {
        return Err(AiCommandError::provider_unavailable());
    }
    let tags = response
        .json::<OllamaTagsResponse>()
        .await
        .map_err(|_| AiCommandError::provider_unavailable())?;
    Ok(OllamaStatus {
        available: true,
        models: tags.models.into_iter().map(|model| model.name).collect(),
    })
}

#[tauri::command]
pub async fn ai_ollama_chat(
    request: OllamaChatRequest,
    on_event: Channel<AiStreamEvent>,
    state: State<'_, OllamaState>,
) -> Result<(), AiCommandError> {
    validate_chat_request(&request)?;
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .map_err(|_| AiCommandError::request_failed())?
        .insert(request.run_id.clone(), Arc::clone(&cancellation));

    let result = run_chat(&state.client, request, on_event, Arc::clone(&cancellation)).await;
    state
        .cancellations
        .lock()
        .map_err(|_| AiCommandError::request_failed())?
        .retain(|_, value| !Arc::ptr_eq(value, &cancellation));
    result
}

#[tauri::command]
pub fn ai_cancel_ollama_run(
    run_id: String,
    state: State<'_, OllamaState>,
) -> Result<(), AiCommandError> {
    let cancellations = state
        .cancellations
        .lock()
        .map_err(|_| AiCommandError::request_failed())?;
    if let Some(cancellation) = cancellations.get(&run_id) {
        cancellation.store(true, Ordering::Release);
    }
    Ok(())
}

async fn run_chat(
    client: &Client,
    request: OllamaChatRequest,
    on_event: Channel<AiStreamEvent>,
    cancellation: Arc<AtomicBool>,
) -> Result<(), AiCommandError> {
    let base = validate_endpoint(&request.endpoint)?;
    let max_tokens = (request.max_output_chars / 2).clamp(128, 4_096);
    let response = client
        .post(
            base.join("api/chat")
                .map_err(|_| AiCommandError::invalid_endpoint())?,
        )
        .json(&serde_json::json!({
            "model": request.model,
            "messages": [
                { "role": "system", "content": request.system_prompt },
                { "role": "user", "content": request.prompt }
            ],
            "stream": true,
            "think": false,
            "options": { "num_predict": max_tokens }
        }))
        .send()
        .await
        .map_err(map_request_error)?;

    if response.status().as_u16() == 404 {
        return Err(AiCommandError {
            code: "AI_MODEL_NOT_FOUND",
            message: "The selected Ollama model is not installed.",
        });
    }
    if !response.status().is_success() {
        return Err(AiCommandError::request_failed());
    }

    let mut stream = response.bytes_stream();
    let mut pending = Vec::<u8>::new();
    let mut emitted_chars = 0usize;

    while let Some(chunk) = stream.next().await {
        if cancellation.load(Ordering::Acquire) {
            return Ok(());
        }
        pending.extend_from_slice(&chunk.map_err(map_request_error)?);
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let line = pending.drain(..=newline).collect::<Vec<_>>();
            process_chat_line(
                &line[..line.len().saturating_sub(1)],
                request.max_output_chars,
                &mut emitted_chars,
                &on_event,
            )?;
        }
    }
    if !pending.is_empty() {
        process_chat_line(
            &pending,
            request.max_output_chars,
            &mut emitted_chars,
            &on_event,
        )?;
    }
    Ok(())
}

fn process_chat_line(
    line: &[u8],
    max_output_chars: usize,
    emitted_chars: &mut usize,
    on_event: &Channel<AiStreamEvent>,
) -> Result<(), AiCommandError> {
    if line.iter().all(u8::is_ascii_whitespace) {
        return Ok(());
    }
    let chunk = serde_json::from_slice::<OllamaChatChunk>(line)
        .map_err(|_| AiCommandError::request_failed())?;
    if let Some(message) = chunk.message {
        if !message.content.is_empty() {
            *emitted_chars += message.content.chars().count();
            if *emitted_chars > max_output_chars {
                return Err(AiCommandError::request_failed());
            }
            on_event
                .send(AiStreamEvent::OutputDelta {
                    delta: message.content,
                })
                .map_err(|_| AiCommandError::request_failed())?;
        }
    }
    if chunk.done {
        on_event
            .send(AiStreamEvent::Usage {
                input_tokens: chunk.prompt_eval_count,
                output_tokens: chunk.eval_count,
            })
            .map_err(|_| AiCommandError::request_failed())?;
        on_event
            .send(AiStreamEvent::Completed)
            .map_err(|_| AiCommandError::request_failed())?;
    }
    Ok(())
}

fn validate_chat_request(request: &OllamaChatRequest) -> Result<(), AiCommandError> {
    validate_endpoint(&request.endpoint)?;
    if request.schema_version != 1
        || request.run_id.is_empty()
        || request.run_id.len() > 128
        || request.model.trim().is_empty()
        || request.model.len() > 200
        || request.system_prompt.is_empty()
        || request.system_prompt.len() > 4_000
        || request.prompt.is_empty()
        || request.prompt.chars().count() > 16_000
        || request.max_output_chars == 0
        || request.max_output_chars > 8_000
    {
        return Err(AiCommandError::request_failed());
    }
    Ok(())
}

fn validate_endpoint(value: &str) -> Result<Url, AiCommandError> {
    if value != DEFAULT_ENDPOINT && value != LOCALHOST_ENDPOINT {
        return Err(AiCommandError::invalid_endpoint());
    }
    let mut endpoint = Url::parse(value).map_err(|_| AiCommandError::invalid_endpoint())?;
    endpoint.set_path("/");
    Ok(endpoint)
}

fn map_request_error(error: reqwest::Error) -> AiCommandError {
    if error.is_timeout() {
        AiCommandError::timeout()
    } else {
        AiCommandError::provider_unavailable()
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_endpoint, OllamaChatRequest};

    #[test]
    fn accepts_only_the_fixed_local_ollama_endpoints() {
        assert!(validate_endpoint("http://127.0.0.1:11434").is_ok());
        assert!(validate_endpoint("http://localhost:11434").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:11435").is_err());
        assert!(validate_endpoint("https://example.com").is_err());
        assert!(validate_endpoint("http://localhost:11434/other").is_err());
    }

    #[test]
    fn rejects_unbounded_chat_requests() {
        let request = OllamaChatRequest {
            schema_version: 1,
            run_id: "run-1".into(),
            endpoint: "http://127.0.0.1:11434".into(),
            model: "deepseek-r1:8b".into(),
            system_prompt: "policy".into(),
            prompt: "text".into(),
            max_output_chars: 8_001,
        };
        assert!(super::validate_chat_request(&request).is_err());
    }
}
