//! Session lifecycle and the live friend model: snapshot refreshes, pipeline patches,
//! feed diffs, cached lookups and desktop notifications.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

use crate::db::{now_ms, FeedEntry};
use crate::error::{Error, Result};
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

/// Lookups in progress, by cache key: asking for the same thing twice at once fetches it once.
static IN_FLIGHT: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = LazyLock::new(Default::default);
/// Things VRChat says don't exist (a deleted account, a removed world), and its message for them.
static MISSING: LazyLock<Mutex<HashMap<String, (Instant, String)>>> = LazyLock::new(Default::default);
const MISSING_FOR: Duration = Duration::from_secs(30 * 60);

/// Fetch with a SQLite-backed TTL cache. Falls back to stale data when the API fails.
pub async fn cached(app: &AppHandle, kind: &str, id: &str, path: &str, ttl_ms: i64, force: bool) -> Result<Value> {
    let st = app.state::<AppState>();
    let key = format!("{kind}:{id}");
    let started = now_ms();
    let hit = st.db.cache_get(kind, id);
    if !force {
        if let Some((v, ts)) = &hit {
            if started - ts < ttl_ms {
                return Ok(v.clone());
            }
        }
        if let Some((at, message)) = MISSING.lock().get(&key) {
            if at.elapsed() < MISSING_FOR {
                return Err(Error::Api { status: 404, message: message.clone() });
            }
        }
    }

    let slot = IN_FLIGHT.lock().entry(key.clone()).or_default().clone();
    let result = {
        let _turn = slot.lock().await;
        match st.db.cache_get(kind, id) {
            // Whoever went first just fetched it.
            Some((v, ts)) if ts >= started || (!force && now_ms() - ts < ttl_ms) => Ok(v),
            _ => fetch_into_cache(app, kind, id, path, &key).await,
        }
    };
    {
        let mut map = IN_FLIGHT.lock();
        if Arc::strong_count(&slot) <= 2 {
            map.remove(&key);
        }
    }
    result.or_else(|e| match hit {
        Some((v, _)) if e.status() != Some(404) => Ok(v),
        _ => Err(e),
    })
}

async fn fetch_into_cache(app: &AppHandle, kind: &str, id: &str, path: &str, key: &str) -> Result<Value> {
    let st = app.state::<AppState>();
    match st.api.get(path, &[]).await {
        Ok(v) => {
            let _ = st.db.cache_put(kind, id, &v);
            if kind == "user" {
                crate::people::remember(app, [&v]);
            }
            MISSING.lock().remove(key);
            Ok(v)
        }
        Err(e) => {
            if e.status() == Some(404) {
                let mut missing = MISSING.lock();
                missing.retain(|_, (at, _)| at.elapsed() < MISSING_FOR);
                missing.insert(key.to_string(), (Instant::now(), e.to_string()));
            }
            Err(e)
        }
    }
}

pub async fn world(app: &AppHandle, world_id: &str, force: bool) -> Result<Value> {
    cached(app, "world", world_id, &format!("worlds/{world_id}"), 3_600_000, force).await
}

/// Display name for an instance owner: a user (you, a friend, or anyone via the API) or a group.
pub async fn owner_name(app: &AppHandle, owner_id: &str) -> Option<String> {
    let name = |v: &Value, k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(String::from);
    if owner_id.starts_with("grp_") {
        // Same cache entry as the group dialog.
        let g = cached(app, "group", owner_id, &format!("groups/{owner_id}?includeRoles=true"), 600_000, false).await.ok()?;
        return name(&g, "name");
    }
    if !owner_id.starts_with("usr_") {
        return None;
    }
    let known = {
        let st = app.state::<AppState>();
        let s = st.session.read();
        let me = s.user.as_ref().filter(|u| str_of(u, "id") == owner_id);
        me.or_else(|| s.friends.get(owner_id)).and_then(|u| name(u, "displayName"))
    };
    if known.is_some() {
        return known;
    }
    let u = cached(app, "user", owner_id, &format!("users/{owner_id}"), 600_000, false).await.ok()?;
    name(&u, "displayName")
}

pub async fn world_name_for(app: &AppHandle, loc: &str) -> Option<String> {
    let wid = location::world_id(loc)?;
    world(app, wid, false).await.ok().and_then(|w| w["name"].as_str().map(String::from))
}

