//! Home comforts over the API: how a room looks (wallpaper, flooring, any
//! colour) and the laptop's drone delivery. Anything the mall or the market
//! sells can be ordered for a flat fee; the money goes now, and the parcel
//! lands on your doorstep a little later for you to pick up.
//!
//! `GET /api/home/look/{owner}`, `POST /api/home/look`, `GET /api/drone/catalog`,
//! `POST /api/drone/order`, `GET /api/drone/parcels`, `POST /api/drone/claim`.

use crate::AppState;
use crate::economy::{Applied, COIN, Op, apply, bearer_player, key_used, totals};
use crate::error::{ApiError, ApiResult};
use crate::internal::{conflict, uuid};
use crate::mall::{DEPARTMENTS, PLAYER_MADE};
use crate::store::db_err;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// What a delivery costs on top of the goods.
pub const DRONE_FEE: i32 = 30;
/// How long the drone takes from the Market to your door.
const FLIGHT_SECS: i32 = 40;
/// The most of one thing a drone can carry.
const MAX_QTY: i32 = 20;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/home/look/{owner}", get(look))
        .route("/home/look", post(set_look))
        .route("/drone/catalog", get(catalog))
        .route("/drone/order", post(order))
        .route("/drone/parcels", get(parcels))
        .route("/drone/claim", post(claim))
}

#[derive(Serialize, Deserialize, Default)]
struct Look {
    wall: i32,
    wall_color: i32,
    floor: i32,
    floor_color: i32,
}

async fn look(State(state): S, Path(owner): Path<String>) -> ApiResult<Json<Look>> {
    let owner = uuid(&owner)?;
    let row: Option<(i32, i32, i32, i32)> = sqlx::query_as(
        "SELECT wall_item, wall_color, floor_item, floor_color FROM home_looks WHERE owner_id = $1",
    )
    .bind(owner)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let (wall, wall_color, floor, floor_color) = row.unwrap_or((0, -1, 0, -1));
    Ok(Json(Look {
        wall,
        wall_color,
        floor,
        floor_color,
    }))
}

/// Skins stay yours once bought: wearing one on the walls needs only that you have it.
async fn set_look(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<Look>,
) -> ApiResult<Json<Look>> {
    let player = bearer_player(&state, &headers)?;
    let bad = || ApiError::bad_request("bad_look", "That doesn't go there.");
    for (item, part) in [(req.wall, "wall"), (req.floor, "floor")] {
        if item == 0 {
            continue;
        }
        let it = state.catalog.get(item).ok_or_else(bad)?;
        if it.meta.get("skin").and_then(|v| v.as_str()) != Some(part) {
            return Err(bad());
        }
    }
    for c in [req.wall_color, req.floor_color] {
        if !(-1..=0xff_ffff).contains(&c) {
            return Err(bad());
        }
    }
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    for (item, have) in totals(&mut conn, player, &[req.wall, req.floor])
        .await
        .map_err(db_err)?
    {
        if item != 0 && have <= 0 {
            return Err(conflict("not_enough_items", "You don't have that skin."));
        }
    }
    sqlx::query(
        "INSERT INTO home_looks (owner_id, wall_item, wall_color, floor_item, floor_color) VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (owner_id) DO UPDATE SET wall_item = $2, wall_color = $3, floor_item = $4, floor_color = $5",
    )
    .bind(player)
    .bind(req.wall)
    .bind(req.wall_color)
    .bind(req.floor)
    .bind(req.floor_color)
    .execute(&mut *conn)
    .await
    .map_err(db_err)?;
    Ok(Json(req))
}

/// Everything a drone can bring: item → price. Every shop's whole catalogue
/// (limited pieces stay in the shops), then the market's own goods.
fn drone_prices(state: &AppState) -> HashMap<i32, i32> {
    let mut prices = HashMap::new();
    for e in DEPARTMENTS
        .departments
        .iter()
        .filter(|d| d.open)
        .flat_map(|d| &d.catalog)
        .filter(|e| e.limited.is_none())
    {
        let Some(it) = state.catalog.by_key(&e.item) else {
            continue;
        };
        if PLAYER_MADE.contains(&it.kind.as_str())
            || crate::pets::is_pet(&it.kind)
            || it.kind == "gadget"
        {
            continue;
        }
        prices.insert(it.id, e.price);
    }
    for it in &state.catalog.items {
        if it.meta.get("market").is_some()
            && let Some(p) = it.buy()
        {
            prices.entry(it.id).or_insert(p as i32);
        }
    }
    prices
}

