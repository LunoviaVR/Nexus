//! Tails VRChat's `output_log_*.txt` files: worlds visited, players met, videos and avatar switches.

use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use chrono::{Local, NaiveDateTime, TimeZone};
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::location;
use crate::state::AppState;
use crate::sync;

#[derive(Debug, Clone, PartialEq)]
pub enum LogEvent {
    Joining(String),
    RoomName(String),
    PlayerJoined { name: String, user_id: Option<String> },
    PlayerLeft { name: String, user_id: Option<String> },
    LeftRoom,
    Video(String),
    Avatar { name: String, avatar: String },
    /// The game fetched a print (someone showed it in the instance).
    PrintLoaded(String),
    StickerSpawned { user_id: String, name: String, inventory_id: String },
}

static RE_JOINING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[Behaviour\] Joining (wrld_\S+)").unwrap());
static RE_ROOM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[Behaviour\] (?:Joining or Creating Room|Entering Room): (.+?)\s*$").unwrap());
static RE_PLAYER_JOINED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[Behaviour\] OnPlayerJoined (?:immediate )?(.+?)(?: \((usr_[0-9A-Za-z-]+)\))?\s*$").unwrap()
});
static RE_PLAYER_LEFT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[Behaviour\] OnPlayerLeft (.+?)(?: \((usr_[0-9A-Za-z-]+)\))?\s*$").unwrap());
static RE_VIDEO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[Video Playback\] Attempting to resolve URL '(.+)'").unwrap());
static RE_PRINT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[API\] \[\d+\] Sending Get request to https://api\.vrchat\.cloud/api/1/prints/(prnt_[0-9a-f-]{36})").unwrap()
});
static RE_STICKER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[StickersManager\] User (usr_[0-9a-f-]+) \((.*)\) spawned sticker (inv_[0-9a-f-]+)").unwrap()
});
static RE_AVATAR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[Behaviour\] Switching (.+) to avatar (.+?)\s*$").unwrap());

fn parse_ts(s: &str) -> Option<i64> {
    let naive = NaiveDateTime::parse_from_str(s, "%Y.%m.%d %H:%M:%S").ok()?;
    Local.from_local_datetime(&naive).earliest().map(|d| d.timestamp_millis())
}

pub fn parse_line(line: &str) -> Option<(i64, LogEvent)> {
    if !line.contains("[Behaviour]")
        && !line.contains("[Video Playback]")
        && !line.contains("/api/1/prints/")
        && !line.contains("[StickersManager]")
        && !line.contains("VRCApplication: HandleApplicationQuit")
    {
        return None;
    }
    let ts = parse_ts(line.get(..19)?)?;
    let ev = if let Some(c) = RE_JOINING.captures(line) {
        LogEvent::Joining(c[1].to_string())
    } else if let Some(c) = RE_ROOM.captures(line) {
        LogEvent::RoomName(c[1].to_string())
    } else if let Some(c) = RE_PLAYER_JOINED.captures(line) {
        LogEvent::PlayerJoined { name: c[1].to_string(), user_id: c.get(2).map(|m| m.as_str().to_string()) }
    } else if let Some(c) = RE_PLAYER_LEFT.captures(line) {
        LogEvent::PlayerLeft { name: c[1].to_string(), user_id: c.get(2).map(|m| m.as_str().to_string()) }
    } else if line.contains("[Behaviour] OnLeftRoom") || line.contains("VRCApplication: HandleApplicationQuit") {
        // Quitting the game never logs OnLeftRoom, so treat the quit as leaving too.
        LogEvent::LeftRoom
    } else if let Some(c) = RE_VIDEO.captures(line) {
        LogEvent::Video(c[1].to_string())
    } else if let Some(c) = RE_PRINT.captures(line) {
        LogEvent::PrintLoaded(c[1].to_string())
    } else if let Some(c) = RE_STICKER.captures(line) {
        LogEvent::StickerSpawned { user_id: c[1].to_string(), name: c[2].to_string(), inventory_id: c[3].to_string() }
    } else if let Some(c) = RE_AVATAR.captures(line) {
        LogEvent::Avatar { name: c[1].to_string(), avatar: c[2].to_string() }
    } else {
        return None;
    };
    Some((ts, ev))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub user_id: Option<String>,
    pub display_name: String,
    pub joined_ts: i64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstanceState {
    pub location: Option<String>,
    pub world_name: Option<String>,
    pub since: Option<i64>,
    pub players: Vec<Player>,
}

impl PartialEq for Player {
    fn eq(&self, o: &Self) -> bool {
        self.display_name == o.display_name && self.joined_ts == o.joined_ts
    }
}

const PROCESS_CHECK_EVERY: Duration = Duration::from_secs(10);

/// Whether VRChat.exe is running; None if we couldn't tell (then nothing is cleared).
#[cfg(windows)]
fn vrchat_running() -> Option<bool> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq VRChat.exe", "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_ascii_lowercase().contains("\"vrchat.exe\""))
}

