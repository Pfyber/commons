//! Account storage.
//!
//! M1 keeps accounts in memory so the stack runs without Postgres; data is lost
//! on restart. The shape mirrors the `accounts` / `players` tables in
//! `server/migrations/0001_core.sql`, which replace this in M3 together with
//! the economy service.

use commons_common::token::TrustTier;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone)]
pub struct Player {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub birth_year: i32,
    pub look: u32,
    pub trust_tier: TrustTier,
    pub created_at: u64,
}

struct MagicLink {
    email: String,
    expires: u64,
}

struct Refresh {
    player_id: String,
    expires: u64,
}

#[derive(Default)]
struct Inner {
    players: HashMap<String, Player>,
    by_email: HashMap<String, String>,
    by_name: HashMap<String, String>,
    /// Keyed by SHA-256 of the token, so a memory dump doesn't yield live links.
    magic: HashMap<String, MagicLink>,
    refresh: HashMap<String, Refresh>,
    last_link_sent: HashMap<String, u64>,
}

#[derive(Default)]
pub struct Store(Mutex<Inner>);

pub fn hash_token(t: &str) -> String {
    Sha256::digest(t.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
pub enum CreateError {
    NameTaken,
    EmailTaken,
}

impl Store {
    /// Records a link request; returns false if one was sent too recently.
    pub fn allow_link(&self, email: &str, now: u64, min_gap: u64) -> bool {
        let mut s = self.0.lock().unwrap();
        match s.last_link_sent.get(email) {
            Some(&t) if now < t + min_gap => false,
            _ => {
                s.last_link_sent.insert(email.to_string(), now);
                true
            }
        }
    }

    pub fn put_magic(&self, token: &str, email: &str, expires: u64) {
        let mut s = self.0.lock().unwrap();
        s.magic
            .retain(|_, m| m.expires > expires.saturating_sub(24 * 3600));
        s.magic.insert(
            hash_token(token),
            MagicLink {
                email: email.to_string(),
                expires,
            },
        );
    }

    /// Single use: the link is consumed whether or not it has expired.
    pub fn take_magic(&self, token: &str, now: u64) -> Option<String> {
        let link = self.0.lock().unwrap().magic.remove(&hash_token(token))?;
        (link.expires > now).then_some(link.email)
    }

    pub fn player_by_email(&self, email: &str) -> Option<Player> {
        let s = self.0.lock().unwrap();
        s.by_email
            .get(email)
            .and_then(|id| s.players.get(id))
            .cloned()
    }

    pub fn player_by_name(&self, name: &str) -> Option<Player> {
        let s = self.0.lock().unwrap();
        s.by_name
            .get(&name.to_lowercase())
            .and_then(|id| s.players.get(id))
            .cloned()
    }

    pub fn player(&self, id: &str) -> Option<Player> {
        self.0.lock().unwrap().players.get(id).cloned()
    }

    pub fn create_player(&self, p: Player) -> Result<Player, CreateError> {
        let mut s = self.0.lock().unwrap();
        let name_key = p.display_name.to_lowercase();
        if s.by_name.contains_key(&name_key) {
            return Err(CreateError::NameTaken);
        }
        if s.by_email.contains_key(&p.email) {
            return Err(CreateError::EmailTaken);
        }
        s.by_name.insert(name_key, p.id.clone());
        s.by_email.insert(p.email.clone(), p.id.clone());
        s.players.insert(p.id.clone(), p.clone());
        Ok(p)
    }

    pub fn put_refresh(&self, token: &str, player_id: &str, expires: u64) {
        let mut s = self.0.lock().unwrap();
        s.refresh.insert(
            hash_token(token),
            Refresh {
                player_id: player_id.to_string(),
                expires,
            },
        );
    }

    /// Consumes a refresh token (rotation): each one works exactly once.
    pub fn take_refresh(&self, token: &str, now: u64) -> Option<String> {
        let r = self.0.lock().unwrap().refresh.remove(&hash_token(token))?;
        (r.expires > now).then_some(r.player_id)
    }
}
