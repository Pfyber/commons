//! Social gateway HTTP + WebSocket routes.
//!
//! Players: `/api/social/*` (bearer access token; the socket takes it as a
//! `token` query parameter). Push messages on the socket are JSON
//! `{ "t": "presence" | "dm" | "notify" | "friends", ... }`.
//! Services: `/internal/*` (service token) for zone presence reports and the
//! orchestrator's "where is my friend / may I visit" questions.

use crate::State as SocialState;
use crate::db::{self, CLOSE_FRIEND, FRIEND, GIFT_POINTS, GiftError, RequestOutcome};
use crate::hub::Location;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_api::economy::EconError;
use commons_api::error::{ApiError, ApiResult};
use commons_common::filter::clean_chat;
use commons_common::ratelimit::Bucket;
use commons_common::token::{self, AccessClaims, ServiceClaims};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

pub fn routes() -> Router<Arc<SocialState>> {
    let player = Router::new()
        .route("/ws", get(ws))
        .route("/friends", get(friends))
        .route("/request", post(request))
        .route("/respond", post(respond))
        .route("/remove", post(remove))
        .route("/block", post(block))
        .route("/unblock", post(unblock))
        .route("/dm/{id}", get(dm_history))
        .route("/dm", post(dm))
        .route("/gift", post(gift))
        .route("/gifts", get(gifts))
        .route("/gifts/{id}/open", post(open_gift))
        .route("/invite", post(invite))
        .route("/notifications", get(notifications))
        .route("/notifications/read", post(read_notifications))
        .route("/homes", get(crate::homes::list))
        .route("/homes/claim", post(crate::homes::claim));
    let internal = Router::new()
        .route("/presence", post(presence))
        .route("/locate", get(locate))
        .route("/can_visit", get(can_visit))
        .route("/home", get(crate::homes::internal_home));
    Router::new()
        .nest("/api/social", player)
        .nest("/internal", internal)
}

pub(crate) fn db_err(e: sqlx::Error) -> ApiError {
    commons_api::store::db_err(e)
}

pub(crate) fn me(state: &SocialState, headers: &HeaderMap) -> ApiResult<(Uuid, AccessClaims)> {
    let claims = commons_api::auth::bearer_with(&state.secret, headers)?;
    let id =
        Uuid::parse_str(&claims.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    Ok((id, claims))
}

pub(crate) fn service(state: &SocialState, headers: &HeaderMap) -> ApiResult<()> {
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
    Uuid::parse_str(s).map_err(|_| ApiError::bad_request("bad_id", "unknown player"))
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

fn forbidden(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, code, msg)
}

/// Must be friends (and neither blocking the other).
async fn require_friend(state: &SocialState, a: Uuid, b: Uuid) -> ApiResult<i16> {
    if db::blocked(&state.db, a, b).await.map_err(db_err)? {
        return Err(forbidden("blocked", "you can't reach this person"));
    }
    db::level(&state.db, a, b)
        .await
        .map_err(db_err)?
        .ok_or_else(|| forbidden("not_friends", "you need to be friends first"))
}

/// Records a notification and pushes it live if they're online.
async fn notify(state: &SocialState, to: Uuid, kind: &str, body: serde_json::Value) {
    match db::notify(&state.db, to, kind, body).await {
        Ok(n) => state.hub.send(to, &json!({ "t": "notify", "n": n })),
        Err(e) => tracing::error!(error = %e, "storing notification failed"),
    }
}

/// Tells someone to refresh their friends list.
fn refresh(state: &SocialState, who: Uuid) {
    state.hub.send(who, &json!({ "t": "friends" }));
}

/// Presence as friends see it.
fn presence_msg(state: &SocialState, who: Uuid) -> serde_json::Value {
    let online = state.hub.online(who);
    let place = if online {
        state
            .hub
            .location(who)
            .map(|l| json!({ "zone": l.zone, "label": l.label }))
    } else {
        None
    };
    json!({ "t": "presence", "id": who.to_string(), "online": online, "where": place })
}

async fn broadcast_presence(state: &SocialState, who: Uuid) {
    let msg = presence_msg(state, who);
    if let Ok(friends) = db::friend_ids(&state.db, who).await {
        for f in friends {
            state.hub.send(f, &msg);
        }
    }
}

// ---- socket ---------------------------------------------------------------------

#[derive(Deserialize)]
struct WsQ {
    token: String,
}

async fn ws(State(state): S, Query(q): Query<WsQ>, upgrade: WebSocketUpgrade) -> Response {
    let Ok(claims) = token::verify::<AccessClaims>(&state.secret, &q.token) else {
        return ApiError::unauthorized("bad token").into_response();
    };
    let Ok(player) = Uuid::parse_str(&claims.sub) else {
        return ApiError::unauthorized("not a player account").into_response();
    };
    upgrade
        .max_message_size(4096)
        .on_upgrade(move |socket| session(socket, state, player))
}

async fn session(socket: WebSocket, state: Arc<SocialState>, player: Uuid) {
    let (tx, mut rx) = mpsc::channel::<String>(64);
    let (conn, first) = state.hub.connect(player, tx);
    if first {
        broadcast_presence(&state, player).await;
    }
    let (mut sink, mut stream) = socket.split();
    let _ = sink
        .send(Message::Text(json!({ "t": "hello" }).to_string().into()))
        .await;
    let writer = async {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    };
    // The socket is push-only; incoming frames are just keepalives.
    let reader = async {
        while let Some(Ok(m)) = stream.next().await {
            if matches!(m, Message::Close(_)) {
                break;
            }
        }
    };
    tokio::select! {
        _ = writer => {}
        _ = reader => {}
    }
    if state.hub.disconnect(player, conn) {
        broadcast_presence(&state, player).await;
    }
}

// ---- friends ----------------------------------------------------------------------

async fn friends(State(state): S, headers: HeaderMap) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let friends = db::friends_of(&state.db, me).await.map_err(db_err)?;
    let (incoming, outgoing, blocked) = db::requests_and_blocks(&state.db, me)
        .await
        .map_err(db_err)?;
    let friends: Vec<serde_json::Value> = friends
        .into_iter()
        .map(|f| {
            let id = Uuid::parse_str(&f.id).unwrap();
            let p = presence_msg(&state, id);
            json!({ "id": f.id, "name": f.name, "look": f.look, "level": f.level, "points": f.points,
                    "online": p["online"], "where": p["where"] })
        })
        .collect();
    Ok(Json(
        json!({ "friends": friends, "incoming": incoming, "outgoing": outgoing, "blocked": blocked }),
    ))
}

