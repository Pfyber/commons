//! Clubs in the town (ADR 0014, C3): clubhouses on the city's club lots
//! (who holds which lot), the clubs of the week (the leaderboard, and the
//! week's top three paid into their treasuries), and club events open to
//! everyone, at public places in the city, with "I'm going" and reminders.
//!
//! Events are only held at public places, where everyone can already meet:
//! club rooms stay members-only.

use crate::State as SocialState;
use crate::clublife::week_of;
use crate::clubs::{self, LOTS};
use crate::routes::{db_err, me, notify, uuid};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use commons_api::error::{ApiError, ApiResult};
use commons_common::filter::clean_chat;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The public places events can be held at: a spot in the city and what
/// it's called. A club with a clubhouse can also hold them on its lot.
pub const PLACES: &[(&str, &str)] = &[
    ("stage", "the Fairground bandstand"),
    ("pitch", "the Fairground pitch"),
    ("arena", "the Arena"),
    ("club_hall", "the Club Hall steps"),
    ("well", "the wishing well"),
];
/// How far ahead an event can be planned.
pub const PLAN_DAYS: i64 = 14;
/// Upcoming events a club can have at once.
pub const MAX_PLANNED: i64 = 3;
/// When those going are reminded.
pub const REMIND_MINS: i64 = 15;
/// The clubs of the week: coins into the treasury, first to third.
pub const AWARDS: [i32; 3] = [30, 20, 10];
/// Event titles at most.
const MAX_TITLE: usize = 60;

fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

fn midnight(d: NaiveDate) -> DateTime<Utc> {
    Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
}

/// "Club lot 3": lots are numbered in the city's grid order.
fn lot_name(lot: &str) -> String {
    let n = LOTS.iter().position(|l| l == lot).map_or(0, |i| i + 1);
    format!("Club lot {n}")
}

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/clubs/lots", get(lots))
        .route("/clubs/leaderboard", get(leaderboard))
        .route("/events", get(events))
        .route("/events/{event}/rsvp", post(rsvp))
        .route("/clubs/{id}/events", post(plan))
        .route("/clubs/{id}/events/{event}/cancel", post(cancel))
}

// ---- clubhouses -----------------------------------------------------------------

/// Every club lot, and the club whose clubhouse stands on it (if any).
async fn lots(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    me(&state, &headers)?;
    let held: Vec<(String, Uuid, String, String, String)> = sqlx::query_as(
        "SELECT l.plot, c.id, c.name, c.crest, c.color FROM leases l JOIN clubs c ON c.id = l.club_id
         WHERE l.plot LIKE 'lot:%' AND l.state <> 'ended'",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let lots: Vec<Value> = LOTS
        .iter()
        .map(|lot| {
            let club = held.iter().find(|h| &h.0 == lot).map(|(_, id, name, crest, color)| {
                json!({ "id": id.to_string(), "name": name, "crest": crest, "color": color })
            });
            json!({ "lot": lot, "name": lot_name(lot), "club": club })
        })
        .collect();
    Ok(Json(json!({ "lots": lots })))
}

// ---- the clubs of the week --------------------------------------------------------

/// A club's points for a week.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Standing {
    pub id: Uuid,
    pub name: String,
    pub crest: String,
    pub color: String,
    pub points: i64,
}

/// Every open club's points for the week starting `week`, best first:
/// 10 per goal reached, 5 per member who came to a meetup, 1 per 10
/// member-minutes in the room.
pub async fn standings(db: &sqlx::PgPool, week: NaiveDate) -> ApiResult<Vec<Standing>> {
    let from = midnight(week);
    let to = from + Duration::days(7);
    sqlx::query_as(
        "SELECT c.id, c.name, c.crest, c.color,
            ((SELECT count(*) FROM club_goals_done g WHERE g.club_id = c.id AND g.week = $1) * 10
             + (SELECT count(DISTINCT v.player_id) FROM club_meetup_visits v
                WHERE v.club_id = c.id AND v.rewarded AND v.starts_at >= $2 AND v.starts_at < $3) * 5
             + coalesce((SELECT sum(r.minutes) FROM club_room_minutes r
                WHERE r.club_id = c.id AND r.week = $1), 0) / 10)::bigint AS points
         FROM clubs c WHERE c.closed_at IS NULL
         ORDER BY points DESC, c.name",
    )
    .bind(week)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(db_err)
}

