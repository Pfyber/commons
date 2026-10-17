//! Vehicles (ADR 0011, M6): skates, a scooter, bikes. Bought at the mall's
//! Vehicles shop and kept (account-bound); riding one is a speed-up anywhere
//! outdoors in the city, and you get off at every door. In the shop, anything
//! on show can be test-ridden on the track without buying it. What you're
//! riding is saved with your avatar (`ride`: the vehicle's code, with
//! `TEST_RIDE` for a test ride); the zone reads it from `/internal/look` and
//! decides where it applies.
//!
//! `GET /api/me/ride`, `POST /api/me/ride`.

use crate::AppState;
use crate::economy::{bearer_player, totals};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use commons_sim::vehicles::{TEST_RIDE, speed_x10};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// The mall shop with the test track.
pub const DEPT: &str = "vehicles";

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/me/ride", get(current).post(ride))
}

/// Is this item a vehicle?
pub fn is_vehicle(kind: &str) -> bool {
    kind == "vehicle"
}

/// What `player` is riding (its code, `TEST_RIDE` on a test ride), 0 for
/// nothing.
pub async fn riding(state: &AppState, player: Uuid) -> ApiResult<u8> {
    let r: Option<i64> =
        sqlx::query_scalar("SELECT (avatar->>'ride')::bigint FROM players WHERE id = $1")
            .bind(player)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?
            .flatten();
    Ok(r.unwrap_or(0) as u8)
}

async fn current(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    Ok(Json(json!({ "ride": riding(&state, player).await? })))
}

#[derive(Deserialize)]
struct RideReq {
    /// The vehicle's item (0: get off).
    item: i32,
    /// A test ride on the mall's track (anything on show there).
    #[serde(default)]
    test: bool,
}

/// Gets on a vehicle you own (or one on show, for a test ride), or off.
async fn ride(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<RideReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let code = if req.item == 0 {
        0
    } else {
        let it = state
            .catalog
            .get(req.item)
            .filter(|it| is_vehicle(&it.kind))
            .ok_or_else(|| {
                ApiError::bad_request("not_a_vehicle", "That isn't something to ride.")
            })?;
        let code = it.meta["code"].as_u64().unwrap_or(0) as u8;
        if speed_x10(code).is_none() {
            return Err(ApiError::bad_request(
                "not_a_vehicle",
                "That isn't something to ride.",
            ));
        }
        if req.test {
            let on_show = crate::mall::shelves(DEPT, Utc::now().timestamp())
                .iter()
                .any(|s| s.item == it.key);
            if !on_show {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "not_on_show",
                    "That one isn't in the shop this week.",
                ));
            }
            code | TEST_RIDE
        } else {
            let mut conn = state.db.acquire().await.map_err(db_err)?;
            let have = totals(&mut conn, player, &[it.id]).await.map_err(db_err)?[0].1;
            if have < 1 {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "not_yours",
                    "You'd need to buy it first (or take it for a test ride in the shop).",
                ));
            }
            code
        }
    };
    sqlx::query(
        "UPDATE players SET avatar = COALESCE(avatar, '{}'::jsonb)
             || jsonb_build_object('ride', $2::bigint) WHERE id = $1",
    )
    .bind(player)
    .bind(code as i64)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "ride": code })))
}
