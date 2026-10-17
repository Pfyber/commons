//! Internal endpoints for zone servers (spec §4.1: zone servers request
//! grants and never mutate inventory themselves). Authenticated with a
//! short-lived `service` token signed with the shared secret.
//!
//! The spec routes these over NATS request/reply; M3 uses HTTP to keep the
//! local stack to Postgres only (see docs/adr/0002).

use crate::AppState;
use crate::economy::{Applied, EconError, Op, apply, key_used};
use crate::error::{ApiError, ApiResult};
use crate::store::{db_err, is_unique_violation};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::token::{self, ServiceClaims};
use commons_sim::garden::Growth;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

/// Others may harvest a community plot this long after it ripened.
const SHARE_AFTER_MS: i64 = 12 * 3600 * 1000;

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/grant", post(grant))
        .route("/plots", get(plots))
        .route("/plots/plant", post(plant))
        .route("/plots/water", post(water))
        .route("/plots/harvest", post(harvest))
        .route("/home/{owner}/objects", get(home_objects))
        .route("/look/{player}", get(player_look))
        .route("/home/place", post(place))
        .route("/home/pickup", post(pickup))
        .route("/activity", post(activity))
}

fn service(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::unauthorized("missing service token"))?;
    token::verify::<ServiceClaims>(&state.secret, raw)
        .map_err(|e| ApiError::unauthorized(e.to_string()))?;
    Ok(())
}

fn uuid(s: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(s).map_err(|_| ApiError::bad_request("bad_player", "not a player id"))
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

// ---- grants -------------------------------------------------------------------

#[derive(Deserialize)]
struct GrantReq {
    player: String,
    item: i32,
    delta: i32,
    reason: String,
    key: String,
}

async fn grant(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<GrantReq>,
) -> ApiResult<Json<Applied>> {
    service(&state, &headers)?;
    let player = uuid(&req.player)?;
    let ops = [Op {
        item: req.item,
        delta: req.delta,
    }];
    Ok(Json(
        crate::economy::apply_tx(
            &state.db,
            &state.catalog,
            player,
            &ops,
            &req.reason,
            &req.key,
        )
        .await?,
    ))
}

// ---- garden plots ---------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Plot {
    pub x: i16,
    pub y: i16,
    pub owner_id: String,
    pub owner_name: String,
    pub plant: i32,
    pub stage: i16,
    pub stage_started_ms: i64,
    pub watered: bool,
}

impl Plot {
    fn growth(&self) -> Growth {
        Growth {
            stage: self.stage as u8,
            stage_started_ms: self.stage_started_ms,
            watered: self.watered,
        }
    }
}

const PLOT_SELECT: &str = "SELECT pl.x, pl.y, pl.owner_id, p.display_name, pl.plant_item_id, pl.stage, \
    (extract(epoch FROM pl.stage_started_at) * 1000)::bigint AS started, pl.watered \
    FROM plots pl JOIN players p ON p.id = pl.owner_id";

fn plot_from(r: &sqlx::postgres::PgRow) -> Plot {
    Plot {
        x: r.get("x"),
        y: r.get("y"),
        owner_id: r.get::<Uuid, _>("owner_id").to_string(),
        owner_name: r.get("display_name"),
        plant: r.get("plant_item_id"),
        stage: r.get("stage"),
        stage_started_ms: r.get("started"),
        watered: r.get("watered"),
    }
}

async fn load_plot(
    conn: &mut sqlx::PgConnection,
    space: &str,
    x: i16,
    y: i16,
    lock: bool,
) -> sqlx::Result<Option<Plot>> {
    let sql = format!(
        "{PLOT_SELECT} WHERE pl.space = $1 AND pl.x = $2 AND pl.y = $3{}",
        if lock { " FOR UPDATE OF pl" } else { "" }
    );
    let row = sqlx::query(&sql)
        .bind(space)
        .bind(x)
        .bind(y)
        .fetch_optional(conn)
        .await?;
    Ok(row.as_ref().map(plot_from))
}

async fn save_growth(
    conn: &mut sqlx::PgConnection,
    space: &str,
    x: i16,
    y: i16,
    g: Growth,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE plots SET stage = $4, stage_started_at = to_timestamp($5 / 1000.0), watered = $6 WHERE space = $1 AND x = $2 AND y = $3")
        .bind(space)
        .bind(x)
        .bind(y)
        .bind(g.stage as i16)
        .bind(g.stage_started_ms as f64)
        .bind(g.watered)
        .execute(conn)
        .await?;
    Ok(())
}

#[derive(Deserialize)]
struct SpaceQ {
    space: String,
}

async fn plots(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<SpaceQ>,
) -> ApiResult<Json<Vec<Plot>>> {
    service(&state, &headers)?;
    let rows = sqlx::query(&format!("{PLOT_SELECT} WHERE pl.space = $1"))
        .bind(&q.space)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(rows.iter().map(plot_from).collect()))
}

