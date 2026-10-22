//! Phone calls (ADR 0013). Friends who both own a phone can call each
//! other. Anyone in a call can ring another friend into it, up to
//! `MAX_IN_CALL` people. Answering a call while you're in another moves you
//! over (the other call carries on without you). The voice itself goes
//! through LiveKit: this gateway rings people, keeps track of who's in which
//! call, and hands out short-lived passes to the call's room. The age rules
//! (`commons_common::voice`) are checked against everyone in the call.
//!
//! Pushed on the social socket: `call_ring` (someone's ringing you),
//! `call` (who's in your call now), `call_declined`, `call_unanswered` and
//! `call_ended`.

use crate::State as SocialState;
use crate::db;
use crate::routes::{db_err, me, uuid};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_api::error::{ApiError, ApiResult};
use commons_common::ratelimit::Bucket;
use commons_common::voice::{self, MAX_IN_CALL, Talker};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The phone (item id, migration 0029).
pub const PHONE: i32 = 950;
/// How long a phone rings before it gives up.
pub const RING_FOR: Duration = Duration::from_secs(30);
/// How long a pass to a call's room is good for (to connect).
const PASS_SECS: u64 = 120;

#[derive(Debug, Default)]
struct Call {
    members: Vec<Uuid>,
    /// Ringing: who, rung by whom, since when.
    ringing: HashMap<Uuid, (Uuid, Instant)>,
}

#[derive(Default)]
struct Inner {
    calls: HashMap<Uuid, Call>,
    /// The call each player is in.
    of: HashMap<Uuid, Uuid>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CallError {
    Full,
    AlreadyIn,
    NotRinging,
}

/// What changed when someone left: the call, who's still in it, and
/// whether it ended (then `members` were in it at the end, and are out now).
#[derive(Debug, PartialEq, Eq)]
pub struct Left {
    pub call: Uuid,
    pub members: Vec<Uuid>,
    pub ended: bool,
}

/// Who's in which call (in memory, like presence).
#[derive(Default)]
pub struct Calls(Mutex<Inner>);

impl Calls {
    pub fn call_of(&self, p: Uuid) -> Option<Uuid> {
        self.0.lock().unwrap().of.get(&p).copied()
    }

    pub fn members(&self, call: Uuid) -> Vec<Uuid> {
        let h = self.0.lock().unwrap();
        h.calls
            .get(&call)
            .map(|c| c.members.clone())
            .unwrap_or_default()
    }

    /// Everyone in the call and everyone being rung into it.
    pub fn everyone(&self, call: Uuid) -> Vec<Uuid> {
        let h = self.0.lock().unwrap();
        h.calls
            .get(&call)
            .map(|c| c.members.iter().chain(c.ringing.keys()).copied().collect())
            .unwrap_or_default()
    }

    /// Your call, or a new one with just you in it.
    pub fn open(&self, p: Uuid) -> Uuid {
        let mut h = self.0.lock().unwrap();
        if let Some(&c) = h.of.get(&p) {
            return c;
        }
        let id = Uuid::new_v4();
        h.calls.insert(
            id,
            Call {
                members: vec![p],
                ringing: HashMap::new(),
            },
        );
        h.of.insert(p, id);
        id
    }

    /// Rings `who` into `call`, by `by`.
    pub fn ring(&self, call: Uuid, who: Uuid, by: Uuid, now: Instant) -> Result<(), CallError> {
        let mut h = self.0.lock().unwrap();
        let c = h.calls.get_mut(&call).ok_or(CallError::NotRinging)?;
        if c.members.contains(&who) {
            return Err(CallError::AlreadyIn);
        }
        if c.members.len() + c.ringing.len() >= MAX_IN_CALL {
            return Err(CallError::Full);
        }
        c.ringing.insert(who, (by, now));
        Ok(())
    }

