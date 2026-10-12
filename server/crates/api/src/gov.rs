//! Governance (spec §10): activity days and trust tiers, the town hall
//! (proposals, ranked-choice voting with secret ballots), phases, the public
//! ledger, and the Caretaker's tools (founding votes, decisions, reports).
//!
//! Who votes when (decided for launch):
//! - **Phase 0 (founding):** the Caretaker opens *founding votes* (the town's
//!   name, what lies beyond the bridge). One person, one vote for anyone with
//!   ≥ `founding_days` active days.
//! - **Phase 1 (equal voice):** begins when ≥ `phase1_players` players have
//!   ≥ 14 active days. Residents (≥ 7 active days) vote and may propose.
//! - **Phase 2 (time-weighted):** ≥ `phase2_players` such players and ≥ 90
//!   days into Phase 1; voice weight follows §10.2.
//!
//! Proposals move collecting → (discussion →) voting → passed/failed on
//! `stage_ends_at`; [`tick`] advances them (every 30 s, and before reads).
//! Ballots are stored apart from who cast them. Multi-option votes are
//! decided by ranked choice (instant runoff); yes/no votes by share of weight.

use crate::AppState;
use crate::auth::bearer;
use crate::error::{ApiError, ApiResult};
use crate::store::db_err;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_common::token::TrustTier;
use commons_common::{config, filter};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, Row};
use std::sync::{Arc, OnceLock};
use uuid::Uuid;

// ---- rules ----------------------------------------------------------------------

/// Thresholds, from the environment so tests and dev can run fast.
#[derive(Debug, Clone)]
pub struct Rules {
    /// An active day: at least this much time present…
    pub active_secs: i32,
    /// …and this many meaningful interactions (spec §10.2).
    pub active_interactions: i32,
    /// Active days to vote in founding votes, to be a Resident, a Steward.
    pub founding_days: i64,
    pub resident_days: i64,
    pub steward_days: i64,
    /// Phase 1: this many players with ≥ 14 active days.
    pub phase1_players: i64,
    /// Phase 2: this many such players, and this many days into Phase 1.
    pub phase2_players: i64,
    pub phase2_after_days: i64,
    /// Length of a governance "day" in seconds (stage durations are in these).
    pub day_secs: i64,
}

pub fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| Rules {
        active_secs: config::env_or("COMMONS_ACTIVE_SECS", 600),
        active_interactions: config::env_or("COMMONS_ACTIVE_INTERACTIONS", 3),
        founding_days: config::env_or("COMMONS_FOUNDING_DAYS", 3),
        resident_days: 7,
        steward_days: 60,
        phase1_players: config::env_or("COMMONS_PHASE1_PLAYERS", 50),
        phase2_players: config::env_or("COMMONS_PHASE2_PLAYERS", 300),
        phase2_after_days: 90,
        day_secs: config::env_or("COMMONS_GOV_DAY_SECS", 86_400),
    })
}

/// Stage lengths in governance days (spec §10.3).
const COLLECT_DAYS: i64 = 3;
const DISCUSS_DAYS: i64 = 3;
const VOTE_DAYS: i64 = 4;
/// Ranked votes put at most this many suggestions on the ballot.
const MAX_OPTIONS: usize = 8;
const SUPPORT_EACH: i64 = 3;

pub fn tier_for(days: i64, sanctioned_recently: bool) -> TrustTier {
    let r = rules();
    if days >= r.steward_days && !sanctioned_recently {
        TrustTier::Steward
    } else if days >= r.resident_days {
        TrustTier::Resident
    } else if days >= 1 {
        TrustTier::Newcomer
    } else {
        TrustTier::Visitor
    }
}

/// Voice weight (spec §10.2): one each until Phase 2, then
/// `min(4, 1 + log2(1 + days / 30))` over the last 365 days.
pub fn voice_weight(phase: i64, days: i64) -> f32 {
    if phase < 2 {
        return 1.0;
    }
    (1.0 + (1.0 + days as f32 / 30.0).log2()).min(4.0)
}

/// Ranked choice by instant runoff. `ballots` are rankings (option indices,
/// most preferred first) with weights. Returns the winner (if any ballots
/// count) and each round's first-preference totals; eliminated options
/// show as `None`.
pub fn instant_runoff(
    options: usize,
    ballots: &[(Vec<usize>, f32)],
) -> (Option<usize>, Vec<Vec<Option<f32>>>) {
    let mut alive = vec![true; options];
    let mut rounds = vec![];
    loop {
        let mut tally = vec![0f32; options];
        for (ranking, w) in ballots {
            if let Some(&top) = ranking.iter().find(|&&o| o < options && alive[o]) {
                tally[top] += w;
            }
        }
        rounds.push((0..options).map(|o| alive[o].then_some(tally[o])).collect());
        let total: f32 = tally.iter().sum();
        let remaining: Vec<usize> = (0..options).filter(|&o| alive[o]).collect();
        if total <= 0.0 || remaining.is_empty() {
            return (None, rounds);
        }
        let best = *remaining
            .iter()
            .max_by(|&&a, &&b| tally[a].total_cmp(&tally[b]).then(b.cmp(&a)))
            .unwrap();
        if tally[best] * 2.0 > total || remaining.len() == 1 {
            return (Some(best), rounds);
        }
        // Eliminate the weakest (on a tie, the later-listed option).
        let worst = *remaining
            .iter()
            .min_by(|&&a, &&b| tally[a].total_cmp(&tally[b]).then(b.cmp(&a)))
            .unwrap();
        alive[worst] = false;
    }
}

fn meets(share: f32, threshold: f32) -> bool {
    if threshold <= 0.5 {
        share > 0.5
    } else {
        share >= threshold - 1e-6
    }
}

// ---- activity -------------------------------------------------------------------

/// Adds time and interactions to today's activity.
pub async fn record_activity(
    conn: &mut PgConnection,
    player: Uuid,
    secs: i32,
    interactions: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO activity_days (player_id, day, seconds, interactions)
         VALUES ($1, (now() AT TIME ZONE 'utc')::date, $2, $3)
         ON CONFLICT (player_id, day) DO UPDATE
         SET seconds = activity_days.seconds + EXCLUDED.seconds,
             interactions = activity_days.interactions + EXCLUDED.interactions",
    )
    .bind(player)
    .bind(secs.max(0))
    .bind(interactions.max(0))
    .execute(conn)
    .await
    .map(|_| ())
}

