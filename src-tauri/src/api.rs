//! Thin VRChat REST client: cookie handling, one shared request scheduler and 429 recovery.
//!
//! VRChat doesn't publish its limits, so every request to its API host is scheduled here:
//! - a token bucket lets short bursts through (opening a profile fires a handful of calls at
//!   once) while keeping the sustained rate gentle;
//! - three lanes keep it fair: what you click goes first, then what you're looking at, and
//!   Nexus' own upkeep (bio checks, pictures for people in the game log…) only uses spare
//!   capacity and always leaves a reserve free for you;
//! - a 429 pauses everyone until it lifts (VRChat's `Retry-After`, else a doubling backoff),
//!   then the pace stays slower for a few minutes so the limit isn't hit again straight away.
//!
//! A request that would have to wait longer than its lane allows fails with a plain message
//! instead of hanging. Pictures on the API host have a scheduler of their own, so a page full
//! of thumbnails never holds up the app itself.
//!
//! On top of the pacing, requests that can't do any good aren't sent at all:
//! - identical reads asked for at the same moment share one request;
//! - a read VRChat answered with "not found" or "forbidden" isn't asked again for a while;
//! - once the session has expired nothing else goes out until it's restored.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;
use reqwest::{header, Method, StatusCode};
use serde_json::Value;
use tokio::sync::Notify;

use crate::error::{Error, Result};

pub const API_BASE: &str = "https://api.vrchat.cloud/api/1";
/// VRChat asks API clients to identify themselves with a name, version and contact.
pub const USER_AGENT: &str = concat!("Nexus/", env!("CARGO_PKG_VERSION"), " (+https://github.com/LunoviaVR/Nexus)");

/// Who a request is for, least urgent first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Lane {
    /// Nexus' own upkeep: runs on spare capacity only and never delays the other lanes.
    Background = 0,
    /// Something on screen: a page, a dialog, a list.
    Normal = 1,
    /// Something you clicked that changes something: invite, boop, edit, favorite…
    Action = 2,
}

impl Lane {
    /// The longest a request waits for a rate limit to lift before reporting it instead.
    fn patience(self) -> Duration {
        match self {
            Lane::Action => Duration::from_secs(20),
            Lane::Normal => Duration::from_secs(45),
            Lane::Background => Duration::from_secs(10 * 60),
        }
    }
}

tokio::task_local! {
    static LANE: Lane;
}

/// Run `fut` with its VRChat reads in the background lane.
pub async fn background<F: Future>(fut: F) -> F::Output {
    LANE.scope(Lane::Background, fut).await
}

fn lane_for(method: &Method) -> Lane {
    if *method != Method::GET {
        return Lane::Action;
    }
    LANE.try_with(|l| *l).unwrap_or(Lane::Normal)
}

#[derive(Debug, Clone, Copy)]
struct Pace {
    /// Requests that may go out back to back after a quiet spell.
    burst: f64,
    /// One more request is allowed every `every`.
    every: Duration,
    /// After a 429 the burst is smaller and the pace slower, for `SLOW_FOR`.
    slow_burst: f64,
    slow_every: Duration,
    /// Capacity background work leaves free for you, and its own minimum spacing.
    reserve: f64,
    background_gap: Duration,
}

/// About 100 requests a minute at most, in bursts of up to 8.
const API_PACE: Pace = Pace {
    burst: 8.0,
    every: Duration::from_millis(600),
    slow_burst: 3.0,
    slow_every: Duration::from_millis(1500),
    reserve: 4.0,
    background_gap: Duration::from_millis(1200),
};

/// Thumbnails redirect to VRChat's CDN and are far cheaper than API calls, but still paced.
const IMAGE_PACE: Pace = Pace {
    burst: 12.0,
    every: Duration::from_millis(200),
    slow_burst: 4.0,
    slow_every: Duration::from_millis(600),
    reserve: 0.0,
    background_gap: Duration::ZERO,
};

