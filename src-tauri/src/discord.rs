//! Discord Rich Presence: your Discord profile shows the world you're in, taken from the game log.
//! Nexus only talks to the Discord desktop app over its local IPC pipe; Discord shares it from there.

use std::fs::File;
use std::io::{self, Read, Write};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::gamelog::InstanceState;
use crate::location;
use crate::settings::AppSettings;
use crate::state::AppState;
use crate::sync::str_of;

/// The Discord application shown as "Playing <its name>". Create one at
/// https://discord.com/developers/applications and paste its Application ID here.
pub const CLIENT_ID: &str = "1558707197100433522";

const TICK: Duration = Duration::from_secs(2);
/// Discord allows 5 activity updates every 20 seconds.
const MIN_SEND_GAP: Duration = Duration::from_secs(4);
/// Re-send the activity now and then, which is also how we notice Discord restarting.
const HEARTBEAT: Duration = Duration::from_secs(60);
const RECONNECT_EVERY: Duration = Duration::from_secs(10);
/// Hopping to another world briefly leaves no location; keep the old one up rather than blinking off.
const TRAVEL_GRACE: Duration = Duration::from_secs(15);
const WORLD_RETRY: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    #[default]
    Off,
    /// This build has no Discord application ID.
    Unconfigured,
    /// On, but you're not in VRChat.
    Idle,
    /// The Discord desktop app isn't running.
    NoDiscord,
    Showing { details: String },
    Error { message: String },
}

static STATUS: LazyLock<Mutex<Status>> = LazyLock::new(Mutex::default);

pub fn status() -> Status {
    STATUS.lock().clone()
}

fn set_status(s: Status) {
    *STATUS.lock() = s;
}

// ---------------------------------------------------------------------------------------------
// IPC: 8-byte frames (opcode, length, little-endian) followed by JSON.

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

#[derive(Debug)]
enum IpcError {
    /// The pipe broke or Discord went away: reconnect later.
    Io(io::Error),
    /// Discord answered but refused, e.g. an unknown application ID.
    Refused(String),
}

impl From<io::Error> for IpcError {
    fn from(e: io::Error) -> Self {
        IpcError::Io(e)
    }
}

fn write_frame(w: &mut impl Write, op: u32, payload: &Value) -> io::Result<()> {
    let body = serde_json::to_vec(payload)?;
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    w.write_all(&buf)?;
    w.flush()
}

fn read_frame(r: &mut impl Read) -> io::Result<(u32, Value)> {
    let mut head = [0u8; 8];
    r.read_exact(&mut head)?;
    let op = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
    if len > 1 << 20 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "oversized Discord frame"));
    }
    let mut body = vec![0; len];
    r.read_exact(&mut body)?;
    Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

/// Close frames are `{code, message}`; errors carry the same in `data`.
fn refusal(v: &Value) -> IpcError {
    let m = str_of(v, "message");
    IpcError::Refused(if m.is_empty() { "Discord refused the request.".into() } else { m.to_string() })
}

struct Conn<S> {
    pipe: S,
    nonce: u64,
}

impl<S: Read + Write> Conn<S> {
    fn handshake(pipe: S, client_id: &str) -> Result<Self, IpcError> {
        let mut c = Conn { pipe, nonce: 0 };
        write_frame(&mut c.pipe, OP_HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))?;
        loop {
            let v = c.recv()?;
            if v["evt"] == "READY" {
                return Ok(c);
            }
            if v["evt"] == "ERROR" {
                return Err(refusal(&v["data"]));
            }
        }
    }

    /// The next message frame, answering pings on the way.
    fn recv(&mut self) -> Result<Value, IpcError> {
        loop {
            let (op, v) = read_frame(&mut self.pipe)?;
            match op {
                OP_FRAME => return Ok(v),
                OP_PING => write_frame(&mut self.pipe, OP_PONG, &v)?,
                OP_CLOSE => return Err(refusal(&v)),
                _ => {}
            }
        }
    }

    fn set_activity(&mut self, activity: &Value) -> Result<(), IpcError> {
        self.nonce += 1;
        let nonce = self.nonce.to_string();
        let cmd = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": nonce,
        });
        write_frame(&mut self.pipe, OP_FRAME, &cmd)?;
        loop {
            let v = self.recv()?;
            if v["nonce"] == nonce.as_str() {
                return if v["evt"] == "ERROR" { Err(refusal(&v["data"])) } else { Ok(()) };
            }
        }
    }
}

