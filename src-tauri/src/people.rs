//! Names and pictures for people who aren't your friends: players in your instance and in old
//! game log sessions. Whatever VRChat already sent us (friend lists, profiles, search results,
//! group members) is kept, so most people need no request at all; the rest are looked up one at
//! a time in the background lane, the most recently asked-for first, and announced with a
//! `user:brief` event as they arrive.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::now_ms;
use crate::state::AppState;

/// Cache kind for the small records kept here.
pub const KIND: &str = "brief";

/// Just enough to show someone: their name, picture and trust rank.
const FIELDS: [&str; 8] = [
    "id",
    "displayName",
    "userIcon",
    "profilePicOverride",
    "profilePicOverrideThumbnail",
    "currentAvatarThumbnailImageUrl",
    "iconUrl",
    "tags",
];

/// Lookups waiting their turn; old ones are dropped once this many are queued.
const MAX_QUEUED: usize = 400;
/// After a failed lookup, leave that person alone for a while.
const RETRY_FAILED: Duration = Duration::from_secs(15 * 60);

pub fn is_user_id(id: &str) -> bool {
    id.strip_prefix("usr_").is_some_and(|r| !r.is_empty() && r.len() <= 64 && r.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}

/// The display bits of a user object (`/users/{id}`, a friend, a search result…).
pub fn brief_of(user: &Value) -> Option<(String, Value)> {
    let id = user.get("id").and_then(Value::as_str).filter(|id| is_user_id(id))?;
    let out: Map<String, Value> = FIELDS
        .iter()
        .filter_map(|k| user.get(*k).filter(|v| !v.is_null()).map(|v| (k.to_string(), v.clone())))
        .collect();
    // Without a name or a picture there's nothing worth keeping.
    out.contains_key("displayName").then(|| (id.to_string(), Value::Object(out)))
}

/// Keep whatever is shown of these people for later.
pub fn remember<'a>(app: &AppHandle, users: impl IntoIterator<Item = &'a Value>) {
    let rows: Vec<(String, Value)> = users.into_iter().filter_map(brief_of).collect();
    if !rows.is_empty() {
        let _ = app.state::<AppState>().db.cache_put_many(KIND, &rows);
    }
}

#[derive(Default)]
struct Queue {
    /// Newest at the back; that's the one looked up next.
    order: VecDeque<String>,
    queued: HashSet<String>,
    failed: HashMap<String, Instant>,
    running: bool,
}

static QUEUE: LazyLock<Mutex<Queue>> = LazyLock::new(Default::default);

/// What's known about these people now. Anyone unknown, or known for longer than
/// `max_age_ms`, is looked up in the background.
pub fn lookup(app: &AppHandle, ids: Vec<String>, max_age_ms: Option<i64>) -> HashMap<String, Value> {
    let ids: Vec<String> = ids.into_iter().filter(|id| is_user_id(id)).take(500).collect();
    let db = &app.state::<AppState>().db;
    let mut known = db.cache_get_many(KIND, &ids);
    // Profiles opened before briefs existed already hold everything needed.
    let have: HashSet<String> = known.iter().map(|(id, _, _)| id.clone()).collect();
    let unseen: Vec<String> = ids.iter().filter(|id| !have.contains(*id)).cloned().collect();
    known.extend(
        db.cache_get_many("user", &unseen).into_iter().filter_map(|(_, user, ts)| brief_of(&user).map(|(id, b)| (id, b, ts))),
    );
    let now = now_ms();
    let fresh: HashSet<&str> =
        known.iter().filter(|(_, _, ts)| max_age_ms.is_none_or(|m| now - ts <= m)).map(|(id, _, _)| id.as_str()).collect();
    let missing: Vec<String> = ids.iter().filter(|id| !fresh.contains(id.as_str())).cloned().collect();
    want(app, missing);
    known.into_iter().map(|(id, v, _)| (id, v)).collect()
}

/// Queue lookups. The first id is looked up first.
fn want(app: &AppHandle, ids: Vec<String>) {
    if ids.is_empty() {
        return;
    }
    let mut q = QUEUE.lock();
    let Queue { order, queued, failed, running } = &mut *q;
    failed.retain(|_, at| at.elapsed() < RETRY_FAILED);
    for id in ids.into_iter().rev() {
        if failed.contains_key(&id) {
            continue;
        }
        if !queued.insert(id.clone()) {
            order.retain(|x| *x != id);
        }
        order.push_back(id);
    }
    while order.len() > MAX_QUEUED {
        if let Some(old) = order.pop_front() {
            queued.remove(&old);
        }
    }
    if !*running && !order.is_empty() {
        *running = true;
        let app = app.clone();
        tauri::async_runtime::spawn(crate::api::background(work(app)));
    }
}

async fn work(app: AppHandle) {
    loop {
        let Some(id) = ({
            let mut q = QUEUE.lock();
            let next = q.order.pop_back();
            match &next {
                Some(id) => {
                    q.queued.remove(id);
                }
                None => q.running = false,
            }
            next
        }) else {
            return;
        };
        if app.state::<AppState>().me_id().is_err() {
            // Signed out: nothing can be looked up, so drop the rest.
            let mut q = QUEUE.lock();
            q.order.clear();
            q.queued.clear();
            q.running = false;
            return;
        }
        // `cached` stores the brief too, and serves a profile someone opened a moment ago.
        match crate::sync::cached(&app, "user", &id, &format!("users/{id}"), 600_000, false).await {
            Ok(user) => {
                if let Some((_, brief)) = brief_of(&user) {
                    let _ = app.emit("user:brief", &brief);
                }
            }
            Err(e) => {
                eprintln!("looking up {id} failed: {e}");
                QUEUE.lock().failed.insert(id, Instant::now());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_only_what_is_shown() {
        let u = json!({
            "id": "usr_a1b2c3d4-0000-1111-2222-333344445555",
            "displayName": "Some Player",
            "bio": "long text",
            "currentAvatarThumbnailImageUrl": "https://api.vrchat.cloud/api/1/image/file_x/1/256",
            "userIcon": null,
            "tags": ["system_trust_known"],
        });
        let (id, b) = brief_of(&u).unwrap();
        assert_eq!(id, "usr_a1b2c3d4-0000-1111-2222-333344445555");
        assert_eq!(b.as_object().unwrap().len(), 4);
        assert!(b.get("bio").is_none() && b.get("userIcon").is_none());
        assert!(brief_of(&json!({ "id": "grp_x", "displayName": "x" })).is_none());
        assert!(brief_of(&json!({ "id": "usr_x" })).is_none());
        assert!(!is_user_id("usr_../x"));
    }
}