#[derive(Deserialize)]
struct PlantReq {
    space: String,
    x: i16,
    y: i16,
    player: String,
    seed: i32,
    key: String,
}

#[derive(Serialize)]
struct PlotResult {
    plot: Option<Plot>,
    applied: Applied,
}

async fn plant(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PlantReq>,
) -> ApiResult<Json<PlotResult>> {
    service(&state, &headers)?;
    let player = uuid(&req.player)?;
    let plant = state
        .catalog
        .get(req.seed)
        .and_then(|i| i.grows())
        .ok_or_else(|| ApiError::bad_request("not_a_seed", "That can't be planted."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if key_used(&mut tx, &req.key).await.map_err(db_err)? {
        let plot = load_plot(&mut tx, &req.space, req.x, req.y, false)
            .await
            .map_err(db_err)?;
        return Ok(Json(PlotResult {
            plot,
            applied: Applied {
                duplicate: true,
                ..Default::default()
            },
        }));
    }
    let inserted = sqlx::query(
        "INSERT INTO plots (space, x, y, owner_id, plant_item_id) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&req.space)
    .bind(req.x)
    .bind(req.y)
    .bind(player)
    .bind(plant)
    .execute(&mut *tx)
    .await;
    match inserted {
        Ok(_) => {}
        Err(e) if is_unique_violation(&e) => {
            return Err(conflict("occupied", "something is already growing there"));
        }
        Err(e) => return Err(db_err(e)),
    }
    let applied = apply(
        &mut tx,
        &state.catalog,
        player,
        &[Op {
            item: req.seed,
            delta: -1,
        }],
        "plant",
        &req.key,
    )
    .await?;
    let plot = load_plot(&mut tx, &req.space, req.x, req.y, false)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(PlotResult { plot, applied }))
}

#[derive(Deserialize)]
struct PlotReq {
    space: String,
    x: i16,
    y: i16,
    #[serde(default)]
    player: String,
    #[serde(default)]
    key: String,
}

async fn water(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PlotReq>,
) -> ApiResult<Json<Option<Plot>>> {
    service(&state, &headers)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let Some(mut plot) = load_plot(&mut tx, &req.space, req.x, req.y, true)
        .await
        .map_err(db_err)?
    else {
        return Err(conflict("empty", "nothing is planted there"));
    };
    let g = plot.growth().water(now_ms(), state.stage_ms);
    save_growth(&mut tx, &req.space, req.x, req.y, g)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    (plot.stage, plot.stage_started_ms, plot.watered) =
        (g.stage as i16, g.stage_started_ms, g.watered);
    Ok(Json(Some(plot)))
}

async fn harvest(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PlotReq>,
) -> ApiResult<Json<PlotResult>> {
    service(&state, &headers)?;
    let player = uuid(&req.player)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if key_used(&mut tx, &req.key).await.map_err(db_err)? {
        return Ok(Json(PlotResult {
            plot: None,
            applied: Applied {
                duplicate: true,
                ..Default::default()
            },
        }));
    }
    let Some(plot) = load_plot(&mut tx, &req.space, req.x, req.y, true)
        .await
        .map_err(db_err)?
    else {
        return Err(conflict("empty", "nothing is planted there"));
    };
    let now = now_ms();
    let g = plot.growth().at(now, state.stage_ms);
    if !g.ripe() {
        return Err(conflict("not_ripe", "it isn't ready yet"));
    }
    if plot.owner_id != req.player && now - g.stage_started_ms < SHARE_AFTER_MS {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "not_yours",
            format!(
                "{} planted this; give them a chance to pick it",
                plot.owner_name
            ),
        ));
    }
    sqlx::query("DELETE FROM plots WHERE space = $1 AND x = $2 AND y = $3")
        .bind(&req.space)
        .bind(req.x)
        .bind(req.y)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let mut ops = vec![Op {
        item: plot.plant,
        delta: rand::rng().random_range(2..=3),
    }];
    if let Some(seed) = state.catalog.get(plot.plant).and_then(|i| i.seed())
        && rand::rng().random_bool(0.4)
    {
        ops.push(Op {
            item: seed,
            delta: 1,
        });
    }
    let applied = apply(&mut tx, &state.catalog, player, &ops, "harvest", &req.key).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(PlotResult {
        plot: None,
        applied,
    }))
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---- home furniture ---------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct HomeObject {
    pub x: i16,
    pub y: i16,
    pub item: i32,
}

/// A player's saved look, what they wear from the mall and the pet out with
/// them: the zone shows this, not what a client says (ownership was checked
/// when it was saved).
async fn player_look(
    State(state): S,
    headers: HeaderMap,
    Path(player): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    service(&state, &headers)?;
    let p = state
        .store
        .player(&player)
        .await?
        .ok_or_else(|| ApiError::bad_request("bad_player", "no such player"))?;
    let pet = match uuid::Uuid::parse_str(&player) {
        Ok(id) => crate::pets::out_with(&state, id).await?,
        Err(_) => 0,
    };
    Ok(Json(
        serde_json::json!({ "look": p.look, "style": p.style, "pet": pet }),
    ))
}

