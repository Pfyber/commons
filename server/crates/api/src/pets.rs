//! Pets (ADR 0011, M5). Adopted at the mall's Pets shop by someone with a
//! house (a pet needs a garden), one each. A pet lives at its owner's house
//! and waits in the yard; it wants a walk every day. Taking it out, it walks
//! with you everywhere (the zone draws it at your heels, for everyone);
//! bringing it home after at least `COMMONS_PET_WALK_SECS` counts as the
//! day's walk. Missing a day costs nothing: the pet just waits by the door
//! looking hopeful. Moving house takes the pet along (where it lives is
//! wherever its owner's house is).
//!
//! `GET /api/pets` (every pet in the city), `POST /api/me/pet/walk`.

use crate::AppState;
use crate::economy::bearer_player;
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::config;
use commons_common::filter::clean_chat;
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

/// A walk this long or longer counts as the day's walk.
const DEFAULT_WALK_SECS: i64 = 180;
/// A pet left out longer than this (its walker went away) is home again.
pub const OUT_HOURS: i32 = 3;

fn walk_secs() -> i64 {
    config::env_or("COMMONS_PET_WALK_SECS", DEFAULT_WALK_SECS).max(0)
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/pets", get(list))
        .route("/me/pet/walk", post(walk))
}

/// Is this item a pet to adopt?
pub fn is_pet(kind: &str) -> bool {
    kind == "pet"
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

/// A pet's name: 2 to 16 letters, spaces, - or '.
pub fn clean_name(raw: &str) -> ApiResult<String> {
    let name = raw.trim().to_string();
    let bad = |m: &str| Err(ApiError::bad_request("invalid_name", m));
    if !(2..=16).contains(&name.chars().count()) {
        return bad("A pet's name is 2 to 16 letters.");
    }
    if !name
        .chars()
        .all(|c| c.is_alphabetic() || c == ' ' || c == '-' || c == '\'')
        || name.contains("  ")
    {
        return bad("Use letters, spaces, - and '.");
    }
    if clean_chat(&name).as_deref() != Some(name.as_str()) {
        return bad("Please pick a different name.");
    }
    Ok(name)
}

/// Adopts the pet `item` (bought at the Pets shop, in the purchase's
/// transaction): you need a house, and no pet yet.
pub async fn adopt(conn: &mut PgConnection, player: Uuid, item: i32, name: &str) -> ApiResult<()> {
    let house: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM leases WHERE player_id = $1 AND kind = 'home' AND state <> 'ended')",
    )
    .bind(player)
    .fetch_one(&mut *conn)
    .await
    .map_err(db_err)?;
    if !house {
        return Err(conflict(
            "no_house",
            "A pet needs a garden: rent a house first (ask at the Post Office).",
        ));
    }
    let added = sqlx::query(
        "INSERT INTO pets (owner, item_id, name) VALUES ($1, $2, $3) ON CONFLICT (owner) DO NOTHING",
    )
    .bind(player)
    .bind(item)
    .bind(name)
    .execute(&mut *conn)
    .await
    .map_err(db_err)?
    .rows_affected();
    if added == 0 {
        return Err(conflict(
            "have_pet",
            "You have a pet already: one is plenty of love.",
        ));
    }
    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
struct PetRow {
    owner: Uuid,
    owner_name: String,
    name: String,
    item: i32,
    /// The house it lives at (none: its owner has no house just now).
    plot: Option<String>,
    /// Out on a walk.
    out: bool,
    walked_today: bool,
    walks: i32,
}

const PET_ROWS: &str = "
    SELECT p.owner, pl.display_name AS owner_name, p.name, p.item_id AS item,
           l.plot,
           (p.out_since IS NOT NULL AND p.out_since > now() - make_interval(hours => $1)) AS out,
           (p.last_walk IS NOT NULL AND p.last_walk >= (now() AT TIME ZONE 'utc')::date) AS walked_today,
           p.walks
    FROM pets p
    JOIN players pl ON pl.id = p.owner
    LEFT JOIN leases l ON l.player_id = p.owner AND l.kind = 'home' AND l.state <> 'ended'";

/// Every pet: where it lives, whether it's out, whether it's had its walk.
async fn list(State(state): S) -> ApiResult<Json<serde_json::Value>> {
    let rows: Vec<PetRow> = sqlx::query_as(&format!("{PET_ROWS} ORDER BY p.adopted_at"))
        .bind(OUT_HOURS)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(
        serde_json::json!({ "pets": rows, "walk_secs": walk_secs() }),
    ))
}

#[derive(Deserialize)]
struct WalkReq {
    out: bool,
}

/// Takes your pet out, or brings it home. Home after a long enough walk:
/// that's today's walk (once a day).
async fn walk(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<WalkReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let player = bearer_player(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    // Out now (and since when), and whether today's walk is still to come.
    let now: Option<(bool, bool)> = sqlx::query_as(
        "SELECT out_since IS NOT NULL AND out_since > now() - make_interval(hours => $2)
                AND out_since <= now() - make_interval(secs => $3),
                last_walk IS NULL OR last_walk < (now() AT TIME ZONE 'utc')::date
         FROM pets WHERE owner = $1 FOR UPDATE",
    )
    .bind(player)
    .bind(OUT_HOURS)
    .bind(walk_secs() as f64)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let Some((long_enough, due)) = now else {
        return Err(conflict("no_pet", "You don't have a pet yet."));
    };
    let walked = !req.out && long_enough && due;
    if req.out {
        // Already out (and not forgotten): the walk keeps going.
        sqlx::query(
            "UPDATE pets SET out_since = now() WHERE owner = $1
             AND (out_since IS NULL OR out_since <= now() - make_interval(hours => $2))",
        )
        .bind(player)
        .bind(OUT_HOURS)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    } else {
        sqlx::query(
            "UPDATE pets SET out_since = NULL,
                 walks = walks + $2::int,
                 last_walk = CASE WHEN $3 THEN (now() AT TIME ZONE 'utc')::date ELSE last_walk END
             WHERE owner = $1",
        )
        .bind(player)
        .bind(walked as i32)
        .bind(walked)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    let pet: Option<PetRow> = sqlx::query_as(&format!("{PET_ROWS} WHERE p.owner = $2"))
        .bind(OUT_HOURS)
        .bind(player)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(serde_json::json!({ "pet": pet, "walked": walked })))
}

/// The code (species and coat) of the pet out with `player`, 0 if none: the
/// zone draws it at their heels.
pub async fn out_with(state: &AppState, player: Uuid) -> ApiResult<u16> {
    let item: Option<i32> = sqlx::query_scalar(
        "SELECT item_id FROM pets WHERE owner = $1
         AND out_since IS NOT NULL AND out_since > now() - make_interval(hours => $2)",
    )
    .bind(player)
    .bind(OUT_HOURS)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    Ok(item
        .and_then(|id| state.catalog.get(id))
        .and_then(|it| it.meta["code"].as_u64())
        .map_or(0, |c| c as u16))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pet_names() {
        assert_eq!(clean_name("  Biscuit ").unwrap(), "Biscuit");
        assert_eq!(clean_name("Mr O'Toole").unwrap(), "Mr O'Toole");
        assert!(clean_name("B").is_err());
        assert!(clean_name("Rex123").is_err());
        assert!(clean_name("a very long name for a pet").is_err());
    }
}
