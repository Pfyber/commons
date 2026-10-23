//! Club life (ADR 0014, C2): the weekly meetup (a reminder, a notice when
//! it starts, and 20 coins for whoever spends 10 minutes of it in the club
//! room), the week's club goals (each reached pays the treasury), the club
//! call (rings every member who's online), and giving furniture in the club
//! room back to whoever placed it.
//!
//! Who's in a club room comes from the zones' presence reports (the hub),
//! never from clients. `sweep_at` runs every minute.

use crate::State as SocialState;
use crate::clubs::{self, Club};
use crate::routes::{db_err, me, notify, uuid};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use commons_api::economy::{COIN, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_common::config;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// How long a meetup lasts.
pub const MEETUP_MINS: i64 = 60;
/// How long before it starts the members are reminded.
pub const REMIND_MINS: i64 = 30;
/// Minutes of the meetup in the room that earn the reward.
pub const STAY_MINS: i32 = 10;
/// The reward for coming to a meetup.
pub const MEETUP_REWARD: i32 = 20;
/// The zone club rooms are instances of (their owner is the club).
const ROOM_ZONE: &str = "clubroom";

/// A week's goal: what it's called, its target and how far the club's got.
#[derive(Debug, Clone, PartialEq)]
pub struct Goal {
    pub key: &'static str,
    pub title: &'static str,
    pub progress: i64,
    pub target: i64,
    /// Coins into the treasury when it's reached.
    pub reward: i32,
    pub done: bool,
}

impl Goal {
    fn json(&self) -> Value {
        json!({
            "key": self.key, "title": self.title, "progress": self.progress.min(self.target),
            "target": self.target, "reward": self.reward, "done": self.done,
        })
    }
}

// ---- time ------------------------------------------------------------------------

/// The Monday (UTC) the week of `now` starts on.
pub fn week_of(now: DateTime<Utc>) -> NaiveDate {
    let d = now.date_naive();
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

fn midnight(d: NaiveDate) -> DateTime<Utc> {
    Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
}

/// For a weekly meetup on `dow` (0 Monday) at `minute` (UTC): the one under
/// way at `now`, if any, and the next one to start.
pub fn meetup_times(
    dow: i16,
    minute: i16,
    now: DateTime<Utc>,
) -> (Option<DateTime<Utc>>, DateTime<Utc>) {
    let this_week =
        midnight(week_of(now)) + Duration::days(dow as i64) + Duration::minutes(minute as i64);
    let (last, next) = if this_week > now {
        (this_week - Duration::days(7), this_week)
    } else {
        (this_week, this_week + Duration::days(7))
    };
    let live = now < last + Duration::minutes(MEETUP_MINS);
    (live.then_some(last), next)
}

// ---- the sweep ----------------------------------------------------------------------

/// A club as the sweep sees it.
#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    name: String,
    crest: String,
    meetup_dow: Option<i16>,
    meetup_minute: Option<i16>,
}

/// Members in the club's room right now (from the zones' reports).
fn present(state: &SocialState, club: Uuid, members: &[Uuid]) -> Vec<Uuid> {
    let id = club.to_string();
    members
        .iter()
        .copied()
        .filter(|&m| {
            state
                .hub
                .location(m)
                .is_some_and(|l| l.zone == ROOM_ZONE && l.owner.as_deref() == Some(id.as_str()))
        })
        .collect()
}

/// One minute of club life (`mins` minutes, when the sweep runs less often):
/// time together in the rooms, meetup reminders, notices and rewards, and
/// goals reached. Returns how many clubs it looked at.
pub async fn sweep_at(state: &SocialState, now: DateTime<Utc>, mins: i32) -> ApiResult<usize> {
    let n = sweep_clubs(state, now, mins, None).await?;
    // C3: event reminders, and last week's clubs of the week.
    crate::clubtown::event_tick(state, now).await?;
    crate::clubtown::award_last_week(state, now).await?;
    Ok(n)
}

/// `sweep_at` for one club only (`only`), or all of them.
pub async fn sweep_clubs(
    state: &SocialState,
    now: DateTime<Utc>,
    mins: i32,
    only: Option<Uuid>,
) -> ApiResult<usize> {
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, name, crest, meetup_dow, meetup_minute FROM clubs
         WHERE closed_at IS NULL AND ($1::uuid IS NULL OR id = $1)",
    )
    .bind(only)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let week = week_of(now);
    for c in &rows {
        let members = member_ids(&state.db, c.id).await?;
        let here = present(state, c.id, &members);
        for &p in &here {
            sqlx::query(
                "INSERT INTO club_room_minutes (club_id, week, player_id, minutes) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (club_id, week, player_id) DO UPDATE SET minutes = club_room_minutes.minutes + $4",
            )
            .bind(c.id)
            .bind(week)
            .bind(p)
            .bind(mins)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
        }
        if let (Some(dow), Some(minute)) = (c.meetup_dow, c.meetup_minute) {
            meetup_tick(state, c, &members, &here, dow, minute, now, mins).await?;
        }
        pay_goals(state, c, &members, now).await?;
    }
    Ok(rows.len())
}

