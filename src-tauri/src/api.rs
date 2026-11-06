//! Thin VRChat REST client: cookie handling and rate limiting (see `ratelimit`).
//!
//! Requests aren't paced. At most `MAX_CONNECTIONS` are in flight at once, and jobs that make
//! many requests in a row are paced by their own limiter and retry a 429 with a backoff.
//! Anything else that gets a 429 reports it. Either way the UI is told it's being rate limited.
//!
//! On top of that, requests that can't do any good aren't sent at all:
//! - a read that's already on its way (asked for less than `MERGE_FOR` ago) is shared;
//! - a read VRChat answered with "not found" or "forbidden" isn't asked again for 15 minutes;
//! - once the session has expired nothing else goes out until it's restored.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;
use reqwest::{header, Method, StatusCode};
use serde_json::Value;
use tokio::sync::Semaphore;

use crate::error::{Error, Result};
use crate::ratelimit;

pub const API_BASE: &str = "https://api.vrchat.cloud/api/1";
/// VRChat asks API clients to identify themselves with a name, version and contact.
pub const USER_AGENT: &str = concat!("Nexus/", env!("CARGO_PKG_VERSION"), " (+https://github.com/LunoviaVR/Nexus)");

/// Requests to the API in flight at once.
const MAX_CONNECTIONS: usize = 10;

/// How long a read on its way is shared with anyone asking for the same thing.
const MERGE_FOR: Duration = Duration::from_secs(10);

/// How long a read that came back 403/404 is answered from memory instead of asked again.
const FAILED_FOR: Duration = Duration::from_secs(15 * 60);

/// VRChat won't page `/auth/user/friends` past this offset.
const FRIENDS_MAX_OFFSET: usize = 7_500;
/// The friends list is fetched in pages of 50, five at a time.
const FRIENDS_PAGE: usize = 50;

const SESSION_EXPIRED: &str = "Your VRChat session expired. Please sign in again.";
/// The UI recognises this exact text (`src/lib/toast.tsx`), so keep the two in step.
const RATE_LIMITED: &str = "VRChat is limiting how fast you can do this right now. Try again in a moment.";

/// The UI hears about rate limiting at most this often (sooner if it gets worse).
const REPORT_LIMITED_EVERY: Duration = Duration::from_secs(2);

fn rate_limited() -> Error {
    Error::Api { status: 429, message: RATE_LIMITED.into() }
}

/// A finished read, in a form every caller sharing it can have a copy of.
type SharedResult = std::result::Result<Value, (Option<u16>, String)>;

/// The path a read is remembered under: no leading slash, no query.
fn failed_key(path: &str) -> &str {
    let path = path.trim_start_matches('/');
    path.split_once('?').map_or(path, |(p, _)| p)
}

/// Reads that are worth not repeating: things that don't exist or that you can't see.
/// Your own account's endpoints are always asked fresh, and so is a missing avatar.
fn should_remember(status: u16, path: &str) -> bool {
    let key = failed_key(path);
    match status {
        404 if key.starts_with("avatars/") => false,
        403 | 404 => !key.starts_with("auth/user"),
        _ => false,
    }
}

/// Identical reads (same path and query, in any order) share a request.
fn dedup_key(path: &str, query: &[(&str, String)]) -> String {
    let mut q: Vec<String> = query.iter().map(|(k, v)| format!("{k}={v}")).collect();
    q.sort();
    format!("{}|{}", path.trim_start_matches('/'), q.join("&"))
}

/// A read on its way: when it was sent, and its result once it's in.
type Inflight = (Instant, Arc<tokio::sync::OnceCell<SharedResult>>);

/// A 401 here means the session cookie is no longer accepted. Sign-in checks handle their own.
fn is_session_loss(path: &str, basic: bool) -> bool {
    let key = failed_key(path);
    !basic && key != "auth/user" && !key.starts_with("auth/twofactorauth")
}

/// Requests that may still go out once the session has expired: the ones that restore it.
fn allowed_while_expired(path: &str, basic: bool) -> bool {
    let key = failed_key(path);
    basic || key == "auth/user" || key.starts_with("auth/twofactorauth")
}