/// A world's name for the live pipeline, which mustn't stall on a lookup: any name we've seen
/// will do (an old one is refreshed in the background), and a lookup that takes more than a
/// moment finishes in the background instead, ready for next time.
pub async fn world_name_quick(app: &AppHandle, loc: &str) -> Option<String> {
    const TTL_MS: i64 = 3_600_000;
    let wid = location::world_id(loc)?.to_string();
    let known = app.state::<AppState>().db.cache_get("world", &wid);
    if let Some((w, ts)) = &known {
        if let Some(name) = w["name"].as_str() {
            if now_ms() - ts >= TTL_MS {
                let (a, wid) = (app.clone(), wid.clone());
                tauri::async_runtime::spawn(crate::api::background(async move {
                    let _ = world(&a, &wid, false).await;
                }));
            }
            return Some(name.to_string());
        }
    }
    let a = app.clone();
    // A spawned task doesn't inherit the caller's lane; this is upkeep either way.
    let lookup = tauri::async_runtime::spawn(crate::api::background(async move { world(&a, &wid, false).await.ok() }));
    let w = tokio::time::timeout(Duration::from_secs(3), lookup).await.ok()?.ok()??;
    w["name"].as_str().map(String::from)
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
        if let Some(h) = s.friend_resync.take() {
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
    let resync = spawn_friend_resync(app.clone());
    {
        let st = app.state::<AppState>();
        let mut s = st.session.write();
        s.pipeline = Some(handle);
        s.bio_sweep = Some(sweep);
        s.friend_resync = Some(resync);
    }
    let _ = app.emit("session:ready", ());
}

/// A request came back 401. Check whether the session really ended; if so, sign back in with
/// the saved password, or end the session so nothing keeps knocking on VRChat's door.
pub async fn recover_session(app: AppHandle) {
    let st = app.state::<AppState>();
    let Ok(id) = st.me_id() else {
        st.api.revive();
        return;
    };
    match st.api.get("auth/user", &[]).await {
        // Still signed in (a successful `auth/user` lets requests through again).
        Ok(u) if u["id"].is_string() => return,
        // Offline or rate limited: can't tell, so carry on and check again on the next 401.
        Err(e) if !matches!(e.status(), Some(401 | 403)) => {
            st.api.revive();
            return;
        }
        _ => {}
    }
    if let Some(saved) = crate::session::load(&id) {
        if let (Some(u), Some(p)) = (saved.username, saved.password) {
            if let Ok(crate::commands::LoginResult::Ok { .. }) = crate::commands::auth_login(app.clone(), u, p, true).await {
                return;
            }
        }
    }
    end_session(&app);
    let _ = app.emit("session:expired", ());
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
    if let Some(h) = s.friend_resync.take() {
        h.abort();
    }
    *s = Default::default();
    st.api.clear_cookies();
    let _ = app.emit("pipeline:status", false);
}

pub async fn load_favorites(app: &AppHandle) -> Result<()> {
    let st = app.state::<AppState>();
    let list = st.api.get_all("favorites", &[("type", "friend".into())], 1000).await?;
    let map: HashMap<String, String> = list
        .iter()
        .filter_map(|f| Some((f["favoriteId"].as_str()?.to_string(), f["id"].as_str()?.to_string())))
        .collect();
    let ids: Vec<&String> = map.keys().collect();
    let _ = app.emit("favorites:update", &ids);
    st.session.write().favorites = map;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Keeping the friend list in step. Live events do most of the work, but VRChat can drop one and
// nothing arrives while the connection is down, so the list is also compared with VRChat now and
// then, on a reconnect, and when you come back to the window.

/// The friend list is compared with VRChat this often, however quiet things seem.
const RESYNC_EVERY: Duration = Duration::from_secs(5 * 60);
/// However often one is asked for, they're at least this far apart.
const RESYNC_GAP: Duration = Duration::from_secs(60);
/// Coming back to the window catches up if the list is older than this.
const RESYNC_ON_FOCUS_AFTER: Duration = Duration::from_secs(2 * 60);
/// What VRChat told us live this recently is trusted over its friend list, which can lag behind.
const LIVE_WINS_MS: i64 = 2 * 60_000;
/// A catch-up with more online/offline changes than this is a backlog (the PC was asleep, say),
/// not news: they still go in the feed, but without a desktop alert for each.
const CATCH_UP_ALERTS: usize = 3;

static LAST_SYNC: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(Default::default);
static RESYNC_WANTED: LazyLock<Notify> = LazyLock::new(Notify::new);
/// When a friend was last added or removed, in `now_ms` time.
static FRIENDSHIP_CHANGED_AT: AtomicI64 = AtomicI64::new(0);

fn since_last_sync() -> Duration {
    LAST_SYNC.lock().map_or(Duration::MAX, |t| t.elapsed())
}

/// Catch up with VRChat as soon as the pacing allows.
pub fn request_resync() {
    RESYNC_WANTED.notify_one();
}

pub fn friendship_changed() {
    FRIENDSHIP_CHANGED_AT.store(now_ms(), Ordering::SeqCst);
}

/// You're looking at Nexus again: make sure what you see isn't old.
pub fn window_focused(app: &AppHandle) {
    // The window exists a moment before the app state does.
    let signed_in = app.try_state::<AppState>().is_some_and(|st| st.me_id().is_ok());
    if signed_in && since_last_sync() >= RESYNC_ON_FOCUS_AFTER {
        request_resync();
    }
}

/// Does what the refresh button does, on its own. Runs in the background lane, so it only uses
/// spare capacity and sits out any rate limit.
pub fn spawn_friend_resync(app: AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(crate::api::background(async move {
        loop {
            tokio::select! {
                _ = RESYNC_WANTED.notified() => tokio::time::sleep(RESYNC_GAP.saturating_sub(since_last_sync())).await,
                _ = tokio::time::sleep(RESYNC_EVERY.saturating_sub(since_last_sync())) => {}
            }
            if let Err(e) = refresh_friends(&app).await {
                eprintln!("friend resync failed: {e}");
            }
            if let Err(e) = load_favorites(&app).await {
                eprintln!("favorites resync failed: {e}");
            }
        }
    }))
}

/// Did a live event about this friend arrive at or after `since`?
fn heard_live_since(friend: &Value, since: i64) -> bool {
    friend["$liveAt"].as_i64().is_some_and(|t| t >= since)
}

/// How many friends a fresh list moves in or out of "online", the changes that raise an alert.
fn presence_changes(known: &HashMap<String, Value>, fresh: &[(String, Value)]) -> usize {
    let online = |f: &Value| str_of(f, "state") == "online";
    fresh.iter().filter(|(id, f)| known.get(id).is_some_and(|old| online(old) != online(f))).count()
}

/// Re-pull the full friend list. When we already had one, the diff against it feeds the timeline.
pub async fn refresh_friends(app: &AppHandle) -> Result<()> {
    let st = app.state::<AppState>();
    *LAST_SYNC.lock() = Some(Instant::now());
    let started = now_ms();
    let live_cutoff = started - LIVE_WINS_MS;
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
    // Nobody loses all their friends at once: this is VRChat having a moment.
    if list.is_empty() && me["friends"].as_array().is_some_and(|a| !a.is_empty()) {
        return Err(Error::Other("VRChat returned an empty friends list.".into()));
    }
    // So the game log can still show who someone was after they stop being a friend.
    crate::people::remember(app, list.iter().chain([&me]));

    let had_snapshot = !st.session.read().friends.is_empty();
    // Someone added or removed just now may not be reflected in this list yet: look again shortly.
    if had_snapshot && FRIENDSHIP_CHANGED_AT.load(Ordering::SeqCst) >= live_cutoff {
        request_resync();
        return Ok(());
    }

    let mut seen = HashSet::new();
    let mut fresh = Vec::with_capacity(list.len());
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
        fresh.push((id, f));
    }

    if had_snapshot {
        let alerts = {
            let s = st.session.read();
            fresh.retain(|(id, _)| !s.friends.get(id).is_some_and(|known| heard_live_since(known, live_cutoff)));
            presence_changes(&s.friends, &fresh) <= CATCH_UP_ALERTS
        };
        for (id, f) in fresh {
            let (old, new) = merge_friend(&st, &id, f, None, None);
            if let Some(old) = old {
                diff_feed(app, &owner, &old, &new, alerts);
            }
        }
    } else {
        let mut s = st.session.write();
        for (id, mut f) in fresh {
            // "Here since" only means something for friends who are on; offline ones keep VRChat's last-seen time.
            if str_of(&f, "state") != "offline" {
                f["$locationAt"] = json!(now_ms());
            }
            s.friends.insert(id, f);
        }
    }

    // Anyone missing from the fresh list is no longer a friend.
    let stale: Vec<String> = {
        let s = st.session.read();
        s.friends.iter().filter(|(id, f)| !seen.contains(*id) && !heard_live_since(f, live_cutoff)).map(|(id, _)| id.clone()).collect()
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
                let body = if had_snapshot { "" } else { "Noticed when you signed in" };
                toast(app, &format!("{name} is no longer your friend"), body);
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

/// Apply something VRChat just told us about a friend and record what changed.
pub fn apply_friend(app: &AppHandle, id: &str, mut patch: Value, state: Option<&str>, world_name: Option<String>) {
    let st = app.state::<AppState>();
    let Ok(owner) = st.me_id() else { return };
    if let Some(p) = patch.as_object_mut() {
        p.insert("$liveAt".into(), json!(now_ms()));
    }
    let (old, new) = merge_friend(&st, id, patch, state, world_name);
    let _ = app.emit("friend:update", &new);
    if let Some(old) = old {
        diff_feed(app, &owner, &old, &new, true);
    }
}

/// Merge a patch into a friend. Returns what they looked like before, if we knew them, and now.
fn merge_friend(st: &AppState, id: &str, patch: Value, state: Option<&str>, world_name: Option<String>) -> (Option<Value>, Value) {
    let now = now_ms();
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
}

fn diff_feed(app: &AppHandle, owner: &str, old: &Value, new: &Value, alerts: bool) {
    let id = str_of(new, "id");
    let name = str_of(new, "displayName");
    let (os, ns) = (str_of(old, "state"), str_of(new, "state"));
    let (ol, nl) = (str_of(old, "location"), str_of(new, "location"));
    let world_name = new["$worldName"].as_str().map(String::from);
    let settings = app.state::<AppState>().settings();

    if os != "online" && ns == "online" {
        push_feed(app, owner, "online", id, name, Some(nl.into()), world_name.clone(), None, None);
        if alerts && (in_scope(app, settings.notify_online, id) || app.state::<AppState>().is_watched(id)) {
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
        if alerts && (in_scope(app, settings.notify_offline, id) || app.state::<AppState>().is_watched(id)) {
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
/// Friends with activity during their cooldown, for the sweep to look at once it's over.
static PROFILE_RECHECK: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// Fetch a profile fresh, cache it, and record a "bio" feed entry if it changed since last seen.
pub async fn fetch_profile(app: &AppHandle, user_id: &str) -> Result<Value> {
    let st = app.state::<AppState>();
    let mine = st.me_id().map(|m| m == user_id).unwrap_or(false);
    let path = if mine { format!("profile/{user_id}?asSelf=true") } else { format!("profile/{user_id}") };
    let old = st.db.cache_get("profile", user_id).map(|(v, _)| v);
    let new = st.api.get(&path, &[]).await?;
    let _ = st.db.cache_put("profile", user_id, &new);
    LAST_PROFILE_CHECK.lock().insert(user_id.to_string(), Instant::now());
    if old.as_ref() != Some(&new) {
        let _ = app.emit("profile:update", json!({ "id": user_id, "profile": new }));
    }

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
            PROFILE_RECHECK.lock().insert(user_id.to_string());
            return;
        }
        // Reserve the slot now so bursts of events don't queue duplicate fetches.
        last.insert(user_id.to_string(), Instant::now());
    }
    let (app, id) = (app.clone(), user_id.to_string());
    tauri::async_runtime::spawn(crate::api::background(async move {
        if let Err(e) = fetch_profile(&app, &id).await {
            eprintln!("profile check for {id} failed: {e}");
        }
    }));
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
    {
        let mut recheck = PROFILE_RECHECK.lock();
        recheck.retain(|id| s.friends.contains_key(id));
        let due = recheck.iter().find(|id| last.get(*id).is_none_or(|t| t.elapsed() >= PROFILE_CHECK_COOLDOWN)).cloned();
        if let Some(id) = due {
            recheck.remove(&id);
            return Some(id);
        }
    }
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

/// Runs in the background lane, so it only uses spare capacity and sits out any rate limit.
pub fn spawn_bio_sweep(app: AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(crate::api::background(async move {
        // Let the login burst (friends list, favorites, pipeline) settle first.
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            if let Some(id) = next_sweep_target(&app) {
                if let Err(e) = fetch_profile(&app, &id).await {
                    eprintln!("bio sweep for {id} failed: {e}");
                }
            }
            tokio::time::sleep(SWEEP_PAUSE).await;
        }
    }))
}

/// Friends you just unfriended or blocked yourself, so VRChat's "friend-delete" for them doesn't
/// tell you about something you did.
static EXPECTED_UNFRIENDS: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);

pub fn expect_unfriend(id: &str) {
    let mut m = EXPECTED_UNFRIENDS.lock();
    m.retain(|_, t| t.elapsed() < Duration::from_secs(120));
    m.insert(id.to_string(), Instant::now());
}

pub fn remove_friend(app: &AppHandle, id: &str) {
    friendship_changed();
    let st = app.state::<AppState>();
    let removed = st.session.write().friends.remove(id);
    let _ = app.emit("friend:remove", id);
    if let (Ok(owner), Some(f)) = (st.me_id(), removed) {
        let name = str_of(&f, "displayName");
        let _ = st.db.friend_log_set(&owner, id, name, false);
        push_feed(app, &owner, "unfriend", id, name, None, None, None, None);
        let yours = EXPECTED_UNFRIENDS.lock().remove(id).is_some_and(|t| t.elapsed() < Duration::from_secs(120));
        if st.settings().notify_unfriends && !yours {
            toast(app, &format!("{name} is no longer your friend"), "");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_live_news_beats_the_friend_list() {
        let cutoff = 1_000;
        assert!(heard_live_since(&json!({ "$liveAt": 1_000 }), cutoff));
        assert!(heard_live_since(&json!({ "$liveAt": 5_000 }), cutoff));
        assert!(!heard_live_since(&json!({ "$liveAt": 999 }), cutoff));
        // Everything we know about them came from a list, so the next list may correct it.
        assert!(!heard_live_since(&json!({ "state": "online" }), cutoff));
    }

    #[test]
    fn only_moves_in_or_out_of_online_count_as_alert_worthy() {
        let friend = |state: &str| json!({ "state": state });
        let known: HashMap<String, Value> = [
            ("went_online", "offline"),
            ("went_offline", "online"),
            ("left_game_for_web", "online"),
            ("opened_web", "offline"),
            ("still_online", "online"),
        ]
        .into_iter()
        .map(|(id, state)| (id.to_string(), friend(state)))
        .collect();
        let fresh: Vec<(String, Value)> = [
            ("went_online", "online"),
            ("went_offline", "offline"),
            ("left_game_for_web", "active"),
            ("opened_web", "active"),
            ("still_online", "online"),
            ("new_friend", "online"),
        ]
        .into_iter()
        .map(|(id, state)| (id.to_string(), friend(state)))
        .collect();
        assert_eq!(presence_changes(&known, &fresh), 3);
    }

    #[test]
    fn merging_keeps_the_marks_a_fresh_list_does_not_carry() {
        let st = AppState::new(crate::db::Db::memory().unwrap());
        st.session.write().friends.insert(
            "usr_1".into(),
            json!({ "id": "usr_1", "location": "wrld_a:1", "state": "online", "$liveAt": 42, "$worldName": "A" }),
        );

        // Same place: nothing about where they are changes.
        let (old, new) = merge_friend(&st, "usr_1", json!({ "location": "wrld_a:1", "status": "busy" }), None, None);
        assert!(old.is_some());
        assert_eq!((new["status"].as_str(), new["$liveAt"].as_i64(), new["$worldName"].as_str()), (Some("busy"), Some(42), Some("A")));

        // Moved on: the world name no longer applies, and "here since" restarts.
        let (_, new) = merge_friend(&st, "usr_1", json!({ "location": "wrld_b:2" }), None, None);
        assert!(new.get("$worldName").is_none());
        assert!(new["$locationAt"].is_i64());
        assert_eq!(new["$liveAt"].as_i64(), Some(42));

        // Someone we didn't know about.
        let (old, new) = merge_friend(&st, "usr_2", json!({ "location": "offline" }), Some("offline"), None);
        assert!(old.is_none());
        assert_eq!((new["id"].as_str(), new["state"].as_str()), (Some("usr_2"), Some("offline")));
    }
}
