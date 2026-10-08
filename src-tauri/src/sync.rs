//! Session lifecycle and the live friend model: snapshot refreshes, pipeline patches,
//! feed diffs, cached lookups and desktop notifications.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::{now_ms, FeedEntry};
use crate::error::Result;
use crate::location;
use crate::settings::Scope;
use crate::state::AppState;

/// Fields on pipeline `user` payloads that can be stale; location state comes from the event itself.
const STALE_KEYS: [&str; 5] = ["location", "travelingToLocation", "state", "worldId", "instanceId"];

pub fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Turn a v2 boop notification into the v1 shape the Notifications page already understands.
/// Other v2 types are ignored (None).
pub fn boop_notification(app: &AppHandle, n: &Value) -> Option<Value> {
    if str_of(n, "type") != "boop" {
        return None;
    }
    let sender_id = str_of(n, "senderUserId");
    let friend_name = app
        .state::<AppState>()
        .session
        .read()
        .friends
        .get(sender_id)
        .map(|f| str_of(f, "displayName").to_string())
        .filter(|s| !s.is_empty());
    let name = friend_name.or_else(|| Some(str_of(n, "senderUsername").to_string()).filter(|s| !s.is_empty()));
    Some(json!({
        "id": str_of(n, "id"),
        "type": "boop",
        "v2": true,
        "senderUserId": sender_id,
        "senderUsername": name.unwrap_or_else(|| "Someone".into()),
        "message": str_of(n, "message"),
        "created_at": str_of(n, "createdAt"),
        "seen": n["seen"].as_bool().unwrap_or(false),
        "details": { "imageUrl": n["imageUrl"].clone() },
    }))
}

pub fn toast(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

pub fn in_scope(app: &AppHandle, scope: Scope, user_id: &str) -> bool {
    let st = app.state::<AppState>();
    match scope {
        Scope::Off => false,
        Scope::All => st.is_friend(user_id),
        Scope::Favorites => st.is_favorite(user_id),
    }
}

/// Fetch with a SQLite-backed TTL cache. Falls back to stale data when the API fails.
pub async fn cached(app: &AppHandle, kind: &str, id: &str, path: &str, ttl_ms: i64, force: bool) -> Result<Value> {
    let st = app.state::<AppState>();
    let hit = st.db.cache_get(kind, id);
    if !force {
        if let Some((v, ts)) = &hit {
            if now_ms() - ts < ttl_ms {
                return Ok(v.clone());
            }
        }
    }
    match st.api.get(path, &[]).await {
        Ok(v) => {
            let _ = st.db.cache_put(kind, id, &v);
            Ok(v)
        }
        Err(e) => match hit {
            Some((v, _)) if e.status() != Some(404) => Ok(v),
            _ => Err(e),
        },
    }
}

pub async fn world(app: &AppHandle, world_id: &str, force: bool) -> Result<Value> {
    cached(app, "world", world_id, &format!("worlds/{world_id}"), 3_600_000, force).await
}

pub async fn world_name_for(app: &AppHandle, loc: &str) -> Option<String> {
    let wid = location::world_id(loc)?;
    world(app, wid, false).await.ok().and_then(|w| w["name"].as_str().map(String::from))
}

// ---------------------------------------------------------------------------------------------
// Session lifecycle

pub async fn start_session(app: AppHandle, user: Value) {
    {
        let st = app.state::<AppState>();
        let mut s = st.session.write();
        if let Some(h) = s.pipeline.take() {
            h.abort();
        }
        if let Some(h) = s.bio_sweep.take() {
            h.abort();
        }
        s.friends.clear();
        s.favorites.clear();
        s.user = Some(user.clone());
        // Per-account bell subscriptions.
        let owner = str_of(&user, "id");
        s.watched = st.db.kv_json::<Vec<String>>(&format!("watched:{owner}")).unwrap_or_default().into_iter().collect();
    }
    let _ = app.emit("user:update", &user);
    if let Err(e) = refresh_friends(&app).await {
        eprintln!("friends refresh failed: {e}");
    }
    if let Err(e) = load_favorites(&app).await {
        eprintln!("favorites load failed: {e}");
    }
    let handle = crate::pipeline::start(app.clone());
    let sweep = spawn_bio_sweep(app.clone());
    {
        let st = app.state::<AppState>();
        let mut s = st.session.write();
        s.pipeline = Some(handle);
        s.bio_sweep = Some(sweep);
    }
    let _ = app.emit("session:ready", ());
}

pub fn end_session(app: &AppHandle) {
    let st = app.state::<AppState>();
    let mut s = st.session.write();
    if let Some(h) = s.pipeline.take() {
        h.abort();
    }
    if let Some(h) = s.bio_sweep.take() {
        h.abort();
    }
    *s = Default::default();
    st.api.clear_cookies();
    let _ = app.emit("pipeline:status", false);
}

pub async fn load_favorites(app: &AppHandle) -> Result<()> {
    let st = app.state::<AppState>();
    let list = st.api.get("favorites", &[("type", "friend".into()), ("n", "300".into())]).await?;
    let map: HashMap<String, String> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| Some((f["favoriteId"].as_str()?.to_string(), f["id"].as_str()?.to_string())))
        .collect();
    let ids: Vec<&String> = map.keys().collect();
    let _ = app.emit("favorites:update", &ids);
    st.session.write().favorites = map;
    Ok(())
}

