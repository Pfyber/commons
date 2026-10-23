//! The Concert Hall (ADR 0015): one player on stage, everyone in the hall
//! listening. Each instance of the `concert_hall` zone has a stage; whoever
//! takes it gets a voice pass that may talk, everyone else in that hall a
//! listen-only one, so they hear the performer and nobody else. A set ends
//! when the performer steps down, leaves the hall, or the hour is up; then
//! they're removed from the voice room.
//!
//! Who's in which hall comes from the zones' presence reports (the hub).

use crate::State as SocialState;
use crate::db;
use crate::routes::{db_err, me};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_api::error::{ApiError, ApiResult};
use commons_common::voice::{self, Talker};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The zone the hall is.
pub const HALL: &str = "concert_hall";
/// The longest set.
pub const SET_SECS: u64 = 60 * 60;
/// How long a voice pass is good for to connect.
const PASS_SECS: u64 = 120;

/// Who's on one hall's stage, and until when (unix seconds).
#[derive(Debug, Clone, PartialEq)]
pub struct Set {
    pub performer: Uuid,
    pub name: String,
    pub since: u64,
    pub until: u64,
}

/// Every hall instance's stage.
#[derive(Default)]
pub struct Stages(Mutex<HashMap<u16, Set>>);

impl Stages {
    pub fn get(&self, instance: u16) -> Option<Set> {
        self.0.lock().unwrap().get(&instance).cloned()
    }

    /// Takes the stage if it's free (or already yours); false if someone else is on.
    pub fn take(&self, instance: u16, set: Set) -> bool {
        let mut m = self.0.lock().unwrap();
        match m.get(&instance) {
            Some(s) if s.performer != set.performer => false,
            _ => {
                m.insert(instance, set);
                true
            }
        }
    }

    /// Ends `instance`'s set, if `performer` (any, with None) is on it.
    pub fn end(&self, instance: u16, performer: Option<Uuid>) -> Option<Set> {
        let mut m = self.0.lock().unwrap();
        if performer.is_some_and(|p| m.get(&instance).is_some_and(|s| s.performer != p)) {
            return None;
        }
        m.remove(&instance)
    }

    pub fn all(&self) -> Vec<(u16, Set)> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|(i, s)| (*i, s.clone()))
            .collect()
    }
}

fn room(instance: u16) -> String {
    format!("concert-{instance}")
}

fn refuse(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, code, msg)
}

/// The hall instance `p` is in, if they're in one.
fn hall_of(state: &SocialState, p: Uuid) -> Option<u16> {
    state
        .hub
        .location(p)
        .filter(|l| l.zone == HALL)
        .map(|l| l.instance)
}

async fn talker(state: &SocialState, p: Uuid) -> ApiResult<Talker> {
    let (minor, opted_in): (bool, bool) = sqlx::query_as(
        "SELECT (extract(year FROM now())::int - a.birth_year - 1) < 16, p.voice_ok
         FROM players p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1",
    )
    .bind(p)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or_else(|| ApiError::bad_request("bad_id", "unknown player"))?;
    Ok(Talker { minor, opted_in })
}

/// Why `listener` can't hear `set`, if they can't: the age rules between
/// them, or a block either way.
async fn may_hear(
    state: &SocialState,
    listener: Uuid,
    set: &Set,
) -> ApiResult<Option<&'static str>> {
    if listener == set.performer {
        return Ok(None);
    }
    if db::blocked(&state.db, listener, set.performer)
        .await
        .map_err(db_err)?
    {
        return Ok(Some("You've blocked each other, so you won't hear them."));
    }
    let (a, b) = (
        talker(state, set.performer).await?,
        talker(state, listener).await?,
    );
    Ok(voice::may_talk(voice::minors_enabled(), a, b)
        .err()
        .map(|_| "Live voice in the Concert Hall is for 16 and over for now."))
}

fn set_json(s: &Set) -> Value {
    json!({ "performer": s.performer.to_string(), "name": s.name, "since": s.since, "until": s.until })
}

/// Tells everyone in the hall instance how the stage stands.
fn announce(state: &SocialState, instance: u16) {
    let msg = json!({
        "t": "concert", "instance": instance,
        "stage": state.concert.get(instance).as_ref().map(set_json),
    });
    for p in state.hub.in_zone(HALL, instance) {
        state.hub.send(p, &msg);
    }
}

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/concert", get(status))
        .route("/concert/stage", post(take_stage))
        .route("/concert/leave", post(leave_stage))
        .route("/concert/listen", post(listen))
}

fn lines_down() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "no_lines",
        "The hall's sound system is off just now.",
    )
}

