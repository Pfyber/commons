//! The last mall shops' goods (ADR 0011, M7): tools you're seen using,
//! instruments and toys (your "kit": what the zone lets you play), and how
//! your house looks outside.
//!
//! - Tools: one rod and one watering can in use, saved with your avatar
//!   (`tool`: rod code in the low four bits, can code above). Cosmetic.
//! - Kit: a bit per instrument or toy you own (its `code`), worked out from
//!   your bag whenever the zone asks.
//! - Exterior: per resident (moving house takes it along), one item per
//!   slot (`facade`, `fence`, `yard`, `postbox`), drawn for everyone.
//!
//! `POST /api/me/tool`, `GET /api/exteriors`, `POST /api/me/exterior`.

use crate::AppState;
use crate::economy::{Catalog, bearer_player, totals};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// Item kinds bought once and kept (a second one would do nothing).
pub const ONCE: &[&str] = &["tool", "instrument", "toy", "exterior", "gadget"];

/// Exterior slots.
pub const SLOTS: &[&str] = &["facade", "fence", "yard", "postbox"];

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/me/tool", post(use_tool))
        .route("/exteriors", get(exteriors))
        .route("/me/exterior", post(set_exterior))
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

fn code_of(meta: &serde_json::Value) -> u8 {
    meta["code"].as_u64().unwrap_or(0) as u8
}

async fn owns(state: &AppState, player: Uuid, item: i32) -> ApiResult<bool> {
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    Ok(totals(&mut conn, player, &[item]).await.map_err(db_err)?[0].1 > 0)
}

/// Owned items of `kinds`, as (item, meta).
async fn owned<'a>(
    state: &'a AppState,
    player: Uuid,
    kinds: &[&str],
) -> ApiResult<Vec<&'a crate::economy::Item>> {
    let ids: Vec<i32> =
        sqlx::query_scalar("SELECT item_id FROM inventory WHERE player_id = $1 AND qty > 0")
            .bind(player)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    Ok(ids
        .into_iter()
        .filter_map(|id| state.catalog.get(id))
        .filter(|it| kinds.contains(&it.kind.as_str()))
        .collect())
}

/// The instruments and toys `player` owns: bit `code` set for each.
pub async fn kit(state: &AppState, player: Uuid) -> ApiResult<u32> {
    Ok(owned(state, player, &["instrument", "toy"])
        .await?
        .iter()
        .map(|it| code_of(&it.meta))
        .filter(|&c| c < 32)
        .fold(0, |m, c| m | 1 << c))
}

/// The tools `player` has in use (rod low, can high), dropping any no longer
/// in the bag (given away).
pub async fn tool(state: &AppState, player: Uuid) -> ApiResult<u8> {
    let saved: Option<i64> =
        sqlx::query_scalar("SELECT (avatar->>'tool')::bigint FROM players WHERE id = $1")
            .bind(player)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?
            .flatten();
    let saved = saved.unwrap_or(0) as u8;
    if saved == 0 {
        return Ok(0);
    }
    let have = owned(state, player, &["tool"]).await?;
    let has = |hand: &str, code: u8| {
        code == 0
            || have
                .iter()
                .any(|it| it.meta["tool"] == hand && code_of(&it.meta) == code)
    };
    let (rod, can) = (saved & 0xf, saved >> 4);
    Ok((if has("rod", rod) { rod } else { 0 }) | (if has("can", can) { can } else { 0 }) << 4)
}

#[derive(Deserialize)]
struct ToolReq {
    /// `rod` or `can`.
    hand: String,
    /// The tool to use (0: back to the plain one).
    item: i32,
}

/// Puts a tool you own in use (or goes back to the plain one).
async fn use_tool(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ToolReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    if req.hand != "rod" && req.hand != "can" {
        return Err(ApiError::bad_request("bad_request", "A rod or a can."));
    }
    let code = if req.item == 0 {
        0
    } else {
        let it = state
            .catalog
            .get(req.item)
            .filter(|it| it.kind == "tool" && it.meta["tool"] == req.hand.as_str())
            .ok_or_else(|| ApiError::bad_request("not_a_tool", "That isn't one of those."))?;
        if !owns(&state, player, it.id).await? {
            return Err(conflict("not_yours", "You'd need to buy it first."));
        }
        code_of(&it.meta) & 0xf
    };
    let now = tool(&state, player).await?;
    let next = if req.hand == "rod" {
        (now & 0xf0) | code
    } else {
        (now & 0x0f) | code << 4
    };
    sqlx::query(
        "UPDATE players SET avatar = COALESCE(avatar, '{}'::jsonb)
             || jsonb_build_object('tool', $2::bigint) WHERE id = $1",
    )
    .bind(player)
    .bind(next as i64)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "tool": next })))
}

#[derive(Serialize)]
struct Exterior {
    plot: String,
    /// Slot → the item's code.
    looks: BTreeMap<String, u8>,
}

/// Every house that's been done up: its plot and how it looks.
async fn exteriors(State(state): S) -> ApiResult<Json<serde_json::Value>> {
    let rows: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT l.plot, e.slot, e.item_id FROM home_exterior e
         JOIN leases l ON l.player_id = e.owner AND l.kind = 'home' AND l.state <> 'ended'",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "houses": group(&state.catalog, rows) })))
}

fn group(catalog: &Catalog, rows: Vec<(String, String, i32)>) -> Vec<Exterior> {
    let mut by: BTreeMap<String, BTreeMap<String, u8>> = BTreeMap::new();
    for (plot, slot, item) in rows {
        let code = catalog.get(item).map_or(0, |it| code_of(&it.meta));
        by.entry(plot).or_default().insert(slot, code);
    }
    by.into_iter()
        .map(|(plot, looks)| Exterior { plot, looks })
        .collect()
}

#[derive(Deserialize)]
struct ExteriorReq {
    slot: String,
    /// What to put there (0: back to plain).
    item: i32,
}

/// Does your house up outside (you need a house, and the thing).
async fn set_exterior(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ExteriorReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    if !SLOTS.contains(&req.slot.as_str()) {
        return Err(ApiError::bad_request(
            "bad_request",
            "No such part of a house.",
        ));
    }
    let house: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM leases WHERE player_id = $1 AND kind = 'home' AND state <> 'ended')",
    )
    .bind(player)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    if !house {
        return Err(conflict(
            "no_house",
            "This is for a house: rent one in the home blocks first.",
        ));
    }
    if req.item == 0 {
        sqlx::query("DELETE FROM home_exterior WHERE owner = $1 AND slot = $2")
            .bind(player)
            .bind(&req.slot)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
    } else {
        let it = state
            .catalog
            .get(req.item)
            .filter(|it| it.kind == "exterior" && it.meta["slot"] == req.slot.as_str())
            .ok_or_else(|| ApiError::bad_request("bad_request", "That doesn't go there."))?;
        if !owns(&state, player, it.id).await? {
            return Err(conflict("not_yours", "You'd need to buy it first."));
        }
        sqlx::query(
            "INSERT INTO home_exterior (owner, slot, item_id) VALUES ($1, $2, $3)
             ON CONFLICT (owner, slot) DO UPDATE SET item_id = EXCLUDED.item_id",
        )
        .bind(player)
        .bind(&req.slot)
        .bind(it.id)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    }
    let rows: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT l.plot, e.slot, e.item_id FROM home_exterior e
         JOIN leases l ON l.player_id = e.owner AND l.kind = 'home' AND l.state <> 'ended'
         WHERE e.owner = $1",
    )
    .bind(player)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "house": group(&state.catalog, rows).pop() })))
}
