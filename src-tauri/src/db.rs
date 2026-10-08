//! Local SQLite store: activity feed, game log history, caches, memos and settings.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use chrono::{Datelike, Local, TimeZone, Timelike};
use parking_lot::{Mutex, MutexGuard};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::settings::AppSettings;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    location TEXT,
    world_name TEXT,
    prev TEXT,
    next TEXT
);
CREATE INDEX IF NOT EXISTS feed_owner_ts ON feed(owner_id, ts DESC);
CREATE INDEX IF NOT EXISTS feed_user_ts ON feed(user_id, ts DESC);

CREATE TABLE IF NOT EXISTS gamelog_location (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    location TEXT NOT NULL,
    world_id TEXT NOT NULL,
    world_name TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gl_loc_ts ON gamelog_location(ts DESC);
CREATE INDEX IF NOT EXISTS gl_loc_location ON gamelog_location(location);

CREATE TABLE IF NOT EXISTS gamelog_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    user_id TEXT,
    display_name TEXT,
    location TEXT,
    data TEXT
);
CREATE INDEX IF NOT EXISTS gl_ev_ts ON gamelog_event(ts DESC);
CREATE INDEX IF NOT EXISTS gl_ev_user ON gamelog_event(user_id);

CREATE TABLE IF NOT EXISTS presence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    display_name TEXT NOT NULL,
    location TEXT NOT NULL,
    joined_ts INTEGER NOT NULL,
    left_ts INTEGER
);
CREATE INDEX IF NOT EXISTS presence_user ON presence(user_id, joined_ts DESC);
CREATE INDEX IF NOT EXISTS presence_loc ON presence(location, joined_ts);
CREATE INDEX IF NOT EXISTS presence_open ON presence(left_ts);

CREATE TABLE IF NOT EXISTS friend_log (
    owner_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    added_ts INTEGER,
    removed_ts INTEGER,
    PRIMARY KEY (owner_id, user_id)
);

CREATE TABLE IF NOT EXISTS memos (
    owner_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (owner_id, user_id)
);

