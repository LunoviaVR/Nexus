//! Discover public avatars through avtrDB (https://avtrdb.com), a community index of public
//! VRChat avatars — the same kind of service avatar-search worlds and VRCX use, since VRChat's own
//! API can't search other people's avatars.
//!
//! Requests use their own HTTP client so VRChat cookies are never sent to a third party, are
//! spaced out, and are cached briefly to stay well within the service's limits.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::api::USER_AGENT;
use crate::error::{Error, Result};

const BASE: &str = "https://api.avtrdb.com/v2/avatar/search";
const MIN_GAP: Duration = Duration::from_millis(1200);
const CACHE_FOR: Duration = Duration::from_secs(300);
pub const PAGE_SIZE: u32 = 50;

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client")
});
static GATE: LazyLock<tokio::sync::Mutex<Option<Instant>>> = LazyLock::new(|| tokio::sync::Mutex::new(None));
static CACHE: LazyLock<parking_lot::Mutex<HashMap<String, (Instant, Value)>>> = LazyLock::new(Default::default);

/// `mode` "name" restricts matching to avatar names (avtrDB's `name:` prefix); anything else is a
/// free-text search across names, descriptions, tags and authors.
pub async fn search(query: &str, mode: &str, page: u32) -> Result<Value> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(serde_json::json!({ "avatars": [], "has_more": false }));
    }
    let q = if mode == "name" { format!("name:{q}") } else { q.to_string() };
    let key = format!("{page}\u{1f}{q}");
    if let Some((t, v)) = CACHE.lock().get(&key) {
        if t.elapsed() < CACHE_FOR {
            return Ok(v.clone());
        }
    }

    // One request at a time, spaced out.
    let mut last = GATE.lock().await;
    if let Some(t) = *last {
        if t.elapsed() < MIN_GAP {
            tokio::time::sleep(MIN_GAP - t.elapsed()).await;
        }
    }
    let res = CLIENT
        .get(BASE)
        .query(&[("query", q.as_str()), ("page_size", &PAGE_SIZE.to_string()), ("page", &page.to_string())])
        .send()
        .await;
    *last = Some(Instant::now());
    drop(last);

    let res = res.map_err(|e| Error::Other(format!("Avatar search is unreachable right now ({e}).")))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if status.as_u16() == 429 || text.trim().is_empty() {
        return Err(Error::Other("Avatar search is busy. Try again in a moment.".into()));
    }
    if !status.is_success() {
        return Err(Error::Other(format!("Avatar search failed ({status}).")));
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| Error::Other("Avatar search returned something unexpected.".into()))?;
    if !v.get("avatars").is_some_and(Value::is_array) {
        return Err(Error::Other("Avatar search returned something unexpected.".into()));
    }
    let mut cache = CACHE.lock();
    cache.retain(|_, (t, _)| t.elapsed() < CACHE_FOR);
    cache.insert(key, (Instant::now(), v.clone()));
    Ok(v)
}
