use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{message}")]
    Api { status: u16, message: String },
    #[error("Not logged in")]
    NotLoggedIn,
    #[error("Network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("Credential store error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("{0}")]
    Other(String),
}

impl Error {
    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api { status, .. } => Some(*status),
            _ => None,
        }
    }
}

// Commands return errors to the UI as plain strings.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
