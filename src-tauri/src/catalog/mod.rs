use std::{
    collections::HashMap,
    net::{IpAddr, ToSocketAddrs},
    sync::{mpsc, Mutex},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{
    future::{AbortHandle, Abortable},
    StreamExt,
};
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const SOURCE_WINDOW: &str = "novel-source";
const MAX_SNAPSHOT: usize = 3 * 1024 * 1024;
const MAX_IMAGE: usize = 10 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Bilinovel,
    Linovelib,
}

impl Source {
    fn host(self) -> &'static str {
        match self {
            Self::Bilinovel => "www.bilinovel.com",
            Self::Linovelib => "www.linovelib.com",
        }
    }
    fn search_start_path(self) -> &'static str {
        match self {
            Self::Bilinovel => "/search.html",
            Self::Linovelib => "/",
        }
    }
    fn url(self, path: &str) -> Result<Url, String> {
        if path != "/" && !valid_search_path(path) && !valid_page_path(path) {
            return Err("SOURCE_INVALID".into());
        }
        Url::parse(&format!("https://{}{path}", self.host())).map_err(|_| "SOURCE_INVALID".into())
    }
    fn allows(self, url: &Url) -> bool {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
            && [self.host(), self.host().trim_start_matches("www.")]
                .contains(&url.host_str().unwrap_or(""))
    }
}

fn digits(value: &str) -> bool {
    !value.is_empty() && value.len() <= 10 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid_search_path(path: &str) -> bool {
    if path == "/search.html" {
        return true;
    }
    path.strip_prefix("/S").is_some_and(|suffix| {
        let number = suffix.strip_suffix('/').unwrap_or(suffix);
        number.len() <= 3 && digits(number)
    })
}

fn valid_page_path(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() == 3 && parts[1] == "novel" {
        return parts[2].strip_suffix(".html").is_some_and(digits);
    }
    if parts.len() != 4 || parts[1] != "novel" || !digits(parts[2]) {
        return false;
    }
    if parts[3] == "catalog" {
        return true;
    }
    let Some(file) = parts[3].strip_suffix(".html") else {
        return false;
    };
    if let Some(id) = file.strip_prefix("vol_") {
        return digits(id);
    }
    let mut split = file.split('_');
    digits(split.next().unwrap_or(""))
        && split
            .next()
            .map_or(true, |page| digits(page) && page.len() <= 2)
        && split.next().is_none()
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PageRequest {
    Current,
    Search { query: String },
    Page { path: String },
}

#[derive(Deserialize, Serialize)]
pub struct PageSnapshot {
    url: String,
    html: String,
}

struct Pending {
    id: String,
    source: Source,
    target: Url,
    query: Option<String>,
    submitted: bool,
    sequence: usize,
    data: String,
    sender: mpsc::Sender<Result<PageSnapshot, String>>,
}

pub struct CatalogState {
    pending: Mutex<Option<Pending>>,
    image: Mutex<Option<(String, AbortHandle)>>,
}

impl CatalogState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            image: Mutex::new(None),
        }
    }
    fn finish(&self, id: &str, result: Result<PageSnapshot, String>) -> bool {
        let mut guard = self.pending.lock().unwrap();
        if guard.as_ref().is_some_and(|pending| pending.id == id) {
            if let Some(pending) = guard.take() {
                let _ = pending.sender.send(result);
                return true;
            }
        }
        false
    }
    fn bridge(&self, url: &Url) {
        let parameters: HashMap<_, _> = url.query_pairs().collect();
        let Some(id) = parameters.get("id") else {
            return;
        };
        if !self
            .pending
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|pending| pending.id == id.as_ref())
        {
            return;
        }
        if url.path() == "/submitted" {
            if let Some(pending) = self
                .pending
                .lock()
                .unwrap()
                .as_mut()
                .filter(|pending| pending.id == id.as_ref() && pending.query.is_some())
            {
                pending.submitted = true;
            }
            return;
        }
        if let Some(error) = parameters.get("error") {
            let code = if error == "SOURCE_TOO_LARGE" {
                "SOURCE_TOO_LARGE"
            } else {
                "SOURCE_INVALID"
            };
            log::warn!(
                "Source snapshot export failed: {code}, kind {:?}",
                parameters.get("kind").filter(|value| value.len() <= 30)
            );
            self.finish(id, Err(code.into()));
            return;
        }
        let mut guard = self.pending.lock().unwrap();
        let Some(pending) = guard.as_mut().filter(|pending| pending.id == id.as_ref()) else {
            return;
        };
        let sequence = parameters
            .get("seq")
            .and_then(|value| value.parse::<usize>().ok());
        let chunk = parameters
            .get("data")
            .map(|value| value.as_ref())
            .unwrap_or("");
        if sequence != Some(pending.sequence)
            || chunk.len() > 24000
            || pending.data.len() + chunk.len() > MAX_SNAPSHOT * 2
        {
            let pending = guard.take().unwrap();
            let _ = pending.sender.send(Err("SOURCE_TOO_LARGE".into()));
            return;
        }
        pending.sequence += 1;
        pending.data.push_str(chunk);
        if parameters.get("last").is_some_and(|value| value == "1") {
            let pending = guard.take().unwrap();
            let result = STANDARD
                .decode(pending.data)
                .ok()
                .filter(|bytes| bytes.len() <= MAX_SNAPSHOT)
                .and_then(|bytes| serde_json::from_slice::<PageSnapshot>(&bytes).ok())
                .filter(|snapshot| {
                    snapshot.html.len() <= 2 * 1024 * 1024
                        && Url::parse(&snapshot.url).is_ok_and(|url| pending.source.allows(&url))
                })
                .ok_or_else(|| "SOURCE_INVALID".into());
            match &result {
                Ok(snapshot) => {
                    log::debug!("Source snapshot received: {} bytes", snapshot.html.len())
                }
                Err(_) => log::warn!("Source snapshot validation failed"),
            }
            let _ = pending.sender.send(result);
        }
    }
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("SOURCE_ACCESS_DENIED".into());
    }
    Ok(())
}