#[cfg(not(windows))]
fn vrchat_running() -> Option<bool> {
    None
}

pub fn default_log_dir() -> Option<PathBuf> {
    std::env::var_os("NEXUS_LOG_DIR").map(PathBuf::from).or_else(|| {
        std::env::var_os("USERPROFILE")
            .map(|home| PathBuf::from(home).join("AppData").join("LocalLow").join("VRChat").join("VRChat"))
    })
}

struct Tracker {
    app: AppHandle,
    offsets: HashMap<String, u64>,
    current_file: Option<String>,
    started: bool,
    live: bool,
    location: Option<String>,
    loc_row: Option<i64>,
    loc_ts: i64,
    world_name: Option<String>,
    pending_name: Option<String>,
    players: BTreeMap<String, Player>,
    last_ts: i64,
    dirty: bool,
    /// When we last asked Windows whether VRChat is still running.
    last_process_check: Option<std::time::Instant>,
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let offsets = app.state::<AppState>().db.kv_json("gamelog_offsets").unwrap_or_default();
        let mut t = Tracker {
            app,
            offsets,
            current_file: None,
            started: false,
            live: false,
            location: None,
            loc_row: None,
            loc_ts: 0,
            world_name: None,
            pending_name: None,
            players: BTreeMap::new(),
            last_ts: 0,
            dirty: false,
            last_process_check: None,
        };
        loop {
            if let Err(e) = t.tick() {
                eprintln!("gamelog: {e}");
            }
            t.live = true;
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

impl Tracker {
    fn dir(&self) -> Option<PathBuf> {
        let st = self.app.state::<AppState>();
        let custom = st.settings.read().log_dir.clone().filter(|s| !s.trim().is_empty());
        custom.map(PathBuf::from).or_else(default_log_dir)
    }

    fn tick(&mut self) -> crate::error::Result<()> {
        let Some(dir) = self.dir() else { return Ok(()) };
        let Ok(read) = std::fs::read_dir(&dir) else { return Ok(()) };
        let mut files: Vec<(String, PathBuf)> = read
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                (name.starts_with("output_log_") && name.ends_with(".txt")).then(|| (name, e.path()))
            })
            .collect();
        files.sort();

        if !self.started {
            self.started = true;
            if let Some((name, path)) = files.last() {
                let off = self.offsets.get(name).copied().unwrap_or(0);
                if off > 0 {
                    self.rebuild(path, off);
                    self.current_file = Some(name.clone());
                }
            }
            let st = self.app.state::<AppState>();
            st.db.presence_close_stale(self.location.as_deref(), self.loc_ts)?;
            self.dirty = true;
        }

        let mut changed = false;
        for (name, path) in &files {
            let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let mut off = self.offsets.get(name).copied().unwrap_or(0);
            if len < off {
                off = 0;
            }
            if len == off {
                continue;
            }
            if self.current_file.as_deref() != Some(name.as_str()) {
                if self.current_file.is_some() {
                    self.finish(self.last_ts);
                }
                self.current_file = Some(name.clone());
            }
            let mut buf = Vec::with_capacity((len - off) as usize);
            let mut f = File::open(path)?;
            f.seek(SeekFrom::Start(off))?;
            f.take(len - off).read_to_end(&mut buf)?;
            let Some(end) = buf.iter().rposition(|b| *b == b'\n') else { continue };
            let text = String::from_utf8_lossy(&buf[..=end]);

            // Batch each chunk into one transaction; backfills can be thousands of rows.
            let app = self.app.clone();
            let _ = app.state::<AppState>().db.conn().execute_batch("BEGIN");
            for line in text.lines() {
                if let Some((ts, ev)) = parse_line(line.trim_end_matches('\r')) {
                    self.apply(ts, ev);
                }
            }
            let _ = app.state::<AppState>().db.conn().execute_batch("COMMIT");
            self.offsets.insert(name.clone(), off + end as u64 + 1);
            changed = true;
        }

        // A crash or a killed process leaves no quit line, so double-check the game is still running.
        if self.location.is_some() && self.last_process_check.is_none_or(|t| t.elapsed() >= PROCESS_CHECK_EVERY) {
            self.last_process_check = Some(std::time::Instant::now());
            if vrchat_running() == Some(false) {
                self.finish(self.last_ts.max(self.loc_ts));
            }
        }

        if changed {
            // Forget files VRChat has cleaned up.
            self.offsets.retain(|k, _| files.iter().any(|(n, _)| n == k));
            let st = self.app.state::<AppState>();
            st.db.kv_set("gamelog_offsets", &serde_json::to_string(&self.offsets)?)?;
        }
        if self.dirty {
            self.dirty = false;
            let snapshot = InstanceState {
                location: self.location.clone(),
                world_name: self.world_name.clone(),
                since: self.location.as_ref().map(|_| self.loc_ts),
                players: self.players.values().cloned().collect(),
            };
            let st = self.app.state::<AppState>();
            let mut cur = st.instance.lock();
            if *cur != snapshot {
                *cur = snapshot.clone();
                drop(cur);
                let _ = self.app.emit("gamelog:instance", &snapshot);
            }
        }
        Ok(())
    }

