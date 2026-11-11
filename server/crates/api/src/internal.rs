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
use commons_sim::garden::{Growth, UV_SPEED};
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
        .route("/has", get(has))
        .route("/plots", get(plots))
        .route("/plots/plant", post(plant))
        .route("/plots/water", post(water))
        .route("/plots/harvest", post(harvest))
        .route("/home/{owner}/objects", get(home_objects))
        .route("/home-yards/objects", get(yard_objects))
        .route("/look/{player}", get(player_look))
        .route("/home/place", post(place))
        .route("/home/pickup", post(pickup))
        .route("/home/tank/put", post(tank_put))
        .route("/home/tank/take", post(tank_take))
        .route("/home/tank/feed", post(tank_feed))
        .route("/home/light", post(light))
        .route("/activity", post(activity))
        .merge(crate::clubroom::routes())
        .merge(crate::leaderboards::internal_routes())
}

pub(crate) fn service(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::unauthorized("missing service token"))?;
    token::verify::<ServiceClaims>(&state.secret, raw)
        .map_err(|e| ApiError::unauthorized(e.to_string()))?;
    Ok(())
}

pub(crate) fn uuid(s: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(s).map_err(|_| ApiError::bad_request("bad_player", "not a player id"))
}

pub(crate) fn conflict(code: &'static str, msg: &str) -> ApiError {
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

#[derive(Deserialize)]
struct HasQuery {
    player: String,
    item: i32,
}

/// How many of `item` a player holds (the zone asks, e.g., whether an angler has the better rod).
async fn has(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<HasQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    service(&state, &headers)?;
    let player = uuid(&q.player)?;
    let qty: Option<i32> =
        sqlx::query_scalar("SELECT qty FROM inventory WHERE player_id = $1 AND item_id = $2")
            .bind(player)
            .bind(q.item)
            .fetch_optional(&state.db)
            .await
            .map_err(db_err)?;
    Ok(Json(serde_json::json!({ "qty": qty.unwrap_or(0) })))
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
    /// Under a UV light (grows `UV_SPEED` times as fast).
    #[serde(default)]
    pub uv: bool,
}

impl Plot {
    fn stage_ms(&self, base: i64) -> i64 {
        if self.uv { base / UV_SPEED } else { base }
    }

    fn growth(&self) -> Growth {
        Growth {
            stage: self.stage as u8,
            stage_started_ms: self.stage_started_ms,
            watered: self.watered,
        }
    }
}

const PLOT_SELECT: &str = "SELECT pl.x, pl.y, pl.owner_id, p.display_name, pl.plant_item_id, pl.stage, \
    (extract(epoch FROM pl.stage_started_at) * 1000)::bigint AS started, pl.watered, \
    EXISTS (SELECT 1 FROM home_objects h JOIN items i ON i.id = h.item_id WHERE NOT h.yard \
        AND i.key = 'uv_light' AND 'home:' || h.owner_id = pl.space AND h.x = pl.x AND h.y = pl.y - 1) AS uv \
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
        uv: r.get("uv"),
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
    let g = plot.growth().water(now_ms(), plot.stage_ms(state.stage_ms));
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
    let g = plot.growth().at(now, plot.stage_ms(state.stage_ms));
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
    /// 1: standing on the table under it (0: on the floor, or the wall).
    #[serde(default)]
    pub layer: i16,
    /// A fish tank's fish (item ids).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fish: Vec<i32>,
    /// Quarter turns.
    #[serde(default)]
    pub rot: i16,
    /// When its fish last ate (unix seconds).
    #[serde(default)]
    pub fed: i64,
    /// Switched on (a lamp, the TV, a fireplace): it stays on while you're away.
    #[serde(default)]
    pub on: bool,
}

