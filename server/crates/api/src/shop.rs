//! Clothes (the clothes shop and every changing room): what you may wear.
//!
//! Outfits, hats and accessories are catalogue items of kind `clothing`, and
//! owning one means having it in your inventory. The plain tee, no hat and no
//! accessory are free. Whatever you had on before the shop opened is yours to
//! keep: it's recorded the first time you change out of it.

use crate::AppState;
use crate::auth::{Session, bearer, issue_session};
use crate::economy::{COIN, Catalog, EconError, Item, Op, apply, totals};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Looks reserved for non-player characters (protocol `NPC_LOOKS`).
const NPC_LOOKS: [u32; 1] = [0xffff_fff1];

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/me/look", post(set_look))
        .route("/shop/buy", post(buy))
}

/// The look's clothing fields, as (slot, index); see client/src/world/look.ts.
pub fn pieces(look: u32) -> [(&'static str, u32); 3] {
    [
        ("outfit", ((look >> 15) & 1) | (((look >> 30) & 3) << 1)),
        ("hat", (look >> 13) & 3),
        ("accessory", (look >> 27) & 7),
    ]
}

/// The clothing items a look is made of (free pieces have none).
pub fn items_in(catalog: &Catalog, look: u32) -> Vec<&Item> {
    pieces(look)
        .iter()
        .filter_map(|&(slot, index)| {
            catalog.of_kind("clothing").find(|i| {
                i.meta.get("slot").and_then(|v| v.as_str()) == Some(slot)
                    && i.meta.get("index").and_then(|v| v.as_u64()) == Some(index as u64)
            })
        })
        .collect()
}

fn price(item: &Item) -> i64 {
    item.meta.get("price").and_then(|v| v.as_i64()).unwrap_or(0)
}

#[derive(Serialize)]
struct Worn {
    session: Session,
    /// New inventory totals for coins and clothes that changed hands.
    totals: Vec<(i32, i32)>,
}

/// Puts on `look`. Clothes in it you don't own are refused, unless `buy`
/// gives an idempotency key and the total you agreed to pay, in which case
/// they're bought in the same transaction.
async fn wear(
    state: &AppState,
    player: Uuid,
    look: u32,
    buy: Option<(&str, i64)>,
) -> ApiResult<Vec<(i32, i32)>> {
    if NPC_LOOKS.contains(&look) {
        return Err(ApiError::bad_request("bad_look", "That look is taken."));
    }
    let catalog = &state.catalog;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let old: i64 = sqlx::query_scalar(
        "SELECT COALESCE((avatar->>'look')::bigint, 0) FROM players WHERE id = $1 FOR UPDATE",
    )
    .bind(player)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| ApiError::unauthorized("no such player"))?;
    let mut changed = vec![];

    // Keep what you had on.
    let kept: Vec<i32> = items_in(catalog, old as u32).iter().map(|i| i.id).collect();
    for (item, qty) in totals(&mut tx, player, &kept).await.map_err(db_err)? {
        if qty == 0 {
            let ops = [Op { item, delta: 1 }];
            let key = format!("kept:{player}:{item}");
            let r = apply(&mut tx, catalog, player, &ops, "clothes_kept", &key).await?;
            changed.extend(r.totals);
        }
    }

    let wanted: Vec<&Item> = items_in(catalog, look);
    let ids: Vec<i32> = wanted.iter().map(|i| i.id).collect();
    let have = totals(&mut tx, player, &ids).await.map_err(db_err)?;
    let missing: Vec<&Item> = wanted
        .into_iter()
        .filter(|i| have.iter().any(|&(id, q)| id == i.id && q == 0))
        .collect();
    if !missing.is_empty() {
        let names = missing.iter().map(|i| i.name.as_str()).collect::<Vec<_>>();
        let Some((key, expect)) = buy else {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "not_owned",
                format!("You don't have the {} yet: the clothes shop does.", names.join(" or ")),
            ));
        };
        let total: i64 = missing.iter().map(|i| price(i)).sum();
        if total != expect {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "price_changed",
                "The prices have changed. Take another look?",
            ));
        }
        let mut ops = vec![Op {
            item: COIN,
            delta: -(total as i32),
        }];
        ops.extend(missing.iter().map(|i| Op { item: i.id, delta: 1 }));
        let key = format!("shop:{player}:{key}");
        let r = match apply(&mut tx, catalog, player, &ops, "clothes_shop", &key).await {
            Err(EconError::Race) => {
                return Err(ApiError::new(StatusCode::CONFLICT, "retry", "Please try again."));
            }
            r => r?,
        };
        changed.extend(r.totals);
    }

    sqlx::query(
        "UPDATE players SET avatar = jsonb_set(COALESCE(avatar, '{}'::jsonb), '{look}', to_jsonb($2::bigint)) WHERE id = $1",
    )
    .bind(player)
    .bind(look as i64)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(changed)
}

/// Saves the look and returns a fresh session carrying it, so the next zone
/// you join already shows it.
async fn worn(state: &AppState, sub: &str, totals: Vec<(i32, i32)>) -> ApiResult<Json<Worn>> {
    let p = state
        .store
        .player(sub)
        .await?
        .ok_or_else(|| ApiError::unauthorized("no such player"))?;
    Ok(Json(Worn {
        session: issue_session(state, &p).await?,
        totals,
    }))
}

#[derive(Deserialize)]
struct LookReq {
    look: u32,
}

/// A changing room: wear clothes you own.
async fn set_look(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<LookReq>,
) -> ApiResult<Json<Worn>> {
    let who = bearer(&state, &headers)?;
    let player =
        Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    let totals = wear(&state, player, req.look, None).await?;
    worn(&state, &who.sub, totals).await
}

#[derive(Deserialize)]
struct BuyReq {
    look: u32,
    /// The total shown at the counter; refused if the prices have changed.
    price: i64,
    /// Client-generated idempotency key (one per purchase).
    key: String,
}

/// The clothes shop's counter: buy what you tried on and wear it.
async fn buy(State(state): S, headers: HeaderMap, Json(req): Json<BuyReq>) -> ApiResult<Json<Worn>> {
    let who = bearer(&state, &headers)?;
    let player =
        Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    if req.key.is_empty() || req.key.len() > 80 || req.price < 0 {
        return Err(ApiError::bad_request("bad_request", "Invalid purchase."));
    }
    let totals = wear(&state, player, req.look, Some((&req.key, req.price))).await?;
    worn(&state, &who.sub, totals).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pieces_match_the_client_encoding() {
        // Outfit 6 (bits 15 and 30–31), hat 2 (bits 13–14), accessory 1 (27–29).
        let look = (0b11u32 << 30) | (2 << 13) | (1 << 27);
        assert_eq!(pieces(look), [("outfit", 6), ("hat", 2), ("accessory", 1)]);
        assert_eq!(pieces(1 << 15), [("outfit", 1), ("hat", 0), ("accessory", 0)]);
    }
}
