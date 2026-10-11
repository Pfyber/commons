//! Economy service (spec §4.1, §8.4): the only place items and coins change.
//!
//! Every mutation runs in a Postgres transaction and writes one append-only
//! `economy_ledger` row per item delta, keyed by a caller-supplied
//! idempotency key (`<key>#<n>`), so retries never double-grant. Inventory
//! can't go negative (a CHECK constraint), which is how "not enough coins"
//! is detected atomically.

use crate::AppState;
use crate::auth::bearer;
use crate::error::{ApiError, ApiResult};
use crate::store::{db_err, is_unique_violation};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::Rng;
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub const COIN: i32 = 1;
/// Coins and seeds every new player starts with.
pub const WELCOME: &[(i32, i32)] = &[(COIN, 100), (200, 3)];
/// Kinds that count towards the album.
const COLLECTABLE: &[&str] = &["fish", "plant", "junk"];

#[derive(Debug, Clone, Serialize)]
pub struct Item {
    pub id: i32,
    pub key: String,
    pub kind: String,
    pub name: String,
    pub rarity: i16,
    pub meta: serde_json::Value,
}

impl Item {
    fn meta_i64(&self, k: &str) -> Option<i64> {
        self.meta.get(k).and_then(|v| v.as_i64())
    }
    pub fn sell(&self) -> Option<i64> {
        self.meta_i64("sell")
    }
    pub fn buy(&self) -> Option<i64> {
        self.meta_i64("buy")
    }
    /// For seeds: the plant they grow into.
    pub fn grows(&self) -> Option<i32> {
        self.meta_i64("grows").map(|v| v as i32)
    }
    /// For plants: the seed they sometimes return.
    pub fn seed(&self) -> Option<i32> {
        self.meta_i64("seed").map(|v| v as i32)
    }
}

/// The item catalogue, loaded once at startup.
pub struct Catalog {
    pub items: Vec<Item>,
    by_id: HashMap<i32, usize>,
}

impl Catalog {
    pub async fn load(db: &PgPool) -> sqlx::Result<Self> {
        let rows = sqlx::query(
            "SELECT id, key, kind, name, rarity, meta FROM items WHERE key IS NOT NULL ORDER BY id",
        )
        .fetch_all(db)
        .await?;
        let items: Vec<Item> = rows
            .iter()
            .map(|r| Item {
                id: r.get("id"),
                key: r.get("key"),
                kind: r.get("kind"),
                name: r.get("name"),
                rarity: r.get("rarity"),
                meta: r.get("meta"),
            })
            .collect();
        let by_id = items.iter().enumerate().map(|(i, it)| (it.id, i)).collect();
        Ok(Catalog { items, by_id })
    }

    pub fn get(&self, id: i32) -> Option<&Item> {
        self.by_id.get(&id).map(|&i| &self.items[i])
    }

    pub fn of_kind<'a>(&'a self, kind: &'a str) -> impl Iterator<Item = &'a Item> + 'a {
        self.items.iter().filter(move |i| i.kind == kind)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Op {
    pub item: i32,
    pub delta: i32,
}

#[derive(Debug, Default, Serialize)]
pub struct Applied {
    /// The key was already used; nothing changed.
    pub duplicate: bool,
    /// New inventory totals for the items touched.
    pub totals: Vec<(i32, i32)>,
    /// Positive deltas applied (what the player received).
    pub added: Vec<(i32, i32)>,
    /// Items collected for the first time (new album entries).
    pub firsts: Vec<i32>,
}

#[derive(Debug)]
pub enum EconError {
    Insufficient(i32),
    UnknownItem(i32),
    /// Lost an idempotency race; `apply_tx` reports it as a duplicate.
    Race,
    Db(sqlx::Error),
}

impl From<EconError> for ApiError {
    fn from(e: EconError) -> Self {
        match e {
            EconError::Insufficient(COIN) => ApiError::new(
                StatusCode::CONFLICT,
                "not_enough_coins",
                "Not enough coins.",
            ),
            EconError::Insufficient(_) => ApiError::new(
                StatusCode::CONFLICT,
                "not_enough_items",
                "You don't have enough of that.",
            ),
            EconError::UnknownItem(_) => ApiError::bad_request("unknown_item", "No such item."),
            EconError::Race => ApiError::new(StatusCode::CONFLICT, "retry", "Please try again."),
            EconError::Db(e) => db_err(e),
        }
    }
}

pub async fn totals(
    conn: &mut PgConnection,
    player: Uuid,
    items: &[i32],
) -> sqlx::Result<Vec<(i32, i32)>> {
    let rows = sqlx::query(
        "SELECT item_id, qty FROM inventory WHERE player_id = $1 AND item_id = ANY($2)",
    )
    .bind(player)
    .bind(items)
    .fetch_all(&mut *conn)
    .await?;
    let have: HashMap<i32, i32> = rows
        .iter()
        .map(|r| (r.get("item_id"), r.get("qty")))
        .collect();
    Ok(items
        .iter()
        .map(|i| (*i, have.get(i).copied().unwrap_or(0)))
        .collect())
}

pub async fn key_used(conn: &mut PgConnection, key: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM economy_ledger WHERE idempotency_key = $1)")
        .bind(format!("{key}#0"))
        .fetch_one(conn)
        .await
}

