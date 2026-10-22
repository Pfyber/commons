//! Phone calls (ADR 0013). Friends who both own a phone can call each
//! other. Anyone in a call can ring another friend into it, up to
//! `MAX_IN_CALL` people. Answering a call while you're in another moves you
//! over (the other call carries on without you). The voice itself goes
//! through LiveKit: this gateway rings people, keeps track of who's in which
//! call, and hands out short-lived passes to the call's room. The age rules
//! (`commons_common::voice`) are checked against everyone in the call.
//!
//! Whoever starts a call is its host and can remove people from it (the
//! room service cuts them off in LiveKit too); if the host leaves, whoever's
//! been on longest takes over. Every call goes in each person's call log
//! (`call_log`, 90 days).
//!
//! Pushed on the social socket: `call_ring` (someone's ringing you),
//! `call` (who's in your call now, and its host), `call_declined`,
//! `call_unanswered`, `call_missed`, `call_removed` and `call_ended`.

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
    /// Who started it, or took over when they left: may remove people.
    host: Uuid,
    /// Everyone who's been on it, and everyone rung into it (for the log).
    seen: Vec<Uuid>,
    rung: Vec<Uuid>,
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
    NotHost,
    NotIn,
}

/// What changed when someone left: the call, who's still in it, and
/// whether it ended (then `members` were in it at the end, and are out now).
#[derive(Debug, PartialEq, Eq)]
pub struct Left {
    pub call: Uuid,
    pub members: Vec<Uuid>,
    pub ended: bool,
    /// Who was ever on the call, and who was rung (for the log).
    pub seen: Vec<Uuid>,
    pub rung: Vec<Uuid>,
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