/// This week's standings (the top ten, and your clubs wherever they are)
/// and last week's clubs of the week.
async fn leaderboard(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let now = Utc::now();
    let week = week_of(now);
    let mine: Vec<Uuid> =
        sqlx::query_scalar("SELECT club_id FROM club_members WHERE player_id = $1")
            .bind(me)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    let all = standings(&state.db, week).await?;
    let rows: Vec<Value> = all
        .iter()
        .enumerate()
        .filter(|(i, s)| *i < 10 || mine.contains(&s.id))
        .map(|(i, s)| {
            json!({
                "rank": i + 1, "id": s.id.to_string(), "name": s.name, "crest": s.crest,
                "color": s.color, "points": s.points, "mine": mine.contains(&s.id),
            })
        })
        .collect();
    let last: Vec<(i16, Uuid, String, String, String, i32, i32)> = sqlx::query_as(
        "SELECT a.rank, c.id, c.name, c.crest, c.color, a.points, a.coins
         FROM club_week_awards a JOIN clubs c ON c.id = a.club_id
         WHERE a.week = $1 ORDER BY a.rank",
    )
    .bind(week - Duration::days(7))
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({
        "week_ends": (midnight(week) + Duration::days(7)).timestamp(),
        "standings": rows,
        "last": last.iter().map(|(rank, id, name, crest, color, points, coins)| json!({
            "rank": rank, "id": id.to_string(), "name": name, "crest": crest,
            "color": color, "points": points, "coins": coins,
        })).collect::<Vec<_>>(),
        "awards": AWARDS,
    })))
}

/// Last week's top three, once: into their treasuries, and their owners
/// and moderators told. Runs with the club sweep.
pub async fn award_last_week(state: &SocialState, now: DateTime<Utc>) -> ApiResult<usize> {
    // The last week settled (awarded, or with nobody to award), so the
    // minute-by-minute sweep doesn't work it out again.
    static SETTLED: std::sync::Mutex<Option<NaiveDate>> = std::sync::Mutex::new(None);
    let week = week_of(now) - Duration::days(7);
    if *SETTLED.lock().unwrap() == Some(week) {
        return Ok(0);
    }
    let done: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM club_week_awards WHERE week = $1)")
            .bind(week)
            .fetch_one(&state.db)
            .await
            .map_err(db_err)?;
    if done {
        *SETTLED.lock().unwrap() = Some(week);
        return Ok(0);
    }
    let top: Vec<Standing> = standings(&state.db, week)
        .await?
        .into_iter()
        .filter(|s| s.points > 0)
        .take(AWARDS.len())
        .collect();
    let mut paid = 0;
    for (i, s) in top.iter().enumerate() {
        let coins = AWARDS[i];
        let mut tx = state.db.begin().await.map_err(db_err)?;
        let fresh = sqlx::query(
            "INSERT INTO club_week_awards (week, club_id, rank, points, coins) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING",
        )
        .bind(week)
        .bind(s.id)
        .bind(i as i16 + 1)
        .bind(s.points as i32)
        .bind(coins)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?
        .rows_affected();
        if fresh == 0 {
            continue;
        }
        clubs::reward_treasury(
            &mut tx,
            s.id,
            coins,
            "club_award",
            &format!("award:{week}:{}", s.id),
        )
        .await?;
        tx.commit().await.map_err(db_err)?;
        paid += 1;
        let (_, staff) = clubs::staff(&state.db, s.id).await.map_err(db_err)?;
        for p in staff {
            notify(
                state,
                p,
                "club_award",
                json!({ "club": s.name, "club_id": s.id.to_string(), "crest": s.crest,
                        "rank": i + 1, "coins": coins }),
            )
            .await;
        }
    }
    *SETTLED.lock().unwrap() = Some(week);
    Ok(paid)
}