    /// `who` answers `call`: out of any other call, into this one. Returns
    /// what happened to the call they left, if any.
    pub fn answer(&self, call: Uuid, who: Uuid) -> Result<Option<Left>, CallError> {
        {
            let h = self.0.lock().unwrap();
            let rung = h
                .calls
                .get(&call)
                .is_some_and(|c| c.ringing.contains_key(&who));
            if !rung {
                return Err(CallError::NotRinging);
            }
        }
        let left = match self.call_of(who) {
            Some(old) if old != call => self.leave(who),
            _ => None,
        };
        let mut h = self.0.lock().unwrap();
        let c = h.calls.get_mut(&call).ok_or(CallError::NotRinging)?;
        c.ringing.remove(&who);
        if !c.members.contains(&who) {
            c.members.push(who);
        }
        h.of.insert(who, call);
        Ok(left)
    }

    /// `who` turns down `call`; returns who rang them, and the call's end
    /// if nobody's left to talk to.
    pub fn decline(&self, call: Uuid, who: Uuid) -> Option<(Uuid, Option<Left>)> {
        let mut h = self.0.lock().unwrap();
        let c = h.calls.get_mut(&call)?;
        let (by, _) = c.ringing.remove(&who)?;
        let ended = Self::end_if_alone(&mut h, call);
        Some((by, ended))
    }

    /// `p` hangs up (or goes offline).
    pub fn leave(&self, p: Uuid) -> Option<Left> {
        let mut h = self.0.lock().unwrap();
        let call = h.of.remove(&p)?;
        let c = h.calls.get_mut(&call)?;
        c.members.retain(|m| *m != p);
        // Rings they started into this call stop too.
        c.ringing.retain(|_, (by, _)| *by != p);
        if let Some(end) = Self::end_if_alone(&mut h, call) {
            return Some(end);
        }
        let members = h
            .calls
            .get(&call)
            .map(|c| c.members.clone())
            .unwrap_or_default();
        Some(Left {
            call,
            members,
            ended: false,
        })
    }

    /// A call down to one person with nobody being rung is over.
    fn end_if_alone(h: &mut Inner, call: Uuid) -> Option<Left> {
        let c = h.calls.get(&call)?;
        if c.members.len() > 1 || !c.ringing.is_empty() {
            return None;
        }
        let c = h.calls.remove(&call)?;
        for m in &c.members {
            h.of.remove(m);
        }
        Some(Left {
            call,
            members: c.members,
            ended: true,
        })
    }

    /// Rings that have gone on too long: (call, who, rung by), and the ends
    /// of calls that leaves empty.
    pub fn expire(&self, now: Instant) -> (Vec<(Uuid, Uuid, Uuid)>, Vec<Left>) {
        let mut h = self.0.lock().unwrap();
        let mut gone = vec![];
        for (&call, c) in h.calls.iter_mut() {
            c.ringing.retain(|&who, &mut (by, at)| {
                let keep = now.duration_since(at) < RING_FOR;
                if !keep {
                    gone.push((call, who, by));
                }
                keep
            });
        }
        let calls: Vec<Uuid> = gone.iter().map(|g| g.0).collect();
        let ended = calls
            .into_iter()
            .filter_map(|c| Self::end_if_alone(&mut h, c))
            .collect();
        (gone, ended)
    }
}

// ---- who may call whom --------------------------------------------------------------

async fn has_phone(state: &SocialState, p: Uuid) -> ApiResult<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM inventory WHERE player_id = $1 AND item_id = $2 AND qty > 0)",
    )
    .bind(p)
    .bind(PHONE)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)
}

/// A player as the age rules see them (under 16 by birth year, as sign-in
/// does, and whether they've switched calls on).
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

fn refuse(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, code, msg)
}

/// Why `who` can't be in a call with `with` (friends of whoever rings them,
/// nobody blocking anybody, the age rules), if they can't.
async fn may_join(state: &SocialState, who: Uuid, with: &[Uuid]) -> ApiResult<()> {
    let t = talker(state, who).await?;
    for &other in with {
        if other == who {
            continue;
        }
        if db::blocked(&state.db, who, other).await.map_err(db_err)? {
            return Err(refuse(
                "blocked",
                "Someone in that call can't be reached by them.",
            ));
        }
        let o = talker(state, other).await?;
        voice::may_talk(voice::minors_enabled(), t, o).map_err(|r| refuse("age", r.message()))?;
    }
    Ok(())
}

