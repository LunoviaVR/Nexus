//! One-click import of history from VRCX's `VRCX.sqlite3`.
//!
//! Only history from *before* Nexus's own records is brought over, so the period both apps
//! were running isn't duplicated and importing twice is harmless.

use std::path::{Path, PathBuf};

use rusqlite::types::Value as Sql;
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};
use crate::state::AppState;

pub fn default_path(app: &AppHandle) -> Option<PathBuf> {
    // VRCX lives in Roaming AppData: %APPDATA%\VRCX\VRCX.sqlite3
    app.path().data_dir().ok().map(|d| d.join("VRCX").join("VRCX.sqlite3"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub path: Option<String>,
    pub size_bytes: Option<u64>,
    pub last_imported: Option<i64>,
}

pub fn detect(app: &AppHandle) -> Detected {
    let path = default_path(app).filter(|p| p.is_file());
    let size_bytes = path.as_ref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len());
    let last_imported = app.state::<AppState>().db.kv_get("vrcx_imported_at").and_then(|v| v.parse().ok());
    Detected { path: path.map(|p| p.to_string_lossy().to_string()), size_bytes, last_imported }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub feed: usize,
    pub worlds: usize,
    pub events: usize,
    pub friend_dates: usize,
    pub memos: usize,
}

/// VRCX stores times as ISO-8601 UTC strings.
fn ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis())
}

fn text(v: &Sql) -> Option<String> {
    match v {
        Sql::Text(s) if !s.is_empty() => Some(s.clone()),
        Sql::Integer(i) => Some(i.to_string()),
        _ => None,
    }
}

