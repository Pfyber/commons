//! The Commons Mall's shops (ADR 0011): what's on each display, and buying
//! it. Departments, prices and the seasonal calendar come from
//! `assets/mall/` (`commons_sim::mall`); the server checks the item really
//! is on that display, this week, at that price. NPC-run, coins only, and
//! never anything players make themselves.
//!
//! Stock rotates every `COMMONS_MALL_ROTATION_SECS` (a week by default, from
//! Monday 00:00 UTC). Limited items have a shared count per rotation in
//! `mall_stock`, taken in the same transaction as the payment. The pop-up
//! (`popup`) sells the current season's items.
//!
//! `GET /api/mall/stock`, `POST /api/mall/buy`.

use crate::AppState;
use crate::economy::{Applied, COIN, EconError, Op, apply, bearer_player};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Datelike, TimeZone, Utc};
use commons_common::config;
use commons_sim::mall::{
    DEFAULT_ROTATION_SECS, Departments, Event, Events, Shelf, departments, events, rotation_at,
    rotation_ends,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};

type S = State<Arc<AppState>>;

pub static DEPARTMENTS: LazyLock<Departments> = LazyLock::new(departments);
pub static EVENTS: LazyLock<Events> = LazyLock::new(events);

/// Kinds players make themselves: the mall never sells these.
pub const PLAYER_MADE: &[&str] = &["fish", "plant", "junk", "crafted"];

/// The pop-up's key, like a department's.
pub const POPUP: &str = "popup";

fn period() -> i64 {
    config::env_or("COMMONS_MALL_ROTATION_SECS", DEFAULT_ROTATION_SECS).max(60)
}

/// The season on at unix time `t`.
fn event_at(t: i64) -> Option<&'static Event> {
    let d = Utc.timestamp_opt(t, 0).single()?;
    EVENTS.on(d.month(), d.day())
}

/// What one shop (or the pop-up) has on show at unix time `t`.
pub fn shelves(dept: &str, t: i64) -> Vec<Shelf> {
    if dept == POPUP {
        return DEPARTMENTS.popup.stock(event_at(t));
    }
    DEPARTMENTS
        .get(dept)
        .map(|d| d.stock_at(rotation_at(t, period())))
        .unwrap_or_default()
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/mall/stock", get(stock))
        .route("/mall/buy", post(buy))
}

/// Every shop and the pop-up: what's on each display, what's new this
/// rotation, and what's left of limited items.
async fn stock(State(state): S) -> ApiResult<Json<serde_json::Value>> {
    let now = Utc::now().timestamp();
    let p = period();
    let rotation = rotation_at(now, p);
    let left: HashMap<(String, i32), i32> = sqlx::query_as::<_, (String, i32, i32)>(
        "SELECT dept, item_id, remaining FROM mall_stock WHERE rotation = $1",
    )
    .bind(rotation)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?
    .into_iter()
    .map(|(d, i, r)| ((d, i), r))
    .collect();
    let view = |key: &str, name: &str, open: bool| {
        let before: HashSet<String> = shelves(key, now - p).into_iter().map(|s| s.item).collect();
        let on: Vec<_> = shelves(key, now)
            .iter()
            .filter_map(|s| {
                let item = state.catalog.by_key(&s.item)?;
                let left = s
                    .limited
                    .map(|n| left.get(&(key.to_string(), item.id)).copied().unwrap_or(n));
                Some(json!({
                    "slot": s.slot, "item": item.id, "key": item.key, "price": s.price,
                    "limited": s.limited, "left": left, "new": !before.contains(&s.item),
                }))
            })
            .collect();
        json!({ "key": key, "name": name, "open": open && !on.is_empty(), "shelves": on })
    };
    let mut deps: Vec<_> = DEPARTMENTS
        .departments
        .iter()
        .map(|d| view(&d.key, &d.name, d.open))
        .collect();
    let mut popup = view(POPUP, &DEPARTMENTS.popup.name, true);
    let today = Utc::now();
    if let Some(e) = event_at(now) {
        popup["event"] = json!({ "name": e.name, "to": e.to });
    }
    if let Some(e) = EVENTS.next_after(today.month(), today.day()) {
        popup["next"] = json!({ "name": e.name, "from": e.from });
    }
    deps.push(popup);
    Ok(Json(json!({
        "rotation": rotation,
        "ends_at": rotation_ends(rotation, p),
        "departments": deps,
    })))
}

