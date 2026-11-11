//! Fish going off, and the mini fridge that keeps them.
//!
//! A fish keeps a week in your bag; after that it's gone off: a Rotten Fish
//! (sells for 2 coins). Each lot of fish gained (caught, bought, given, out
//! of a tank or the fridge) is timed from when it came (`economy::apply`
//! notes it in `fish_lots`); spending fish uses the oldest first. In a mini
//! fridge (placed at home) fish never go off, up to `PER_FRIDGE` a fridge;
//! taken out, they keep a fresh week from then.
//!
//! Players: `GET /api/fridge` (what's in it, how much it holds, when your
//! bag's fish go off), `POST /api/fridge/put`, `POST /api/fridge/take`.

use crate::AppState;
use crate::economy::{Applied, Op, apply, bearer_player};
use crate::error::{ApiError, ApiResult};
use crate::internal::conflict;
use crate::store::db_err;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgConnection, PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

/// How long a fish keeps out of the fridge (s): a week.
pub const KEEPS_SECS: i64 = 7 * 86_400;
/// How many fish one mini fridge holds.
pub const PER_FRIDGE: i64 = 50;

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/fridge", get(contents))
        .route("/fridge/put", post(put))
        .route("/fridge/take", post(take))
}

fn rotten(state: &AppState) -> ApiResult<i32> {
    state
        .catalog
        .by_key("rotten_fish")
        .map(|i| i.id)
        .ok_or_else(|| conflict("unavailable", "Try again in a moment."))
}

/// Squares `player`'s timed lots with what fish they really hold (the
/// oldest went first when fish were spent; any not timed yet are timed from
/// now), then turns what's been out a week into Rotten Fish. How many went off.
pub async fn settle(conn: &mut PgConnection, state: &AppState, player: Uuid) -> ApiResult<i64> {
    let fish: Vec<i32> = state.catalog.of_kind("fish").map(|i| i.id).collect();
    if fish.is_empty() {
        return Ok(0);
    }
    let held: HashMap<i32, i64> = sqlx::query(
        "SELECT item_id, qty::bigint AS qty FROM inventory WHERE player_id = $1 AND item_id = ANY($2) AND qty > 0",
    )
    .bind(player)
    .bind(&fish)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?
    .iter()
    .map(|r| (r.get("item_id"), r.get("qty")))
    .collect();
    // Newest first: those are the ones still held.
    let lots = sqlx::query(
        "SELECT id, item_id, qty::bigint AS qty FROM fish_lots WHERE player_id = $1 ORDER BY since DESC, id DESC FOR UPDATE",
    )
    .bind(player)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?;
    let mut left = held.clone();
    for r in &lots {
        let (id, item, qty): (i64, i32, i64) = (r.get("id"), r.get("item_id"), r.get("qty"));
        let have = left.entry(item).or_insert(0);
        let keep = qty.min(*have);
        *have -= keep;
        if keep == 0 {
            sqlx::query("DELETE FROM fish_lots WHERE id = $1")
                .bind(id)
                .execute(&mut *conn)
                .await
                .map_err(db_err)?;
        } else if keep < qty {
            sqlx::query("UPDATE fish_lots SET qty = $2 WHERE id = $1")
                .bind(id)
                .bind(keep as i32)
                .execute(&mut *conn)
                .await
                .map_err(db_err)?;
        }
    }
    for (item, n) in left.into_iter().filter(|(_, n)| *n > 0) {
        sqlx::query("INSERT INTO fish_lots (player_id, item_id, qty) VALUES ($1, $2, $3)")
            .bind(player)
            .bind(item)
            .bind(n as i32)
            .execute(&mut *conn)
            .await
            .map_err(db_err)?;
    }
    // Out a week: gone off.
    let old = sqlx::query(
        "DELETE FROM fish_lots WHERE player_id = $1 AND since < now() - make_interval(secs => $2) RETURNING id, item_id, qty::bigint AS qty",
    )
    .bind(player)
    .bind(KEEPS_SECS as f64)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?;
    if old.is_empty() {
        return Ok(0);
    }
    let rot = rotten(state)?;
    let mut total = 0;
    for r in &old {
        let (id, item, qty): (i64, i32, i64) = (r.get("id"), r.get("item_id"), r.get("qty"));
        let n = qty as i32;
        apply(
            conn,
            &state.catalog,
            player,
            &[
                Op { item, delta: -n },
                Op {
                    item: rot,
                    delta: n,
                },
            ],
            "fish_went_off",
            &format!("rot:{id}"),
        )
        .await?;
        total += qty;
    }
    Ok(total)
}

/// Settles `player`'s fish on its own (the bag opened, the market).
pub async fn settle_now(state: &AppState, player: Uuid) -> ApiResult<i64> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let n = settle(&mut tx, state, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(n)
}

/// Every hour: whoever has fish a week out goes off, signed in or not.
pub fn spawn_sweep(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            let who: Vec<Uuid> = sqlx::query_scalar(
                "SELECT DISTINCT player_id FROM fish_lots WHERE since < now() - make_interval(secs => $1)",
            )
            .bind(KEEPS_SECS as f64)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            for p in who {
                if let Err(e) = settle_now(&state, p).await {
                    tracing::warn!(?e, "fish going off");
                }
            }
        }
    });
}

