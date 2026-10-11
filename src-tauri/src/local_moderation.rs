//! "Show / hide avatar" lives on your PC, not on VRChat's servers (since late 2022: the API
//! accepts those moderations but doesn't keep them). VRChat stores them in
//! `<VRChat folder>\LocalPlayerModerations\<your id>-show-hide-user.vrcset`, one line per player:
//! their id padded with spaces to 64 characters, then a three-digit code.
//!
//! VRChat reads the file when it starts and rewrites it when you change someone in-game; it
//! doesn't rewrite it on exit, so a change made here holds until VRChat's next start.

use std::path::{Path, PathBuf};

use crate::error::Result;

/// VRChat's own codes for the two settings.
pub const HIDE: u8 = 4;
pub const SHOW: u8 = 5;

const ID_WIDTH: usize = 64;

pub fn file_path(vrchat_dir: &Path, me: &str) -> PathBuf {
    vrchat_dir.join("LocalPlayerModerations").join(format!("{me}-show-hide-user.vrcset"))
}

/// The code set for `user_id` in the file's text, if any.
fn code_in(content: &str, user_id: &str) -> Option<u8> {
    content.lines().find_map(|l| {
        let mut parts = l.split_whitespace();
        if parts.next()? != user_id {
            return None;
        }
        parts.next_back()?.parse().ok()
    })
}

/// The file's text with `user_id` set to `code`, or taken out when `code` is None.
/// Everyone else's lines are kept as they were.
fn with_code(content: &str, user_id: &str, code: Option<u8>) -> String {
    let mut lines: Vec<&str> = content
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty() && l.split_whitespace().next() != Some(user_id))
        .collect();
    let added = code.map(|c| format!("{user_id:<ID_WIDTH$}{c:03}"));
    if let Some(line) = &added {
        lines.push(line);
    }
    lines.iter().map(|l| format!("{l}\r\n")).collect()
}

fn read(path: &Path) -> Result<String> {
    match std::fs::read_to_string(path) {
        Ok(t) => Ok(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn get(path: &Path, user_id: &str) -> Result<Option<u8>> {
    Ok(code_in(&read(path)?, user_id))
}

/// Set (or clear, with None) `user_id`'s show/hide setting. Writes a copy first and swaps it in,
/// so VRChat never sees a half-written file.
pub fn set(path: &Path, user_id: &str, code: Option<u8>) -> Result<()> {
    let next = with_code(&read(path)?, user_id, code);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("vrcset.nexus-tmp");
    std::fs::write(&tmp, next)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "usr_213d16c9-dd84-42f9-942c-58843d8e840e";
    const B: &str = "usr_71fbefc1-889f-477f-85e3-51cdde178fd7";

    fn file() -> String {
        format!("{A}                        005\r\n{B}                        004\r\n")
    }

    #[test]
    fn reads_codes() {
        assert_eq!(code_in(&file(), A), Some(SHOW));
        assert_eq!(code_in(&file(), B), Some(HIDE));
        assert_eq!(code_in(&file(), "usr_nobody"), None);
        // Legacy ids are short; the padding still separates them.
        assert_eq!(code_in("8JoV9XEdpo                                                      004\r\n", "8JoV9XEdpo"), Some(HIDE));
    }

    #[test]
    fn writes_in_vrchats_format() {
        let out = with_code("", A, Some(HIDE));
        assert_eq!(out, format!("{A}                        004\r\n"));
        assert_eq!(out.trim_end().len(), ID_WIDTH + 3);
    }

    #[test]
    fn replaces_and_removes_only_that_player() {
        let hidden = with_code(&file(), A, Some(HIDE));
        assert_eq!(code_in(&hidden, A), Some(HIDE));
        assert_eq!(code_in(&hidden, B), Some(HIDE));
        assert_eq!(hidden.lines().count(), 2);

        let cleared = with_code(&file(), B, None);
        assert_eq!(cleared, format!("{A}                        005\r\n"));
    }

    #[test]
    fn round_trips_through_a_file() {
        let dir = std::env::temp_dir().join(format!("nexus-lpm-{}", std::process::id()));
        let path = file_path(&dir, "usr_me");
        set(&path, A, Some(HIDE)).unwrap();
        set(&path, B, Some(SHOW)).unwrap();
        assert_eq!(get(&path, A).unwrap(), Some(HIDE));
        set(&path, A, None).unwrap();
        assert_eq!(get(&path, A).unwrap(), None);
        assert_eq!(get(&path, B).unwrap(), Some(SHOW));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