/// Re-pull the full friend list. On a reconnect the diff against the previous model feeds the timeline.
pub async fn refresh_friends(app: &AppHandle) -> Result<()> {
    let st = app.state::<AppState>();
    let me = st.api.get("auth/user", &[]).await?;
    let owner = str_of(&me, "id").to_string();
    {
        let mut s = st.session.write();
        let keep_loc = s.user.as_ref().map(|u| u["$location"].clone());
        let mut me = me.clone();
        if let Some(loc) = keep_loc.filter(|l| !l.is_null()) {
            me["$location"] = loc;
        }
        s.user = Some(me.clone());
        let _ = app.emit("user:update", &me);
    }

    let ids = |key: &str| -> HashSet<String> {
        me[key].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect()
    };
    let online_ids = ids("onlineFriends");
    let active_ids = ids("activeFriends");

    let mut list = st.api.fetch_friends(false).await?;
    list.extend(st.api.fetch_friends(true).await?);

    let had_snapshot = !st.session.read().friends.is_empty();
    let mut seen = HashSet::new();
    for mut f in list {
        let id = str_of(&f, "id").to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let loc = str_of(&f, "location");
        let state = if online_ids.contains(&id) || (location::is_instance(loc) || loc == "private" || loc == "traveling") {
            "online"
        } else if active_ids.contains(&id) {
            "active"
        } else {
            "offline"
        };
        f["state"] = json!(state);
        if had_snapshot {
            apply_friend(app, &id, f, None, None);
        } else {
            let mut s = st.session.write();
            // "Here since" only means something for friends who are on; offline ones keep VRChat's last-seen time.
            if state != "offline" {
                f["$locationAt"] = json!(now_ms());
            }
            s.friends.insert(id, f);
        }
    }

    // Anyone missing from the fresh list is no longer a friend.
    let stale: Vec<String> = {
        let s = st.session.read();
        s.friends.keys().filter(|k| !seen.contains(*k)).cloned().collect()
    };
    for id in stale {
        st.session.write().friends.remove(&id);
    }

    let snapshot: Vec<Value> = st.session.read().friends.values().cloned().collect();
    let _ = app.emit("friends:snapshot", &snapshot);

    // Track friend adds/removes across sessions.
    let current: Vec<(String, String)> = me["friends"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .map(|id| {
            let name = st
                .session
                .read()
                .friends
                .get(id)
                .map(|f| str_of(f, "displayName").to_string())
                .unwrap_or_else(|| id.to_string());
            (id.to_string(), name)
        })
        .collect();
    if !current.is_empty() {
        let (added, removed) = st.db.friend_log_sync(&owner, &current)?;
        for (id, name) in added {
            push_feed(app, &owner, "friend", &id, &name, None, None, None, None);
        }
        let notify = st.settings().notify_unfriends;
        for (id, name) in removed {
            push_feed(app, &owner, "unfriend", &id, &name, None, None, None, None);
            if notify {
                toast(app, &format!("{name} is no longer your friend"), "Noticed when you signed in");
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn push_feed(
    app: &AppHandle,
    owner: &str,
    kind: &str,
    user_id: &str,
    name: &str,
    loc: Option<String>,
    world_name: Option<String>,
    prev: Option<String>,
    next: Option<String>,
) {
    let mut e = FeedEntry {
        id: 0,
        ts: now_ms(),
        kind: kind.into(),
        user_id: user_id.into(),
        display_name: name.into(),
        location: loc,
        world_name,
        prev,
        next,
    };
    let st = app.state::<AppState>();
    if st.db.feed_insert(owner, &mut e).is_ok() {
        let _ = app.emit("feed:new", &e);
    }
}

/// Merge a patch into a friend and record what changed.
pub fn apply_friend(app: &AppHandle, id: &str, patch: Value, state: Option<&str>, world_name: Option<String>) {
    let st = app.state::<AppState>();
    let Ok(owner) = st.me_id() else { return };
    let now = now_ms();

    let (old, new) = {
        let mut s = st.session.write();
        let old = s.friends.get(id).cloned();
        let mut new = old.clone().unwrap_or_else(|| json!({ "id": id }));
        if let (Some(obj), Value::Object(p)) = (new.as_object_mut(), patch) {
            for (k, v) in p {
                obj.insert(k, v);
            }
        }
        if let Some(state) = state {
            new["state"] = json!(state);
        }
        let old_loc = old.as_ref().map(|o| str_of(o, "location").to_string()).unwrap_or_default();
        let new_loc = str_of(&new, "location").to_string();
        if old.is_none() || old_loc != new_loc {
            new["$locationAt"] = json!(now);
            if new_loc == "traveling" && old_loc != "traveling" {
                new["$lastLocation"] = json!(old_loc);
            }
            if let Some(obj) = new.as_object_mut() {
                obj.remove("$worldName");
            }
        }
        if let Some(name) = world_name {
            new["$worldName"] = json!(name);
        }
        let old_state = old.as_ref().map(|o| str_of(o, "state").to_string()).unwrap_or_default();
        if str_of(&new, "state") == "online" && old_state != "online" {
            new["$onlineAt"] = json!(now);
        }
        s.friends.insert(id.to_string(), new.clone());
        (old, new)
    };
    let _ = app.emit("friend:update", &new);
    if let Some(old) = old {
        diff_feed(app, &owner, &old, &new);
    }
}

fn diff_feed(app: &AppHandle, owner: &str, old: &Value, new: &Value) {
    let id = str_of(new, "id");
    let name = str_of(new, "displayName");
    let (os, ns) = (str_of(old, "state"), str_of(new, "state"));
    let (ol, nl) = (str_of(old, "location"), str_of(new, "location"));
    let world_name = new["$worldName"].as_str().map(String::from);
    let settings = app.state::<AppState>().settings();

    if os != "online" && ns == "online" {
        push_feed(app, owner, "online", id, name, Some(nl.into()), world_name.clone(), None, None);
        if in_scope(app, settings.notify_online, id) || app.state::<AppState>().is_watched(id) {
            let body = world_name.clone().unwrap_or_else(|| "is now online".into());
            toast(app, &format!("{name} is online"), &body);
        }
    } else if os == "online" && ns != "online" {
        let last = if ol == "traveling" { str_of(old, "$lastLocation") } else { ol };
        push_feed(
            app,
            owner,
            "offline",
            id,
            name,
            Some(last.into()),
            old["$worldName"].as_str().map(String::from),
            None,
            None,
        );
        if in_scope(app, settings.notify_offline, id) || app.state::<AppState>().is_watched(id) {
            toast(app, &format!("{name} went offline"), "");
        }
    } else if os == "online" && ns == "online" && nl != ol && nl != "traveling" && !nl.is_empty() {
        let prev = if ol == "traveling" { str_of(old, "$lastLocation") } else { ol };
        if prev != nl {
            push_feed(app, owner, "gps", id, name, Some(nl.into()), world_name, Some(prev.into()), None);
        }
    }

    let status = |v: &Value| (str_of(v, "status").to_string(), str_of(v, "statusDescription").to_string());
    let (o_st, n_st) = (status(old), status(new));
    if !o_st.0.is_empty()
        && !n_st.0.is_empty()
        && o_st != n_st
        && o_st.0 != "offline"
        && n_st.0 != "offline"
        && ns != "offline"
    {
        let enc = |s: &(String, String)| json!({ "status": s.0, "description": s.1 }).to_string();
        push_feed(app, owner, "status", id, name, None, None, Some(enc(&o_st)), Some(enc(&n_st)));
    }

    let (oa, na) = (str_of(old, "currentAvatarThumbnailImageUrl"), str_of(new, "currentAvatarThumbnailImageUrl"));
    if !oa.is_empty() && !na.is_empty() && oa != na {
        push_feed(app, owner, "avatar", id, name, None, None, Some(oa.into()), Some(na.into()));
    }

    if let (Some(ob), Some(nb)) = (old["bio"].as_str(), new["bio"].as_str()) {
        if ob != nb {
            push_feed(app, owner, "bio", id, name, None, None, Some(ob.into()), Some(nb.into()));
        }
    }
}

/// Apply a pipeline `user` payload, stripping fields that the event itself is authoritative for.
pub fn user_patch(content: &Value) -> Value {
    let mut user = content["user"].clone();
    if let Some(obj) = user.as_object_mut() {
        for k in STALE_KEYS {
            obj.remove(k);
        }
    } else {
        user = json!({});
    }
    user
}

// ---------------------------------------------------------------------------------------------
// Bio tracking. Since VRChat's 2026 API change, bios only come from `/profile/{id}`; neither the
// friend list nor the websocket carries them, so we fetch profiles on activity and diff them.

const PROFILE_CHECK_COOLDOWN: Duration = Duration::from_secs(180);
static LAST_PROFILE_CHECK: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);

/// Fetch a profile fresh, cache it, and record a "bio" feed entry if it changed since last seen.
pub async fn fetch_profile(app: &AppHandle, user_id: &str) -> Result<Value> {
    let st = app.state::<AppState>();
    let mine = st.me_id().map(|m| m == user_id).unwrap_or(false);
    let path = if mine { format!("profile/{user_id}?asSelf=true") } else { format!("profile/{user_id}") };
    let old = st.db.cache_get("profile", user_id).map(|(v, _)| v);
    let new = st.api.get(&path, &[]).await?;
    let _ = st.db.cache_put("profile", user_id, &new);
    LAST_PROFILE_CHECK.lock().insert(user_id.to_string(), Instant::now());

    if let (Some(old), Ok(owner)) = (old, st.me_id()) {
        let (ob, nb) = (str_of(&old, "bio"), str_of(&new, "bio"));
        // Only friends get feed entries, and only real changes (an absent old bio means "unknown").
        if !mine && old.get("bio").is_some() && ob != nb && st.is_friend(user_id) {
            let name = str_of(&new, "displayName");
            push_feed(app, &owner, "bio", user_id, name, None, None, Some(ob.into()), Some(nb.into()));
        }
    }
    Ok(new)
}

/// Background, rate-limited profile check after friend activity.
pub fn check_profile_soon(app: &AppHandle, user_id: &str) {
    {
        let mut last = LAST_PROFILE_CHECK.lock();
        if last.get(user_id).is_some_and(|t| t.elapsed() < PROFILE_CHECK_COOLDOWN) {
            return;
        }
        // Reserve the slot now so bursts of events don't queue duplicate fetches.
        last.insert(user_id.to_string(), Instant::now());
    }
    let (app, id) = (app.clone(), user_id.to_string());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = fetch_profile(&app, &id).await {
            eprintln!("profile check for {id} failed: {e}");
        }
    });
}

/// VRChat sends no event when someone edits their bio on the website, in VRCX, or while offline,
/// so we also walk the friend list slowly in the background: friends active on the website
/// (the likeliest to be editing) every few minutes, everyone else round-robin.
const SWEEP_PAUSE: Duration = Duration::from_secs(15);
const SWEEP_WEB_EVERY: Duration = Duration::from_secs(5 * 60);
const SWEEP_ALL_EVERY: Duration = Duration::from_secs(30 * 60);

/// Pick the friend most overdue for a profile check, if any is due.
fn next_sweep_target(app: &AppHandle) -> Option<String> {
    let st = app.state::<AppState>();
    let s = st.session.read();
    let last = LAST_PROFILE_CHECK.lock();
    let mut best: Option<(Duration, &String)> = None;
    for (id, f) in &s.friends {
        let interval = if str_of(f, "state") == "active" { SWEEP_WEB_EVERY } else { SWEEP_ALL_EVERY };
        // Never-checked friends count as maximally overdue.
        let since = last.get(id).map(|t| t.elapsed()).unwrap_or(Duration::MAX);
        if since < interval {
            continue;
        }
        let overdue = since.saturating_sub(interval);
        if best.is_none_or(|(b, _)| overdue > b) {
            best = Some((overdue, id));
        }
    }
    best.map(|(_, id)| id.clone())
}

pub fn spawn_bio_sweep(app: AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        // Let the login burst (friends list, favorites, pipeline) settle first.
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            if let Some(id) = next_sweep_target(&app) {
                if let Err(e) = fetch_profile(&app, &id).await {
                    eprintln!("bio sweep for {id} failed: {e}");
                    // Back off on rate limits rather than hammering the API.
                    if e.status() == Some(429) {
                        tokio::time::sleep(Duration::from_secs(120)).await;
                    }
                }
            }
            tokio::time::sleep(SWEEP_PAUSE).await;
        }
    })
}

pub fn remove_friend(app: &AppHandle, id: &str) {
    let st = app.state::<AppState>();
    let removed = st.session.write().friends.remove(id);
    let _ = app.emit("friend:remove", id);
    if let (Ok(owner), Some(f)) = (st.me_id(), removed) {
        let name = str_of(&f, "displayName");
        let _ = st.db.friend_log_set(&owner, id, name, false);
        push_feed(app, &owner, "unfriend", id, name, None, None, None, None);
        if st.settings().notify_unfriends {
            toast(app, &format!("{name} is no longer your friend"), "");
        }
    }
}
