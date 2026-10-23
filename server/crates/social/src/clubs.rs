//! Clubs (ADR 0014, C1). A club has a name, a crest and a colour, members
//! with roles (owner, moderators, members), a board, and a treasury the
//! members donate to. The treasury pays the weekly rent on the club's room
//! in the Club Hall: a lease like a home's (`rent.rs`, kind `club_room`),
//! held in the owner's name and charged to the treasury. A club that can't
//! pay loses its room after the grace period but carries on, and can rent
//! one again.
//!
//! Founding is renting: the founder pays the first week into the treasury.
//! Members join by invitation, and only friends can invite each other.
//!
//! Players: `/api/social/clubs…`; services: `/internal/club_room` (may this
//! player enter this club's room?).

use crate::State as SocialState;
use crate::db;
use crate::rent::{self, LEASE_COLS, Lease, RENT, lease_row};
use crate::routes::{db_err, me, notify, service, uuid};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_api::economy::{COIN, EconError, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_common::filter::clean_chat;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The kind of lease a club room is (`assets/city/rent.json`).
pub const ROOM: &str = "club_room";
/// Clubs one player can be in.
pub const MAX_CLUBS: i64 = 5;
/// Crests a club can take.
pub const CRESTS: &[&str] = &[
    "🦊", "🐻", "🦉", "🐟", "🌻", "🍄", "⚓", "🎣", "📚", "🎨", "🎵", "⭐", "🌙", "🔥", "🌿", "♟️",
];
/// Club colours (banner and badge).
pub const COLORS: &[&str] = &[
    "#c8553d", "#e0943a", "#e9b949", "#5d8a4e", "#3f7a8a", "#4f6d8a", "#8a5d8a", "#6e4b30",
];
/// Posts on a club board at most.
const MAX_POST: usize = 280;

fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

fn forbidden(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, code, msg)
}

fn not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "no_club", "There's no such club.")
}

// ---- the treasury ---------------------------------------------------------------

/// Takes `amount` coins out of `club`'s treasury (once per `key`).
/// `EconError::Insufficient` if there aren't that many.
pub async fn spend(
    conn: &mut PgConnection,
    club: Uuid,
    amount: i32,
    reason: &str,
    key: &str,
) -> Result<(), EconError> {
    let fresh: Option<i64> = sqlx::query_scalar(
        "INSERT INTO club_treasury_ledger (club_id, delta, reason, key) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING RETURNING id",
    )
    .bind(club)
    .bind(-amount)
    .bind(reason)
    .bind(key)
    .fetch_optional(&mut *conn)
    .await
    .map_err(EconError::Db)?;
    if fresh.is_none() {
        return Ok(());
    }
    let paid =
        sqlx::query("UPDATE clubs SET treasury = treasury - $2 WHERE id = $1 AND treasury >= $2")
            .bind(club)
            .bind(amount)
            .execute(&mut *conn)
            .await
            .map_err(EconError::Db)?
            .rows_affected();
    if paid == 0 {
        return Err(EconError::Insufficient(COIN));
    }
    Ok(())
}