// ---- events ---------------------------------------------------------------------------

/// What a place is called (a public place, or a club's lot).
async fn place_name(db: &sqlx::PgPool, place: &str) -> String {
    if let Some((_, name)) = PLACES.iter().find(|(k, _)| *k == place) {
        return name.to_string();
    }
    let club: Option<String> = sqlx::query_scalar(
        "SELECT c.name FROM leases l JOIN clubs c ON c.id = l.club_id WHERE l.plot = $1 AND l.state <> 'ended'",
    )
    .bind(place)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    match club {
        Some(name) => format!("{name}'s clubhouse"),
        None => lot_name(place),
    }
}

type EventRow = (
    i64,
    Uuid,
    String,
    String,
    String,
    String,
    String,
    DateTime<Utc>,
    DateTime<Utc>,
);

/// Upcoming and live events, soonest first: what, who's holding it, where,
/// how many are going (and which of your friends), and whether you are.
async fn events(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let rows: Vec<EventRow> = sqlx::query_as(
        "SELECT e.id, c.id, c.name, c.crest, c.color, e.title, e.place, e.starts_at, e.ends_at
         FROM club_events e JOIN clubs c ON c.id = e.club_id
         WHERE NOT e.cancelled AND e.ends_at > now() AND c.closed_at IS NULL
         ORDER BY e.starts_at LIMIT 50",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    let now = Utc::now();
    let mut out = vec![];
    for (id, club, name, crest, color, title, place, starts, ends) in rows {
        let (going, mine): (i64, bool) = sqlx::query_as(
            "SELECT count(*), coalesce(bool_or(player_id = $2), false) FROM club_event_rsvps WHERE event_id = $1",
        )
        .bind(id)
        .bind(me)
        .fetch_one(&state.db)
        .await
        .map_err(db_err)?;
        let friends: Vec<String> = sqlx::query_scalar(
            "SELECT p.display_name FROM club_event_rsvps r JOIN players p ON p.id = r.player_id
             JOIN friendships f ON (f.a = LEAST(r.player_id, $2) AND f.b = GREATEST(r.player_id, $2))
             WHERE r.event_id = $1 AND r.player_id <> $2 ORDER BY r.at LIMIT 5",
        )
        .bind(id)
        .bind(me)
        .fetch_all(&state.db)
        .await
        .map_err(db_err)?;
        let staff = clubs::role_of(&state.db, club, me)
            .await?
            .is_some_and(|r| r != "member");
        out.push(json!({
            "id": id, "title": title, "place": place, "place_name": place_name(&state.db, &place).await,
            "starts_at": starts.timestamp(), "ends_at": ends.timestamp(), "live": starts <= now,
            "club": { "id": club.to_string(), "name": name, "crest": crest, "color": color },
            "going": going, "me": mine, "friends": friends, "staff": staff,
        }));
    }
    Ok(Json(json!({
        "events": out,
        "places": PLACES.iter().map(|(k, n)| json!({ "key": k, "name": n })).collect::<Vec<_>>(),
        "plan_days": PLAN_DAYS,
    })))
}

#[derive(Deserialize)]
struct PlanReq {
    title: String,
    place: String,
    /// Unix seconds.
    starts_at: i64,
    /// 1 or 2.
    hours: i64,
}

/// The owner or a moderator plans an event, at a public place or the club's lot.
async fn plan(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<PlanReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = clubs::club(&state.db, uuid(&id)?).await?;
    clubs::require_staff(&state.db, c.id, me).await?;
    let title = clean_chat(&req.title)
        .filter(|t| (3..=MAX_TITLE).contains(&t.chars().count()))
        .ok_or_else(|| {
            ApiError::bad_request("bad_title", "Give the event a name (3 to 60 letters).")
        })?;
    let own_lot: Option<String> = sqlx::query_scalar(
        "SELECT plot FROM leases WHERE club_id = $1 AND state <> 'ended' AND plot LIKE 'lot:%'",
    )
    .bind(c.id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    if !PLACES.iter().any(|(k, _)| *k == req.place) && own_lot.as_deref() != Some(&req.place) {
        return Err(ApiError::bad_request(
            "bad_place",
            "Events are held at public places in the city (or your clubhouse's lot).",
        ));
    }
    let now = Utc::now();
    let starts = Utc
        .timestamp_opt(req.starts_at, 0)
        .single()
        .ok_or_else(|| ApiError::bad_request("bad_time", "That's not a time."))?;
    if starts < now - Duration::minutes(5) || starts > now + Duration::days(PLAN_DAYS) {
        return Err(ApiError::bad_request(
            "bad_time",
            format!("Pick a time in the next {PLAN_DAYS} days."),
        ));
    }
    if !(1..=2).contains(&req.hours) {
        return Err(ApiError::bad_request(
            "bad_length",
            "An event lasts an hour or two.",
        ));
    }
    let planned: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM club_events WHERE club_id = $1 AND NOT cancelled AND ends_at > now()",
    )
    .bind(c.id)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    if planned >= MAX_PLANNED {
        return Err(conflict(
            "too_many",
            format!("A club can have {MAX_PLANNED} events planned at once."),
        ));
    }
    let event: i64 = sqlx::query_scalar(
        "INSERT INTO club_events (club_id, title, place, starts_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(c.id)
    .bind(&title)
    .bind(&req.place)
    .bind(starts)
    .bind(starts + Duration::hours(req.hours))
    .bind(me)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    // Whoever plans it is going, and everyone online hears there's something new.
    sqlx::query("INSERT INTO club_event_rsvps (event_id, player_id) VALUES ($1, $2)")
        .bind(event)
        .bind(me)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    state.hub.broadcast(&json!({ "t": "club_events" }));
    Ok(Json(json!({ "id": event, "title": title })))
}

/// Cancels an event (the owner or a moderator); those going are told.
async fn cancel(
    State(state): S,
    headers: HeaderMap,
    Path((id, event)): Path<(String, i64)>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let c = clubs::club(&state.db, uuid(&id)?).await?;
    clubs::require_staff(&state.db, c.id, me).await?;
    let title: Option<String> = sqlx::query_scalar(
        "UPDATE club_events SET cancelled = true WHERE id = $1 AND club_id = $2 AND NOT cancelled RETURNING title",
    )
    .bind(event)
    .bind(c.id)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    let title = title.ok_or_else(|| {
        ApiError::new(StatusCode::NOT_FOUND, "no_event", "There's no such event.")
    })?;
    let going: Vec<Uuid> =
        sqlx::query_scalar("SELECT player_id FROM club_event_rsvps WHERE event_id = $1")
            .bind(event)
            .fetch_all(&state.db)
            .await
            .map_err(db_err)?;
    for p in going.into_iter().filter(|p| *p != me) {
        notify(
            &state,
            p,
            "club_event_cancelled",
            json!({ "club": c.name, "crest": c.crest, "title": title }),
        )
        .await;
    }
    state.hub.broadcast(&json!({ "t": "club_events" }));
    Ok(Json(json!({ "cancelled": event })))
}

#[derive(Deserialize)]
struct RsvpReq {
    going: bool,
}

/// "I'm going" (or not any more): anyone can.
async fn rsvp(
    State(state): S,
    headers: HeaderMap,
    Path(event): Path<i64>,
    Json(req): Json<RsvpReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let open: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM club_events WHERE id = $1 AND NOT cancelled AND ends_at > now())",
    )
    .bind(event)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    if !open {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "no_event",
            "That event is over or was called off.",
        ));
    }
    if req.going {
        sqlx::query(
            "INSERT INTO club_event_rsvps (event_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(event)
        .bind(me)
        .execute(&state.db)
        .await
        .map_err(db_err)?;
    } else {
        sqlx::query("DELETE FROM club_event_rsvps WHERE event_id = $1 AND player_id = $2")
            .bind(event)
            .bind(me)
            .execute(&state.db)
            .await
            .map_err(db_err)?;
    }
    let going: i64 =
        sqlx::query_scalar("SELECT count(*) FROM club_event_rsvps WHERE event_id = $1")
            .bind(event)
            .fetch_one(&state.db)
            .await
            .map_err(db_err)?;
    Ok(Json(json!({ "going": going, "me": req.going })))
}

