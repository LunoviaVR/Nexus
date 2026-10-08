//! Thin VRChat REST client: cookie handling, request pacing and 429 backoff.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;
use reqwest::{header, Method, StatusCode};
use serde_json::Value;

use crate::error::{Error, Result};

pub const API_BASE: &str = "https://api.vrchat.cloud/api/1";
// VRChat asks third-party apps to identify themselves with a descriptive User-Agent.
/// VRChat asks API clients to identify themselves with a name, version and contact.
pub const USER_AGENT: &str = concat!("Nexus/", env!("CARGO_PKG_VERSION"), " (+https://github.com/LunoviaVR/Nexus)");
const MIN_INTERVAL: Duration = Duration::from_millis(350);
/// Longest we'll wait inside one request for a rate limit to lift; past that we report it instead.
const ACTION_MAX_WAIT: Duration = Duration::from_secs(20);
const BACKGROUND_MAX_WAIT: Duration = Duration::from_secs(120);

pub struct Api {
    http: reqwest::Client,
    cookies: Mutex<HashMap<String, String>>,
    gate: tokio::sync::Mutex<Instant>,
    /// After a 429, nothing is sent until this passes, so background traffic can't extend the limit.
    cooldown_until: Mutex<Option<Instant>>,
    /// Things you clicked (invites, boops, requests) waiting to be sent; background reads give way to them.
    actions_waiting: AtomicUsize,
}

