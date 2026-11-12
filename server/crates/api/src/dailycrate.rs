//! The daily crate: one every 18 hours for logging in (`CRATE_EVERY`), kept
//! in the bag till it's opened. Opened, it
//! holds three things: coins (30–300, the more the rarer) and two pieces for
//! your home or its outside (furniture, paint, doors, fences…), each picked
//! by rarity first (common most often, legendary hardly ever) and then at
//! random from the pieces of that rarity (see migration 0071).
//!
//! - `POST /api/crate/daily`: a crate, if it's been 18 hours since the last
//!   (and when the next one's due).
//! - `POST /api/crate/open` `{key}`: opens one. The roll is seeded by the
//!   key, so asking again with the same key gets the same three things (and
//!   pays out once).

use crate::AppState;
use crate::economy::{COIN, Op, apply_tx, bearer_player};
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use serde::Deserialize;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// The daily crate (an item, kind `crate`).
pub const DAILY_CRATE: i32 = 143;

/// How long between one crate and the next.
pub const CRATE_EVERY: chrono::Duration = chrono::Duration::hours(18);

/// The coins' tiers, common to legendary: chance (per 1000) and range.
pub const COIN_TIERS: [(u32, i32, i32); 5] = [
    (550, 30, 60),
    (250, 61, 100),
    (130, 101, 160),
    (55, 161, 240),
    (15, 241, 300),
];
/// A piece's tier, common to legendary: chance (per 1000).
pub const ITEM_TIERS: [u32; 5] = [550, 270, 120, 50, 10];

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/crate/daily", post(daily))
        .route("/crate/open", post(open))
}

/// A tier (0 common – 4 legendary), drawn by `weights` (per 1000).
fn draw_tier(rng: &mut impl Rng, weights: impl Iterator<Item = u32>) -> usize {
    let mut roll = rng.random_range(0..1000);
    for (t, w) in weights.enumerate() {
        if roll < w {
            return t;
        }
        roll -= w;
    }
    0
}

/// The pieces a crate can hold: furniture and outside pieces sold in town
/// (not one-offs from an event), by rarity (0–4).
fn pool(state: &AppState) -> [Vec<i32>; 5] {
    let mut by: [Vec<i32>; 5] = Default::default();
    for kind in ["furniture", "exterior"] {
        for it in state.catalog.of_kind(kind) {
            let sold = it.meta.get("source").and_then(|s| s.as_str()) == Some("npc")
                || it.sell().is_some();
            if sold {
                by[(it.rarity.clamp(0, 4)) as usize].push(it.id);
            }
        }
    }
    by
}

/// What's in a crate opened with `key`: coins and their tier, then two pieces and theirs.
pub fn roll(state: &AppState, player: Uuid, key: &str) -> Vec<(i32, i32, usize)> {
    let mut h = DefaultHasher::new();
    (player, key).hash(&mut h);
    let mut rng = SmallRng::seed_from_u64(h.finish());
    let ct = draw_tier(&mut rng, COIN_TIERS.iter().map(|t| t.0));
    let (_, lo, hi) = COIN_TIERS[ct];
    let mut out = vec![(COIN, rng.random_range(lo..=hi), ct)];
    let pool = pool(state);
    for _ in 0..2 {
        let mut t = draw_tier(&mut rng, ITEM_TIERS.iter().copied());
        // (None of that rarity: the next one down.)
        while t > 0 && pool[t].is_empty() {
            t -= 1;
        }
        if pool[t].is_empty() {
            continue;
        }
        let item = pool[t][rng.random_range(0..pool[t].len())];
        out.push((item, 1, t));
    }
    out
}

/// Today's crate (the UTC day), once; in dev mode, every time (for testing).
async fn daily(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    // When the last one was given (the ledger keeps every grant).
    let last: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT max(at) FROM economy_ledger WHERE player_id = $1 AND reason = 'daily_crate' AND delta > 0",
    )
    .bind(player)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    let now = chrono::Utc::now();
    if let Some(at) = last
        && now - at < CRATE_EVERY
    {
        return Ok(Json(
            serde_json::json!({ "granted": false, "next_at": (at + CRATE_EVERY).timestamp() }),
        ));
    }
    // (Keyed by the last grant: two asks at once give one crate between them.)
    let key = format!(
        "daily_crate:{player}:{}",
        last.map_or("first".to_string(), |at| at.timestamp_millis().to_string())
    );
    let ops = [Op {
        item: DAILY_CRATE,
        delta: 1,
    }];
    let applied = apply_tx(&state.db, &state.catalog, player, &ops, "daily_crate", &key).await?;
    Ok(Json(serde_json::json!({
        "granted": !applied.duplicate,
        "next_at": (now + CRATE_EVERY).timestamp(),
        "applied": applied,
    })))
}

#[derive(Deserialize)]
struct OpenReq {
    key: String,
}

/// Opens a crate: one fewer in the bag, its three things in; what they were (and their rarities).
async fn open(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<OpenReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    if req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_key", "That doesn't add up."));
    }
    let slots = roll(&state, player, &req.key);
    // The crate out; what's in it in (the two pieces could be the same one).
    let mut ops = vec![Op {
        item: DAILY_CRATE,
        delta: -1,
    }];
    for &(item, qty, _) in &slots {
        match ops.iter_mut().find(|o| o.item == item) {
            Some(o) => o.delta += qty,
            None => ops.push(Op { item, delta: qty }),
        }
    }
    let applied = apply_tx(
        &state.db,
        &state.catalog,
        player,
        &ops,
        "daily_crate_open",
        &format!("crate_open:{player}:{}", req.key),
    )
    .await
    .map_err(|e| match e {
        crate::economy::EconError::Insufficient(_) => ApiError::new(
            StatusCode::CONFLICT,
            "no_crate",
            "You haven't got a daily crate to open.",
        ),
        e => e.into(),
    })?;
    let best = slots.iter().map(|s| s.2).max().unwrap_or(0);
    Ok(Json(serde_json::json!({
        "slots": slots.iter().map(|&(item, qty, rarity)| serde_json::json!({ "item": item, "qty": qty, "rarity": rarity })).collect::<Vec<_>>(),
        "best": best,
        "applied": applied,
    })))
}