/// One meaningful interaction done through the API (a post, a donation…).
/// Best effort: activity never blocks the action itself.
pub async fn touch(db: &PgPool, player: Uuid) {
    if let Ok(mut conn) = db.acquire().await
        && let Err(e) = record_activity(&mut conn, player, 0, 1).await
    {
        tracing::warn!(error = %e, "recording activity failed");
    }
}

/// Active days in the last 365 days.
pub async fn active_days(conn: &mut PgConnection, player: Uuid) -> sqlx::Result<i64> {
    let r = rules();
    sqlx::query_scalar(
        "SELECT count(*) FROM activity_days
         WHERE player_id = $1 AND day > (now() AT TIME ZONE 'utc')::date - 365
           AND seconds >= $2 AND interactions >= $3",
    )
    .bind(player)
    .bind(r.active_secs)
    .bind(r.active_interactions)
    .fetch_one(conn)
    .await
}

/// Active days of every player who has any, for electorates and phases.
async fn all_active_days(conn: &mut PgConnection) -> sqlx::Result<Vec<(Uuid, i64)>> {
    let r = rules();
    sqlx::query_as(
        "SELECT player_id, count(*) FROM activity_days
         WHERE day > (now() AT TIME ZONE 'utc')::date - 365 AND seconds >= $1 AND interactions >= $2
         GROUP BY player_id",
    )
    .bind(r.active_secs)
    .bind(r.active_interactions)
    .fetch_all(conn)
    .await
}

async fn sanctioned_since(conn: &mut PgConnection, player: Uuid, days: i32) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sanctions WHERE player_id = $1 AND kind = 'mute'
                        AND created_at > now() - make_interval(days => $2))",
    )
    .bind(player)
    .bind(days)
    .fetch_one(conn)
    .await
}

/// Recomputes and stores a player's trust tier (called when signing in).
pub async fn refresh_tier(db: &PgPool, player: Uuid) -> sqlx::Result<TrustTier> {
    let mut conn = db.acquire().await?;
    let days = active_days(&mut conn, player).await?;
    let tier = tier_for(days, sanctioned_since(&mut conn, player, 30).await?);
    let name = match tier {
        TrustTier::Visitor => "visitor",
        TrustTier::Newcomer => "newcomer",
        TrustTier::Resident => "resident",
        TrustTier::Steward => "steward",
    };
    sqlx::query("UPDATE players SET trust_tier = $2::trust_tier WHERE id = $1")
        .bind(player)
        .bind(name)
        .execute(&mut *conn)
        .await?;
    Ok(tier)
}

/// Unix time a mute ends, or 0 if not muted.
pub async fn muted_until(db: &PgPool, player: Uuid) -> sqlx::Result<u64> {
    let until: Option<i64> = sqlx::query_scalar(
        "SELECT extract(epoch FROM max(until))::bigint FROM sanctions
         WHERE player_id = $1 AND kind = 'mute' AND until > now()",
    )
    .bind(player)
    .fetch_one(db)
    .await?;
    Ok(until.unwrap_or(0).max(0) as u64)
}

// ---- town state, phases, ledger ---------------------------------------------------------

async fn ledger(
    conn: &mut PgConnection,
    kind: &str,
    summary: &str,
    data: Value,
) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO governance_ledger (kind, summary, data) VALUES ($1, $2, $3)")
        .bind(kind)
        .bind(summary)
        .bind(data)
        .execute(conn)
        .await
        .map(|_| ())
}

async fn state_get(conn: &mut PgConnection, key: &str) -> sqlx::Result<Value> {
    Ok(
        sqlx::query_scalar("SELECT value FROM town_state WHERE key = $1")
            .bind(key)
            .fetch_optional(conn)
            .await?
            .unwrap_or(Value::Null),
    )
}

async fn state_set(conn: &mut PgConnection, key: &str, value: Value) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO town_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(key)
        .bind(value)
        .execute(conn)
        .await
        .map(|_| ())
}

pub async fn phase(conn: &mut PgConnection) -> sqlx::Result<i64> {
    Ok(state_get(conn, "phase").await?["phase"]
        .as_i64()
        .unwrap_or(0))
}

/// Players with ≥ 14 active days (the phase measure).
fn settled(days: &[(Uuid, i64)]) -> i64 {
    days.iter().filter(|(_, d)| *d >= 14).count() as i64
}

/// Moves to the next phase when its condition is met.
async fn check_phase(conn: &mut PgConnection) -> sqlx::Result<()> {
    let r = rules();
    let cur = state_get(conn, "phase").await?;
    let phase = cur["phase"].as_i64().unwrap_or(0);
    let since = cur["since"].as_i64().unwrap_or(0);
    let now = chrono::Utc::now().timestamp();
    let n = settled(&all_active_days(conn).await?);
    let next = match phase {
        0 if n >= r.phase1_players => Some((
            1,
            "Phase 1 begins: equal voice. Residents can now propose and vote.",
        )),
        1 if n >= r.phase2_players && now - since >= r.phase2_after_days * 86_400 => Some((
            2,
            "Phase 2 begins: voice weight now grows with time spent in the town.",
        )),
        _ => None,
    };
    if let Some((p, text)) = next {
        state_set(conn, "phase", json!({ "phase": p, "since": now })).await?;
        ledger(
            conn,
            "phase",
            text,
            json!({ "phase": p, "settled_players": n }),
        )
        .await?;
    }
    Ok(())
}

// ---- proposals: lifecycle ------------------------------------------------------------------

fn gov_days(n: i64) -> String {
    format!("{} seconds", n * rules().day_secs)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Electorate {
    Founders,
    Residents,
}

impl Electorate {
    fn parse(s: &str) -> Electorate {
        if s == "founders" {
            Electorate::Founders
        } else {
            Electorate::Residents
        }
    }
    fn min_days(self) -> i64 {
        match self {
            Electorate::Founders => rules().founding_days,
            Electorate::Residents => rules().resident_days,
        }
    }
}

/// Advances every proposal whose stage has ended, and checks the phase.
pub async fn tick(db: &PgPool, catalog_goal_target: i32) -> sqlx::Result<()> {
    let due: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM proposals WHERE status IN ('collecting', 'discussion', 'voting') AND stage_ends_at <= now() ORDER BY id",
    )
    .fetch_all(db)
    .await?;
    for id in due {
        let mut tx = db.begin().await?;
        advance(&mut tx, id, catalog_goal_target).await?;
        tx.commit().await?;
    }
    let mut conn = db.acquire().await?;
    check_phase(&mut conn).await
}

