//! The founding experience (spec §11): the Caretaker's first three tasks
//! (catch a fish, plant a seed, sit with someone) and the Founders' Grove.
//!
//! Finishing the three tasks during the founding season makes you a founder:
//! a numbered badge, your name on the Founders' Stone, a seedling with your
//! name that grows over real months, and a Founder's Lantern. The season
//! closes when the grove is full (`GROVE_SLOTS`) or on
//! `COMMONS_FOUNDING_SEASON_END` (a date), whichever comes first.

use crate::AppState;
use crate::auth::bearer;
use crate::economy::{Op, apply};
use crate::error::{ApiError, ApiResult};
use crate::store::{db_err, is_unique_violation};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::config;
use commons_sim::GROVE_SLOTS;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

pub const LANTERN: i32 = 407;
/// A zone server's mark for having sat with someone.
pub const SAT_TOGETHER: &str = "sat_together";

/// Days for a founder's tree to reach each stage: seedling, sapling, young
/// tree, grown. A "day" is `COMMONS_GROVE_DAY_SECS` (one real day).
const STAGE_DAYS: [i64; 3] = [7, 30, 90];

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/welcome", get(status))
        .route("/welcome/plant", post(plant))
        .route("/founders", get(founders))
}

fn me(state: &AppState, headers: &HeaderMap) -> ApiResult<(Uuid, String)> {
    let who = bearer(state, headers)?;
    let id =
        Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    Ok((id, who.name))
}

pub fn tree_stage(age_secs: i64) -> i64 {
    let day = config::env_or::<i64>("COMMONS_GROVE_DAY_SECS", 86_400).max(1);
    let days = age_secs / day;
    STAGE_DAYS.iter().filter(|&&d| days >= d).count() as i64
}

/// Records a first that only a zone server can see.
pub async fn mark(conn: &mut PgConnection, player: Uuid, mark: &str) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO player_marks (player_id, mark) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(player)
        .bind(mark)
        .execute(conn)
        .await
        .map(|_| ())
}

/// Which of the three first tasks are done.
async fn tasks(conn: &mut PgConnection, player: Uuid) -> sqlx::Result<(bool, bool, bool)> {
    let r = sqlx::query(
        "SELECT
            EXISTS (SELECT 1 FROM collection c JOIN items i ON i.id = c.item_id
                    WHERE c.player_id = $1 AND i.kind = 'fish') AS fish,
            EXISTS (SELECT 1 FROM economy_ledger WHERE player_id = $1 AND reason = 'plant') AS plant,
            EXISTS (SELECT 1 FROM player_marks WHERE player_id = $1 AND mark = $2) AS sit",
    )
    .bind(player)
    .bind(SAT_TOGETHER)
    .fetch_one(conn)
    .await?;
    Ok((r.get("fish"), r.get("plant"), r.get("sit")))
}

/// Whether the founding season is open, and how many grove slots are left.
async fn season(conn: &mut PgConnection) -> sqlx::Result<(bool, i64)> {
    let planted: i64 = sqlx::query_scalar("SELECT count(*) FROM founders")
        .fetch_one(&mut *conn)
        .await?;
    let left = (GROVE_SLOTS as i64 - planted).max(0);
    let end = config::env_str("COMMONS_FOUNDING_SEASON_END", "");
    let before_end = if end.is_empty() {
        true
    } else {
        sqlx::query_scalar("SELECT now() < $1::date")
            .bind(&end)
            .fetch_one(&mut *conn)
            .await
            .unwrap_or(true)
    };
    Ok((left > 0 && before_end, left))
}

fn founder_json(r: &sqlx::postgres::PgRow) -> Value {
    let age: i64 = r.get("age");
    json!({
        "no": r.get::<i32, _>("no"),
        "slot": r.get::<i32, _>("slot"),
        "name": r.get::<String, _>("name"),
        "planted_at": r.get::<i64, _>("planted"),
        "stage": tree_stage(age),
    })
}

