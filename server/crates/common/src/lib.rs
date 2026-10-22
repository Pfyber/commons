//! Plumbing shared by every Commons service.

pub mod config;
pub mod filter;
pub mod ratelimit;
pub mod telemetry;
pub mod token;
pub mod voice;

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
