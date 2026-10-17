//! Shared plumbing for the native network commands: only the main window may
//! call them, one request runs at a time per site and can be cancelled by its
//! request ID, and requests to one site are spaced by a minimum gap.

use std::{
    future::Future,
    sync::Mutex,
    time::{Duration, Instant},
};

use futures_util::future::{AbortHandle, Abortable};
use tauri::WebviewWindow;

/// Refuses calls from any window but `main` (such as a remote source window).
pub fn require_main(window: &WebviewWindow, denied: &'static str) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(denied.into())
    }
}

/// At most one request in flight, cancellable by its request ID.
#[derive(Default)]
pub struct SingleRequest {
    active: Mutex<Option<(String, AbortHandle)>>,
}

impl SingleRequest {
    /// Runs `work` as the request `request_id`; `SOURCE_BUSY` while another
    /// runs, `SOURCE_CANCELLED` when [`Self::cancel`] stopped it.
    pub async fn run<T>(
        &self,
        request_id: &str,
        work: impl Future<Output = Result<T, &'static str>>,
    ) -> Result<T, String> {
        if request_id.is_empty() || request_id.len() > 80 {
            return Err("SOURCE_INVALID".into());
        }
        let registration = {
            let mut active = self.active.lock().unwrap();
            if active.is_some() {
                return Err("SOURCE_BUSY".into());
            }
            let (handle, registration) = AbortHandle::new_pair();
            *active = Some((request_id.to_string(), handle));
            registration
        };
        let result = Abortable::new(work, registration).await;
        let mut active = self.active.lock().unwrap();
        if active.as_ref().is_some_and(|(id, _)| id == request_id) {
            active.take();
        }
        result
            .map_err(|_| "SOURCE_CANCELLED".to_string())?
            .map_err(str::to_string)
    }

    /// Aborts the running request if it is `request_id`; other IDs are ignored.
    pub fn cancel(&self, request_id: &str) {
        let mut active = self.active.lock().unwrap();
        if active.as_ref().is_some_and(|(id, _)| id == request_id) {
            if let Some((_, handle)) = active.take() {
                handle.abort();
            }
        }
    }
}

/// Spaces requests: each starts at least `gap` after the previous finished.
pub struct Pacer {
    gap: Duration,
    last_finished: tokio::sync::Mutex<Option<Instant>>,
}

impl Pacer {
    pub fn new(gap: Duration) -> Self {
        Self {
            gap,
            last_finished: tokio::sync::Mutex::new(None),
        }
    }

    /// Waits out the gap, then runs `work`; requests queue behind each other.
    pub async fn run<T>(&self, work: impl Future<Output = T>) -> T {
        let mut last = self.last_finished.lock().await;
        if let Some(finished) = *last {
            let elapsed = finished.elapsed();
            if elapsed < self.gap {
                tokio::time::sleep(self.gap - elapsed).await;
            }
        }
        let result = work.await;
        *last = Some(Instant::now());
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn runs_one_request_and_cancels_it_by_id() {
        let requests = std::sync::Arc::new(SingleRequest::default());
        assert_eq!(
            requests.run("", async { Ok::<_, &str>(1) }).await,
            Err("SOURCE_INVALID".into())
        );
        let (release, wait) = tokio::sync::oneshot::channel::<()>();
        let running = {
            let requests = requests.clone();
            tokio::spawn(async move {
                requests
                    .run("first", async {
                        wait.await.ok();
                        Ok::<_, &str>(1)
                    })
                    .await
            })
        };
        tokio::task::yield_now().await;
        assert_eq!(
            requests.run("second", async { Ok::<_, &str>(2) }).await,
            Err("SOURCE_BUSY".into())
        );
        requests.cancel("other");
        requests.cancel("first");
        assert_eq!(running.await.unwrap(), Err("SOURCE_CANCELLED".into()));
        drop(release);
        assert_eq!(
            requests
                .run("third", async { Err::<i32, _>("SOURCE_TIMEOUT") })
                .await,
            Err("SOURCE_TIMEOUT".into())
        );
    }

    #[tokio::test]
    async fn spaces_requests_by_the_gap() {
        let pacer = Pacer::new(Duration::from_millis(60));
        pacer.run(async {}).await;
        let started = Instant::now();
        pacer.run(async {}).await;
        assert!(started.elapsed() >= Duration::from_millis(55));
    }
}
