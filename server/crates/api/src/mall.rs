//! The Commons Mall's shops (ADR 0011): what's on each display, and buying
//! it. Departments and prices come from `assets/mall/departments.json`
//! (`commons_sim::mall`); the server checks the item really is on that
//! display at that price. NPC-run, coins only, and never anything players
//! make themselves.
//!
//! `GET /api/mall/stock`, `POST /api/mall/buy`.

use crate::AppState;
use crate::economy::{Applied, COIN, Op, apply_tx, bearer_player};
use crate::error::{ApiError, ApiResult};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_sim::mall::{Departments, departments};
use serde::Deserialize;
use serde_json::json;
use std::sync::{Arc, LazyLock};

type S = State<Arc<AppState>>;

pub static DEPARTMENTS: LazyLock<Departments> = LazyLock::new(departments);

/// Kinds players make themselves: the mall never sells these.
pub const PLAYER_MADE: &[&str] = &["fish", "plant", "junk", "crafted"];

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/mall/stock", get(stock))
        .route("/mall/buy", post(buy))
}

/// Every department and what's on its displays.
async fn stock(State(state): S) -> Json<serde_json::Value> {
    let deps: Vec<_> = DEPARTMENTS
        .departments
        .iter()
        .map(|d| {
            let shelves: Vec<_> = d
                .stock()
                .iter()
                .filter_map(|s| {
                    let item = state.catalog.by_key(&s.item)?;
                    Some(json!({ "slot": s.slot, "item": item.id, "key": item.key, "price": s.price }))
                })
                .collect();
            json!({ "key": d.key, "name": d.name, "open": d.open, "shelves": shelves })
        })
        .collect();
    Json(json!({ "departments": deps }))
}

#[derive(Deserialize)]
struct BuyReq {
    dept: String,
    slot: u16,
    /// Client-generated idempotency key (one per button press).
    key: String,
}

async fn buy(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<BuyReq>,
) -> ApiResult<Json<Applied>> {
    let player = bearer_player(&state, &headers)?;
    if req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid purchase."));
    }
    let gone = || ApiError::bad_request("not_on_show", "That isn't on show any more.");
    let dept = DEPARTMENTS
        .get(&req.dept)
        .filter(|d| d.open)
        .ok_or_else(gone)?;
    let shelf = dept
        .stock()
        .into_iter()
        .find(|s| s.slot == req.slot)
        .ok_or_else(gone)?;
    let item = state.catalog.by_key(&shelf.item).ok_or_else(gone)?;
    if PLAYER_MADE.contains(&item.kind.as_str()) {
        return Err(gone());
    }
    let ops = [
        Op {
            item: COIN,
            delta: -shelf.price,
        },
        Op {
            item: item.id,
            delta: 1,
        },
    ];
    let key = format!("mall:{player}:{}", req.key);
    Ok(Json(
        apply_tx(&state.db, &state.catalog, player, &ops, "mall_buy", &key).await?,
    ))
}
