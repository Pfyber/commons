//! Compact HS256 JWTs. Every token carries a `typ` so an access token can never
//! be replayed as a join token and vice versa.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::Sha256;

const HEADER: &str = r#"{"alg":"HS256","typ":"JWT"}"#;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TokenError {
    #[error("malformed token")]
    Malformed,
    #[error("bad signature")]
    BadSignature,
    #[error("token expired")]
    Expired,
    #[error("wrong token type")]
    WrongType,
}

pub trait Claims: Serialize + DeserializeOwned {
    const TYP: &'static str;
}

#[derive(Serialize, Deserialize)]
struct Envelope<T> {
    typ: String,
    exp: u64,
    #[serde(flatten)]
    claims: T,
}

#[derive(Deserialize)]
struct Head {
    typ: String,
    exp: u64,
}

fn mac(secret: &[u8]) -> Hmac<Sha256> {
    Hmac::<Sha256>::new_from_slice(secret).expect("hmac accepts any key length")
}

pub fn sign<T: Claims>(secret: &[u8], claims: &T, ttl_secs: u64) -> String {
    let env = Envelope {
        typ: T::TYP.to_string(),
        exp: crate::now_unix() + ttl_secs,
        claims,
    };
    let body = format!(
        "{}.{}",
        B64.encode(HEADER),
        B64.encode(serde_json::to_vec(&env).unwrap())
    );
    let mut m = mac(secret);
    m.update(body.as_bytes());
    format!("{body}.{}", B64.encode(m.finalize().into_bytes()))
}

pub fn verify<T: Claims>(secret: &[u8], token: &str) -> Result<T, TokenError> {
    let (body, sig) = token.rsplit_once('.').ok_or(TokenError::Malformed)?;
    let sig = B64.decode(sig).map_err(|_| TokenError::Malformed)?;
    let mut m = mac(secret);
    m.update(body.as_bytes());
    m.verify_slice(&sig).map_err(|_| TokenError::BadSignature)?;
    let (_, payload) = body.split_once('.').ok_or(TokenError::Malformed)?;
    let payload = B64.decode(payload).map_err(|_| TokenError::Malformed)?;
    let head: Head = serde_json::from_slice(&payload).map_err(|_| TokenError::Malformed)?;
    if head.typ != T::TYP {
        return Err(TokenError::WrongType);
    }
    if head.exp <= crate::now_unix() {
        return Err(TokenError::Expired);
    }
    let env: Envelope<T> = serde_json::from_slice(&payload).map_err(|_| TokenError::Malformed)?;
    Ok(env.claims)
}

/// Trust tiers (spec §10.6).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum TrustTier {
    Visitor,
    Newcomer,
    Resident,
    Steward,
}

/// Short-lived API access token.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessClaims {
    pub sub: String,
    pub name: String,
    pub look: u32,
    /// What you wear from the mall (protocol `EntityInfo::style`).
    #[serde(default)]
    pub style: u32,
    pub tier: TrustTier,
    /// Under 16: friends-only DMs and filtered chat (spec §12).
    pub minor: bool,
    /// Unix time a moderation mute ends (0: not muted).
    #[serde(default)]
    pub muted_until: u64,
}

impl Claims for AccessClaims {
    const TYP: &'static str = "access";
}

/// Issued by the orchestrator; admits a player to one zone instance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinClaims {
    pub sub: String,
    pub name: String,
    pub look: u32,
    #[serde(default)]
    pub style: u32,
    pub tier: TrustTier,
    pub minor: bool,
    pub zone: String,
    pub instance: u16,
    /// For private spaces (homes): whose space this instance is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// Unix time a moderation mute ends (0: not muted).
    #[serde(default)]
    pub muted_until: u64,
    /// Arrive at this home lot's front door (leaving your home) instead of
    /// the zone's spawn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arrive: Option<String>,
}

impl Claims for JoinClaims {
    const TYP: &'static str = "join";
}

/// Service-to-service calls (zone server → API internal endpoints).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceClaims {
    pub svc: String,
}

impl Claims for ServiceClaims {
    const TYP: &'static str = "service";
}

pub const ACCESS_TTL_SECS: u64 = 15 * 60;
pub const JOIN_TTL_SECS: u64 = 60;

#[cfg(test)]
mod tests {
    use super::*;

    fn claims() -> AccessClaims {
        AccessClaims {
            sub: "p1".into(),
            name: "Ana".into(),
            look: 3,
            style: 0,
            tier: TrustTier::Visitor,
            minor: false,
            muted_until: 0,
        }
    }

    #[test]
    fn roundtrip_and_tamper() {
        let t = sign(b"k", &claims(), 60);
        assert_eq!(verify::<AccessClaims>(b"k", &t), Ok(claims()));
        assert_eq!(
            verify::<AccessClaims>(b"other", &t),
            Err(TokenError::BadSignature)
        );
        assert_eq!(verify::<JoinClaims>(b"k", &t), Err(TokenError::WrongType));
        let mut forged = t.clone();
        forged.insert(40, 'A');
        assert!(verify::<AccessClaims>(b"k", &forged).is_err());
        assert_eq!(
            verify::<AccessClaims>(b"k", "nope"),
            Err(TokenError::Malformed)
        );
    }

    #[test]
    fn expiry() {
        let t = sign(b"k", &claims(), 0);
        assert_eq!(verify::<AccessClaims>(b"k", &t), Err(TokenError::Expired));
    }
}
