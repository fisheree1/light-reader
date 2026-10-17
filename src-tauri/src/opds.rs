//! Native requests for OPDS catalogs the user added.
//!
//! A catalog is trusted to the extent the user chose it: requests to its own
//! origin may reach a LAN address (a self-hosted Calibre-Web, Kavita or Komga).
//! Links a feed points elsewhere are untrusted: they must be HTTPS and resolve
//! only to public addresses, which are pinned for the connection. Every
//! redirect hop is checked again.

use std::{collections::HashMap, net::ToSocketAddrs, sync::Mutex, time::Duration};

use futures_util::{
    future::{AbortHandle, Abortable},
    StreamExt,
};
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::catalog::public_ip;

const MAX_FEED: usize = 5 * 1024 * 1024;
const MAX_IMAGE: usize = 5 * 1024 * 1024;
const MAX_BOOK: usize = 200 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadKind {
    Image,
    Book,
}

#[derive(Debug, PartialEq)]
enum Scope {
    /// The catalog's own origin, as the user entered it.
    Catalog,
    /// Any other origin: HTTPS to public addresses only.
    Public,
}

#[derive(Serialize)]
pub struct FeedResponse {
    url: String,
    text: String,
}

#[derive(Default)]
pub struct OpdsState {
    requests: Mutex<HashMap<String, AbortHandle>>,
}

impl OpdsState {
    pub fn new() -> Self {
        Self::default()
    }
}

fn plain_http_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn scope(catalog: &Url, url: &Url) -> Result<Scope, &'static str> {
    if !plain_http_url(catalog) || !plain_http_url(url) {
        return Err("OPDS_INVALID_URL");
    }
    if same_origin(catalog, url) {
        Ok(Scope::Catalog)
    } else if url.scheme() == "https" {
        Ok(Scope::Public)
    } else {
        Err("OPDS_INVALID_URL")
    }
}

async fn client_for(url: &Url, scope: &Scope, total: Duration) -> Result<Client, &'static str> {
    let builder = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .timeout(total)
        .user_agent("LightReader/0.1 (OPDS)");
    if *scope == Scope::Catalog {
        return builder.build().map_err(|_| "OPDS_UNREACHABLE");
    }
    let host = url.host_str().ok_or("OPDS_INVALID_URL")?.to_string();
    let port = url.port_or_known_default().ok_or("OPDS_INVALID_URL")?;
    let lookup_host = host.clone();
    let lookup = tauri::async_runtime::spawn_blocking(move || {
        (lookup_host.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| addresses.take(16).collect::<Vec<_>>())
    });
    let addresses = tokio::time::timeout(Duration::from_secs(5), lookup)
        .await
        .map_err(|_| "OPDS_UNREACHABLE")?
        .map_err(|_| "OPDS_UNREACHABLE")?
        .map_err(|_| "OPDS_UNREACHABLE")?;
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err("OPDS_INVALID_URL");
    }
    builder
        .no_proxy()
        .resolve_to_addrs(&host, &addresses)
        .build()
        .map_err(|_| "OPDS_UNREACHABLE")
}

fn status_code(status: reqwest::StatusCode) -> Option<&'static str> {
    match status.as_u16() {
        401 => Some("OPDS_AUTH_REQUIRED"),
        403 => Some("SOURCE_ACCESS_DENIED"),
        404 | 410 => Some("OPDS_NOT_FOUND"),
        429 => Some("SOURCE_RATE_LIMITED"),
        _ if status.is_success() => None,
        _ => Some("OPDS_UNREACHABLE"),
    }
}

fn feed_content_type(value: Option<&str>) -> bool {
    // Servers label feeds loosely; anything XML-ish is parsed and validated
    // by the app, while an HTML page (often a login form) is refused here.
    match value {
        None => true,
        Some(value) => {
            let value = value.to_ascii_lowercase();
            value.contains("xml") || value.contains("atom") || value.starts_with("text/plain")
        }
    }
}

/// Follows redirects by hand, checking every hop, and reads a bounded body.
async fn fetch(
    catalog: &Url,
    mut url: Url,
    limit: usize,
    total: Duration,
    feed: bool,
) -> Result<(Url, Vec<u8>), &'static str> {
    for _ in 0..=MAX_REDIRECTS {
        let hop_scope = scope(catalog, &url)?;
        let response = client_for(&url, &hop_scope, total)
            .await?
            .get(url.clone())
            .header(
                "Accept",
                if feed {
                    "application/atom+xml, application/opensearchdescription+xml, application/xml;q=0.9, */*;q=0.5"
                } else {
                    "*/*"
                },
            )
            .send()
            .await
            .map_err(|_| "OPDS_UNREACHABLE")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or("OPDS_UNREACHABLE")?;
            url = url.join(location).map_err(|_| "OPDS_INVALID_URL")?;
            continue;
        }
        if let Some(code) = status_code(response.status()) {
            return Err(code);
        }
        if feed
            && !feed_content_type(
                response
                    .headers()
                    .get("content-type")
                    .and_then(|value| value.to_str().ok()),
            )
        {
            return Err("OPDS_NOT_FEED");
        }
        if response
            .content_length()
            .is_some_and(|size| size > limit as u64)
        {
            return Err("OPDS_TOO_LARGE");
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "OPDS_UNREACHABLE")?;
            if bytes.len() + chunk.len() > limit {
                return Err("OPDS_TOO_LARGE");
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok((url, bytes));
    }
    Err("OPDS_UNREACHABLE")
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("SOURCE_UNAVAILABLE".into())
    }
}

