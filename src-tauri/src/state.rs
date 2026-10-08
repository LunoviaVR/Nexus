use std::collections::HashMap;

use parking_lot::{Mutex, RwLock};
use serde_json::Value;

use crate::api::Api;
use crate::db::Db;
use crate::error::{Error, Result};
use crate::gamelog::InstanceState;
use crate::settings::AppSettings;

#[derive(Default)]
pub struct Session {
    pub user: Option<Value>,
    pub friends: HashMap<String, Value>,
    /// Favorited friend user id -> favorite record id (`fvrt_...`).
    pub favorites: HashMap<String, String>,
    pub pipeline: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Friends you rang the bell for: online/offline toasts regardless of the global scope.
    pub watched: std::collections::HashSet<String>,
    /// Background profile sweep that catches bio edits made outside the game.
    pub bio_sweep: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub struct PendingLogin {
    pub username: String,
    pub password: String,
    pub remember: bool,
}

pub struct AppState {
    pub api: Api,
    pub db: Db,
    pub session: RwLock<Session>,
    pub pending: Mutex<Option<PendingLogin>>,
    pub settings: RwLock<AppSettings>,
    pub instance: Mutex<InstanceState>,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        let settings = db.load_settings();
        Self {
            api: Api::new(),
            db,
            session: RwLock::new(Session::default()),
            pending: Mutex::new(None),
            settings: RwLock::new(settings),
            instance: Mutex::new(InstanceState::default()),
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.read().clone()
    }

    pub fn me_id(&self) -> Result<String> {
        self.session
            .read()
            .user
            .as_ref()
            .and_then(|u| u["id"].as_str())
            .map(String::from)
            .ok_or(Error::NotLoggedIn)
    }

    pub fn is_friend(&self, user_id: &str) -> bool {
        self.session.read().friends.contains_key(user_id)
    }

    pub fn is_favorite(&self, user_id: &str) -> bool {
        self.session.read().favorites.contains_key(user_id)
    }

    pub fn is_watched(&self, user_id: &str) -> bool {
        self.session.read().watched.contains(user_id)
    }
}