async fn home_objects(
    State(state): S,
    headers: HeaderMap,
    Path(owner): Path<String>,
) -> ApiResult<Json<Vec<HomeObject>>> {
    service(&state, &headers)?;
    let owner = uuid(&owner)?;
    let rows = sqlx::query("SELECT x, y, item_id FROM home_objects WHERE owner_id = $1")
        .bind(owner)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(
        rows.iter()
            .map(|r| HomeObject {
                x: r.get("x"),
                y: r.get("y"),
                item: r.get("item_id"),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
struct PlaceReq {
    owner: String,
    item: i32,
    x: i16,
    y: i16,
    key: String,
}

async fn place(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PlaceReq>,
) -> ApiResult<Json<Applied>> {
    service(&state, &headers)?;
    let owner = uuid(&req.owner)?;
    if state.catalog.get(req.item).map(|i| i.kind.as_str()) != Some("furniture") {
        return Err(ApiError::bad_request(
            "not_furniture",
            "That can't be placed.",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if !key_used(&mut tx, &req.key).await.map_err(db_err)? {
        // How much a home holds depends on its rent tier (ADR 0010, C4).
        let lease: Option<(String, i16)> = sqlx::query_as(
            "SELECT kind, tier FROM leases WHERE player_id = $1 AND slot = 'home' AND state <> 'ended'",
        )
        .bind(owner)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let (kind, tier) =
            lease.ok_or_else(|| conflict("no_home", "You need a home to put furniture in."))?;
        let rent = commons_sim::city::rent_catalog();
        let t = rent
            .tier(&kind, tier)
            .ok_or_else(|| conflict("no_home", "You need a home to put furniture in."))?;
        let placed: i64 =
            sqlx::query_scalar("SELECT count(*) FROM home_objects WHERE owner_id = $1")
                .bind(owner)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
        if placed >= t.furniture.unwrap_or(0) {
            return Err(conflict(
                "home_full",
                &format!(
                    "Your {} has room for {} pieces. A bigger home holds more; ask at the Post Office.",
                    t.name,
                    t.furniture.unwrap_or(0)
                ),
            ));
        }
        let r = sqlx::query(
            "INSERT INTO home_objects (owner_id, x, y, item_id) VALUES ($1, $2, $3, $4)",
        )
        .bind(owner)
        .bind(req.x)
        .bind(req.y)
        .bind(req.item)
        .execute(&mut *tx)
        .await;
        match r {
            Ok(_) => {}
            Err(e) if is_unique_violation(&e) => {
                return Err(conflict("occupied", "something is already there"));
            }
            Err(e) => return Err(db_err(e)),
        }
    }
    let applied = apply(
        &mut tx,
        &state.catalog,
        owner,
        &[Op {
            item: req.item,
            delta: -1,
        }],
        "home_place",
        &req.key,
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => conflict("not_enough_items", "you don't have one of those"),
        e => e.into(),
    })?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(applied))
}

#[derive(Deserialize)]
struct PickupReq {
    owner: String,
    x: i16,
    y: i16,
    key: String,
}

async fn pickup(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PickupReq>,
) -> ApiResult<Json<Applied>> {
    service(&state, &headers)?;
    let owner = uuid(&req.owner)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if key_used(&mut tx, &req.key).await.map_err(db_err)? {
        return Ok(Json(Applied {
            duplicate: true,
            ..Default::default()
        }));
    }
    let item: Option<i32> = sqlx::query_scalar(
        "DELETE FROM home_objects WHERE owner_id = $1 AND x = $2 AND y = $3 RETURNING item_id",
    )
    .bind(owner)
    .bind(req.x)
    .bind(req.y)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let item = item.ok_or_else(|| conflict("empty", "nothing to pick up there"))?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        owner,
        &[Op { item, delta: 1 }],
        "home_pickup",
        &req.key,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(applied))
}

#[derive(Deserialize)]
struct ActivityRow {
    player: String,
    secs: i32,
    interactions: i32,
    #[serde(default)]
    sat_together: bool,
}

#[derive(Deserialize)]
struct ActivityReq {
    rows: Vec<ActivityRow>,
}

/// Time present and interactions from a zone server, for activity days
/// (spec §10.2). Batched every minute; bots never appear here.
async fn activity(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ActivityReq>,
) -> ApiResult<Json<serde_json::Value>> {
    service(&state, &headers)?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    for r in req.rows.iter().take(5000) {
        let Ok(player) = Uuid::parse_str(&r.player) else {
            continue;
        };
        // Clamp to a minute and a half per report and a sane interaction count.
        crate::gov::record_activity(
            &mut conn,
            player,
            r.secs.clamp(0, 90),
            r.interactions.clamp(0, 60),
        )
        .await
        .map_err(db_err)?;
        if r.sat_together {
            crate::welcome::mark(&mut conn, player, crate::welcome::SAT_TOGETHER)
                .await
                .map_err(db_err)?;
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