/// Moves `coins` from `player` into `club`'s treasury (once per `key`).
async fn put_in(
    conn: &mut PgConnection,
    state: &SocialState,
    club: Uuid,
    player: Uuid,
    coins: i32,
    reason: &str,
    key: &str,
) -> ApiResult<()> {
    let applied = apply(
        &mut *conn,
        &state.catalog,
        player,
        &[Op {
            item: COIN,
            delta: -coins,
        }],
        reason,
        key,
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => conflict("not_enough_coins", "Not enough coins."),
        e => e.into(),
    })?;
    if applied.duplicate {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO club_treasury_ledger (club_id, player_id, delta, reason, key) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(club)
    .bind(player)
    .bind(coins)
    .bind(reason)
    .bind(format!("in:{key}"))
    .execute(&mut *conn)
    .await
    .map_err(db_err)?;
    sqlx::query("UPDATE clubs SET treasury = treasury + $2 WHERE id = $1")
        .bind(club)
        .bind(coins)
        .execute(&mut *conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

// ---- who's who --------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Club {
    pub id: Uuid,
    pub name: String,
    pub crest: String,
    pub color: String,
    pub treasury: i32,
}

pub(crate) async fn club(db: &PgPool, id: Uuid) -> ApiResult<Club> {
    sqlx::query_as(
        "SELECT id, name, crest, color, treasury FROM clubs WHERE id = $1 AND closed_at IS NULL",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(db_err)?
    .ok_or_else(not_found)
}

/// Your role in a club, if you're in it.
async fn role_of(db: &PgPool, club: Uuid, player: Uuid) -> ApiResult<Option<String>> {
    sqlx::query_scalar("SELECT role FROM club_members WHERE club_id = $1 AND player_id = $2")
        .bind(club)
        .bind(player)
        .fetch_optional(db)
        .await
        .map_err(db_err)
}

pub(crate) async fn member_role(db: &PgPool, club: Uuid, player: Uuid) -> ApiResult<String> {
    role_of(db, club, player)
        .await?
        .ok_or_else(|| forbidden("not_member", "You're not in this club."))
}

/// Refuses anyone but the club's owner and moderators.
pub(crate) async fn require_staff(db: &PgPool, club: Uuid, player: Uuid) -> ApiResult<()> {
    match member_role(db, club, player).await?.as_str() {
        "owner" | "mod" => Ok(()),
        _ => Err(forbidden(
            "not_staff",
            "Only the club's owner and moderators can do that.",
        )),
    }
}

/// What the club's room costs a week (the smallest room's rent, with none).
pub(crate) async fn weekly_rent(db: &PgPool, club: Uuid) -> ApiResult<i32> {
    let tier = room_of(db, club).await?.map_or(1, |l| l.tier);
    Ok(RENT.tier(ROOM, tier).map_or(25, |t| t.rent))
}

/// Coins the town gives the club (a goal reached): into the treasury, once per `key`.
pub(crate) async fn reward_treasury(
    conn: &mut PgConnection,
    club: Uuid,
    coins: i32,
    reason: &str,
    key: &str,
) -> ApiResult<()> {
    let fresh: Option<i64> = sqlx::query_scalar(
        "INSERT INTO club_treasury_ledger (club_id, player_id, delta, reason, key) VALUES ($1, NULL, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING RETURNING id",
    )
    .bind(club)
    .bind(coins)
    .bind(reason)
    .bind(key)
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_err)?;
    if fresh.is_some() {
        sqlx::query("UPDATE clubs SET treasury = treasury + $2 WHERE id = $1")
            .bind(club)
            .bind(coins)
            .execute(&mut *conn)
            .await
            .map_err(db_err)?;
    }
    Ok(())
}

/// Takes `player` out of the club, their furniture in its room back to their bag.
async fn drop_member(state: &SocialState, club: Uuid, player: Uuid) -> ApiResult<()> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let left: i64 = sqlx::query_scalar("SELECT extract(epoch FROM now())::bigint")
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
    crate::clublife::return_pieces(
        &mut tx,
        state,
        club,
        Some(player),
        &format!("club_left:{club}:{left}"),
    )
    .await?;
    sqlx::query("DELETE FROM club_members WHERE club_id = $1 AND player_id = $2")
        .bind(club)
        .bind(player)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(())
}

/// A club's name, and its owner and moderators (who hear about its rent).
pub async fn staff(db: &PgPool, club: Uuid) -> sqlx::Result<(String, Vec<Uuid>)> {
    let name: String = sqlx::query_scalar("SELECT name FROM clubs WHERE id = $1")
        .bind(club)
        .fetch_one(db)
        .await?;
    let ids = sqlx::query_scalar(
        "SELECT player_id FROM club_members WHERE club_id = $1 AND role IN ('owner', 'mod')",
    )
    .bind(club)
    .fetch_all(db)
    .await?;
    Ok((name, ids))
}

async fn member_ids(db: &PgPool, club: Uuid) -> ApiResult<Vec<Uuid>> {
    sqlx::query_scalar("SELECT player_id FROM club_members WHERE club_id = $1")
        .bind(club)
        .fetch_all(db)
        .await
        .map_err(db_err)
}

/// The club's open room lease, if it has one.
async fn room_of(db: &PgPool, club: Uuid) -> ApiResult<Option<Lease>> {
    let row = sqlx::query(&format!(
        "SELECT {LEASE_COLS} FROM leases WHERE club_id = $1 AND state <> 'ended'"
    ))
    .bind(club)
    .fetch_optional(db)
    .await
    .map_err(db_err)?;
    Ok(row.as_ref().map(lease_row))
}

/// How many members the club may have: its room's tier (the smallest
/// room's, with none).
async fn cap_of(db: &PgPool, club: Uuid) -> ApiResult<i64> {
    let tier = room_of(db, club).await?.map_or(1, |l| l.tier);
    Ok(RENT.tier(ROOM, tier).and_then(|t| t.members).unwrap_or(12))
}