    pub fn host(&self, call: Uuid) -> Option<Uuid> {
        self.0.lock().unwrap().calls.get(&call).map(|c| c.host)
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
                host: p,
                seen: vec![p],
                rung: vec![],
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
        if !c.rung.contains(&who) {
            c.rung.push(who);
        }
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
        if !c.seen.contains(&who) {
            c.seen.push(who);
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
        // The host leaving: whoever's been on longest takes over.
        if c.host == p
            && let Some(&next) = c.members.first()
        {
            c.host = next;
        }
        if let Some(end) = Self::end_if_alone(&mut h, call) {
            return Some(end);
        }
        let c = h.calls.get(&call)?;
        Some(Left {
            call,
            members: c.members.clone(),
            ended: false,
            seen: c.seen.clone(),
            rung: c.rung.clone(),
        })
    }

    /// The host `by` removes `who` from `call` (or stops ringing them).
    pub fn remove(&self, call: Uuid, by: Uuid, who: Uuid) -> Result<Left, CallError> {
        {
            let mut h = self.0.lock().unwrap();
            let c = h.calls.get_mut(&call).ok_or(CallError::NotIn)?;
            if c.host != by || !c.members.contains(&by) {
                return Err(CallError::NotHost);
            }
            if who == by {
                return Err(CallError::NotIn);
            }
            if c.ringing.remove(&who).is_some() {
                if let Some(end) = Self::end_if_alone(&mut h, call) {
                    return Ok(end);
                }
                let c = h.calls.get(&call).ok_or(CallError::NotIn)?;
                return Ok(Left {
                    call,
                    members: c.members.clone(),
                    ended: false,
                    seen: c.seen.clone(),
                    rung: c.rung.clone(),
                });
            }
            if !c.members.contains(&who) {
                return Err(CallError::NotIn);
            }
        }
        self.leave(who).ok_or(CallError::NotIn)
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
            seen: c.seen,
            rung: c.rung,
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
    let host = state.calls.host(call).map(|h| h.to_string());
    let msg = json!({ "t": "call", "call": call.to_string(), "members": list, "host": host });
    for m in members {
        state.hub.send(m, &msg);
    }
}

/// Someone's off a call (hung up, moved to another, went offline, was
/// removed: `leaver`, with how it ended for them): their log line closes,
/// and everyone's if the call's over; the rest hear who's left.
pub async fn finish(state: &SocialState, left: Left, leaver: Option<(Uuid, Option<&str>)>) {
    if let Some((who, status)) = leaver {
        log_end(state, who, &left, status).await;
    }
    if left.ended {
        for &m in &left.members {
            log_end(state, m, &left, None).await;
        }
    }
    after_leave(state, left).await;
}

/// After someone left: tell the rest who's left, or that the call's over.
async fn after_leave(state: &SocialState, left: Left) {
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

// ---- the call log -------------------------------------------------------------------

/// Starts (or rewrites) `player`'s line for `call`; `ended` closes it at once
/// (a missed or declined call).
async fn log_open(
    state: &SocialState,
    player: Uuid,
    call: Uuid,
    direction: &str,
    status: &str,
    people: &[Uuid],
    ended: bool,
) {
    let people = names(state, people).await.unwrap_or_default();
    let r = sqlx::query(
        "INSERT INTO call_log (player_id, call_id, direction, status, people, ended_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)
         ON CONFLICT (player_id, call_id) DO UPDATE SET direction = EXCLUDED.direction,
             status = EXCLUDED.status, people = EXCLUDED.people, ended_at = EXCLUDED.ended_at",
    )
    .bind(player)
    .bind(call)
    .bind(direction)
    .bind(status)
    .bind(Value::from(people))
    .bind(ended)
    .execute(&state.db)
    .await;
    if let Err(e) = r {
        tracing::error!(error = %e, "writing the call log failed");
    }
}

/// Someone answered: the callers' "unanswered" lines become calls.
async fn log_talked(state: &SocialState, call: Uuid, members: &[Uuid]) {
    let r = sqlx::query(
        "UPDATE call_log SET status = 'talked'
         WHERE call_id = $1 AND player_id = ANY($2) AND status = 'unanswered'",
    )
    .bind(call)
    .bind(members)
    .execute(&state.db)
    .await;
    if let Err(e) = r {
        tracing::error!(error = %e, "writing the call log failed");
    }
}

/// Closes `player`'s line for the call: who was on it with them (or, if
/// nobody picked up, who they rang), and how it ended if that's news.
async fn log_end(state: &SocialState, player: Uuid, left: &Left, status: Option<&str>) {
    let mut people: Vec<Uuid> = left.seen.iter().copied().filter(|p| *p != player).collect();
    if people.is_empty() {
        people = left.rung.iter().copied().filter(|p| *p != player).collect();
    }
    let people = names(state, &people).await.unwrap_or_default();
    let r = sqlx::query(
        "UPDATE call_log SET ended_at = now(), people = $3, status = COALESCE($4, status)
         WHERE player_id = $1 AND call_id = $2 AND ended_at IS NULL",
    )
    .bind(player)
    .bind(left.call)
    .bind(Value::from(people))
    .bind(status)
    .execute(&state.db)
    .await;
    if let Err(e) = r {
        tracing::error!(error = %e, "writing the call log failed");
    }
}

/// Asks LiveKit to cut `who` off `call`'s room (best effort: they may not
/// have connected yet).
async fn kick(state: &SocialState, call: Uuid, who: Uuid) {
    let Some(lk) = &state.livekit else { return };
    let room = format!("call-{call}");
    let res = reqwest::Client::new()
        .post(format!(
            "{}/twirp/livekit.RoomService/RemoveParticipant",
            lk.http_url()
        ))
        .bearer_auth(lk.admin_token(&room, commons_common::now_unix()))
        .json(&json!({ "room": room, "identity": who.to_string() }))
        .timeout(Duration::from_secs(5))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => {}
        Ok(r) => {
            tracing::info!(status = %r.status(), "livekit: removing someone who wasn't connected")
        }
        Err(e) => tracing::warn!(error = %e, "livekit: couldn't remove someone from a call"),
    }
}

// ---- routes ---------------------------------------------------------------------------

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/call", get(current))
        .route("/call/contacts", get(contacts))
        .route("/call/ring", post(ring))
        .route("/call/answer", post(answer))
        .route("/call/leave", post(leave))
        .route("/call/remove", post(remove))
        .route("/call/log", get(log))
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
    out["host"] = json!(state.calls.host(call).map(|h| h.to_string()));
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
    let fresh = state.calls.call_of(me).is_none();
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
    if fresh {
        log_open(&state, me, call, "out", "unanswered", &[to], false).await;
    }
    let mut out = pass(&state, call, me, &claims.name)?;
    out["members"] = json!(members);
    out["host"] = json!(state.calls.host(call).map(|h| h.to_string()));
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
        log_open(&state, me, call, "in", "declined", &[by], true).await;
        state.hub.send(
            by,
            &json!({ "t": "call_declined", "call": call.to_string(), "name": claims.name }),
        );
        if let Some(end) = ended {
            finish(&state, end, None).await;
        }
        return Ok(Json(json!({ "call": null })));
    }
    // Still allowed with everyone there now (someone may have joined since).
    let with = state.calls.members(call);
    if let Err(e) = may_join(&state, me, &with).await {
        if let Some((_, Some(end))) = state.calls.decline(call, me) {
            finish(&state, end, None).await;
        }
        return Err(e);
    }
    let left = state.calls.answer(call, me).map_err(|_| gone())?;
    if let Some(left) = left {
        finish(&state, left, Some((me, None))).await;
    }
    let members = state.calls.members(call);
    let others: Vec<Uuid> = members.iter().copied().filter(|m| *m != me).collect();
    log_open(&state, me, call, "in", "talked", &others, false).await;
    log_talked(&state, call, &members).await;
    announce(&state, call).await;
    let mut out = pass(&state, call, me, &claims.name)?;
    out["members"] = json!(names(&state, &members).await?);
    out["host"] = json!(state.calls.host(call).map(|h| h.to_string()));
    Ok(Json(out))
}