#[cfg(windows)]
fn open_pipe() -> io::Result<File> {
    let mut last = io::Error::from(io::ErrorKind::NotFound);
    for i in 0..10 {
        match std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{i}")) {
            Ok(f) => return Ok(f),
            Err(e) => last = e,
        }
    }
    Err(last)
}

#[cfg(not(windows))]
fn open_pipe() -> io::Result<File> {
    Err(io::ErrorKind::Unsupported.into())
}

// ---------------------------------------------------------------------------------------------
// What to show

/// The world's details from VRChat's API; the log only knows its name.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WorldInfo {
    pub name: Option<String>,
    pub author: Option<String>,
    pub image: Option<String>,
    pub capacity: Option<u64>,
}

impl WorldInfo {
    fn from_api(w: &Value) -> Self {
        let text = |k: &str| Some(str_of(w, k).to_string()).filter(|s| !s.is_empty());
        Self {
            name: text("name"),
            author: text("authorName"),
            image: text("thumbnailImageUrl").or_else(|| text("imageUrl")).filter(|u| u.starts_with("https://")),
            capacity: w["capacity"].as_u64().filter(|c| *c > 0),
        }
    }
}

/// Discord wants 2 to 128 characters on each line of text.
fn text(s: &str) -> Option<String> {
    let s = s.trim();
    match s.chars().count() {
        0..=1 => None,
        n if n > 128 => Some(s.chars().take(127).chain(['…']).collect()),
        _ => Some(s.to_string()),
    }
}

/// The Discord activity for where you are, or None when you're not in a world.
pub fn activity(inst: &InstanceState, world: Option<&WorldInfo>, s: &AppSettings) -> Option<Value> {
    let loc = inst.location.as_deref()?;
    let i = location::parse(loc)?;
    let mut a = Map::new();
    if let Some(since) = inst.since {
        a.insert("timestamps".into(), json!({ "start": since }));
    }
    if s.discord_hide_private && !i.access.is_joinable() {
        a.insert("details".into(), "In a private instance".into());
        return Some(a.into());
    }

    let name = inst.world_name.as_deref().or(world.and_then(|w| w.name.as_deref())).and_then(text);
    a.insert("details".into(), name.clone().unwrap_or_else(|| "In a world".into()).into());
    a.insert("state".into(), format!("{} · {}", i.access.label(), location::region_label(i.region)).into());
    if let Some(image) = world.and_then(|w| w.image.as_deref()) {
        let mut assets = Map::new();
        assets.insert("large_image".into(), image.into());
        let by = world.and_then(|w| w.author.as_deref()).and_then(|author| text(&format!("by {author}")));
        if let Some(hover) = by.or(name) {
            assets.insert("large_text".into(), hover.into());
        }
        a.insert("assets".into(), assets.into());
    }
    let here = inst.players.len() as u64;
    if let Some(cap) = world.and_then(|w| w.capacity).filter(|_| here > 0) {
        // The id only groups people in the same instance; hash it so it doesn't carry the owner's user id.
        a.insert("party".into(), json!({ "id": format!("{:x}", Sha256::digest(loc)), "size": [here, cap.max(here)] }));
    }
    if s.discord_join_button && i.access.is_joinable() {
        let url = format!(
            "https://vrchat.com/home/launch?worldId={}&instanceId={}",
            i.world_id,
            urlencoding::encode(i.instance_id)
        );
        a.insert("buttons".into(), json!([{ "label": "Join", "url": url }]));
    }
    Some(a.into())
}

// ---------------------------------------------------------------------------------------------
// Background worker

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut p = Presence {
            app,
            conn: None,
            shown: None,
            last_send: None,
            last_connect: None,
            gone_since: None,
            world: None,
        };
        loop {
            p.tick();
            std::thread::sleep(TICK);
        }
    });
}

struct Presence {
    app: AppHandle,
    conn: Option<Conn<File>>,
    /// What Discord is showing, as far as we know.
    shown: Option<Value>,
    last_send: Option<Instant>,
    last_connect: Option<Instant>,
    gone_since: Option<Instant>,
    /// The current world's id and API details (None if fetching them failed), and when we looked.
    world: Option<(String, Option<WorldInfo>, Instant)>,
}

