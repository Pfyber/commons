//! The café's open voice (ADR 0021): inside The Cozy Cup everyone hears
//! everyone. Each instance of the `bar` zone has one LiveKit room; anyone
//! inside who has said yes (the client warns before you go in) gets a pass
//! that may talk and listen. Leave the café and you're taken out of the
//! room (the ticker, from the zones' presence reports).
//!
//! Ages: adults share the café's room. Under-16s hear nothing until
//! `COMMONS_VOICE_MINORS` is on; then those who've switched voice on share
//! a room of their own, never the adults'. Blocks: the pass comes with
//! everyone you've blocked or who's blocked you who's in the café, and the
//! client neither plays them nor lets them subscribe to you.

use crate::State as SocialState;
use crate::routes::{db_err, me};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_api::error::{ApiError, ApiResult};
use commons_common::voice;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The zone the café is.
pub const CAFE: &str = "bar";
/// How long a voice pass is good for to connect.
const PASS_SECS: u64 = 120;

/// Who's in which café voice room: the instance and the room's name.
#[derive(Default)]
pub struct Lounge(Mutex<HashMap<Uuid, (u16, String)>>);

impl Lounge {
    fn set(&self, p: Uuid, instance: u16, room: String) {
        self.0.lock().unwrap().insert(p, (instance, room));
    }
    fn take(&self, p: Uuid) -> Option<(u16, String)> {
        self.0.lock().unwrap().remove(&p)
    }
    fn all(&self) -> Vec<(Uuid, u16, String)> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|(p, (i, r))| (*p, *i, r.clone()))
            .collect()
    }
}

/// The room for an instance's adults, or its under-16s.
pub fn room(instance: u16, minor: bool) -> String {
    if minor {
        format!("cafe-{instance}-u16")
    } else {
        format!("cafe-{instance}")
    }
}

/// The café instance `p` is in, if they're in one.
fn cafe_of(state: &SocialState, p: Uuid) -> Option<u16> {
    state
        .hub
        .location(p)
        .filter(|l| l.zone == CAFE)
        .map(|l| l.instance)
}

/// Whether `p` is under 16, and has switched voice on.
async fn age(state: &SocialState, p: Uuid) -> ApiResult<voice::Talker> {
    let (minor, opted_in): (bool, bool) = sqlx::query_as(
        "SELECT (extract(year FROM now())::int - a.birth_year - 1) < 16, p.voice_ok
         FROM players p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1",
    )
    .bind(p)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| ApiError::bad_request("bad_id", "unknown player"))?;
    Ok(voice::Talker { minor, opted_in })
}

/// Why `t` can't use the café's voice, if they can't.
fn why_not(t: voice::Talker) -> Option<&'static str> {
    if !t.minor {
        return None;
    }
    if !voice::minors_enabled() {
        return Some("Voice in the café is for 16 and over for now.");
    }
    (!t.opted_in).then_some("Switch voice on in your phone's settings to talk in the café.")
}

/// Everyone `p` has blocked or been blocked by.
async fn blocks(state: &SocialState, p: Uuid) -> ApiResult<Vec<String>> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT blocked FROM blocks WHERE blocker = $1 UNION SELECT blocker FROM blocks WHERE blocked = $1",
    )
    .bind(p)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(ids.into_iter().map(|u| u.to_string()).collect())
}

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/lounge", get(status))
        .route("/lounge/join", post(join))
        .route("/lounge/leave", post(leave))
}

/// Whether you're in the café, and whether you may use its voice.
async fn status(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let Some(instance) = cafe_of(&state, me) else {
        return Ok(Json(json!({ "in_cafe": false })));
    };
    let why = why_not(age(&state, me).await?).or(state
        .livekit
        .is_none()
        .then_some("The café's voice is off just now."));
    Ok(Json(json!({
        "in_cafe": true, "instance": instance, "why_not": why,
    })))
}

/// A pass into your café's voice room: talk and listen.
async fn join(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let lk = state.livekit.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_lines",
            "The café's voice is off just now.",
        )
    })?;
    let instance = cafe_of(&state, me).ok_or_else(|| {
        ApiError::new(
            StatusCode::FORBIDDEN,
            "not_in_cafe",
            "You need to be in the café to hear it.",
        )
    })?;
    let t = age(&state, me).await?;
    if let Some(why) = why_not(t) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "age", why));
    }
    let room = room(instance, t.minor);
    // Moved to another instance (or age group): out of the old room first.
    if let Some((_, old)) = state.lounge.take(me)
        && old != room
    {
        crate::calls::remove_from_room(&state, &old, me).await;
    }
    state.lounge.set(me, instance, room.clone());
    let token = lk.token(
        &room,
        &me.to_string(),
        &claims.name,
        commons_common::now_unix(),
        PASS_SECS,
    );
    Ok(Json(json!({
        "url": lk.url, "token": token, "room": room, "instance": instance,
        "blocked": blocks(&state, me).await?,
    })))
}

/// Out of the café's voice (the client's already hung up; this makes sure).
async fn leave(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let left = match state.lounge.take(me) {
        Some((_, room)) => {
            crate::calls::remove_from_room(&state, &room, me).await;
            true
        }
        None => false,
    };
    Ok(Json(json!({ "left": left })))
}

/// Takes out of the voice room whoever's no longer in that café.
pub async fn tick(state: &SocialState) {
    for (p, instance, room) in state.lounge.all() {
        if cafe_of(state, p) != Some(instance) {
            state.lounge.take(p);
            crate::calls::remove_from_room(state, &room, p).await;
        }
    }
}

/// Runs `tick` every few seconds.
pub fn spawn_ticker(state: Arc<SocialState>) {
    tokio::spawn(async move {
        let mut t = tokio::time::interval(Duration::from_secs(5));
        loop {
            t.tick().await;
            tick(&state).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adults_and_kids_never_share_a_room() {
        assert_eq!(room(2, false), "cafe-2");
        assert_eq!(room(2, true), "cafe-2-u16");
        let adult = voice::Talker {
            minor: false,
            opted_in: false,
        };
        assert_eq!(why_not(adult), None);
        let kid = voice::Talker {
            minor: true,
            opted_in: true,
        };
        assert!(why_not(kid).is_some() || voice::minors_enabled());
    }
}