#[allow(clippy::too_many_arguments)]
async fn meetup_tick(
    state: &SocialState,
    c: &Row,
    members: &[Uuid],
    here: &[Uuid],
    dow: i16,
    minute: i16,
    now: DateTime<Utc>,
    mins: i32,
) -> ApiResult<()> {
    let (live, next) = meetup_times(dow, minute, now);
    let body = |starts: DateTime<Utc>| {
        json!({
            "club": c.name, "club_id": c.id.to_string(), "crest": c.crest,
            "starts_at": starts.timestamp(),
        })
    };
    // The reminder, once, half an hour before.
    if next - now <= Duration::minutes(REMIND_MINS) && first(state, c.id, next, "reminded").await? {
        for &m in members {
            notify(state, m, "club_meetup_soon", body(next)).await;
        }
    }
    let Some(start) = live else {
        return Ok(());
    };
    if first(state, c.id, start, "started").await? {
        for &m in members {
            notify(state, m, "club_meetup_now", body(start)).await;
        }
    }
    for &p in here {
        let (minutes, rewarded): (i32, bool) = sqlx::query_as(
            "INSERT INTO club_meetup_visits (club_id, starts_at, player_id, minutes) VALUES ($1, $2, $3, $4)
             ON CONFLICT (club_id, starts_at, player_id) DO UPDATE SET minutes = club_meetup_visits.minutes + $4
             RETURNING minutes, rewarded",
        )
        .bind(c.id)
        .bind(start)
        .bind(p)
        .bind(mins)
        .fetch_one(&state.db)
        .await
        .map_err(db_err)?;
        if minutes >= STAY_MINS && !rewarded {
            reward(state, c, p, start).await?;
        }
    }
    Ok(())
}