const FOUNDER_SELECT: &str =
    "SELECT no, slot, name, extract(epoch FROM planted_at)::bigint AS planted,
    extract(epoch FROM now() - planted_at)::bigint AS age FROM founders";

/// Your first tasks, whether you're a founder, and the season.
async fn status(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (id, _) = me(&state, &headers)?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let (fish, plant, sit) = tasks(&mut conn, id).await.map_err(db_err)?;
    let founder = sqlx::query(&format!("{FOUNDER_SELECT} WHERE player_id = $1"))
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_err)?;
    let (open, left) = season(&mut conn).await.map_err(db_err)?;
    Ok(Json(json!({
        "tasks": { "fish": fish, "plant": plant, "sit": sit },
        "founder": founder.as_ref().map(founder_json),
        "season": { "open": open, "left": left, "slots": GROVE_SLOTS },
    })))
}

/// Plants your seedling once the three tasks are done.
async fn plant(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (id, name) = me(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    // One planting at a time, so founder numbers and slots stay dense.
    sqlx::query("SELECT pg_advisory_xact_lock(7007)")
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let existing = sqlx::query(&format!("{FOUNDER_SELECT} WHERE player_id = $1"))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
    if let Some(f) = existing {
        return Ok(Json(
            json!({ "founder": founder_json(&f), "already": true }),
        ));
    }
    let (fish, plant, sit) = tasks(&mut tx, id).await.map_err(db_err)?;
    if !(fish && plant && sit) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "tasks_left",
            "Finish the three little tasks first.",
        ));
    }
    let (open, _) = season(&mut tx).await.map_err(db_err)?;
    if !open {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "season_closed",
            "The founding season has closed: the grove is full.",
        ));
    }
    let next: i32 = sqlx::query_scalar("SELECT coalesce(max(no), 0) + 1 FROM founders")
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    // The nearest free slot to the stone (slots are ordered that way).
    let slot: i32 = sqlx::query_scalar(
        "SELECT s FROM generate_series(0, $1 - 1) s
         WHERE s NOT IN (SELECT slot FROM founders) ORDER BY s LIMIT 1",
    )
    .bind(GROVE_SLOTS as i32)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let inserted =
        sqlx::query("INSERT INTO founders (player_id, no, slot, name) VALUES ($1, $2, $3, $4)")
            .bind(id)
            .bind(next)
            .bind(slot)
            .bind(&name)
            .execute(&mut *tx)
            .await;
    match inserted {
        Ok(_) => {}
        Err(e) if is_unique_violation(&e) => {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "try_again",
                "Someone planted at the same moment; try again.",
            ));
        }
        Err(e) => return Err(db_err(e)),
    }
    apply(
        &mut tx,
        &state.catalog,
        id,
        &[Op {
            item: LANTERN,
            delta: 1,
        }],
        "founder",
        &format!("founder:{id}"),
    )
    .await?;
    let f = sqlx::query(&format!("{FOUNDER_SELECT} WHERE player_id = $1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    crate::gov::touch(&state.db, id).await;
    Ok(Json(
        json!({ "founder": founder_json(&f), "already": false }),
    ))
}

/// Every founder (public): for the grove, the stone and name badges.
async fn founders(State(state): S) -> ApiResult<Json<Value>> {
    let rows = sqlx::query(&format!("{FOUNDER_SELECT} ORDER BY no"))
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let (open, left) = season(&mut conn).await.map_err(db_err)?;
    Ok(Json(json!({
        "founders": rows.iter().map(founder_json).collect::<Vec<_>>(),
        "season": { "open": open, "left": left, "slots": GROVE_SLOTS },
    })))
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn trees_grow_over_months() {
        let day = 86_400;
        assert_eq!(tree_stage(0), 0);
        assert_eq!(tree_stage(6 * day), 0);
        assert_eq!(tree_stage(7 * day), 1);
        assert_eq!(tree_stage(45 * day), 2);
        assert_eq!(tree_stage(400 * day), 3);
    }
}