async fn advance(conn: &mut PgConnection, id: i64, goal_target: i32) -> sqlx::Result<()> {
    let row = sqlx::query(
        "SELECT kind, title, status, options, ranked FROM proposals WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    let status: String = row.get("status");
    let title: String = row.get("title");
    match status.as_str() {
        "collecting" => {
            // The most-supported suggestions go on the ballot.
            let options: Vec<String> = sqlx::query_scalar(
                "SELECT s.text FROM proposal_suggestions s
                 LEFT JOIN suggestion_support p ON p.suggestion_id = s.id
                 WHERE s.proposal_id = $1
                 GROUP BY s.id ORDER BY count(p.player_id) DESC, s.created_at LIMIT $2",
            )
            .bind(id)
            .bind(MAX_OPTIONS as i64)
            .fetch_all(&mut *conn)
            .await?;
            if options.len() < 2 {
                sqlx::query("UPDATE proposals SET status = 'failed', result = $2 WHERE id = $1")
                    .bind(id)
                    .bind(json!({ "reason": "Not enough suggestions to vote on." }))
                    .execute(&mut *conn)
                    .await?;
                return ledger(
                    conn,
                    "proposal_failed",
                    &format!("“{title}” closed: not enough suggestions."),
                    json!({ "proposal": id }),
                )
                .await;
            }
            sqlx::query(&format!(
                "UPDATE proposals SET status = 'voting', options = $2, stage_ends_at = now() + interval '{}' WHERE id = $1",
                gov_days(VOTE_DAYS)
            ))
            .bind(id)
            .bind(json!(options))
            .execute(&mut *conn)
            .await?;
            ledger(
                conn,
                "voting_opened",
                &format!("Voting opened on “{title}”."),
                json!({ "proposal": id, "options": options }),
            )
            .await
        }
        "discussion" => {
            sqlx::query(&format!(
                "UPDATE proposals SET status = 'voting', stage_ends_at = now() + interval '{}' WHERE id = $1",
                gov_days(VOTE_DAYS)
            ))
            .bind(id)
            .execute(&mut *conn)
            .await?;
            ledger(
                conn,
                "voting_opened",
                &format!("Voting opened on “{title}”."),
                json!({ "proposal": id }),
            )
            .await
        }
        "voting" => close(conn, id, goal_target).await,
        _ => Ok(()),
    }
}

/// Counts the ballots and records the result.
async fn close(conn: &mut PgConnection, id: i64, goal_target: i32) -> sqlx::Result<()> {
    let p = sqlx::query("SELECT kind, title, options, ranked, electorate, threshold, quorum FROM proposals WHERE id = $1")
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
    let kind: String = p.get("kind");
    let title: String = p.get("title");
    let options: Vec<String> = serde_json::from_value(p.get("options")).unwrap_or_default();
    let ranked: bool = p.get("ranked");
    let threshold: f32 = p.get("threshold");
    let quorum: f32 = p.get("quorum");
    let electorate = Electorate::parse(p.get::<&str, _>("electorate"));

    let rows = sqlx::query("SELECT ranking, weight FROM proposal_ballots WHERE proposal_id = $1")
        .bind(id)
        .fetch_all(&mut *conn)
        .await?;
    let ballots: Vec<(Vec<usize>, f32)> = rows
        .iter()
        .map(|r| {
            let ranking: Vec<i16> = r.get("ranking");
            (
                ranking.into_iter().map(|v| v as usize).collect(),
                r.get("weight"),
            )
        })
        .collect();
    let turnout: f32 = ballots.iter().map(|b| b.1).sum();
    let ph = phase(conn).await?;
    let eligible: f32 = all_active_days(conn)
        .await?
        .iter()
        .filter(|(_, d)| *d >= electorate.min_days())
        .map(|(_, d)| voice_weight(ph, *d))
        .sum();
    let quorum_met = turnout > 0.0 && turnout >= quorum * eligible;

    let (passed, winner, detail) = if ranked {
        let (winner, rounds) = instant_runoff(options.len(), &ballots);
        (
            quorum_met && winner.is_some(),
            winner,
            json!({ "rounds": rounds }),
        )
    } else {
        let yes: f32 = ballots
            .iter()
            .filter(|b| b.0.first() == Some(&0))
            .map(|b| b.1)
            .sum();
        let share = if turnout > 0.0 { yes / turnout } else { 0.0 };
        let ok = meets(share, threshold);
        (
            quorum_met && ok,
            (quorum_met && ok).then_some(0),
            json!({ "yes": yes, "no": turnout - yes, "share": share }),
        )
    };
    let result = json!({
        "turnout": turnout, "eligible": eligible, "quorum_met": quorum_met,
        "winner": winner, "winner_text": winner.and_then(|w| options.get(w)),
        "voters": ballots.len(), "detail": detail,
    });
    sqlx::query("UPDATE proposals SET status = $2, result = $3 WHERE id = $1")
        .bind(id)
        .bind(if passed { "passed" } else { "failed" })
        .bind(&result)
        .execute(&mut *conn)
        .await?;

    let summary = if !quorum_met {
        format!(
            "“{title}” did not reach quorum ({} of {:.0} needed).",
            ballots.len(),
            (quorum * eligible).ceil()
        )
    } else if let (true, Some(w)) = (passed, winner) {
        if ranked {
            format!(
                "“{title}”: the town chose “{}”.",
                options.get(w).cloned().unwrap_or_default()
            )
        } else {
            format!("“{title}” passed.")
        }
    } else {
        format!("“{title}” did not pass.")
    };
    ledger(
        conn,
        if passed {
            "proposal_passed"
        } else {
            "proposal_failed"
        },
        &summary,
        json!({ "proposal": id, "result": result }),
    )
    .await?;

    // What a passed founding vote changes.
    if let (true, Some(w)) = (passed, winner) {
        let choice = options.get(w).cloned().unwrap_or_default();
        match kind.as_str() {
            "town_name" => {
                state_set(conn, "name", json!(choice)).await?;
                ledger(
                    conn,
                    "town_named",
                    &format!("The town is now called {choice}."),
                    json!({ "name": choice }),
                )
                .await?;
            }
            "bridge" => {
                sqlx::query(
                    "INSERT INTO town_goals (key, title, blurb, target, seq)
                     VALUES ($1, $2, $3, $4, (SELECT coalesce(max(seq), 0) + 1 FROM town_goals))
                     ON CONFLICT (key) DO NOTHING",
                )
                .bind(format!("bridge_{id}"))
                .bind(format!("Build beyond the bridge: {choice}"))
                .bind("The town voted for it. Every coin brings the builders closer.")
                .bind(goal_target)
                .execute(&mut *conn)
                .await?;
                ledger(
                    conn,
                    "construction",
                    &format!("A construction pool opened for {choice}, beyond the bridge."),
                    json!({ "proposal": id }),
                )
                .await?;
            }
            _ => {}
        }
    }
    Ok(())
}

// ---- HTTP: helpers -----------------------------------------------------------------------

type S = State<Arc<AppState>>;

/// Target of the construction pool a passed bridge vote opens.
const BRIDGE_GOAL: i32 = 20_000;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/gov/story", get(story))
        .route("/gov/ledger", get(ledger_list))
        .route("/gov/proposals", get(proposals).post(create))
        .route("/gov/proposals/{id}", get(detail))
        .route("/gov/proposals/{id}/comment", post(comment))
        .route("/gov/proposals/{id}/suggest", post(suggest))
        .route("/gov/proposals/{id}/support/{sid}", post(support))
        .route("/gov/proposals/{id}/vote", post(vote))
        .route("/gov/proposals/{id}/advance", post(advance_now))
        .route("/gov/report", post(report))
        .route("/gov/reports", get(reports))
        .route("/gov/reports/{id}/resolve", post(resolve))
        .route("/gov/decision", post(decision))
}