/// Reminds those going 15 minutes before an event, and tells them (and the
/// host club's members) when it starts. Runs with the club sweep.
pub async fn event_tick(state: &SocialState, now: DateTime<Utc>) -> ApiResult<()> {
    type Soon = (i64, Uuid, String, String, String, String, DateTime<Utc>);
    let soon: Vec<Soon> = sqlx::query_as(
        "UPDATE club_event_rsvps r SET reminded = true
         FROM club_events e JOIN clubs c ON c.id = e.club_id
         WHERE r.event_id = e.id AND NOT r.reminded AND NOT e.cancelled
           AND e.starts_at > $1 AND e.starts_at <= $1 + make_interval(mins => $2)
         RETURNING e.id, r.player_id, c.name, c.crest, e.title, e.place, e.starts_at",
    )
    .bind(now)
    .bind(REMIND_MINS as i32)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    for (id, p, club, crest, title, place, starts) in soon {
        notify(
            state,
            p,
            "club_event_soon",
            json!({ "event": id, "club": club, "crest": crest, "title": title, "place": place,
                    "place_name": place_name(&state.db, &place).await, "starts_at": starts.timestamp() }),
        )
        .await;
    }
    let started: Vec<(i64, Uuid, String, String, String, String)> = sqlx::query_as(
        "UPDATE club_events e SET started = true FROM clubs c
         WHERE c.id = e.club_id AND NOT e.started AND NOT e.cancelled
           AND e.starts_at <= $1 AND e.ends_at > $1
         RETURNING e.id, c.id, c.name, c.crest, e.title, e.place",
    )
    .bind(now)
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    for (id, club, name, crest, title, place) in started {
        let mut who: Vec<Uuid> =
            sqlx::query_scalar("SELECT player_id FROM club_event_rsvps WHERE event_id = $1")
                .bind(id)
                .fetch_all(&state.db)
                .await
                .map_err(db_err)?;
        let members: Vec<Uuid> =
            sqlx::query_scalar("SELECT player_id FROM club_members WHERE club_id = $1")
                .bind(club)
                .fetch_all(&state.db)
                .await
                .map_err(db_err)?;
        who.extend(members);
        who.sort();
        who.dedup();
        let body = json!({ "event": id, "club": name, "crest": crest, "title": title,
                           "place": place, "place_name": place_name(&state.db, &place).await });
        for p in who {
            notify(state, p, "club_event_now", body.clone()).await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_are_spots_in_the_city() {
        let map: commons_sim::map::MapFile =
            serde_json::from_str(include_str!("../../../../assets/maps/city.json")).unwrap();
        for (key, _) in PLACES {
            assert!(
                map.objects
                    .iter()
                    .any(|o| o.kind == "spot" && o.label.as_deref() == Some(key)),
                "no spot {key}"
            );
        }
        for lot in LOTS.iter() {
            assert!(
                map.objects
                    .iter()
                    .any(|o| o.kind == "spot" && o.label.as_deref() == Some(lot)),
                "no spot {lot}"
            );
        }
    }
}