/// Marks a meetup's `what` (reminded, started) as done; true the first time.
async fn first(
    state: &SocialState,
    club: Uuid,
    starts: DateTime<Utc>,
    what: &str,
) -> ApiResult<bool> {
    sqlx::query(
        "INSERT INTO club_meetup_runs (club_id, starts_at) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(club)
    .bind(starts)
    .execute(&state.db)
    .await
    .map_err(db_err)?;
    let q = format!(
        "UPDATE club_meetup_runs SET {what} = true WHERE club_id = $1 AND starts_at = $2 AND NOT {what}"
    );
    let n = sqlx::query(&q)
        .bind(club)
        .bind(starts)
        .execute(&state.db)
        .await
        .map_err(db_err)?
        .rows_affected();
    Ok(n == 1)
}

/// The coins for coming to a meetup, once.
async fn reward(state: &SocialState, c: &Row, p: Uuid, start: DateTime<Utc>) -> ApiResult<()> {
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let n = sqlx::query(
        "UPDATE club_meetup_visits SET rewarded = true
         WHERE club_id = $1 AND starts_at = $2 AND player_id = $3 AND NOT rewarded",
    )
    .bind(c.id)
    .bind(start)
    .bind(p)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?
    .rows_affected();
    if n == 0 {
        return Ok(());
    }
    apply(
        &mut tx,
        &state.catalog,
        p,
        &[Op {
            item: COIN,
            delta: MEETUP_REWARD,
        }],
        "club_meetup",
        &format!("meetup:{}:{}:{p}", c.id, start.timestamp()),
    )
    .await?;
    tx.commit().await.map_err(db_err)?;
    notify(
        state,
        p,
        "club_meetup_reward",
        json!({ "club": c.name, "club_id": c.id.to_string(), "crest": c.crest, "coins": MEETUP_REWARD }),
    )
    .await;
    state.hub.send(p, &json!({ "t": "coins" }));
    Ok(())
}

async fn member_ids(db: &PgPool, club: Uuid) -> ApiResult<Vec<Uuid>> {
    sqlx::query_scalar("SELECT player_id FROM club_members WHERE club_id = $1")
        .bind(club)
        .fetch_all(db)
        .await
        .map_err(db_err)
}

// ---- goals ---------------------------------------------------------------------------

/// The week's goals and how far the club has got with them.
pub async fn goals(
    db: &PgPool,
    club: Uuid,
    members: &[Uuid],
    now: DateTime<Utc>,
) -> ApiResult<Vec<Goal>> {
    let week = week_of(now);
    let since = midnight(week);
    let done: Vec<String> =
        sqlx::query_scalar("SELECT goal FROM club_goals_done WHERE club_id = $1 AND week = $2")
            .bind(club)
            .bind(week)
            .fetch_all(db)
            .await
            .map_err(db_err)?;
    let came: i64 = sqlx::query_scalar(
        "SELECT count(DISTINCT player_id) FROM club_meetup_visits
         WHERE club_id = $1 AND rewarded AND starts_at >= $2",
    )
    .bind(club)
    .bind(since)
    .fetch_one(db)
    .await
    .map_err(db_err)?;
    let together: i64 = sqlx::query_scalar(
        "SELECT coalesce(sum(minutes), 0)::bigint FROM club_room_minutes WHERE club_id = $1 AND week = $2",
    )
    .bind(club)
    .bind(week)
    .fetch_one(db)
    .await
    .map_err(db_err)?;
    let fish: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM economy_ledger l JOIN items i ON i.id = l.item_id
         WHERE l.player_id = ANY($1) AND l.reason = 'fishing' AND l.delta > 0
           AND i.kind = 'fish' AND l.at >= $2",
    )
    .bind(members)
    .bind(since)
    .fetch_one(db)
    .await
    .map_err(db_err)?;
    let given: i64 = sqlx::query_scalar(
        "SELECT coalesce(sum(delta), 0)::bigint FROM club_treasury_ledger
         WHERE club_id = $1 AND reason = 'club_donation' AND at >= $2",
    )
    .bind(club)
    .bind(since)
    .fetch_one(db)
    .await
    .map_err(db_err)?;
    let rent = clubs::weekly_rent(db, club).await?;
    let g = |key, title, progress, target: i64, reward| Goal {
        key,
        title,
        progress,
        target,
        reward,
        done: done.iter().any(|d| d == key),
    };
    Ok(vec![
        g(
            "meetup",
            "Come to the meetup together",
            came,
            (members.len() as i64).clamp(1, 3),
            15,
        ),
        g(
            "together",
            "Spend time together in the club room (minutes)",
            together,
            120,
            15,
        ),
        g("fish", "Catch fish between you", fish, 15, 10),
        g(
            "chip_in",
            "Fill the treasury (a week's rent in gifts)",
            given,
            rent as i64,
            10,
        ),
    ])
}

/// Pays the treasury for each goal reached this week, once, and tells the members.
async fn pay_goals(
    state: &SocialState,
    c: &Row,
    members: &[Uuid],
    now: DateTime<Utc>,
) -> ApiResult<()> {
    let week = week_of(now);
    for goal in goals(&state.db, c.id, members, now).await? {
        if goal.done || goal.progress < goal.target {
            continue;
        }
        let mut tx = state.db.begin().await.map_err(db_err)?;
        let fresh = sqlx::query(
            "INSERT INTO club_goals_done (club_id, week, goal) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(c.id)
        .bind(week)
        .bind(goal.key)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?
        .rows_affected();
        if fresh == 0 {
            continue;
        }
        clubs::reward_treasury(
            &mut tx,
            c.id,
            goal.reward,
            "club_goal",
            &format!("goal:{}:{week}:{}", c.id, goal.key),
        )
        .await?;
        tx.commit().await.map_err(db_err)?;
        for &m in members {
            state.hub.send(
                m,
                &json!({
                    "t": "club", "club": c.id.to_string(), "goal": goal.title,
                    "coins": goal.reward, "name": c.name, "crest": c.crest,
                }),
            );
        }
    }
    Ok(())
}

/// Runs `sweep_at` every `COMMONS_CLUB_SWEEP_SECS` (default a minute).
pub fn spawn_sweeper(state: Arc<SocialState>) {
    let secs: u64 = config::env_or("COMMONS_CLUB_SWEEP_SECS", 60);
    let mins = ((secs as f64 / 60.0).round() as i32).max(1);
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(secs));
        loop {
            tick.tick().await;
            if let Err(e) = sweep_at(&state, Utc::now(), mins).await {
                tracing::error!(error = ?e, "club sweep failed");
            }
        }
    });
}