async fn names(state: &SocialState, ids: &[Uuid]) -> ApiResult<Vec<Value>> {
    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, display_name FROM players WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    Ok(ids
        .iter()
        .filter_map(|id| rows.iter().find(|r| r.0 == *id))
        .map(|(id, name)| json!({ "id": id.to_string(), "name": name }))
        .collect())
}

/// Tells everyone in `call` who's in it now.
async fn announce(state: &SocialState, call: Uuid) {
    let members = state.calls.members(call);
    let Ok(list) = names(state, &members).await else {
        return;
    };
    let msg = json!({ "t": "call", "call": call.to_string(), "members": list });
    for m in members {
        state.hub.send(m, &msg);
    }
}

/// After someone left: tell the rest who's left, or that the call's over.
pub async fn after_leave(state: &SocialState, left: Left) {
    if left.ended {
        for m in left.members {
            state.hub.send(
                m,
                &json!({ "t": "call_ended", "call": left.call.to_string() }),
            );
        }
    } else {
        announce(state, left.call).await;
    }
}

/// A pass into `call`'s room, and where the room is.
fn pass(state: &SocialState, call: Uuid, me: Uuid, name: &str) -> ApiResult<Value> {
    let lk = state.livekit.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_lines",
            "The phone lines are down.",
        )
    })?;
    let room = format!("call-{call}");
    let token = lk.token(
        &room,
        &me.to_string(),
        name,
        commons_common::now_unix(),
        PASS_SECS,
    );
    Ok(json!({ "call": call.to_string(), "url": lk.url, "token": token }))
}

// ---- routes ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/call", get(current))
        .route("/call/contacts", get(contacts))
        .route("/call/ring", post(ring))
        .route("/call/answer", post(answer))
        .route("/call/leave", post(leave))
        .route("/call/settings", post(settings))
}

/// Your call (with a fresh pass, to reconnect after a reload), if any.
async fn current(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let Some(call) = state.calls.call_of(me) else {
        return Ok(Json(json!({ "call": null })));
    };
    let mut out = pass(&state, call, me, &claims.name)?;
    out["members"] = json!(names(&state, &state.calls.members(call)).await?);
    Ok(Json(out))
}

/// Your friends as the phone sees them: online, with a phone, and whether
/// you can call them (and if not, why).
async fn contacts(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let mine = has_phone(&state, me).await?;
    let me_t = talker(&state, me).await?;
    let friends = db::friend_ids(&state.db, me).await.map_err(db_err)?;
    let phones: Vec<Uuid> = sqlx::query_scalar(
        "SELECT player_id FROM inventory WHERE player_id = ANY($1) AND item_id = $2 AND qty > 0",
    )
    .bind(&friends)
    .bind(PHONE)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let mut list = vec![];
    for f in names(&state, &friends).await? {
        let id = uuid(f["id"].as_str().unwrap_or(""))?;
        let online = state.hub.online(id);
        let phone = phones.contains(&id);
        let age = voice::may_talk(voice::minors_enabled(), me_t, talker(&state, id).await?);
        let why = if !phone {
            Some("No phone yet")
        } else if !online {
            Some("Not around")
        } else {
            age.err().map(|r| r.message())
        };
        list.push(json!({
            "id": f["id"], "name": f["name"], "online": online, "phone": phone,
            "callable": why.is_none(), "why": why,
        }));
    }
    let minors_open = voice::minors_enabled();
    let you = if !mine {
        Some("Get a phone at the mall's Tools & Gadgets shop to call your friends.")
    } else if me_t.minor && !minors_open {
        Some(voice::Refusal::MinorsNotYet.message())
    } else if me_t.minor && !me_t.opted_in {
        Some("Switch phone calls on to call your friends.")
    } else {
        None
    };
    Ok(Json(json!({
        "phone": mine,
        "can_call": you.is_none(),
        "why": you,
        // Under-16s get a switch for calls, once calls are open to them.
        "switch": me_t.minor && minors_open,
        "voice_ok": me_t.opted_in,
        "in_call": state.calls.call_of(me).map(|c| c.to_string()),
        "friends": list,
    })))
}

