//! Furniture in a club room (ADR 0014, C2), for the zone server: members
//! place pieces from their own bags, up to the room's tier. A piece stays
//! its placer's: picking it up (they, or the club's owner or a moderator)
//! puts it back in the placer's bag.

use crate::AppState;
use crate::economy::{Applied, EconError, Op, apply, key_used};
use crate::error::{ApiError, ApiResult};
use crate::internal::{HomeObject, conflict, service, uuid};
use crate::store::{db_err, is_unique_violation};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<AppState>>;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/club/{club}/objects", get(objects))
        .route("/club/place", post(place))
        .route("/club/pickup", post(pickup))
}

async fn objects(
    State(state): S,
    headers: HeaderMap,
    Path(club): Path<String>,
) -> ApiResult<Json<Vec<HomeObject>>> {
    service(&state, &headers)?;
    let club = uuid(&club)?;
    let rows = sqlx::query("SELECT x, y, item_id FROM club_objects WHERE club_id = $1")
        .bind(club)
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

/// The player's role in the club (None: not a member, or it's closed).
async fn role(tx: &mut sqlx::PgConnection, club: Uuid, player: Uuid) -> ApiResult<Option<String>> {
    sqlx::query_scalar(
        "SELECT m.role FROM club_members m JOIN clubs c ON c.id = m.club_id
         WHERE m.club_id = $1 AND m.player_id = $2 AND c.closed_at IS NULL",
    )
    .bind(club)
    .bind(player)
    .fetch_optional(tx)
    .await
    .map_err(db_err)
}

#[derive(Deserialize)]
struct PlaceReq {
    club: String,
    player: String,
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
    let (club, player) = (uuid(&req.club)?, uuid(&req.player)?);
    if state.catalog.get(req.item).map(|i| i.kind.as_str()) != Some("furniture") {
        return Err(ApiError::bad_request(
            "not_furniture",
            "that can't be placed",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if !key_used(&mut tx, &req.key).await.map_err(db_err)? {
        if role(&mut tx, club, player).await?.is_none() {
            return Err(conflict(
                "not_member",
                "only the club's members can arrange its room",
            ));
        }
        // How much the room holds depends on its tier.
        let tier: Option<i16> =
            sqlx::query_scalar("SELECT tier FROM leases WHERE club_id = $1 AND state <> 'ended'")
                .bind(club)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_err)?;
        let tier = tier.ok_or_else(|| conflict("no_room", "the club has no room just now"))?;
        let rent = commons_sim::city::rent_catalog();
        let t = rent
            .tier("club_room", tier)
            .ok_or_else(|| conflict("no_room", "the club has no room just now"))?;
        let placed: i64 =
            sqlx::query_scalar("SELECT count(*) FROM club_objects WHERE club_id = $1")
                .bind(club)
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
        let cap = t.furniture.unwrap_or(0);
        if placed >= cap {
            return Err(conflict(
                "room_full",
                &format!(
                    "the {} has room for {cap} pieces; a bigger room holds more",
                    t.name
                ),
            ));
        }
        let r = sqlx::query(
            "INSERT INTO club_objects (club_id, x, y, item_id, placed_by) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(club)
        .bind(req.x)
        .bind(req.y)
        .bind(req.item)
        .bind(player)
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
        player,
        &[Op {
            item: req.item,
            delta: -1,
        }],
        "club_place",
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
    club: String,
    player: String,
    x: i16,
    y: i16,
    key: String,
}

/// What `pickup` hands back: the bag update, for the player who picked the
/// piece up only if it was theirs (otherwise it went to its placer's bag).
#[derive(serde::Serialize, Default)]
struct PickedUp {
    #[serde(flatten)]
    applied: Applied,
    /// Whose bag the piece went back to.
    to: String,
}

async fn pickup(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PickupReq>,
) -> ApiResult<Json<PickedUp>> {
    service(&state, &headers)?;
    let (club, player) = (uuid(&req.club)?, uuid(&req.player)?);
    let mut tx = state.db.begin().await.map_err(db_err)?;
    if key_used(&mut tx, &req.key).await.map_err(db_err)? {
        return Ok(Json(PickedUp {
            applied: Applied {
                duplicate: true,
                ..Default::default()
            },
            to: player.to_string(),
        }));
    }
    let role = role(&mut tx, club, player)
        .await?
        .ok_or_else(|| conflict("not_member", "only the club's members can arrange its room"))?;
    let piece: Option<(i32, Uuid)> = sqlx::query_as(
        "SELECT item_id, placed_by FROM club_objects WHERE club_id = $1 AND x = $2 AND y = $3 FOR UPDATE",
    )
    .bind(club)
    .bind(req.x)
    .bind(req.y)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?;
    let (item, placer) = piece.ok_or_else(|| conflict("empty", "nothing to pick up there"))?;
    if placer != player && role == "member" {
        return Err(conflict(
            "not_yours",
            "that's someone else's: they, the owner or a moderator can move it",
        ));
    }
    sqlx::query("DELETE FROM club_objects WHERE club_id = $1 AND x = $2 AND y = $3")
        .bind(club)
        .bind(req.x)
        .bind(req.y)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        placer,
        &[Op { item, delta: 1 }],
        "club_pickup",
        &req.key,
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(PickedUp {
        applied,
        to: placer.to_string(),
    }))
}