#[derive(Deserialize)]
struct NameReq {
    name: String,
}

async fn request(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, claims) = me(&state, &headers)?;
    let (other, other_name) = db::player_by_name(&state.db, &req.name)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "no_such_player",
                "Nobody here goes by that name.",
            )
        })?;
    if other == me {
        return Err(ApiError::bad_request("self", "That's you!"));
    }
    if db::blocked(&state.db, me, other).await.map_err(db_err)? {
        return Err(forbidden("blocked", "you can't reach this person"));
    }
    let outcome = db::request(&state.db, me, other).await.map_err(db_err)?;
    match outcome {
        RequestOutcome::Sent => {
            notify(
                &state,
                other,
                "friend_request",
                json!({ "from_id": me.to_string(), "from_name": claims.name }),
            )
            .await;
        }
        RequestOutcome::Accepted => {
            notify(
                &state,
                other,
                "friend_accepted",
                json!({ "from_id": me.to_string(), "from_name": claims.name }),
            )
            .await;
            refresh(&state, other);
        }
        RequestOutcome::AlreadyFriends | RequestOutcome::AlreadySent => {}
    }
    let status = match outcome {
        RequestOutcome::Sent => "sent",
        RequestOutcome::Accepted => "friends",
        RequestOutcome::AlreadyFriends => "already_friends",
        RequestOutcome::AlreadySent => "already_sent",
    };
    Ok(Json(json!({ "status": status, "name": other_name })))
}

#[derive(Deserialize)]
struct RespondReq {
    id: String,
    accept: bool,
}

async fn respond(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<RespondReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, claims) = me(&state, &headers)?;
    let from = uuid(&req.id)?;
    if req.accept {
        if !db::accept(&state.db, from, me).await.map_err(db_err)? {
            return Err(conflict("no_request", "That request is gone."));
        }
        notify(
            &state,
            from,
            "friend_accepted",
            json!({ "from_id": me.to_string(), "from_name": claims.name }),
        )
        .await;
        refresh(&state, from);
        broadcast_presence(&state, me).await;
    } else {
        db::decline(&state.db, from, me).await.map_err(db_err)?;
        refresh(&state, from);
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct IdReq {
    id: String,
}

async fn remove(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let other = uuid(&req.id)?;
    db::unfriend(&state.db, me, other).await.map_err(db_err)?;
    refresh(&state, other);
    Ok(Json(json!({ "ok": true })))
}

async fn block(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let (other, name) = db::player_by_name(&state.db, &req.name)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "no_such_player",
                "Nobody here goes by that name.",
            )
        })?;
    if other == me {
        return Err(ApiError::bad_request("self", "That's you!"));
    }
    db::block(&state.db, me, other).await.map_err(db_err)?;
    refresh(&state, other);
    Ok(Json(json!({ "ok": true, "name": name })))
}

