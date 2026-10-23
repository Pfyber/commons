//! Market stalls (ADR 0010, C4): rent a stall in the Market and put goods
//! from your bag on show at your own price; anyone can buy them. Goods leave
//! the seller's bag while on show and come back if taken down or when the
//! stall's lease ends. Coins only.
//!
//! A house has a yard stand too, by its front door: the same goods on show,
//! on the home lease (up to its tier's `listings`). Apartments have no yard.
//!
//! Players: `GET /api/social/stalls`, `GET /api/social/yards`,
//! `POST /api/social/stalls/{claim,put,take,buy}` (`put` with `at: "yard"`
//! for the yard stand).

use crate::State as SocialState;
use crate::rent::{self, lease_of, open_leases};
use crate::routes::{db_err, me, notify};
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use commons_api::economy::{COIN, EconError, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_sim::city::plot_kind;
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

/// Every house's yard stand that has something on it: whose, and what.
pub async fn yards(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let leases = open_leases(&state.db, &["home"]).await.map_err(db_err)?;
    let goods = sqlx::query(
        "SELECT s.id, s.lease_id, s.item_id, s.qty, s.price FROM stall_listings s
         JOIN leases l ON l.id = s.lease_id
         WHERE l.state <> 'ended' AND l.kind = 'home' ORDER BY s.id",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let yards: Vec<_> = leases
        .iter()
        .filter_map(|(l, name)| {
            let on: Vec<_> = goods
                .iter()
                .filter(|g| g.get::<i64, _>("lease_id") == l.id)
                .map(|g| {
                    json!({ "id": g.get::<i64, _>("id"), "item": g.get::<i32, _>("item_id"),
                            "qty": g.get::<i32, _>("qty"), "price": g.get::<i32, _>("price") })
                })
                .collect();
            (!on.is_empty() || l.player == me).then(|| {
                json!({ "lot": l.plot, "owner": l.player.to_string(), "name": name,
                        "mine": l.player == me, "listings": l.tier_info().listings, "goods": on })
            })
        })
        .collect();
    Ok(Json(json!({ "yards": yards })))
}

/// Every stall: who has it and what's on it.
pub async fn list(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let leases = open_leases(&state.db, &["stall"]).await.map_err(db_err)?;
    let goods = sqlx::query(
        "SELECT s.id, s.lease_id, s.item_id, s.qty, s.price FROM stall_listings s
         JOIN leases l ON l.id = s.lease_id WHERE l.state <> 'ended' ORDER BY s.id",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let stalls: Vec<_> = leases
        .iter()
        .map(|(l, name)| {
            let on: Vec<_> = goods
                .iter()
                .filter(|g| g.get::<i64, _>("lease_id") == l.id)
                .map(|g| {
                    json!({ "id": g.get::<i64, _>("id"), "item": g.get::<i32, _>("item_id"),
                            "qty": g.get::<i32, _>("qty"), "price": g.get::<i32, _>("price") })
                })
                .collect();
            json!({ "stall": l.plot, "owner": l.player.to_string(), "name": name,
                    "mine": l.player == me, "lease": l.json(), "goods": on })
        })
        .collect();
    Ok(Json(json!({ "stalls": stalls })))
}

#[derive(Deserialize)]
pub struct ClaimReq {
    stall: String,
    #[serde(default = "first")]
    tier: i16,
}

fn first() -> i16 {
    1
}

pub async fn claim(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ClaimReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    if plot_kind(&req.stall) != Some("stall") {
        return Err(ApiError::bad_request(
            "bad_stall",
            "There's no stall there.",
        ));
    }
    let lease = rent::open(&state, me, "stall", &req.stall, req.tier).await?;
    Ok(Json(json!({ "lease": lease.json() })))
}

#[derive(Deserialize)]
pub struct ListReq {
    item: i32,
    qty: i32,
    price: i32,
    key: String,
    /// "stall" (your market stall, the default) or "yard" (your house's yard stand).
    #[serde(default)]
    at: Option<String>,
}

/// Puts goods from your bag on your stall.
pub async fn put(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ListReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    if !(1..=99).contains(&req.qty) || !(1..=9999).contains(&req.price) || req.key.len() > 80 {
        return Err(ApiError::bad_request(
            "bad_listing",
            "Between 1 and 99 of something, at 1 to 9999 coins each.",
        ));
    }
    // Coins aren't goods, and account-bound things are yours to keep.
    if req.item == COIN
        || state
            .catalog
            .get(req.item)
            .is_none_or(|i| i.account_bound())
    {
        return Err(ApiError::bad_request("bad_item", "That can't be sold."));
    }
    let lease = if req.at.as_deref() == Some("yard") {
        lease_of(&state.db, me, "home")
            .await
            .map_err(db_err)?
            .filter(|l| l.kind == "home")
            .ok_or_else(|| {
                conflict(
                    "no_yard",
                    "A yard stand stands in front of a house; apartments have no yard.",
                )
            })?
    } else {
        lease_of(&state.db, me, "stall")
            .await
            .map_err(db_err)?
            .ok_or_else(|| conflict("no_stall", "Rent a stall first."))?
    };
    let mut tx = state.db.begin().await.map_err(db_err)?;
    // Lock the lease so two listings can't both squeeze into the last place.
    sqlx::query("SELECT id FROM leases WHERE id = $1 FOR UPDATE")
        .bind(lease.id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let on: i64 = sqlx::query_scalar("SELECT count(*) FROM stall_listings WHERE lease_id = $1")
        .bind(lease.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    let cap = lease.tier_info().listings.unwrap_or(0);
    if on >= cap {
        let what = if lease.kind == "home" {
            format!("{}'s yard stand", lease.tier_info().name)
        } else {
            lease.tier_info().name.clone()
        };
        return Err(conflict(
            "stall_full",
            &format!("Your {what} has room for {cap} things."),
        ));
    }
    let applied = apply(
        &mut tx,
        &state.catalog,
        me,
        &[Op {
            item: req.item,
            delta: -req.qty,
        }],
        "stall_put",
        &format!("stall_put:{me}:{}", req.key),
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => conflict("not_enough_items", "You don't have that many."),
        e => e.into(),
    })?;
    if !applied.duplicate {
        sqlx::query(
            "INSERT INTO stall_listings (lease_id, item_id, qty, price) VALUES ($1, $2, $3, $4)",
        )
        .bind(lease.id)
        .bind(req.item)
        .bind(req.qty)
        .bind(req.price)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct IdReq {
    id: i64,
}

/// Takes goods off your stall, back into your bag.
pub async fn take(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let row = sqlx::query(
        "DELETE FROM stall_listings s USING leases l
         WHERE s.id = $1 AND l.id = s.lease_id AND l.player_id = $2
         RETURNING s.item_id, s.qty",
    )
    .bind(req.id)
    .bind(me)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| conflict("gone", "That's not on your stall."))?;
    apply(
        &mut tx,
        &state.catalog,
        me,
        &[Op {
            item: row.get("item_id"),
            delta: row.get("qty"),
        }],
        "stall_take",
        &format!("stall_take:{}", req.id),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct BuyReq {
    id: i64,
    qty: i32,
    key: String,
}

/// Buys goods off someone's stall: coins to them, goods to you, at once.
pub async fn buy(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<BuyReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, claims) = me(&state, &headers)?;
    if req.qty < 1 || req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_buy", "How many?"));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let row = sqlx::query(
        "SELECT s.item_id, s.qty, s.price, l.player_id FROM stall_listings s
         JOIN leases l ON l.id = s.lease_id
         WHERE s.id = $1 AND l.state <> 'ended' FOR UPDATE OF s",
    )
    .bind(req.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| conflict("gone", "Someone has just bought that."))?;
    let (item, have, price, seller): (i32, i32, i32, Uuid) = (
        row.get("item_id"),
        row.get("qty"),
        row.get("price"),
        row.get("player_id"),
    );
    if seller == me {
        return Err(conflict("own_stall", "That's your own stall."));
    }
    if req.qty > have {
        return Err(conflict("not_that_many", "There aren't that many left."));
    }
    let total = price * req.qty;
    let key = format!("stall_buy:{me}:{}", req.key);
    let bought = apply(
        &mut tx,
        &state.catalog,
        me,
        &[
            Op {
                item: COIN,
                delta: -total,
            },
            Op {
                item,
                delta: req.qty,
            },
        ],
        "stall_buy",
        &key,
    )
    .await?;
    if bought.duplicate {
        return Ok(Json(json!({ "ok": true, "duplicate": true })));
    }
    apply(
        &mut tx,
        &state.catalog,
        seller,
        &[Op {
            item: COIN,
            delta: total,
        }],
        "stall_sale",
        &format!("{key}:seller"),
    )
    .await?;
    // The last of them: the listing goes (a count of 0 isn't allowed).
    if req.qty == have {
        sqlx::query("DELETE FROM stall_listings WHERE id = $1")
            .bind(req.id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    } else {
        sqlx::query("UPDATE stall_listings SET qty = qty - $2 WHERE id = $1")
            .bind(req.id)
            .bind(req.qty)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)?;
    let what = state
        .catalog
        .get(item)
        .map(|i| i.name.clone())
        .unwrap_or_default();
    notify(
        &state,
        seller,
        "stall_sale",
        json!({ "buyer": claims.name, "item": item, "what": what, "qty": req.qty, "coins": total }),
    )
    .await;
    Ok(Json(json!({ "ok": true, "totals": bought.totals })))
}
