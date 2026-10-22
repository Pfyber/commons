//! Testing helpers, only in dev mode (`COMMONS_DEV`): on a real server these
//! routes don't exist (404).
//!
//! - `POST /api/dev/well`: the wishing well grants 10,000 coins, every time.

use crate::AppState;
use crate::economy::{Applied, COIN, Op, apply, bearer_player};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// Coins from one wish at the well (testing).
pub const WELL_COINS: i32 = 10_000;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/dev/well", post(well))
}

fn not_here() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "not_found", "Nothing here.")
}

/// A wish at the wishing well: 10,000 coins (dev mode only).
async fn well(State(state): S, headers: HeaderMap) -> ApiResult<Json<Applied>> {
    if !state.dev {
        return Err(not_here());
    }
    let player = bearer_player(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let ops = [Op {
        item: COIN,
        delta: WELL_COINS,
    }];
    let key = format!("devwell:{player}:{}", Uuid::new_v4());
    let applied = apply(&mut tx, &state.catalog, player, &ops, "dev_well", &key).await?;
    tx.commit().await.map_err(db_err)?;
    tracing::info!(%player, coins = WELL_COINS, "dev: a wish at the well");
    Ok(Json(applied))
}
