//! Presence reports to the social gateway (spec §4.1): zone servers say who
//! arrived and left, so friends can see where you are and join you.
//! Fire-and-forget: presence is a nicety, never worth blocking the game.

use commons_common::token::{self, ServiceClaims};
use std::sync::Arc;
use std::time::Duration;

pub struct SocialClient {
    http: reqwest::Client,
    base: String,
    secret: Vec<u8>,
}

pub struct Presence<'a> {
    pub player: &'a str,
    pub zone: &'a str,
    pub zone_name: &'a str,
    pub instance: u16,
    pub owner: Option<&'a str>,
    pub present: bool,
    /// When this happened, so the gateway can ignore reports that arrive late.
    pub at_ms: i64,
}

/// Bots and other non-account players have ids that aren't UUIDs.
pub(crate) fn is_account(id: &str) -> bool {
    id.len() == 36 && id.chars().filter(|c| *c == '-').count() == 4
}

impl SocialClient {
    pub fn new(base: String, secret: Vec<u8>) -> Arc<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .expect("http client");
        Arc::new(SocialClient { http, base, secret })
    }

    pub fn report(self: &Arc<Self>, p: Presence<'_>) {
        if !is_account(p.player) {
            return;
        }
        let body = serde_json::json!({
            "player": p.player, "zone": p.zone, "zone_name": p.zone_name,
            "instance": p.instance, "owner": p.owner, "present": p.present, "at_ms": p.at_ms,
        });
        let this = self.clone();
        tokio::spawn(async move {
            let auth = token::sign(&this.secret, &ServiceClaims { svc: "zone".into() }, 60);
            let r = this
                .http
                .post(format!("{}/internal/presence", this.base))
                .bearer_auth(auth)
                .json(&body)
                .send()
                .await;
            if let Err(e) = r {
                tracing::debug!(error = %e, "presence report failed");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn bots_are_not_reported() {
        assert!(!super::is_account("bot-12"));
        assert!(super::is_account("99083e44-0c20-4878-982a-065ea718d9e4"));
    }
}
