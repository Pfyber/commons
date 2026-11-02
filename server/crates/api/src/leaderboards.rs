//! The town's leaderboards (the boards on the green, by the arena, the pond
//! and the Splat Yard): the richest (coins in hand), the anglers (fish
//! caught, from the ledger), and the arena's and the Splat Yard's winners
//! (`player_stats`, counted by the zones). Each board's top `TOP`, and where
//! the asker stands on it.
//!
//! `GET /api/leaderboards`; `POST /internal/stats/add` (zones only).

use crate::AppState;
use crate::economy::{COIN, bearer_player};
use crate::error::{ApiError, ApiResult};
use crate::internal::{service, uuid};
use crate::store::db_err;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// How many each board lists.
pub const TOP: i64 = 100;
/// The swarm's bots (`Bot 1`, `Bot 2`…, tools/botswarm) sign in as players:
/// they're left off the boards (only real people are ranked).
pub const BOT_NAMES: &str = "^bot [0-9]+$";
/// The tallies the zones may add to.
pub const STATS: [&str; 2] = ["arena_wins", "paintball_wins"];

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/leaderboards", get(boards))
}

pub fn internal_routes() -> Router<Arc<AppState>> {
    Router::new().route("/stats/add", post(add))
}

/// Each board: its key, and the query of (player, name, value) it ranks.
fn board_query(key: &str) -> &'static str {
    match key {
        "coins" => {
            "SELECT p.id, p.display_name AS name, i.qty::bigint AS v FROM inventory i
             JOIN players p ON p.id = i.player_id WHERE i.item_id = $2 AND i.qty > 0"
        }
        "fish" => {
            "SELECT p.id, p.display_name AS name, count(*)::bigint AS v FROM economy_ledger l
             JOIN items it ON it.id = l.item_id JOIN players p ON p.id = l.player_id
             WHERE l.reason = 'fishing' AND it.kind = 'fish' AND l.delta > 0 AND $2 > 0
             GROUP BY p.id, p.display_name"
        }
        "arena" => {
            "SELECT p.id, p.display_name AS name, s.value AS v FROM player_stats s
             JOIN players p ON p.id = s.player_id WHERE s.stat = 'arena_wins' AND s.value > 0 AND $2 > 0"
        }
        _ => {
            "SELECT p.id, p.display_name AS name, s.value AS v FROM player_stats s
             JOIN players p ON p.id = s.player_id WHERE s.stat = 'paintball_wins' AND s.value > 0 AND $2 > 0"
        }
    }
}

/// One board: its top, and the asker's place on it (if they're on it at all).
async fn board(state: &AppState, key: &str, me: Option<Uuid>) -> ApiResult<Value> {
    let sql = format!(
        "WITH r AS ({}), ranked AS (SELECT id, name, v, rank() OVER (ORDER BY v DESC) AS rk FROM r WHERE name !~* $4)
         SELECT id, name, v, rk FROM ranked WHERE rk <= $3 OR id = $1 ORDER BY v DESC, name",
        board_query(key)
    );
    let rows = sqlx::query(&sql)
        .bind(me)
        .bind(COIN)
        .bind(TOP)
        .bind(BOT_NAMES)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    let mut top = Vec::new();
    let mut mine = Value::Null;
    for r in rows {
        let (id, name, v, rk): (Uuid, String, i64, i64) =
            (r.get("id"), r.get("name"), r.get("v"), r.get("rk"));
        if Some(id) == me {
            mine = json!({ "rank": rk, "value": v });
        }
        if rk <= TOP {
            top.push(json!({ "rank": rk, "name": name, "value": v }));
        }
    }
    Ok(json!({ "top": top, "me": mine }))
}

async fn boards(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let me = bearer_player(&state, &headers).ok();
    let mut out = serde_json::Map::new();
    for key in ["coins", "arena", "fish", "paintball"] {
        out.insert(key.to_string(), board(&state, key, me).await?);
    }
    Ok(Json(Value::Object(out)))
}

#[derive(Deserialize)]
struct AddReq {
    player: String,
    stat: String,
    #[serde(default = "one")]
    n: i64,
}

fn one() -> i64 {
    1
}

/// A zone counts a win (or whatever the tally is) for a player.
async fn add(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<AddReq>,
) -> ApiResult<Json<Value>> {
    service(&state, &headers)?;
    let player = uuid(&req.player)?;
    if !STATS.contains(&req.stat.as_str()) || !(1..=100).contains(&req.n) {
        return Err(ApiError::bad_request("bad_stat", "no such tally"));
    }
    let value: i64 = sqlx::query_scalar(
        "INSERT INTO player_stats (player_id, stat, value) VALUES ($1, $2, $3)
         ON CONFLICT (player_id, stat) DO UPDATE SET value = player_stats.value + EXCLUDED.value
         RETURNING value",
    )
    .bind(player)
    .bind(&req.stat)
    .bind(req.n)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "value": value })))
}
