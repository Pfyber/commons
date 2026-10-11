//! HTTP API (spec §4.1). M1 ships the auth service; economy, governance,
//! districts and content join this binary in later milestones.

mod auth;
mod error;
mod store;

use axum::Router;
use commons_common::{config, telemetry};
use std::sync::Arc;

pub struct AppState {
    pub secret: Vec<u8>,
    pub dev: bool,
    pub client_url: String,
    pub store: store::Store,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let prom = telemetry::init("api");
    let bind = config::env_str("API_BIND", "0.0.0.0:8080");
    let state = Arc::new(AppState {
        secret: config::secret(),
        dev: config::dev_mode(),
        client_url: config::env_str("COMMONS_CLIENT_URL", "http://localhost:5173"),
        store: store::Store::default(),
    });
    if state.dev {
        tracing::warn!(
            "dev mode: magic links are returned in responses and /auth/dev-login is enabled"
        );
    }

    let app = Router::new()
        .nest("/api", auth::routes())
        .with_state(state)
        .merge(telemetry::routes(prom));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "api listening");
    axum::serve(listener, app).await?;
    Ok(())
}
