//! Environment-based configuration. Every variable has a dev default so
//! `cargo run` works out of the box; production must set `COMMONS_SECRET`.

use std::str::FromStr;

pub fn env_or<T: FromStr>(key: &str, default: T) -> T {
    match std::env::var(key) {
        Ok(v) => v
            .parse()
            .unwrap_or_else(|_| panic!("invalid value for {key}: {v:?}")),
        Err(_) => default,
    }
}

pub fn env_str(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// Dev mode enables shortcuts (dev login, magic links returned in responses).
pub fn dev_mode() -> bool {
    env_or("COMMONS_DEV", true)
}

const DEV_SECRET: &str = "commons-dev-secret-do-not-use-in-production";

/// HMAC key shared by the services that sign or verify tokens.
pub fn secret() -> Vec<u8> {
    match std::env::var("COMMONS_SECRET") {
        Ok(s) if s.len() >= 32 => s.into_bytes(),
        Ok(_) => panic!("COMMONS_SECRET must be at least 32 bytes"),
        Err(_) if dev_mode() => {
            tracing::warn!("COMMONS_SECRET not set; using the insecure dev secret");
            DEV_SECRET.as_bytes().to_vec()
        }
        Err(_) => panic!("COMMONS_SECRET is required when COMMONS_DEV=false"),
    }
}
