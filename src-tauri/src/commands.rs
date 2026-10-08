//! The `invoke()` surface used by the React UI.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::db::{FeedEntry, FeedQuery, GlEvent, GlQuery, GlSession, Insights, UserHistory};
use crate::error::{Error, Result};
use crate::gamelog::InstanceState;
use crate::location;
use crate::session;
use crate::settings::AppSettings;
use crate::state::{AppState, PendingLogin};
use crate::sync::{self, str_of};

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoginResult {
    Ok { user: Value },
    #[serde(rename_all = "camelCase")]
    TwoFactor { methods: Vec<String> },
    LoggedOut { username: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub display_name: String,
    pub thumbnail: Option<String>,
    pub username: Option<String>,
}

fn accounts(st: &AppState) -> Vec<Account> {
    st.db.kv_json("accounts").unwrap_or_default()
}

fn save_accounts(st: &AppState, list: &[Account]) -> Result<()> {
    st.db.kv_set("accounts", &serde_json::to_string(list)?)
}

fn thumb(user: &Value) -> Option<String> {
    ["iconUrl", "userIcon", "profilePicOverrideThumbnail", "currentAvatarThumbnailImageUrl"]
        .iter()
        .find_map(|k| user[*k].as_str().filter(|s| !s.is_empty()).map(String::from))
}

async fn finish_login(app: &AppHandle, user: Value, creds: Option<PendingLogin>) -> Result<LoginResult> {
    let st = app.state::<AppState>();
    let id = str_of(&user, "id").to_string();
    let prev = session::load(&id).unwrap_or_default();
    let mut saved = session::Saved { cookies: st.api.cookies(), username: prev.username, password: prev.password };
    if let Some(c) = creds {
        saved.username = Some(c.username);
        saved.password = c.remember.then_some(c.password);
    }
    session::save(&id, &saved)?;

    let mut list = accounts(&st);
    list.retain(|a| a.id != id);
    list.insert(
        0,
        Account {
            id: id.clone(),
            display_name: str_of(&user, "displayName").to_string(),
            thumbnail: thumb(&user),
            username: saved.username.clone(),
        },
    );
    save_accounts(&st, &list)?;
    st.db.kv_set("last_account", &id)?;

    tauri::async_runtime::spawn(sync::start_session(app.clone(), user.clone()));
    Ok(LoginResult::Ok { user })
}

// ---------------------------------------------------------------------------------------------
// Auth

#[tauri::command]
pub async fn auth_login(app: AppHandle, username: String, password: String, remember: bool) -> Result<LoginResult> {
    let st = app.state::<AppState>();
    sync::end_session(&app);
    // Reuse a remembered 2FA cookie so trusted devices skip the prompt.
    let known = accounts(&st)
        .into_iter()
        .find(|a| a.username.as_deref().is_some_and(|u| u.eq_ignore_ascii_case(&username)));
    if let Some(tfa) = known.and_then(|a| session::load(&a.id)).and_then(|s| s.cookies.get("twoFactorAuth").cloned()) {
        st.api.set_cookies(HashMap::from([("twoFactorAuth".to_string(), tfa)]));
    }
    let user = st.api.login(&username, &password).await?;
    let creds = PendingLogin { username, password, remember };
    if let Some(methods) = user["requiresTwoFactorAuth"].as_array() {
        *st.pending.lock() = Some(creds);
        let methods = methods.iter().filter_map(|m| m.as_str().map(String::from)).collect();
        return Ok(LoginResult::TwoFactor { methods });
    }
    finish_login(&app, user, Some(creds)).await
}

#[tauri::command]
pub async fn auth_verify(app: AppHandle, method: String, code: String) -> Result<LoginResult> {
    let st = app.state::<AppState>();
    let path = match method.as_str() {
        "totp" => "auth/twofactorauth/totp/verify",
        "otp" => "auth/twofactorauth/otp/verify",
        "emailOtp" | "emailotp" => "auth/twofactorauth/emailotp/verify",
        _ => return Err(Error::Other(format!("Unknown 2FA method {method}"))),
    };
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    let res = st.api.post(path, &json!({ "code": code })).await?;
    if res["verified"] == json!(false) {
        return Err(Error::Other("That code didn't work. Try again.".into()));
    }
    let user = st.api.get("auth/user", &[]).await?;
    let creds = st.pending.lock().take();
    finish_login(&app, user, creds).await
}

#[tauri::command]
pub async fn auth_restore(app: AppHandle, user_id: Option<String>) -> Result<LoginResult> {
    let st = app.state::<AppState>();
    let Some(id) = user_id.or_else(|| st.db.kv_get("last_account")).filter(|s| !s.is_empty()) else {
        return Ok(LoginResult::LoggedOut { username: None });
    };
    let Some(saved) = session::load(&id) else {
        let username = accounts(&st).into_iter().find(|a| a.id == id).and_then(|a| a.username);
        return Ok(LoginResult::LoggedOut { username });
    };
    sync::end_session(&app);
    st.api.set_cookies(saved.cookies.clone());
    match st.api.get("auth/user", &[]).await {
        Ok(user) if user["id"].is_string() => finish_login(&app, user, None).await,
        Err(e) if e.status().is_none() => Err(e), // offline: surface the network error
        _ => {
            if let (Some(u), Some(p)) = (saved.username.clone(), saved.password.clone()) {
                return auth_login(app.clone(), u, p, true).await;
            }
            st.api.clear_cookies();
            Ok(LoginResult::LoggedOut { username: saved.username })
        }
    }
}

#[tauri::command]
pub async fn auth_logout(app: AppHandle) -> Result<()> {
    let st = app.state::<AppState>();
    if let Ok(id) = st.me_id() {
        let _ = st.api.put("logout", &json!({})).await;
        // Keep the 2FA trust cookie and username so the next login is painless.
        if let Some(mut saved) = session::load(&id) {
            saved.cookies.retain(|k, _| k == "twoFactorAuth");
            saved.password = None;
            let _ = session::save(&id, &saved);
        }
    }
    st.db.kv_set("last_account", "")?;
    sync::end_session(&app);
    Ok(())
}

#[tauri::command]
pub fn accounts_list(app: AppHandle) -> Vec<Account> {
    accounts(&app.state::<AppState>())
}

#[tauri::command]
pub fn account_remove(app: AppHandle, user_id: String) -> Result<()> {
    let st = app.state::<AppState>();
    session::delete(&user_id);
    let mut list = accounts(&st);
    list.retain(|a| a.id != user_id);
    save_accounts(&st, &list)
}

// ---------------------------------------------------------------------------------------------
// Friends & users

#[tauri::command]
pub fn me_get(app: AppHandle) -> Option<Value> {
    app.state::<AppState>().session.read().user.clone()
}

#[tauri::command]
pub fn friends_list(app: AppHandle) -> Value {
    let st = app.state::<AppState>();
    let s = st.session.read();
    json!({
        "friends": s.friends.values().collect::<Vec<_>>(),
        "favorites": s.favorites.keys().collect::<Vec<_>>(),
    })
}

#[tauri::command]
pub async fn friends_refresh(app: AppHandle) -> Result<RefreshResult> {
    // A full list refresh costs several requests (account, every friends page, favorites).
    const COOLDOWN: std::time::Duration = std::time::Duration::from_secs(60);
    if let Some(wait) = claim_refresh_for("friends", COOLDOWN) {
        return Ok(wait);
    }
    sync::refresh_friends(&app).await?;
    sync::load_favorites(&app).await?;
    Ok(RefreshResult { refreshed: true, retry_in_ms: COOLDOWN.as_millis() as u64 })
}

#[tauri::command]
pub async fn user_get(app: AppHandle, user_id: String, force: Option<bool>) -> Result<Value> {
    sync::cached(&app, "user", &user_id, &format!("users/{user_id}"), 600_000, force.unwrap_or(false)).await
}

/// Bio, links, badges, languages and represented group live on `/profile/{id}` since VRChat's
/// 2026 API change; `/users/{id}` no longer returns them.
#[tauri::command]
pub async fn profile_get(app: AppHandle, user_id: String, force: Option<bool>) -> Result<Value> {
    // `asSelf` adds what VRChat shows you on your own profile (e.g. hidden badges).
    // Serve a fresh-enough cached copy; otherwise refetch (which also records bio changes).
    if !force.unwrap_or(false) {
        if let Some((v, ts)) = app.state::<AppState>().db.cache_get("profile", &user_id) {
            if crate::db::now_ms() - ts < 600_000 {
                return Ok(v);
            }
        }
    }
    match sync::fetch_profile(&app, &user_id).await {
        Ok(v) => Ok(v),
        Err(e) => match app.state::<AppState>().db.cache_get("profile", &user_id) {
            Some((v, _)) if e.status() != Some(404) => Ok(v),
            _ => Err(e),
        },
    }
}

// ---------------------------------------------------------------------------------------------
// Editing your own profile

/// `PUT /profile/{me}`: bio, bioLinks, languages, userIcon, bannerType, bannerColor,
/// iconFrame, nameplateEffect and profileEffect (inventory template ids, `invt_…`).
#[tauri::command]
pub async fn profile_update(app: AppHandle, patch: Value) -> Result<Value> {
    let st = app.state::<AppState>();
    let id = st.me_id()?;
    let allowed = ["bio", "bioLinks", "languages", "userIcon", "bannerType", "bannerColor", "iconFrame", "nameplateEffect", "profileEffect"];
    for key in ["iconFrame", "nameplateEffect", "profileEffect"] {
        if let Some(v) = patch.get(key) {
            let ok = v.as_str().is_some_and(|s| {
                s.strip_prefix("invt_").is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
            });
            if !ok {
                return Err(Error::Other(format!("Invalid {key} id.")));
            }
        }
    }
    let body: serde_json::Map<String, Value> = patch
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(k, _)| allowed.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let res = st.api.put(&format!("profile/{id}"), &Value::Object(body)).await?;
    let _ = st.db.cache_put("profile", &id, &res);
    Ok(res)
}

/// Account toggles editable through `PUT /users/{me}`.
const ME_TOGGLES: [&str; 5] = [
    "allowAvatarCopying",
    "isBoopingEnabled",
    "receiveMobileInvitations",
    "hasSharedConnectionsOptOut",
    "hasDiscordFriendsOptOut",
];
/// VRChat omits these from the user object while they're off, so "absent" means false.
const ABSENT_MEANS_FALSE: [&str; 1] = ["hasSharedConnectionsOptOut"];

/// Fields that still live on the user object (pronouns and account toggles). Keeps the session user in step.
#[tauri::command]
pub async fn me_update(app: AppHandle, pronouns: Option<String>, toggles: Option<HashMap<String, bool>>) -> Result<Value> {
    let st = app.state::<AppState>();
    let id = st.me_id()?;
    let mut body = json!({});
    if let Some(p) = pronouns {
        body["pronouns"] = json!(p.chars().take(32).collect::<String>());
    }
    let toggles = toggles.unwrap_or_default();
    for (k, v) in &toggles {
        if !ME_TOGGLES.contains(&k.as_str()) {
            return Err(Error::Other(format!("{k} can't be changed from Nexus.")));
        }
        body[k] = json!(v);
    }
    let res = st.api.put(&format!("users/{id}"), &body).await?;
    // Some of these aren't in VRChat's published API; confirm the change really stuck.
    for (k, v) in &toggles {
        let actual = res.get(k).and_then(Value::as_bool).or_else(|| ABSENT_MEANS_FALSE.contains(&k.as_str()).then_some(false));
        if actual != Some(*v) {
            return Err(Error::Other("VRChat didn't apply that setting. Try changing it in VRChat instead.".into()));
        }
    }
    let updated = {
        let mut s = st.session.write();
        if let (Some(me), Some(patch)) = (s.user.as_mut(), res.as_object()) {
            if let Some(obj) = me.as_object_mut() {
                for (k, v) in patch {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        s.user.clone()
    };
    if let Some(u) = &updated {
        let _ = app.emit("user:update", u);
    }
    Ok(updated.unwrap_or(res))
}

#[tauri::command]
pub async fn badge_set(app: AppHandle, badge_id: String, showcased: bool) -> Result<()> {
    let st = app.state::<AppState>();
    let id = st.me_id()?;
    st.api.put(&format!("users/{id}/badges/{badge_id}"), &json!({ "showcased": showcased })).await?;
    Ok(())
}

#[tauri::command]
pub async fn group_represent(app: AppHandle, group_id: String, representing: bool) -> Result<()> {
    let st = app.state::<AppState>();
    st.api
        .put(&format!("groups/{group_id}/representation"), &json!({ "isRepresenting": representing }))
        .await?;
    if let Ok(id) = st.me_id() {
        // The cached group list and profile now show the wrong represented group.
        let _ = st.db.conn().execute("DELETE FROM cache WHERE id = ?1 AND kind IN ('groups', 'profile')", [id]);
    }
    Ok(())
}

#[tauri::command]
pub async fn icons_list(app: AppHandle) -> Result<Value> {
    app.state::<AppState>().api.get("files", &[("tag", "icon".into()), ("n", "100".into())]).await
}

fn decode_png(data: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| Error::Other(format!("Bad image data: {e}")))?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(Error::Other("Images must be under 10 MB.".into()));
    }
    Ok(bytes)
}

/// Upload a PNG as a new profile icon (VRChat requires VRC+). `data` is base64.
#[tauri::command]
pub async fn icon_upload(app: AppHandle, data: String) -> Result<Value> {
    app.state::<AppState>().api.upload("icon", "file", decode_png(&data)?, &[]).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadOptions {
    note: Option<String>,
    animation_style: Option<String>,
    mask_tag: Option<String>,
}

/// Upload an image to one of VRChat's image libraries. `kind`: icon | gallery | emoji | sticker | print.
#[tauri::command]
pub async fn image_upload(app: AppHandle, kind: String, data: String, options: Option<UploadOptions>) -> Result<Value> {
    let api = &app.state::<AppState>().api;
    let bytes = decode_png(&data)?;
    let opts = options.unwrap_or(UploadOptions { note: None, animation_style: None, mask_tag: None });
    match kind.as_str() {
        "icon" => api.upload("icon", "file", bytes, &[]).await,
        "gallery" => api.upload("gallery", "file", bytes, &[]).await,
        "emoji" | "sticker" => {
            let mut fields = vec![("tag", kind.clone())];
            if let Some(a) = opts.animation_style.filter(|s| !s.is_empty()) {
                fields.push(("animationStyle", a));
            }
            if let Some(m) = opts.mask_tag.filter(|s| !s.is_empty()) {
                fields.push(("maskTag", m));
            }
            api.upload("file/image", "file", bytes, &fields).await
        }
        "print" => {
            let mut fields = vec![("timestamp", chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true))];
            if let Some(n) = opts.note.filter(|s| !s.is_empty()) {
                fields.push(("note", n));
            }
            api.upload("prints", "image", bytes, &fields).await
        }
        _ => Err(Error::Other(format!("Unknown upload type {kind}"))),
    }
}

/// Image files by tag (comma-separated, any match): icon, gallery, emoji, emojianimated, sticker.
#[tauri::command]
pub async fn files_list(app: AppHandle, tag: String) -> Result<Value> {
    app.state::<AppState>().api.get("files", &[("tag", tag), ("n", "100".into())]).await
}

#[tauri::command]
pub async fn prints_list(app: AppHandle) -> Result<Value> {
    let st = app.state::<AppState>();
    let id = st.me_id()?;
    st.api.get(&format!("prints/user/{id}"), &[("n", "100".into())]).await
}

/// Inventory items of one type (e.g. portalskin, warpeffect), newest first.
/// Every non-archived inventory item, across pages (VRChat caps a page at 100).
#[tauri::command]
pub async fn inventory_all(app: AppHandle) -> Result<Vec<Value>> {
    let api = &app.state::<AppState>().api;
    let mut out = Vec::new();
    let mut offset = 0usize;
    loop {
        let page = api
            .get(
                "inventory",
                &[("n", "100".into()), ("offset", offset.to_string()), ("archived", "false".into()), ("order", "newest".into())],
            )
            .await?;
        let items = page["data"].as_array().cloned().unwrap_or_default();
        let total = page["totalCount"].as_u64().unwrap_or(0) as usize;
        let len = items.len();
        out.extend(items);
        offset += len;
        if len == 0 || offset >= total || offset >= 5000 {
            break;
        }
    }
    Ok(out)
}

/// VRChat takes the slot name in place of the item id to unequip a slot.
/// Only the profile decorations Nexus manages (Edit profile) can be cleared.
#[tauri::command]
pub async fn inventory_unequip(app: AppHandle, slot: String) -> Result<Value> {
    const SLOTS: [&str; 3] = ["iconFrame", "nameplateEffect", "profileEffect"];
    if !SLOTS.contains(&slot.as_str()) {
        return Err(Error::Other(format!("Unknown equip slot {slot}")));
    }
    app.state::<AppState>().api.delete(&format!("inventory/{slot}/equip")).await
}

/// Image libraries Nexus manages; deletes are refused for any other kind of file.
const DELETABLE_FILE_TAGS: [&str; 5] = ["icon", "gallery", "emoji", "emojianimated", "sticker"];

/// Permanently delete something from your VRChat inventory.
/// `kind`: "print" (prnt_) or "file" (file_ — icons, banners, emojis).
#[tauri::command]
pub async fn inventory_delete(app: AppHandle, kind: String, id: String) -> Result<()> {
    let st = app.state::<AppState>();
    let me = st.me_id()?;
    let valid = |prefix: &str| id.starts_with(prefix) && id.len() > prefix.len() && id[prefix.len()..].chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    match kind.as_str() {
        "print" if valid("prnt_") => {
            st.api.delete(&format!("prints/{id}")).await?;
        }
        "file" if valid("file_") => {
            // Make sure it's your own image file, never an avatar/world package.
            let file = st.api.get(&format!("file/{id}"), &[]).await?;
            let owned = str_of(&file, "ownerId") == me;
            let tagged = file["tags"]
                .as_array()
                .is_some_and(|t| t.iter().any(|v| v.as_str().is_some_and(|s| DELETABLE_FILE_TAGS.contains(&s))));
            if !owned || !tagged {
                return Err(Error::Other("That file isn't one of your inventory images, so it wasn't deleted.".into()));
            }
            st.api.delete(&format!("file/{id}")).await?;
        }
        _ => return Err(Error::Other("That item can't be deleted.".into())),
    }
    Ok(())
}

#[tauri::command]
pub async fn avatar_lists(app: AppHandle) -> Result<Value> {
    app.state::<AppState>().api.get("favorite/groups", &[("type", "avatar".into()), ("n", "50".into())]).await
}

const REFRESH_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(30);
static LAST_REFRESH: std::sync::LazyLock<parking_lot::Mutex<HashMap<String, std::time::Instant>>> =
    std::sync::LazyLock::new(Default::default);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    /// False when the request was ignored because of the cooldown.
    pub refreshed: bool,
    /// How long until this profile may be refreshed again.
    pub retry_in_ms: u64,
}

/// Claim the refresh slot for `key`, or return the "try again later" result if it's cooling down.
/// Claimed before any await so concurrent clicks are rejected too.
fn claim_refresh(key: &str) -> Option<RefreshResult> {
    claim_refresh_for(key, REFRESH_COOLDOWN)
}

fn claim_refresh_for(key: &str, cooldown: std::time::Duration) -> Option<RefreshResult> {
    let mut last = LAST_REFRESH.lock();
    if let Some(t) = last.get(key) {
        let elapsed = t.elapsed();
        if elapsed < cooldown {
            return Some(RefreshResult { refreshed: false, retry_in_ms: (cooldown - elapsed).as_millis() as u64 });
        }
    }
    last.insert(key.to_string(), std::time::Instant::now());
    None
}

/// On-demand world/group refresh, with the same per-item 30 s cooldown as profiles.
#[tauri::command]
pub async fn entity_refresh(app: AppHandle, kind: String, id: String) -> Result<RefreshResult> {
    let prefix = match kind.as_str() {
        "world" => "wrld_",
        "group" => "grp_",
        _ => return Err(Error::Other(format!("Can't refresh {kind}."))),
    };
    if !id.starts_with(prefix) {
        return Err(Error::Other("Invalid id.".into()));
    }
    if let Some(wait) = claim_refresh(&id) {
        return Ok(wait);
    }
    match kind.as_str() {
        "world" => {
            sync::world(&app, &id, true).await?;
        }
        _ => {
            sync::cached(&app, "group", &id, &format!("groups/{id}?includeRoles=true"), 0, true).await?;
        }
    }
    Ok(RefreshResult { refreshed: true, retry_in_ms: REFRESH_COOLDOWN.as_millis() as u64 })
}

/// On-demand profile refresh. At most once per user per 30 s, enforced here so spamming the
/// button (or anything else) can never turn into a burst of VRChat API calls.
#[tauri::command]
pub async fn profile_refresh(app: AppHandle, user_id: String) -> Result<RefreshResult> {
    if !user_id.starts_with("usr_") {
        return Err(Error::Other("Not a user id.".into()));
    }
    if let Some(wait) = claim_refresh(&user_id) {
        return Ok(wait);
    }

    let st = app.state::<AppState>();
    let mine = st.me_id().map(|m| m == user_id).unwrap_or(false);
    let user = sync::cached(&app, "user", &user_id, &format!("users/{user_id}"), 0, true).await?;
    sync::fetch_profile(&app, &user_id).await?;
    // Drop secondary caches so the open tabs reload fresh data.
    let _ = st.db.conn().execute("DELETE FROM cache WHERE id = ?1 AND kind = 'groups'", [&user_id]);

    if mine {
        let me = st.api.get("auth/user", &[]).await?;
        let updated = {
            let mut s = st.session.write();
            if let (Some(cur), Some(patch)) = (s.user.as_mut(), me.as_object()) {
                if let Some(obj) = cur.as_object_mut() {
                    for (k, v) in patch {
                        obj.insert(k.clone(), v.clone());
                    }
                }
            }
            s.user.clone()
        };
        if let Some(u) = updated {
            let _ = app.emit("user:update", &u);
        }
    } else if st.is_friend(&user_id) {
        // Keep live presence in step too (records any status/location change in the feed).
        let state = str_of(&user, "state").to_string();
        let mut patch = json!({});
        for k in ["status", "statusDescription", "location", "displayName", "last_login", "last_activity", "last_platform"] {
            if let Some(v) = user.get(k) {
                patch[k] = v.clone();
            }
        }
        let state = (!state.is_empty()).then_some(state);
        sync::apply_friend(&app, &user_id, patch, state.as_deref(), None);
    }

    Ok(RefreshResult { refreshed: true, retry_in_ms: REFRESH_COOLDOWN.as_millis() as u64 })
}

#[tauri::command]
pub async fn user_groups(app: AppHandle, user_id: String) -> Result<Value> {
    sync::cached(&app, "groups", &user_id, &format!("users/{user_id}/groups"), 600_000, false).await
}

#[tauri::command]
pub async fn group_get(app: AppHandle, group_id: String) -> Result<Value> {
    sync::cached(&app, "group", &group_id, &format!("groups/{group_id}?includeRoles=true"), 600_000, false).await
}

#[tauri::command]
pub async fn group_instances(app: AppHandle, group_id: String) -> Result<Value> {
    app.state::<AppState>().api.get(&format!("groups/{group_id}/instances"), &[]).await
}

fn check_group_id(id: &str) -> Result<()> {
    let ok = id.strip_prefix("grp_").is_some_and(|r| !r.is_empty() && r.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    if ok {
        Ok(())
    } else {
        Err(Error::Other("Not a group id.".into()))
    }
}

/// Forget cached data that a membership change makes stale.
fn forget_group(st: &AppState, group_id: &str) {
    let me = st.me_id().unwrap_or_default();
    let _ = st.db.conn().execute(
        "DELETE FROM cache WHERE (kind = 'group' AND id = ?1) OR (kind IN ('groups', 'profile') AND id = ?2)",
        [group_id, me.as_str()],
    );
}

/// Search groups by name or short code.
#[tauri::command]
pub async fn groups_search(app: AppHandle, query: String, offset: Option<u32>) -> Result<Value> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(Value::Array(vec![]));
    }
    app.state::<AppState>()
        .api
        .get("groups", &[("query", query), ("n", "50".into()), ("offset", offset.unwrap_or(0).to_string())])
        .await
}