/// How the stage stands in the hall you're in, and what you may do.
async fn status(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let Some(instance) = hall_of(&state, me) else {
        return Ok(Json(json!({ "in_hall": false })));
    };
    let set = state.concert.get(instance);
    let adult = !talker(&state, me).await?.minor;
    let hear = match &set {
        Some(s) => may_hear(&state, me, s).await?,
        None => None,
    };
    Ok(Json(json!({
        "in_hall": true, "instance": instance,
        "stage": set.as_ref().map(set_json),
        "can_perform": adult && state.livekit.is_some(),
        "why_not_perform": (!adult).then_some("Taking the stage is for 16 and over."),
        "why_not_hear": hear,
        "set_secs": SET_SECS,
    })))
}

/// Takes the stage (16 and over, in the hall, while it's free): a pass that may talk.
async fn take_stage(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let lk = state.livekit.as_ref().ok_or_else(lines_down)?;
    let instance = hall_of(&state, me).ok_or_else(|| {
        refuse(
            "not_in_hall",
            "You need to be in the Concert Hall to take the stage.",
        )
    })?;
    if talker(&state, me).await?.minor {
        return Err(refuse("age", "Taking the stage is for 16 and over."));
    }
    let now = commons_common::now_unix();
    let set = Set {
        performer: me,
        name: claims.name.clone(),
        since: now,
        until: now + SET_SECS,
    };
    // Already on: the same set (a reconnect), not a fresh hour.
    let set = match state.concert.get(instance) {
        Some(s) if s.performer == me => s,
        _ => set,
    };
    if !state.concert.take(instance, set.clone()) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "taken",
            "Someone's on stage. When they're done, it's yours.",
        ));
    }
    announce(&state, instance);
    let token = lk.token(
        &room(instance),
        &me.to_string(),
        &claims.name,
        now,
        PASS_SECS,
    );
    Ok(Json(json!({
        "url": lk.url, "token": token, "instance": instance, "stage": set_json(&set),
    })))
}

/// Steps down from the stage.
async fn leave_stage(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let mut left = false;
    for (instance, s) in state.concert.all() {
        if s.performer == me {
            end(&state, instance, Some(me)).await;
            left = true;
        }
    }
    Ok(Json(json!({ "left": left })))
}

/// A listen-only pass for whoever's on the stage of the hall you're in.
async fn listen(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let lk = state.livekit.as_ref().ok_or_else(lines_down)?;
    let instance = hall_of(&state, me).ok_or_else(|| {
        refuse(
            "not_in_hall",
            "You need to be in the Concert Hall to listen.",
        )
    })?;
    let set = state.concert.get(instance).ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "nobody",
            "Nobody's on stage just now.",
        )
    })?;
    if let Some(why) = may_hear(&state, me, &set).await? {
        return Err(refuse("not_for_you", why));
    }
    let token = lk.listen_token(
        &room(instance),
        &me.to_string(),
        &claims.name,
        commons_common::now_unix(),
        PASS_SECS,
    );
    Ok(Json(json!({
        "url": lk.url, "token": token, "instance": instance, "stage": set_json(&set),
    })))
}

/// Ends a set: off the stage, out of the voice room, and the hall told.
pub async fn end(state: &SocialState, instance: u16, performer: Option<Uuid>) {
    if let Some(s) = state.concert.end(instance, performer) {
        announce(state, instance);
        crate::calls::remove_from_room(state, &room(instance), s.performer).await;
    }
}

/// Ends the sets whose hour is up or whose performer has left the hall.
pub async fn tick(state: &SocialState, now: u64) {
    for (instance, s) in state.concert.all() {
        if now >= s.until || hall_of(state, s.performer) != Some(instance) {
            end(state, instance, Some(s.performer)).await;
        }
    }
}

/// Runs `tick` every few seconds.
pub fn spawn_ticker(state: Arc<SocialState>) {
    tokio::spawn(async move {
        let mut t = tokio::time::interval(Duration::from_secs(5));
        loop {
            t.tick().await;
            tick(&state, commons_common::now_unix()).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(p: Uuid) -> Set {
        Set {
            performer: p,
            name: "x".into(),
            since: 0,
            until: SET_SECS,
        }
    }

    #[test]
    fn one_performer_per_stage() {
        let stages = Stages::default();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert!(stages.take(1, set(a)));
        assert!(!stages.take(1, set(b)), "taken");
        assert!(stages.take(2, set(b)), "another hall's stage");
        assert!(stages.take(1, set(a)), "still yours");
        assert_eq!(
            stages.end(1, Some(b)),
            None,
            "only the performer steps down"
        );
        assert_eq!(stages.end(1, Some(a)).map(|s| s.performer), Some(a));
        assert!(stages.take(1, set(b)), "free again");
    }
}
