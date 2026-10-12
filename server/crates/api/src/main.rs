//! HTTP API (spec §4.1): auth, the economy service (inventory, album, market,
//! daily gift) and internal endpoints for zone servers. Postgres-backed;
//! migrations in `server/migrations` run on startup.

use axum::Router;
use commons_api::economy::Catalog;
use commons_api::{AppState, auth, economy, internal, play, store, town};
use commons_common::{config, telemetry};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let prom = telemetry::init("api");
    let bind = config::env_str("API_BIND", "0.0.0.0:8080");
    let db_url = config::env_str(
        "DATABASE_URL",
        "postgres://commons:commons@localhost:5432/commons",
    );
    let db = commons_api::connect(&db_url, config::env_or("DATABASE_POOL", 20)).await?;
    let catalog = Arc::new(Catalog::load(&db).await?);
    tracing::info!(items = catalog.items.len(), "catalogue loaded");

    let state = Arc::new(AppState {
        secret: config::secret(),
        dev: config::dev_mode(),
        client_url: config::env_str("COMMONS_CLIENT_URL", "http://localhost:5173"),
        store: store::Store::new(db.clone()),
        db,
        catalog,
        stage_ms: config::growth_stage_ms(),
    });
    if state.dev {
        tracing::warn!(
            "dev mode: magic links are returned in responses and /auth/dev-login is enabled"
        );
    }

    let app = Router::new()
        .nest(
            "/api",
            auth::routes()
                .merge(economy::routes())
                .merge(town::routes())
                .merge(play::routes()),
        )
        .nest("/internal", internal::routes())
        .with_state(state)
        .merge(telemetry::routes(prom));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "api listening");
    axum::serve(listener, app).await?;
    Ok(())
}