fn parse_request(request_id: &str, catalog: &str, url: &str) -> Result<(Url, Url), String> {
    if request_id.is_empty() || request_id.len() > 80 || catalog.len() > 2048 || url.len() > 4096 {
        return Err("OPDS_INVALID_URL".into());
    }
    let catalog = Url::parse(catalog).map_err(|_| "OPDS_INVALID_URL")?;
    let url = Url::parse(url).map_err(|_| "OPDS_INVALID_URL")?;
    scope(&catalog, &url)?;
    Ok((catalog, url))
}

async fn run<T>(
    state: &OpdsState,
    request_id: String,
    work: impl std::future::Future<Output = Result<T, &'static str>>,
) -> Result<T, String> {
    let registration = {
        let mut requests = state.requests.lock().unwrap();
        if requests.len() >= 4 || requests.contains_key(&request_id) {
            return Err("SOURCE_BUSY".into());
        }
        let (handle, registration) = AbortHandle::new_pair();
        requests.insert(request_id.clone(), handle);
        registration
    };
    let result = Abortable::new(work, registration).await;
    state.requests.lock().unwrap().remove(&request_id);
    result
        .map_err(|_| "SOURCE_CANCELLED".to_string())?
        .map_err(str::to_string)
}

#[tauri::command]
pub async fn opds_read_feed(
    window: WebviewWindow,
    state: State<'_, OpdsState>,
    request_id: String,
    catalog_url: String,
    url: String,
) -> Result<FeedResponse, String> {
    main_only(&window)?;
    let (catalog, url) = parse_request(&request_id, &catalog_url, &url)?;
    let (url, bytes) = run(
        &state,
        request_id,
        fetch(&catalog, url, MAX_FEED, Duration::from_secs(45), true),
    )
    .await?;
    let text = String::from_utf8(bytes).map_err(|_| "OPDS_NOT_FEED")?;
    Ok(FeedResponse {
        url: url.to_string(),
        text,
    })
}

#[tauri::command]
pub async fn opds_download(
    window: WebviewWindow,
    state: State<'_, OpdsState>,
    request_id: String,
    catalog_url: String,
    url: String,
    kind: DownloadKind,
) -> Result<tauri::ipc::Response, String> {
    main_only(&window)?;
    let (catalog, url) = parse_request(&request_id, &catalog_url, &url)?;
    let (limit, total) = match kind {
        DownloadKind::Image => (MAX_IMAGE, Duration::from_secs(45)),
        DownloadKind::Book => (MAX_BOOK, Duration::from_secs(15 * 60)),
    };
    let (_, bytes) = run(
        &state,
        request_id,
        fetch(&catalog, url, limit, total, false),
    )
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn opds_cancel(
    window: WebviewWindow,
    state: State<'_, OpdsState>,
    request_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    if let Some(handle) = state.requests.lock().unwrap().remove(&request_id) {
        handle.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn trusts_the_catalog_origin_and_limits_other_links() {
        let lan = url("http://192.168.1.20:8083/opds");
        assert_eq!(
            scope(&lan, &url("http://192.168.1.20:8083/opds/new")),
            Ok(Scope::Catalog)
        );
        assert_eq!(
            scope(&lan, &url("https://cdn.example.org/book.epub")),
            Ok(Scope::Public)
        );
        // Another port or scheme on the same host is a different origin.
        assert_eq!(
            scope(&lan, &url("http://192.168.1.20:22/")),
            Err("OPDS_INVALID_URL")
        );
        assert_eq!(
            scope(
                &url("https://books.example.org/opds"),
                &url("https://books.example.org:443/a")
            ),
            Ok(Scope::Catalog)
        );
        for bad in [
            "file:///etc/passwd",
            "ftp://example.org/a.epub",
            "https://user:secret@example.org/a.epub",
            "http://example.org/a.epub",
        ] {
            assert_eq!(scope(&lan, &url(bad)), Err("OPDS_INVALID_URL"), "{bad}");
        }
        assert_eq!(
            scope(
                &url("https://user:pw@example.org/opds"),
                &url("https://example.org/opds")
            ),
            Err("OPDS_INVALID_URL")
        );
    }

    #[tokio::test]
    async fn refuses_private_addresses_for_links_outside_the_catalog() {
        let error = client_for(
            &url("https://127.0.0.1/book.epub"),
            &Scope::Public,
            Duration::from_secs(5),
        )
        .await
        .err();
        assert_eq!(error, Some("OPDS_INVALID_URL"));
    }

    #[test]
    fn maps_statuses_and_rejects_html_feeds() {
        use reqwest::StatusCode;
        assert_eq!(status_code(StatusCode::OK), None);
        assert_eq!(
            status_code(StatusCode::UNAUTHORIZED),
            Some("OPDS_AUTH_REQUIRED")
        );
        assert_eq!(
            status_code(StatusCode::FORBIDDEN),
            Some("SOURCE_ACCESS_DENIED")
        );
        assert_eq!(status_code(StatusCode::NOT_FOUND), Some("OPDS_NOT_FOUND"));
        assert_eq!(
            status_code(StatusCode::TOO_MANY_REQUESTS),
            Some("SOURCE_RATE_LIMITED")
        );
        assert_eq!(
            status_code(StatusCode::BAD_GATEWAY),
            Some("OPDS_UNREACHABLE")
        );
        assert!(feed_content_type(Some(
            "application/atom+xml;profile=opds-catalog"
        )));
        assert!(feed_content_type(Some(
            "application/opensearchdescription+xml"
        )));
        assert!(feed_content_type(None));
        assert!(!feed_content_type(Some("text/html; charset=utf-8")));
    }

    #[test]
    fn validates_request_arguments() {
        assert!(parse_request("", "https://a.org/", "https://a.org/").is_err());
        assert!(parse_request("id", "not a url", "https://a.org/").is_err());
        assert!(parse_request("id", "https://a.org/opds", "https://a.org/x").is_ok());
    }
}
