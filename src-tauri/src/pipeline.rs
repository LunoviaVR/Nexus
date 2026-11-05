//! VRChat Pipeline websocket: live friend, user and notification events.

use std::time::{Duration, Instant};

use futures_util::{Sink, SinkExt, Stream, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{interval_at, timeout, Interval, MissedTickBehavior};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Error as WsError, Message};

use crate::api::USER_AGENT;
use crate::state::AppState;
use crate::sync::{self, str_of};

/// A connection has to last this long before a drop counts as a fresh start (reconnect quickly
/// and resync); a connection that keeps dropping right away backs off instead.
const STABLE_AFTER: Duration = Duration::from_secs(30);
/// The first wait before reconnecting; it doubles on each quick drop, up to a minute.
const FIRST_BACKOFF: u64 = 5;
/// A connection attempt that hasn't finished by now is abandoned and tried again.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const HEARTBEAT: Heartbeat =
    Heartbeat { every: Duration::from_secs(25), silent_for: Duration::from_secs(60), send_within: Duration::from_secs(10) };

/// How a connection is checked on. One can die without either end being told (the PC slept, the
/// router forgot about it, the network changed), and reading from it then waits forever.
#[derive(Clone, Copy)]
struct Heartbeat {
    /// How often a ping goes out.
    every: Duration,
    /// A server that answers pings is gone if nothing at all has arrived for this long.
    silent_for: Duration,
    /// A ping that can't be written by now means the connection is stuck.
    send_within: Duration,
}

/// One connection's read loop, with the heartbeat running alongside it.
struct Link {
    beat: Heartbeat,
    ticker: Interval,
    heard: Instant,
    /// Silence only means something once the server has shown it answers pings. Until then a
    /// quiet connection is left alone: a dead one still shows up as a failed ping.
    answers_pings: bool,
    last: String,
}

impl Link {
    fn new(beat: Heartbeat) -> Self {
        let mut ticker = interval_at(tokio::time::Instant::now() + beat.every, beat.every);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        Self { beat, ticker, heard: Instant::now(), answers_pings: false, last: String::new() }
    }

    /// The next event's text, or `None` once the connection is over.
    async fn next_text<S, E>(&mut self, ws: &mut S) -> Option<String>
    where
        S: Stream<Item = Result<Message, E>> + Sink<Message, Error = E> + Unpin,
    {
        loop {
            tokio::select! {
                msg = ws.next() => {
                    self.heard = Instant::now();
                    match msg {
                        // VRChat sometimes sends the same event twice in a row; once is enough.
                        Some(Ok(Message::Text(text))) if text != self.last => {
                            self.last.clone_from(&text);
                            return Some(text);
                        }
                        Some(Ok(Message::Pong(_))) => self.answers_pings = true,
                        Some(Ok(Message::Close(_)) | Err(_)) | None => return None,
                        _ => {}
                    }
                }
                _ = self.ticker.tick() => {
                    if self.answers_pings && self.heard.elapsed() >= self.beat.silent_for {
                        return None;
                    }
                    if !matches!(timeout(self.beat.send_within, ws.send(Message::Ping(Vec::new()))).await, Ok(Ok(()))) {
                        return None;
                    }
                }
            }
        }
    }
}