fn navigation_script(target: &Url, request_id: &str) -> String {
    include_str!("navigate.js")
        .replace(
            "__TARGET_URL__",
            &serde_json::to_string(target.as_str()).unwrap(),
        )
        .replace(
            "__REQUEST_ID__",
            &serde_json::to_string(request_id).unwrap(),
        )
}

fn cancel_source_script(app: &tauri::AppHandle, request_id: &str, stop_loading: bool) {
    if let Some(view) = app.get_webview_window(SOURCE_WINDOW) {
        let id = serde_json::to_string(request_id).unwrap();
        let stop = if stop_loading { "window.stop();" } else { "" };
        let _ = view.eval(format!(
            "window.__lightReaderCancelled ??= {{}}; window.__lightReaderCancelled[{id}] = true; {stop}"
        ));
    }
}

fn script_for_page(state: &CatalogState, url: &Url) -> Option<String> {
    let guard = state.pending.lock().unwrap();
    let pending = guard.as_ref()?;
    if !pending.source.allows(url) {
        return None;
    }
    if url.path() == "/" && pending.target.path() != "/" && !pending.submitted {
        return Some(navigation_script(&pending.target, &pending.id));
    }
    let id = serde_json::to_string(&pending.id).unwrap();
    let snapshot = include_str!("snapshot.js").replace("__REQUEST_ID__", &id);
    if let Some(query) = &pending.query {
        if pending.submitted {
            return (valid_search_path(url.path()) || valid_page_path(url.path()))
                .then_some(snapshot);
        }
        if url.path() != pending.target.path() {
            return None;
        }
        return Some(
            include_str!("search.js")
                .replace("__REQUEST_ID__", &id)
                .replace("__SNAPSHOT__", &snapshot)
                .replace("__QUERY__", &serde_json::to_string(query).unwrap()),
        );
    }
    if url.path() == pending.target.path() {
        return Some(snapshot);
    }
    if let Some(detail) = pending.target.path().strip_suffix("/catalog") {
        if url.path() == format!("{detail}.html") || valid_search_path(url.path()) {
            return Some(navigation_script(&pending.target, &pending.id));
        }
    }
    None
}

