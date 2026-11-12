//! The fisherman's daily order: every `PERIOD_SECS` (20 hours) he asks each
//! angler for three particular fish, some of them more than once (a couple
//! of an uncommon one, one or more of something rarer, one of the very rare).
//! Bring them to him and he pays three times what he'd give for them
//! otherwise; the order fills as you do. Which fish is drawn from the angler
//! and the period (the same all period, different for everyone); what's been
//! handed in is kept in `fish_quests`.
//!
//! He has a second order, apart from the first, for what the magnet brings
//! up: its own three things, its own progress, paid the same.
//!
//! `GET /api/fisherman/quest`, `POST /api/fisherman/quest/deliver`;
//! `GET /api/fisherman/magnet-quest`, `POST /api/fisherman/magnet-quest/deliver`.

use crate::AppState;
use crate::economy::{Applied, COIN, EconError, Op, apply, bearer_player, key_used};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// How long an order lasts.
pub const PERIOD_SECS: i64 = 20 * 3600;
/// What he pays for an ordered fish, over its usual price.
pub const PAY_TIMES: i64 = 3;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/fisherman/quest", get(quest))
        .route("/fisherman/quest/deliver", post(deliver))
        .route("/fisherman/magnet-quest", get(magnet_quest))
        .route("/fisherman/magnet-quest/deliver", post(magnet_deliver))
}

/// Which of his orders: the fish, or what the magnet brings up.
#[derive(Clone, Copy)]
pub(crate) enum Board {
    Fish,
    Magnet,
}

/// What each line of an order is drawn from: its rarities, and how many.
type Slot = (&'static [i16], (i32, i32));

impl Board {
    fn kind(self) -> &'static str {
        match self {
            Board::Fish => "fish",
            Board::Magnet => "scrap",
        }
    }

    /// An uncommon fish (two to four of it), a rare or epic one (one to
    /// three), an epic or legendary one (just the one). The magnet's slower,
    /// so it asks for a little less: a few common things, a couple of
    /// uncommon ones, and one rare or epic.
    fn slots(self) -> [Slot; 3] {
        match self {
            Board::Fish => [(&[1], (2, 4)), (&[2, 3], (1, 3)), (&[3, 4], (1, 1))],
            Board::Magnet => [(&[0], (3, 5)), (&[1], (1, 3)), (&[2, 3], (1, 1))],
        }
    }

    /// Its dice's own stream, so the two orders are drawn apart.
    fn salt(self) -> i64 {
        match self {
            Board::Fish => 0,
            Board::Magnet => 0x5a17_a6e0,
        }
    }

    fn reason(self) -> &'static str {
        match self {
            Board::Fish => "fish_quest",
            Board::Magnet => "magnet_quest",
        }
    }
}

/// The period `unix` falls in.
pub fn period_at(unix: i64) -> i64 {
    unix.div_euclid(PERIOD_SECS)
}

