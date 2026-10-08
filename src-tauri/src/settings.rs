use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Off,
    Favorites,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub notify_online: Scope,
    pub notify_offline: Scope,
    pub notify_instance_join: Scope,
    /// Someone invites you to their instance.
    pub notify_invites: bool,
    pub notify_invite_requests: bool,
    pub notify_friend_requests: bool,
    /// A friend request (yours or theirs) was accepted.
    pub notify_new_friends: bool,
    pub notify_unfriends: bool,
    pub notify_boops: bool,
    pub minimize_to_tray: bool,
    pub log_dir: Option<String>,
    /// VRChat's install folder; None = detect it.
    pub vrchat_dir: Option<String>,
    /// Save prints other players show in your instance (seen via the game log).
    pub save_prints: bool,
    /// Save stickers other players spawn in your instance.
    pub save_stickers: bool,
    /// Where saved prints/stickers go; defaults to Pictures/Nexus.
    pub ugc_dir: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            notify_online: Scope::Favorites,
            notify_offline: Scope::Off,
            notify_instance_join: Scope::Favorites,
            notify_invites: true,
            notify_invite_requests: true,
            notify_friend_requests: true,
            notify_new_friends: true,
            notify_unfriends: true,
            notify_boops: true,
            minimize_to_tray: true,
            log_dir: None,
            vrchat_dir: None,
            save_prints: true,
            save_stickers: true,
            ugc_dir: None,
        }
    }
}