fn source_window(app: &tauri::AppHandle, source: Source) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SOURCE_WINDOW) {
        return Ok(window);
    }
    let navigation_app = app.clone();
    let window =
        WebviewWindowBuilder::new(app, SOURCE_WINDOW, WebviewUrl::External(source.url("/")?))
            .title("LightReader · 在线书源")
            .inner_size(900.0, 700.0)
            .visible(true)
            .initialization_script(include_str!("ready.js"))
            .on_navigation(move |url| {
                if url.host_str() == Some("lightreader.invalid") {
                    if url.path() == "/ready" {
                        let page = url.query_pairs().find(|(key, _)| key == "url").and_then(
                            |(_, value)| {
                                (value.len() <= 2048)
                                    .then(|| Url::parse(&value).ok())
                                    .flatten()
                            },
                        );
                        if let (Some(page), Some(view)) =
                            (page, navigation_app.get_webview_window(SOURCE_WINDOW))
                        {
                            if let Some(script) =
                                script_for_page(&navigation_app.state::<CatalogState>(), &page)
                            {
                                let _ = view.eval(script);
                            }
                        }
                    } else {
                        navigation_app.state::<CatalogState>().bridge(url);
                    }
                    return false;
                }
                // No app/file/custom-protocol navigation, IPC capability, popups or
                // direct downloads are granted to this remote window.
                Source::Bilinovel.allows(url) || Source::Linovelib.allows(url)
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .on_page_load(move |window, payload| {
                if payload.event() != tauri::webview::PageLoadEvent::Finished {
                    return;
                }
                let state = window.state::<CatalogState>();
                if let Some(script) = script_for_page(&state, payload.url()) {
                    let _ = window.eval(script);
                }
            })
            .build()
            .map_err(|_| "SOURCE_UNAVAILABLE".to_string())?;
    let close_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(pending) = close_app
                .state::<CatalogState>()
                .pending
                .lock()
                .unwrap()
                .take()
            {
                let _ = pending.sender.send(Err("SOURCE_UNAVAILABLE".into()));
            }
        }
    });
    Ok(window)
}

#[tauri::command]
pub async fn catalog_read_page(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, CatalogState>,
    request_id: String,
    source: Source,
    request: PageRequest,
) -> Result<PageSnapshot, String> {
    main_only(&window)?;
    if request_id.len() > 80 || request_id.is_empty() {
        return Err("SOURCE_INVALID".into());
    }
    let (target, query, current) = match request {
        PageRequest::Current => {
            let url = app
                .get_webview_window(SOURCE_WINDOW)
                .ok_or("SOURCE_SELECT_BOOK")?
                .url()
                .map_err(|_| "SOURCE_SELECT_BOOK")?;
            if !source.allows(&url)
                || !(valid_search_path(url.path()) || valid_page_path(url.path()))
            {
                return Err("SOURCE_SELECT_BOOK".into());
            }
            (url, None, true)
        }
        PageRequest::Search { query } => {
            if query.trim().is_empty() || query.chars().count() > 100 {
                return Err("SOURCE_INVALID".into());
            }
            // Each source supplies its actual POST action from its own
            // search form; the entry pages differ between the two templates.
            (source.url(source.search_start_path())?, Some(query), false)
        }
        PageRequest::Page { path } => (source.url(&path)?, None, false),
    };
    let (sender, receiver) = mpsc::channel();
    {
        let mut guard = state.pending.lock().unwrap();
        if guard.is_some() {
            return Err("SOURCE_BUSY".into());
        }
        *guard = Some(Pending {
            id: request_id.clone(),
            source,
            target: target.clone(),
            query,
            submitted: false,
            sequence: 0,
            data: String::new(),
            sender,
        });
    }
    let existed = app.get_webview_window(SOURCE_WINDOW).is_some();
    let view = match source_window(&app, source) {
        Ok(view) => view,
        Err(error) => {
            state.finish(&request_id, Err(error.clone()));
            return Err(error);
        }
    };
    // Keep the source renderer active while its bounded snapshot is exported.
    let _ = view.show();
    let _ = view.set_focus();
    if current {
        if view
            .eval(include_str!("snapshot.js").replace(
                "__REQUEST_ID__",
                &serde_json::to_string(&request_id).unwrap(),
            ))
            .is_err()
        {
            state.finish(&request_id, Err("SOURCE_UNAVAILABLE".into()));
        }
    } else if existed {
        // Retain the normal in-site browser referrer. Enter another source
        // through its home page before navigating to the requested page.
        let navigation = if view.url().is_ok_and(|url| source.allows(&url)) {
            view.eval(navigation_script(&target, &request_id))
        } else {
            view.navigate(source.url("/")?)
        };
        if navigation.is_err() {
            state.finish(&request_id, Err("SOURCE_UNAVAILABLE".into()));
        }
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(40))
            .unwrap_or_else(|_| Err("SOURCE_TIMEOUT".into()))
    })
    .await
    .map_err(|_| "SOURCE_UNAVAILABLE".to_string())?;
    if state.finish(&request_id, Err("SOURCE_TIMEOUT".into())) {
        cancel_source_script(&app, &request_id, true);
    }
    // Return to the result or error in the main window, including a blank
    // source renderer that reached its deadline.
    let _ = window.set_focus();
    result
}