#[derive(Deserialize)]
struct IdReq {
    id: String,
}

/// Rings a friend: into your call, or a new one.
async fn ring(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<IdReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let to = uuid(&req.id)?;
    if to == me {
        return Err(ApiError::bad_request("bad_id", "That's you."));
    }
    if !has_phone(&state, me).await? {
        return Err(refuse(
            "no_phone",
            "You need a phone first: the mall's Tools & Gadgets shop has them.",
        ));
    }
    // Friends only, and they need a phone to answer.
    if db::blocked(&state.db, me, to).await.map_err(db_err)?
        || db::level(&state.db, me, to)
            .await
            .map_err(db_err)?
            .is_none()
    {
        return Err(refuse("not_friends", "You can only call your friends."));
    }
    if !has_phone(&state, to).await? {
        return Err(refuse("no_phone", "They don't have a phone yet."));
    }
    if !state.hub.online(to) {
        return Err(refuse("offline", "They're not around right now."));
    }
    // Them with you and everyone already in (or being rung into) your call,
    // all checked before a new call is opened.
    let with = match state.calls.call_of(me) {
        Some(c) => state.calls.everyone(c),
        None => vec![me],
    };
    may_join(&state, to, &with).await?;
    // Only rings that reach someone count towards the limit.
    if !state.ring_allowed(me) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "slow_down",
            "Give it a moment before calling again.",
        ));
    }
    let call = state.calls.open(me);
    match state.calls.ring(call, to, me, Instant::now()) {
        Ok(()) => {}
        Err(CallError::AlreadyIn) => {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "already_in",
                "They're already in the call.",
            ));
        }
        Err(_) => {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "full",
                "The call's full: eight's the most.",
            ));
        }
    }
    let members = names(&state, &state.calls.members(call)).await?;
    state.hub.send(
        to,
        &json!({
            "t": "call_ring", "call": call.to_string(),
            "from_id": me.to_string(), "from_name": claims.name, "members": members,
        }),
    );
    let mut out = pass(&state, call, me, &claims.name)?;
    out["members"] = json!(members);
    Ok(Json(out))
}

#[derive(Deserialize)]
struct AnswerReq {
    call: String,
    accept: bool,
}

/// Picks up (or turns down) a call ringing you.
async fn answer(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<AnswerReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let call = uuid(&req.call)?;
    let gone = || ApiError::new(StatusCode::GONE, "gone", "That call has ended.");
    if !req.accept {
        let (by, ended) = state.calls.decline(call, me).ok_or_else(gone)?;
        state.hub.send(
            by,
            &json!({ "t": "call_declined", "call": call.to_string(), "name": claims.name }),
        );
        if let Some(end) = ended {
            after_leave(&state, end).await;
        }
        return Ok(Json(json!({ "call": null })));
    }
    // Still allowed with everyone there now (someone may have joined since).
    let with = state.calls.members(call);
    if let Err(e) = may_join(&state, me, &with).await {
        if let Some((_, Some(end))) = state.calls.decline(call, me) {
            after_leave(&state, end).await;
        }
        return Err(e);
    }
    let left = state.calls.answer(call, me).map_err(|_| gone())?;
    if let Some(left) = left {
        after_leave(&state, left).await;
    }
    announce(&state, call).await;
    let mut out = pass(&state, call, me, &claims.name)?;
    out["members"] = json!(names(&state, &state.calls.members(call)).await?);
    Ok(Json(out))
}

/// Hangs up.
async fn leave(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    if let Some(left) = state.calls.leave(me) {
        after_leave(&state, left).await;
    }
    Ok(Json(json!({ "call": null })))
}

#[derive(Deserialize)]
struct SettingsReq {
    voice_ok: bool,
}