/// Hangs up.
async fn leave(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    if let Some(left) = state.calls.leave(me) {
        finish(&state, left, Some((me, None))).await;
    }
    Ok(Json(json!({ "call": null })))
}

#[derive(Deserialize)]
struct RemoveReq {
    id: String,
}

/// The host removes someone from the call (or stops ringing them).
async fn remove(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<RemoveReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let who = uuid(&req.id)?;
    let call = state
        .calls
        .call_of(me)
        .ok_or_else(|| ApiError::bad_request("no_call", "You're not on a call."))?;
    let left = state.calls.remove(call, me, who).map_err(|e| match e {
        CallError::NotHost => refuse(
            "not_host",
            "Only whoever started the call can remove people.",
        ),
        _ => ApiError::bad_request("not_in", "They're not on this call."),
    })?;
    kick(&state, call, who).await;
    state.hub.send(
        who,
        &json!({ "t": "call_removed", "call": call.to_string(), "by_name": claims.name }),
    );
    finish(&state, left, Some((who, Some("removed")))).await;
    Ok(Json(json!({ "removed": who.to_string() })))
}

/// Your call log: the last 30 calls, newest first (kept 90 days).
async fn log(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    sqlx::query(
        "DELETE FROM call_log WHERE player_id = $1 AND started_at < now() - interval '90 days'",
    )
    .bind(me)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    type Row = (String, String, Value, i64, Option<i32>);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT direction, status, people, extract(epoch FROM started_at)::bigint,
                extract(epoch FROM ended_at - started_at)::int
         FROM call_log WHERE player_id = $1 ORDER BY started_at DESC LIMIT 30",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let calls: Vec<_> = rows
        .into_iter()
        .map(|(direction, status, people, at, secs)| {
            json!({ "direction": direction, "status": status, "people": people, "at": at, "secs": secs })
        })
        .collect();
    Ok(Json(json!({ "calls": calls })))
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
        finish(&state, left, Some((me, None))).await;
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
                log_open(&state, who, call, "in", "missed", &[by], true).await;
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
                finish(&state, end, None).await;
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
        assert!(left.call == cd && left.ended && left.members == vec![c]);
        assert_eq!(left.seen, vec![c, d]);
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
    fn the_host_removes_people_and_hands_over_on_leaving() {
        let calls = Calls::default();
        let [a, b, c] = [0; 3].map(|_| Uuid::new_v4());
        let now = Instant::now();
        let call = calls.open(a);
        for p in [b, c] {
            calls.ring(call, p, a, now).unwrap();
            calls.answer(call, p).unwrap();
        }
        assert_eq!(calls.host(call), Some(a));
        // Only the host removes, and not themselves.
        assert_eq!(calls.remove(call, b, c).err(), Some(CallError::NotHost));
        assert_eq!(calls.remove(call, a, a).err(), Some(CallError::NotIn));
        let left = calls.remove(call, a, c).unwrap();
        assert!(!left.ended && left.members == vec![a, b]);
        assert_eq!(calls.call_of(c), None);
        // The host leaves: B takes over, alone, so it's over.
        let end = calls.leave(a).unwrap();
        assert!(end.ended);
        // Removing someone still being rung just stops the ringing.
        let call = calls.open(a);
        calls.ring(call, b, a, now).unwrap();
        calls.ring(call, c, a, now).unwrap();
        calls.answer(call, b).unwrap();
        let left = calls.remove(call, a, c).unwrap();
        assert!(!left.ended && calls.everyone(call).len() == 2);
        calls.leave(a);
        assert_eq!(calls.host(call), None, "B alone: over");
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
