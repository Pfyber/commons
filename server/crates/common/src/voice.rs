//! Phone calls (ADR 0013): who may talk to whom, and the passes that let a
//! client into a call's LiveKit room.
//!
//! Calls are between friends who both own a phone (checked by the social
//! gateway). On top of that, this module holds the age rules. Players under
//! 16 can't call or be called until `COMMONS_VOICE_MINORS` is turned on;
//! once it is, under-16s talk only with other under-16s, and only if they've
//! switched calls on themselves.

use crate::config;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;

/// People in one call at most.
pub const MAX_IN_CALL: usize = 8;

/// Whether under-16s may use calls at all (off until it's been reviewed).
pub fn minors_enabled() -> bool {
    config::env_or("COMMONS_VOICE_MINORS", false)
}

/// One side of a call, as far as the age rules care.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Talker {
    pub minor: bool,
    /// An under-16 who has switched calls on (ignored for adults).
    pub opted_in: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// Calls for under-16s aren't open yet.
    MinorsNotYet,
    /// Under-16s and adults don't share calls.
    MixedAges,
    /// An under-16 who hasn't switched calls on.
    NotOptedIn,
}

impl Refusal {
    pub fn message(self) -> &'static str {
        match self {
            Refusal::MinorsNotYet => "Phone calls for under-16s aren't open yet.",
            Refusal::MixedAges => "Calls are only between players of the same age group.",
            Refusal::NotOptedIn => "They haven't switched phone calls on.",
        }
    }
}

/// May `a` and `b` be in a call together, by the age rules?
pub fn may_talk(minors_enabled: bool, a: Talker, b: Talker) -> Result<(), Refusal> {
    if !a.minor && !b.minor {
        return Ok(());
    }
    if !minors_enabled {
        return Err(Refusal::MinorsNotYet);
    }
    if a.minor != b.minor {
        return Err(Refusal::MixedAges);
    }
    if !a.opted_in || !b.opted_in {
        return Err(Refusal::NotOptedIn);
    }
    Ok(())
}

/// The LiveKit server clients connect to, and its API key and secret.
#[derive(Debug, Clone)]
pub struct LiveKit {
    pub url: String,
    pub key: String,
    pub secret: String,
}

impl LiveKit {
    /// From `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (the
    /// defaults are `livekit-server --dev`'s). `None` without a URL: no calls.
    pub fn from_env() -> Option<Self> {
        let url = config::env_str("LIVEKIT_URL", "ws://localhost:7880");
        if url.is_empty() {
            return None;
        }
        Some(LiveKit {
            url,
            key: config::env_str("LIVEKIT_API_KEY", "devkey"),
            secret: config::env_str("LIVEKIT_API_SECRET", "secret"),
        })
    }

    /// LiveKit's HTTP API (the room service), from the URL clients use.
    pub fn http_url(&self) -> String {
        if let Some(rest) = self.url.strip_prefix("wss://") {
            format!("https://{rest}")
        } else if let Some(rest) = self.url.strip_prefix("ws://") {
            format!("http://{rest}")
        } else {
            self.url.clone()
        }
    }

    /// A short pass for the room service, to manage `room` (remove someone).
    pub fn admin_token(&self, room: &str, now: u64) -> String {
        self.sign(json!({
            "iss": self.key,
            "nbf": now.saturating_sub(10),
            "exp": now + 60,
            "video": { "room": room, "roomAdmin": true },
        }))
    }

    /// A pass into `room` as `identity` (shown as `name`): it may talk and
    /// listen, nothing else. Good for `ttl_secs` to connect; LiveKit keeps
    /// the connection once made.
    pub fn token(&self, room: &str, identity: &str, name: &str, now: u64, ttl_secs: u64) -> String {
        self.sign(json!({
            "iss": self.key,
            "sub": identity,
            "name": name,
            "nbf": now.saturating_sub(10),
            "exp": now + ttl_secs,
            "video": {
                "room": room,
                "roomJoin": true,
                "canPublish": true,
                "canSubscribe": true,
                "canPublishData": false,
                "canPublishSources": ["microphone"],
            },
        }))
    }

    /// An HS256 JWT of `claims`, signed with the API secret.
    fn sign(&self, claims: serde_json::Value) -> String {
        let header = json!({ "alg": "HS256", "typ": "JWT" });
        let body = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(header.to_string()),
            URL_SAFE_NO_PAD.encode(claims.to_string())
        );
        let mut mac =
            Hmac::<Sha256>::new_from_slice(self.secret.as_bytes()).expect("any key length");
        mac.update(body.as_bytes());
        format!(
            "{body}.{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ADULT: Talker = Talker {
        minor: false,
        opted_in: false,
    };
    const KID: Talker = Talker {
        minor: true,
        opted_in: true,
    };
    const SHY_KID: Talker = Talker {
        minor: true,
        opted_in: false,
    };

    #[test]
    fn adults_always_kids_only_when_opened() {
        assert_eq!(may_talk(false, ADULT, ADULT), Ok(()));
        assert_eq!(may_talk(false, ADULT, KID), Err(Refusal::MinorsNotYet));
        assert_eq!(may_talk(false, KID, KID), Err(Refusal::MinorsNotYet));
        // Opened: kids with kids who've switched calls on; never mixed.
        assert_eq!(may_talk(true, KID, KID), Ok(()));
        assert_eq!(may_talk(true, ADULT, KID), Err(Refusal::MixedAges));
        assert_eq!(may_talk(true, KID, ADULT), Err(Refusal::MixedAges));
        assert_eq!(may_talk(true, KID, SHY_KID), Err(Refusal::NotOptedIn));
        assert_eq!(may_talk(true, ADULT, ADULT), Ok(()));
    }

    #[test]
    fn a_pass_is_a_signed_jwt_for_one_room() {
        let lk = LiveKit {
            url: "ws://x".into(),
            key: "devkey".into(),
            secret: "secret".into(),
        };
        let t = lk.token("call-1", "p1", "Ana", 1_000_000, 120);
        let parts: Vec<&str> = t.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["iss"], "devkey");
        assert_eq!(claims["sub"], "p1");
        assert_eq!(claims["exp"], 1_000_120);
        assert_eq!(claims["video"]["room"], "call-1");
        assert_eq!(claims["video"]["roomJoin"], true);
        let admin = lk.admin_token("call-1", 1_000_000);
        let a: serde_json::Value = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(admin.split('.').nth(1).unwrap())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(a["video"]["roomAdmin"], true);
        assert_eq!(a["video"]["room"], "call-1");
        assert_eq!(lk.http_url(), "http://x");
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret").unwrap();
        mac.update(format!("{}.{}", parts[0], parts[1]).as_bytes());
        assert!(
            mac.verify_slice(&URL_SAFE_NO_PAD.decode(parts[2]).unwrap())
                .is_ok()
        );
    }
}
