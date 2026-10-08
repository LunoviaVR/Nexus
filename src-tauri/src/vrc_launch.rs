//! Finding the VRChat install, so `vrchat://` joins work even when Windows' registered handler
//! is missing or stale (e.g. VRChat was moved to another Steam library).

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

/// VRChat's Steam app id.
const STEAM_APP_ID: &str = "438100";

static RE_VDF_PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""path"\s+"([^"]+)""#).unwrap());

/// The program VRChat links should start: `launch.exe` (Steam) or `VRChat.exe` (other stores).
pub fn launcher_in(dir: &Path) -> Option<PathBuf> {
    ["launch.exe", "VRChat.exe"].iter().map(|f| dir.join(f)).find(|p| p.is_file())
}

/// The program registered for `vrchat://`, taken from its `shell\open\command` line.
fn handler_exe() -> Option<PathBuf> {
    let cmd = reg::classes_default(r"vrchat\shell\open\command")?;
    let cmd = cmd.trim();
    let exe = match cmd.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => cmd.split_whitespace().next()?,
    };
    Some(PathBuf::from(exe))
}

/// Whether `vrchat://` points at a program that still exists.
pub fn handler_ok() -> bool {
    handler_exe().is_some_and(|p| p.is_file())
}

/// Library roots listed in Steam's `libraryfolders.vdf`.
fn vdf_library_paths(vdf: &str) -> Vec<PathBuf> {
    RE_VDF_PATH.captures_iter(vdf).map(|c| PathBuf::from(c[1].replace(r"\\", r"\"))).collect()
}

/// Places VRChat is commonly installed, most specific first.
fn candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = vec![];
    // Steam writes an uninstall entry with the exact folder.
    out.extend(reg::uninstall_location(&format!("Steam App {STEAM_APP_ID}")).map(PathBuf::from));
    // Every Steam library.
    let mut steam_roots: Vec<PathBuf> = reg::steam_paths();
    steam_roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    let mut libraries: Vec<PathBuf> = vec![];
    for root in &steam_roots {
        if let Ok(vdf) = std::fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
            libraries.extend(vdf_library_paths(&vdf));
        }
        libraries.push(root.clone());
    }
    out.extend(libraries.iter().map(|l| l.join("steamapps").join("common").join("VRChat")));
    // Meta (Oculus) libraries.
    out.extend(reg::oculus_libraries().into_iter().map(|l| l.join("Software").join("vrchat-vrchat")));
    out
}

/// The first folder that actually holds VRChat.
pub fn detect_dir() -> Option<PathBuf> {
    candidates().into_iter().find(|d| launcher_in(d).is_some())
}

/// Register `vrchat://` for the current Windows user, pointing at `exe`.
pub fn register_handler(exe: &Path) -> std::io::Result<()> {
    reg::register_protocol(exe)
}

#[cfg(windows)]
mod reg {
    use std::path::{Path, PathBuf};

    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    pub fn classes_default(subkey: &str) -> Option<String> {
        RegKey::predef(HKEY_CLASSES_ROOT).open_subkey(subkey).ok()?.get_value("").ok()
    }

    pub fn uninstall_location(app: &str) -> Option<String> {
        let paths = [
            format!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{app}"),
            format!(r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{app}"),
        ];
        [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER].iter().find_map(|hive| {
            paths.iter().find_map(|p| {
                let v: String = RegKey::predef(*hive).open_subkey(p).ok()?.get_value("InstallLocation").ok()?;
                (!v.trim().is_empty()).then_some(v)
            })
        })
    }

    pub fn steam_paths() -> Vec<PathBuf> {
        let mut out = vec![];
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
            out.extend(k.get_value::<String, _>("SteamPath").ok().map(PathBuf::from));
        }
        for p in [r"Software\WOW6432Node\Valve\Steam", r"Software\Valve\Steam"] {
            if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(p) {
                out.extend(k.get_value::<String, _>("InstallPath").ok().map(PathBuf::from));
            }
        }
        out
    }

    pub fn oculus_libraries() -> Vec<PathBuf> {
        let Ok(libs) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Oculus VR, LLC\Oculus\Libraries") else {
            return vec![];
        };
        libs.enum_keys()
            .filter_map(|k| k.ok())
            .filter_map(|k| libs.open_subkey(k).ok()?.get_value::<String, _>("OriginalPath").ok())
            .map(PathBuf::from)
            .collect()
    }

    pub fn register_protocol(exe: &Path) -> std::io::Result<()> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(r"Software\Classes\vrchat")?;
        key.set_value("", &"URL:vrchat")?;
        key.set_value("URL Protocol", &"")?;
        let (cmd, _) = key.create_subkey(r"shell\open\command")?;
        cmd.set_value("", &format!("\"{}\" \"%1\" %*", exe.display()))
    }
}

#[cfg(not(windows))]
mod reg {
    use std::path::{Path, PathBuf};

    pub fn classes_default(_: &str) -> Option<String> {
        None
    }
    pub fn uninstall_location(_: &str) -> Option<String> {
        None
    }
    pub fn steam_paths() -> Vec<PathBuf> {
        vec![]
    }
    pub fn oculus_libraries() -> Vec<PathBuf> {
        vec![]
    }
    pub fn register_protocol(_: &Path) -> std::io::Result<()> {
        Err(std::io::Error::other("vrchat:// links can only be registered on Windows"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_library_paths_from_vdf() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps" { "228980" "0" }
	}
	"1"
	{
		"path"		"E:\\SteamLibrary"
	}
}"#;
        assert_eq!(
            vdf_library_paths(vdf),
            vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"E:\SteamLibrary")]
        );
    }

    #[test]
    fn launcher_prefers_launch_exe() {
        let dir = std::env::temp_dir().join(format!("nexus-vrc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(launcher_in(&dir), None);
        std::fs::write(dir.join("VRChat.exe"), b"").unwrap();
        assert_eq!(launcher_in(&dir), Some(dir.join("VRChat.exe")));
        std::fs::write(dir.join("launch.exe"), b"").unwrap();
        assert_eq!(launcher_in(&dir), Some(dir.join("launch.exe")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detection_does_not_panic() {
        println!("handler_ok={} detect_dir={:?}", handler_ok(), detect_dir());
    }
}