CREATE TABLE IF NOT EXISTS cache (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    json TEXT NOT NULL,
    fetched_ts INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
);
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedEntry {
    pub id: i64,
    pub ts: i64,
    pub kind: String,
    pub user_id: String,
    pub display_name: String,
    pub location: Option<String>,
    pub world_name: Option<String>,
    pub prev: Option<String>,
    pub next: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FeedQuery {
    pub kinds: Option<Vec<String>>,
    pub search: Option<String>,
    pub user_ids: Option<Vec<String>>,
    pub before: Option<i64>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlEvent {
    pub id: i64,
    pub ts: i64,
    pub kind: String,
    pub user_id: Option<String>,
    pub display_name: Option<String>,
    pub location: Option<String>,
    pub data: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GlQuery {
    pub kinds: Option<Vec<String>>,
    pub search: Option<String>,
    pub before: Option<i64>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceRow {
    pub user_id: Option<String>,
    pub display_name: String,
    pub joined_ts: i64,
    pub left_ts: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRow {
    pub ts: i64,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlSession {
    pub id: i64,
    pub ts: i64,
    pub location: String,
    pub world_id: String,
    pub world_name: Option<String>,
    pub duration_ms: i64,
    pub players: Vec<PresenceRow>,
    pub videos: Vec<VideoRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeenAvatar {
    pub name: String,
    pub times: i64,
    pub first_seen: i64,
    pub last_seen: i64,
    pub last_location: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Encounter {
    pub ts: i64,
    pub duration_ms: i64,
    pub location: String,
    pub world_name: Option<String>,
    /// Start of the Game Log session this happened in, for jumping to it.
    pub session_ts: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserHistory {
    pub feed: Vec<FeedEntry>,
    pub encounters: i64,
    pub time_together_ms: i64,
    pub first_seen: Option<i64>,
    pub last_seen: Option<i64>,
    pub friend_added: Option<i64>,
    /// Your own total time in VRChat (from the game log); used on your own profile.
    pub total_play_ms: i64,
    pub recent: Vec<Encounter>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPoint {
    pub date: String,
    pub ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopWorld {
    pub world_id: String,
    pub world_name: Option<String>,
    pub ms: i64,
    pub visits: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopPerson {
    pub user_id: String,
    pub display_name: String,
    pub ms: i64,
    pub encounters: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Count {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub total_play_ms: i64,
    pub sessions: i64,
    pub unique_worlds: i64,
    pub unique_players: i64,
    pub daily: Vec<DailyPoint>,
    /// 7 rows (Mon..Sun) x 24 hours, minutes played.
    pub heatmap: Vec<Vec<i64>>,
    pub top_worlds: Vec<TopWorld>,
    pub top_people: Vec<TopPerson>,
    pub friends_added: Vec<Count>,
    pub feed_counts: Vec<Count>,
}

pub struct Db {
    conn: Mutex<Connection>,
}

fn in_clause(n: usize) -> String {
    vec!["?"; n].join(",")
}

impl Db {
    /// Open the encrypted database. A plaintext database from before encryption is converted first;
    /// one that can't be read with this key (the key was lost) is moved aside and a new one started.
    pub fn open(path: &Path, key: &[u8; 32]) -> Result<Self> {
        if is_plaintext(path) {
            encrypt_in_place(path, key)?;
        }
        let conn = Connection::open(path)?;
        apply_key(&conn, key)?;
        if conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err() {
            drop(conn);
            let aside = path.with_extension(format!("db.unreadable-{}", now_ms()));
            eprintln!("db: {} can't be decrypted with the stored key; moved to {}", path.display(), aside.display());
            std::fs::rename(path, &aside)?;
            for ext in ["db-wal", "db-shm"] {
                let _ = std::fs::remove_file(path.with_extension(ext));
            }
            let conn = Connection::open(path)?;
            apply_key(&conn, key)?;
            return Self::init(conn);
        }
        Self::init(conn)
    }

    /// Write a plaintext copy of everything to `dest`. This is the one deliberate way to read the data.
    pub fn export_decrypted(&self, dest: &Path) -> Result<()> {
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        let c = self.conn();
        let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        c.execute_batch(&format!("ATTACH DATABASE {} AS plain KEY '';", sql_str(&dest.to_string_lossy())))?;
        let res = c
            .query_row("SELECT sqlcipher_export('plain')", [], |_| Ok(()))
            .and_then(|_| c.execute_batch(&format!("PRAGMA plain.user_version = {version};")));
        let _ = c.execute_batch("DETACH DATABASE plain;");
        res?;
        Ok(())
    }

    #[cfg(test)]
    pub fn memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.execute_batch("PRAGMA user_version = 1")?;
        }
        if version < 3 {
            // Version 2 added a heart_rate table for a feature that has since been removed.
            conn.execute_batch("DROP TABLE IF EXISTS heart_rate; PRAGMA user_version = 3")?;
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock()
    }

    // ---------- settings / kv ----------

    pub fn kv_get(&self, key: &str) -> Option<String> {
        self.conn()
            .query_row("SELECT value FROM settings WHERE key = ?", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn kv_json<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.kv_get(key).and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn load_settings(&self) -> AppSettings {
        self.kv_json("app_settings").unwrap_or_default()
    }

    // ---------- feed ----------

    pub fn feed_insert(&self, owner: &str, e: &mut FeedEntry) -> Result<()> {
        let c = self.conn();
        c.execute(
            "INSERT INTO feed (owner_id, ts, kind, user_id, display_name, location, world_name, prev, next)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![owner, e.ts, e.kind, e.user_id, e.display_name, e.location, e.world_name, e.prev, e.next],
        )?;
        e.id = c.last_insert_rowid();
        Ok(())
    }

    pub fn feed_query(&self, owner: &str, q: &FeedQuery) -> Result<Vec<FeedEntry>> {
        let mut sql = String::from(
            "SELECT id, ts, kind, user_id, display_name, location, world_name, prev, next FROM feed WHERE owner_id = ?",
        );
        let mut args: Vec<SqlValue> = vec![owner.to_string().into()];
        if let Some(kinds) = q.kinds.as_ref().filter(|k| !k.is_empty()) {
            sql += &format!(" AND kind IN ({})", in_clause(kinds.len()));
            args.extend(kinds.iter().map(|k| SqlValue::from(k.clone())));
        }
        if let Some(ids) = q.user_ids.as_ref() {
            if ids.is_empty() {
                return Ok(vec![]);
            }
            sql += &format!(" AND user_id IN ({})", in_clause(ids.len()));
            args.extend(ids.iter().map(|k| SqlValue::from(k.clone())));
        }
        if let Some(s) = q.search.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            sql += " AND (display_name LIKE ? OR world_name LIKE ? OR next LIKE ?)";
            let like = format!("%{s}%");
            args.extend([like.clone().into(), like.clone().into(), like.into()]);
        }
        if let Some(before) = q.before {
            sql += " AND ts < ?";
            args.push(before.into());
        }
        sql += " ORDER BY ts DESC LIMIT ?";
        args.push(i64::from(q.limit.unwrap_or(100).min(1000)).into());

        let c = self.conn();
        let mut stmt = c.prepare(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(args.iter()), Self::map_feed)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn map_feed(r: &rusqlite::Row) -> rusqlite::Result<FeedEntry> {
        Ok(FeedEntry {
            id: r.get(0)?,
            ts: r.get(1)?,
            kind: r.get(2)?,
            user_id: r.get(3)?,
            display_name: r.get(4)?,
            location: r.get(5)?,
            world_name: r.get(6)?,
            prev: r.get(7)?,
            next: r.get(8)?,
        })
    }

    // ---------- friend log ----------

    /// Diff the current friend list against the stored log. Returns (added, removed) as (id, name).
    /// On the very first sync nothing is reported, so existing friends don't flood the feed.
    pub fn friend_log_sync(
        &self,
        owner: &str,
        current: &[(String, String)],
    ) -> Result<(Vec<(String, String)>, Vec<(String, String)>)> {
        let now = now_ms();
        let c = self.conn();
        let mut stmt = c.prepare("SELECT user_id, display_name, removed_ts FROM friend_log WHERE owner_id = ?")?;
        let rows: Vec<(String, String, Option<i64>)> = stmt
            .query_map([owner], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<_, _>>()?;
        drop(stmt);
        let first_run = rows.is_empty();
        let known: HashMap<&str, Option<i64>> = rows.iter().map(|(id, _, rm)| (id.as_str(), *rm)).collect();
        let current_ids: HashSet<&str> = current.iter().map(|(id, _)| id.as_str()).collect();

        let mut added = vec![];
        let mut removed = vec![];
        c.execute_batch("BEGIN")?;
        for (id, name) in current {
            match known.get(id.as_str()) {
                None => {
                    let ts = if first_run { None } else { Some(now) };
                    c.execute(
                        "INSERT INTO friend_log (owner_id, user_id, display_name, added_ts) VALUES (?1, ?2, ?3, ?4)",
                        params![owner, id, name, ts],
                    )?;
                    if !first_run {
                        added.push((id.clone(), name.clone()));
                    }
                }
                Some(Some(_)) => {
                    c.execute(
                        "UPDATE friend_log SET added_ts = ?3, removed_ts = NULL, display_name = ?4 WHERE owner_id = ?1 AND user_id = ?2",
                        params![owner, id, now, name],
                    )?;
                    added.push((id.clone(), name.clone()));
                }
                Some(None) => {
                    c.execute(
                        "UPDATE friend_log SET display_name = ?3 WHERE owner_id = ?1 AND user_id = ?2",
                        params![owner, id, name],
                    )?;
                }
            }
        }
        for (id, name, rm) in &rows {
            if rm.is_none() && !current_ids.contains(id.as_str()) {
                c.execute(
                    "UPDATE friend_log SET removed_ts = ?3 WHERE owner_id = ?1 AND user_id = ?2",
                    params![owner, id, now],
                )?;
                removed.push((id.clone(), name.clone()));
            }
        }
        c.execute_batch("COMMIT")?;
        Ok((added, removed))
    }

    pub fn friend_log_set(&self, owner: &str, user_id: &str, name: &str, added: bool) -> Result<()> {
        let now = now_ms();
        let c = self.conn();
        if added {
            c.execute(
                "INSERT INTO friend_log (owner_id, user_id, display_name, added_ts) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(owner_id, user_id) DO UPDATE SET added_ts = ?4, removed_ts = NULL, display_name = ?3",
                params![owner, user_id, name, now],
            )?;
        } else {
            c.execute(
                "UPDATE friend_log SET removed_ts = ?3 WHERE owner_id = ?1 AND user_id = ?2",
                params![owner, user_id, now],
            )?;
        }
        Ok(())
    }

    // ---------- memos ----------

    pub fn memo_get(&self, owner: &str, user_id: &str) -> Result<String> {
        Ok(self
            .conn()
            .query_row("SELECT text FROM memos WHERE owner_id = ? AND user_id = ?", [owner, user_id], |r| r.get(0))
            .optional()?
            .unwrap_or_default())
    }

    pub fn memo_set(&self, owner: &str, user_id: &str, text: &str) -> Result<()> {
        let c = self.conn();
        if text.trim().is_empty() {
            c.execute("DELETE FROM memos WHERE owner_id = ? AND user_id = ?", [owner, user_id])?;
        } else {
            c.execute(
                "INSERT INTO memos (owner_id, user_id, text) VALUES (?1, ?2, ?3)
                 ON CONFLICT(owner_id, user_id) DO UPDATE SET text = excluded.text",
                params![owner, user_id, text],
            )?;
        }
        Ok(())
    }

    // ---------- cache ----------

    pub fn cache_get(&self, kind: &str, id: &str) -> Option<(Value, i64)> {
        let row: Option<(String, i64)> = self
            .conn()
            .query_row("SELECT json, fetched_ts FROM cache WHERE kind = ? AND id = ?", [kind, id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .ok()
            .flatten();
        row.and_then(|(json, ts)| serde_json::from_str(&json).ok().map(|v| (v, ts)))
    }

    pub fn cache_put(&self, kind: &str, id: &str, value: &Value) -> Result<()> {
        self.conn().execute(
            "INSERT INTO cache (kind, id, json, fetched_ts) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(kind, id) DO UPDATE SET json = excluded.json, fetched_ts = excluded.fetched_ts",
            params![kind, id, value.to_string(), now_ms()],
        )?;
        Ok(())
    }

    pub fn cache_clear(&self) -> Result<()> {
        self.conn().execute("DELETE FROM cache", [])?;
        Ok(())
    }

    // ---------- game log ----------

    pub fn gl_location_insert(&self, ts: i64, location: &str, world_id: &str, world_name: Option<&str>) -> Result<i64> {
        let c = self.conn();
        c.execute(
            "INSERT INTO gamelog_location (ts, location, world_id, world_name) VALUES (?1, ?2, ?3, ?4)",
            params![ts, location, world_id, world_name],
        )?;
        Ok(c.last_insert_rowid())
    }

    pub fn gl_location_find(&self, ts: i64, location: &str) -> Option<i64> {
        self.conn()
            .query_row(
                "SELECT id FROM gamelog_location WHERE ts = ? AND location = ? ORDER BY id DESC LIMIT 1",
                params![ts, location],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn gl_location_set_name(&self, id: i64, name: &str) -> Result<()> {
        self.conn()
            .execute("UPDATE gamelog_location SET world_name = ? WHERE id = ?", params![name, id])?;
        Ok(())
    }

    pub fn gl_location_set_duration(&self, id: i64, ms: i64) -> Result<()> {
        self.conn().execute(
            "UPDATE gamelog_location SET duration_ms = ? WHERE id = ?",
            params![ms.max(0), id],
        )?;
        Ok(())
    }

    pub fn gl_event_insert(
        &self,
        ts: i64,
        kind: &str,
        user_id: Option<&str>,
        display_name: Option<&str>,
        location: Option<&str>,
        data: Option<&str>,
    ) -> Result<GlEvent> {
        let c = self.conn();
        c.execute(
            "INSERT INTO gamelog_event (ts, kind, user_id, display_name, location, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![ts, kind, user_id, display_name, location, data],
        )?;
        Ok(GlEvent {
            id: c.last_insert_rowid(),
            ts,
            kind: kind.into(),
            user_id: user_id.map(Into::into),
            display_name: display_name.map(Into::into),
            location: location.map(Into::into),
            data: data.map(Into::into),
        })
    }

    pub fn presence_open(&self, ts: i64, user_id: Option<&str>, name: &str, location: &str) -> Result<()> {
        self.conn().execute(
            // A repeated join line for someone already here must not open a second row,
            // or the older one is never closed and they show up twice.
            "INSERT INTO presence (user_id, display_name, location, joined_ts)
             SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (
                SELECT 1 FROM presence WHERE display_name = ?2 AND location = ?3 AND left_ts IS NULL)",
            params![user_id, name, location, ts],
        )?;
        Ok(())
    }

    pub fn presence_close(&self, name: &str, ts: i64) -> Result<()> {
        self.conn().execute(
            "UPDATE presence SET left_ts = ?2 WHERE id = (
                SELECT id FROM presence WHERE display_name = ?1 AND left_ts IS NULL ORDER BY id DESC LIMIT 1)",
            params![name, ts],
        )?;
        Ok(())
    }

    pub fn presence_close_all(&self, ts: i64) -> Result<()> {
        self.conn()
            .execute("UPDATE presence SET left_ts = ?1 WHERE left_ts IS NULL", [ts])?;
        Ok(())
    }

    /// Close presence rows left open by a previous run (except the instance we're still in).
    pub fn presence_close_stale(&self, keep_location: Option<&str>, keep_since: i64) -> Result<()> {
        self.conn().execute(
            "UPDATE presence SET left_ts = COALESCE((
                SELECT l.ts + l.duration_ms FROM gamelog_location l
                WHERE l.location = presence.location AND l.ts <= presence.joined_ts
                ORDER BY l.ts DESC LIMIT 1), joined_ts)
             WHERE left_ts IS NULL AND NOT (location IS ?1 AND joined_ts >= ?2)",
            params![keep_location, keep_since],
        )?;
        Ok(())
    }

    pub fn gl_sessions(&self, q: &GlQuery) -> Result<Vec<GlSession>> {
        let mut sql = String::from(
            "SELECT id, ts, location, world_id, world_name, duration_ms FROM gamelog_location l WHERE 1=1",
        );
        let mut args: Vec<SqlValue> = vec![];
        if let Some(s) = q.search.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let like = format!("%{s}%");
            sql += " AND (world_name LIKE ? OR EXISTS (SELECT 1 FROM presence p WHERE p.location = l.location
                     AND p.joined_ts BETWEEN l.ts AND l.ts + l.duration_ms + 5000 AND p.display_name LIKE ?))";
            args.extend([like.clone().into(), like.into()]);
        }
        if let Some(before) = q.before {
            sql += " AND ts < ?";
            args.push(before.into());
        }
        sql += " ORDER BY ts DESC LIMIT ?";
        args.push(i64::from(q.limit.unwrap_or(30).min(200)).into());

        let c = self.conn();
        let mut stmt = c.prepare(&sql)?;
        let mut sessions: Vec<GlSession> = stmt
            .query_map(params_from_iter(args.iter()), |r| {
                Ok(GlSession {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    location: r.get(2)?,
                    world_id: r.get(3)?,
                    world_name: r.get(4)?,
                    duration_ms: r.get(5)?,
                    players: vec![],
                    videos: vec![],
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        drop(stmt);

        let mut players = c.prepare(
            "SELECT user_id, display_name, joined_ts, left_ts FROM presence
             WHERE location = ?1 AND joined_ts BETWEEN ?2 AND ?3 ORDER BY joined_ts",
        )?;
        let mut videos = c.prepare(
            "SELECT ts, data FROM gamelog_event WHERE kind = 'video' AND location = ?1 AND ts BETWEEN ?2 AND ?3 ORDER BY ts",
        )?;
        for s in &mut sessions {
            let end = s.ts + s.duration_ms + 5000;
            s.players = players
                .query_map(params![s.location, s.ts, end], |r| {
                    Ok(PresenceRow { user_id: r.get(0)?, display_name: r.get(1)?, joined_ts: r.get(2)?, left_ts: r.get(3)? })
                })?
                .collect::<std::result::Result<_, _>>()?;
            s.videos = videos
                .query_map(params![s.location, s.ts, end], |r| {
                    Ok(VideoRow { ts: r.get(0)?, url: r.get::<_, Option<String>>(1)?.unwrap_or_default() })
                })?
                .collect::<std::result::Result<_, _>>()?;
        }
        Ok(sessions)
    }

    pub fn gl_events(&self, q: &GlQuery) -> Result<Vec<GlEvent>> {
        let mut sql = String::from(
            "SELECT id, ts, kind, user_id, display_name, location, data FROM gamelog_event WHERE 1=1",
        );
        let mut args: Vec<SqlValue> = vec![];
        if let Some(kinds) = q.kinds.as_ref().filter(|k| !k.is_empty()) {
            sql += &format!(" AND kind IN ({})", in_clause(kinds.len()));
            args.extend(kinds.iter().map(|k| SqlValue::from(k.clone())));
        }
        if let Some(s) = q.search.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let like = format!("%{s}%");
            sql += " AND (display_name LIKE ? OR data LIKE ?)";
            args.extend([like.clone().into(), like.into()]);
        }
        if let Some(before) = q.before {
            sql += " AND ts < ?";
            args.push(before.into());
        }
        sql += " ORDER BY ts DESC LIMIT ?";
        args.push(i64::from(q.limit.unwrap_or(100).min(1000)).into());
        let c = self.conn();
        let mut stmt = c.prepare(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(args.iter()), |r| {
                Ok(GlEvent {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    kind: r.get(2)?,
                    user_id: r.get(3)?,
                    display_name: r.get(4)?,
                    location: r.get(5)?,
                    data: r.get(6)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    // ---------- per-user history ----------

    /// Avatars a player was seen switching into, from the game log ("[Behaviour] Switching X to avatar Y").
    /// Matches on user id, or on display name for older lines logged without one.
    pub fn seen_avatars(&self, user_id: &str, display_name: &str) -> Result<Vec<SeenAvatar>> {
        let c = self.conn();
        let mut stmt = c.prepare(
            "SELECT data, COUNT(*), MIN(ts), MAX(ts),
                (SELECT e2.location FROM gamelog_event e2 WHERE e2.kind = 'avatar' AND e2.data = e.data
                   AND (e2.user_id = ?1 OR (e2.user_id IS NULL AND e2.display_name = ?2)) ORDER BY e2.ts DESC LIMIT 1)
             FROM gamelog_event e
             WHERE kind = 'avatar' AND data IS NOT NULL AND (user_id = ?1 OR (user_id IS NULL AND display_name = ?2))
             GROUP BY data ORDER BY MAX(ts) DESC LIMIT 200",
        )?;
        let rows = stmt
            .query_map(params![user_id, display_name], |r| {
                Ok(SeenAvatar { name: r.get(0)?, times: r.get(1)?, first_seen: r.get(2)?, last_seen: r.get(3)?, last_location: r.get(4)? })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    pub fn user_history(&self, owner: &str, user_id: &str) -> Result<UserHistory> {
        let feed = self.feed_query(
            owner,
            &FeedQuery { user_ids: Some(vec![user_id.to_string()]), limit: Some(100), ..Default::default() },
        )?;
        let c = self.conn();
        let (encounters, time_together_ms, first_seen, last_seen): (i64, i64, Option<i64>, Option<i64>) = c.query_row(
            "SELECT COUNT(*), COALESCE(SUM(COALESCE(left_ts, joined_ts) - joined_ts), 0), MIN(joined_ts), MAX(joined_ts)
             FROM presence WHERE user_id = ?",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        let friend_added: Option<i64> = c
            .query_row(
                "SELECT added_ts FROM friend_log WHERE owner_id = ? AND user_id = ? AND removed_ts IS NULL",
                [owner, user_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let mut stmt = c.prepare(
            // The session is the latest visit to that instance that began by the time they were seen
            // (with a little slack: imported join times are derived and can land just before it).
            "SELECT p.joined_ts, COALESCE(p.left_ts, p.joined_ts) - p.joined_ts, p.location,
                (SELECT world_name FROM gamelog_location l WHERE l.location = p.location AND l.ts <= p.joined_ts + 5000
                 ORDER BY l.ts DESC LIMIT 1),
                (SELECT MAX(l.ts) FROM gamelog_location l WHERE l.location = p.location AND l.ts <= p.joined_ts + 5000)
             FROM presence p WHERE p.user_id = ? ORDER BY p.joined_ts DESC LIMIT 30",
        )?;
        let recent = stmt
            .query_map([user_id], |r| {
                Ok(Encounter { ts: r.get(0)?, duration_ms: r.get(1)?, location: r.get(2)?, world_name: r.get(3)?, session_ts: r.get(4)? })
            })?
            .collect::<std::result::Result<_, _>>()?;
        drop(stmt);
        let total_play_ms: i64 =
            c.query_row("SELECT COALESCE(SUM(duration_ms), 0) FROM gamelog_location", [], |r| r.get(0))?;
        Ok(UserHistory { feed, encounters, time_together_ms, first_seen, last_seen, friend_added, total_play_ms, recent })
    }

    // ---------- insights ----------

    /// How many days back your history goes (game log, presence and feed), for "All time".
    pub fn history_days(&self, owner: &str) -> Result<i64> {
        let c = self.conn();
        let first: Option<i64> = c.query_row(
            "SELECT MIN(t) FROM (
                SELECT MIN(ts) t FROM gamelog_location
                UNION ALL SELECT MIN(joined_ts) FROM presence
                UNION ALL SELECT MIN(ts) FROM feed WHERE owner_id = ?)",
            [owner],
            |r| r.get(0),
        )?;
        Ok(first.map_or(1, |t| (now_ms() - t) / 86_400_000 + 1))
    }

    pub fn insights(&self, owner: &str, days: i64) -> Result<Insights> {
        let since = now_ms() - days * 86_400_000;
        let c = self.conn();

        let mut heatmap = vec![vec![0i64; 24]; 7];
        let mut daily: BTreeMap<String, i64> = BTreeMap::new();
        let today = Local::now().date_naive();
        for i in 0..days {
            daily.insert((today - chrono::Duration::days(i)).to_string(), 0);
        }

        let mut total = 0i64;
        let mut sessions = 0i64;
        {
            let mut stmt = c.prepare("SELECT ts, duration_ms FROM gamelog_location WHERE ts >= ?")?;
            let rows = stmt.query_map([since], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
            for row in rows {
                let (start, dur) = row?;
                let dur = dur.clamp(0, 86_400_000);
                sessions += 1;
                total += dur;
                let end = start + dur;
                let mut cur = start;
                while cur < end {
                    let Some(dt) = Local.timestamp_millis_opt(cur).single() else { break };
                    let hour_start = dt
                        .with_minute(0)
                        .and_then(|t| t.with_second(0))
                        .and_then(|t| t.with_nanosecond(0))
                        .unwrap_or(dt);
                    let next = (hour_start + chrono::Duration::hours(1)).timestamp_millis();
                    let seg = next.min(end) - cur;
                    heatmap[dt.weekday().num_days_from_monday() as usize][dt.hour() as usize] += seg;
                    if let Some(v) = daily.get_mut(&dt.date_naive().to_string()) {
                        *v += seg;
                    }
                    cur = next;
                }
            }
        }
        for row in &mut heatmap {
            for v in row.iter_mut() {
                *v /= 60_000;
            }
        }

        let unique_worlds: i64 = c.query_row(
            "SELECT COUNT(DISTINCT world_id) FROM gamelog_location WHERE ts >= ?",
            [since],
            |r| r.get(0),
        )?;
        let unique_players: i64 = c.query_row(
            "SELECT COUNT(DISTINCT COALESCE(user_id, display_name)) FROM presence WHERE joined_ts >= ? AND COALESCE(user_id, '') != ?",
            params![since, owner],
            |r| r.get(0),
        )?;

        let mut stmt = c.prepare(
            "SELECT world_id, MAX(world_name), SUM(duration_ms) ms, COUNT(*) FROM gamelog_location
             WHERE ts >= ? GROUP BY world_id ORDER BY ms DESC LIMIT 10",
        )?;
        let top_worlds = stmt
            .query_map([since], |r| {
                Ok(TopWorld { world_id: r.get(0)?, world_name: r.get(1)?, ms: r.get(2)?, visits: r.get(3)? })
            })?
            .collect::<std::result::Result<_, _>>()?;

        let mut stmt = c.prepare(
            "SELECT user_id, MAX(display_name), SUM(COALESCE(left_ts, joined_ts) - joined_ts) ms, COUNT(*) FROM presence
             WHERE joined_ts >= ? AND user_id IS NOT NULL AND user_id != ?
             GROUP BY user_id ORDER BY ms DESC LIMIT 100",
        )?;
        let top_people = stmt
            .query_map(params![since, owner], |r| {
                Ok(TopPerson { user_id: r.get(0)?, display_name: r.get(1)?, ms: r.get(2)?, encounters: r.get(3)? })
            })?
            .collect::<std::result::Result<_, _>>()?;

        let mut stmt = c.prepare(
            "SELECT strftime('%Y-%m-%d', added_ts / 1000, 'unixepoch', 'localtime', 'weekday 1', '-7 days') w, COUNT(*)
             FROM friend_log WHERE owner_id = ? AND added_ts >= ? GROUP BY w ORDER BY w",
        )?;
        let friends_added = stmt
            .query_map(params![owner, since], |r| Ok(Count { key: r.get(0)?, count: r.get(1)? }))?
            .collect::<std::result::Result<_, _>>()?;

        let mut stmt =
            c.prepare("SELECT kind, COUNT(*) FROM feed WHERE owner_id = ? AND ts >= ? GROUP BY kind ORDER BY 2 DESC")?;
        let feed_counts = stmt
            .query_map(params![owner, since], |r| Ok(Count { key: r.get(0)?, count: r.get(1)? }))?
            .collect::<std::result::Result<_, _>>()?;

        Ok(Insights {
            total_play_ms: total,
            sessions,
            unique_worlds,
            unique_players,
            daily: daily.into_iter().map(|(date, ms)| DailyPoint { date, ms }).collect(),
            heatmap,
            top_worlds,
            top_people,
            friends_added,
            feed_counts,
        })
    }

    // ---------- export ----------

    pub fn export_rows(&self, owner: &str, kind: &str) -> Result<Vec<Vec<String>>> {
        let (sql, header): (&str, Vec<&str>) = match kind {
            "feed" => (
                "SELECT ts, kind, user_id, display_name, location, world_name, prev, next FROM feed WHERE owner_id = ?1 ORDER BY ts",
                vec!["time", "kind", "user_id", "display_name", "location", "world_name", "prev", "next"],
            ),
            "gamelog" => (
                "SELECT ts, kind, user_id, display_name, location, data FROM gamelog_event WHERE ?1 IS NOT NULL ORDER BY ts",
                vec!["time", "kind", "user_id", "display_name", "location", "data"],
            ),
            "worlds" => (
                "SELECT ts, world_id, world_name, location, duration_ms FROM gamelog_location WHERE ?1 IS NOT NULL ORDER BY ts",
                vec!["time", "world_id", "world_name", "location", "duration_ms"],
            ),
            _ => (
                "SELECT added_ts, user_id, display_name, removed_ts FROM friend_log WHERE owner_id = ?1 ORDER BY added_ts",
                vec!["added", "user_id", "display_name", "removed"],
            ),
        };
        let c = self.conn();
        let mut stmt = c.prepare(sql)?;
        let cols = stmt.column_count();
        let mut out = vec![header.into_iter().map(String::from).collect::<Vec<_>>()];
        let rows = stmt.query_map([owner], |r| {
            let mut v = Vec::with_capacity(cols);
            for i in 0..cols {
                let cell: SqlValue = r.get(i)?;
                v.push(match cell {
                    SqlValue::Null => String::new(),
                    SqlValue::Integer(n) if i == 0 => Local
                        .timestamp_millis_opt(n)
                        .single()
                        .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_default(),
                    SqlValue::Integer(n) => n.to_string(),
                    SqlValue::Real(f) => f.to_string(),
                    SqlValue::Text(t) => t,
                    SqlValue::Blob(_) => String::new(),
                });
            }
            Ok(v)
        })?;
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

fn sql_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// SQLCipher raw key: no passphrase stretching needed, the key is already random.
fn apply_key(c: &Connection, key: &[u8; 32]) -> Result<()> {
    c.execute_batch(&format!("PRAGMA key = \"x'{}'\";", crate::vault::hex(key)))?;
    Ok(())
}

fn is_plaintext(path: &Path) -> bool {
    let mut head = [0u8; 16];
    std::fs::File::open(path).and_then(|mut f| std::io::Read::read_exact(&mut f, &mut head)).is_ok() && &head == b"SQLite format 3\0"
}

/// Convert a plaintext database to an encrypted one. The original is only removed once the
/// encrypted copy opens and holds the same number of tables.
fn encrypt_in_place(path: &Path, key: &[u8; 32]) -> Result<()> {
    let tmp = path.with_extension("db.encrypting");
    let _ = std::fs::remove_file(&tmp);
    {
        let plain = Connection::open(path)?;
        // Fold any WAL contents into the main file so the export sees everything.
        plain.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        let version: i64 = plain.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        plain.execute_batch(&format!(
            "ATTACH DATABASE {} AS enc KEY \"x'{}'\";",
            sql_str(&tmp.to_string_lossy()),
            crate::vault::hex(key)
        ))?;
        plain.query_row("SELECT sqlcipher_export('enc')", [], |_| Ok(()))?;
        plain.execute_batch(&format!("PRAGMA enc.user_version = {version}; DETACH DATABASE enc;"))?;
        // Make sure the copy is complete before touching the original.
        let tables = |c: &Connection| c.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0));
        let want = tables(&plain)?;
        let enc = Connection::open(&tmp)?;
        apply_key(&enc, key)?;
        if tables(&enc)? != want {
            return Err(Error::Other("Encrypting the database didn't copy everything; keeping the original.".into()));
        }
    }
    let backup = path.with_extension("db.plaintext-old");
    std::fs::rename(path, &backup)?;
    for ext in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(path.with_extension(ext));
    }
    std::fs::rename(&tmp, path)?;
    std::fs::remove_file(&backup)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friend_log_first_sync_is_silent_then_diffs() {
        let db = Db::memory().unwrap();
        let a = ("usr_a".to_string(), "A".to_string());
        let b = ("usr_b".to_string(), "B".to_string());
        let (added, removed) = db.friend_log_sync("me", std::slice::from_ref(&a)).unwrap();
        assert!(added.is_empty() && removed.is_empty());
        let (added, removed) = db.friend_log_sync("me", std::slice::from_ref(&b)).unwrap();
        assert_eq!(added, vec![b.clone()]);
        assert_eq!(removed, vec![a.clone()]);
        // Re-friending is reported as an add.
        let (added, _) = db.friend_log_sync("me", &[a.clone(), b]).unwrap();
        assert_eq!(added, vec![a]);
    }

    #[test]
    fn feed_roundtrip_and_filters() {
        let db = Db::memory().unwrap();
        for (i, kind) in ["online", "gps", "status"].iter().enumerate() {
            let mut e = FeedEntry {
                id: 0,
                ts: 1000 + i as i64,
                kind: kind.to_string(),
                user_id: "usr_a".into(),
                display_name: "Alice".into(),
                location: None,
                world_name: Some("The Black Cat".into()),
                prev: None,
                next: None,
            };
            db.feed_insert("me", &mut e).unwrap();
            assert!(e.id > 0);
        }
        let all = db.feed_query("me", &FeedQuery::default()).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].kind, "status");
        let gps = db
            .feed_query("me", &FeedQuery { kinds: Some(vec!["gps".into()]), ..Default::default() })
            .unwrap();
        assert_eq!(gps.len(), 1);
        let search = db
            .feed_query("me", &FeedQuery { search: Some("black".into()), ..Default::default() })
            .unwrap();
        assert_eq!(search.len(), 3);
        assert!(db.feed_query("other", &FeedQuery::default()).unwrap().is_empty());
    }

    #[test]
    fn seen_avatars_groups_by_name_and_matches_old_name_only_lines() {
        let db = Db::memory().unwrap();
        db.gl_event_insert(1_000, "avatar", Some("usr_b"), Some("Bob"), Some("wrld_a:1"), Some("Fox")).unwrap();
        db.gl_event_insert(2_000, "avatar", Some("usr_b"), Some("Bob"), Some("wrld_b:2"), Some("Fox")).unwrap();
        db.gl_event_insert(3_000, "avatar", None, Some("Bob"), Some("wrld_c:3"), Some("Robot")).unwrap();
        db.gl_event_insert(4_000, "avatar", Some("usr_x"), Some("Someone"), None, Some("Fox")).unwrap();
        let seen = db.seen_avatars("usr_b", "Bob").unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].name, "Robot"); // most recent first
        assert_eq!(seen[1].name, "Fox");
        assert_eq!((seen[1].times, seen[1].first_seen, seen[1].last_seen), (2, 1_000, 2_000));
        assert_eq!(seen[1].last_location.as_deref(), Some("wrld_b:2"));
    }

    #[test]
    fn sessions_include_players() {
        let db = Db::memory().unwrap();
        let loc = "wrld_x:1~region(eu)";
        let id = db.gl_location_insert(10_000, loc, "wrld_x", Some("World X")).unwrap();
        db.presence_open(10_500, Some("usr_b"), "Bob", loc).unwrap();
        db.presence_close("Bob", 70_500).unwrap();
        db.gl_location_set_duration(id, 120_000).unwrap();
        let sessions = db.gl_sessions(&GlQuery::default()).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].players.len(), 1);
        assert_eq!(sessions[0].players[0].left_ts, Some(70_500));
        let hist = db.user_history("me", "usr_b").unwrap();
        assert_eq!(hist.encounters, 1);
        assert_eq!(hist.time_together_ms, 60_000);
        assert_eq!(hist.recent[0].world_name.as_deref(), Some("World X"));
    }

    #[test]
    fn repeated_join_does_not_duplicate_presence() {
        let db = Db::memory().unwrap();
        let loc = "wrld_x:1~region(eu)";
        let id = db.gl_location_insert(10_000, loc, "wrld_x", Some("World X")).unwrap();
        db.presence_open(10_500, Some("usr_b"), "Bob", loc).unwrap();
        db.presence_open(11_000, Some("usr_b"), "Bob", loc).unwrap();
        db.presence_close("Bob", 70_500).unwrap();
        // A real rejoin after leaving is still recorded.
        db.presence_open(80_000, Some("usr_b"), "Bob", loc).unwrap();
        db.gl_location_set_duration(id, 120_000).unwrap();
        let players = &db.gl_sessions(&GlQuery::default()).unwrap()[0].players;
        assert_eq!(players.len(), 2);
        assert_eq!((players[0].joined_ts, players[0].left_ts), (10_500, Some(70_500)));
        assert_eq!((players[1].joined_ts, players[1].left_ts), (80_000, None));
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("nexus-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn plaintext_database_is_encrypted_and_only_readable_with_the_key() {
        let dir = temp_dir("encrypt");
        let path = dir.join("nexus.db");
        let key = [9u8; 32];
        {
            // An old, unencrypted database with some history in it.
            let old = Connection::open(&path).unwrap();
            old.execute_batch(SCHEMA_V1).unwrap();
            old.execute_batch("PRAGMA journal_mode=WAL; PRAGMA user_version = 3;").unwrap();
            old.execute("INSERT INTO memos (owner_id, user_id, text) VALUES ('me', 'usr_x', 'secret memo')", []).unwrap();
        }
        let db = Db::open(&path, &key).unwrap();
        assert_eq!(db.memo_get("me", "usr_x").unwrap(), "secret memo");
        drop(db);

        // On disk it's no longer SQLite, and the memo text isn't in the file.
        let raw = std::fs::read(&path).unwrap();
        assert!(!raw.starts_with(b"SQLite format 3"));
        assert!(!raw.windows(11).any(|w| w == b"secret memo"));
        // Without the key it can't be read; the wrong key is set aside, not destroyed.
        let plain = Connection::open(&path).unwrap();
        assert!(plain.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err());
        drop(plain);

        // Reopening with the key works, and the deliberate export is readable by anything.
        let db = Db::open(&path, &key).unwrap();
        let out = dir.join("export.db");
        db.export_decrypted(&out).unwrap();
        let exported = Connection::open(&out).unwrap();
        let memo: String = exported.query_row("SELECT text FROM memos WHERE user_id = 'usr_x'", [], |r| r.get(0)).unwrap();
        assert_eq!(memo, "secret memo");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn database_with_a_lost_key_is_moved_aside() {
        let dir = temp_dir("lostkey");
        let path = dir.join("nexus.db");
        drop(Db::open(&path, &[1u8; 32]).unwrap());
        let db = Db::open(&path, &[2u8; 32]).unwrap();
        assert!(db.memo_get("me", "usr_x").unwrap().is_empty());
        let aside = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().contains("unreadable"));
        assert!(aside);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Encrypt a copy of a real database: NEXUS_DB_TEST="<copy of nexus.db>" cargo test -- --ignored
    #[test]
    #[ignore]
    fn encrypts_real_copy() {
        let path = std::path::PathBuf::from(std::env::var("NEXUS_DB_TEST").expect("set NEXUS_DB_TEST"));
        let count = |c: &Connection| -> Vec<i64> {
            ["feed", "gamelog_location", "gamelog_event", "presence", "friend_log", "memos", "cache", "settings"]
                .iter()
                .map(|t| c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap())
                .collect()
        };
        let before = count(&Connection::open(&path).unwrap());
        let key = [3u8; 32];
        let db = Db::open(&path, &key).unwrap();
        let after = count(&db.conn());
        println!("before {before:?}
after  {after:?}");
        assert_eq!(before, after);
        assert!(!std::fs::read(&path).unwrap().starts_with(b"SQLite format 3"));
    }
}