#[tauri::command]
pub fn catalog_cancel(
    window: WebviewWindow,
    state: State<'_, CatalogState>,
    request_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    let cancelled_page = state.finish(&request_id, Err("SOURCE_CANCELLED".into()));
    cancel_source_script(window.app_handle(), &request_id, cancelled_page);
    let mut image = state.image.lock().unwrap();
    if image.as_ref().is_some_and(|(id, _)| id == &request_id) {
        if let Some((_, abort)) = image.take() {
            abort.abort();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn catalog_open_source(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, CatalogState>,
    source: Source,
) -> Result<(), String> {
    main_only(&window)?;
    let view = source_window(&app, source)?;
    if state.pending.lock().unwrap().is_none() && !view.url().is_ok_and(|url| source.allows(&url)) {
        view.navigate(source.url("/")?)
            .map_err(|_| "SOURCE_UNAVAILABLE")?;
    }
    view.show().map_err(|_| "SOURCE_UNAVAILABLE")?;
    view.set_focus().map_err(|_| "SOURCE_UNAVAILABLE")?;
    Ok(())
}

fn allowed_image(source: Source, url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && (source.allows(url) || url.host_str() == Some("img3.readpai.com"))
        && [".jpg", ".jpeg", ".png", ".gif", ".webp"]
            .iter()
            .any(|extension| url.path().to_lowercase().ends_with(extension))
}

fn public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 240
                && !(ip.octets()[0] == 100 && ip.octets()[1] & 0xc0 == 64)
                && !(ip.octets()[0] == 198 && ip.octets()[1] & 0xfe == 18)
                && !(ip.octets()[0] == 192 && ip.octets()[1] == 0 && ip.octets()[2] == 0)
        }
        IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(ipv4));
            }
            let bytes = ip.octets();
            bytes[0] & 0xe0 == 0x20 && !(ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8)
        }
    }
}

async fn pinned_image_client(url: &Url) -> Result<Client, &'static str> {
    let host = url.host_str().ok_or("SOURCE_IMAGE_FAILED")?.to_string();
    let lookup_host = host.clone();
    let lookup = tauri::async_runtime::spawn_blocking(move || {
        (lookup_host.as_str(), 443)
            .to_socket_addrs()
            .map(|addresses| addresses.take(16).collect::<Vec<_>>())
    });
    let addresses = tokio::time::timeout(Duration::from_secs(5), lookup)
        .await
        .map_err(|_| "SOURCE_IMAGE_FAILED")?
        .map_err(|_| "SOURCE_IMAGE_FAILED")?
        .map_err(|_| "SOURCE_IMAGE_FAILED")?;
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err("SOURCE_IMAGE_FAILED");
    }
    Client::builder()
        .no_proxy()
        .resolve_to_addrs(&host, &addresses)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(25))
        .user_agent("LightReader/0.1")
        .build()
        .map_err(|_| "SOURCE_IMAGE_FAILED")
}

fn refusal_code(status: reqwest::StatusCode) -> Option<&'static str> {
    match status {
        reqwest::StatusCode::FORBIDDEN => Some("SOURCE_ACCESS_DENIED"),
        reqwest::StatusCode::TOO_MANY_REQUESTS => Some("SOURCE_RATE_LIMITED"),
        _ => None,
    }
}