/// Tells every member something (live, if they're online).
fn tell_members(state: &SocialState, ids: &[Uuid], msg: &Value) {
    for &id in ids {
        state.hub.send(id, msg);
    }
}

// ---- routes ------------------------------------------------------------------------

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/clubs", get(mine))
        .route("/clubs/directory", get(directory))
        .route("/clubs/badges", get(badges))
        .route("/clubs/found", post(found))
        .route("/clubs/{id}", get(detail))
        .route("/clubs/{id}/invite", post(invite))
        .route("/clubs/{id}/answer", post(answer))
        .route("/clubs/{id}/leave", post(leave))
        .route("/clubs/{id}/remove", post(remove))
        .route("/clubs/{id}/role", post(set_role))
        .route("/clubs/{id}/donate", post(donate))
        .route("/clubs/{id}/post", post(post_board))
        .route("/clubs/{id}/posts/{post}/delete", post(delete_post))
        .route("/clubs/{id}/room", post(room))
        .route("/clubs/{id}/pay", post(pay))
        .route("/clubs/{id}/badge", post(badge))
}

pub fn internal_routes() -> Router<Arc<SocialState>> {
    Router::new().route("/club_room", get(internal_room))
}

/// Your clubs and invitations, and what founding one takes.
async fn mine(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    type Row = (Uuid, String, String, String, String, bool, i64);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT c.id, c.name, c.crest, c.color, m.role, m.badge,
                (SELECT count(*) FROM club_members x WHERE x.club_id = c.id)
         FROM club_members m JOIN clubs c ON c.id = m.club_id
         WHERE m.player_id = $1 AND c.closed_at IS NULL ORDER BY m.joined_at",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let mut clubs = vec![];
    for (id, name, crest, color, role, badge, members) in rows {
        let room = room_of(&state.db, id).await?;
        clubs.push(json!({
            "id": id.to_string(), "name": name, "crest": crest, "color": color,
            "role": role, "badge": badge, "members": members,
            "room": room.as_ref().map(Lease::json),
        }));
    }
    let invites: Vec<(Uuid, String, String, String, String)> = sqlx::query_as(
        "SELECT c.id, c.name, c.crest, c.color, p.display_name FROM club_invites i
         JOIN clubs c ON c.id = i.club_id JOIN players p ON p.id = i.invited_by
         WHERE i.player_id = $1 AND c.closed_at IS NULL ORDER BY i.at DESC",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({
        "clubs": clubs,
        "invites": invites.iter().map(|(id, name, crest, color, from)| json!({
            "id": id.to_string(), "name": name, "crest": crest, "color": color, "from": from,
        })).collect::<Vec<_>>(),
        "max": MAX_CLUBS,
        "crests": CRESTS,
        "colors": COLORS,
        "tiers": RENT.kinds.get(ROOM).map(|k| &k.tiers),
        "period_secs": RENT.period_secs,
    })))
}