    /// Replay the already-imported part of the newest log in memory, so a restart mid-session
    /// still knows where we are and who is around.
    fn rebuild(&mut self, path: &Path, upto: u64) {
        let Ok(mut f) = File::open(path) else { return };
        let mut buf = Vec::new();
        if (&mut f).take(upto).read_to_end(&mut buf).is_err() {
            return;
        }
        for line in String::from_utf8_lossy(&buf).lines() {
            let Some((ts, ev)) = parse_line(line.trim_end_matches('\r')) else { continue };
            self.last_ts = ts;
            match ev {
                LogEvent::Joining(loc) => {
                    self.players.clear();
                    self.world_name = self.pending_name.take();
                    self.location = Some(loc);
                    self.loc_ts = ts;
                }
                LogEvent::RoomName(n) => {
                    if self.location.is_some() && self.world_name.is_none() {
                        self.world_name = Some(n);
                    } else {
                        self.pending_name = Some(n);
                    }
                }
                LogEvent::PlayerJoined { name, user_id } => {
                    self.players.insert(name.clone(), Player { user_id, display_name: name, joined_ts: ts });
                }
                LogEvent::PlayerLeft { name, .. } => {
                    self.players.remove(&name);
                }
                LogEvent::LeftRoom => {
                    self.players.clear();
                    self.location = None;
                    self.world_name = None;
                }
                _ => {}
            }
        }
        if let Some(loc) = &self.location {
            self.loc_row = self.app.state::<AppState>().db.gl_location_find(self.loc_ts, loc);
        }
    }

    fn finish(&mut self, ts: i64) {
        let st = self.app.state::<AppState>();
        if let Some(id) = self.loc_row.take() {
            let _ = st.db.gl_location_set_duration(id, ts - self.loc_ts);
        }
        let _ = st.db.presence_close_all(ts);
        self.players.clear();
        self.location = None;
        self.world_name = None;
        self.dirty = true;
    }