impl Presence {
    fn tick(&mut self) {
        let app = self.app.clone();
        let st = app.state::<AppState>();
        let settings = st.settings();
        if !settings.discord_presence || CLIENT_ID.is_empty() {
            self.clear();
            set_status(if settings.discord_presence { Status::Unconfigured } else { Status::Off });
            return;
        }
        let inst = st.instance.lock().clone();
        let world = self.world_info(&inst);
        let Some(want) = activity(&inst, world.as_ref(), &settings) else {
            let gone = *self.gone_since.get_or_insert_with(Instant::now);
            if self.shown.is_none() || gone.elapsed() >= TRAVEL_GRACE {
                self.clear();
                set_status(Status::Idle);
            }
            return;
        };
        self.gone_since = None;

        let fresh = self.last_send.is_some_and(|t| t.elapsed() < HEARTBEAT);
        if self.conn.is_some() && self.shown.as_ref() == Some(&want) && fresh {
            return;
        }
        if self.last_send.is_some_and(|t| t.elapsed() < MIN_SEND_GAP) {
            return;
        }
        if self.conn.is_none() {
            if self.last_connect.is_some_and(|t| t.elapsed() < RECONNECT_EVERY) {
                return;
            }
            self.last_connect = Some(Instant::now());
            match open_pipe().map_err(IpcError::Io).and_then(|pipe| Conn::handshake(pipe, CLIENT_ID)) {
                Ok(c) => self.conn = Some(c),
                Err(IpcError::Io(_)) => return set_status(Status::NoDiscord),
                Err(IpcError::Refused(message)) => return set_status(Status::Error { message }),
            }
        }

        let Some(conn) = self.conn.as_mut() else { return };
        self.last_send = Some(Instant::now());
        match conn.set_activity(&want) {
            Ok(()) => set_status(Status::Showing { details: str_of(&want, "details").to_string() }),
            // Remember it anyway so the same rejected activity isn't retried every tick.
            Err(IpcError::Refused(message)) => set_status(Status::Error { message }),
            Err(IpcError::Io(e)) => {
                eprintln!("discord: connection lost: {e}");
                self.conn = None;
                self.shown = None;
                return set_status(Status::NoDiscord);
            }
        }
        self.shown = Some(want);
    }

    /// Closing the pipe is enough: Discord drops the activity with it.
    fn clear(&mut self) {
        self.conn = None;
        self.shown = None;
        self.gone_since = None;
    }

    /// The current world's API details, fetched once per world (and retried if that failed).
    fn world_info(&mut self, inst: &InstanceState) -> Option<WorldInfo> {
        let wid = inst.location.as_deref().and_then(location::world_id)?;
        let stale = match &self.world {
            Some((id, info, at)) => id != wid || (info.is_none() && at.elapsed() >= WORLD_RETRY),
            None => true,
        };
        if stale {
            let fetched = tauri::async_runtime::block_on(crate::sync::world(&self.app, wid, false));
            self.world = Some((wid.to_string(), fetched.ok().map(|w| WorldInfo::from_api(&w)), Instant::now()));
        }
        self.world.as_ref().and_then(|(_, info, _)| info.clone())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::gamelog::Player;

    /// Plays back what Discord would say and records what we wrote.
    struct FakePipe {
        input: Cursor<Vec<u8>>,
        output: Vec<u8>,
    }

    impl FakePipe {
        fn new(replies: &[(u32, Value)]) -> Self {
            let mut input = Vec::new();
            for (op, v) in replies {
                write_frame(&mut input, *op, v).unwrap();
            }
            Self { input: Cursor::new(input), output: Vec::new() }
        }

        fn written(&self) -> Vec<(u32, Value)> {
            let mut r = Cursor::new(&self.output);
            std::iter::from_fn(|| read_frame(&mut r).ok()).collect()
        }
    }

    impl Read for FakePipe {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            self.input.read(buf)
        }
    }

    impl Write for FakePipe {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.output.write(buf)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn handshakes_and_sets_activity() {
        let pipe = FakePipe::new(&[
            (OP_FRAME, json!({ "cmd": "DISPATCH", "evt": "READY", "data": { "v": 1 } })),
            (OP_PING, json!({ "n": 7 })),
            (OP_FRAME, json!({ "cmd": "SET_ACTIVITY", "evt": null, "nonce": "1", "data": {} })),
        ]);
        let mut c = Conn::handshake(pipe, "123").unwrap();
        c.set_activity(&json!({ "details": "The Black Cat" })).unwrap();

        let sent = c.pipe.written();
        assert_eq!(sent[0], (OP_HANDSHAKE, json!({ "v": 1, "client_id": "123" })));
        assert_eq!(sent[1].0, OP_FRAME);
        assert_eq!(sent[1].1["cmd"], "SET_ACTIVITY");
        assert_eq!(sent[1].1["args"]["activity"]["details"], "The Black Cat");
        assert_eq!(sent[2], (OP_PONG, json!({ "n": 7 })));
    }

