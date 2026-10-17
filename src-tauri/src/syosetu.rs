//! Native requests to 小説家になろう (Syosetu): the official novel API for
//! search, and public table-of-contents and episode pages. Only two hosts and
//! fixed path shapes are reachable; the R18 site is out of scope.
//!
//! Episode illustrations (挿絵) are hosted on みてみん: only its fixed image
//! address shape and the `img{N}.mitemin.net` hosts it redirects to are
//! reachable.
//!
//! Requests are strictly one at a time and spaced here, natively, so the
//! frontend cannot exceed the site's crawl delay (robots.txt asks for 1 s).

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
use tauri::{State, WebviewWindow};

const API: &str = "https://api.syosetu.com/novelapi/api/";
const PAGES: &str = "https://ncode.syosetu.com";
const MAX_BODY: usize = 3 * 1024 * 1024;
const MAX_IMAGE: usize = 10 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const REQUEST_GAP: Duration = Duration::from_secs(2);
const PAGE_SIZE: u32 = 20;

#[derive(Serialize)]
pub struct SyosetuResponse {
    url: String,
    text: String,
}

#[derive(Default)]
pub struct SyosetuState {
    active: Mutex<Option<(String, AbortHandle)>>,
    // Shared by every request kind: the API and pages are one site.
    last_finished: tokio::sync::Mutex<Option<Instant>>,
}

impl SyosetuState {
    pub fn new() -> Self {
        Self::default()
    }
}

fn ncode(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 6
        && bytes.len() <= 8
        && bytes[0] == b'n'
        && bytes[1..5].iter().all(u8::is_ascii_digit)
        && bytes[5..].iter().all(u8::is_ascii_lowercase)
}

/// `/{ncode}/`, `/{ncode}/?p={page}` or `/{ncode}/{episode}/`.
fn page_url(path: &str) -> Result<Url, &'static str> {
    let (route, query) = path.split_once('?').unwrap_or((path, ""));
    let parts: Vec<&str> = route.split('/').collect();
    let valid = match parts.as_slice() {
        ["", code, ""] => {
            ncode(code)
                && (query.is_empty()
                    || query.strip_prefix("p=").is_some_and(|page| {
                        !page.is_empty()
                            && page.len() <= 4
                            && page.bytes().all(|byte| byte.is_ascii_digit())
                            && !page.starts_with('0')
                    }))
        }
        ["", code, episode, ""] => {
            ncode(code)
                && query.is_empty()
                && !episode.is_empty()
                && episode.len() <= 5
                && episode.bytes().all(|byte| byte.is_ascii_digit())
                && !episode.starts_with('0')
        }
        _ => false,
    };
    if !valid {
        return Err("SOURCE_INVALID");
    }
    Url::parse(&format!("{PAGES}{path}")).map_err(|_| "SOURCE_INVALID")
}

fn search_url(query: &str, page: u32) -> Result<Url, &'static str> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 100 || !(1..=50).contains(&page) {
        return Err("SOURCE_INVALID");
    }
    let mut url = Url::parse(API).map_err(|_| "SOURCE_INVALID")?;
    url.query_pairs_mut()
        .append_pair("out", "json")
        .append_pair("lim", &PAGE_SIZE.to_string())
        .append_pair("st", &((page - 1) * PAGE_SIZE + 1).to_string())
        .append_pair("order", "hyoka")
        .append_pair("of", "t-n-w-s-ga-nt-e-gl")
        .append_pair("word", query);
    Ok(url)
}

fn digits(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn plain_https(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

/// `https://{user}.mitemin.net/userpageimage/viewimagebig/icode/i{id}/`, the
/// address episode pages embed for an illustration.
fn image_url(raw: &str) -> Result<Url, &'static str> {
    let url = Url::parse(raw).map_err(|_| "SOURCE_IMAGE_FAILED")?;
    let user_host = url
        .host_str()
        .and_then(|host| host.strip_suffix(".mitemin.net"))
        .is_some_and(|user| digits(user, 10));
    let icode = url
        .path()
        .strip_prefix("/userpageimage/viewimagebig/icode/i")
        .and_then(|rest| rest.strip_suffix('/'))
        .is_some_and(|id| digits(id, 12));
    if plain_https(&url) && user_host && icode {
        Ok(url)
    } else {
        Err("SOURCE_IMAGE_FAILED")
    }
}

/// Where みてみん redirects an illustration: an `img{N}` host and an image file.
fn image_redirect(url: &Url) -> bool {
    plain_https(url)
        && url
            .host_str()
            .and_then(|host| host.strip_suffix(".mitemin.net"))
            .and_then(|name| name.strip_prefix("img"))
            .is_some_and(|number| digits(number, 2))
        && [".jpg", ".jpeg", ".png", ".gif", ".webp"]
            .iter()
            .any(|extension| url.path().to_ascii_lowercase().ends_with(extension))
}

fn refusal(status: reqwest::StatusCode) -> Option<&'static str> {
    match status.as_u16() {
        403 => Some("SOURCE_ACCESS_DENIED"),
        429 | 503 => Some("SOURCE_RATE_LIMITED"),
        _ if status.is_success() => None,
        _ => Some("SOURCE_INVALID"),
    }
}

