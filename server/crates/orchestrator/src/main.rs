//! Router / orchestrator (spec §4.1): `POST /join {zone_id}` → which zone
//! server and instance to connect to, plus a short-lived join token.
//!
//! M1 has a single zone server and always routes to instance 1. M5 adds the
//! real policy (friend's instance > instance with friends > least-full under
//! soft cap > new instance) using populations from Redis.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use commons_common::token::{self, AccessClaims, JOIN_TTL_SECS, JoinClaims};
use commons_common::{config, telemetry};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

struct AppState {
    secret: Vec<u8>,
    /// Public WebSocket URL of the zone server, e.g. `ws://localhost:8082/ws`.
    zone_server_url: String,
    zones: Vec<String>,
}

#[derive(Deserialize)]
struct JoinReq {
    zone_id: String,
    #[allow(dead_code)] // used by M4/M5 routing
    prefer_friend_id: Option<String>,
}

#[derive(Serialize)]
struct JoinResp {
    server_url: String,
    zone_id: String,
    instance_id: u16,
    join_token: String,
}

type Err = (StatusCode, Json<serde_json::Value>);

fn err(status: StatusCode, code: &str, message: &str) -> Err {
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
}

async fn join(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<JoinReq>,
) -> Result<Json<JoinResp>, Err> {
    let bearer = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| {
            err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing bearer token",
            )
        })?;
    let who: AccessClaims = token::verify(&state.secret, bearer)
        .map_err(|e| err(StatusCode::UNAUTHORIZED, "unauthorized", &e.to_string()))?;
    if !state.zones.contains(&req.zone_id) {
        return Err(err(StatusCode::NOT_FOUND, "unknown_zone", "no such zone"));
    }
    let instance = 1;
    let claims = JoinClaims {
        sub: who.sub,
        name: who.name,
        look: who.look,
        tier: who.tier,
        minor: who.minor,
        zone: req.zone_id.clone(),
        instance,
    };
    Ok(Json(JoinResp {
        server_url: state.zone_server_url.clone(),
        zone_id: req.zone_id,
        instance_id: instance,
        join_token: token::sign(&state.secret, &claims, JOIN_TTL_SECS),
    }))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let prom = telemetry::init("orchestrator");
    let bind = config::env_str("ORCHESTRATOR_BIND", "0.0.0.0:8081");
    let state = Arc::new(AppState {
        secret: config::secret(),
        zone_server_url: config::env_str("ZONE_PUBLIC_URL", "ws://localhost:8082/ws"),
        zones: config::env_str("COMMONS_ZONES", "founders_park")
            .split(',')
            .map(|s| s.trim().to_string())
            .collect(),
    });
    let app = Router::new()
        .route("/api/join", post(join))
        .with_state(state)
        .merge(telemetry::routes(prom));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "orchestrator listening");
    axum::serve(listener, app).await?;
    Ok(())
}