/// A small deterministic generator (the order's dice), seeded by angler and period.
fn dice(player: Uuid, period: i64) -> impl FnMut(u64) -> u64 {
    let mut s = (player.as_u128() as u64)
        ^ ((player.as_u128() >> 64) as u64)
        ^ (period as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    move |n: u64| {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s % n.max(1)
    }
}

/// The order on `board` for `player` in `period`: three different things (item, how many).
fn order(state: &AppState, board: Board, player: Uuid, period: i64) -> Vec<(i32, i32)> {
    let mut roll = dice(player, period + board.salt());
    let mut out: Vec<(i32, i32)> = Vec::new();
    for (rarities, (lo, hi)) in board.slots() {
        let pool: Vec<i32> = state
            .catalog
            .of_kind(board.kind())
            .filter(|f| {
                rarities.contains(&f.rarity)
                    && f.sell().is_some()
                    && !out.iter().any(|(i, _)| *i == f.id)
            })
            .map(|f| f.id)
            .collect();
        if pool.is_empty() {
            continue;
        }
        let fish = pool[roll(pool.len() as u64) as usize];
        let n = lo + roll((hi - lo + 1) as u64) as i32;
        out.push((fish, n));
    }
    out
}

/// The order now, as handed in so far.
pub(crate) async fn state_of(
    state: &AppState,
    board: Board,
    player: Uuid,
    period: i64,
) -> ApiResult<Vec<(i32, i32, i32)>> {
    let given: Vec<(i32, i32)> = sqlx::query_as(
        "SELECT item_id, delivered FROM fish_quests WHERE player_id = $1 AND period = $2",
    )
    .bind(player)
    .bind(period)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(order(state, board, player, period)
        .into_iter()
        .map(|(item, need)| {
            (
                item,
                need,
                given
                    .iter()
                    .find(|(i, _)| *i == item)
                    .map_or(0, |(_, d)| *d),
            )
        })
        .collect())
}

fn view(rows: &[(i32, i32, i32)], period: i64, state: &AppState) -> Value {
    let items: Vec<Value> = rows
        .iter()
        .map(|&(item, need, given)| {
            let price = state.catalog.get(item).and_then(|i| i.sell()).unwrap_or(0) * PAY_TIMES;
            json!({ "item": item, "need": need, "given": given.min(need), "price": price })
        })
        .collect();
    let need: i32 = rows.iter().map(|r| r.1).sum();
    let given: i32 = rows.iter().map(|r| r.2.min(r.1)).sum();
    json!({
        "items": items,
        "need": need,
        "given": given,
        "done": need > 0 && given >= need,
        "ends": (period + 1) * PERIOD_SECS,
    })
}

async fn current(state: &AppState, board: Board, headers: &HeaderMap) -> ApiResult<Json<Value>> {
    let player = bearer_player(state, headers)?;
    let period = period_at(chrono::Utc::now().timestamp());
    let rows = state_of(state, board, player, period).await?;
    Ok(Json(view(&rows, period, state)))
}

async fn quest(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    current(&state, Board::Fish, &headers).await
}

async fn magnet_quest(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    current(&state, Board::Magnet, &headers).await
}

#[derive(Deserialize)]
struct DeliverReq {
    item: i32,
    qty: i32,
    key: String,
}

async fn deliver(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DeliverReq>,
) -> ApiResult<Json<Value>> {
    hand_in(&state, Board::Fish, &headers, req).await
}

async fn magnet_deliver(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DeliverReq>,
) -> ApiResult<Json<Value>> {
    hand_in(&state, Board::Magnet, &headers, req).await
}

/// Hands things in for an order (no more than it still wants), paid triple.
async fn hand_in(
    state: &AppState,
    board: Board,
    headers: &HeaderMap,
    req: DeliverReq,
) -> ApiResult<Json<Value>> {
    let player = bearer_player(state, headers)?;
    if req.key.is_empty() || req.key.len() > 80 || !(1..=99).contains(&req.qty) {
        return Err(ApiError::bad_request(
            "bad_delivery",
            "That doesn't add up.",
        ));
    }
    let period = period_at(chrono::Utc::now().timestamp());
    let rows = state_of(state, board, player, period).await?;
    let Some(&(item, need, given)) = rows.iter().find(|r| r.0 == req.item) else {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "not_ordered",
            "He didn't ask for that one today.",
        ));
    };
    let qty = req.qty.min(need - given);
    if qty <= 0 {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "enough",
            "He has all of those he wanted.",
        ));
    }
    let price = state.catalog.get(item).and_then(|i| i.sell()).unwrap_or(0) * PAY_TIMES;
    let key = format!("fishquest:{player}:{}", req.key);
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let fresh = !key_used(&mut tx, &key).await.map_err(db_err)?;
    let applied: Applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[
            Op { item, delta: -qty },
            Op {
                item: COIN,
                delta: (price * qty as i64) as i32,
            },
        ],
        board.reason(),
        &key,
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => ApiError::new(
            StatusCode::CONFLICT,
            "not_enough_items",
            "You haven't got that many of those.",
        ),
        e => e.into(),
    })?;
    if fresh {
        sqlx::query(
            "INSERT INTO fish_quests (player_id, period, item_id, delivered) VALUES ($1, $2, $3, $4)
             ON CONFLICT (player_id, period, item_id) DO UPDATE SET delivered = fish_quests.delivered + EXCLUDED.delivered",
        )
        .bind(player)
        .bind(period)
        .bind(item)
        .bind(qty)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)?;
    let rows = state_of(state, board, player, period).await?;
    Ok(Json(
        json!({ "applied": applied, "quest": view(&rows, period, state) }),
    ))
}