/// The Club Hall's directory: clubs with a room, biggest first.
async fn directory(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    me(&state, &headers)?;
    let rows: Vec<(Uuid, String, String, String, i64)> = sqlx::query_as(
        "SELECT c.id, c.name, c.crest, c.color, count(m.player_id)
         FROM clubs c JOIN leases l ON l.club_id = c.id AND l.state <> 'ended'
         JOIN club_members m ON m.club_id = c.id
         WHERE c.closed_at IS NULL GROUP BY c.id ORDER BY count(m.player_id) DESC, c.name LIMIT 60",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({
        "clubs": rows.iter().map(|(id, name, crest, color, n)| json!({
            "id": id.to_string(), "name": name, "crest": crest, "color": color, "members": n,
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct NamesQ {
    #[serde(default)]
    names: String,
}

/// The crest each of these players shows by their name (`names` comma
/// separated), for players who show one.
async fn badges(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<NamesQ>,
) -> ApiResult<Json<Value>> {
    me(&state, &headers)?;
    let names: Vec<String> = q
        .names
        .split(',')
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .take(100)
        .map(String::from)
        .collect();
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT p.display_name, c.name, c.crest, c.color FROM club_members m
         JOIN players p ON p.id = m.player_id JOIN clubs c ON c.id = m.club_id
         WHERE m.badge AND c.closed_at IS NULL AND p.display_name = ANY($1)",
    )
    .bind(&names)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let map: serde_json::Map<String, Value> = rows
        .into_iter()
        .map(|(who, club, crest, color)| {
            (who, json!({ "club": club, "crest": crest, "color": color }))
        })
        .collect();
    Ok(Json(Value::Object(map)))
}

/// A club name: 3 to 24 letters, digits, spaces and a little punctuation,
/// nothing the chat filter would hide.
pub fn clean_name(raw: &str) -> ApiResult<String> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let n = name.chars().count();
    let ok_chars = name
        .chars()
        .all(|c| c.is_alphanumeric() || " '-&.!".contains(c));
    if !(3..=24).contains(&n) || !ok_chars {
        return Err(ApiError::bad_request(
            "bad_name",
            "A club name is 3 to 24 letters, numbers and spaces.",
        ));
    }
    if clean_chat(&name).as_deref() != Some(name.as_str()) {
        return Err(ApiError::bad_request("bad_name", "Pick a friendlier name."));
    }
    Ok(name)
}

#[derive(Deserialize)]
struct FoundReq {
    name: String,
    crest: String,
    color: String,
}

/// Founds a club: names it, and rents its first week in a club room, paid by
/// the founder into the new treasury.
async fn found(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<FoundReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let name = clean_name(&req.name)?;
    if !CRESTS.contains(&req.crest.as_str()) || !COLORS.contains(&req.color.as_str()) {
        return Err(ApiError::bad_request(
            "bad_crest",
            "Pick a crest and a colour from the list.",
        ));
    }
    let mine: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM club_members m JOIN clubs c ON c.id = m.club_id
         WHERE m.player_id = $1 AND c.closed_at IS NULL",
    )
    .bind(me)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    if mine >= MAX_CLUBS {
        return Err(conflict(
            "too_many",
            "You're in five clubs already: leave one first.",
        ));
    }
    if rent::lease_of(&state.db, me, "club")
        .await
        .map_err(db_err)?
        .is_some()
    {
        return Err(conflict(
            "has_room",
            "You already rent a club room for one of your clubs.",
        ));
    }
    let tier = RENT
        .tier(ROOM, 1)
        .ok_or_else(|| ApiError::bad_request("bad_tier", "No club rooms to rent."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let id: Uuid = match sqlx::query_scalar(
        "INSERT INTO clubs (name, crest, color, founded_by) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(&name)
    .bind(&req.crest)
    .bind(&req.color)
    .bind(me)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(e) if e.as_database_error().and_then(|d| d.constraint()) == Some("clubs_name_open") => {
            return Err(conflict(
                "name_taken",
                "There's a club with that name already.",
            ));
        }
        Err(e) => return Err(db_err(e)),
    };
    // Your first club's crest goes by your name.
    sqlx::query(
        "INSERT INTO club_members (club_id, player_id, role, badge)
         VALUES ($1, $2, 'owner', NOT EXISTS (SELECT 1 FROM club_members WHERE player_id = $2 AND badge))",
    )
    .bind(id)
    .bind(me)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    put_in(
        &mut tx,
        &state,
        id,
        me,
        tier.rent,
        "club_founding",
        &format!("found:{id}"),
    )
    .await
    .map_err(|e| {
        if e.code == "not_enough_coins" {
            conflict(
                "not_enough_coins",
                format!(
                    "A club room is {} coins a week: not enough coins yet.",
                    tier.rent
                ),
            )
        } else {
            e
        }
    })?;
    open_room(&mut tx, &state, id, me, 1).await?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "id": id.to_string(), "name": name })))
}

/// Rents a room for `club` (tier `tier`) in `holder`'s name, the first week
/// paid from the treasury.
async fn open_room(
    tx: &mut PgConnection,
    state: &SocialState,
    club: Uuid,
    holder: Uuid,
    tier: i16,
) -> ApiResult<Lease> {
    let t = RENT
        .tier(ROOM, tier)
        .ok_or_else(|| ApiError::bad_request("bad_tier", "There's no such room."))?;
    let row = sqlx::query(&format!(
        "INSERT INTO leases (kind, plot, player_id, club_id, tier, periods_paid, paid_until)
         VALUES ($1, $2, $3, $4, $5, 1, now() + make_interval(secs => $6))
         RETURNING {LEASE_COLS}"
    ))
    .bind(ROOM)
    .bind(format!("clubroom:{club}"))
    .bind(holder)
    .bind(club)
    .bind(tier)
    .bind(RENT.period_secs as f64)
    .fetch_one(&mut *tx)
    .await
    .map_err(
        |e| match e.as_database_error().and_then(|d| d.constraint()) {
            Some("leases_player_slot_open") => conflict(
                "has_room",
                "Whoever holds the lease already rents a room for another club.",
            ),
            Some("leases_club_open") | Some("leases_plot_open") => {
                conflict("has_room", "The club has a room already.")
            }
            _ => db_err(e),
        },
    )?;
    let lease = lease_row(&row);
    rent::charge_in(tx, state, &lease, t.rent, &format!("rent:{}:0", lease.id))
        .await
        .map_err(|e| match e {
            EconError::Insufficient(_) => conflict(
                "not_enough_treasury",
                format!(
                    "A {} is {} coins a week, and the treasury hasn't got it.",
                    t.name, t.rent
                ),
            ),
            e => e.into(),
        })?;
    rent::record_charge(tx, lease.id, 0, t.rent).await?;
    Ok(lease)
}