async fn unblock(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    db::unblock(&state.db, me, uuid(&req.id)?)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

// ---- direct messages (friends only; spec §8.1, §12) -------------------------------

async fn dm_history(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<db::Dm>>> {
    let (me, _) = me(&state, &headers)?;
    let other = uuid(&id)?;
    require_friend(&state, me, other).await?;
    Ok(Json(
        db::dm_history(&state.db, me, other).await.map_err(db_err)?,
    ))
}

#[derive(Deserialize)]
struct DmReq {
    to: String,
    text: String,
}

async fn dm(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<DmReq>,
) -> ApiResult<Json<db::Dm>> {
    let (me, claims) = me(&state, &headers)?;
    let to = uuid(&req.to)?;
    require_friend(&state, me, to).await?;
    if !state.dm_limit(me) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Slow down a little.",
        ));
    }
    let text =
        clean_chat(&req.text).ok_or_else(|| ApiError::bad_request("empty", "Say something!"))?;
    let msg = db::send_dm(&state.db, me, to, &text)
        .await
        .map_err(db_err)?;
    state.hub.send(
        to,
        &json!({ "t": "dm", "m": msg, "from_name": claims.name }),
    );
    Ok(Json(msg))
}

// ---- gifts --------------------------------------------------------------------------

#[derive(Deserialize)]
struct GiftReq {
    to: String,
    item: i32,
    qty: i32,
    #[serde(default)]
    note: String,
    key: String,
}

async fn gift(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<GiftReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, claims) = me(&state, &headers)?;
    let to = uuid(&req.to)?;
    require_friend(&state, me, to).await?;
    if !(1..=99).contains(&req.qty) || req.key.is_empty() || req.key.len() > 80 {
        return Err(ApiError::bad_request("bad_request", "Invalid gift."));
    }
    let note = clean_chat(&req.note).unwrap_or_default();
    let key = format!("gift:{me}:{}", req.key);
    let applied = db::send_gift(
        &state.db,
        &state.catalog,
        &db::NewGift {
            from: me,
            to,
            item: req.item,
            qty: req.qty,
            note: &note,
            key: &key,
        },
    )
    .await
    .map_err(gift_err)?;
    if !applied.duplicate {
        let item_name = state
            .catalog
            .get(req.item)
            .map(|i| i.name.clone())
            .unwrap_or_default();
        notify(
            &state,
            to,
            "gift",
            json!({ "from_id": me.to_string(), "from_name": claims.name, "item": req.item, "item_name": item_name, "qty": req.qty }),
        )
        .await;
        if db::add_points(&state.db, me, to, GIFT_POINTS)
            .await
            .map_err(db_err)?
        {
            let body =
                |name: &str, id: Uuid| json!({ "from_id": id.to_string(), "from_name": name });
            let to_name = db::name_of(&state.db, to).await.map_err(db_err)?;
            notify(&state, to, "close_friend", body(&claims.name, me)).await;
            notify(&state, me, "close_friend", body(&to_name, to)).await;
        }
        refresh(&state, me);
        refresh(&state, to);
    }
    Ok(Json(json!({ "applied": applied })))
}

fn gift_err(e: GiftError) -> ApiError {
    match e {
        GiftError::Econ(e) => e.into(),
        GiftError::Db(e) => db_err(e),
        GiftError::NotFound => conflict("gone", "That gift was already opened."),
    }
}

async fn gifts(State(state): S, headers: HeaderMap) -> ApiResult<Json<Vec<db::Gift>>> {
    let (me, _) = me(&state, &headers)?;
    Ok(Json(
        db::unopened_gifts(&state.db, me).await.map_err(db_err)?,
    ))
}

async fn open_gift(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    let (applied, from_name) = db::open_gift(&state.db, &state.catalog, me, uuid(&id)?)
        .await
        .map_err(|e| match e {
            GiftError::Econ(EconError::Insufficient(_)) => {
                conflict("gone", "That gift was already opened.")
            }
            e => gift_err(e),
        })?;
    Ok(Json(json!({ "applied": applied, "from_name": from_name })))
}

// ---- home invites ---------------------------------------------------------------------