struct Me {
    id: Uuid,
    name: String,
    days: i64,
    caretaker: bool,
}

fn caretaker_emails(state: &AppState) -> Vec<String> {
    let mut list: Vec<String> = config::env_str("COMMONS_CARETAKERS", "")
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    if state.dev {
        // In development, signing in as "Caretaker" gives the tools.
        list.push("caretaker@dev.commons.local".into());
    }
    list
}

pub async fn is_caretaker(state: &AppState, player: Uuid) -> ApiResult<bool> {
    let email: Option<String> = sqlx::query_scalar(
        "SELECT a.email FROM players p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1",
    )
    .bind(player)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    Ok(email.is_some_and(|e| caretaker_emails(state).contains(&e.to_lowercase())))
}

async fn me(state: &AppState, headers: &HeaderMap) -> ApiResult<Me> {
    let who = bearer(state, headers)?;
    let id =
        Uuid::parse_str(&who.sub).map_err(|_| ApiError::unauthorized("not a player account"))?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let days = active_days(&mut conn, id).await.map_err(db_err)?;
    Ok(Me {
        id,
        name: who.name,
        days,
        caretaker: is_caretaker(state, id).await?,
    })
}

fn forbidden(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, code, msg.to_string())
}

fn conflict(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg.to_string())
}

async fn require_caretaker(state: &AppState, headers: &HeaderMap) -> ApiResult<Me> {
    let me = me(state, headers).await?;
    if !me.caretaker {
        return Err(forbidden(
            "caretaker_only",
            "Only the Caretaker can do that.",
        ));
    }
    Ok(me)
}

async fn run_tick(state: &AppState) -> ApiResult<()> {
    tick(&state.db, BRIDGE_GOAL).await.map_err(db_err)
}

async fn not_muted(state: &AppState, me: &Me) -> ApiResult<()> {
    if muted_until(&state.db, me.id).await.map_err(db_err)? > 0 {
        return Err(forbidden("muted", "You're muted for a little while."));
    }
    Ok(())
}

// ---- HTTP: reading -----------------------------------------------------------------------

/// The Story of the Town board: name, phase, what unlocks next, open votes,
/// recent decisions, and (signed in) where you stand.
async fn story(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    run_tick(&state).await?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let name = state_get(&mut conn, "name").await.map_err(db_err)?;
    let ph = phase(&mut conn).await.map_err(db_err)?;
    let all = all_active_days(&mut conn).await.map_err(db_err)?;
    let settled = settled(&all);
    let r = rules();
    let next = match ph {
        0 => {
            json!({ "phase": 1, "need": r.phase1_players, "have": settled, "text": format!("Phase 1 (equal voice) begins when {} neighbours have 14 active days.", r.phase1_players) })
        }
        1 => {
            json!({ "phase": 2, "need": r.phase2_players, "have": settled, "text": format!("Phase 2 (time-weighted voice) needs {} such neighbours and 90 days of Phase 1.", r.phase2_players) })
        }
        _ => {
            json!({ "phase": 3, "text": "Phase 3 (self-governing) begins with the first elected council." })
        }
    };
    let open: Vec<Value> = sqlx::query(
        "SELECT id, title, status, extract(epoch FROM stage_ends_at)::bigint AS ends FROM proposals
         WHERE status IN ('collecting', 'discussion', 'voting') ORDER BY stage_ends_at",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?
    .iter()
    .map(|r| json!({ "id": r.get::<i64, _>("id"), "title": r.get::<String, _>("title"), "status": r.get::<String, _>("status"), "ends": r.get::<i64, _>("ends") }))
    .collect();
    let recent = ledger_rows(&mut conn, None, 6).await?;
    let mut out = json!({
        "name": name, "phase": ph, "next": next, "open": open, "recent": recent,
        "rules": { "founding_days": r.founding_days, "resident_days": r.resident_days, "active_minutes": r.active_secs / 60, "active_interactions": r.active_interactions },
    });
    if let Ok(me) = me(&state, &headers).await {
        let mut voted: Vec<i64> = vec![];
        for o in &open {
            let id = o["id"].as_i64().unwrap_or(0);
            let v: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM proposal_voters WHERE proposal_id = $1 AND voter_id = $2)")
                .bind(id)
                .bind(me.id)
                .fetch_one(&mut *conn)
                .await
                .map_err(db_err)?;
            if v {
                voted.push(id);
            }
        }
        let sanctioned = sanctioned_since(&mut conn, me.id, 30)
            .await
            .map_err(db_err)?;
        out["me"] = json!({
            "days": me.days, "tier": tier_for(me.days, sanctioned), "caretaker": me.caretaker,
            "can_vote_founding": me.days >= r.founding_days, "can_vote": me.days >= r.resident_days && ph >= 1,
            "can_propose": me.caretaker || (ph >= 1 && me.days >= r.resident_days),
            "voted": voted,
        });
    }
    Ok(Json(out))
}