/// A club, as its members see it (others: its name, crest and size).
async fn detail(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    let role = role_of(&state.db, c.id, me).await?;
    let members: Vec<(Uuid, String, String, bool)> = sqlx::query_as(
        "SELECT m.player_id, p.display_name, m.role, m.badge FROM club_members m
         JOIN players p ON p.id = m.player_id WHERE m.club_id = $1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'mod' THEN 1 ELSE 2 END, m.joined_at",
    )
    .bind(c.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let public = json!({
        "id": c.id.to_string(), "name": c.name, "crest": c.crest, "color": c.color,
        "members": members.len(),
    });
    let Some(role) = role else {
        return Ok(Json(json!({ "club": public, "role": null })));
    };
    type PostRow = (i64, Option<String>, Option<Uuid>, String, i64);
    let posts: Vec<PostRow> = sqlx::query_as(
        "SELECT b.id, p.display_name, b.author_id, b.text, extract(epoch FROM b.at)::bigint
         FROM club_posts b LEFT JOIN players p ON p.id = b.author_id
         WHERE b.club_id = $1 ORDER BY b.at DESC LIMIT 30",
    )
    .bind(c.id)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let room = room_of(&state.db, c.id).await?;
    let my_badge = members.iter().any(|m| m.0 == me && m.3);
    Ok(Json(json!({
        "club": public,
        "role": role,
        "badge": my_badge,
        "treasury": c.treasury,
        "cap": cap_of(&state.db, c.id).await?,
        "room": room.as_ref().map(Lease::json),
        "tiers": RENT.kinds.get(ROOM).map(|k| &k.tiers),
        "members": members.iter().map(|(id, name, role, _)| json!({
            "id": id.to_string(), "name": name, "role": role, "online": state.hub.online(*id),
        })).collect::<Vec<_>>(),
        "posts": posts.iter().map(|(pid, author, author_id, text, at)| json!({
            "id": pid, "author": author, "author_id": author_id.map(|a| a.to_string()),
            "text": text, "at": at,
        })).collect::<Vec<_>>(),
        "life": crate::clublife::page(&state, &c, &members.iter().map(|m| m.0).collect::<Vec<_>>()).await?,
    })))
}

#[derive(Deserialize)]
struct IdReq {
    id: String,
}

/// Invites a friend into the club (owner and moderators).
async fn invite(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    let to = uuid(&req.id)?;
    if member_role(&state.db, c.id, me).await? == "member" {
        return Err(forbidden(
            "not_staff",
            "Only the owner and moderators invite people.",
        ));
    }
    if db::blocked(&state.db, me, to).await.map_err(db_err)?
        || db::level(&state.db, me, to)
            .await
            .map_err(db_err)?
            .is_none()
    {
        return Err(forbidden("not_friends", "You can invite your friends."));
    }
    if role_of(&state.db, c.id, to).await?.is_some() {
        return Err(conflict("already_in", "They're in the club already."));
    }
    let n = member_ids(&state.db, c.id).await?.len() as i64;
    if n >= cap_of(&state.db, c.id).await? {
        return Err(conflict(
            "full",
            "The club's full: a bigger room fits more members.",
        ));
    }
    sqlx::query(
        "INSERT INTO club_invites (club_id, player_id, invited_by) VALUES ($1, $2, $3)
         ON CONFLICT (club_id, player_id) DO UPDATE SET invited_by = $3, at = now()",
    )
    .bind(c.id)
    .bind(to)
    .bind(me)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    notify(
        &state,
        to,
        "club_invite",
        json!({ "club": c.name, "club_id": c.id.to_string(), "crest": c.crest, "from_name": claims.name }),
    )
    .await;
    Ok(Json(json!({ "invited": to.to_string() })))
}

#[derive(Deserialize)]
struct AnswerReq {
    accept: bool,
}

/// Accepts (or turns down) an invitation to a club.
async fn answer(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<AnswerReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let club_id = uuid(&id)?;
    let gone = sqlx::query("DELETE FROM club_invites WHERE club_id = $1 AND player_id = $2")
        .bind(club_id)
        .bind(me)
        .execute(&state.db)
        .await
        .map_err(db_err)?
        .rows_affected();
    if gone == 0 {
        return Err(ApiError::new(
            StatusCode::GONE,
            "no_invite",
            "That invitation has gone.",
        ));
    }
    if !req.accept {
        return Ok(Json(json!({ "joined": false })));
    }
    let c = club(&state.db, club_id).await?;
    let mine: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM club_members m JOIN clubs c ON c.id = m.club_id
         WHERE m.player_id = $1 AND c.closed_at IS NULL",
    )
    .bind(me)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    if mine >= MAX_CLUBS {
        return Err(conflict(
            "too_many",
            "You're in five clubs already: leave one first.",
        ));
    }
    let members = member_ids(&state.db, c.id).await?;
    if members.len() as i64 >= cap_of(&state.db, c.id).await? {
        return Err(conflict("full", "The club's full now, sorry."));
    }
    sqlx::query(
        "INSERT INTO club_members (club_id, player_id, role, badge)
         VALUES ($1, $2, 'member', NOT EXISTS (SELECT 1 FROM club_members WHERE player_id = $2 AND badge))
         ON CONFLICT DO NOTHING",
    )
    .bind(c.id)
    .bind(me)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    tell_members(
        &state,
        &members,
        &json!({ "t": "club", "club": c.id.to_string(), "joined": claims.name }),
    );
    Ok(Json(json!({ "joined": true, "id": c.id.to_string() })))
}