async fn catalog(State(state): S) -> ApiResult<Json<serde_json::Value>> {
    let mut items: Vec<_> = drone_prices(&state)
        .into_iter()
        .map(|(item, price)| json!({ "item": item, "price": price }))
        .collect();
    items.sort_by_key(|i| i["item"].as_i64());
    Ok(Json(json!({ "fee": DRONE_FEE, "items": items })))
}

#[derive(Deserialize)]
struct OrderReq {
    item: i32,
    qty: i32,
    key: String,
}

async fn order(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<OrderReq>,
) -> ApiResult<Json<Applied>> {
    let player = bearer_player(&state, &headers)?;
    if req.key.is_empty() || req.key.len() > 80 || !(1..=MAX_QTY).contains(&req.qty) {
        return Err(ApiError::bad_request("bad_request", "Invalid order."));
    }
    let price = *drone_prices(&state)
        .get(&req.item)
        .ok_or_else(|| ApiError::bad_request("not_sold", "The drone can't bring that."))?;
    let it = state
        .catalog
        .get(req.item)
        .ok_or_else(|| ApiError::bad_request("not_sold", "The drone can't bring that."))?;
    let key = format!("drone:{player}:{}", req.key);
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let repeat = key_used(&mut tx, &key).await.map_err(db_err)?;
    // Things you keep for good: one each, in your bag or on its way.
    if !repeat
        && (crate::cosmetics::is_cosmetic(&it.kind)
            || crate::vehicles::is_vehicle(&it.kind)
            || crate::goods::ONCE.contains(&it.kind.as_str()))
    {
        let have = totals(&mut tx, player, &[it.id]).await.map_err(db_err)?[0].1;
        let coming: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM drone_parcels WHERE owner_id = $1 AND item_id = $2 AND NOT claimed)",
        )
        .bind(player)
        .bind(it.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if have > 0 || coming || req.qty > 1 {
            return Err(conflict("have_it", "You only need one of those."));
        }
    }
    let applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op {
            item: COIN,
            delta: -(price * req.qty + DRONE_FEE),
        }],
        "drone_order",
        &key,
    )
    .await?;
    if !repeat {
        sqlx::query(
            "INSERT INTO drone_parcels (owner_id, item_id, qty, ready_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))",
        )
        .bind(player)
        .bind(req.item)
        .bind(req.qty)
        .bind(FLIGHT_SECS as f64)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)?;
    Ok(Json(applied))
}

async fn parcels(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let rows = sqlx::query(
        "SELECT id, item_id, qty, extract(epoch FROM ordered_at)::bigint AS ordered, \
         extract(epoch FROM ready_at)::bigint AS ready FROM drone_parcels \
         WHERE owner_id = $1 AND NOT claimed ORDER BY ordered_at",
    )
    .bind(player)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let parcels: Vec<_> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id"), "item": r.get::<i32, _>("item_id"), "qty": r.get::<i32, _>("qty"),
                "ordered": r.get::<i64, _>("ordered"), "ready": r.get::<i64, _>("ready"),
            })
        })
        .collect();
    Ok(Json(
        json!({ "parcels": parcels, "now": chrono::Utc::now().timestamp() }),
    ))
}

#[derive(Deserialize)]
struct ClaimReq {
    id: Uuid,
}

async fn claim(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ClaimReq>,
) -> ApiResult<Json<Applied>> {
    let player = bearer_player(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let got: Option<(i32, i32)> = sqlx::query_as(
        "UPDATE drone_parcels SET claimed = true WHERE id = $1 AND owner_id = $2 AND NOT claimed AND ready_at <= now() RETURNING item_id, qty",
    )
    .bind(req.id)
    .bind(player)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (item, qty) = got.ok_or_else(|| conflict("empty", "There's no parcel for you there."))?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op { item, delta: qty }],
        "drone_claim",
        &format!("drone_claim:{}", req.id),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(applied))
}