pub fn start(app: AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut backoff = FIRST_BACKOFF;
        let mut first = true;
        loop {
            let Some(token) = app.state::<AppState>().api.auth_token() else { break };
            let mut req = match format!("wss://pipeline.vrchat.cloud/?authToken={token}").into_client_request() {
                Ok(r) => r,
                Err(_) => break,
            };
            req.headers_mut().insert("User-Agent", HeaderValue::from_static(USER_AGENT));

            match timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(req)).await {
                Ok(Ok((mut ws, _))) => {
                    let connected = Instant::now();
                    let _ = app.emit("pipeline:status", true);
                    if !first {
                        // We may have missed events while disconnected; resync.
                        sync::request_resync();
                    }
                    let mut link = Link::new(HEARTBEAT);
                    while let Some(text) = link.next_text(&mut ws).await {
                        handle(&app, &text).await;
                    }
                    let _ = app.emit("pipeline:status", false);
                    if connected.elapsed() >= STABLE_AFTER {
                        backoff = FIRST_BACKOFF;
                    }
                }
                // Same check as any other 401: signing back in replaces this task, and signing
                // out ends it. If the session turns out to be fine, the next attempt carries on.
                Ok(Err(WsError::Http(resp))) if resp.status() == 401 => app.state::<AppState>().api.session_lost(),
                Ok(Err(e)) => eprintln!("pipeline connect failed: {e}"),
                Err(_) => eprintln!("pipeline connect timed out"),
            }
            first = false;
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
                None => sync::world_name_quick(app, &loc).await,
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
            sync::friendship_changed();
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, connect_async, MaybeTlsStream, WebSocketStream};

    const QUICK: Heartbeat = Heartbeat {
        every: Duration::from_millis(50),
        silent_for: Duration::from_millis(200),
        send_within: Duration::from_millis(500),
    };
    /// Far longer than any of these connections should take to be judged.
    const LIMIT: Duration = Duration::from_secs(10);

    type Client = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
    type Server = WebSocketStream<tokio::net::TcpStream>;

    /// A real websocket connection to a local server running `server`.
    async fn connect<F, Fut>(server: F) -> Client
    where
        F: FnOnce(Server) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            server(accept_async(stream).await.unwrap()).await;
        });
        connect_async(format!("ws://{addr}")).await.unwrap().0
    }

    #[tokio::test]
    async fn delivers_events_once_and_ends_when_the_server_closes() {
        let mut ws = connect(|mut s| async move {
            for text in ["a", "a", "b"] {
                s.send(Message::Text(text.into())).await.unwrap();
            }
            s.close(None).await.unwrap();
        })
        .await;
        let mut link = Link::new(QUICK);
        assert_eq!(link.next_text(&mut ws).await.as_deref(), Some("a"));
        assert_eq!(link.next_text(&mut ws).await.as_deref(), Some("b"));
        assert_eq!(timeout(LIMIT, link.next_text(&mut ws)).await, Ok(None));
    }

    #[tokio::test]
    async fn a_connection_that_stops_answering_is_given_up_on() {
        // Answers the first ping, then goes quiet without closing: what a dead connection looks like.
        let mut ws = connect(|mut s| async move {
            while !matches!(s.next().await, Some(Ok(Message::Ping(_)))) {}
            s.flush().await.unwrap();
            std::future::pending::<()>().await;
            drop(s);
        })
        .await;
        let mut link = Link::new(QUICK);
        assert_eq!(timeout(LIMIT, link.next_text(&mut ws)).await, Ok(None));
        assert!(link.answers_pings);
    }

    #[tokio::test]
    async fn a_server_that_never_answers_pings_is_not_cut_off() {
        // Doesn't read, so no pongs, for several times `silent_for`, and then has something to say.
        let mut ws = connect(|mut s| async move {
            tokio::time::sleep(QUICK.silent_for * 3).await;
            s.send(Message::Text("still here".into())).await.unwrap();
            std::future::pending::<()>().await;
        })
        .await;
        let mut link = Link::new(QUICK);
        let text = timeout(LIMIT, link.next_text(&mut ws)).await.unwrap();
        assert_eq!(text.as_deref(), Some("still here"));
        assert!(!link.answers_pings);
    }

    #[tokio::test]
    async fn a_healthy_quiet_connection_is_kept() {
        // Answers every ping but never sends an event.
        let mut ws = connect(|mut s| async move { while s.next().await.is_some() {} }).await;
        let mut link = Link::new(QUICK);
        let still_open = timeout(QUICK.silent_for * 4, link.next_text(&mut ws)).await;
        assert!(still_open.is_err(), "dropped a healthy connection");
        assert!(link.answers_pings);
    }
}