async fn ledger_rows(
    conn: &mut PgConnection,
    before: Option<i64>,
    limit: i64,
) -> ApiResult<Vec<Value>> {
    Ok(sqlx::query(
        "SELECT id, kind, summary, extract(epoch FROM at)::bigint AS at FROM governance_ledger
         WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2",
    )
    .bind(before)
    .bind(limit)
    .fetch_all(conn)
    .await
    .map_err(db_err)?
    .iter()
    .map(|r| json!({ "id": r.get::<i64, _>("id"), "kind": r.get::<String, _>("kind"), "summary": r.get::<String, _>("summary"), "at": r.get::<i64, _>("at") }))
    .collect())
}

#[derive(Deserialize)]
struct LedgerQuery {
    before: Option<i64>,
}

/// The public ledger, newest first (no sign-in needed: it's public).
async fn ledger_list(
    State(state): S,
    axum::extract::Query(q): axum::extract::Query<LedgerQuery>,
) -> ApiResult<Json<Vec<Value>>> {
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    Ok(Json(ledger_rows(&mut conn, q.before, 50).await?))
}

async fn proposals(State(state): S, headers: HeaderMap) -> ApiResult<Json<Vec<Value>>> {
    me(&state, &headers).await?;
    run_tick(&state).await?;
    let rows = sqlx::query(
        "SELECT id, kind, title, status, author_name, by_caretaker, extract(epoch FROM stage_ends_at)::bigint AS ends, result
         FROM proposals ORDER BY (status IN ('collecting', 'discussion', 'voting')) DESC, id DESC LIMIT 40",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(
        rows.iter()
            .map(|r| json!({
                "id": r.get::<i64, _>("id"), "kind": r.get::<String, _>("kind"), "title": r.get::<String, _>("title"),
                "status": r.get::<String, _>("status"), "author": r.get::<String, _>("author_name"),
                "by_caretaker": r.get::<bool, _>("by_caretaker"), "ends": r.get::<i64, _>("ends"),
                "result": r.get::<Option<Value>, _>("result"),
            }))
            .collect(),
    ))
}

async fn detail(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let me = me(&state, &headers).await?;
    run_tick(&state).await?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let p = sqlx::query(
        "SELECT id, kind, title, body, options, ranked, electorate, threshold, quorum, author_name, by_caretaker, status,
                extract(epoch FROM stage_ends_at)::bigint AS ends, extract(epoch FROM created_at)::bigint AS created, result
         FROM proposals WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(db_err)?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "No such proposal."))?;
    let electorate = Electorate::parse(p.get::<&str, _>("electorate"));
    let voted: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM proposal_voters WHERE proposal_id = $1 AND voter_id = $2)",
    )
    .bind(id)
    .bind(me.id)
    .fetch_one(&mut *conn)
    .await
    .map_err(db_err)?;
    let voters: i64 =
        sqlx::query_scalar("SELECT count(*) FROM proposal_voters WHERE proposal_id = $1")
            .bind(id)
            .fetch_one(&mut *conn)
            .await
            .map_err(db_err)?;
    let suggestions: Vec<Value> = sqlx::query(
        "SELECT s.id, s.text, (s.author_id = $2) AS mine,
                count(p.player_id) AS support, bool_or(p.player_id = $2) AS supported
         FROM proposal_suggestions s LEFT JOIN suggestion_support p ON p.suggestion_id = s.id
         WHERE s.proposal_id = $1 GROUP BY s.id ORDER BY support DESC, s.created_at",
    )
    .bind(id)
    .bind(me.id)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?
    .iter()
    .map(|r| json!({ "id": r.get::<i64, _>("id"), "text": r.get::<String, _>("text"), "mine": r.get::<bool, _>("mine"),
                     "support": r.get::<i64, _>("support"), "supported": r.get::<Option<bool>, _>("supported").unwrap_or(false) }))
    .collect();
    let comments: Vec<Value> = sqlx::query(
        "SELECT author_name, body, extract(epoch FROM created_at)::bigint AS at FROM proposal_comments
         WHERE proposal_id = $1 AND NOT hidden ORDER BY created_at LIMIT 200",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_err)?
    .iter()
    .map(|r| json!({ "author": r.get::<String, _>("author_name"), "body": r.get::<String, _>("body"), "at": r.get::<i64, _>("at") }))
    .collect();
    let eligible = me.days >= electorate.min_days();
    Ok(Json(json!({
        "id": id, "kind": p.get::<String, _>("kind"), "title": p.get::<String, _>("title"), "body": p.get::<String, _>("body"),
        "options": p.get::<Value, _>("options"), "ranked": p.get::<bool, _>("ranked"),
        "electorate": p.get::<String, _>("electorate"), "threshold": p.get::<f32, _>("threshold"), "quorum": p.get::<f32, _>("quorum"),
        "author": p.get::<String, _>("author_name"), "by_caretaker": p.get::<bool, _>("by_caretaker"),
        "status": p.get::<String, _>("status"), "ends": p.get::<i64, _>("ends"), "created": p.get::<i64, _>("created"),
        "result": p.get::<Option<Value>, _>("result"),
        "voters": voters, "suggestions": suggestions, "comments": comments,
        "me": { "voted": voted, "eligible": eligible, "days": me.days, "needs_days": electorate.min_days(), "caretaker": me.caretaker },
    })))
}

// ---- HTTP: taking part ----------------------------------------------------------------------