/// Applies `ops` atomically within the caller's transaction. On error the
/// caller must roll back (dropping the transaction does).
pub async fn apply(
    conn: &mut PgConnection,
    catalog: &Catalog,
    player: Uuid,
    ops: &[Op],
    reason: &str,
    key: &str,
) -> Result<Applied, EconError> {
    if key_used(conn, key).await.map_err(EconError::Db)? {
        let items: Vec<i32> = ops.iter().map(|o| o.item).collect();
        let totals = totals(conn, player, &items).await.map_err(EconError::Db)?;
        return Ok(Applied {
            duplicate: true,
            totals,
            ..Default::default()
        });
    }
    let mut out = Applied::default();
    for (n, op) in ops.iter().enumerate() {
        let item = catalog
            .get(op.item)
            .ok_or(EconError::UnknownItem(op.item))?;
        let r = sqlx::query("INSERT INTO economy_ledger (player_id, item_id, delta, reason, idempotency_key) VALUES ($1, $2, $3, $4, $5)")
            .bind(player)
            .bind(op.item)
            .bind(op.delta)
            .bind(reason)
            .bind(format!("{key}#{n}"))
            .execute(&mut *conn)
            .await;
        if let Err(e) = r {
            // A concurrent request with the same key committed first.
            return Err(if is_unique_violation(&e) {
                EconError::Race
            } else {
                EconError::Db(e)
            });
        }
        // Spending updates the existing row (an upsert would check the
        // constraint against the negative insert row first); a missing row or
        // a negative result means there wasn't enough.
        let qty: Result<Option<i32>, sqlx::Error> = if op.delta < 0 {
            sqlx::query_scalar("UPDATE inventory SET qty = qty + $3 WHERE player_id = $1 AND item_id = $2 RETURNING qty")
                .bind(player)
                .bind(op.item)
                .bind(op.delta)
                .fetch_optional(&mut *conn)
                .await
        } else {
            sqlx::query_scalar(
                "INSERT INTO inventory (player_id, item_id, qty) VALUES ($1, $2, $3)
                 ON CONFLICT (player_id, item_id) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty
                 RETURNING qty",
            )
            .bind(player)
            .bind(op.item)
            .bind(op.delta)
            .fetch_optional(&mut *conn)
            .await
        };
        let qty = match qty {
            Ok(Some(q)) => q,
            Ok(None) => return Err(EconError::Insufficient(op.item)),
            Err(e) if e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23514") => {
                return Err(EconError::Insufficient(op.item));
            }
            Err(e) => return Err(EconError::Db(e)),
        };
        out.totals.push((op.item, qty));
        if op.delta > 0 {
            out.added.push((op.item, op.delta));
        }
        if op.delta > 0 && COLLECTABLE.contains(&item.kind.as_str()) {
            let first: bool = sqlx::query_scalar(
                "INSERT INTO collection (player_id, item_id, total) VALUES ($1, $2, $3)
                 ON CONFLICT (player_id, item_id) DO UPDATE SET total = collection.total + EXCLUDED.total
                 RETURNING (xmax = 0)",
            )
            .bind(player)
            .bind(op.item)
            .bind(op.delta)
            .fetch_one(&mut *conn)
            .await
            .map_err(EconError::Db)?;
            if first {
                out.firsts.push(op.item);
            }
        }
    }
    Ok(out)
}

/// `apply` in its own transaction.
pub async fn apply_tx(
    db: &PgPool,
    catalog: &Catalog,
    player: Uuid,
    ops: &[Op],
    reason: &str,
    key: &str,
) -> Result<Applied, EconError> {
    let mut tx = db.begin().await.map_err(EconError::Db)?;
    match apply(&mut tx, catalog, player, ops, reason, key).await {
        Ok(out) => {
            tx.commit().await.map_err(EconError::Db)?;
            Ok(out)
        }
        Err(EconError::Race) => {
            drop(tx);
            let mut conn = db.acquire().await.map_err(EconError::Db)?;
            let items: Vec<i32> = ops.iter().map(|o| o.item).collect();
            let totals = totals(&mut conn, player, &items)
                .await
                .map_err(EconError::Db)?;
            Ok(Applied {
                duplicate: true,
                totals,
                ..Default::default()
            })
        }
        Err(e) => Err(e),
    }
}