/// Join a group. VRChat decides the outcome: open groups join immediately ("member"),
/// request-to-join groups create a request ("requested"), invite-only ones refuse.
#[tauri::command]
pub async fn group_join(app: AppHandle, group_id: String) -> Result<Value> {
    check_group_id(&group_id)?;
    let st = app.state::<AppState>();
    let res = st.api.post(&format!("groups/{group_id}/join"), &json!({})).await?;
    forget_group(&st, &group_id);
    Ok(res)
}

#[tauri::command]
pub async fn group_leave(app: AppHandle, group_id: String) -> Result<()> {
    check_group_id(&group_id)?;
    let st = app.state::<AppState>();
    st.api.post(&format!("groups/{group_id}/leave"), &json!({})).await?;
    forget_group(&st, &group_id);
    Ok(())
}

#[tauri::command]
pub async fn group_cancel_request(app: AppHandle, group_id: String) -> Result<()> {
    check_group_id(&group_id)?;
    let st = app.state::<AppState>();
    st.api.delete(&format!("groups/{group_id}/requests")).await?;
    forget_group(&st, &group_id);
    Ok(())
}

/// Open instances across every group you're in, in one call.
#[tauri::command]
pub async fn my_group_instances(app: AppHandle) -> Result<Value> {
    let st = app.state::<AppState>();
    let id = st.me_id()?;
    let res = st.api.get(&format!("users/{id}/instances/groups"), &[]).await?;
    Ok(res.get("instances").cloned().unwrap_or(res))
}