/// How long the slower pace lasts after a rate limit lifts.
const SLOW_FOR: Duration = Duration::from_secs(5 * 60);

/// How long a read that came back 403/404 is answered from memory instead of asked again.
const FAILED_FOR: Duration = Duration::from_secs(15 * 60);

/// VRChat won't page `/auth/user/friends` past this offset.
const FRIENDS_MAX_OFFSET: usize = 7_500;

const SESSION_EXPIRED: &str = "Your VRChat session expired. Please sign in again.";

/// Why a request can't go out yet.
#[derive(Debug, PartialEq)]
enum Hold {
    /// A 429 is still being waited out.
    Cooldown(Duration),
    /// Someone more urgent, or earlier in the same lane, goes first.
    Turn,
    /// Out of capacity; more frees up after this.
    Pace(Duration),
}

/// The scheduler's bookkeeping. Time is passed in, so the rules are testable without waiting.
struct State {
    pace: Pace,
    tokens: f64,
    refilled: Instant,
    cooldown_until: Option<Instant>,
    slow_until: Option<Instant>,
    /// Consecutive 429s, for the backoff when VRChat sends no `Retry-After`.
    strikes: u32,
    last_strike: Option<Instant>,
    last_background: Option<Instant>,
    /// Waiting requests per lane, in arrival order.
    queues: [VecDeque<u64>; 3],
    next_ticket: u64,
}

impl State {
    fn new(pace: Pace, now: Instant) -> Self {
        Self {
            pace,
            tokens: pace.burst,
            refilled: now,
            cooldown_until: None,
            slow_until: None,
            strikes: 0,
            last_strike: None,
            last_background: None,
            queues: Default::default(),
            next_ticket: 0,
        }
    }

    fn slow(&self, now: Instant) -> bool {
        self.slow_until.is_some_and(|t| t > now)
    }

    fn rate(&self, now: Instant) -> (f64, Duration) {
        if self.slow(now) {
            (self.pace.slow_burst, self.pace.slow_every)
        } else {
            (self.pace.burst, self.pace.every)
        }
    }

    fn refill(&mut self, now: Instant) {
        let (cap, every) = self.rate(now);
        let gained = now.saturating_duration_since(self.refilled).as_secs_f64() / every.as_secs_f64();
        self.tokens = (self.tokens + gained).min(cap);
        self.refilled = now;
    }

    fn enqueue(&mut self, lane: Lane) -> u64 {
        self.next_ticket += 1;
        self.queues[lane as usize].push_back(self.next_ticket);
        self.next_ticket
    }

    fn leave(&mut self, lane: Lane, id: u64) {
        self.queues[lane as usize].retain(|t| *t != id);
    }

    /// Let request `id` go out now, or say what it's waiting for.
    fn take(&mut self, lane: Lane, id: u64, now: Instant) -> std::result::Result<(), Hold> {
        self.refill(now);
        if let Some(until) = self.cooldown_until {
            if until > now {
                return Err(Hold::Cooldown(until - now));
            }
            self.cooldown_until = None;
        }
        let i = lane as usize;
        if self.queues[i + 1..].iter().any(|q| !q.is_empty()) || self.queues[i].front() != Some(&id) {
            return Err(Hold::Turn);
        }
        let (cap, every) = self.rate(now);
        let mut wait = Duration::ZERO;
        let need = if lane == Lane::Background { (1.0 + self.pace.reserve).min(cap) } else { 1.0 };
        if self.tokens < need {
            wait = every.mul_f64(need - self.tokens);
        }
        if lane == Lane::Background {
            let gap = if self.slow(now) { self.pace.background_gap.max(self.pace.slow_every * 2) } else { self.pace.background_gap };
            if let Some(last) = self.last_background {
                wait = wait.max(gap.saturating_sub(now.saturating_duration_since(last)));
            }
        }
        if !wait.is_zero() {
            return Err(Hold::Pace(wait));
        }
        self.tokens -= 1.0;
        self.queues[i].pop_front();
        if lane == Lane::Background {
            self.last_background = Some(now);
        }
        Ok(())
    }