#[derive(Deserialize)]
struct NewProposal {
    kind: String,
    title: String,
    #[serde(default)]
    body: String,
    /// Fixed options for a ranked vote (e.g. what lies beyond the bridge).
    #[serde(default)]
    options: Vec<String>,
    /// Collect options from players first (e.g. the town's name).
    #[serde(default)]
    collect: bool,
}

const PLAYER_KINDS: &[&str] = &["town_rule", "event", "public_building"];
const CARETAKER_KINDS: &[&str] = &[
    "town_name",
    "bridge",
    "town_rule",
    "event",
    "public_building",
    "founding",
];

async fn create(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<NewProposal>,
) -> ApiResult<Json<Value>> {
    let me = me(&state, &headers).await?;
    not_muted(&state, &me).await?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let ph = phase(&mut tx).await.map_err(db_err)?;
    let allowed = if me.caretaker {
        CARETAKER_KINDS
    } else {
        PLAYER_KINDS
    };
    if !allowed.contains(&req.kind.as_str()) {
        return Err(forbidden(
            "kind",
            "That kind of proposal isn't open to you.",
        ));
    }
    if !me.caretaker {
        if ph < 1 {
            return Err(forbidden(
                "founding",
                "During the founding phase the Caretaker opens the votes. Proposals open to Residents in Phase 1.",
            ));
        }
        if me.days < rules().resident_days {
            return Err(forbidden(
                "not_resident",
                "Proposals open to Residents (7 active days).",
            ));
        }
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM proposals WHERE author_id = $1 AND status IN ('collecting', 'discussion', 'voting'))",
        )
        .bind(me.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        if active {
            return Err(conflict(
                "one_at_a_time",
                "You already have a proposal open. One at a time.",
            ));
        }
    }
    let title = filter::clean_chat(&req.title)
        .filter(|t| t.chars().count() >= 3)
        .map(|t| t.chars().take(80).collect::<String>())
        .ok_or_else(|| ApiError::bad_request("title", "Give it a title."))?;
    let body: String = crate::town::clean_post(&req.body)
        .unwrap_or_default()
        .chars()
        .take(1000)
        .collect();
    let mut options: Vec<String> = req
        .options
        .iter()
        .filter_map(|o| filter::clean_chat(o))
        .map(|o| o.chars().take(40).collect())
        .collect();
    options.dedup();
    let (ranked, status, stage) = if req.collect {
        (true, "collecting", COLLECT_DAYS)
    } else if options.len() >= 2 {
        if options.len() > MAX_OPTIONS {
            return Err(ApiError::bad_request("options", "At most eight options."));
        }
        (true, "discussion", DISCUSS_DAYS)
    } else {
        options = vec!["Yes".into(), "No".into()];
        (false, "discussion", DISCUSS_DAYS)
    };
    let electorate = if ph == 0 { "founders" } else { "residents" };
    let threshold = if req.kind == "town_rule" { 0.6 } else { 0.5 };
    let id: i64 = sqlx::query_scalar(&format!(
        "INSERT INTO proposals (kind, title, body, options, ranked, electorate, threshold, author_id, author_name, by_caretaker, status, stage_ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + interval '{}') RETURNING id",
        gov_days(stage)
    ))
    .bind(&req.kind)
    .bind(&title)
    .bind(&body)
    .bind(json!(if req.collect { vec![] } else { options }))
    .bind(ranked)
    .bind(electorate)
    .bind(threshold)
    .bind(me.id)
    .bind(if me.caretaker { "the Caretaker".to_string() } else { me.name.clone() })
    .bind(me.caretaker)
    .bind(status)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    let who = if me.caretaker {
        "The Caretaker".to_string()
    } else {
        me.name.clone()
    };
    ledger(
        &mut tx,
        "proposal",
        &format!("{who} opened “{title}”."),
        json!({ "proposal": id, "kind": req.kind }),
    )
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    touch(&state.db, me.id).await;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
struct Text {
    text: String,
}

async fn status_of(conn: &mut PgConnection, id: i64) -> ApiResult<(String, Electorate)> {
    let row = sqlx::query("SELECT status, electorate FROM proposals WHERE id = $1")
        .bind(id)
        .fetch_optional(conn)
        .await
        .map_err(db_err)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "No such proposal."))?;
    Ok((
        row.get("status"),
        Electorate::parse(row.get::<&str, _>("electorate")),
    ))
}

async fn comment(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<Text>,
) -> ApiResult<Json<Value>> {
    let me = me(&state, &headers).await?;
    not_muted(&state, &me).await?;
    if me.days < 1 && !me.caretaker {
        return Err(forbidden(
            "newcomer",
            "Spend a little time in the town first (one active day) to join the discussion.",
        ));
    }
    let body = crate::town::clean_post(&req.text)
        .ok_or_else(|| ApiError::bad_request("empty", "Write something first."))?;
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let (status, _) = status_of(&mut conn, id).await?;
    if !["collecting", "discussion", "voting"].contains(&status.as_str()) {
        return Err(conflict("closed", "This proposal is closed."));
    }
    let recent: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM proposal_comments WHERE author_id = $1 AND created_at > now() - interval '15 seconds')",
    )
    .bind(me.id)
    .fetch_one(&mut *conn)
    .await
    .map_err(db_err)?;
    if recent {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "slow_down",
            "Take a breath between comments.",
        ));
    }
    sqlx::query("INSERT INTO proposal_comments (proposal_id, author_id, author_name, body) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(me.id)
        .bind(&me.name)
        .bind(body.chars().take(280).collect::<String>())
        .execute(&mut *conn)
        .await
        .map_err(db_err)?;
    touch(&state.db, me.id).await;
    Ok(Json(json!({ "ok": true })))
}