/// A player's saved look, what they wear from the mall, the pet out with
/// them, what they're riding, the tools they use and the instruments and
/// toys they own: the zone shows this, not what a client says (ownership was checked
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
    let (pet, vehicle, tool, kit) = match uuid::Uuid::parse_str(&player) {
        Ok(id) => (
            crate::pets::out_with(&state, id).await?,
            crate::vehicles::riding(&state, id).await?,
            crate::goods::tool(&state, id).await?,
            crate::goods::kit(&state, id).await?,
        ),
        Err(_) => (0, 0, 0, 0),
    };
    Ok(Json(serde_json::json!({
        "look": p.look, "style": p.style, "pet": pet, "vehicle": vehicle,
        "tool": tool, "kit": kit,
    })))
}

async fn home_objects(
    State(state): S,
    headers: HeaderMap,
    Path(owner): Path<String>,
) -> ApiResult<Json<Vec<HomeObject>>> {
    service(&state, &headers)?;
    let owner = uuid(&owner)?;
    let rows = sqlx::query(&format!("{HOME_OBJECT} WHERE owner_id = $1 AND NOT yard"))
        .bind(owner)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(rows.iter().map(home_object).collect()))
}

const HOME_OBJECT: &str = "SELECT x, y, item_id, fish, layer, rot, lit, \
    extract(epoch FROM fed_at)::bigint AS fed FROM home_objects";

fn home_object(r: &sqlx::postgres::PgRow) -> HomeObject {
    HomeObject {
        x: r.get("x"),
        y: r.get("y"),
        item: r.get("item_id"),
        fish: r.get("fish"),
        layer: r.get("layer"),
        rot: r.get("rot"),
        fed: r.get("fed"),
        on: r.get("lit"),
    }
}

/// Every front yard's pieces (the city shows them all).
async fn yard_objects(State(state): S, headers: HeaderMap) -> ApiResult<Json<Vec<HomeObject>>> {
    service(&state, &headers)?;
    let rows = sqlx::query(&format!("{HOME_OBJECT} WHERE yard"))
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(rows.iter().map(home_object).collect()))
}

/// How many pieces a front yard holds.
const YARD_PIECES: i64 = 24;