/// Leaves a club. The owner can only leave as its last member, which closes
/// the club (its room given up; the treasury goes with it).
async fn leave(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    let role = member_role(&state.db, c.id, me).await?;
    let members = member_ids(&state.db, c.id).await?;
    if role == "owner" && members.len() > 1 {
        return Err(conflict(
            "owner",
            "Make someone else the owner before you leave.",
        ));
    }
    if role == "owner" {
        if let Some(lease) = room_of(&state.db, c.id).await? {
            rent::release(&state, &lease, "closed").await?;
        }
        sqlx::query("UPDATE clubs SET closed_at = now() WHERE id = $1")
            .bind(c.id)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
    }
    drop_member(&state, c.id, me).await?;
    let rest: Vec<Uuid> = members.into_iter().filter(|m| *m != me).collect();
    tell_members(
        &state,
        &rest,
        &json!({ "t": "club", "club": c.id.to_string(), "left": claims.name }),
    );
    Ok(Json(json!({ "left": true, "closed": role == "owner" })))
}

/// Removes someone from the club: the owner anyone, moderators members.
async fn remove(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    let who = uuid(&req.id)?;
    let mine = member_role(&state.db, c.id, me).await?;
    let theirs = role_of(&state.db, c.id, who)
        .await?
        .ok_or_else(|| ApiError::bad_request("not_member", "They're not in the club."))?;
    let allowed = who != me
        && match mine.as_str() {
            "owner" => true,
            "mod" => theirs == "member",
            _ => false,
        };
    if !allowed {
        return Err(forbidden(
            "not_allowed",
            "You can't remove them from the club.",
        ));
    }
    drop_member(&state, c.id, who).await?;
    notify(
        &state,
        who,
        "club_removed",
        json!({ "club": c.name, "club_id": c.id.to_string() }),
    )
    .await;
    Ok(Json(json!({ "removed": who.to_string() })))
}

#[derive(Deserialize)]
struct RoleReq {
    id: String,
    role: String,
}