async fn invite(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, claims) = me(&state, &headers)?;
    let to = uuid(&req.id)?;
    require_friend(&state, me, to).await?;
    state.hub.invite(me, to);
    notify(
        &state,
        to,
        "home_invite",
        json!({ "from_id": me.to_string(), "from_name": claims.name }),
    )
    .await;
    Ok(Json(json!({ "ok": true })))
}

// ---- notifications ----------------------------------------------------------------------

async fn notifications(
    State(state): S,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<db::Notification>>> {
    let (me, _) = me(&state, &headers)?;
    Ok(Json(
        db::notifications(&state.db, me).await.map_err(db_err)?,
    ))
}

async fn read_notifications(
    State(state): S,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let (me, _) = me(&state, &headers)?;
    db::mark_read(&state.db, me).await.map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

// ---- internal ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PresenceReq {
    player: String,
    zone: String,
    zone_name: String,
    instance: u16,
    owner: Option<String>,
    present: bool,
    #[serde(default)]
    at_ms: i64,
}

/// Zone servers report arrivals and departures.
async fn presence(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<PresenceReq>,
) -> ApiResult<Json<serde_json::Value>> {
    service(&state, &headers)?;
    let player = uuid(&req.player)?;
    let label = match &req.owner {
        Some(o) if *o == req.player => "at home".to_string(),
        Some(o) => format!(
            "visiting {}'s home",
            db::name_of(&state.db, uuid(o)?).await.map_err(db_err)?
        ),
        None => format!("{} · {}", req.zone_name, req.instance),
    };
    let loc = Location {
        zone: req.zone,
        instance: req.instance,
        owner: req.owner,
        label,
    };
    if state.hub.set_location(player, loc, req.present, req.at_ms) && state.hub.online(player) {
        broadcast_presence(&state, player).await;
    }
    Ok(Json(json!({ "ok": true })))
}

/// May `guest` enter `owner`'s home? Owners, close friends, and friends with a
/// fresh invitation.
async fn visit_allowed(state: &SocialState, guest: Uuid, owner: Uuid) -> ApiResult<bool> {
    if guest == owner {
        return Ok(true);
    }
    if db::blocked(&state.db, guest, owner).await.map_err(db_err)? {
        return Ok(false);
    }
    let level = db::level(&state.db, guest, owner).await.map_err(db_err)?;
    Ok(match level {
        Some(l) if l >= CLOSE_FRIEND => true,
        Some(l) if l >= FRIEND => state.hub.invited(owner, guest),
        _ => false,
    })
}

#[derive(Deserialize)]
struct VisitQ {
    guest: String,
    owner: String,
}

async fn can_visit(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<VisitQ>,
) -> ApiResult<Json<serde_json::Value>> {
    service(&state, &headers)?;
    let (guest, owner) = (uuid(&q.guest)?, uuid(&q.owner)?);
    crate::homes::require_home(&state.db, owner).await?;
    if !visit_allowed(&state, guest, owner).await? {
        return Err(forbidden("not_invited", "You need an invitation to visit."));
    }
    Ok(Json(
        json!({ "ok": true, "owner_name": db::name_of(&state.db, owner).await.map_err(db_err)? }),
    ))
}

#[derive(Deserialize)]
struct LocateQ {
    player: String,
    friend: String,
}

/// Where can `player` join `friend`? (spec §4.1: "join friend")
async fn locate(
    State(state): S,
    headers: HeaderMap,
    Query(q): Query<LocateQ>,
) -> ApiResult<Json<Location>> {
    service(&state, &headers)?;
    let (player, friend) = (uuid(&q.player)?, uuid(&q.friend)?);
    require_friend(&state, player, friend).await?;
    let loc = state
        .hub
        .location(friend)
        .filter(|_| state.hub.online(friend))
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "offline",
                "They aren't out and about right now.",
            )
        })?;
    if let Some(owner) = &loc.owner
        && !visit_allowed(&state, player, uuid(owner)?).await?
    {
        return Err(forbidden(
            "at_home",
            "They're at home. Ask them for an invitation.",
        ));
    }
    Ok(Json(loc))
}

impl SocialState {
    /// Per-player DM rate limit: a burst of 5, then one every 2 s.
    fn dm_limit(&self, player: Uuid) -> bool {
        let mut limits = self.dm_limits.lock().unwrap();
        let now = self.started.elapsed().as_millis() as u64;
        limits
            .entry(player)
            .or_insert_with(|| Bucket::new(5.0, 0.5))
            .try_take(now)
    }
}

pub fn started() -> Instant {
    Instant::now()
}