#[derive(Deserialize)]
struct PlaceReq {
    owner: String,
    item: i32,
    x: i16,
    y: i16,
    /// 1: on the table there (the zone checked it may go there).
    #[serde(default)]
    layer: i16,
    #[serde(default)]
    rot: i16,
    /// In the front yard of this lot, not indoors.
    #[serde(default)]
    lot: Option<String>,
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
        let lease: Option<(String, i16, String)> = sqlx::query_as(
            "SELECT kind, tier, plot FROM leases WHERE player_id = $1 AND slot = 'home' AND state <> 'ended'",
        )
        .bind(owner)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let (kind, tier, plot) =
            lease.ok_or_else(|| conflict("no_home", "You need a home to put furniture in."))?;
        if req.lot.as_ref().is_some_and(|lot| *lot != plot) {
            return Err(conflict("not_yours", "That's someone else's yard."));
        }
        let rent = commons_sim::city::rent_catalog();
        let t = rent
            .tier(&kind, tier)
            .ok_or_else(|| conflict("no_home", "You need a home to put furniture in."))?;
        let yard = req.lot.is_some();
        let placed: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM home_objects WHERE owner_id = $1 AND yard = $2",
        )
        .bind(owner)
        .bind(yard)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if yard && placed >= YARD_PIECES {
            return Err(conflict(
                "home_full",
                &format!("Your yard has room for {YARD_PIECES} pieces."),
            ));
        }
        if !yard && placed >= t.furniture.unwrap_or(0) {
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
            "INSERT INTO home_objects (owner_id, x, y, item_id, layer, rot, yard) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(owner)
        .bind(req.x)
        .bind(req.y)
        .bind(req.item)
        .bind(req.layer.clamp(0, 1))
        .bind(req.rot.rem_euclid(16))
        .bind(yard)
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
    #[serde(default)]
    layer: i16,
    #[serde(default)]
    yard: bool,
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
    // What's in a yard is dug up.
    if req.yard {
        let shovel = state.catalog.by_key("shovel").map_or(0, |i| i.id);
        let have = crate::economy::totals(&mut tx, owner, &[shovel])
            .await
            .map_err(db_err)?[0]
            .1;
        if have <= 0 {
            return Err(conflict("no_shovel", "You need a shovel to dig that up."));
        }
    }
    // (A tank with fish in it stays put: take them out first.)
    let full: bool = sqlx::query_scalar(
        "SELECT cardinality(fish) > 0 FROM home_objects WHERE owner_id = $1 AND x = $2 AND y = $3 AND layer = $4 AND yard = $5",
    )
    .bind(owner)
    .bind(req.x)
    .bind(req.y)
    .bind(req.layer)
    .bind(req.yard)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .unwrap_or(false);
    if full {
        return Err(conflict("tank_full", "Empty it first."));
    }
    let item: Option<i32> = sqlx::query_scalar(
        "DELETE FROM home_objects WHERE owner_id = $1 AND x = $2 AND y = $3 AND layer = $4 AND yard = $5 RETURNING item_id",
    )
    .bind(owner)
    .bind(req.x)
    .bind(req.y)
    .bind(req.layer)
    .bind(req.yard)
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
struct TankReq {
    owner: String,
    x: i16,
    y: i16,
    /// Put: the fish (an item). Take: which one (its place in the tank).
    #[serde(default)]
    fish: i32,
    #[serde(default)]
    index: i32,
    #[serde(default)]
    layer: i16,
    key: String,
}

/// What a tank holds now, and the bag's change.
#[derive(Serialize)]
struct TankDone {
    fish: Vec<i32>,
    applied: Applied,
}

/// The tank at (x, y) in `owner`'s home: its item and fish, locked for the change.
async fn tank_at(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    owner: Uuid,
    x: i16,
    y: i16,
    layer: i16,
) -> ApiResult<(i32, Vec<i32>)> {
    let row: Option<(i32, Vec<i32>)> = sqlx::query_as(
        "SELECT item_id, fish FROM home_objects WHERE owner_id = $1 AND x = $2 AND y = $3 AND layer = $4 AND NOT yard FOR UPDATE",
    )
    .bind(owner)
    .bind(x)
    .bind(y)
    .bind(layer)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db_err)?;
    row.ok_or_else(|| conflict("empty", "there's no tank there"))
}

