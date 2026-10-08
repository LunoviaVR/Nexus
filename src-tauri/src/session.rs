//! Per-account secrets (session cookies, optional saved password) in the OS credential store.

use std::collections::HashMap;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::error::Result;

const SERVICE: &str = "nexus-vrchat";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Saved {
    pub cookies: HashMap<String, String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

pub fn save(user_id: &str, saved: &Saved) -> Result<()> {
    Entry::new(SERVICE, user_id)?.set_password(&serde_json::to_string(saved)?)?;
    Ok(())
}

pub fn load(user_id: &str) -> Option<Saved> {
    let secret = Entry::new(SERVICE, user_id).ok()?.get_password().ok()?;
    serde_json::from_str(&secret).ok()
}

pub fn delete(user_id: &str) {
    if let Ok(entry) = Entry::new(SERVICE, user_id) {
        let _ = entry.delete_credential();
    }
}
