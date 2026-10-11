//! Zone server (spec §4.1): hosts many zone instances per process, each a
//! single-threaded actor ticking at 10 Hz.

mod conn;
mod econ;
mod games;
mod instance;
mod registry;
mod screen;
mod social;
mod stats;

use axum::Router;
use axum::extract::{State, WebSocketUpgrade};
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use commons_common::{config, telemetry};
use registry::Registry;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let prom = telemetry::init("zone");
    let bind = config::env_str("ZONE_BIND", "0.0.0.0:8082");
    let maps_dir = config::env_str("COMMONS_MAPS_DIR", "assets/maps");
    let playlist_path = config::env_str("COMMONS_SCREEN_PLAYLIST", "assets/screen/playlist.json");
    let playlist = screen::Playlist::load(&playlist_path)?;
    let api = config::env_str("COMMONS_API_INTERNAL_URL", "http://127.0.0.1:8080");
    let economy = econ::EconomyClient::new(api, config::secret());
    tokio::spawn(economy.clone().load_catalog_forever());
    let social = social::SocialClient::new(
        config::env_str("COMMONS_SOCIAL_INTERNAL_URL", "http://127.0.0.1:8083"),
        config::secret(),
    );
    let registry = Arc::new(Registry::load(
        &maps_dir,
        playlist,
        config::secret(),
        Some(economy),
        Some(social),
    )?);

    let app = Router::new()
        .route("/ws", get(ws))
        .route("/debug/stats", get(debug_stats))
        .with_state(registry)
        .merge(telemetry::routes(prom));

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "zone server listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn ws(State(registry): State<Arc<Registry>>, upgrade: WebSocketUpgrade) -> impl IntoResponse {
    upgrade
        .max_message_size(conn::MAX_INBOUND_FRAME)
        .max_frame_size(conn::MAX_INBOUND_FRAME)
        .on_upgrade(move |socket| conn::session(socket, registry))
}

/// Per-instance population and tick timings; read by botswarm's perf gate.
/// Internal endpoint: expose only on the cluster network in production.
async fn debug_stats(State(registry): State<Arc<Registry>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "instances": registry.stats() }))
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