    /// A 429 came back for a request sent at `sent`. Returns how long everyone now waits.
    fn rate_limited(&mut self, retry_after: Option<Duration>, sent: Instant, now: Instant) -> Duration {
        // Requests already in flight when the first 429 arrived are the same burst, not a new strike.
        if self.last_strike.is_none_or(|t| sent > t) {
            self.strikes += 1;
            self.last_strike = Some(now);
        }
        let until = now + retry_after.unwrap_or_else(|| backoff(self.strikes));
        if self.cooldown_until.is_none_or(|t| t < until) {
            self.cooldown_until = Some(until);
        }
        let until = self.cooldown_until.unwrap_or(until);
        self.tokens = 0.0;
        self.refilled = now;
        self.slow_until = Some(until + SLOW_FOR);
        until - now
    }

    fn succeeded(&mut self) {
        self.strikes = 0;
    }
}

struct Scheduler {
    state: Mutex<State>,
    changed: Notify,
}

/// Takes a request out of the queue however its wait ends (sent, gave up, or cancelled).
struct Ticket<'a> {
    sched: &'a Scheduler,
    lane: Lane,
    id: u64,
}

impl Drop for Ticket<'_> {
    fn drop(&mut self) {
        self.sched.state.lock().leave(self.lane, self.id);
        self.sched.changed.notify_waiters();
    }
}

impl Scheduler {
    fn new(pace: Pace) -> Self {
        Self { state: Mutex::new(State::new(pace, Instant::now())), changed: Notify::new() }
    }

    /// Wait for this request's turn. Fails if a rate limit would outlast `deadline`.
    async fn acquire(&self, lane: Lane, deadline: Instant) -> Result<()> {
        let id = self.state.lock().enqueue(lane);
        let _ticket = Ticket { sched: self, lane, id };
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let now = Instant::now();
            let hold = match self.state.lock().take(lane, id, now) {
                Ok(()) => return Ok(()),
                Err(h) => h,
            };
            let wait = match hold {
                Hold::Cooldown(d) if now + d > deadline => {
                    return Err(Error::Api { status: 429, message: rate_limited_message(d) });
                }
                Hold::Cooldown(d) | Hold::Pace(d) => d,
                // Whoever goes next wakes the rest; the timeout is only a safety net.
                Hold::Turn => Duration::from_secs(1),
            };
            tokio::select! {
                _ = &mut notified => {}
                _ = tokio::time::sleep(wait) => {}
            }
        }
    }

    fn rate_limited(&self, retry_after: Option<Duration>, sent: Instant) -> Duration {
        let wait = self.state.lock().rate_limited(retry_after, sent, Instant::now());
        self.changed.notify_waiters();
        wait
    }

    fn succeeded(&self) {
        self.state.lock().succeeded();
    }
}

/// A finished read, in a form every caller sharing it can have a copy of.
type SharedResult = std::result::Result<Value, (Option<u16>, String)>;

/// The path a read is remembered under: no leading slash, no query.
fn failed_key(path: &str) -> &str {
    let path = path.trim_start_matches('/');
    path.split_once('?').map_or(path, |(p, _)| p)
}

/// Reads that are worth not repeating: things that don't exist or that you can't see.
/// Sign-in endpoints are always asked fresh.
fn should_remember(status: u16, path: &str) -> bool {
    matches!(status, 403 | 404) && !failed_key(path).starts_with("auth")
}