/// One paced request: redirects only where `follow` allows, bounded body.
async fn fetch_bytes(
    state: &SyosetuState,
    mut url: Url,
    limit: usize,
    follow: fn(&Url) -> bool,
) -> Result<(Url, Vec<u8>), &'static str> {
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
            .timeout(Duration::from_secs(30))
            .user_agent("LightReader/0.1")
            .build()
            .map_err(|_| "SOURCE_INVALID")?;
        for _ in 0..=MAX_REDIRECTS {
            let response = client
                .get(url.clone())
                .send()
                .await
                .map_err(|_| "SOURCE_TIMEOUT")?;
            if response.status().is_redirection() {
                let next = response
                    .headers()
                    .get("location")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|location| url.join(location).ok())
                    .ok_or("SOURCE_INVALID")?;
                if !follow(&next) {
                    return Err("SOURCE_INVALID");
                }
                url = next;
                continue;
            }
            if let Some(code) = refusal(response.status()) {
                return Err(code);
            }
            if response
                .content_length()
                .is_some_and(|size| size > limit as u64)
            {
                return Err("SOURCE_TOO_LARGE");
            }
            let mut bytes = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| "SOURCE_TIMEOUT")?;
                if bytes.len() + chunk.len() > limit {
                    return Err("SOURCE_TOO_LARGE");
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok((url, bytes));
        }
        Err("SOURCE_INVALID")
    }
    .await;
    *last = Some(Instant::now());
    result
}

fn no_redirects(_: &Url) -> bool {
    false
}

async fn fetch(state: &SyosetuState, url: Url) -> Result<SyosetuResponse, &'static str> {
    let (url, bytes) = fetch_bytes(state, url, MAX_BODY, no_redirects).await?;
    let text = String::from_utf8(bytes).map_err(|_| "SOURCE_INVALID")?;
    Ok(SyosetuResponse {
        url: url.to_string(),
        text,
    })
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("SOURCE_UNAVAILABLE".into())
    }
}

async fn run<T>(
    state: &SyosetuState,
    request_id: String,
    work: impl std::future::Future<Output = Result<T, &'static str>>,
) -> Result<T, String> {
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
    let result = Abortable::new(work, registration).await;
    let mut active = state.active.lock().unwrap();
    if active.as_ref().is_some_and(|(id, _)| id == &request_id) {
        active.take();
    }
    result
        .map_err(|_| "SOURCE_CANCELLED".to_string())?
        .map_err(str::to_string)
}

#[tauri::command]
pub async fn syosetu_search(
    window: WebviewWindow,
    state: State<'_, SyosetuState>,
    request_id: String,
    query: String,
    page: u32,
) -> Result<SyosetuResponse, String> {
    main_only(&window)?;
    let url = search_url(&query, page)?;
    run(&state, request_id, fetch(&state, url)).await
}

#[tauri::command]
pub async fn syosetu_page(
    window: WebviewWindow,
    state: State<'_, SyosetuState>,
    request_id: String,
    path: String,
) -> Result<SyosetuResponse, String> {
    main_only(&window)?;
    let url = page_url(&path)?;
    run(&state, request_id, fetch(&state, url)).await
}