/// An under-16 switching phone calls on or off (only once calls are open to
/// under-16s).
async fn settings(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SettingsReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    if !voice::minors_enabled() {
        return Err(refuse("not_yet", voice::Refusal::MinorsNotYet.message()));
    }
    sqlx::query("UPDATE players SET voice_ok = $2 WHERE id = $1")
        .bind(me)
        .bind(req.voice_ok)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    if !req.voice_ok
        && let Some(left) = state.calls.leave(me)
    {
        after_leave(&state, left).await;
    }
    Ok(Json(json!({ "voice_ok": req.voice_ok })))
}

/// Gives up on rings nobody answered, every few seconds.
pub fn spawn_ring_timeouts(state: Arc<SocialState>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(3));
        loop {
            tick.tick().await;
            let (gone, ended) = state.calls.expire(Instant::now());
            for (call, who, by) in gone {
                let name = names(&state, &[who])
                    .await
                    .ok()
                    .and_then(|n| n.first().and_then(|v| v["name"].as_str().map(String::from)))
                    .unwrap_or_default();
                state.hub.send(
                    by,
                    &json!({ "t": "call_unanswered", "call": call.to_string(), "name": name }),
                );
                state.hub.send(
                    who,
                    &json!({ "t": "call_missed", "call": call.to_string() }),
                );
            }
            for end in ended {
                after_leave(&state, end).await;
            }
        }
    });
}

/// One ringing per few seconds per player, a handful in a burst.
pub fn ring_bucket() -> Bucket {
    Bucket::new(4.0, 0.2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_ring_join_merge_and_end() {
        let calls = Calls::default();
        let [a, b, c, d] = [0; 4].map(|_| Uuid::new_v4());
        let now = Instant::now();
        // A rings B; B answers: a call of two.
        let ab = calls.open(a);
        calls.ring(ab, b, a, now).unwrap();
        assert_eq!(calls.ring(ab, a, a, now), Err(CallError::AlreadyIn));
        assert_eq!(calls.answer(ab, b), Ok(None));
        assert_eq!(calls.members(ab), vec![a, b]);
        // C and D are in a call of their own; B rings D into A's call, and D
        // moving over ends C's call (C's alone).
        let cd = calls.open(c);
        calls.ring(cd, d, c, now).unwrap();
        calls.answer(cd, d).unwrap();
        calls.ring(ab, d, b, now).unwrap();
        let left = calls.answer(ab, d).unwrap().unwrap();
        assert_eq!(
            left,
            Left {
                call: cd,
                members: vec![c],
                ended: true
            }
        );
        assert_eq!(calls.call_of(c), None);
        assert_eq!(calls.members(ab), vec![a, b, d]);
        // Answering something that isn't ringing you does nothing.
        assert_eq!(calls.answer(ab, c), Err(CallError::NotRinging));
        // A hangs up: B and D carry on; B hangs up: D's alone, it's over.
        assert!(!calls.leave(a).unwrap().ended);
        let end = calls.leave(b).unwrap();
        assert!(end.ended && end.members == vec![d]);
        assert_eq!(calls.call_of(d), None);
    }

    #[test]
    fn unanswered_rings_give_up_and_full_calls_refuse() {
        let calls = Calls::default();
        let a = Uuid::new_v4();
        let call = calls.open(a);
        let t0 = Instant::now();
        let b = Uuid::new_v4();
        calls.ring(call, b, a, t0).unwrap();
        let (gone, ended) = calls.expire(t0 + RING_FOR + Duration::from_secs(1));
        assert_eq!(gone, vec![(call, b, a)]);
        assert_eq!(ended.len(), 1, "nobody to talk to: over");
        assert_eq!(calls.call_of(a), None);
        // Eight at most, counting those being rung.
        let call = calls.open(a);
        for _ in 1..MAX_IN_CALL {
            calls.ring(call, Uuid::new_v4(), a, t0).unwrap();
        }
        assert_eq!(
            calls.ring(call, Uuid::new_v4(), a, t0),
            Err(CallError::Full)
        );
        // Declining the only ring leaves the caller alone: over.
        let calls = Calls::default();
        let call = calls.open(a);
        calls.ring(call, b, a, t0).unwrap();
        let (by, end) = calls.decline(call, b).unwrap();
        assert_eq!(by, a);
        assert!(end.unwrap().ended);
    }
}