/// How many fish `owner`'s fridges hold (none placed: 0).
async fn room(db: &PgPool, state: &AppState, owner: Uuid) -> ApiResult<i64> {
    let Some(fridge) = state.catalog.by_key("mini_fridge") else {
        return Ok(0);
    };
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM home_objects WHERE owner_id = $1 AND item_id = $2 AND NOT yard",
    )
    .bind(owner)
    .bind(fridge.id)
    .fetch_one(db)
    .await
    .map_err(db_err)?;
    Ok(n * PER_FRIDGE)
}

async fn stored(conn: &mut PgConnection, owner: Uuid) -> ApiResult<Vec<(i32, i32)>> {
    Ok(sqlx::query_as(
        "SELECT item_id, qty FROM fridge_fish WHERE owner_id = $1 AND qty > 0 ORDER BY item_id",
    )
    .bind(owner)
    .fetch_all(conn)
    .await
    .map_err(db_err)?)
}

/// What's in your fridge, how much it holds, and when your bag's fish go off (soonest, by fish).
async fn contents(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let went = settle_now(&state, player).await?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let inside = stored(&mut conn, player).await?;
    let off: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT item_id, extract(epoch FROM min(since))::bigint + $2 FROM fish_lots WHERE player_id = $1 GROUP BY item_id",
    )
    .bind(player)
    .bind(KEEPS_SECS)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({
        "fish": inside.iter().map(|(i, q)| json!({ "item": i, "qty": q })).collect::<Vec<_>>(),
        "room": room(&state.db, &state, player).await?,
        "goes_off": off.iter().map(|(i, at)| json!({ "item": i, "at": at })).collect::<Vec<_>>(),
        "went_off": went,
    })))
}

#[derive(Deserialize)]
struct MoveReq {
    item: i32,
    qty: i32,
    key: String,
}

fn check(state: &AppState, req: &MoveReq) -> ApiResult<()> {
    if !(1..=PER_FRIDGE as i32).contains(&req.qty) || req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request(
            "bad_request",
            "That's not a way to fill a fridge.",
        ));
    }
    if state.catalog.get(req.item).map(|i| i.kind.as_str()) != Some("fish") {
        return Err(ApiError::bad_request(
            "not_fish",
            "Only fish go in the fridge.",
        ));
    }
    Ok(())
}

/// Fish from your bag into your fridge: they keep there.
async fn put(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<MoveReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    check(&state, &req)?;
    let room = room(&state.db, &state, player).await?;
    if room == 0 {
        return Err(conflict(
            "no_fridge",
            "Put a mini fridge in your home first.",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    settle(&mut tx, &state, player).await?;
    let held: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(qty), 0)::bigint FROM fridge_fish WHERE owner_id = $1",
    )
    .bind(player)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if held + req.qty as i64 > room {
        return Err(conflict(
            "fridge_full",
            &format!("Your fridge is full ({held} of {room} fish)."),
        ));
    }
    let applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op {
            item: req.item,
            delta: -req.qty,
        }],
        "fridge_put",
        &format!("fridge:{player}:{}", req.key),
    )
    .await
    .map_err(|e| match e {
        crate::economy::EconError::Insufficient(_) => {
            conflict("not_enough_items", "You don't have that many.")
        }
        e => e.into(),
    })?;
    if !applied.duplicate {
        sqlx::query(
            "INSERT INTO fridge_fish (owner_id, item_id, qty) VALUES ($1, $2, $3)
             ON CONFLICT (owner_id, item_id) DO UPDATE SET qty = fridge_fish.qty + EXCLUDED.qty",
        )
        .bind(player)
        .bind(req.item)
        .bind(req.qty)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        // (The ones that went in were the oldest: the bag's lots square up.)
        settle(&mut tx, &state, player).await?;
    }
    let inside = stored(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        json!({ "applied": applied, "fish": inside.iter().map(|(i, q)| json!({ "item": i, "qty": q })).collect::<Vec<_>>() }),
    ))
}

/// Fish out of your fridge into your bag: a fresh week from now.
async fn take(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<MoveReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    check(&state, &req)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let key = format!("fridge:{player}:{}", req.key);
    if !crate::economy::key_used(&mut tx, &key)
        .await
        .map_err(db_err)?
    {
        let left: Option<i32> = sqlx::query_scalar(
            "UPDATE fridge_fish SET qty = qty - $3 WHERE owner_id = $1 AND item_id = $2 AND qty >= $3 RETURNING qty",
        )
        .bind(player)
        .bind(req.item)
        .bind(req.qty)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        if left.is_none() {
            return Err(conflict(
                "not_enough_items",
                "There aren't that many in the fridge.",
            ));
        }
        sqlx::query("DELETE FROM fridge_fish WHERE owner_id = $1 AND qty <= 0")
            .bind(player)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    let applied: Applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op {
            item: req.item,
            delta: req.qty,
        }],
        "fridge_take",
        &key,
    )
    .await?;
    let inside = stored(&mut tx, player).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(
        json!({ "applied": applied, "fish": inside.iter().map(|(i, q)| json!({ "item": i, "qty": q })).collect::<Vec<_>>() }),
    ))
}