#[tauri::command]
pub async fn syosetu_image(
    window: WebviewWindow,
    state: State<'_, SyosetuState>,
    request_id: String,
    url: String,
) -> Result<tauri::ipc::Response, String> {
    main_only(&window)?;
    if url.len() > 300 {
        return Err("SOURCE_IMAGE_FAILED".into());
    }
    let url = image_url(&url)?;
    let (_, bytes) = run(
        &state,
        request_id,
        fetch_bytes(&state, url, MAX_IMAGE, image_redirect),
    )
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn syosetu_cancel(
    window: WebviewWindow,
    state: State<'_, SyosetuState>,
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
    fn accepts_only_table_of_contents_and_episode_paths() {
        for path in ["/n4830bu/", "/n4830bu/?p=7", "/n4830bu/677/", "/n1234a/1/"] {
            assert!(page_url(path).is_ok(), "{path}");
        }
        assert_eq!(
            page_url("/n4830bu/1/").unwrap().as_str(),
            "https://ncode.syosetu.com/n4830bu/1/"
        );
        for path in [
            "/n4830bu",
            "/N4830BU/",
            "/n4830bu/0/",
            "/n4830bu/01/",
            "/n4830bu/?p=0",
            "/n4830bu/?p=1&x=2",
            "/n4830bu/1/?p=2",
            "/n4830bu/../",
            "//evil.example/",
            "/n483bu/",
            "/n4830bucde/",
            "/user/123/",
            "/n4830bu/1/2/",
        ] {
            assert_eq!(page_url(path).err(), Some("SOURCE_INVALID"), "{path}");
        }
    }

    #[test]
    fn builds_bounded_api_searches() {
        let url = search_url(" 本好き & co ", 2).unwrap();
        assert_eq!(url.host_str(), Some("api.syosetu.com"));
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert!(pairs.contains(&("st".into(), "21".into())));
        assert!(pairs.contains(&("word".into(), "本好き & co".into())));
        assert!(search_url("", 1).is_err());
        assert!(search_url("x", 0).is_err());
        assert!(search_url("x", 51).is_err());
        assert!(search_url(&"字".repeat(101), 1).is_err());
    }

    /// Live check against the real site, run by hand:
    /// `cargo test syosetu_live -- --ignored`. Four spaced requests (an
    /// illustration takes one redirect).
    #[tokio::test]
    #[ignore]
    async fn syosetu_live_smoke() {
        let state = SyosetuState::new();
        let search = fetch(&state, search_url("本好き", 1).unwrap())
            .await
            .unwrap();
        assert!(
            search.text.starts_with("[{\"allcount\":"),
            "{}",
            &search.text[..80]
        );
        let started = Instant::now();
        let toc = fetch(&state, page_url("/n4830bu/").unwrap()).await.unwrap();
        assert!(started.elapsed() >= Duration::from_millis(1900));
        for marker in ["p-novel__title", "p-eplist__sublist", "/n4830bu/1/"] {
            assert!(toc.text.contains(marker), "missing {marker}");
        }
        let (final_url, image) = fetch_bytes(
            &state,
            image_url("https://47160.mitemin.net/userpageimage/viewimagebig/icode/i966187/")
                .unwrap(),
            MAX_IMAGE,
            image_redirect,
        )
        .await
        .unwrap();
        assert!(final_url.host_str().unwrap().starts_with("img"));
        assert_eq!(&image[..3], &[0xff, 0xd8, 0xff]);
    }

    #[test]
    fn accepts_only_mitemin_illustrations_and_their_image_hosts() {
        let embedded = "https://47160.mitemin.net/userpageimage/viewimagebig/icode/i966187/";
        assert!(image_url(embedded).is_ok());
        for raw in [
            "http://47160.mitemin.net/userpageimage/viewimagebig/icode/i966187/",
            "https://47160.mitemin.net:8443/userpageimage/viewimagebig/icode/i966187/",
            "https://evil.mitemin.net/userpageimage/viewimagebig/icode/i966187/",
            "https://47160.mitemin.net.evil.example/userpageimage/viewimagebig/icode/i966187/",
            "https://47160.mitemin.net/i966187/",
            "https://47160.mitemin.net/userpageimage/viewimagebig/icode/i966187/?x=1",
            "https://u:p@47160.mitemin.net/userpageimage/viewimagebig/icode/i966187/",
            "https://img1.mitemin.net/a.jpg",
        ] {
            assert!(image_url(raw).is_err(), "{raw}");
        }
        let target = Url::parse("https://img1.mitemin.net/2h/9p/abc_19n.jpg.580.jpg").unwrap();
        assert!(image_redirect(&target));
        for raw in [
            "https://img1.mitemin.net/a.html",
            "https://img123.mitemin.net/a.jpg",
            "https://static.mitemin.net/a.jpg",
            "https://img1.example.org/a.jpg",
            "http://img1.mitemin.net/a.jpg",
        ] {
            assert!(!image_redirect(&Url::parse(raw).unwrap()), "{raw}");
        }
    }

    #[test]
    fn maps_refusals() {
        use reqwest::StatusCode;
        assert_eq!(refusal(StatusCode::OK), None);
        assert_eq!(refusal(StatusCode::FORBIDDEN), Some("SOURCE_ACCESS_DENIED"));
        assert_eq!(
            refusal(StatusCode::TOO_MANY_REQUESTS),
            Some("SOURCE_RATE_LIMITED")
        );
        assert_eq!(
            refusal(StatusCode::SERVICE_UNAVAILABLE),
            Some("SOURCE_RATE_LIMITED")
        );
        assert_eq!(
            refusal(StatusCode::MOVED_PERMANENTLY),
            Some("SOURCE_INVALID")
        );
    }
}
