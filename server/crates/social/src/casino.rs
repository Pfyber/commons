//! The Casino (ADR 0017): the slot machines, the rules and limits, and
//! taking a break; the shared tables (roulette, blackjack) are in `tables`.
//! Coins only, never real money. Every outcome is drawn here (the OS's random
//! numbers through `commons_sim::casino`) and every round recorded.
//!
//! Care: 16 and over unless `COMMONS_CASINO_MINORS` is on; only from inside
//! the casino (the zones' presence reports); bets within each game's limits;
//! a daily loss limit; and "take a break", which closes the casino to you
//! for a day or a week.

use crate::State as SocialState;
use crate::routes::{db_err, me};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_api::economy::{COIN, EconError, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_common::config;
use commons_sim::casino;
use rand::Rng;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// The zone the casino is.
pub const ZONE: &str = "casino";
/// The most anyone can lose in a (UTC) day.
pub const DAILY_LOSS: i64 = 300;

/// Whether under-16s may play (off: they're turned away at the door).
pub fn minors_allowed() -> bool {
    config::env_or("COMMONS_CASINO_MINORS", false)
}

fn refuse(code: &'static str, msg: &str) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, code, msg)
}

fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/casino", get(status))
        .route("/casino/slots", post(slots))
        .route("/casino/break", post(take_break))
}

/// Today so far (UTC): how much was bet and won.
pub(crate) async fn today(state: &SocialState, me: Uuid) -> ApiResult<(i64, i64)> {
    sqlx::query_as(
        "SELECT coalesce(sum(bet), 0)::bigint, coalesce(sum(payout), 0)::bigint FROM casino_rounds
         WHERE player_id = $1 AND at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
    )
    .bind(me)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)
}

/// Why `me` can't play right now, if they can't.
pub(crate) async fn why_not(
    state: &SocialState,
    me: Uuid,
) -> ApiResult<Option<(&'static str, String)>> {
    let minor: bool = sqlx::query_scalar(
        "SELECT (extract(year FROM now())::int - a.birth_year - 1) < 16
         FROM players p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1",
    )
    .bind(me)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .unwrap_or(true);
    if minor && !minors_allowed() {
        return Ok(Some(("age", "The casino is for 16 and over.".into())));
    }
    let until: Option<i64> = sqlx::query_scalar(
        "SELECT extract(epoch FROM until)::bigint FROM casino_breaks WHERE player_id = $1 AND until > now()",
    )
    .bind(me)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    if until.is_some() {
        return Ok(Some((
            "on_a_break",
            "You're taking a break from the casino. It opens to you again when the break is over."
                .into(),
        )));
    }
    let here = state.hub.location(me).is_some_and(|l| l.zone == ZONE);
    if !here {
        return Ok(Some(("not_here", "Games are played in the casino.".into())));
    }
    Ok(None)
}

/// The rules, the limits, today's play and whether you can play.
async fn status(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let (bet, won) = today(&state, me).await?;
    let why = why_not(&state, me).await?;
    let break_until: Option<i64> = sqlx::query_scalar(
        "SELECT extract(epoch FROM until)::bigint FROM casino_breaks WHERE player_id = $1 AND until > now()",
    )
    .bind(me)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({
        "can_play": why.is_none(),
        "why": why.map(|w| w.1),
        "today": { "bet": bet, "won": won, "net": won - bet, "loss_left": (DAILY_LOSS - (bet - won)).max(0) },
        "limits": {
            "slots": casino::SLOT_BET, "roulette": casino::ROULETTE_BET,
            "roulette_round": crate::tables::ROUND_MAX,
            "blackjack": commons_sim::blackjack::BET, "daily_loss": DAILY_LOSS,
        },
        "slots": { "symbols": casino::SYMBOLS, "three": casino::THREE, "two_cherries": 2 },
        "break_until": break_until,
    })))
}

