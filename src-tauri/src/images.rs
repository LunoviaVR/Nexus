//! `nximg://` protocol: serves VRChat images through the backend so they carry the session
//! cookie, with a permanent on-disk cache (VRChat file URLs are versioned and immutable).
//! Cached files are encrypted and named by a keyed hash (see `vault`), so the cache doesn't
//! reveal whose pictures or which worlds you've looked at.
//! The webview requests `http://nximg.localhost/?u=<encoded url>`.

use std::sync::LazyLock;

use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, UriSchemeResponder, Wry};

use crate::state::AppState;

static SLOTS: LazyLock<tokio::sync::Semaphore> = LazyLock::new(|| tokio::sync::Semaphore::new(6));

/// Images that just failed, and when they may be tried again. Without this, every re-render of a
/// card asks again, which is exactly what keeps an account rate limited.
static FAILED: LazyLock<parking_lot::Mutex<std::collections::HashMap<String, std::time::Instant>>> = LazyLock::new(Default::default);

fn retry_later(status: u16) -> std::time::Duration {
    std::time::Duration::from_secs(match status {
        429 => 60,
        404 | 403 | 401 => 30 * 60,
        _ => 5 * 60,
    })
}

const ALLOWED_HOSTS: [&str; 4] = ["api.vrchat.cloud", "assets.vrchat.com", "files.vrchat.cloud", "vrchat.com"];

fn sniff(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "application/octet-stream",
    }
}

fn target_url(query: &str) -> Option<String> {
    let raw = query.split('&').find_map(|kv| kv.strip_prefix("u="))?;
    let url = urlencoding::decode(raw).ok()?.into_owned();
    let host = url.strip_prefix("https://")?.split('/').next()?;
    ALLOWED_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))).then_some(url)
}

const CACHE_DIR: &str = "images-enc";

/// Older versions cached images unencrypted in `images`; remove that folder.
pub fn forget_plain_cache(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_cache_dir() {
        let old = dir.join("images");
        if old.is_dir() {
            std::thread::spawn(move || {
                let _ = std::fs::remove_dir_all(old);
            });
        }
    }
}

pub fn handle(ctx: UriSchemeContext<'_, Wry>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let query = req.uri().query().unwrap_or("").to_string();
    tauri::async_runtime::spawn(async move {
        let reply = |status: StatusCode, ct: &str, body: Vec<u8>| {
            Response::builder()
                .status(status)
                .header("Content-Type", ct)
                // Only successes may be cached; a failure (often a temporary 429) must be retried later.
                .header("Cache-Control", if status.is_success() { "public, max-age=604800, immutable" } else { "no-store" })
                .header("Access-Control-Allow-Origin", "*")
                .body(body)
                .unwrap()
        };
        let Some(url) = target_url(&query) else {
            return responder.respond(reply(StatusCode::BAD_REQUEST, "text/plain", vec![]));
        };

        let dir = app.path().app_cache_dir().ok().map(|d| d.join(CACHE_DIR));
        let file = dir.as_ref().zip(crate::vault::image_name(&url)).map(|(d, name)| d.join(name));
        if let Some(bytes) = file.as_ref().and_then(|f| std::fs::read(f).ok()).and_then(|b| crate::vault::open(&b)) {
            return responder.respond(reply(StatusCode::OK, sniff(&bytes), bytes));
        }

        if let Some(until) = FAILED.lock().get(&url).copied() {
            if until > std::time::Instant::now() {
                return responder.respond(reply(StatusCode::SERVICE_UNAVAILABLE, "text/plain", vec![]));
            }
        }

        let _slot = SLOTS.acquire().await;
        match app.state::<AppState>().api.fetch_bytes(&url).await {
            Ok((ct, bytes)) => {
                if let (Some(dir), Some(file), Some(sealed)) = (&dir, &file, crate::vault::seal(&bytes)) {
                    let _ = std::fs::create_dir_all(dir);
                    let _ = std::fs::write(file, sealed);
                }
                let ct = ct.filter(|c| c.starts_with("image/")).unwrap_or_else(|| sniff(&bytes).to_string());
                responder.respond(reply(StatusCode::OK, &ct, bytes));
            }
            Err(e) => {
                if let Some(code) = e.status() {
                    let mut failed = FAILED.lock();
                    failed.retain(|_, until| *until > std::time::Instant::now());
                    failed.insert(url.clone(), std::time::Instant::now() + retry_later(code));
                }
                let status = e.status().and_then(|s| StatusCode::from_u16(s).ok()).unwrap_or(StatusCode::BAD_GATEWAY);
                responder.respond(reply(status, "text/plain", vec![]));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_allows_vrchat_hosts() {
        let ok = format!("u={}", urlencoding::encode("https://api.vrchat.cloud/api/1/image/file_x/1/256"));
        assert_eq!(target_url(&ok).as_deref(), Some("https://api.vrchat.cloud/api/1/image/file_x/1/256"));
        let bad = format!("u={}", urlencoding::encode("https://evil.example/api.vrchat.cloud"));
        assert!(target_url(&bad).is_none());
        let http = format!("u={}", urlencoding::encode("http://api.vrchat.cloud/x"));
        assert!(target_url(&http).is_none());
    }
}
