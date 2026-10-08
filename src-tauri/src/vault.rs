//! Keys for data at rest. Everything Nexus keeps about you on disk is encrypted with a random key
//! held in Windows Credential Manager, next to your VRChat session:
//! - the database (`nexus.db`) through SQLCipher,
//! - cached images through AES-256-GCM.
//!
//! Reading it takes a deliberate step: Settings → Data → "Export decrypted copy".

use std::sync::OnceLock;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use keyring::Entry;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

const SERVICE: &str = "nexus-vrchat";
const ACCOUNT: &str = "database-key";

static IMAGE_KEY: OnceLock<[u8; 32]> = OnceLock::new();

fn random<const N: usize>() -> Result<[u8; N]> {
    let mut b = [0u8; N];
    getrandom::getrandom(&mut b).map_err(|e| Error::Other(format!("No secure randomness available: {e}")))?;
    Ok(b)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<[u8; 32]> {
    let s = s.trim();
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// The master key, created on first use. `created` tells the caller there was no key before.
pub fn master_key() -> Result<([u8; 32], bool)> {
    let entry = Entry::new(SERVICE, ACCOUNT)?;
    if let Some(key) = entry.get_password().ok().as_deref().and_then(unhex) {
        return Ok((key, false));
    }
    let key = random::<32>()?;
    entry.set_password(&hex(&key))?;
    Ok((key, true))
}

/// Separate keys per use, derived from the master key.
fn derive(master: &[u8; 32], purpose: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"nexus/");
    h.update(purpose.as_bytes());
    h.update(master);
    h.finalize().into()
}

pub fn database_key(master: &[u8; 32]) -> [u8; 32] {
    derive(master, "database")
}

pub fn init_images(master: &[u8; 32]) {
    let _ = IMAGE_KEY.set(derive(master, "images"));
}

/// Cache file name for a URL; keyed, so names can't be matched against known URLs.
pub fn image_name(url: &str) -> Option<String> {
    let key = IMAGE_KEY.get()?;
    let mut h = Sha256::new();
    h.update(key);
    h.update(url.as_bytes());
    Some(hex(&h.finalize()[..16]))
}

/// nonce (12 bytes) || ciphertext
pub fn seal(plain: &[u8]) -> Option<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(IMAGE_KEY.get()?).ok()?;
    let nonce = random::<12>().ok()?;
    let mut out = nonce.to_vec();
    out.extend(cipher.encrypt(Nonce::from_slice(&nonce), plain).ok()?);
    Some(out)
}

pub fn open(sealed: &[u8]) -> Option<Vec<u8>> {
    if sealed.len() < 12 + 16 {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(IMAGE_KEY.get()?).ok()?;
    let (nonce, ct) = sealed.split_at(12);
    cipher.decrypt(Nonce::from_slice(nonce), ct).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seals_and_opens_images() {
        init_images(&[7u8; 32]);
        let sealed = seal(b"picture bytes").unwrap();
        assert!(!sealed.windows(7).any(|w| w == b"picture"));
        assert_eq!(open(&sealed).unwrap(), b"picture bytes");
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(open(&tampered).is_none());
    }

    #[test]
    fn derived_keys_differ() {
        let m = [1u8; 32];
        assert_ne!(database_key(&m), derive(&m, "images"));
        assert_eq!(unhex(&hex(&m)), Some(m));
    }
}
