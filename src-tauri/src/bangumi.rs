//! Native requests to the Bangumi (bgm.tv) public API: book subject search and
//! subject details, used to find a light novel's Chinese titles, aliases and
//! official Chinese editions. Only two fixed endpoints on api.bgm.tv are
//! reachable. The API sends no CORS headers, so the Web build cannot use it.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use futures_util::{
    future::{AbortHandle, Abortable},
    StreamExt,
};
use reqwest::{redirect::Policy, Client, Url};
use serde::Serialize;
use serde_json::json;
use tauri::{State, WebviewWindow};

const API: &str = "https://api.bgm.tv";
const MAX_BODY: usize = 2 * 1024 * 1024;
const REQUEST_GAP: Duration = Duration::from_secs(1);
// Bangumi asks clients to identify themselves this way.
const USER_AGENT: &str = "fisheree1/LightReader/0.1 (https://github.com/fisheree1/light-reader)";

#[derive(Serialize)]
pub struct BangumiResponse {
    text: String,
}

#[derive(Default)]
pub struct BangumiState {
    active: Mutex<Option<(String, AbortHandle)>>,
    last_finished: tokio::sync::Mutex<Option<Instant>>,
}

impl BangumiState {
    pub fn new() -> Self {
        Self::default()
    }
}

enum Request {
    /// Book subjects (type 1) matching a keyword.
    Search(String),
    /// One subject's details, by numeric id.
    Subject(u64),
}

fn validate_keyword(keyword: &str) -> Result<String, &'static str> {
    let keyword = keyword.trim();
    if keyword.is_empty() || keyword.chars().count() > 100 {
        return Err("SOURCE_INVALID");
    }
    Ok(keyword.to_string())
}

fn validate_subject(id: u64) -> Result<u64, &'static str> {
    if id == 0 || id > 99_999_999 {
        return Err("SOURCE_INVALID");
    }
    Ok(id)
}

fn refusal(status: reqwest::StatusCode) -> Option<&'static str> {
    match status.as_u16() {
        403 => Some("SOURCE_ACCESS_DENIED"),
        404 => Some("OPDS_NOT_FOUND"),
        429 | 503 => Some("SOURCE_RATE_LIMITED"),
        _ if status.is_success() => None,
        _ => Some("SOURCE_INVALID"),
    }
}

async fn fetch(state: &BangumiState, request: Request) -> Result<BangumiResponse, &'static str> {
    let mut last = state.last_finished.lock().await;
    if let Some(finished) = *last {
        let elapsed = finished.elapsed();
        if elapsed < REQUEST_GAP {
            tokio::time::sleep(REQUEST_GAP - elapsed).await;
        }
    }
    let result = async {
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|_| "SOURCE_INVALID")?;
        let builder = match request {
            Request::Search(keyword) => {
                let url = Url::parse(&format!("{API}/v0/search/subjects?limit=20"))
                    .map_err(|_| "SOURCE_INVALID")?;
                client
                    .post(url)
                    .json(&json!({ "keyword": keyword, "filter": { "type": [1] } }))
            }
            Request::Subject(id) => {
                let url =
                    Url::parse(&format!("{API}/v0/subjects/{id}")).map_err(|_| "SOURCE_INVALID")?;
                client.get(url)
            }
        };
        let response = builder.send().await.map_err(|_| "SOURCE_TIMEOUT")?;
        if let Some(code) = refusal(response.status()) {
            return Err(code);
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BODY as u64)
        {
            return Err("SOURCE_TOO_LARGE");
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "SOURCE_TIMEOUT")?;
            if bytes.len() + chunk.len() > MAX_BODY {
                return Err("SOURCE_TOO_LARGE");
            }
            bytes.extend_from_slice(&chunk);
        }
        let text = String::from_utf8(bytes).map_err(|_| "SOURCE_INVALID")?;
        Ok(BangumiResponse { text })
    }
    .await;
    *last = Some(Instant::now());
    result
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("SOURCE_UNAVAILABLE".into())
    }
}

async fn run(
    state: &BangumiState,
    request_id: String,
    request: Request,
) -> Result<BangumiResponse, String> {
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("SOURCE_INVALID".into());
    }
    let registration = {
        let mut active = state.active.lock().unwrap();
        if active.is_some() {
            return Err("SOURCE_BUSY".into());
        }
        let (handle, registration) = AbortHandle::new_pair();
        *active = Some((request_id.clone(), handle));
        registration
    };
    let result = Abortable::new(fetch(state, request), registration).await;
    let mut active = state.active.lock().unwrap();
    if active.as_ref().is_some_and(|(id, _)| id == &request_id) {
        active.take();
    }
    result
        .map_err(|_| "SOURCE_CANCELLED".to_string())?
        .map_err(str::to_string)
}

#[tauri::command]
pub async fn bangumi_search(
    window: WebviewWindow,
    state: State<'_, BangumiState>,
    request_id: String,
    keyword: String,
) -> Result<BangumiResponse, String> {
    main_only(&window)?;
    let keyword = validate_keyword(&keyword)?;
    run(&state, request_id, Request::Search(keyword)).await
}

#[tauri::command]
pub async fn bangumi_subject(
    window: WebviewWindow,
    state: State<'_, BangumiState>,
    request_id: String,
    id: u64,
) -> Result<BangumiResponse, String> {
    main_only(&window)?;
    let id = validate_subject(id)?;
    run(&state, request_id, Request::Subject(id)).await
}

#[tauri::command]
pub fn bangumi_cancel(
    window: WebviewWindow,
    state: State<'_, BangumiState>,
    request_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    let mut active = state.active.lock().unwrap();
    if active.as_ref().is_some_and(|(id, _)| id == &request_id) {
        if let Some((_, handle)) = active.take() {
            handle.abort();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_arguments() {
        assert_eq!(
            validate_keyword("  負けヒロイン "),
            Ok("負けヒロイン".into())
        );
        assert!(validate_keyword(" ").is_err());
        assert!(validate_keyword(&"字".repeat(101)).is_err());
        assert_eq!(validate_subject(343241), Ok(343241));
        assert!(validate_subject(0).is_err());
        assert!(validate_subject(100_000_000).is_err());
    }

    #[test]
    fn maps_refusals() {
        use reqwest::StatusCode;
        assert_eq!(refusal(StatusCode::OK), None);
        assert_eq!(refusal(StatusCode::NOT_FOUND), Some("OPDS_NOT_FOUND"));
        assert_eq!(
            refusal(StatusCode::TOO_MANY_REQUESTS),
            Some("SOURCE_RATE_LIMITED")
        );
        assert_eq!(refusal(StatusCode::FOUND), Some("SOURCE_INVALID"));
    }

    /// Live check, run by hand: `cargo test bangumi_live -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn bangumi_live_smoke() {
        let state = BangumiState::new();
        let search = fetch(&state, Request::Search("負けヒロインが多すぎる".into()))
            .await
            .unwrap();
        assert!(
            search.text.contains("\"name_cn\""),
            "{}",
            &search.text[..80]
        );
        let started = Instant::now();
        let subject = fetch(&state, Request::Subject(343241)).await.unwrap();
        assert!(started.elapsed() >= Duration::from_millis(900));
        assert!(subject.text.contains("\"infobox\""));
    }
}
