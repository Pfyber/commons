//! The arcade's prize counter: tickets won at the cabinets (`arcade::TICKET`)
//! traded for prizes. Prizes are things from the mall (toys, a few things to
//! wear, gift wrapping); things kept for good can only be won once.
//!
//! `GET /api/arcade/prizes`, `POST /api/arcade/redeem`.

use crate::AppState;
use crate::economy::{EconError, Op, apply, bearer_player, totals};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

type S = State<Arc<AppState>>;

/// The arcade's tickets (item id, as in the protocol's `arcade::TICKET`).
pub const TICKET: i32 = 900;

/// What's on the prize shelf: item key and its price in tickets.
pub const PRIZES: &[(&str, i32)] = &[
    ("birthday_card", 10),
    ("polka_wrap", 15),
    ("pinwheel", 60),
    ("yo_yo", 75),
    ("beanie", 90),
    ("bow_tie", 90),
    ("bubble_wand", 100),
    ("sun_hat", 120),
    ("satchel", 150),
    ("kite", 220),
];

/// Kinds kept for good: won once.
fn kept(kind: &str) -> bool {
    crate::cosmetics::is_cosmetic(kind) || crate::goods::ONCE.contains(&kind)
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/arcade/prizes", get(prizes))
        .route("/arcade/redeem", post(redeem))
}

/// The prize shelf: each prize's item and price in tickets.
async fn prizes(State(state): S) -> Json<serde_json::Value> {
    let list: Vec<_> = PRIZES
        .iter()
        .filter_map(|&(key, tickets)| {
            let it = state.catalog.by_key(key)?;
            Some(json!({ "item": it.id, "tickets": tickets, "once": kept(&it.kind) }))
        })
        .collect();
    Json(json!({ "ticket": TICKET, "prizes": list }))
}

#[derive(Deserialize)]
struct RedeemReq {
    item: i32,
    /// Client-generated idempotency key (one per press).
    key: String,
}

/// Trades tickets for a prize.
async fn redeem(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<RedeemReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    if req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid request."));
    }
    let (item, cost) = PRIZES
        .iter()
        .find_map(|&(key, tickets)| {
            state
                .catalog
                .by_key(key)
                .filter(|it| it.id == req.item)
                .map(|it| (it, tickets))
        })
        .ok_or_else(|| ApiError::bad_request("not_a_prize", "That's not on the prize shelf."))?;
    let key = format!("prize:{player}:{}", req.key);
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if kept(&item.kind)
        && !crate::economy::key_used(&mut tx, &key)
            .await
            .map_err(db_err)?
    {
        let have = totals(&mut tx, player, &[item.id]).await.map_err(db_err)?;
        if have.first().is_some_and(|&(_, q)| q > 0) {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "owned",
                "You've got that one already.",
            ));
        }
    }
    let ops = [
        Op {
            item: TICKET,
            delta: -cost,
        },
        Op {
            item: item.id,
            delta: 1,
        },
    ];
    let applied = match apply(&mut tx, &state.catalog, player, &ops, "arcade_prize", &key).await {
        Err(EconError::Insufficient(_)) => {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "not_enough_tickets",
                "Not enough tickets yet.",
            ));
        }
        Err(EconError::Race) => {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "retry",
                "Please try again.",
            ));
        }
        r => r?,
    };
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "applied": applied })))
}