pub struct Api {
    http: reqwest::Client,
    cookies: Mutex<HashMap<String, String>>,
    /// Free slots for requests to the API.
    conns: Semaphore,
    /// Reads in progress, shared by everyone asking for the same thing.
    inflight: Mutex<HashMap<String, Inflight>>,
    /// Reads that came back 403/404: when, and what VRChat said.
    failed: Mutex<HashMap<String, (Instant, u16, String)>>,
    /// Set by the first 401 and cleared when the session is restored.
    expired: AtomicBool,
    /// Called once when the session is found to have expired.
    on_expired: OnceLock<Box<dyn Fn() + Send + Sync>>,
    /// Called when VRChat rate limits a request: `true` if it will be retried by itself.
    on_rate_limited: OnceLock<Box<dyn Fn(bool) + Send + Sync>>,
    /// The last rate limit reported to the UI, and whether it was being retried.
    limited_at: Mutex<Option<(Instant, bool)>>,
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
            conns: Semaphore::new(MAX_CONNECTIONS),
            inflight: Mutex::new(HashMap::new()),
            failed: Mutex::new(HashMap::new()),
            expired: AtomicBool::new(false),
            on_expired: OnceLock::new(),
            on_rate_limited: OnceLock::new(),
            limited_at: Mutex::new(None),
        }
    }

    /// What to do when a request reveals the session has expired (only the first one counts).
    pub fn set_on_expired(&self, f: impl Fn() + Send + Sync + 'static) {
        let _ = self.on_expired.set(Box::new(f));
    }

    /// What to do when VRChat rate limits a request (`true` if it will be retried by itself).
    pub fn set_on_rate_limited(&self, f: impl Fn(bool) + Send + Sync + 'static) {
        let _ = self.on_rate_limited.set(Box::new(f));
    }

    /// Tell the UI about a 429. A burst of them is reported once, but one that won't be retried
    /// is reported straight after ones that will, since that's something the user has to wait out.
    fn report_limited(&self, retrying: bool) {
        let now = Instant::now();
        {
            let mut last = self.limited_at.lock();
            if let Some((at, was_retrying)) = *last {
                let recent = now.saturating_duration_since(at) < REPORT_LIMITED_EVERY;
                if recent && (retrying || !was_retrying) {
                    return;
                }
            }
            *last = Some((now, retrying));
        }
        if let Some(f) = self.on_rate_limited.get() {
            f(retrying);
        }
    }

    /// Let requests go out again after the session was found expired.
    pub fn revive(&self) {
        self.expired.store(false, Ordering::SeqCst);
    }

    pub fn session_lost(&self) {
        if !self.expired.swap(true, Ordering::SeqCst) {
            if let Some(f) = self.on_expired.get() {
                f();
            }
        }
    }

    fn recent_failure(&self, path: &str) -> Option<(u16, String)> {
        let mut failed = self.failed.lock();
        let key = failed_key(path);
        match failed.get(key) {
            Some((at, status, message)) if at.elapsed() < FAILED_FOR => Some((*status, message.clone())),
            Some(_) => {
                failed.remove(key);
                None
            }
            None => None,
        }
    }

    fn remember_failure(&self, path: &str, status: u16, message: &str) {
        let mut failed = self.failed.lock();
        failed.retain(|_, (at, _, _)| at.elapsed() < FAILED_FOR);
        failed.insert(failed_key(path).to_string(), (Instant::now(), status, message.to_string()));
    }

    pub fn cookies(&self) -> HashMap<String, String> {
        self.cookies.lock().clone()
    }

    pub fn set_cookies(&self, cookies: HashMap<String, String>) {
        *self.cookies.lock() = cookies;
        self.revive();
    }

    pub fn clear_cookies(&self) {
        self.cookies.lock().clear();
        self.failed.lock().clear();
        self.revive();
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

    pub async fn send(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
        basic: Option<&str>,
    ) -> Result<Value> {
        let url = format!("{API_BASE}/{}", path.trim_start_matches('/'));
        let read = method == Method::GET;
        if self.expired.load(Ordering::SeqCst) && !allowed_while_expired(path, basic.is_some()) {
            return Err(Error::Api { status: 401, message: SESSION_EXPIRED.into() });
        }
        if read && basic.is_none() {
            if let Some((status, message)) = self.recent_failure(path) {
                return Err(Error::Api { status, message });
            }
        }
        // A job's request waits for its limiter once; its 429 retries don't wait again.
        let job = ratelimit::current();
        if let Some(job) = job {
            job.limiter.wait().await;
        }
        let mut limited = 0u32;
        let mut retried = false;
        loop {
            let conn = self.conns.acquire().await.ok();
            let mut req = self.http.request(method.clone(), &url).query(query);
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
            let res = match req.send().await {
                Ok(res) => res,
                // A dropped connection or a timeout on a read is worth one more try.
                Err(e) if read && !retried && (e.is_timeout() || e.is_connect()) => {
                    drop(conn);
                    retried = true;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            self.store_cookies(res.headers());
            let status = res.status();
            if status == StatusCode::TOO_MANY_REQUESTS {
                drop((res, conn));
                // Only a job retries. Nothing was done, so even an action is safe to send again.
                let retry = job.filter(|j| limited < j.retries);
                self.report_limited(retry.is_some());
                if let Some(job) = retry {
                    tokio::time::sleep(job.delay(limited)).await;
                    limited += 1;
                    continue;
                }
                return Err(rate_limited());
            }
            // VRChat's API has the odd hiccup; a read gets one more try.
            if read && !retried && matches!(status.as_u16(), 502..=504) {
                drop((res, conn));
                retried = true;
                tokio::time::sleep(Duration::from_millis(1500)).await;
                continue;
            }
            let text = res.text().await?;
            drop(conn);
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
                let code = status.as_u16();
                if code == 401 && is_session_loss(path, basic.is_some()) {
                    self.session_lost();
                } else if read && basic.is_none() && should_remember(code, path) {
                    self.remember_failure(path, code, &message);
                }
                return Err(Error::Api { status: code, message });
            }
            if failed_key(path) == "auth/user" {
                self.revive();
            }
            if !read {
                // Joining, accepting or unblocking can make a 403/404 answer go stale.
                self.failed.lock().clear();
            }
            return Ok(json);
        }
    }

    /// A read. Asking for something that was asked for less than `MERGE_FOR` ago and hasn't
    /// come back yet waits for that request instead of sending another one. A paced job's reads
    /// are only shared within that job, so what you open never waits behind upkeep.
    pub async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        let job = ratelimit::current().map_or("", |j| j.name);
        let key = format!("{job}|{}", dedup_key(path, query));
        let cell = {
            let mut inflight = self.inflight.lock();
            match inflight.get(&key) {
                Some((at, cell)) if at.elapsed() < MERGE_FOR => cell.clone(),
                _ => {
                    let cell = Arc::new(tokio::sync::OnceCell::new());
                    inflight.insert(key.clone(), (Instant::now(), cell.clone()));
                    cell
                }
            }
        };
        let out = cell
            .get_or_init(|| async {
                self.send(Method::GET, path, query, None, None).await.map_err(|e| (e.status(), e.to_string()))
            })
            .await
            .clone();
        {
            let mut inflight = self.inflight.lock();
            if inflight.get(&key).is_some_and(|(_, c)| Arc::ptr_eq(c, &cell)) {
                inflight.remove(&key);
            }
        }
        out.map_err(|(status, message)| match status {
            Some(status) => Error::Api { status, message },
            None => Error::Other(message),
        })
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

    /// Multipart upload (icons/gallery images). Takes a connection slot like any other request.
    pub async fn upload(
        &self,
        path: &str,
        file_field: &str,
        bytes: Vec<u8>,
        fields: &[(&str, String)],
    ) -> Result<Value> {
        if self.expired.load(Ordering::SeqCst) {
            return Err(Error::Api { status: 401, message: SESSION_EXPIRED.into() });
        }
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("image.png")
            .mime_str("image/png")
            .map_err(|e| Error::Other(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new().part(file_field.to_string(), part);
        for (k, v) in fields {
            form = form.text(k.to_string(), v.clone());
        }
        let url = format!("{API_BASE}/{}", path.trim_start_matches('/'));
        let conn = self.conns.acquire().await.ok();
        let res = self.http.post(url).header(header::COOKIE, self.cookie_header()).multipart(form).send().await?;
        self.store_cookies(res.headers());
        let status = res.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            self.report_limited(false);
            return Err(rate_limited());
        }
        let json: Value = res.json().await.unwrap_or(Value::Null);
        drop(conn);
        if !status.is_success() {
            let message = json
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(|m| m.trim_matches('"').to_string())
                .unwrap_or_else(|| format!("Upload failed ({status})"));
            if status == StatusCode::UNAUTHORIZED {
                self.session_lost();
            }
            return Err(Error::Api { status: status.as_u16(), message });
        }
        self.failed.lock().clear();
        Ok(json)
    }

    /// Download an image with the session cookie (VRChat's file endpoints require auth).
    /// These don't share the API's connection slots (the `nximg` handler keeps its own); inside
    /// a job, one on the API host waits for the job's limiter. The cookie is dropped on the cross-host redirect to the CDN.
    pub async fn fetch_bytes(&self, url: &str) -> Result<(Option<String>, Vec<u8>)> {
        if url.starts_with("https://api.vrchat.cloud/") {
            if let Some(job) = ratelimit::current() {
                job.limiter.wait().await;
            }
        }
        let mut req = self.http.get(url);
        let cookie = self.cookie_header();
        if !cookie.is_empty() {
            req = req.header(header::COOKIE, cookie);
        }
        let res = req.send().await?;
        let status = res.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            // A job tries this again later; a picture on screen just stays blank for now.
            self.report_limited(ratelimit::current().is_some());
            return Err(rate_limited());
        }
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

    /// Page through a list endpoint 100 at a time (VRChat's page cap), up to `max` items.
    pub async fn get_all(&self, path: &str, query: &[(&str, String)], max: usize) -> Result<Vec<Value>> {
        let mut out = Vec::new();
        let mut offset = 0usize;
        loop {
            let mut q = query.to_vec();
            q.extend([("n", "100".to_string()), ("offset", offset.to_string())]);
            let items = self.get(path, &q).await?.as_array().cloned().unwrap_or_default();
            let len = items.len();
            out.extend(items);
            offset += len;
            if len < 100 || offset >= max {
                break;
            }
        }
        Ok(out)
    }

    /// Page through `/auth/user/friends`: five pages of 50 at a time, at most
    /// 60 pages a minute, each page retrying a 429 with a backoff.
    pub async fn fetch_friends(&self, offline: bool) -> Result<Vec<Value>> {
        let next = AtomicUsize::new(0);
        let done = AtomicBool::new(false);
        let worker = || self.friend_pages(offline, &next, &done);
        let (a, b, c, d, e) = tokio::try_join!(worker(), worker(), worker(), worker(), worker())?;
        let mut pages: Vec<(usize, Vec<Value>)> = [a, b, c, d, e].into_iter().flatten().collect();
        pages.sort_by_key(|(offset, _)| *offset);
        Ok(pages.into_iter().flat_map(|(_, items)| items).collect())
    }

    /// One of `fetch_friends`' workers: takes the next page until the list runs out.
    async fn friend_pages(&self, offline: bool, next: &AtomicUsize, done: &AtomicBool) -> Result<Vec<(usize, Vec<Value>)>> {
        let mut pages = Vec::new();
        while !done.load(Ordering::SeqCst) {
            let offset = next.fetch_add(FRIENDS_PAGE, Ordering::SeqCst);
            if offset > FRIENDS_MAX_OFFSET {
                break;
            }
            let query = [("offline", offline.to_string()), ("n", FRIENDS_PAGE.to_string()), ("offset", offset.to_string())];
            let page = ratelimit::run_as(&ratelimit::FRIEND_PAGES, self.get("auth/user/friends", &query)).await?;
            let items = page.as_array().cloned().unwrap_or_default();
            if items.len() < FRIENDS_PAGE {
                done.store(true, Ordering::SeqCst);
            }
            pages.push((offset, items));
        }
        Ok(pages)
    }
}

#[cfg(test)]
mod request_tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn remembers_missing_and_forbidden_reads_but_not_sign_in() {
        assert!(should_remember(404, "worlds/wrld_1"));
        assert!(should_remember(403, "/groups/grp_1?includeRoles=true"));
        assert!(!should_remember(500, "worlds/wrld_1"));
        assert!(!should_remember(429, "worlds/wrld_1"));
        assert!(!should_remember(404, "auth/user/notifications"));
        // A missing avatar is asked about again, a private one isn't.
        assert!(!should_remember(404, "avatars/avtr_1"));
        assert!(should_remember(403, "avatars/avtr_1"));
        assert_eq!(failed_key("/groups/grp_1?includeRoles=true"), "groups/grp_1");
    }

    #[test]
    fn query_order_does_not_split_shared_reads() {
        let a = dedup_key("/users", &[("n", "10".into()), ("search", "x".into())]);
        let b = dedup_key("users", &[("search", "x".into()), ("n", "10".into())]);
        assert_eq!(a, b);
        assert_ne!(a, dedup_key("users", &[("n", "20".into()), ("search", "x".into())]));
    }
    #[test]
    fn a_remembered_failure_expires_and_a_write_or_sign_out_forgets_it() {
        let api = Api::new();
        api.remember_failure("worlds/wrld_1", 404, "World not found");
        assert_eq!(api.recent_failure("/worlds/wrld_1"), Some((404, "World not found".into())));
        assert_eq!(api.recent_failure("worlds/wrld_2"), None);

        let old = Instant::now().checked_sub(FAILED_FOR + Duration::from_secs(1)).unwrap();
        api.failed.lock().insert("worlds/wrld_3".into(), (old, 404, "gone".into()));
        assert_eq!(api.recent_failure("worlds/wrld_3"), None);
        assert!(!api.failed.lock().contains_key("worlds/wrld_3"));

        api.clear_cookies();
        assert_eq!(api.recent_failure("worlds/wrld_1"), None);
    }

    #[test]
    fn only_api_401s_count_as_a_lost_session() {
        assert!(is_session_loss("users/usr_1", false));
        assert!(is_session_loss("auth/user/friends", false));
        assert!(!is_session_loss("auth/user", false));
        assert!(!is_session_loss("auth/twofactorauth/totp/verify", false));
        assert!(!is_session_loss("auth/user", true));
        assert!(allowed_while_expired("auth/user", false));
        assert!(allowed_while_expired("anything", true));
        assert!(!allowed_while_expired("users/usr_1", false));
    }

    #[test]
    fn a_lost_session_is_reported_once_until_restored() {
        let api = Api::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        api.set_on_expired(move || {
            c.fetch_add(1, Ordering::SeqCst);
        });
        api.session_lost();
        api.session_lost();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        api.set_cookies(HashMap::new());
        api.session_lost();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn rate_limits_are_reported_once_per_burst_unless_they_get_worse() {
        let api = Api::new();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        api.set_on_rate_limited(move |retrying| s.lock().push(retrying));
        api.report_limited(true);
        api.report_limited(true);
        // One the user has to wait out is worth saying straight away…
        api.report_limited(false);
        // …and nothing milder replaces it during the same burst.
        api.report_limited(true);
        api.report_limited(false);
        assert_eq!(*seen.lock(), vec![true, false]);
        // Once the burst is over, the next one is reported again.
        *api.limited_at.lock() = Some((Instant::now() - REPORT_LIMITED_EVERY, false));
        api.report_limited(true);
        assert_eq!(*seen.lock(), vec![true, false, true]);
    }

    #[tokio::test]
    async fn nothing_is_sent_for_a_remembered_failure_or_an_expired_session() {
        let api = Api::new();
        api.remember_failure("worlds/wrld_1", 404, "World not found");
        let e = api.get("worlds/wrld_1", &[]).await.unwrap_err();
        assert_eq!((e.status(), e.to_string()), (Some(404), "World not found".to_string()));

        api.session_lost();
        let e = api.get("users/usr_1", &[]).await.unwrap_err();
        assert_eq!((e.status(), e.to_string()), (Some(401), SESSION_EXPIRED.to_string()));
        let e = api.post("invite/usr_1", &Value::Null).await.unwrap_err();
        assert_eq!(e.status(), Some(401));
    }
}
