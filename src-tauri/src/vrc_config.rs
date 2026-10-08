//! Reads and edits VRChat's own `config.json` (in the VRChat LocalLow folder).
//! Only the keys we touch change; everything else, including key order, is preserved.

use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::error::{Error, Result};

const PHOTO_KEY: &str = "picture_output_folder";

pub fn config_path(vrchat_dir: Option<PathBuf>) -> Option<PathBuf> {
    vrchat_dir.or_else(crate::gamelog::default_log_dir).map(|d| d.join("config.json"))
}

fn read(path: &PathBuf) -> Result<Map<String, Value>> {
    match std::fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => match serde_json::from_str::<Value>(&text)? {
            Value::Object(m) => Ok(m),
            _ => Err(Error::Other("VRChat's config.json isn't a JSON object; leaving it alone.".into())),
        },
        Ok(_) => Ok(Map::new()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn photo_dir(path: &PathBuf) -> Option<String> {
    read(path).ok()?.get(PHOTO_KEY)?.as_str().filter(|s| !s.trim().is_empty()).map(String::from)
}

/// Set (or with `None`, remove) the photo folder. Backs the file up once before the first edit.
pub fn set_photo_dir(path: &PathBuf, dir: Option<&str>) -> Result<()> {
    let mut map = read(path)?;
    match dir {
        Some(d) => {
            let d = d.trim();
            if !std::path::Path::new(d).is_absolute() {
                return Err(Error::Other("Choose a full folder path.".into()));
            }
            std::fs::create_dir_all(d)?;
            // VRChat's own examples use forward slashes.
            map.insert(PHOTO_KEY.into(), Value::String(d.replace('\\', "/")));
        }
        None => {
            map.shift_remove(PHOTO_KEY);
        }
    }
    let backup = path.with_extension("json.nexus-backup");
    if path.exists() && !backup.exists() {
        std::fs::copy(path, &backup)?;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(&Value::Object(map))?;
    text.push('\n');
    std::fs::write(path, text)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_only_the_photo_key() {
        let dir = std::env::temp_dir().join(format!("nexus-cfg-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cfg = dir.join("config.json");
        std::fs::write(&cfg, "{\n\t\"cache_size\": 128,\n\t\"picture_output_folder\": \"S:/Old/\",\n\t\"disableRichPresence\": true\n}").unwrap();

        let photos = dir.join("Photos");
        set_photo_dir(&cfg, Some(photos.to_str().unwrap())).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["cache_size", "picture_output_folder", "disableRichPresence"]);
        assert_eq!(v["cache_size"], 128);
        assert_eq!(photo_dir(&cfg).unwrap(), photos.to_str().unwrap().replace('\\', "/"));
        assert!(cfg.with_extension("json.nexus-backup").exists());

        set_photo_dir(&cfg, None).unwrap();
        assert!(photo_dir(&cfg).is_none());
        assert!(set_photo_dir(&cfg, Some("relative/path")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
