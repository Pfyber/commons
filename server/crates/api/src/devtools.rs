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
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// Coins from one wish at the well (testing).
pub const WELL_COINS: i32 = 10_000;
/// How many taps on the well, how quickly, before it grants anything.
pub const WELL_TAPS: usize = 5;
pub const WELL_WINDOW: Duration = Duration::from_secs(2);

/// Each player's latest taps on the well.
static TAPS: LazyLock<Mutex<HashMap<Uuid, VecDeque<Instant>>>> = LazyLock::new(Default::default);

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/dev/well", post(well))
}

fn not_here() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "not_found", "Nothing here.")
}

/// A tap on the wishing well: tapped `WELL_TAPS` times within `WELL_WINDOW`,
/// a wish, 10,000 coins (dev mode only). Whether it granted, and how many taps so far.
async fn well(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    if !state.dev {
        return Err(not_here());
    }
    let player = bearer_player(&state, &headers)?;
    let taps = {
        let mut all = TAPS.lock().unwrap();
        let now = Instant::now();
        all.retain(|_, t| {
            t.back()
                .is_some_and(|&at| now.duration_since(at) < WELL_WINDOW)
        });
        let mine = all.entry(player).or_default();
        while mine
            .front()
            .is_some_and(|&at| now.duration_since(at) >= WELL_WINDOW)
        {
            mine.pop_front();
        }
        mine.push_back(now);
        let n = mine.len();
        if n >= WELL_TAPS {
            mine.clear();
        }
        n
    };
    if taps < WELL_TAPS {
        return Ok(Json(serde_json::json!({ "granted": false, "taps": taps })));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let ops = [Op {
        item: COIN,
        delta: WELL_COINS,
    }];
    let key = format!("devwell:{player}:{}", Uuid::new_v4());
    let applied = apply(&mut tx, &state.catalog, player, &ops, "dev_well", &key).await?;
    tx.commit().await.map_err(db_err)?;
    tracing::info!(%player, coins = WELL_COINS, "dev: a wish at the well");
    Ok(Json(
        serde_json::json!({ "granted": true, "taps": taps, "applied": applied }),
    ))
}