impl Api {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("http client");
        Self {
            http,
            cookies: Mutex::new(HashMap::new()),
            gate: tokio::sync::Mutex::new(Instant::now() - MIN_INTERVAL),
            cooldown_until: Mutex::new(None),
            actions_waiting: AtomicUsize::new(0),
        }
    }

    pub fn cookies(&self) -> HashMap<String, String> {
        self.cookies.lock().clone()
    }

    pub fn set_cookies(&self, cookies: HashMap<String, String>) {
        *self.cookies.lock() = cookies;
    }

    pub fn clear_cookies(&self) {
        self.cookies.lock().clear();
    }

    pub fn auth_token(&self) -> Option<String> {
        self.cookies.lock().get("auth").cloned()
    }

    fn cookie_header(&self) -> String {
        self.cookies
            .lock()
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ")
    }

    fn store_cookies(&self, headers: &header::HeaderMap) {
        let mut jar = self.cookies.lock();
        for raw in headers.get_all(header::SET_COOKIE) {
            let Ok(raw) = raw.to_str() else { continue };
            let mut parts = raw.split(';');
            let Some((name, value)) = parts.next().and_then(|p| p.split_once('=')) else {
                continue;
            };
            let expired = parts.any(|p| {
                let p = p.trim().to_ascii_lowercase();
                p == "max-age=0" || p.starts_with("expires=thu, 01 jan 1970")
            });
            if value.is_empty() || expired {
                jar.remove(name.trim());
            } else {
                jar.insert(name.trim().to_string(), value.trim().to_string());
            }
        }
    }

    async fn throttle(&self, action: bool) {
        // Background reads step aside while something you clicked is waiting to go out.
        if !action {
            while self.actions_waiting.load(Ordering::Acquire) > 0 {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
        let mut last = self.gate.lock().await;
        let cooldown = *self.cooldown_until.lock();
        if let Some(until) = cooldown {
            let now = Instant::now();
            if until > now {
                tokio::time::sleep(until - now).await;
            }
        }
        let elapsed = last.elapsed();
        if elapsed < MIN_INTERVAL {
            tokio::time::sleep(MIN_INTERVAL - elapsed).await;
        }
        *last = Instant::now();
    }

    /// Pause all requests for `wait`, keeping any longer pause already in place.
    fn cool_down(&self, wait: Duration) {
        let until = Instant::now() + wait;
        let mut c = self.cooldown_until.lock();
        if c.is_none_or(|t| t < until) {
            *c = Some(until);
        }
    }

    pub async fn send(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
        basic: Option<&str>,
    ) -> Result<Value> {
        let url = format!("{API_BASE}/{}", path.trim_start_matches('/'));
        // Anything that changes something (invite, boop, request…) is something you clicked.
        let action = method != Method::GET;
        if action {
            self.actions_waiting.fetch_add(1, Ordering::AcqRel);
        }
        let result = self.send_inner(&method, &url, query, body, basic, action).await;
        if action {
            self.actions_waiting.fetch_sub(1, Ordering::AcqRel);
        }
        result
    }

    async fn send_inner(
        &self,
        method: &Method,
        url: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
        basic: Option<&str>,
        action: bool,
    ) -> Result<Value> {
        let max_wait = if action { ACTION_MAX_WAIT } else { BACKGROUND_MAX_WAIT };
        let mut waited = Duration::ZERO;
        let mut attempt = 0u32;
        loop {
            self.throttle(action).await;
            let mut req = self.http.request(method.clone(), url).query(query);
            let cookie = self.cookie_header();
            if !cookie.is_empty() {
                req = req.header(header::COOKIE, cookie);
            }
            if let Some(b) = basic {
                req = req.header(header::AUTHORIZATION, format!("Basic {b}"));
            }
            if let Some(b) = body {
                req = req.json(b);
            }
            let res = req.send().await?;
            self.store_cookies(res.headers());
            let status = res.status();
            if status == StatusCode::TOO_MANY_REQUESTS {
                attempt += 1;
                let wait = retry_after(res.headers()).unwrap_or_else(|| backoff(attempt));
                self.cool_down(wait);
                if attempt <= 3 && waited + wait <= max_wait {
                    waited += wait;
                    continue; // throttle() sleeps out the cooldown before the retry
                }
                return Err(Error::Api { status: 429, message: rate_limited_message(wait) });
            }
            let text = res.text().await?;
            let json = if text.is_empty() {
                Value::Null
            } else {
                serde_json::from_str(&text).unwrap_or(Value::String(text))
            };
            if !status.is_success() {
                let message = json
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .map(|m| m.trim_matches('"').to_string())
                    .unwrap_or_else(|| format!("Request failed ({status})"));
                return Err(Error::Api { status: status.as_u16(), message });
            }
            return Ok(json);
        }
    }

    pub async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        self.send(Method::GET, path, query, None, None).await
    }

    pub async fn post(&self, path: &str, body: &Value) -> Result<Value> {
        self.send(Method::POST, path, &[], Some(body), None).await
    }

    pub async fn put(&self, path: &str, body: &Value) -> Result<Value> {
        self.send(Method::PUT, path, &[], Some(body), None).await
    }

    pub async fn delete(&self, path: &str) -> Result<Value> {
        self.send(Method::DELETE, path, &[], None, None).await
    }

    /// Multipart upload (icons/gallery images). Paced like other API calls.
    pub async fn upload(
        &self,
        path: &str,
        file_field: &str,
        bytes: Vec<u8>,
        fields: &[(&str, String)],
    ) -> Result<Value> {
        self.throttle(true).await;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("image.png")
            .mime_str("image/png")
            .map_err(|e| Error::Other(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new().part(file_field.to_string(), part);
        for (k, v) in fields {
            form = form.text(k.to_string(), v.clone());
        }
        let url = format!("{API_BASE}/{}", path.trim_start_matches('/'));
        let res = self.http.post(url).header(header::COOKIE, self.cookie_header()).multipart(form).send().await?;
        self.store_cookies(res.headers());
        let status = res.status();
        let json: Value = res.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let message = json
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(|m| m.trim_matches('"').to_string())
                .unwrap_or_else(|| format!("Upload failed ({status})"));
            return Err(Error::Api { status: status.as_u16(), message });
        }
        Ok(json)
    }

    /// Download an image with the session cookie (VRChat's file endpoints require auth).
    /// Not paced: these are file downloads, not API calls. The cookie is dropped on the
    /// cross-host redirect to the CDN.
    pub async fn fetch_bytes(&self, url: &str) -> Result<(Option<String>, Vec<u8>)> {
        let mut req = self.http.get(url);
        let cookie = self.cookie_header();
        if !cookie.is_empty() {
            req = req.header(header::COOKIE, cookie);
        }
        let res = req.send().await?;
        let status = res.status();
        if !status.is_success() {
            return Err(Error::Api { status: status.as_u16(), message: format!("Image request failed ({status})") });
        }
        let ct = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(String::from);
        Ok((ct, res.bytes().await?.to_vec()))
    }

    /// `GET /auth/user` with Basic credentials (each part URL-encoded, as VRChat expects).
    pub async fn login(&self, username: &str, password: &str) -> Result<Value> {
        let raw = format!("{}:{}", urlencoding::encode(username), urlencoding::encode(password));
        let basic = base64::engine::general_purpose::STANDARD.encode(raw);
        self.send(Method::GET, "auth/user", &[], None, Some(&basic)).await
    }

    /// Page through `/auth/user/friends`.
    pub async fn fetch_friends(&self, offline: bool) -> Result<Vec<Value>> {
        let mut out = Vec::new();
        let mut offset = 0usize;
        loop {
            let page = self
                .get(
                    "auth/user/friends",
                    &[("offline", offline.to_string()), ("n", "100".into()), ("offset", offset.to_string())],
                )
                .await?;
            let items = page.as_array().cloned().unwrap_or_default();
            let len = items.len();
            out.extend(items);
            if len < 100 || offset > 10_000 {
                break;
            }
            offset += 100;
        }
        Ok(out)
    }
}

/// VRChat's `Retry-After`, in seconds, kept within sane bounds.
fn retry_after(headers: &header::HeaderMap) -> Option<Duration> {
    let secs: u64 = headers.get(header::RETRY_AFTER)?.to_str().ok()?.trim().parse().ok()?;
    Some(Duration::from_secs(secs.clamp(1, 300)))
}

/// Without a `Retry-After`: 5s, 10s, 20s…
fn backoff(attempt: u32) -> Duration {
    Duration::from_secs(5 * 2u64.pow(attempt.saturating_sub(1).min(5)))
}

fn rate_limited_message(wait: Duration) -> String {
    let secs = wait.as_secs().max(1);
    let when = if secs < 60 { format!("{secs} seconds") } else { format!("{} minutes", secs.div_ceil(60)) };
    format!("VRChat is limiting how fast you can do this right now. Try again in about {when}.")
}

#[cfg(test)]
mod rate_limit_tests {
    use super::*;

    #[test]
    fn honours_retry_after_and_backs_off_without_it() {
        let mut h = header::HeaderMap::new();
        h.insert(header::RETRY_AFTER, "12".parse().unwrap());
        assert_eq!(retry_after(&h), Some(Duration::from_secs(12)));
        assert_eq!(retry_after(&header::HeaderMap::new()), None);
        assert_eq!((backoff(1), backoff(2), backoff(3)), (Duration::from_secs(5), Duration::from_secs(10), Duration::from_secs(20)));
    }

    #[test]
    fn explains_the_limit_in_words() {
        assert!(rate_limited_message(Duration::from_secs(30)).contains("about 30 seconds"));
        assert!(rate_limited_message(Duration::from_secs(90)).contains("about 2 minutes"));
    }
}