/// Identical reads share a request only within the same lane, so a page never waits behind upkeep.
fn dedup_key(lane: Lane, path: &str, query: &[(&str, String)]) -> String {
    let mut q: Vec<String> = query.iter().map(|(k, v)| format!("{k}={v}")).collect();
    q.sort();
    format!("{}|{}|{}", lane as u8, path.trim_start_matches('/'), q.join("&"))
}

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
    sched: Scheduler,
    images: Scheduler,
    /// Reads in progress, shared by everyone asking for the same thing.
    inflight: Mutex<HashMap<String, Arc<tokio::sync::OnceCell<SharedResult>>>>,
    /// Reads that came back 403/404: when, and what VRChat said.
    failed: Mutex<HashMap<String, (Instant, u16, String)>>,
    /// Set by the first 401 and cleared when the session is restored.
    expired: AtomicBool,
    /// Called once when the session is found to have expired.
    on_expired: OnceLock<Box<dyn Fn() + Send + Sync>>,
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
            sched: Scheduler::new(API_PACE),
            images: Scheduler::new(IMAGE_PACE),
            inflight: Mutex::new(HashMap::new()),
            failed: Mutex::new(HashMap::new()),
            expired: AtomicBool::new(false),
            on_expired: OnceLock::new(),
        }
    }

    /// What to do when a request reveals the session has expired (only the first one counts).
    pub fn set_on_expired(&self, f: impl Fn() + Send + Sync + 'static) {
        let _ = self.on_expired.set(Box::new(f));
    }

    /// Let requests go out again after the session was found expired.
    pub fn revive(&self) {
        self.expired.store(false, Ordering::SeqCst);
    }

    fn session_lost(&self) {
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
        let lane = lane_for(&method);
        let deadline = Instant::now() + lane.patience();
        let read = method == Method::GET;
        if self.expired.load(Ordering::SeqCst) && !allowed_while_expired(path, basic.is_some()) {
            return Err(Error::Api { status: 401, message: SESSION_EXPIRED.into() });
        }
        if read && basic.is_none() {
            if let Some((status, message)) = self.recent_failure(path) {
                return Err(Error::Api { status, message });
            }
        }
        let mut limited = 0u32;
        let mut retried = false;
        loop {
            self.sched.acquire(lane, deadline).await?;
            let sent = Instant::now();
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
                    retried = true;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            self.store_cookies(res.headers());
            let status = res.status();
            if status == StatusCode::TOO_MANY_REQUESTS {
                limited += 1;
                let wait = self.sched.rate_limited(retry_after(res.headers()), sent);
                // Nothing was done, so even an action is safe to send again once the limit lifts.
                if limited < 4 && Instant::now() + wait <= deadline {
                    continue;
                }
                return Err(Error::Api { status: 429, message: rate_limited_message(wait) });
            }
            self.sched.succeeded();
            // VRChat's API has the odd hiccup; a read gets one more try.
            if read && !retried && matches!(status.as_u16(), 502..=504) {
                retried = true;
                tokio::time::sleep(Duration::from_millis(1500)).await;
                continue;
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

    /// A read. Asking for something that's already on its way waits for that request instead
    /// of sending another one.
    pub async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        let key = dedup_key(lane_for(&Method::GET), path, query);
        let cell = self.inflight.lock().entry(key.clone()).or_default().clone();
        let out = cell
            .get_or_init(|| async {
                self.send(Method::GET, path, query, None, None).await.map_err(|e| (e.status(), e.to_string()))
            })
            .await
            .clone();
        {
            let mut inflight = self.inflight.lock();
            if inflight.get(&key).is_some_and(|c| Arc::ptr_eq(c, &cell)) {
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

    /// Multipart upload (icons/gallery images), scheduled like any other action.
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
        self.sched.acquire(Lane::Action, Instant::now() + Lane::Action.patience()).await?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("image.png")
            .mime_str("image/png")
            .map_err(|e| Error::Other(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new().part(file_field.to_string(), part);
        for (k, v) in fields {
            form = form.text(k.to_string(), v.clone());
        }
        let url = format!("{API_BASE}/{}", path.trim_start_matches('/'));
        let sent = Instant::now();
        let res = self.http.post(url).header(header::COOKIE, self.cookie_header()).multipart(form).send().await?;
        self.store_cookies(res.headers());
        let status = res.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let wait = self.sched.rate_limited(retry_after(res.headers()), sent);
            return Err(Error::Api { status: 429, message: rate_limited_message(wait) });
        }
        self.sched.succeeded();
        let json: Value = res.json().await.unwrap_or(Value::Null);
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
    /// Pictures on the API host (`/api/1/file/…`, `/api/1/image/…`) go through the picture
    /// scheduler and wait out a 429 rather than failing; pictures already on the CDN aren't
    /// limited and go straight through. The cookie is dropped on the cross-host redirect.
    pub async fn fetch_bytes(&self, url: &str) -> Result<(Option<String>, Vec<u8>)> {
        let on_api = url.starts_with("https://api.vrchat.cloud/");
        let deadline = Instant::now() + Duration::from_secs(90);
        let mut limited = 0u32;
        loop {
            if on_api {
                self.images.acquire(Lane::Normal, deadline).await?;
            }
            let sent = Instant::now();
            let mut req = self.http.get(url);
            let cookie = self.cookie_header();
            if !cookie.is_empty() {
                req = req.header(header::COOKIE, cookie);
            }
            let res = req.send().await?;
            let status = res.status();
            if on_api && status == StatusCode::TOO_MANY_REQUESTS {
                limited += 1;
                let wait = self.images.rate_limited(retry_after(res.headers()), sent);
                if limited < 3 && Instant::now() + wait <= deadline {
                    continue;
                }
                return Err(Error::Api { status: 429, message: rate_limited_message(wait) });
            }
            if on_api {
                self.images.succeeded();
            }
            if !status.is_success() {
                return Err(Error::Api { status: status.as_u16(), message: format!("Image request failed ({status})") });
            }
            let ct = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(String::from);
            return Ok((ct, res.bytes().await?.to_vec()));
        }
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
            if len < 100 || offset + 100 > FRIENDS_MAX_OFFSET {
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

/// Without a `Retry-After`: 2s, 4s, 8s… up to 2 minutes.
fn backoff(strikes: u32) -> Duration {
    Duration::from_secs((2u64 << strikes.saturating_sub(1).min(6)).min(120))
}

fn rate_limited_message(wait: Duration) -> String {
    let secs = wait.as_secs().max(1);
    let when = if secs < 60 { format!("{secs} seconds") } else { format!("{} minutes", secs.div_ceil(60)) };
    format!("VRChat is limiting how fast you can do this right now. Try again in about {when}.")
}

#[cfg(test)]
mod rate_limit_tests {
    use super::*;

    const MS: Duration = Duration::from_millis(1);

    fn take(s: &mut State, lane: Lane, now: Instant) -> std::result::Result<(), Hold> {
        let id = s.enqueue(lane);
        let r = s.take(lane, id, now);
        if r.is_err() {
            s.leave(lane, id);
        }
        r
    }

    #[test]
    fn honours_retry_after_and_backs_off_without_it() {
        let mut h = header::HeaderMap::new();
        h.insert(header::RETRY_AFTER, "12".parse().unwrap());
        assert_eq!(retry_after(&h), Some(Duration::from_secs(12)));
        assert_eq!(retry_after(&header::HeaderMap::new()), None);
        let secs = |n| backoff(n).as_secs();
        assert_eq!((secs(1), secs(2), secs(3), secs(10)), (2, 4, 8, 120));
    }

    #[test]
    fn explains_the_limit_in_words() {
        assert!(rate_limited_message(Duration::from_secs(30)).contains("about 30 seconds"));
        assert!(rate_limited_message(Duration::from_secs(90)).contains("about 2 minutes"));
    }

    #[test]
    fn bursts_then_paces() {
        let t0 = Instant::now();
        let mut s = State::new(API_PACE, t0);
        for _ in 0..8 {
            assert_eq!(take(&mut s, Lane::Normal, t0), Ok(()));
        }
        assert!(matches!(take(&mut s, Lane::Normal, t0), Err(Hold::Pace(d)) if d == API_PACE.every));
        assert_eq!(take(&mut s, Lane::Normal, t0 + API_PACE.every), Ok(()));
    }

    #[test]
    fn background_leaves_a_reserve_and_yields() {
        let t0 = Instant::now();
        let mut s = State::new(API_PACE, t0);
        for _ in 0..4 {
            take(&mut s, Lane::Normal, t0).unwrap();
        }
        // Four left: background needs five, so it waits while you can still burst.
        assert!(matches!(take(&mut s, Lane::Background, t0), Err(Hold::Pace(_))));
        assert_eq!(take(&mut s, Lane::Normal, t0), Ok(()));

        // Anything waiting in a more urgent lane goes first.
        let mut s = State::new(API_PACE, t0);
        let waiting = s.enqueue(Lane::Normal);
        assert_eq!(take(&mut s, Lane::Background, t0), Err(Hold::Turn));
        assert_eq!(s.take(Lane::Normal, waiting, t0), Ok(()));
        assert_eq!(take(&mut s, Lane::Background, t0), Ok(()));
        // …and background work keeps its own spacing.
        assert!(matches!(take(&mut s, Lane::Background, t0 + 100 * MS), Err(Hold::Pace(_))));
        assert_eq!(take(&mut s, Lane::Background, t0 + API_PACE.background_gap), Ok(()));
    }

    #[test]
    fn same_lane_is_first_come_first_served() {
        let t0 = Instant::now();
        let mut s = State::new(API_PACE, t0);
        let first = s.enqueue(Lane::Normal);
        let second = s.enqueue(Lane::Normal);
        assert_eq!(s.take(Lane::Normal, second, t0), Err(Hold::Turn));
        assert_eq!(s.take(Lane::Normal, first, t0), Ok(()));
        assert_eq!(s.take(Lane::Normal, second, t0), Ok(()));
        // An action jumps the queue.
        let read = s.enqueue(Lane::Normal);
        let click = s.enqueue(Lane::Action);
        assert_eq!(s.take(Lane::Normal, read, t0), Err(Hold::Turn));
        assert_eq!(s.take(Lane::Action, click, t0), Ok(()));
        assert_eq!(s.take(Lane::Normal, read, t0), Ok(()));
    }

    #[test]
    fn a_429_pauses_everyone_then_slows_down() {
        let t0 = Instant::now();
        let mut s = State::new(API_PACE, t0);
        assert_eq!(s.rate_limited(None, t0, t0), Duration::from_secs(2));
        // Another reply from the same burst doesn't count as a new strike.
        assert_eq!(s.rate_limited(None, t0, t0 + MS), Duration::from_secs(2));
        assert!(matches!(take(&mut s, Lane::Action, t0 + 500 * MS), Err(Hold::Cooldown(_))));
        // Once it lifts, things go out again, but at the slower pace.
        let after = t0 + Duration::from_secs(5);
        assert_eq!(take(&mut s, Lane::Normal, after), Ok(()));
        assert!(s.slow(after));
        // A fresh 429 after that backs off further.
        assert_eq!(s.rate_limited(None, after, after), Duration::from_secs(4));
        s.succeeded();
        assert_eq!(s.strikes, 0);
        assert!(s.slow(after + Duration::from_secs(60)));
        assert!(!s.slow(after + Duration::from_secs(4) + SLOW_FOR + MS));
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
        assert_eq!(failed_key("/groups/grp_1?includeRoles=true"), "groups/grp_1");
    }

    #[test]
    fn query_order_does_not_split_shared_reads() {
        let a = dedup_key(Lane::Normal, "/users", &[("n", "10".into()), ("search", "x".into())]);
        let b = dedup_key(Lane::Normal, "users", &[("search", "x".into()), ("n", "10".into())]);
        assert_eq!(a, b);
        assert_ne!(a, dedup_key(Lane::Background, "users", &[("n", "10".into()), ("search", "x".into())]));
        assert_ne!(a, dedup_key(Lane::Normal, "users", &[("n", "20".into()), ("search", "x".into())]));
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
