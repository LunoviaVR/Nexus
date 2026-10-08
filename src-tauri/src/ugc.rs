//! Saves prints and stickers other players show in your instance, the way VRCX does:
//! the game log tells us a print was loaded or a sticker spawned, and we download the image.
//! Files land in `<folder>/Prints/YYYY-MM/` and `<folder>/Stickers/YYYY-MM/`.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::state::AppState;
use crate::sync::str_of;

#[derive(Debug)]
pub enum Job {
    Print { print_id: String },
    Sticker { user_id: String, display_name: String, inventory_id: String },
}

static QUEUE: OnceLock<UnboundedSender<Job>> = OnceLock::new();

pub fn enqueue(job: Job) {
    if let Some(tx) = QUEUE.get() {
        let _ = tx.send(job);
    }
}

pub fn default_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().picture_dir().ok().map(|p| p.join("Nexus"))
}

pub fn folder(app: &AppHandle) -> Option<PathBuf> {
    let custom = app.state::<AppState>().settings().ugc_dir.filter(|s| !s.trim().is_empty());
    custom.map(PathBuf::from).or_else(|| default_dir(app))
}

/// Windows-safe file name segment.
pub fn sanitize(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.');
    let out: String = trimmed.chars().take(60).collect();
    if out.is_empty() {
        "unknown".into()
    } else {
        out
    }
}

/// `2026-10-05T23:41:07.123Z` -> ("2026-10", "2026-10-05_23-41-07")
fn stamp(iso: &str) -> (String, String) {
    let month = iso.get(..7).unwrap_or("unknown").to_string();
    let ts = iso.get(..19).unwrap_or(iso).replace(':', "-").replace('T', "_");
    (month, ts)
}

pub fn spawn(app: AppHandle) {
    let (tx, mut rx) = unbounded_channel::<Job>();
    let _ = QUEUE.set(tx);
    tauri::async_runtime::spawn(async move {
        // Remember recent ids so the same print/sticker seen repeatedly isn't refetched.
        let mut seen: VecDeque<String> = VecDeque::new();
        while let Some(job) = rx.recv().await {
            let id = match &job {
                Job::Print { print_id } => print_id.clone(),
                Job::Sticker { inventory_id, .. } => inventory_id.clone(),
            };
            if seen.contains(&id) {
                continue;
            }
            seen.push_back(id);
            if seen.len() > 200 {
                seen.pop_front();
            }
            if let Err(e) = handle(&app, job).await {
                eprintln!("ugc save failed: {e}");
            }
            // Be gentle: these come in bursts when joining a busy instance.
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }
    });
}

async fn handle(app: &AppHandle, job: Job) -> crate::error::Result<()> {
    let st = app.state::<AppState>();
    let settings = st.settings();
    let Some(root) = folder(app) else { return Ok(()) };
    if st.me_id().is_err() {
        return Ok(()); // need a session for the API
    }

    let (dir, file_name, url) = match job {
        Job::Print { print_id } => {
            if !settings.save_prints {
                return Ok(());
            }
            let print: Value = st.api.get(&format!("prints/{print_id}"), &[]).await?;
            let Some(url) = print.pointer("/files/image").and_then(Value::as_str).map(String::from) else {
                return Ok(());
            };
            let author = sanitize(str_of(&print, "authorName"));
            let when = [str_of(&print, "timestamp"), str_of(&print, "createdAt")]
                .into_iter()
                .find(|s| !s.is_empty())
                .unwrap_or("");
            let (month, ts) = stamp(when);
            (root.join("Prints").join(month), format!("{author}_{ts}_{print_id}.png"), url)
        }
        Job::Sticker { user_id, display_name, inventory_id } => {
            if !settings.save_stickers {
                return Ok(());
            }
            let item: Value = st.api.get(&format!("user/{user_id}/inventory/{inventory_id}"), &[]).await?;
            // Only user-made stickers; official ones aren't worth hoarding.
            let ugc = item["flags"].as_array().is_some_and(|f| f.iter().any(|v| v == "ugc"));
            if str_of(&item, "itemType") != "sticker" || !ugc {
                return Ok(());
            }
            let Some(url) = item
                .pointer("/metadata/imageUrl")
                .or_else(|| item.get("imageUrl"))
                .and_then(Value::as_str)
                .map(String::from)
            else {
                return Ok(());
            };
            let (month, ts) = stamp(str_of(&item, "created_at"));
            (
                root.join("Stickers").join(month),
                format!("{}_{ts}_{inventory_id}.png", sanitize(&display_name)),
                url,
            )
        }
    };

    let path = dir.join(&file_name);
    if path.exists() {
        return Ok(());
    }
    let (_, bytes) = st.api.fetch_bytes(&url).await?;
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_and_stamps() {
        assert_eq!(sanitize("a/b:c*?"), "a_b_c__");
        assert_eq!(sanitize("  ...  "), "unknown");
        assert_eq!(stamp("2026-10-05T23:41:07.123Z"), ("2026-10".into(), "2026-10-05_23-41-07".into()));
    }
}