fn int(v: &Sql) -> Option<i64> {
    match v {
        Sql::Integer(i) => Some(*i),
        Sql::Real(f) => Some(*f as i64),
        Sql::Text(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// `usr0123abcd4567890a1b2c3d4e5f6a7b8c` → `usr_0123abcd-4567-890a-1b2c-3d4e5f6a7b8c`
fn owner_from_prefix(hex: &str) -> String {
    format!("usr_{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

/// Read every row of a query as raw SQL values; a missing table just yields nothing.
fn rows(v: &Connection, sql: &str) -> Vec<Vec<Sql>> {
    let Ok(mut stmt) = v.prepare(sql) else { return vec![] };
    let n = stmt.column_count();
    stmt.query_map([], |r| (0..n).map(|i| r.get::<_, Sql>(i)).collect())
        .map(|it| it.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

/// Copy the database (and its WAL) aside so VRCX can keep running and is never modified.
fn snapshot(src: &Path) -> Result<(PathBuf, Connection)> {
    let dir = std::env::temp_dir().join(format!("nexus-vrcx-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let db = dir.join("VRCX.sqlite3");
    std::fs::copy(src, &db)?;
    for ext in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{ext}", src.display()));
        if side.exists() {
            std::fs::copy(&side, dir.join(format!("VRCX.sqlite3{ext}")))?;
        }
    }
    let conn = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    Ok((dir, conn))
}

pub fn import(app: &AppHandle, path: Option<String>) -> Result<Summary> {
    let src = path.map(PathBuf::from).or_else(|| default_path(app)).filter(|p| p.is_file()).ok_or_else(|| {
        Error::Other("Couldn't find VRCX's data. Choose VRCX.sqlite3 yourself (usually in %APPDATA%\\VRCX).".into())
    })?;
    let (tmp, v) = snapshot(&src)?;
    let result = run(app, &v);
    drop(v);
    let _ = std::fs::remove_dir_all(tmp);
    result
}

fn run(app: &AppHandle, v: &Connection) -> Result<Summary> {
    let is_vrcx = v
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('gamelog_location', 'memos')", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
        > 0;
    if !is_vrcx {
        return Err(Error::Other("That file doesn't look like VRCX's database.".into()));
    }

    let st = app.state::<AppState>();
    let me = st.me_id().ok();
    let sum = run_on(&st.db.conn(), v, me.as_deref())?;
    let _ = st.db.kv_set("vrcx_imported_at", &crate::db::now_ms().to_string());
    Ok(sum)
}

/// The import itself, in one transaction on Nexus's database `n`.
fn run_on(n: &Connection, v: &Connection, me: Option<&str>) -> Result<Summary> {
    let mut sum = Summary::default();
    let prefixes: Vec<String> = rows(v, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'usr%_feed_gps'")
        .into_iter()
        .filter_map(|r| text(&r[0]))
        .filter_map(|n| n.strip_prefix("usr").and_then(|s| s.strip_suffix("_feed_gps")).map(String::from))
        .filter(|hex| hex.len() == 32 && hex.chars().all(|c| c.is_ascii_hexdigit()))
        .collect();

    n.execute_batch("BEGIN")?;
    let outcome = (|| -> Result<()> {
        // ---- Friend feed, per VRCX account ----
        for hex in &prefixes {
            let owner = owner_from_prefix(hex);
            let t = |name: &str| format!("usr{hex}_{name}");
            let cutoff: i64 = n
                .query_row("SELECT MIN(ts) FROM feed WHERE owner_id = ?", [&owner], |r| r.get::<_, Option<i64>>(0))?
                .unwrap_or(i64::MAX);
            let mut feed = n.prepare(
                "INSERT INTO feed (owner_id, ts, kind, user_id, display_name, location, world_name, prev, next)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            let mut add = |ts: i64, kind: &str, r: &[Sql], loc: Option<String>, world: Option<String>, prev: Option<String>, next: Option<String>| -> Result<()> {
                let (Some(uid), Some(name)) = (text(&r[1]), text(&r[2])) else { return Ok(()) };
                if ts < cutoff {
                    feed.execute(params![owner, ts, kind, uid, name, loc, world, prev, next])?;
                    sum.feed += 1;
                }
                Ok(())
            };

            for r in rows(v, &format!("SELECT created_at, user_id, display_name, location, world_name, previous_location FROM \"{}\"", t("feed_gps"))) {
                if let Some(ts) = text(&r[0]).and_then(|s| ts(&s)) {
                    add(ts, "gps", &r, text(&r[3]), text(&r[4]), text(&r[5]), None)?;
                }
            }
            for r in rows(v, &format!("SELECT created_at, user_id, display_name, type, location, world_name FROM \"{}\"", t("feed_online_offline"))) {
                let kind = match text(&r[3]).as_deref() {
                    Some("Online") => "online",
                    Some("Offline") => "offline",
                    _ => continue,
                };
                if let Some(ts) = text(&r[0]).and_then(|s| ts(&s)) {
                    add(ts, kind, &r, text(&r[4]), text(&r[5]), None, None)?;
                }
            }
            for r in rows(
                v,
                &format!(
                    "SELECT created_at, user_id, display_name, status, status_description, previous_status, previous_status_description FROM \"{}\"",
                    t("feed_status")
                ),
            ) {
                let enc = |s: &Sql, d: &Sql| json!({ "status": text(s).unwrap_or_default(), "description": text(d).unwrap_or_default() }).to_string();
                if let Some(ts) = text(&r[0]).and_then(|s| ts(&s)) {
                    add(ts, "status", &r, None, None, Some(enc(&r[5], &r[6])), Some(enc(&r[3], &r[4])))?;
                }
            }
            for r in rows(
                v,
                &format!(
                    "SELECT created_at, user_id, display_name, current_avatar_thumbnail_image_url, previous_current_avatar_thumbnail_image_url FROM \"{}\"",
                    t("feed_avatar")
                ),
            ) {
                if let (Some(ts), Some(next)) = (text(&r[0]).and_then(|s| ts(&s)), text(&r[3])) {
                    add(ts, "avatar", &r, None, None, text(&r[4]), Some(next))?;
                }
            }
            for r in rows(v, &format!("SELECT created_at, user_id, display_name, bio, previous_bio FROM \"{}\"", t("feed_bio"))) {
                if let Some(ts) = text(&r[0]).and_then(|s| ts(&s)) {
                    add(ts, "bio", &r, None, None, Some(text(&r[4]).unwrap_or_default()), Some(text(&r[3]).unwrap_or_default()))?;
                }
            }
            let history = rows(v, &format!("SELECT created_at, user_id, display_name, type FROM \"{}\" ORDER BY created_at", t("friend_log_history")));
            for r in &history {
                let kind = match text(&r[3]).as_deref() {
                    Some("Friend") => "friend",
                    Some("Unfriend") => "unfriend",
                    _ => continue,
                };
                if let Some(ts) = text(&r[0]).and_then(|s| ts(&s)) {
                    add(ts, kind, r, None, None, None, None)?;
                }
            }
            drop(add);
            drop(feed);

            // "Friends since": Nexus only knows this for friends added while it was running.
            let mut date = n.prepare(
                "UPDATE friend_log SET added_ts = ?3 WHERE owner_id = ?1 AND user_id = ?2 AND added_ts IS NULL AND removed_ts IS NULL",
            )?;
            let mut latest = std::collections::HashMap::new();
            for r in &history {
                if text(&r[3]).as_deref() == Some("Friend") {
                    if let (Some(uid), Some(ts)) = (text(&r[1]), text(&r[0]).and_then(|s| ts(&s))) {
                        latest.insert(uid, ts);
                    }
                }
            }
            for (uid, ts) in latest {
                sum.friend_dates += date.execute(params![owner, uid, ts])?;
            }
        }

        // ---- Game log (shared across accounts in VRCX, as in Nexus) ----
        let cutoff = [
            "SELECT MIN(ts) FROM gamelog_location",
            "SELECT MIN(ts) FROM gamelog_event",
            "SELECT MIN(joined_ts) FROM presence",
        ]
        .iter()
        .filter_map(|q| n.query_row(q, [], |r| r.get::<_, Option<i64>>(0)).ok().flatten())
        .min()
        .unwrap_or(i64::MAX);

        let mut loc = n.prepare("INSERT INTO gamelog_location (ts, location, world_id, world_name, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for r in rows(v, "SELECT created_at, location, world_id, world_name, time FROM gamelog_location") {
            let (Some(ts), Some(l), Some(w)) = (text(&r[0]).and_then(|s| ts(&s)), text(&r[1]), text(&r[2])) else { continue };
            if ts < cutoff {
                loc.execute(params![ts, l, w, text(&r[3]), int(&r[4]).unwrap_or(0).max(0)])?;
                sum.worlds += 1;
            }
        }
        let mut ev = n.prepare("INSERT INTO gamelog_event (ts, kind, user_id, display_name, location, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
        let mut pres = n.prepare("INSERT INTO presence (user_id, display_name, location, joined_ts, left_ts) VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for r in rows(v, "SELECT created_at, type, display_name, location, user_id, time FROM gamelog_join_leave") {
            let (Some(ts), Some(name), Some(l)) = (text(&r[0]).and_then(|s| ts(&s)), text(&r[2]), text(&r[3])) else { continue };
            if ts >= cutoff {
                continue;
            }
            let uid = text(&r[4]);
            match text(&r[1]).as_deref() {
                Some("OnPlayerJoined") => {
                    ev.execute(params![ts, "join", uid, name, l, Option::<String>::None])?;
                }
                Some("OnPlayerLeft") => {
                    ev.execute(params![ts, "leave", uid, name, l, Option::<String>::None])?;
                    // A leave carries how long they were there, which is a whole presence stint.
                    if let Some(stay) = int(&r[5]).filter(|t| *t > 0) {
                        pres.execute(params![uid, name, l, ts - stay, ts])?;
                    }
                }
                _ => continue,
            }
            sum.events += 1;
        }
        for r in rows(v, "SELECT created_at, video_url, display_name, user_id, location FROM gamelog_video_play") {
            let (Some(ts), Some(url)) = (text(&r[0]).and_then(|s| ts(&s)), text(&r[1])) else { continue };
            if ts < cutoff {
                ev.execute(params![ts, "video", text(&r[3]), text(&r[2]), text(&r[4]), url])?;
                sum.events += 1;
            }
        }

        // ---- Memos (private notes), never overwriting one written in Nexus ----
        if let Some(me) = me {
            let mut memo = n.prepare("INSERT OR IGNORE INTO memos (owner_id, user_id, text) VALUES (?1, ?2, ?3)")?;
            for r in rows(v, "SELECT user_id, memo FROM memos") {
                if let (Some(uid), Some(m)) = (text(&r[0]), text(&r[1]).filter(|m| !m.trim().is_empty())) {
                    sum.memos += memo.execute(params![me, uid, m])?;
                }
            }
        }
        Ok(())
    })();

    match outcome {
        Ok(()) => {
            n.execute_batch("COMMIT")?;
            Ok(sum)
        }
        Err(e) => {
            let _ = n.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_prefix_to_user_id() {
        assert_eq!(owner_from_prefix("0123abcd4567890a1b2c3d4e5f6a7b8c"), "usr_0123abcd-4567-890a-1b2c-3d4e5f6a7b8c");
    }

    /// Runs against copies of real data:
    /// NEXUS_VRCX_TEST="<VRCX.sqlite3 copy>|<plain nexus.db copy>|<your usr_ id>" cargo test -- --ignored
    #[test]
    #[ignore]
    fn imports_real_copy() {
        let spec = std::env::var("NEXUS_VRCX_TEST").expect("set NEXUS_VRCX_TEST");
        let mut parts = spec.split('|');
        let (vp, np, me) = (parts.next().unwrap(), parts.next().unwrap(), parts.next().unwrap());
        let v = Connection::open(vp).unwrap();
        let n = Connection::open(np).unwrap();
        let first = run_on(&n, &v, Some(me)).unwrap();
        println!("first: {first:?}");
        let second = run_on(&n, &v, Some(me)).unwrap();
        println!("second: {second:?}");
        assert!(first.feed > 0 && first.worlds > 0);
        assert_eq!((second.feed, second.worlds, second.events), (0, 0, 0), "a second import must add nothing");
    }

    #[test]
    fn parses_vrcx_timestamps() {
        assert_eq!(ts("2026-05-21T08:01:57.000Z"), Some(1_779_350_517_000));
        assert_eq!(ts(""), None);
    }
}