// ---- public routes ------------------------------------------------------------

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/catalog", get(catalog))
        .route("/inventory", get(inventory))
        .route("/album", get(album))
        .route("/market/sell", post(sell))
        .route("/market/buy", post(buy))
        .route("/daily", post(daily))
}

fn player_uuid(state: &AppState, headers: &HeaderMap) -> ApiResult<Uuid> {
    let who = bearer(state, headers)?;
    Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))
}

async fn catalog(State(state): S) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "items": state.catalog.items }))
}

#[derive(Serialize)]
struct Stack {
    item: i32,
    qty: i32,
}

async fn inventory(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = player_uuid(&state, &headers)?;
    let rows = sqlx::query(
        "SELECT item_id, qty FROM inventory WHERE player_id = $1 AND qty > 0 ORDER BY item_id",
    )
    .bind(player)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let items: Vec<Stack> = rows
        .iter()
        .map(|r| Stack {
            item: r.get("item_id"),
            qty: r.get("qty"),
        })
        .collect();
    Ok(Json(serde_json::json!({ "items": items })))
}

async fn album(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = player_uuid(&state, &headers)?;
    let rows = sqlx::query(
        "SELECT item_id, total, extract(epoch FROM first_at)::bigint AS first_at FROM collection WHERE player_id = $1 ORDER BY item_id",
    )
    .bind(player)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| serde_json::json!({ "item": r.get::<i32, _>("item_id"), "total": r.get::<i32, _>("total"), "first_at": r.get::<i64, _>("first_at") }))
        .collect();
    Ok(Json(serde_json::json!({ "entries": entries })))
}

#[derive(Deserialize)]
struct TradeReq {
    item: i32,
    qty: i32,
    /// Client-generated idempotency key (e.g. a UUID per button press).
    key: String,
}

fn check_trade(req: &TradeReq) -> ApiResult<()> {
    if !(1..=99).contains(&req.qty) || req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid trade."));
    }
    Ok(())
}

async fn sell(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<TradeReq>,
) -> ApiResult<Json<Applied>> {
    let player = player_uuid(&state, &headers)?;
    check_trade(&req)?;
    let price = state
        .catalog
        .get(req.item)
        .and_then(Item::sell)
        .ok_or_else(|| ApiError::bad_request("not_for_sale", "The market doesn't buy that."))?;
    let ops = [
        Op {
            item: req.item,
            delta: -req.qty,
        },
        Op {
            item: COIN,
            delta: (price * req.qty as i64) as i32,
        },
    ];
    let key = format!("sell:{player}:{}", req.key);
    Ok(Json(
        apply_tx(&state.db, &state.catalog, player, &ops, "market_sell", &key).await?,
    ))
}

async fn buy(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<TradeReq>,
) -> ApiResult<Json<Applied>> {
    let player = player_uuid(&state, &headers)?;
    check_trade(&req)?;
    let price = state
        .catalog
        .get(req.item)
        .and_then(Item::buy)
        .ok_or_else(|| ApiError::bad_request("not_sold", "The market doesn't sell that."))?;
    let ops = [
        Op {
            item: COIN,
            delta: -(price * req.qty as i64) as i32,
        },
        Op {
            item: req.item,
            delta: req.qty,
        },
    ];
    let key = format!("buy:{player}:{}", req.key);
    Ok(Json(
        apply_tx(&state.db, &state.catalog, player, &ops, "market_buy", &key).await?,
    ))
}

/// A small daily gift (spec §8.3): one random seed per UTC day, no streaks.
async fn daily(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let player = player_uuid(&state, &headers)?;
    let day = chrono::Utc::now().format("%Y-%m-%d");
    let seeds: Vec<i32> = state.catalog.of_kind("seed").map(|i| i.id).collect();
    let seed = *seeds
        .choose(&mut rand::rng())
        .ok_or_else(|| ApiError::bad_request("no_seeds", "No gifts today."))?;
    let qty = rand::rng().random_range(1..=2);
    let key = format!("daily:{player}:{day}");
    let applied = apply_tx(
        &state.db,
        &state.catalog,
        player,
        &[Op {
            item: seed,
            delta: qty,
        }],
        "daily_gift",
        &key,
    )
    .await?;
    if applied.duplicate {
        return Ok(Json(serde_json::json!({ "granted": null })));
    }
    Ok(Json(
        serde_json::json!({ "granted": { "item": seed, "qty": qty } }),
    ))
}
