//! VRChat Pipeline websocket: live friend, user and notification events.

use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Error as WsError, Message};

use crate::api::USER_AGENT;
use crate::state::AppState;
use crate::sync::{self, str_of};

pub fn start(app: AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut backoff = 2u64;
        let mut first = true;
        loop {
            let Some(token) = app.state::<AppState>().api.auth_token() else { break };
            let mut req = match format!("wss://pipeline.vrchat.cloud/?authToken={token}").into_client_request() {
                Ok(r) => r,
                Err(_) => break,
            };
            req.headers_mut().insert("User-Agent", HeaderValue::from_static(USER_AGENT));

            match tokio_tungstenite::connect_async(req).await {
                Ok((mut ws, _)) => {
                    backoff = 2;
                    let _ = app.emit("pipeline:status", true);
                    if !first {
                        // We may have missed events while disconnected; resync.
                        let a = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = sync::refresh_friends(&a).await;
                        });
                    }
                    first = false;
                    while let Some(msg) = ws.next().await {
                        match msg {
                            Ok(Message::Text(text)) => handle(&app, &text).await,
                            Ok(Message::Close(_)) | Err(_) => break,
                            _ => {}
                        }
                    }
                    let _ = app.emit("pipeline:status", false);
                }
                Err(WsError::Http(resp)) if resp.status() == 401 => {
                    let _ = app.emit("session:expired", ());
                    break;
                }
                Err(e) => eprintln!("pipeline connect failed: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(60);
        }
    })
}

async fn handle(app: &AppHandle, text: &str) {
    let Ok(msg) = serde_json::from_str::<Value>(text) else { return };
    let kind = str_of(&msg, "type").to_string();
    // `content` is itself a JSON-encoded string.
    let content = match &msg["content"] {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::String(s.clone())),
        other => other.clone(),
    };
    let user_id = str_of(&content, "userId").to_string();

    match kind.as_str() {
        "friend-online" | "friend-location" => {
            let mut patch = sync::user_patch(&content);
            let loc = str_of(&content, "location").to_string();
            patch["location"] = json!(loc);
            patch["travelingToLocation"] = content["travelingToLocation"].clone();
            if let Some(p) = content["platform"].as_str() {
                patch["platform"] = json!(p);
            }
            let world_name = match content["world"]["name"].as_str() {
                Some(n) => Some(n.to_string()),
                None => sync::world_name_for(app, &loc).await,
            };
            let came_online = kind == "friend-online";
            sync::apply_friend(app, &user_id, patch, Some("online"), world_name);
            if came_online {
                sync::check_profile_soon(app, &user_id);
            }
        }
        "friend-active" => {
            let mut patch = sync::user_patch(&content);
            patch["location"] = json!("offline");
            if let Some(p) = content["platform"].as_str() {
                patch["platform"] = json!(p);
            }
            sync::apply_friend(app, &user_id, patch, Some("active"), None);
            // They just opened the website, where bios get edited; take a look.
            sync::check_profile_soon(app, &user_id);
        }
        "friend-offline" => {
            sync::apply_friend(app, &user_id, json!({ "location": "offline" }), Some("offline"), None);
        }
        "friend-update" => {
            sync::apply_friend(app, &user_id, sync::user_patch(&content), None, None);
            // Profile edits (bio, links) arrive as a bare friend-update; check what changed.
            sync::check_profile_soon(app, &user_id);
        }
        "friend-add" => {
            let mut patch = content["user"].clone();
            if !patch.is_object() {
                patch = json!({});
            }
            if str_of(&patch, "state").is_empty() {
                patch["state"] = json!("offline");
            }
            let st = app.state::<AppState>();
            if let Ok(owner) = st.me_id() {
                let name = str_of(&patch, "displayName").to_string();
                let _ = st.db.friend_log_set(&owner, &user_id, &name, true);
                sync::push_feed(app, &owner, "friend", &user_id, &name, None, None, None, None);
                if st.settings().notify_new_friends && !name.is_empty() {
                    sync::toast(app, &format!("{name} is now your friend"), "");
                }
            }
            sync::apply_friend(app, &user_id, patch, None, None);
        }
        "friend-delete" => sync::remove_friend(app, &user_id),
        "user-update" => {
            let st = app.state::<AppState>();
            let updated = {
                let mut s = st.session.write();
                if let (Some(me), Some(patch)) = (s.user.as_mut(), content["user"].as_object()) {
                    if let Some(obj) = me.as_object_mut() {
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
        }
        "user-location" => {
            let st = app.state::<AppState>();
            let updated = {
                let mut s = st.session.write();
                if let Some(me) = s.user.as_mut() {
                    me["$location"] = content["location"].clone();
                    me["$locationAt"] = json!(crate::db::now_ms());
                }
                s.user.clone()
            };
            if let Some(u) = updated {
                let _ = app.emit("user:update", &u);
            }
        }
        "notification" => {
            let _ = app.emit("notification:new", &content);
            let settings = app.state::<AppState>().settings();
            let sender = str_of(&content, "senderUsername");
            let (on, title, body) = match str_of(&content, "type") {
                "invite" => (
                    settings.notify_invites,
                    format!("{sender} invited you"),
                    content["details"]["worldName"].as_str().unwrap_or("").to_string(),
                ),
                "requestInvite" => (settings.notify_invite_requests, format!("{sender} requested an invite"), String::new()),
                "friendRequest" => (settings.notify_friend_requests, format!("{sender} sent a friend request"), String::new()),
                _ => return,
            };
            if on {
                sync::toast(app, &title, &body);
            }
        }
        // Newer notification types (boops among them) come through a separate channel.
        "notification-v2" => {
            let Some(boop) = sync::boop_notification(app, &content) else { return };
            let _ = app.emit("notification:new", &boop);
            if app.state::<AppState>().settings().notify_boops {
                sync::toast(app, &format!("{} booped you", str_of(&boop, "senderUsername")), "");
            }
        }
        // Joined or left a group somewhere else (in game, on the website): refresh "my groups".
        "group-joined" | "group-left" => {
            let _ = app.emit("groups:changed", ());
        }
        _ => {}
    }
}