async fn download_image(source: Source, mut url: Url) -> Result<Vec<u8>, &'static str> {
    for _ in 0..=3 {
        let response = pinned_image_client(&url)
            .await?
            .get(url.clone())
            .header("Referer", format!("https://{}/", source.host()))
            .send()
            .await
            .map_err(|_| "SOURCE_IMAGE_FAILED")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or("SOURCE_IMAGE_FAILED")?;
            url = url.join(location).map_err(|_| "SOURCE_IMAGE_FAILED")?;
            if !allowed_image(source, &url) {
                return Err("SOURCE_IMAGE_FAILED");
            }
            continue;
        }
        if let Some(code) = refusal_code(response.status()) {
            // The source refused or throttled us: report it so the caller
            // stops the whole task. Never retry these automatically.
            return Err(code);
        }
        if !response.status().is_success() {
            return Err("SOURCE_IMAGE_FAILED");
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_IMAGE as u64)
        {
            return Err("SOURCE_TOO_LARGE");
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "SOURCE_IMAGE_FAILED")?;
            if bytes.len() + chunk.len() > MAX_IMAGE {
                return Err("SOURCE_TOO_LARGE");
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(bytes);
    }
    Err("SOURCE_IMAGE_FAILED")
}

#[tauri::command]
pub async fn catalog_read_image(
    window: WebviewWindow,
    state: State<'_, CatalogState>,
    request_id: String,
    source: Source,
    url: String,
) -> Result<tauri::ipc::Response, String> {
    main_only(&window)?;
    if request_id.is_empty() || request_id.len() > 80 || url.len() > 2048 {
        return Err("SOURCE_INVALID".into());
    }
    let url = Url::parse(&url).map_err(|_| "SOURCE_IMAGE_FAILED")?;
    if !allowed_image(source, &url) {
        return Err("SOURCE_IMAGE_FAILED".into());
    }
    let registration = {
        let mut image = state.image.lock().unwrap();
        if image.is_some() {
            return Err("SOURCE_BUSY".into());
        }
        let (handle, registration) = AbortHandle::new_pair();
        *image = Some((request_id.clone(), handle));
        registration
    };
    let bounded_download = async {
        tokio::time::timeout(Duration::from_secs(35), download_image(source, url))
            .await
            .unwrap_or(Err("SOURCE_IMAGE_FAILED"))
    };
    let result = Abortable::new(bounded_download, registration).await;
    let mut image = state.image.lock().unwrap();
    if image.as_ref().is_some_and(|(id, _)| id == &request_id) {
        image.take();
    }
    result
        .map_err(|_| "SOURCE_CANCELLED".to_string())?
        .map(tauri::ipc::Response::new)
        .map_err(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Live source smoke test; requires normal network access"]
    async fn source_cover_live_smoke() {
        let bytes = tokio::time::timeout(
            Duration::from_secs(35),
            download_image(
                Source::Bilinovel,
                Url::parse("https://img3.readpai.com/cover/3095/200726.jpg").unwrap(),
            ),
        )
        .await
        .expect("Image deadline")
        .expect("Image download");
        assert!(bytes.starts_with(&[0xff, 0xd8, 0xff]));
        assert!(bytes.len() < MAX_IMAGE);
    }
    fn pending(state: &CatalogState) -> mpsc::Receiver<Result<PageSnapshot, String>> {
        let (sender, receiver) = mpsc::channel();
        *state.pending.lock().unwrap() = Some(Pending {
            id: "test".into(),
            source: Source::Bilinovel,
            target: Source::Bilinovel.url("/novel/1.html").unwrap(),
            query: None,
            submitted: false,
            sequence: 0,
            data: String::new(),
            sender,
        });
        receiver
    }
    fn bridge(state: &CatalogState, seq: usize, last: bool, data: &str) {
        let mut url = Url::parse("https://lightreader.invalid/result").unwrap();
        url.query_pairs_mut()
            .append_pair("id", "test")
            .append_pair("seq", &seq.to_string())
            .append_pair("last", if last { "1" } else { "0" })
            .append_pair("data", data);
        state.bridge(&url);
    }
    #[test]
    fn exports_only_complete_ordered_bounded_snapshots() {
        let state = CatalogState::new();
        let receiver = pending(&state);
        let encoded = STANDARD
            .encode(br#"{"url":"https://www.bilinovel.com/novel/1.html","html":"<h1>Test</h1>"}"#);
        let split = encoded.len() / 2;
        bridge(&state, 0, false, &encoded[..split]);
        assert!(receiver.try_recv().is_err());
        bridge(&state, 1, true, &encoded[split..]);
        assert_eq!(receiver.recv().unwrap().unwrap().html, "<h1>Test</h1>");
        let receiver = pending(&state);
        bridge(&state, 1, true, &encoded);
        assert!(receiver.recv().unwrap().is_err());
        let receiver = pending(&state);
        state.finish("another-request", Err("ignored".into()));
        assert!(receiver.try_recv().is_err());
        state.finish("test", Err("SOURCE_CANCELLED".into()));
        assert_eq!(
            receiver.recv().unwrap().err().as_deref(),
            Some("SOURCE_CANCELLED")
        );
    }
    #[test]
    fn reports_refusals_instead_of_generic_failures() {
        use reqwest::StatusCode;
        assert_eq!(
            refusal_code(StatusCode::FORBIDDEN),
            Some("SOURCE_ACCESS_DENIED")
        );
        assert_eq!(
            refusal_code(StatusCode::TOO_MANY_REQUESTS),
            Some("SOURCE_RATE_LIMITED")
        );
        for status in [
            StatusCode::OK,
            StatusCode::NOT_FOUND,
            StatusCode::BAD_GATEWAY,
        ] {
            assert_eq!(refusal_code(status), None);
        }
    }
    #[test]
    fn rejects_non_public_image_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "198.19.0.1",
            "192.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
        }
        for address in ["1.1.1.1", "2606:4700:4700::1111"] {
            assert!(public_ip(address.parse().unwrap()));
        }
    }
    #[test]
    fn keeps_query_literals_and_rejects_foreign_ready_pages() {
        let state = CatalogState::new();
        let _receiver = pending(&state);
        let query = "__SNAPSHOT__\"; window.unwanted=1; //";
        {
            let mut guard = state.pending.lock().unwrap();
            let pending = guard.as_mut().unwrap();
            pending.query = Some(query.into());
            pending.target = Source::Bilinovel
                .url(Source::Bilinovel.search_start_path())
                .unwrap();
        }
        let script =
            script_for_page(&state, &Source::Bilinovel.url("/search.html").unwrap()).unwrap();
        assert!(script.contains(&format!(
            "input.value = {}",
            serde_json::to_string(query).unwrap()
        )));
        assert_eq!(script.matches("__SNAPSHOT__").count(), 1);
        state.pending.lock().unwrap().as_mut().unwrap().submitted = true;
        assert!(script_for_page(&state, &Source::Bilinovel.url("/").unwrap()).is_none());
        assert!(script_for_page(&state, &Source::Bilinovel.url("/S6/").unwrap()).is_some());
        assert!(script_for_page(
            &state,
            &Url::parse("https://www.linovelib.com/search.html").unwrap()
        )
        .is_none());
        {
            let mut guard = state.pending.lock().unwrap();
            let pending = guard.as_mut().unwrap();
            pending.source = Source::Linovelib;
            pending.target = Source::Linovelib
                .url(Source::Linovelib.search_start_path())
                .unwrap();
            pending.submitted = false;
        }
        let script = script_for_page(&state, &Source::Linovelib.url("/").unwrap()).unwrap();
        assert!(script.contains(&format!(
            "input.value = {}",
            serde_json::to_string(query).unwrap()
        )));
    }
    #[test]
    fn limits_paths_and_origins() {
        assert!(valid_search_path("/S6/"));
        assert!(valid_search_path("/search.html"));
        assert!(!valid_search_path("/S6//"));
        assert!(!valid_search_path("/S6/evil"));
        for path in [
            "/novel/3095.html",
            "/novel/3095/catalog",
            "/novel/3095/154931_2.html",
            "/novel/3095/vol_154930.html",
        ] {
            assert!(valid_page_path(path));
        }
        for path in [
            "/novel/../secret",
            "/novel/1/2.html?url=http://localhost",
            "/login.php",
            "//localhost/novel/1.html",
            "/novel/1/2_1_2.html",
        ] {
            assert!(!valid_page_path(path));
        }
        assert!(
            !Source::Bilinovel.allows(&Url::parse("https://www.bilinovel.com.evil.test/").unwrap())
        );
        assert!(!allowed_image(
            Source::Bilinovel,
            &Url::parse("http://127.0.0.1/a.jpg").unwrap()
        ));
        assert!(allowed_image(
            Source::Bilinovel,
            &Url::parse("https://img3.readpai.com/cover/1/a.jpg").unwrap()
        ));
    }
}