// ---- what members see --------------------------------------------------------------

/// The meetup, the week's goals and the room's furniture, for a club's page.
pub async fn page(state: &SocialState, c: &Club, members: &[Uuid]) -> ApiResult<Value> {
    let now = Utc::now();
    let (dow, minute): (Option<i16>, Option<i16>) =
        sqlx::query_as("SELECT meetup_dow, meetup_minute FROM clubs WHERE id = $1")
            .bind(c.id)
            .fetch_one(&state.db)
            .await
            .map_err(db_err)?;
    let meetup = match (dow, minute) {
        (Some(d), Some(m)) => {
            let (live, next) = meetup_times(d, m, now);
            let came: Vec<String> = match live {
                Some(start) => sqlx::query_scalar(
                    "SELECT p.display_name FROM club_meetup_visits v JOIN players p ON p.id = v.player_id
                     WHERE v.club_id = $1 AND v.starts_at = $2 ORDER BY v.minutes DESC",
                )
                .bind(c.id)
                .bind(start)
                .fetch_all(&state.db)
                .await
                .map_err(db_err)?,
                None => vec![],
            };
            json!({
                "dow": d, "minute": m, "next": next.timestamp(),
                "live_until": live.map(|s| (s + Duration::minutes(MEETUP_MINS)).timestamp()),
                "came": came, "stay_mins": STAY_MINS, "reward": MEETUP_REWARD,
            })
        }
        _ => Value::Null,
    };
    let goals: Vec<Value> = goals(&state.db, c.id, members, now)
        .await?
        .iter()
        .map(Goal::json)
        .collect();
    let pieces: i64 = sqlx::query_scalar("SELECT count(*) FROM club_objects WHERE club_id = $1")
        .bind(c.id)
        .fetch_one(&state.db)
        .await
        .map_err(db_err)?;
    Ok(json!({
        "meetup": meetup,
        "goals": goals,
        "week_ends": (midnight(week_of(now)) + Duration::days(7)).timestamp(),
        "furniture": pieces,
    }))
}

// ---- furniture back to its placers --------------------------------------------------

/// Gives `player`'s pieces in the club room back to their bag (all of them,
/// everyone's, with `player` None). Returns how many went back.
pub async fn return_pieces(
    conn: &mut sqlx::PgConnection,
    state: &SocialState,
    club: Uuid,
    player: Option<Uuid>,
    key: &str,
) -> ApiResult<i32> {
    let rows: Vec<(Uuid, i32, i64)> = sqlx::query_as(
        "DELETE FROM club_objects WHERE club_id = $1 AND ($2::uuid IS NULL OR placed_by = $2)
         RETURNING placed_by, item_id, 1::bigint",
    )
    .bind(club)
    .bind(player)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?;
    let mut by: std::collections::BTreeMap<Uuid, std::collections::BTreeMap<i32, i32>> =
        Default::default();
    for (p, item, n) in rows {
        *by.entry(p).or_default().entry(item).or_default() += n as i32;
    }
    let mut total = 0;
    for (p, items) in by {
        let ops: Vec<Op> = items
            .iter()
            .map(|(&item, &delta)| Op { item, delta })
            .collect();
        total += ops.iter().map(|o| o.delta).sum::<i32>();
        apply(
            &mut *conn,
            &state.catalog,
            p,
            &ops,
            "club_return",
            &format!("{key}:{p}"),
        )
        .await?;
    }
    Ok(total)
}