/// A fish from the bag into a tank (as many as it holds).
async fn tank_put(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<TankReq>,
) -> ApiResult<Json<TankDone>> {
    service(&state, &headers)?;
    let owner = uuid(&req.owner)?;
    let thing = state
        .catalog
        .get(req.fish)
        .ok_or_else(|| ApiError::bad_request("not_fish", "Only fish go in a tank."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (item, mut fish) = tank_at(&mut tx, owner, req.x, req.y, req.layer).await?;
    // A display shelf takes anything you can hold; a tank, only fish.
    let shelf = state
        .catalog
        .get(item)
        .is_some_and(|i| i.meta.get("shelf").is_some());
    let keeps = if shelf {
        thing.kind != "currency"
            && thing.kind != "ticket"
            && thing.meta.get("account_bound").is_none()
    } else {
        thing.kind == "fish"
    };
    if !keeps {
        return Err(ApiError::bad_request(
            "not_fish",
            if shelf {
                "That can't go on a shelf."
            } else {
                "Only fish go in a tank."
            },
        ));
    }
    let holds = state
        .catalog
        .get(item)
        .and_then(|i| i.meta.get("tank"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as usize;
    if holds == 0 {
        return Err(conflict("not_tank", "That isn't a fish tank."));
    }
    if key_used(&mut tx, &req.key).await.map_err(db_err)? {
        return Ok(Json(TankDone {
            fish,
            applied: Applied {
                duplicate: true,
                ..Default::default()
            },
        }));
    }
    if fish.len() >= holds {
        return Err(conflict(
            "tank_full",
            &format!("It holds {holds} fish: it's full."),
        ));
    }
    // (The first fish in an empty tank has only just eaten.)
    let empty = fish.is_empty();
    fish.push(req.fish);
    sqlx::query("UPDATE home_objects SET fish = $4, fed_at = CASE WHEN $6 THEN now() ELSE fed_at END WHERE owner_id = $1 AND x = $2 AND y = $3 AND layer = $5 AND NOT yard")
        .bind(owner)
        .bind(req.x)
        .bind(req.y)
        .bind(&fish)
        .bind(req.layer)
        .bind(empty)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        owner,
        &[Op {
            item: req.fish,
            delta: -1,
        }],
        "tank_put",
        &req.key,
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => conflict("not_enough_items", "you don't have that fish"),
        e => e.into(),
    })?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(TankDone { fish, applied }))
}

/// When the fish last ate, and the bag's change.
#[derive(Serialize)]
struct TankFed {
    fed: i64,
    applied: Applied,
}

#[derive(Deserialize)]
struct LightReq {
    owner: String,
    x: i16,
    y: i16,
    #[serde(default)]
    layer: i16,
    on: bool,
}

/// A piece at home switched on or off: kept, so it's as it was left next time.
async fn light(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<LightReq>,
) -> ApiResult<Json<serde_json::Value>> {
    service(&state, &headers)?;
    let owner = uuid(&req.owner)?;
    sqlx::query(
        "UPDATE home_objects SET lit = $5 WHERE owner_id = $1 AND x = $2 AND y = $3 AND layer = $4 AND NOT yard",
    )
    .bind(owner)
    .bind(req.x)
    .bind(req.y)
    .bind(req.layer)
    .bind(req.on)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(serde_json::json!({ "on": req.on })))
}

/// A pinch of food for a tank's fish (free: nothing comes out of the bag).
async fn tank_feed(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<TankReq>,
) -> ApiResult<Json<TankFed>> {
    service(&state, &headers)?;
    let owner = uuid(&req.owner)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (_, fish) = tank_at(&mut tx, owner, req.x, req.y, req.layer).await?;
    if fish.is_empty() {
        return Err(conflict("tank_empty", "There's nothing in there to feed."));
    }
    let fed: i64 = sqlx::query_scalar(
        "UPDATE home_objects SET fed_at = now() WHERE owner_id = $1 AND x = $2 AND y = $3 AND layer = $4 AND NOT yard \
         RETURNING extract(epoch FROM fed_at)::bigint",
    )
    .bind(owner)
    .bind(req.x)
    .bind(req.y)
    .bind(req.layer)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(TankFed {
        fed,
        applied: Applied::default(),
    }))
}

/// A fish out of a tank, back into the bag.
async fn tank_take(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<TankReq>,
) -> ApiResult<Json<TankDone>> {
    service(&state, &headers)?;
    let owner = uuid(&req.owner)?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (_, mut fish) = tank_at(&mut tx, owner, req.x, req.y, req.layer).await?;
    if key_used(&mut tx, &req.key).await.map_err(db_err)? {
        return Ok(Json(TankDone {
            fish,
            applied: Applied {
                duplicate: true,
                ..Default::default()
            },
        }));
    }
    let i = usize::try_from(req.index)
        .ok()
        .filter(|&i| i < fish.len())
        .ok_or_else(|| conflict("no_fish", "that fish isn't in there"))?;
    let item = fish.remove(i);
    sqlx::query("UPDATE home_objects SET fish = $4 WHERE owner_id = $1 AND x = $2 AND y = $3 AND layer = $5 AND NOT yard")
        .bind(owner)
        .bind(req.x)
        .bind(req.y)
        .bind(&fish)
        .bind(req.layer)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        owner,
        &[Op { item, delta: 1 }],
        "tank_take",
        &req.key,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(TankDone { fish, applied }))
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
