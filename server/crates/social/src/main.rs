//! Social gateway (spec §4.1): friends and presence, "join friend", direct
//! messages, doorstep gifts and notifications. One persistent socket per
//! client, independent of the zone they're in.

mod calls;
mod db;
mod homes;
mod hub;
mod rent;
mod routes;
mod stalls;
#[cfg(test)]
mod tests;

use commons_api::economy::Catalog;
use commons_common::ratelimit::Bucket;
use commons_common::{config, telemetry};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use uuid::Uuid;

pub struct State {
    pub db: sqlx::PgPool,
    pub secret: Vec<u8>,
    pub catalog: Arc<Catalog>,
    pub hub: hub::Hub,
    /// Phone calls in progress (ADR 0013).
    pub calls: calls::Calls,
    /// Where calls' voices go; `None`: the phone lines are down.
    pub livekit: Option<commons_common::voice::LiveKit>,
    dm_limits: Mutex<HashMap<Uuid, Bucket>>,
    ring_limits: Mutex<HashMap<Uuid, Bucket>>,
    started: Instant,
}

impl State {
    pub fn new(db: sqlx::PgPool, secret: Vec<u8>, catalog: Arc<Catalog>) -> Self {
        State {
            db,
            secret,
            catalog,
            hub: hub::Hub::default(),
            calls: calls::Calls::default(),
            livekit: commons_common::voice::LiveKit::from_env(),
            dm_limits: Mutex::new(HashMap::new()),
            ring_limits: Mutex::new(HashMap::new()),
            started: routes::started(),
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let prom = telemetry::init("social");
    let bind = config::env_str("SOCIAL_BIND", "0.0.0.0:8083");
    let db_url = config::env_str(
        "DATABASE_URL",
        "postgres://commons:commons@localhost:5432/commons",
    );
    let db = commons_api::connect(&db_url, config::env_or("DATABASE_POOL", 10)).await?;
    let catalog = Arc::new(Catalog::load(&db).await?);
    let state = Arc::new(State::new(db, config::secret(), catalog));
    rent::spawn_sweeper(state.clone());
    calls::spawn_ring_timeouts(state.clone());
    let app = routes::routes()
        .with_state(state)
        .merge(telemetry::routes(prom));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "social gateway listening");
    axum::serve(listener, app).await?;
    Ok(())
}