async fn suggest(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<Text>,
) -> ApiResult<Json<Value>> {
    let me = me(&state, &headers).await?;
    not_muted(&state, &me).await?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (status, electorate) = status_of(&mut tx, id).await?;
    if status != "collecting" {
        return Err(conflict(
            "not_collecting",
            "Suggestions are closed for this one.",
        ));
    }
    if me.days < electorate.min_days() {
        return Err(forbidden(
            "not_yet",
            &format!(
                "Suggestions are open to neighbours with {} active days.",
                electorate.min_days()
            ),
        ));
    }
    let text = filter::clean_chat(&req.text)
        .filter(|t| (2..=40).contains(&t.chars().count()))
        .ok_or_else(|| ApiError::bad_request("text", "Between 2 and 40 characters, please."))?;
    let r = sqlx::query("INSERT INTO proposal_suggestions (proposal_id, text, author_id) VALUES ($1, $2, $3) RETURNING id")
        .bind(id)
        .bind(&text)
        .bind(me.id)
        .fetch_one(&mut *tx)
        .await;
    let sid: i64 = match r {
        Ok(row) => row.get("id"),
        Err(e) if crate::store::is_unique_violation(&e) => {
            return Err(conflict(
                "duplicate",
                "You've made your suggestion, or someone already suggested that. Support theirs!",
            ));
        }
        Err(e) => return Err(db_err(e)),
    };
    // Your own suggestion counts as one of your supports.
    sqlx::query("INSERT INTO suggestion_support (suggestion_id, player_id) VALUES ($1, $2)")
        .bind(sid)
        .bind(me.id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    touch(&state.db, me.id).await;
    Ok(Json(json!({ "id": sid })))
}

async fn support(
    State(state): S,
    headers: HeaderMap,
    Path((id, sid)): Path<(i64, i64)>,
) -> ApiResult<Json<Value>> {
    let me = me(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (status, electorate) = status_of(&mut tx, id).await?;
    if status != "collecting" {
        return Err(conflict(
            "not_collecting",
            "Suggestions are closed for this one.",
        ));
    }
    if me.days < electorate.min_days() {
        return Err(forbidden(
            "not_yet",
            &format!(
                "Open to neighbours with {} active days.",
                electorate.min_days()
            ),
        ));
    }
    let mine: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM suggestion_support p JOIN proposal_suggestions s ON s.id = p.suggestion_id
         WHERE s.proposal_id = $1 AND p.player_id = $2",
    )
    .bind(id)
    .bind(me.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    if mine > SUPPORT_EACH {
        return Err(conflict("enough", "You've supported as many as you can."));
    }
    sqlx::query(
        "INSERT INTO suggestion_support (suggestion_id, player_id)
         SELECT id, $2 FROM proposal_suggestions WHERE id = $1 AND proposal_id = $3 ON CONFLICT DO NOTHING",
    )
    .bind(sid)
    .bind(me.id)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Vote {
    /// Option indices, most preferred first (one for yes/no).
    ranking: Vec<usize>,
}

async fn vote(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<Vote>,
) -> ApiResult<Json<Value>> {
    let me = me(&state, &headers).await?;
    run_tick(&state).await?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let p = sqlx::query(
        "SELECT status, electorate, options, ranked FROM proposals WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "No such proposal."))?;
    if p.get::<&str, _>("status") != "voting" {
        return Err(conflict(
            "not_voting",
            "This isn't open for voting right now.",
        ));
    }
    let electorate = Electorate::parse(p.get::<&str, _>("electorate"));
    if me.days < electorate.min_days() {
        return Err(forbidden(
            "not_yet",
            &format!(
                "This vote is open to neighbours with {} active days. You have {}.",
                electorate.min_days(),
                me.days
            ),
        ));
    }
    let n = serde_json::from_value::<Vec<String>>(p.get("options"))
        .unwrap_or_default()
        .len();
    let ranked: bool = p.get("ranked");
    let mut seen = vec![false; n];
    let valid = !req.ranking.is_empty()
        && (ranked || req.ranking.len() == 1)
        && req
            .ranking
            .iter()
            .all(|&o| o < n && !std::mem::replace(&mut seen[o], true));
    if !valid {
        return Err(ApiError::bad_request("ballot", "That ballot isn't valid."));
    }
    let r = sqlx::query("INSERT INTO proposal_voters (proposal_id, voter_id) VALUES ($1, $2)")
        .bind(id)
        .bind(me.id)
        .execute(&mut *tx)
        .await;
    match r {
        Err(e) if crate::store::is_unique_violation(&e) => {
            return Err(conflict("voted", "You've already voted on this."));
        }
        Err(e) => return Err(db_err(e)),
        Ok(_) => {}
    }
    let ph = phase(&mut tx).await.map_err(db_err)?;
    let ranking: Vec<i16> = req.ranking.iter().map(|&o| o as i16).collect();
    sqlx::query("INSERT INTO proposal_ballots (proposal_id, ranking, weight) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(&ranking)
        .bind(voice_weight(ph, me.days))
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    touch(&state.db, me.id).await;
    Ok(Json(json!({ "ok": true })))
}

// ---- HTTP: Caretaker --------------------------------------------------------------------------

/// Ends the current stage now (founding votes on the Caretaker's schedule).
async fn advance_now(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let me = require_caretaker(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let (status, _) = status_of(&mut tx, id).await?;
    if !["collecting", "discussion", "voting"].contains(&status.as_str()) {
        return Err(conflict("closed", "This proposal is already closed."));
    }
    advance(&mut tx, id, BRIDGE_GOAL).await.map_err(db_err)?;
    ledger(
        &mut tx,
        "caretaker",
        &format!("The Caretaker moved proposal #{id} to its next stage early."),
        json!({ "proposal": id, "by": me.name }),
    )
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Decision {
    title: String,
    body: String,
    /// When the decision ends ("until the first council", a date…).
    until: String,
}

/// A Caretaker decision, posted publicly as temporary with an end condition
/// (spec §10.1).
async fn decision(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<Decision>,
) -> ApiResult<Json<Value>> {
    require_caretaker(&state, &headers).await?;
    let title = filter::clean_chat(&req.title)
        .ok_or_else(|| ApiError::bad_request("title", "Give it a title."))?;
    let until = filter::clean_chat(&req.until)
        .ok_or_else(|| ApiError::bad_request("until", "Say when it ends."))?;
    let body = crate::town::clean_post(&req.body).unwrap_or_default();
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    ledger(
        &mut conn,
        "caretaker_decision",
        &format!("Caretaker decision (temporary, until {until}): {title}"),
        json!({ "title": title, "body": body, "until": until }),
    )
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct NewReport {
    target_id: Option<String>,
    target_name: String,
    reason: String,
    #[serde(default)]
    context: String,
}

const REASONS: &[&str] = &["harassment", "hate", "sexual", "spam", "cheating", "other"];

async fn report(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<NewReport>,
) -> ApiResult<Json<Value>> {
    let me = me(&state, &headers).await?;
    if !REASONS.contains(&req.reason.as_str()) {
        return Err(ApiError::bad_request("reason", "Pick a reason."));
    }
    let target = req
        .target_id
        .as_deref()
        .and_then(|t| Uuid::parse_str(t).ok());
    let mut conn = state.db.acquire().await.map_err(db_err)?;
    let today: i64 = sqlx::query_scalar("SELECT count(*) FROM reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'")
        .bind(me.id)
        .fetch_one(&mut *conn)
        .await
        .map_err(db_err)?;
    if today >= 10 {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "slow_down",
            "That's a lot of reports today. The Caretaker will look at them.",
        ));
    }
    sqlx::query("INSERT INTO reports (reporter_id, target_id, target_name, reason, context) VALUES ($1, $2, $3, $4, $5)")
        .bind(me.id)
        .bind(target)
        .bind(req.target_name.chars().take(40).collect::<String>())
        .bind(&req.reason)
        .bind(req.context.chars().take(500).collect::<String>())
        .execute(&mut *conn)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn reports(State(state): S, headers: HeaderMap) -> ApiResult<Json<Vec<Value>>> {
    require_caretaker(&state, &headers).await?;
    let rows = sqlx::query(
        "SELECT r.id, r.target_id, r.target_name, r.reason, r.context, extract(epoch FROM r.created_at)::bigint AS at,
                p.display_name AS reporter,
                (SELECT count(*) FROM reports o WHERE o.target_id = r.target_id AND o.target_id IS NOT NULL) AS against
         FROM reports r JOIN players p ON p.id = r.reporter_id
         WHERE r.status = 'open' ORDER BY r.created_at LIMIT 100",
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(
        rows.iter()
            .map(|r| json!({
                "id": r.get::<i64, _>("id"), "target_id": r.get::<Option<Uuid>, _>("target_id").map(|u| u.to_string()),
                "target_name": r.get::<String, _>("target_name"), "reason": r.get::<String, _>("reason"),
                "context": r.get::<String, _>("context"), "at": r.get::<i64, _>("at"),
                "reporter": r.get::<String, _>("reporter"), "reports_against": r.get::<i64, _>("against"),
            }))
            .collect(),
    ))
}

#[derive(Deserialize)]
struct Resolve {
    action: String,
    #[serde(default)]
    note: String,
}

async fn resolve(
    State(state): S,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<Resolve>,
) -> ApiResult<Json<Value>> {
    require_caretaker(&state, &headers).await?;
    let mute_hours = match req.action.as_str() {
        "dismiss" | "warn" => 0,
        "mute_1h" => 1,
        "mute_24h" => 24,
        _ => return Err(ApiError::bad_request("action", "Unknown action.")),
    };
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let target: Option<Uuid> = sqlx::query_scalar(
        "UPDATE reports SET status = 'resolved', action = $2, note = $3, resolved_at = now()
         WHERE id = $1 AND status = 'open' RETURNING target_id",
    )
    .bind(id)
    .bind(&req.action)
    .bind(&req.note)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_err)?
    .ok_or_else(|| conflict("resolved", "Already resolved."))?;
    if let Some(t) = target.filter(|_| req.action != "dismiss") {
        sqlx::query(&format!(
            "INSERT INTO sanctions (player_id, kind, until, report_id)
             VALUES ($1, $2, CASE WHEN $3 > 0 THEN now() + interval '{mute_hours} hours' END, $4)"
        ))
        .bind(t)
        .bind(if mute_hours > 0 { "mute" } else { "warning" })
        .bind(mute_hours)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    }
    // The ledger records that moderation happened, never who was involved.
    let what = match req.action.as_str() {
        "dismiss" => "no action needed",
        "warn" => "a warning",
        "mute_1h" => "a 1-hour mute",
        _ => "a 24-hour mute",
    };
    ledger(
        &mut tx,
        "moderation",
        &format!("A report was reviewed by the Caretaker: {what}."),
        json!({ "action": req.action }),
    )
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({ "ok": true })))
}

/// Runs [`tick`] every 30 seconds for the life of the process.
pub fn spawn_ticker(db: PgPool) {
    tokio::spawn(async move {
        let mut every = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            every.tick().await;
            if let Err(e) = tick(&db, BRIDGE_GOAL).await {
                tracing::warn!(error = %e, "governance tick failed");
            }
        }
    });
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn ranked_choice_moves_votes_to_the_next_preference() {
        // A: 4 first preferences, B: 3, C: 2 (C's voters prefer B next).
        let mut ballots = vec![];
        ballots.extend(std::iter::repeat_n((vec![0], 1.0), 4));
        ballots.extend(std::iter::repeat_n((vec![1, 0], 1.0), 3));
        ballots.extend(std::iter::repeat_n((vec![2, 1], 1.0), 2));
        let (winner, rounds) = instant_runoff(3, &ballots);
        assert_eq!(winner, Some(1), "B wins once C is eliminated");
        assert_eq!(rounds.len(), 2);
        assert_eq!(rounds[1][2], None, "C was eliminated in round one");
        // A clear first-round majority wins at once.
        let (w, r) = instant_runoff(2, &[(vec![0], 3.0), (vec![1], 1.0)]);
        assert_eq!((w, r.len()), (Some(0), 1));
        assert_eq!(instant_runoff(3, &[]).0, None);
    }

    #[test]
    fn thresholds_weights_and_tiers() {
        assert!(meets(0.51, 0.5) && !meets(0.5, 0.5));
        assert!(meets(0.6, 0.6) && !meets(0.59, 0.6));
        assert_eq!(voice_weight(1, 365), 1.0);
        assert_eq!(voice_weight(2, 0), 1.0);
        assert!((voice_weight(2, 30) - 2.0).abs() < 1e-6);
        assert_eq!(voice_weight(2, 10_000), 4.0);
        assert_eq!(tier_for(0, false), TrustTier::Visitor);
        assert_eq!(tier_for(1, false), TrustTier::Newcomer);
        assert_eq!(tier_for(7, false), TrustTier::Resident);
        assert_eq!(tier_for(60, false), TrustTier::Steward);
        assert_eq!(
            tier_for(60, true),
            TrustTier::Resident,
            "a recent sanction holds back Steward"
        );
    }
}