/// Rate-limited "refresh now" for the Group Instances page (the page reloads after this succeeds).
#[tauri::command]
pub fn my_group_instances_refresh() -> RefreshResult {
    claim_refresh_for("group-instances", REFRESH_COOLDOWN)
        .unwrap_or(RefreshResult { refreshed: true, retry_in_ms: REFRESH_COOLDOWN.as_millis() as u64 })
}

#[tauri::command]
pub async fn group_members(app: AppHandle, group_id: String, offset: Option<u32>) -> Result<Value> {
    app.state::<AppState>()
        .api
        .get(
            &format!("groups/{group_id}/members"),
            &[("n", "100".into()), ("offset", offset.unwrap_or(0).to_string()), ("sort", "joinedAt:asc".into())],
        )
        .await
}

#[tauri::command]
pub async fn group_members_search(app: AppHandle, group_id: String, query: String) -> Result<Value> {
    let res = app
        .state::<AppState>()
        .api
        .get(&format!("groups/{group_id}/members/search"), &[("query", query), ("n", "100".into())])
        .await?;
    // The search endpoint wraps results as { results: [...] } on some API versions.
    Ok(res.get("results").cloned().unwrap_or(res))
}

#[tauri::command]
pub async fn group_posts(app: AppHandle, group_id: String) -> Result<Value> {
    app.state::<AppState>().api.get(&format!("groups/{group_id}/posts"), &[("n", "20".into())]).await
}