/// The owner makes someone a moderator or a member again, or hands the club
/// (and its room's lease) over to them.
async fn set_role(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<RoleReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    let who = uuid(&req.id)?;
    if member_role(&state.db, c.id, me).await? != "owner" || who == me {
        return Err(forbidden(
            "not_owner",
            "Only the owner changes who does what.",
        ));
    }
    role_of(&state.db, c.id, who)
        .await?
        .ok_or_else(|| ApiError::bad_request("not_member", "They're not in the club."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    match req.role.as_str() {
        "mod" | "member" => {
            sqlx::query("UPDATE club_members SET role = $3 WHERE club_id = $1 AND player_id = $2")
                .bind(c.id)
                .bind(who)
                .bind(&req.role)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        "owner" => {
            sqlx::query(
                "UPDATE club_members SET role = 'mod' WHERE club_id = $1 AND player_id = $2",
            )
            .bind(c.id)
            .bind(me)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
            sqlx::query(
                "UPDATE club_members SET role = 'owner' WHERE club_id = $1 AND player_id = $2",
            )
            .bind(c.id)
            .bind(who)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
            // The room's lease goes into their name.
            let moved = sqlx::query(
                "UPDATE leases SET player_id = $2 WHERE club_id = $1 AND state <> 'ended'",
            )
            .bind(c.id)
            .bind(who)
            .execute(&mut *tx)
            .await;
            if let Err(e) = moved {
                if e.as_database_error().and_then(|d| d.constraint())
                    == Some("leases_player_slot_open")
                {
                    return Err(conflict(
                        "has_room",
                        "They already rent a room for another club.",
                    ));
                }
                return Err(db_err(e));
            }
        }
        _ => {
            return Err(ApiError::bad_request(
                "bad_role",
                "A role is owner, mod or member.",
            ));
        }
    }
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "id": who.to_string(), "role": req.role })))
}

#[derive(Deserialize)]
struct DonateReq {
    coins: i32,
    key: String,
}

