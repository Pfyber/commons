//! Homes in the city (ADR 0010, C3): seven houses on each home block, one
//! per player, free while the town is young (C4 adds rent). A house's door
//! leads into its owner's instanced home.
//!
//! Players: `GET /api/social/homes` (who lives where), `POST
//! /api/social/homes/claim` (move into a free house). Services: `GET
//! /internal/home?player=` (the orchestrator: may they go home, and which
//! door do they come out of).

use crate::State as SocialState;
use axum::Json;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use commons_api::error::{ApiError, ApiResult};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// Every lot in the city.
static LOTS: LazyLock<HashSet<String>> =
    LazyLock::new(|| commons_sim::city::city_home_lots().into_iter().collect());

/// The lot `player` lives on, if any.
pub async fn lot_of(db: &PgPool, player: Uuid) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar("SELECT lot FROM home_lots WHERE player_id = $1")
        .bind(player)
        .fetch_optional(db)
        .await
}

fn no_home(whose: &str) -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "no_home", whose)
}

pub async fn list(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = super::routes::me(&state, &headers)?;
    let rows: Vec<(String, Uuid, String)> = sqlx::query_as(
        "SELECT h.lot, h.player_id, p.display_name FROM home_lots h JOIN players p ON p.id = h.player_id ORDER BY h.lot",
    )
    .fetch_all(&state.db)
    .await
    .map_err(super::routes::db_err)?;
    let mine = rows.iter().find(|r| r.1 == me).map(|r| r.0.clone());
    let lots: Vec<_> = rows
        .iter()
        .map(|(lot, id, name)| json!({ "lot": lot, "owner": id.to_string(), "name": name }))
        .collect();
    Ok(Json(
        json!({ "mine": mine, "total": LOTS.len(), "lots": lots }),
    ))
}

#[derive(Deserialize)]
pub struct ClaimReq {
    lot: String,
}

pub async fn claim(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ClaimReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = super::routes::me(&state, &headers)?;
    if !LOTS.contains(&req.lot) {
        return Err(ApiError::bad_request("bad_lot", "There's no house there."));
    }
    if lot_of(&state.db, me)
        .await
        .map_err(super::routes::db_err)?
        .is_some()
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "has_home",
            "You already have a home.",
        ));
    }
    let done = sqlx::query(
        "INSERT INTO home_lots (lot, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(&req.lot)
    .bind(me)
    .execute(&state.db)
    .await
    .map_err(super::routes::db_err)?
    .rows_affected();
    if done == 0 {
        // The lot was taken, or a second claim of ours raced this one.
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "taken",
            "Someone has just moved in there.",
        ));
    }
    Ok(Json(json!({ "lot": req.lot })))
}

#[derive(Deserialize)]
pub struct HomeQ {
    player: String,
}

pub async fn internal_home(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<HomeQ>,
) -> ApiResult<Json<serde_json::Value>> {
    super::routes::service(&state, &headers)?;
    let player = super::routes::uuid(&q.player)?;
    let lot = lot_of(&state.db, player)
        .await
        .map_err(super::routes::db_err)?
        .ok_or_else(|| {
            no_home("You don't have a home yet. Pick a free house in one of the home blocks; they're free for now.")
        })?;
    Ok(Json(json!({ "lot": lot })))
}

/// Visiting needs the owner to have a home.
pub async fn require_home(db: &PgPool, owner: Uuid) -> ApiResult<()> {
    match lot_of(db, owner).await.map_err(super::routes::db_err)? {
        Some(_) => Ok(()),
        None => Err(no_home("They don't have a home yet.")),
    }
}