#[tauri::command]
pub async fn user_mutuals(app: AppHandle, user_id: String) -> Result<Value> {
    let api = &app.state::<AppState>().api;
    let counts = api.get(&format!("users/{user_id}/mutuals"), &[]).await?;
    let friends = api
        .get(&format!("users/{user_id}/mutuals/friends"), &[("n", "100".into())])
        .await
        .unwrap_or(Value::Array(vec![]));
    Ok(json!({ "counts": counts, "friends": friends }))
}

#[tauri::command]
pub async fn user_worlds(app: AppHandle, user_id: String) -> Result<Value> {
    let st = app.state::<AppState>();
    let mine = st.me_id().map(|m| m == user_id).unwrap_or(false);
    if mine {
        st.api
            .get("worlds", &[("user", "me".into()), ("releaseStatus", "all".into()), ("sort", "updated".into()), ("n", "100".into())])
            .await
    } else {
        st.api
            .get(
                "worlds",
                &[("userId", user_id), ("releaseStatus", "public".into()), ("sort", "updated".into()), ("n", "100".into())],
            )
            .await
    }
}

/// VRChat's own per-user note (synced to the game), distinct from Nexus' local memo.
#[tauri::command]
pub async fn user_note_set(app: AppHandle, user_id: String, note: String) -> Result<Value> {
    let st = app.state::<AppState>();
    let res = st.api.post("userNotes", &json!({ "targetUserId": user_id, "note": note })).await?;
    // Keep the cached user in step so the dialog doesn't show the old note.
    if let Some((mut user, _)) = st.db.cache_get("user", &user_id) {
        user["note"] = json!(note);
        let _ = st.db.cache_put("user", &user_id, &user);
    }
    Ok(res)
}