/// A member gives coins to the club's treasury (for its rent).
async fn donate(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<DonateReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    member_role(&state.db, c.id, me).await?;
    if !(1..=100_000).contains(&req.coins) || req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request(
            "bad_amount",
            "Give between 1 and 100,000 coins.",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    put_in(
        &mut tx,
        &state,
        c.id,
        me,
        req.coins,
        "club_donation",
        &format!("donate:{me}:{}", req.key),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    let treasury: i32 = sqlx::query_scalar("SELECT treasury FROM clubs WHERE id = $1")
        .bind(c.id)
        .fetch_one(&state.db)
        .await
        .map_err(db_err)?;
    let members = member_ids(&state.db, c.id).await?;
    tell_members(
        &state,
        &members,
        &json!({ "t": "club", "club": c.id.to_string(), "donated": claims.name, "coins": req.coins, "treasury": treasury }),
    );
    Ok(Json(json!({ "treasury": treasury })))
}

#[derive(Deserialize)]
struct PostReq {
    text: String,
}

/// Writes on the club board.
async fn post_board(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<PostReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    member_role(&state.db, c.id, me).await?;
    if claims.muted_until > commons_common::now_unix() {
        return Err(forbidden("muted", "You're muted for now."));
    }
    let text: String = req.text.chars().take(MAX_POST).collect();
    let text = clean_chat(&text)
        .ok_or_else(|| ApiError::bad_request("empty", "Write something first."))?;
    let pid: i64 = sqlx::query_scalar(
        "INSERT INTO club_posts (club_id, author_id, text) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(c.id)
    .bind(me)
    .bind(&text)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    let members = member_ids(&state.db, c.id).await?;
    tell_members(
        &state,
        &members,
        &json!({ "t": "club", "club": c.id.to_string(), "posted": claims.name }),
    );
    Ok(Json(json!({ "id": pid, "text": text })))
}

/// Takes a post down: its author, or the owner and moderators.
async fn delete_post(
    State(state): S,
    headers: HeaderMap,
    Path((id, post)): Path<(String, i64)>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    let role = member_role(&state.db, c.id, me).await?;
    let staff = role != "member";
    let gone = sqlx::query(
        "DELETE FROM club_posts WHERE id = $1 AND club_id = $2 AND ($3 OR author_id = $4)",
    )
    .bind(post)
    .bind(c.id)
    .bind(staff)
    .bind(me)
    .execute(&state.db)
    .await
    .map_err(db_err)?
    .rows_affected();
    if gone == 0 {
        return Err(forbidden("not_allowed", "You can't take that one down."));
    }
    Ok(Json(json!({ "deleted": post })))
}

#[derive(Deserialize)]
struct RoomReq {
    tier: i16,
}

/// The owner rents a room for the club (if it has none) or moves it to
/// another tier: up, paying the difference for this week from the
/// treasury; down, free if the members still fit.
async fn room(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<RoomReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    if member_role(&state.db, c.id, me).await? != "owner" {
        return Err(forbidden("not_owner", "Only the owner rents the room."));
    }
    let new = RENT
        .tier(ROOM, req.tier)
        .ok_or_else(|| ApiError::bad_request("bad_tier", "There's no such room."))?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let Some(lease) = room_of(&state.db, c.id).await? else {
        let lease = open_room(&mut tx, &state, c.id, me, req.tier).await?;
        tx.commit().await.map_err(db_err)?;
        return Ok(Json(json!({ "room": lease.json() })));
    };
    if lease.state == "grace" {
        return Err(conflict("unpaid", "Pay this week's rent first."));
    }
    let old = lease.tier_info();
    if new.tier == old.tier {
        return Ok(Json(json!({ "room": lease.json() })));
    }
    if new.rent > old.rent {
        let key = format!("tier:{}:{}:{}", lease.id, lease.periods_paid, new.tier);
        rent::charge_in(&mut tx, &state, &lease, new.rent - old.rent, &key)
            .await
            .map_err(|e| match e {
                EconError::Insufficient(_) => conflict(
                    "not_enough_treasury",
                    format!(
                        "Moving up to a {} costs {} coins this week, and the treasury hasn't got it.",
                        new.name,
                        new.rent - old.rent
                    ),
                ),
                e => e.into(),
            })?;
    } else {
        let n = member_ids(&state.db, c.id).await?.len() as i64;
        let cap = new.members.unwrap_or(0);
        if n > cap {
            return Err(conflict(
                "too_full",
                format!("A {} fits {cap} members; the club has {n}.", new.name),
            ));
        }
    }
    sqlx::query("UPDATE leases SET tier = $2 WHERE id = $1")
        .bind(lease.id)
        .bind(new.tier)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    let lease = room_of(&state.db, c.id).await?.ok_or_else(not_found)?;
    Ok(Json(json!({ "room": lease.json() })))
}

/// Pays overdue rent from the treasury now (owner and moderators).
async fn pay(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    if member_role(&state.db, c.id, me).await? == "member" {
        return Err(forbidden(
            "not_staff",
            "The owner and moderators pay the rent.",
        ));
    }
    let lease = room_of(&state.db, c.id)
        .await?
        .ok_or_else(|| conflict("no_room", "The club has no room to pay for."))?;
    if lease.state != "grace" {
        return Err(conflict("paid", "The rent is paid."));
    }
    if !rent::renew(&state, &lease).await? {
        return Err(conflict(
            "not_enough_treasury",
            format!(
                "The rent is {} coins and the treasury hasn't got it: ask the members to chip in.",
                lease.tier_info().rent
            ),
        ));
    }
    let lease = room_of(&state.db, c.id).await?.ok_or_else(not_found)?;
    Ok(Json(json!({ "room": lease.json() })))
}

/// Shows this club's crest by your name (instead of another club's).
async fn badge(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = club(&state.db, uuid(&id)?).await?;
    member_role(&state.db, c.id, me).await?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    sqlx::query("UPDATE club_members SET badge = false WHERE player_id = $1")
        .bind(me)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("UPDATE club_members SET badge = true WHERE club_id = $1 AND player_id = $2")
        .bind(c.id)
        .bind(me)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "badge": c.id.to_string() })))
}

#[derive(Deserialize)]
struct RoomQ {
    player: String,
    club: String,
}

/// For the orchestrator: may this player enter this club's room? (A member,
/// and the club has a room.) Answers with the club's name.
async fn internal_room(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<RoomQ>,
) -> ApiResult<Json<Value>> {
    service(&state, &headers)?;
    let c = club(&state.db, uuid(&q.club)?).await?;
    member_role(&state.db, c.id, uuid(&q.player)?).await?;
    if room_of(&state.db, c.id).await?.is_none() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "no_room",
            "The club has no room just now: its owner can rent one at the Club Hall.",
        ));
    }
    Ok(Json(
        json!({ "name": c.name, "crest": c.crest, "color": c.color }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn club_names_are_tidy_and_friendly() {
        assert_eq!(
            clean_name("  The   Night  Owls ").unwrap(),
            "The Night Owls"
        );
        assert_eq!(clean_name("Fish & Chips!").unwrap(), "Fish & Chips!");
        assert!(clean_name("ab").is_err());
        assert!(clean_name(&"x".repeat(25)).is_err());
        assert!(clean_name("<script>").is_err());
        assert!(clean_name("shit club").is_err());
    }
}