// ---- routes -------------------------------------------------------------------------

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/clubs/{id}/meetup", post(set_meetup))
        .route("/clubs/{id}/call", post(call))
}

#[derive(Deserialize)]
struct MeetupReq {
    /// 0 Monday … 6 Sunday, UTC; both null to clear it.
    dow: Option<i16>,
    minute: Option<i16>,
}

/// Sets (or clears) the weekly meetup: the owner and moderators.
async fn set_meetup(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<MeetupReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = clubs::club(&state.db, uuid(&id)?).await?;
    clubs::require_staff(&state.db, c.id, me).await?;
    let (dow, minute) = match (req.dow, req.minute) {
        (Some(d), Some(m)) if (0..7).contains(&d) && (0..1440).contains(&m) => (Some(d), Some(m)),
        (None, None) => (None, None),
        _ => {
            return Err(ApiError::bad_request(
                "bad_time",
                "Pick a day and a time for the meetup.",
            ));
        }
    };
    sqlx::query("UPDATE clubs SET meetup_dow = $2, meetup_minute = $3 WHERE id = $1")
        .bind(c.id)
        .bind(dow)
        .bind(minute)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    let members = member_ids(&state.db, c.id).await?;
    for m in &members {
        state.hub.send(
            *m,
            &json!({ "t": "club", "club": c.id.to_string(), "meetup": true }),
        );
    }
    Ok(Json(page(&state, &c, &members).await?))
}

/// The club call: rings every member who's online into one call (yours, or
/// a new one). Members needn't be friends; the phone rules still apply.
async fn call(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let c = clubs::club(&state.db, uuid(&id)?).await?;
    clubs::member_role(&state.db, c.id, me).await?;
    if !crate::calls::has_phone(&state, me).await? {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "no_phone",
            "You need a phone first: the mall's Tools & Gadgets shop has them.",
        ));
    }
    if !state.ring_allowed(me) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "slow_down",
            "Give it a moment before calling again.",
        ));
    }
    let mut rung = vec![];
    let mut call = None;
    for m in member_ids(&state.db, c.id).await? {
        if m == me || !state.hub.online(m) {
            continue;
        }
        if crate::db::blocked(&state.db, me, m).await.map_err(db_err)? {
            continue;
        }
        match crate::calls::ring_into(&state, me, &claims.name, m, false).await {
            Ok(c) => {
                call = Some(c);
                rung.push(m);
            }
            // Full: the rest can't come in anyway.
            Err(e) if e.status == StatusCode::CONFLICT => break,
            // No phone, or the age rules: skip them.
            Err(_) => {}
        }
    }
    let Some(call) = call else {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "nobody",
            "Nobody from the club can pick up right now (they need to be around, with a phone).",
        ));
    };
    let mut out = crate::calls::pass_with_members(&state, call, me, &claims.name).await?;
    out["rung"] = json!(rung.len());
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn weeks_start_on_monday() {
        // 2026-10-22 is a Thursday.
        assert_eq!(
            week_of(at("2026-10-22T18:00:00Z")),
            NaiveDate::from_ymd_opt(2026, 10, 19).unwrap()
        );
        assert_eq!(
            week_of(at("2026-10-19T00:00:00Z")),
            NaiveDate::from_ymd_opt(2026, 10, 19).unwrap()
        );
    }

    #[test]
    fn a_weekly_meetup_is_live_for_its_hour_then_next_week() {
        // Thursdays (3) at 20:00.
        let (live, next) = meetup_times(3, 20 * 60, at("2026-10-22T19:00:00Z"));
        assert_eq!((live, next), (None, at("2026-10-22T20:00:00Z")));
        let (live, next) = meetup_times(3, 20 * 60, at("2026-10-22T20:30:00Z"));
        assert_eq!(live, Some(at("2026-10-22T20:00:00Z")));
        assert_eq!(next, at("2026-10-29T20:00:00Z"));
        let (live, _) = meetup_times(3, 20 * 60, at("2026-10-22T21:00:00Z"));
        assert_eq!(live, None, "an hour long");
        // Sunday late, the week before Monday's: it wraps.
        let (live, next) = meetup_times(0, 30, at("2026-10-25T23:00:00Z"));
        assert_eq!((live, next), (None, at("2026-10-26T00:30:00Z")));
    }
}