    #[test]
    fn reports_refusals() {
        let bad_id = FakePipe::new(&[(OP_CLOSE, json!({ "code": 4000, "message": "Invalid Client ID" }))]);
        assert!(matches!(Conn::handshake(bad_id, "nope"), Err(IpcError::Refused(m)) if m == "Invalid Client ID"));

        let pipe = FakePipe::new(&[
            (OP_FRAME, json!({ "evt": "READY" })),
            (OP_FRAME, json!({ "evt": "ERROR", "nonce": "1", "data": { "code": 4002, "message": "child \"activity\" fails" } })),
        ]);
        let mut c = Conn::handshake(pipe, "123").unwrap();
        assert!(matches!(c.set_activity(&json!({})), Err(IpcError::Refused(m)) if m.contains("activity")));
        assert!(matches!(c.set_activity(&json!({})), Err(IpcError::Io(_))), "a closed pipe means reconnect");
    }

    fn instance(location: &str) -> InstanceState {
        let player = |n: &str| Player { user_id: None, display_name: n.into(), joined_ts: 0 };
        InstanceState {
            location: Some(location.into()),
            world_name: Some("The Black Cat".into()),
            since: Some(1_700_000_000_000),
            players: vec![player("a"), player("b"), player("c")],
        }
    }

    fn world() -> WorldInfo {
        WorldInfo {
            name: Some("The Black Cat".into()),
            author: Some("spookyghostboo".into()),
            image: Some("https://api.vrchat.cloud/api/1/image/file_x/1/256".into()),
            capacity: Some(16),
        }
    }

    const WRLD: &str = "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b";

    #[test]
    fn shows_public_instances_in_full() {
        let s = AppSettings { discord_presence: true, discord_join_button: true, ..Default::default() };
        let a = activity(&instance(&format!("{WRLD}:57893~region(eu)")), Some(&world()), &s).unwrap();
        assert_eq!(a["details"], "The Black Cat");
        assert_eq!(a["state"], "Public · Europe");
        assert_eq!(a["timestamps"]["start"], 1_700_000_000_000i64);
        assert_eq!(a["assets"]["large_text"], "by spookyghostboo");
        assert_eq!(a["party"]["size"], json!([3, 16]));
        assert_eq!(a["party"]["id"].as_str().unwrap().len(), 64);
        assert_eq!(
            a["buttons"][0]["url"],
            format!("https://vrchat.com/home/launch?worldId={WRLD}&instanceId=57893~region%28eu%29")
        );
    }

    #[test]
    fn hides_private_instances() {
        let loc = format!("{WRLD}:57893~private(usr_a)~canRequestInvite~region(eu)");
        let s = AppSettings { discord_presence: true, discord_join_button: true, ..Default::default() };
        let a = activity(&instance(&loc), Some(&world()), &s).unwrap();
        assert_eq!(a, json!({ "details": "In a private instance", "timestamps": { "start": 1_700_000_000_000i64 } }));

        // Shown when asked to, but there's still nothing to join.
        let s = AppSettings { discord_hide_private: false, ..s };
        let a = activity(&instance(&loc), Some(&world()), &s).unwrap();
        assert_eq!((a["details"].as_str(), a["state"].as_str()), (Some("The Black Cat"), Some("Invite+ · Europe")));
        assert!(a.get("buttons").is_none());
    }

    #[test]
    fn copes_with_missing_details() {
        let s = AppSettings::default();
        let mut inst = instance(&format!("{WRLD}:1~hidden(usr_a)"));
        inst.world_name = None;
        inst.players.clear();
        let a = activity(&inst, None, &s).unwrap();
        assert_eq!((a["details"].as_str(), a["state"].as_str()), (Some("In a world"), Some("Friends+ · US West")));
        assert!(a.get("assets").is_none() && a.get("party").is_none() && a.get("buttons").is_none());

        // More people than the world's cap still makes a valid party.
        let mut full = instance(&format!("{WRLD}:1"));
        full.players.extend((0..20).map(|i| Player { user_id: None, display_name: i.to_string(), joined_ts: 0 }));
        assert_eq!(activity(&full, Some(&world()), &s).unwrap()["party"]["size"], json!([23, 23]));

        assert!(activity(&InstanceState::default(), Some(&world()), &s).is_none());
        assert_eq!(text("x"), None);
        assert_eq!(text(&"y".repeat(200)).unwrap().chars().count(), 128);
    }
}