#[tauri::command]
pub async fn balance_get(app: AppHandle) -> Result<Value> {
    let st = app.state::<AppState>();
    let id = st.me_id()?;
    st.api.get(&format!("user/{id}/balance"), &[]).await
}

#[tauri::command]
pub async fn world_get(app: AppHandle, world_id: String, force: Option<bool>) -> Result<Value> {
    sync::world(&app, &world_id, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn avatar_get(app: AppHandle, avatar_id: String) -> Result<Value> {
    sync::cached(&app, "avatar", &avatar_id, &format!("avatars/{avatar_id}"), 3_600_000, false).await
}

#[tauri::command]
pub async fn instance_get(app: AppHandle, location: String) -> Result<Value> {
    app.state::<AppState>().api.get(&format!("instances/{location}"), &[]).await
}

#[tauri::command]
pub async fn users_search(app: AppHandle, query: String) -> Result<Value> {
    app.state::<AppState>().api.get("users", &[("search", query), ("n", "50".into())]).await
}

#[tauri::command]
pub async fn worlds_search(app: AppHandle, query: String, sort: Option<String>) -> Result<Value> {
    let mut q = vec![("n", "50".to_string()), ("sort", sort.unwrap_or_else(|| "relevance".into()))];
    if !query.trim().is_empty() {
        q.push(("search", query));
    }
    app.state::<AppState>().api.get("worlds", &q).await
}

#[tauri::command]
pub async fn worlds_list(app: AppHandle, kind: String) -> Result<Value> {
    let api = &app.state::<AppState>().api;
    match kind.as_str() {
        "recent" => api.get("worlds/recent", &[("n", "50".into())]).await,
        "favorites" => api.get("worlds/favorites", &[("n", "100".into())]).await,
        "mine" => {
            api.get("worlds", &[("user", "me".into()), ("releaseStatus", "all".into()), ("n", "100".into())])
                .await
        }
        _ => {
            api.get("worlds", &[("sort", "popularity".into()), ("featured", "false".into()), ("n", "50".into())])
                .await
        }
    }
}

#[tauri::command]
pub async fn avatars_list(app: AppHandle, kind: String, tag: Option<String>) -> Result<Value> {
    let api = &app.state::<AppState>().api;
    match kind.as_str() {
        "favorites" => {
            let mut q = vec![("n", "100".to_string())];
            if let Some(t) = tag.filter(|t| !t.is_empty()) {
                q.push(("tag", t));
            }
            api.get("avatars/favorites", &q).await
        }
        _ => {
            api.get(
                "avatars",
                &[
                    ("user", "me".into()),
                    ("releaseStatus", "all".into()),
                    ("sort", "updated".into()),
                    ("order", "descending".into()),
                    ("n", "100".into()),
                ],
            )
            .await
        }
    }
}

#[tauri::command]
pub fn seen_avatars(app: AppHandle, user_id: String, display_name: String) -> Result<Vec<crate::db::SeenAvatar>> {
    app.state::<AppState>().db.seen_avatars(&user_id, &display_name)
}

/// Favorite kinds Nexus manages, with the id prefix and list-tag prefix each uses.
fn favorite_kind(kind: &str) -> Result<(&'static str, &'static str)> {
    match kind {
        "avatar" => Ok(("avtr_", "avatars")),
        "world" => Ok(("wrld_", "worlds")),
        "vrcPlusWorld" => Ok(("wrld_", "vrcPlusWorlds")),
        "friend" => Ok(("usr_", "group_")),
        _ => Err(Error::Other(format!("Unknown favorite type {kind}."))),
    }
}

/// Your favorite lists of a kind (names and display names).
#[tauri::command]
pub async fn favorite_groups(app: AppHandle, kind: String) -> Result<Value> {
    favorite_kind(&kind)?;
    app.state::<AppState>().api.get("favorite/groups", &[("type", kind), ("n", "50".into())]).await
}

/// Every favorite of a kind across all lists, with favorite-record ids for removal.
#[tauri::command]
pub async fn favorites_of(app: AppHandle, kind: String) -> Result<Value> {
    favorite_kind(&kind)?;
    app.state::<AppState>().api.get("favorites", &[("type", kind), ("n", "400".into())]).await
}

#[tauri::command]
pub async fn favorite_add(app: AppHandle, kind: String, id: String, list: String) -> Result<Value> {
    let (id_prefix, list_prefix) = favorite_kind(&kind)?;
    let ok_id = id.strip_prefix(id_prefix).is_some_and(|r| !r.is_empty() && r.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    let ok_list = list.strip_prefix(list_prefix).is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
    if !ok_id || !ok_list {
        return Err(Error::Other("Invalid item or favorite list.".into()));
    }
    let res = app
        .state::<AppState>()
        .api
        .post("favorites", &json!({ "type": kind, "favoriteId": id, "tags": [list] }))
        .await?;
    if kind == "friend" {
        // Keep stars, the Favorites section and favorites-only notifications in step.
        let _ = sync::load_favorites(&app).await;
    }
    Ok(res)
}

#[tauri::command]
pub async fn favorite_remove(app: AppHandle, kind: String, favorite_id: String) -> Result<()> {
    favorite_kind(&kind)?;
    if !favorite_id.starts_with("fvrt_") {
        return Err(Error::Other("Invalid favorite id.".into()));
    }
    app.state::<AppState>().api.delete(&format!("favorites/{favorite_id}")).await?;
    if kind == "friend" {
        let _ = sync::load_favorites(&app).await;
    }
    Ok(())
}

/// All your avatar favorites (every list), with their favorite-record ids for removal.
#[tauri::command]
pub async fn avatar_favorites(app: AppHandle) -> Result<Value> {
    app.state::<AppState>().api.get("favorites", &[("type", "avatar".into()), ("n", "300".into())]).await
}

#[tauri::command]
pub async fn avatar_favorite_add(app: AppHandle, avatar_id: String, list: String) -> Result<Value> {
    let ok_id = avatar_id.strip_prefix("avtr_").is_some_and(|r| r.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    let ok_list = list.strip_prefix("avatars").is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
    if !ok_id || !ok_list {
        return Err(Error::Other("Invalid avatar or favorite list.".into()));
    }
    app.state::<AppState>()
        .api
        .post("favorites", &json!({ "type": "avatar", "favoriteId": avatar_id, "tags": [list] }))
        .await
}

#[tauri::command]
pub async fn avatar_favorite_remove(app: AppHandle, favorite_id: String) -> Result<()> {
    if !favorite_id.starts_with("fvrt_") {
        return Err(Error::Other("Invalid favorite id.".into()));
    }
    app.state::<AppState>().api.delete(&format!("favorites/{favorite_id}")).await?;
    Ok(())
}

/// Search public avatars via avtrDB (VRChat's API can't search other people's avatars).
#[tauri::command]
pub async fn avatar_discover(query: String, mode: String, page: Option<u32>) -> Result<Value> {
    crate::avtrdb::search(&query, &mode, page.unwrap_or(0)).await
}

#[tauri::command]
pub async fn avatar_select(app: AppHandle, avatar_id: String) -> Result<Value> {
    app.state::<AppState>().api.put(&format!("avatars/{avatar_id}/select"), &json!({})).await
}

#[tauri::command]
pub fn watch_list(app: AppHandle) -> Vec<String> {
    app.state::<AppState>().session.read().watched.iter().cloned().collect()
}

/// Ring (or silence) the bell for a friend. Stored locally per account; separate from VRChat favorites.
#[tauri::command]
pub fn watch_set(app: AppHandle, user_id: String, on: bool) -> Result<Vec<String>> {
    let st = app.state::<AppState>();
    let owner = st.me_id()?;
    if !user_id.starts_with("usr_") {
        return Err(Error::Other("Not a user id.".into()));
    }
    let list: Vec<String> = {
        let mut s = st.session.write();
        if on {
            s.watched.insert(user_id);
        } else {
            s.watched.remove(&user_id);
        }
        s.watched.iter().cloned().collect()
    };
    st.db.kv_set(&format!("watched:{owner}"), &serde_json::to_string(&list)?)?;
    let _ = app.emit("watched:update", &list);
    Ok(list)
}

#[tauri::command]
pub async fn favorite_friend_toggle(app: AppHandle, user_id: String) -> Result<bool> {
    let st = app.state::<AppState>();
    let existing = st.session.read().favorites.get(&user_id).cloned();
    let now_fav = match existing {
        Some(fav_id) => {
            st.api.delete(&format!("favorites/{fav_id}")).await?;
            st.session.write().favorites.remove(&user_id);
            false
        }
        None => {
            let res = st
                .api
                .post("favorites", &json!({ "type": "friend", "favoriteId": user_id, "tags": ["group_0"] }))
                .await?;
            let fav_id = str_of(&res, "id").to_string();
            st.session.write().favorites.insert(user_id.clone(), fav_id);
            true
        }
    };
    let ids: Vec<String> = st.session.read().favorites.keys().cloned().collect();
    let _ = app.emit("favorites:update", &ids);
    Ok(now_fav)
}

// ---------------------------------------------------------------------------------------------
// Social actions

fn my_location(st: &AppState) -> Option<String> {
    if let Some(loc) = st.instance.lock().location.clone() {
        return Some(loc);
    }
    let s = st.session.read();
    let me = s.user.as_ref()?;
    let found = [me["$location"].as_str(), me["location"].as_str()]
        .into_iter()
        .flatten()
        .find(|l| location::is_instance(l))
        .map(String::from);
    found
}

#[tauri::command]
pub async fn invite_user(app: AppHandle, user_id: String) -> Result<()> {
    let st = app.state::<AppState>();
    let loc = my_location(&st).ok_or_else(|| Error::Other("You need to be in an instance to invite someone.".into()))?;
    st.api.post(&format!("invite/{user_id}"), &json!({ "instanceId": loc })).await?;
    Ok(())
}

#[tauri::command]
pub async fn request_invite(app: AppHandle, user_id: String) -> Result<()> {
    app.state::<AppState>().api.post(&format!("requestInvite/{user_id}"), &json!({})).await?;
    Ok(())
}

/// Send a boop. `emoji_id`: none for a plain boop, `default_<name>` for a built-in emoji, or a
/// `file_` id for a custom (VRC+) emoji. VRChat refuses a new boop until the last one is seen.
#[tauri::command]
pub async fn boop_user(app: AppHandle, user_id: String, emoji_id: Option<String>) -> Result<()> {
    let mut body = json!({});
    if let Some(e) = emoji_id.filter(|e| !e.trim().is_empty()) {
        body["emojiId"] = json!(e);
    }
    app.state::<AppState>().api.post(&format!("users/{user_id}/boop"), &body).await?;
    Ok(())
}

#[tauri::command]
pub async fn invite_self(app: AppHandle, location: String) -> Result<()> {
    app.state::<AppState>().api.post(&format!("invite/myself/to/{location}"), &json!({})).await?;
    Ok(())
}

#[tauri::command]
pub fn launch_location(app: AppHandle, location: String) -> Result<()> {
    if !location::is_instance(&location) {
        return Err(Error::Other("That isn't a joinable instance.".into()));
    }
    let url = format!("vrchat://launch?ref=vrchat.com&id={location}");
    // The vrchat:// handler goes stale when VRChat moves to another Steam library, and Windows
    // then just says "Application not found". Start VRChat ourselves in that case.
    if crate::vrc_launch::handler_ok() {
        return app.opener().open_url(url, None::<&str>).map_err(|e| Error::Other(e.to_string()));
    }
    let exe = vrchat_dir(&app).and_then(|d| crate::vrc_launch::launcher_in(&d)).ok_or_else(|| {
        Error::Other("Couldn't find VRChat. Set its install folder in Settings → VRChat.".into())
    })?;
    std::process::Command::new(&exe)
        .arg(&url)
        .current_dir(exe.parent().unwrap_or(std::path::Path::new(".")))
        .spawn()
        .map(|_| ())
        .map_err(|e| Error::Other(format!("Couldn't start VRChat: {e}")))
}

/// The folder chosen in Settings if it still holds VRChat, otherwise whatever we can detect.
fn vrchat_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.state::<AppState>()
        .settings()
        .vrchat_dir
        .map(std::path::PathBuf::from)
        .filter(|d| crate::vrc_launch::launcher_in(d).is_some())
        .or_else(crate::vrc_launch::detect_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VrchatInstall {
    /// Chosen in Settings (None = auto-detect).
    pub current: Option<String>,
    /// Auto-detected folder.
    pub default: Option<String>,
    /// Whether Windows can open vrchat:// links.
    pub links_ok: bool,
}

#[tauri::command]
pub fn vrchat_install_get(app: AppHandle) -> VrchatInstall {
    VrchatInstall {
        current: app.state::<AppState>().settings().vrchat_dir.filter(|s| !s.trim().is_empty()),
        default: crate::vrc_launch::detect_dir().map(|p| p.to_string_lossy().to_string()),
        links_ok: crate::vrc_launch::handler_ok(),
    }
}

#[tauri::command]
pub fn vrchat_dir_set(app: AppHandle, dir: Option<String>) -> Result<()> {
    let dir = dir.filter(|d| !d.trim().is_empty());
    if let Some(d) = &dir {
        if crate::vrc_launch::launcher_in(std::path::Path::new(d)).is_none() {
            return Err(Error::Other("That folder doesn't contain VRChat (launch.exe or VRChat.exe).".into()));
        }
    }
    let st = app.state::<AppState>();
    let mut settings = st.settings();
    settings.vrchat_dir = dir;
    st.db.kv_set("app_settings", &serde_json::to_string(&settings)?)?;
    *st.settings.write() = settings;
    Ok(())
}

/// Point vrchat:// links at the VRChat install (for the current Windows user only).
#[tauri::command]
pub fn vrchat_links_repair(app: AppHandle) -> Result<()> {
    let exe = vrchat_dir(&app)
        .and_then(|d| crate::vrc_launch::launcher_in(&d))
        .ok_or_else(|| Error::Other("Couldn't find VRChat. Set its install folder first.".into()))?;
    crate::vrc_launch::register_handler(&exe).map_err(|e| Error::Other(format!("Couldn't register vrchat:// links: {e}")))
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(Error::Other("Only web links can be opened.".into()));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| Error::Other(e.to_string()))
}

pub async fn set_status(app: &AppHandle, status: &str, description: Option<String>) -> Result<Value> {
    let st = app.state::<AppState>();
    let id = st.me_id()?;
    let mut body = json!({ "status": status });
    if let Some(d) = description {
        body["statusDescription"] = json!(d.chars().take(32).collect::<String>());
    }
    let res = st.api.put(&format!("users/{id}"), &body).await?;
    let updated = {
        let mut s = st.session.write();
        if let (Some(me), Some(patch)) = (s.user.as_mut(), res.as_object()) {
            if let Some(obj) = me.as_object_mut() {
                for (k, v) in patch {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        s.user.clone()
    };
    if let Some(u) = &updated {
        let _ = app.emit("user:update", u);
    }
    Ok(updated.unwrap_or(res))
}

#[tauri::command]
pub async fn status_set(app: AppHandle, status: String, description: Option<String>) -> Result<Value> {
    set_status(&app, &status, description).await
}

#[tauri::command]
pub async fn friend_request(app: AppHandle, user_id: String) -> Result<()> {
    app.state::<AppState>().api.post(&format!("user/{user_id}/friendRequest"), &json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn notifications_list(app: AppHandle) -> Result<Value> {
    let api = &app.state::<AppState>().api;
    let v1 = api.get("auth/user/notifications", &[("n", "100".into())]).await?;
    // Boops only exist in the newer notification system; a failure there shouldn't hide the rest.
    let v2 = api.get("notifications", &[("limit", "100".into())]).await.unwrap_or(Value::Null);
    let mut all: Vec<Value> = v1.as_array().cloned().unwrap_or_default();
    all.extend(v2.as_array().into_iter().flatten().filter_map(|n| crate::sync::boop_notification(&app, n)));
    all.sort_by(|a, b| str_of(b, "created_at").cmp(str_of(a, "created_at")));
    Ok(Value::Array(all))
}

/// Dismiss a notification from the newer (v2) system, such as a boop.
#[tauri::command]
pub async fn notification_v2_delete(app: AppHandle, id: String) -> Result<()> {
    // It only becomes a path segment, so just keep it to id-like characters.
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(Error::Other("Not a notification id.".into()));
    }
    app.state::<AppState>().api.delete(&format!("notifications/{id}")).await?;
    Ok(())
}

#[tauri::command]
pub async fn notification_accept(app: AppHandle, id: String) -> Result<()> {
    app.state::<AppState>().api.put(&format!("auth/user/notifications/{id}/accept"), &json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn notification_hide(app: AppHandle, id: String) -> Result<()> {
    app.state::<AppState>().api.put(&format!("auth/user/notifications/{id}/hide"), &json!({})).await?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Local history

#[tauri::command]
pub fn feed_query(app: AppHandle, query: FeedQuery) -> Result<Vec<FeedEntry>> {
    let st = app.state::<AppState>();
    st.db.feed_query(&st.me_id()?, &query)
}

#[tauri::command]
pub fn gamelog_sessions(app: AppHandle, query: GlQuery) -> Result<Vec<GlSession>> {
    app.state::<AppState>().db.gl_sessions(&query)
}

#[tauri::command]
pub fn gamelog_events(app: AppHandle, query: GlQuery) -> Result<Vec<GlEvent>> {
    app.state::<AppState>().db.gl_events(&query)
}

#[tauri::command]
pub fn gamelog_current(app: AppHandle) -> InstanceState {
    app.state::<AppState>().instance.lock().clone()
}

#[tauri::command]
pub fn user_history(app: AppHandle, user_id: String) -> Result<UserHistory> {
    let st = app.state::<AppState>();
    st.db.user_history(&st.me_id()?, &user_id)
}

#[tauri::command]
/// `days` of 0 (or less) means all time: everything back to the oldest record.
pub fn insights_get(app: AppHandle, days: i64) -> Result<Insights> {
    let st = app.state::<AppState>();
    let owner = st.me_id()?;
    let days = if days <= 0 { st.db.history_days(&owner)? } else { days };
    st.db.insights(&owner, days.clamp(1, 3650))
}

#[tauri::command]
pub fn memo_get(app: AppHandle, user_id: String) -> Result<String> {
    let st = app.state::<AppState>();
    st.db.memo_get(&st.me_id()?, &user_id)
}

#[tauri::command]
pub fn memo_set(app: AppHandle, user_id: String, text: String) -> Result<()> {
    let st = app.state::<AppState>();
    st.db.memo_set(&st.me_id()?, &user_id, &text)
}

// ---------------------------------------------------------------------------------------------
// Settings & maintenance

#[tauri::command]
pub fn settings_get(app: AppHandle) -> AppSettings {
    app.state::<AppState>().settings()
}

#[tauri::command]
pub fn settings_set(app: AppHandle, settings: AppSettings) -> Result<()> {
    let st = app.state::<AppState>();
    st.db.kv_set("app_settings", &serde_json::to_string(&settings)?)?;
    *st.settings.write() = settings;
    Ok(())
}

#[tauri::command]
pub fn default_log_dir() -> Option<String> {
    crate::gamelog::default_log_dir().map(|p| p.to_string_lossy().to_string())
}

fn vrchat_config(app: &AppHandle) -> Result<std::path::PathBuf> {
    let custom = app.state::<AppState>().settings().log_dir.filter(|s| !s.trim().is_empty());
    crate::vrc_config::config_path(custom.map(std::path::PathBuf::from))
        .ok_or_else(|| Error::Other("Couldn't find the VRChat folder.".into()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    /// What's configured (None = using the default).
    pub current: Option<String>,
    pub default: Option<String>,
}

/// VRChat's `picture_output_folder` from its config.json.
#[tauri::command]
pub fn photo_dir_get(app: AppHandle) -> Result<FolderInfo> {
    let path = vrchat_config(&app)?;
    let default = app.path().picture_dir().ok().map(|p| p.join("VRChat").to_string_lossy().to_string());
    Ok(FolderInfo { current: crate::vrc_config::photo_dir(&path), default })
}

#[tauri::command]
pub fn photo_dir_set(app: AppHandle, dir: Option<String>) -> Result<()> {
    crate::vrc_config::set_photo_dir(&vrchat_config(&app)?, dir.as_deref().filter(|d| !d.trim().is_empty()))
}

#[tauri::command]
pub fn ugc_dir_get(app: AppHandle) -> FolderInfo {
    FolderInfo {
        current: app.state::<AppState>().settings().ugc_dir.filter(|s| !s.trim().is_empty()),
        default: crate::ugc::default_dir(&app).map(|p| p.to_string_lossy().to_string()),
    }
}

/// Download a VRChat image (with the session cookie) to a path the user picked in a save dialog.
#[tauri::command]
pub async fn image_download(app: AppHandle, url: String, path: String) -> Result<()> {
    let host_ok = url
        .strip_prefix("https://")
        .and_then(|r| r.split('/').next())
        .is_some_and(|h| h.ends_with("vrchat.cloud") || h.ends_with("vrchat.com"));
    if !host_ok {
        return Err(Error::Other("Only VRChat images can be downloaded.".into()));
    }
    let (_, bytes) = app.state::<AppState>().api.fetch_bytes(&url).await?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

/// Open a folder in Explorer, creating it first so "Open" always works.
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<()> {
    std::fs::create_dir_all(&path)?;
    app.opener().open_path(path, None::<&str>).map_err(|e| Error::Other(e.to_string()))
}

#[tauri::command]
pub fn cache_clear(app: AppHandle) -> Result<()> {
    app.state::<AppState>().db.cache_clear()
}

#[tauri::command]
pub fn export_csv(app: AppHandle, kind: String) -> Result<String> {
    let st = app.state::<AppState>();
    let rows = st.db.export_rows(&st.me_id()?, &kind)?;
    let esc = |s: &str| {
        if s.contains([',', '"', '\n', '\r']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    };
    let csv: String = rows
        .iter()
        .map(|r| r.iter().map(|c| esc(c)).collect::<Vec<_>>().join(","))
        .collect::<Vec<_>>()
        .join("\r\n");
    let dir = app.path().download_dir().map_err(|e| Error::Other(e.to_string()))?;
    let name = format!("nexus-{kind}-{}.csv", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let path = dir.join(name);
    std::fs::write(&path, csv)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<()> {
    app.opener().reveal_item_in_dir(path).map_err(|e| Error::Other(e.to_string()))
}

/// The deliberate way to read your data: a plaintext copy of the database, saved where you choose.
#[tauri::command]
pub fn db_export_decrypted(app: AppHandle, path: String) -> Result<()> {
    let dest = std::path::PathBuf::from(&path);
    if dest.extension().and_then(|e| e.to_str()) != Some("db") {
        return Err(Error::Other("Choose a file name ending in .db".into()));
    }
    app.state::<AppState>().db.export_decrypted(&dest)
}

#[tauri::command]
pub fn vrcx_detect(app: AppHandle) -> crate::vrcx::Detected {
    crate::vrcx::detect(&app)
}

/// Import VRCX history. `path` overrides the auto-detected database.
#[tauri::command]
pub async fn vrcx_import(app: AppHandle, path: Option<String>) -> Result<crate::vrcx::Summary> {
    tauri::async_runtime::spawn_blocking(move || crate::vrcx::import(&app, path))
        .await
        .map_err(|e| Error::Other(e.to_string()))?
}