#[derive(Deserialize)]
struct BuyReq {
    dept: String,
    slot: u16,
    /// Client-generated idempotency key (one per button press).
    key: String,
    /// A pet's name, adopting one.
    #[serde(default)]
    name: Option<String>,
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
    if req.dept != POPUP && !DEPARTMENTS.get(&req.dept).is_some_and(|d| d.open) {
        return Err(gone());
    }
    let now = Utc::now().timestamp();
    let rotation = rotation_at(now, period());
    let shelf = shelves(&req.dept, now)
        .into_iter()
        .find(|s| s.slot == req.slot)
        .ok_or_else(gone)?;
    let item = state.catalog.by_key(&shelf.item).ok_or_else(gone)?;
    if PLAYER_MADE.contains(&item.kind.as_str()) {
        return Err(gone());
    }
    let key = format!("mall:{player}:{}", req.key);
    // A pet isn't goods for the bag: it needs a name, and comes home with you.
    let pet = crate::pets::is_pet(&item.kind);
    let pet_name = if pet {
        Some(crate::pets::clean_name(req.name.as_deref().unwrap_or(""))?)
    } else {
        None
    };
    // Things to wear, ride, use and play are bought once and kept (a repeat of the same press is
    // fine: it's answered as a duplicate below).
    if crate::cosmetics::is_cosmetic(&item.kind)
        || crate::vehicles::is_vehicle(&item.kind)
        || crate::goods::ONCE.contains(&item.kind.as_str())
    {
        let mut conn = state.db.acquire().await.map_err(db_err)?;
        let repeat = crate::economy::key_used(&mut conn, &key)
            .await
            .map_err(db_err)?;
        let have = crate::economy::totals(&mut conn, player, &[item.id])
            .await
            .map_err(db_err)?[0]
            .1;
        if have > 0 && !repeat {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "have_it",
                if crate::vehicles::is_vehicle(&item.kind) {
                    "You have this already: ride it from your bag."
                } else if crate::goods::ONCE.contains(&item.kind.as_str()) {
                    "You have this already: it's in your bag."
                } else {
                    "You have this already: it's in your wardrobe."
                },
            ));
        }
    }
    let mut ops = vec![Op {
        item: COIN,
        delta: -shelf.price,
    }];
    if !pet {
        ops.push(Op {
            item: item.id,
            delta: 1,
        });
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let applied = match apply(&mut tx, &state.catalog, player, &ops, "mall_buy", &key).await {
        Ok(a) => a,
        // A repeat of a purchase that's going through right now.
        Err(EconError::Race) => {
            return Ok(Json(Applied {
                duplicate: true,
                ..Default::default()
            }));
        }
        Err(e) => return Err(e.into()),
    };
    if applied.duplicate {
        return Ok(Json(applied));
    }
    if let Some(name) = &pet_name {
        crate::pets::adopt(&mut tx, player, item.id, name).await?;
    }
    // Limited: one fewer to go round this rotation, or none left.
    if let Some(n) = shelf.limited {
        sqlx::query(
            "INSERT INTO mall_stock (rotation, dept, item_id, remaining) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING",
        )
        .bind(rotation)
        .bind(&req.dept)
        .bind(item.id)
        .bind(n)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        let took: Option<i32> = sqlx::query_scalar(
            "UPDATE mall_stock SET remaining = remaining - 1
             WHERE rotation = $1 AND dept = $2 AND item_id = $3 AND remaining > 0
             RETURNING remaining",
        )
        .bind(rotation)
        .bind(&req.dept)
        .bind(item.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        if took.is_none() {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "sold_out",
                "Sold out this week. More next week!",
            ));
        }
    }
    tx.commit().await.map_err(db_err)?;
    Ok(Json(applied))
}
