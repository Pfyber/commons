//! Commons API library: auth, the economy service, town life (quarters,
//! goals, requests), governance and internal endpoints.
//! The `api` binary serves it; the social gateway reuses the economy and
//! account code.

pub mod auth;
pub mod bottles;
pub mod economy;
pub mod error;
pub mod gov;
pub mod internal;
pub mod mail;
pub mod mall;
pub mod play;
pub mod store;
#[cfg(test)]
mod tests;
pub mod town;
pub mod welcome;

use anyhow::Context;
use economy::Catalog;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

pub struct AppState {
    pub secret: Vec<u8>,
    pub dev: bool,
    pub client_url: String,
    pub store: store::Store,
    pub db: sqlx::PgPool,
    pub catalog: Arc<Catalog>,
    /// Garden growth period per stage (spec: plants grow over real days).
    pub stage_ms: i64,
    /// Sends sign-in links; `None` in dev (links are returned instead).
    pub mailer: Option<mail::Mailer>,
}

/// Connects to Postgres and applies `server/migrations`.
pub async fn connect(db_url: &str, max_connections: u32) -> anyhow::Result<sqlx::PgPool> {
    let db = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(db_url)
        .await
        .with_context(|| format!("connecting to {}", redact(db_url)))?;
    sqlx::migrate!("../../migrations")
        .run(&db)
        .await
        .context("running migrations")?;
    Ok(db)
}

pub fn redact(url: &str) -> String {
    match (url.find("://"), url.rfind('@')) {
        (Some(s), Some(at)) if at > s => format!("{}://***{}", &url[..s], &url[at..]),
        _ => url.to_string(),
    }
}