/// Plays one round: checks, the coins, the record. `pays` is the payout
/// (stake included) as a multiple of the bet; `outcome` what happened.
async fn play(
    state: &SocialState,
    me: Uuid,
    game: &str,
    bet: i32,
    limits: (i32, i32),
    key: &str,
    draw: impl FnOnce() -> (i32, Value),
) -> ApiResult<Value> {
    if let Some((code, why)) = why_not(state, me).await? {
        return Err(refuse(code, &why));
    }
    if !(limits.0..=limits.1).contains(&bet) || key.is_empty() || key.len() > 80 {
        return Err(ApiError::bad_request(
            "bad_bet",
            format!("Bets here are {} to {} coins.", limits.0, limits.1),
        ));
    }
    let key = format!("casino:{me}:{key}");
    // Pressed twice: the round that was played.
    if let Some((payout, outcome)) = sqlx::query_as::<_, (i32, Value)>(
        "SELECT payout, outcome FROM casino_rounds WHERE key = $1 AND player_id = $2",
    )
    .bind(&key)
    .bind(me)
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    {
        return Ok(json!({ "outcome": outcome, "payout": payout, "bet": bet, "duplicate": true }));
    }
    let (bet_today, won_today) = today(state, me).await?;
    if (bet_today - won_today) + bet as i64 > DAILY_LOSS {
        return Err(conflict(
            "daily_limit",
            format!(
                "That's today's limit: the casino lets you lose {DAILY_LOSS} coins a day at most. See you tomorrow!"
            ),
        ));
    }
    let (multiple, outcome) = draw();
    let payout = bet * multiple;
    let mut tx = state.db.begin().await.map_err(db_err)?;
    let applied = apply(
        &mut tx,
        &state.catalog,
        me,
        &[Op {
            item: COIN,
            delta: payout - bet,
        }],
        &format!("casino_{game}"),
        &key,
    )
    .await
    .map_err(|e| match e {
        EconError::Insufficient(_) => {
            conflict("not_enough_coins", "You haven't got that many coins.")
        }
        e => e.into(),
    })?;
    sqlx::query(
        "INSERT INTO casino_rounds (player_id, game, bet, payout, outcome, key) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(me)
    .bind(game)
    .bind(bet)
    .bind(payout)
    .bind(&outcome)
    .bind(&key)
    .execute(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(json!({ "outcome": outcome, "payout": payout, "bet": bet, "totals": applied.totals }))
}

#[derive(Deserialize)]
struct SlotsReq {
    bet: i32,
    key: String,
}

/// One spin of a slot machine.
async fn slots(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SlotsReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let r = play(
        &state,
        me,
        "slots",
        req.bet,
        casino::SLOT_BET,
        &req.key,
        || {
            let mut rng = rand::rng();
            let (line, pays) = casino::spin([rng.random(), rng.random(), rng.random()]);
            (
                pays,
                json!({ "reels": line.map(|s| casino::SYMBOLS[s]), "pays": pays }),
            )
        },
    )
    .await?;
    // A big win: the whole floor hears.
    let pays = r["outcome"]["pays"].as_i64().unwrap_or(0);
    if pays >= 20
        && r["duplicate"] != true
        && let Some(l) = state.hub.location(me).filter(|l| l.zone == ZONE)
    {
        let reels: Vec<&str> = r["outcome"]["reels"]
            .as_array()
            .map(|a| a.iter().filter_map(|s| s.as_str()).collect())
            .unwrap_or_default();
        crate::tables::cheer(
            &state,
            l.instance,
            format!(
                "🎰 {} hit {} for {} coins!",
                claims.name,
                reels.join(" "),
                r["payout"]
            ),
        );
    }
    Ok(Json(r))
}

#[derive(Deserialize)]
struct BreakReq {
    days: i32,
}

/// Closes the casino to yourself for a day or a week (it can't be undone early).
async fn take_break(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<BreakReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    if req.days != 1 && req.days != 7 {
        return Err(ApiError::bad_request("bad_break", "A day or a week."));
    }
    let until: i64 = sqlx::query_scalar(
        "INSERT INTO casino_breaks (player_id, until) VALUES ($1, now() + make_interval(days => $2))
         ON CONFLICT (player_id) DO UPDATE SET until = GREATEST(casino_breaks.until, EXCLUDED.until)
         RETURNING extract(epoch FROM until)::bigint",
    )
    .bind(me)
    .bind(req.days)
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "until": until })))
}