    fn apply(&mut self, ts: i64, ev: LogEvent) {
        let app = self.app.clone();
        let st = app.state::<AppState>();
        let db = &st.db;
        self.last_ts = ts;
        if let Some(id) = self.loc_row {
            let _ = db.gl_location_set_duration(id, ts - self.loc_ts);
        }
        let loc = self.location.clone();
        let event = match ev {
            LogEvent::Joining(new_loc) => {
                self.finish(ts);
                let wid = location::world_id(&new_loc).unwrap_or(&new_loc).to_string();
                self.world_name = self.pending_name.take();
                self.loc_row = db.gl_location_insert(ts, &new_loc, &wid, self.world_name.as_deref()).ok();
                self.location = Some(new_loc.clone());
                self.loc_ts = ts;
                if self.live && self.world_name.is_none() {
                    // Fill the name from the API if the log line hasn't shown up.
                    let (a, row, l) = (app.clone(), self.loc_row, new_loc);
                    tauri::async_runtime::spawn(async move {
                        if let (Some(row), Some(name)) = (row, sync::world_name_for(&a, &l).await) {
                            let _ = a.state::<AppState>().db.gl_location_set_name(row, &name);
                        }
                    });
                }
                None
            }
            LogEvent::RoomName(name) => {
                match self.loc_row {
                    Some(row) if self.world_name.is_none() => {
                        let _ = db.gl_location_set_name(row, &name);
                        self.world_name = Some(name);
                    }
                    _ => self.pending_name = Some(name),
                }
                None
            }
            LogEvent::PlayerJoined { name, user_id } => {
                let Some(l) = loc.as_deref() else { return };
                let _ = db.presence_open(ts, user_id.as_deref(), &name, l);
                self.players.insert(
                    name.clone(),
                    Player { user_id: user_id.clone(), display_name: name.clone(), joined_ts: ts },
                );
                if self.live {
                    if let Some(uid) = user_id.as_deref() {
                        let me = st.me_id().unwrap_or_default();
                        if uid != me && sync::in_scope(&app, st.settings().notify_instance_join, uid) {
                            sync::toast(&app, &format!("{name} joined your instance"), self.world_name.as_deref().unwrap_or(""));
                        }
                    }
                }
                db.gl_event_insert(ts, "join", user_id.as_deref(), Some(&name), Some(l), None).ok()
            }
            LogEvent::PlayerLeft { name, user_id } => {
                let _ = db.presence_close(&name, ts);
                let uid = user_id.or_else(|| self.players.get(&name).and_then(|p| p.user_id.clone()));
                self.players.remove(&name);
                db.gl_event_insert(ts, "leave", uid.as_deref(), Some(&name), loc.as_deref(), None).ok()
            }
            LogEvent::LeftRoom => {
                self.finish(ts);
                None
            }
            LogEvent::Video(url) => db.gl_event_insert(ts, "video", None, None, loc.as_deref(), Some(&url)).ok(),
            LogEvent::Avatar { name, avatar } => {
                let uid = self.players.get(&name).and_then(|p| p.user_id.clone());
                db.gl_event_insert(ts, "avatar", uid.as_deref(), Some(&name), loc.as_deref(), Some(&avatar)).ok()
            }
            // Only save content seen live; replaying old logs would mass-download history.
            LogEvent::PrintLoaded(print_id) => {
                if self.live {
                    crate::ugc::enqueue(crate::ugc::Job::Print { print_id });
                }
                return;
            }
            LogEvent::StickerSpawned { user_id, name, inventory_id } => {
                if self.live {
                    crate::ugc::enqueue(crate::ugc::Job::Sticker { user_id, display_name: name, inventory_id });
                }
                return;
            }
        };
        self.dirty = true;
        if self.live {
            if let Some(e) = event {
                let _ = app.emit("gamelog:event", &e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../tests/fixtures/output_log_sample.txt");

    #[test]
    fn parses_fixture_lines() {
        let events: Vec<LogEvent> = FIXTURE.lines().filter_map(parse_line).map(|(_, e)| e).collect();
        assert_eq!(
            events,
            vec![
                LogEvent::RoomName("The Black Cat".into()),
                LogEvent::Joining("wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b:57893~region(eu)".into()),
                LogEvent::PlayerJoined {
                    name: "Some Player".into(),
                    user_id: Some("usr_a1b2c3d4-0000-1111-2222-333344445555".into())
                },
                LogEvent::PlayerJoined { name: "Old Format Name".into(), user_id: None },
                LogEvent::Avatar { name: "Some Player".into(), avatar: "Cool Fox".into() },
                LogEvent::Video("https://www.youtube.com/watch?v=dQw4w9WgXcQ".into()),
                LogEvent::PlayerLeft {
                    name: "Some Player".into(),
                    user_id: Some("usr_a1b2c3d4-0000-1111-2222-333344445555".into())
                },
                LogEvent::LeftRoom,
            ]
        );
    }

    #[test]
    fn parses_print_and_sticker_lines() {
        let p = "2026.10.05 22:10:01 Debug      -  [API] [212] Sending Get request to https://api.vrchat.cloud/api/1/prints/prnt_2b0a2a3e-2a2b-4c4d-8e8f-0a1b2c3d4e5f?apiKey=x&organization=vrchat";
        assert_eq!(parse_line(p).unwrap().1, LogEvent::PrintLoaded("prnt_2b0a2a3e-2a2b-4c4d-8e8f-0a1b2c3d4e5f".into()));
        let s = "2026.10.05 22:10:02 Log        -  [StickersManager] User usr_032383a7-748c-4fb2-94e4-bcb928e5de6b (Some (Name)) spawned sticker inv_8b380ee4-9a8a-484e-a0c3-b01290b92c6a";
        assert_eq!(
            parse_line(s).unwrap().1,
            LogEvent::StickerSpawned {
                user_id: "usr_032383a7-748c-4fb2-94e4-bcb928e5de6b".into(),
                name: "Some (Name)".into(),
                inventory_id: "inv_8b380ee4-9a8a-484e-a0c3-b01290b92c6a".into(),
            }
        );
    }

    #[test]
    fn quitting_counts_as_leaving() {
        let q = "2026.10.07 22:39:31 Debug      -  VRCApplication: HandleApplicationQuit at 20527.41";
        assert_eq!(parse_line(q).unwrap().1, LogEvent::LeftRoom);
    }

    #[test]
    fn ignores_noise() {
        assert!(parse_line("2024.01.15 20:31:05 Log        -  [Behaviour] OnPlayerLeftRoom").is_none());
        assert!(parse_line("garbage").is_none());
        assert!(parse_line("2024.01.15 20:31:05 Log        -  [Network] something").is_none());
    }

    #[test]
    fn timestamp_is_local() {
        let (ts, _) = parse_line("2024.01.15 20:31:05 Log        -  [Behaviour] OnLeftRoom").unwrap();
        let expected = Local.with_ymd_and_hms(2024, 1, 15, 20, 31, 5).unwrap().timestamp_millis();
        assert_eq!(ts, expected);
    }
}
