//! Homes in the city (ADR 0010, C3–C4): seven houses on each home block and
//! apartments above the Market, one home per player, rented by the week
//! (see `rent`). A home's door leads into its owner's instanced interior.
//!
//! Players: `GET /api/social/homes` (who lives where), `POST
//! /api/social/homes/claim` (rent a free house or apartment). Services: `GET
//! /internal/home?player=` (the orchestrator: may they go home, and which
//! door do they come out of).

use crate::State as SocialState;
use crate::rent::{self, lease_of, open_leases};
use crate::routes::{db_err, me, service, uuid};
use axum::Json;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use commons_api::error::{ApiError, ApiResult};
use commons_sim::city::{APARTMENTS, city_home_lots, plot_kind};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::sync::{Arc, LazyLock};
use uuid::Uuid;

type S = State<Arc<SocialState>>;

static HOUSES: LazyLock<usize> = LazyLock::new(|| city_home_lots().len());

/// The plot `player`'s home is on, if they have one.
pub async fn home_of(db: &PgPool, player: Uuid) -> sqlx::Result<Option<String>> {
    Ok(lease_of(db, player, "home").await?.map(|l| l.plot))
}

fn no_home(whose: &str) -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "no_home", whose)
}

pub async fn list(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let rows = open_leases(&state.db, &["home", "apartment"])
        .await
        .map_err(db_err)?;
    let mine = rows
        .iter()
        .find(|(l, _)| l.player == me)
        .map(|(l, _)| l.plot.clone());
    let lots: Vec<_> = rows
        .iter()
        .map(|(l, name)| json!({ "lot": l.plot, "owner": l.player.to_string(), "name": name }))
        .collect();
    Ok(Json(json!({
        "mine": mine,
        "total": *HOUSES,
        "apartments": APARTMENTS,
        "lots": lots,
    })))
}

#[derive(Deserialize)]
pub struct ClaimReq {
    lot: String,
    #[serde(default = "first_tier")]
    tier: i16,
}

fn first_tier() -> i16 {
    1
}

pub async fn claim(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ClaimReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let kind = match plot_kind(&req.lot) {
        Some(k @ ("home" | "apartment")) => k,
        _ => return Err(ApiError::bad_request("bad_lot", "There's no home there.")),
    };
    let lease = rent::open(&state, me, kind, &req.lot, req.tier).await?;
    Ok(Json(json!({ "lot": lease.plot, "lease": lease.json() })))
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
    service(&state, &headers)?;
    let player = uuid(&q.player)?;
    let lot = home_of(&state.db, player).await.map_err(db_err)?.ok_or_else(|| {
        no_home(
            "You don't have a home yet. Rent a house in one of the home blocks, or an apartment above the Market; ask at the Post Office.",
        )
    })?;
    Ok(Json(json!({ "lot": lot })))
}

/// Visiting needs the owner to have a home.
pub async fn require_home(db: &PgPool, owner: Uuid) -> ApiResult<()> {
    match home_of(db, owner).await.map_err(db_err)? {
        Some(_) => Ok(()),
        None => Err(no_home("They don't have a home right now.")),
    }
}
