//! The Casino's tables, K2 (ADR 0017): roulette and blackjack played
//! together, like a real casino floor. Every casino instance has one roulette
//! wheel and two blackjack tables; everyone in that instance sees them live
//! (`{t: "casino_tables"}` pushes) and anyone can sit down.
//!
//! - **Roulette:** a shared round. The first chip opens betting for
//!   `BETTING_MS`; anyone can add bets; when everyone who's bet says "spin"
//!   (alone: at once) or time's up, the wheel spins for everyone, lands, and
//!   pays each bet.
//! - **Blackjack:** five seats a table against the dealer. Seated players
//!   bet; the hand is dealt when all of them have (or `DEAL_MS` after the
//!   first); each plays in turn (hit, stand, double; `TURN_MS` each, then
//!   it stands for you); the dealer plays out and every hand is paid.
//!
//! Coins leave when a bet is placed (a `casino_rounds` row, unsettled) and
//! come back when it's settled, so the daily loss limit counts bets on the
//! table. If the gateway restarts mid-round, unsettled bets are refunded.

use crate::State as SocialState;
use crate::casino::{DAILY_LOSS, ZONE, today, why_not};
use crate::routes::{db_err, me};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use commons_api::economy::{COIN, EconError, Op, apply};
use commons_api::error::{ApiError, ApiResult};
use commons_sim::blackjack::{self as bj, Card};
use commons_sim::casino::{self, Bet};
use rand::Rng;
use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

type S = State<Arc<SocialState>>;

/// Roulette: how long betting stays open after the first chip, and the spin.
pub const BETTING_MS: u64 = 20_000;
pub const SPIN_MS: u64 = 5_000;
/// The most one player can have on a roulette round.
pub const ROUND_MAX: i32 = 100;
/// Blackjack: the deal after the first bet, each turn, and the pause after.
pub const DEAL_MS: u64 = 15_000;
pub const TURN_MS: u64 = 20_000;
pub const DONE_MS: u64 = 7_000;
/// Blackjack tables in each casino.
pub const BJ_TABLES: usize = 2;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- the state -------------------------------------------------------------------------

struct Chip {
    player: Uuid,
    name: String,
    bet: Bet,
    amount: i32,
    round: i64,
}

#[derive(Default)]
enum Spin {
    #[default]
    Open,
    Betting {
        closes: u64,
    },
    Spinning {
        number: u8,
        lands: u64,
    },
}

#[derive(Default)]
struct Wheel {
    spin: Spin,
    chips: Vec<Chip>,
    ready: HashSet<Uuid>,
    /// The last number, and who won what on it.
    last: Option<(u8, Vec<(String, i32)>)>,
    /// The numbers that came up, newest first (the board by the table).
    history: std::collections::VecDeque<u8>,
}

/// How many past numbers the table's board shows.
pub const HISTORY: usize = 12;

struct Seat {
    player: Uuid,
    name: String,
    /// What's bet on this hand (doubled included); 0: sitting out.
    bet: i32,
    round: Option<i64>,
    cards: Vec<Card>,
    doubled: bool,
    done: bool,
    /// How the hand came out, and what it paid.
    result: Option<(bj::Outcome, i32)>,
    /// Gone from the casino: up from the seat when the hand's over.
    leaving: bool,
}

#[derive(Default, PartialEq)]
enum Phase {
    #[default]
    Betting,
    Playing,
    Done,
}

#[derive(Default)]
struct Table {
    seats: [Option<Seat>; bj::SEATS],
    phase: Phase,
    dealer: Vec<Card>,
    shoe: Vec<Card>,
    /// Betting: when the hand is dealt. Playing: whose turn, until when. Done: until when.
    deal_at: Option<u64>,
    turn: Option<usize>,
    until: u64,
}

#[derive(Default)]
struct Floor {
    wheel: Wheel,
    tables: [Table; BJ_TABLES],
    /// Bumped on every change, so a client can tell a late reply from news.
    seq: u64,
}

impl Floor {
    /// A fresh floor. Its `seq` starts at the clock, so it keeps rising
    /// across restarts and clients never take news for a stale reply.
    fn new() -> Floor {
        Floor {
            seq: now_ms(),
            ..Floor::default()
        }
    }
}

/// Every casino instance's floor. One lock: the casino is small, and the
/// coins move while it's held, so a bet and a deal never cross.
#[derive(Default)]
pub struct Tables(tokio::sync::Mutex<HashMap<u16, Floor>>);

// ---- the coins ------------------------------------------------------------------------

fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, msg)
}

fn coins_err(e: EconError) -> ApiError {
    match e {
        EconError::Insufficient(_) => {
            conflict("not_enough_coins", "You haven't got that many coins.")
        }
        e => e.into(),
    }
}

/// Takes a bet: within today's loss limit, the coins off, an unsettled round.
async fn charge(
    state: &SocialState,
    me: Uuid,
    game: &str,
    amount: i32,
    key: &str,
    outcome: Value,
) -> ApiResult<i64> {
    let (bet_today, won_today) = today(state, me).await?;
    if (bet_today - won_today) + amount as i64 > DAILY_LOSS {
        return Err(conflict(
            "daily_limit",
            format!(
                "That's today's limit: the casino lets you lose {DAILY_LOSS} coins a day at most. See you tomorrow!"
            ),
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    apply(
        &mut tx,
        &state.catalog,
        me,
        &[Op {
            item: COIN,
            delta: -amount,
        }],
        &format!("casino_{game}"),
        key,
    )
    .await
    .map_err(coins_err)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO casino_rounds (player_id, game, bet, payout, outcome, key, settled)
         VALUES ($1, $2, $3, 0, $4, $5, false) RETURNING id",
    )
    .bind(me)
    .bind(game)
    .bind(amount)
    .bind(&outcome)
    .bind(key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(id)
}

/// Raises a round's bet (doubling down): the extra off, within the limit.
async fn raise(state: &SocialState, me: Uuid, round: i64, extra: i32) -> ApiResult<()> {
    let (bet_today, won_today) = today(state, me).await?;
    if (bet_today - won_today) + extra as i64 > DAILY_LOSS {
        return Err(conflict(
            "daily_limit",
            "Doubling would pass today's loss limit.",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_err)?;
    apply(
        &mut tx,
        &state.catalog,
        me,
        &[Op {
            item: COIN,
            delta: -extra,
        }],
        "casino_blackjack",
        &format!("casino:round:{round}:double"),
    )
    .await
    .map_err(coins_err)?;
    sqlx::query("UPDATE casino_rounds SET bet = bet + $2 WHERE id = $1")
        .bind(round)
        .bind(extra)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(())
}

/// Settles a round: what it paid back (if anything), and what happened.
async fn pay(state: &SocialState, player: Uuid, round: i64, payout: i32, outcome: Value) {
    let res: Result<(), ApiError> = async {
        let mut tx = state.db.begin().await.map_err(db_err)?;
        if payout > 0 {
            apply(
                &mut tx,
                &state.catalog,
                player,
                &[Op {
                    item: COIN,
                    delta: payout,
                }],
                "casino_payout",
                &format!("casino:round:{round}:pay"),
            )
            .await
            .map_err(coins_err)?;
        }
        sqlx::query(
            "UPDATE casino_rounds SET payout = $2, outcome = $3, settled = true WHERE id = $1 AND NOT settled",
        )
        .bind(round)
        .bind(payout)
        .bind(&outcome)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
        Ok(())
    }
    .await;
    if let Err(e) = res {
        tracing::error!(%player, round, ?e, "casino payout failed");
    }
}

/// Gives back every bet left unsettled (the gateway stopped mid-round);
/// `only` one player's, in tests.
pub async fn refund_unsettled(state: &SocialState, only: Option<Uuid>) {
    let rows: Vec<(i64, Uuid, i32)> = sqlx::query_as(
        "SELECT id, player_id, bet FROM casino_rounds WHERE NOT settled AND ($1::uuid IS NULL OR player_id = $1)",
    )
    .bind(only)
    .fetch_all(&state.db)
            .await
            .unwrap_or_default();
    for (id, player, bet) in rows {
        pay(state, player, id, bet, json!({ "refunded": true })).await;
    }
}

/// A key the client sent, made ours.
fn our_key(me: Uuid, key: &str) -> ApiResult<String> {
    if key.is_empty() || key.len() > 80 {
        return Err(ApiError::bad_request("bad_key", "A key, please."));
    }
    Ok(format!("casino:{me}:{key}"))
}

async fn key_used(state: &SocialState, key: &str) -> ApiResult<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM casino_rounds WHERE key = $1)")
        .bind(key)
        .fetch_one(&state.db)
        .await
        .map_err(db_err)
}

/// The casino instance `me` is in, if they may play there.
async fn floor_of(state: &SocialState, me: Uuid) -> ApiResult<u16> {
    if let Some((code, why)) = why_not(state, me).await? {
        return Err(ApiError::new(StatusCode::FORBIDDEN, code, why));
    }
    state
        .hub
        .location(me)
        .filter(|l| l.zone == ZONE)
        .map(|l| l.instance)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::FORBIDDEN,
                "not_here",
                "Games are played in the casino.",
            )
        })
}

fn here(state: &SocialState, p: Uuid, instance: u16) -> bool {
    state
        .hub
        .location(p)
        .is_some_and(|l| l.zone == ZONE && l.instance == instance)
}

// ---- what everyone sees -----------------------------------------------------------------

fn card_json(c: Card) -> Value {
    json!({ "face": bj::face(c), "suit": bj::suit(c) })
}

fn hand_json(cards: &[Card]) -> Value {
    json!({ "cards": cards.iter().map(|&c| card_json(c)).collect::<Vec<_>>(), "total": bj::total(cards).0, "soft": bj::total(cards).1 })
}

fn wheel_json(w: &Wheel) -> Value {
    let (phase, closes, number, lands) = match w.spin {
        Spin::Open => ("open", None, None, None),
        Spin::Betting { closes } => ("betting", Some(closes), None, None),
        Spin::Spinning { number, lands } => ("spinning", None, Some(number), Some(lands)),
    };
    json!({
        "phase": phase, "closes": closes, "number": number, "lands": lands,
        "chips": w.chips.iter().map(|c| json!({
            "player": c.player.to_string(), "name": c.name, "bet": c.bet, "amount": c.amount,
        })).collect::<Vec<_>>(),
        "ready": w.ready.iter().map(|p| p.to_string()).collect::<Vec<_>>(),
        "history": w.history,
        "last": w.last.as_ref().map(|(n, won)| json!({
            "number": n, "red": casino::is_red(*n),
            "winners": won.iter().map(|(name, coins)| json!({ "name": name, "coins": coins })).collect::<Vec<_>>(),
        })),
    })
}

fn table_json(t: &Table) -> Value {
    // The dealer's hole card stays face down until the players are done.
    let dealer = match t.phase {
        Phase::Playing => {
            let up: Vec<Value> = t
                .dealer
                .first()
                .map(|&c| card_json(c))
                .into_iter()
                .collect();
            json!({ "cards": up, "hidden": t.dealer.len().saturating_sub(1), "total": t.dealer.first().map(|&c| bj::total(&[c]).0) })
        }
        _ if t.dealer.is_empty() => Value::Null,
        _ => hand_json(&t.dealer),
    };
    json!({
        "phase": match t.phase { Phase::Betting => "betting", Phase::Playing => "playing", Phase::Done => "done" },
        "deal_at": t.deal_at, "turn": t.turn, "until": t.until,
        "dealer": dealer,
        "seats": t.seats.iter().map(|s| s.as_ref().map(|s| json!({
            "player": s.player.to_string(), "name": s.name, "bet": s.bet,
            "hand": (!s.cards.is_empty()).then(|| hand_json(&s.cards)),
            "doubled": s.doubled, "done": s.done,
            "result": s.result.map(|(o, paid)| json!({ "outcome": o.name(), "paid": paid })),
        }))).collect::<Vec<_>>(),
    })
}

fn floor_json(instance: u16, f: &Floor) -> Value {
    json!({
        "t": "casino_tables", "instance": instance,
        "roulette": wheel_json(&f.wheel),
        "blackjack": f.tables.iter().map(table_json).collect::<Vec<_>>(),
        "seq": f.seq,
        "now": now_ms(),
    })
}

fn announce(state: &SocialState, instance: u16, f: &mut Floor) {
    f.seq += 1;
    let msg = floor_json(instance, f);
    for p in state.hub.in_zone(ZONE, instance) {
        state.hub.send(p, &msg);
    }
}

/// A big win, told to the whole casino floor.
pub fn cheer(state: &SocialState, instance: u16, text: String) {
    let msg = json!({ "t": "casino_win", "instance": instance, "text": text });
    for p in state.hub.in_zone(ZONE, instance) {
        state.hub.send(p, &msg);
    }
}

// ---- the routes ------------------------------------------------------------------------

pub fn routes() -> Router<Arc<SocialState>> {
    Router::new()
        .route("/casino/tables", get(view))
        .route("/casino/roulette/bet", post(roulette_bet))
        .route("/casino/roulette/spin", post(roulette_ready))
        .route("/casino/blackjack/sit", post(sit))
        .route("/casino/blackjack/stand_up", post(stand_up))
        .route("/casino/blackjack/bet", post(bj_bet))
        .route("/casino/blackjack/act", post(act))
}

/// The tables in the casino you're in, as they stand.
async fn view(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let Some(instance) = state
        .hub
        .location(me)
        .filter(|l| l.zone == ZONE)
        .map(|l| l.instance)
    else {
        return Ok(Json(json!({ "t": "casino_tables", "instance": null })));
    };
    let mut floors = state.tables.0.lock().await;
    let f = floors.entry(instance).or_insert_with(Floor::new);
    Ok(Json(floor_json(instance, f)))
}

#[derive(Deserialize)]
struct RouletteBetReq {
    bet: Bet,
    amount: i32,
    key: String,
}

/// A chip on the roulette table: opens betting if it was quiet.
async fn roulette_bet(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<RouletteBetReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let instance = floor_of(&state, me).await?;
    let (lo, hi) = casino::ROULETTE_BET;
    if !req.bet.valid() || !(lo..=hi).contains(&req.amount) {
        return Err(ApiError::bad_request(
            "bad_bet",
            format!("Bets here are {lo} to {hi} coins, on the table's numbers."),
        ));
    }
    let key = our_key(me, &req.key)?;
    let mut floors = state.tables.0.lock().await;
    let f = floors.entry(instance).or_insert_with(Floor::new);
    if key_used(&state, &key).await? {
        return Ok(Json(floor_json(instance, f)));
    }
    let w = &mut f.wheel;
    if matches!(w.spin, Spin::Spinning { .. }) {
        return Err(conflict(
            "no_more_bets",
            "No more bets: the wheel's spinning.",
        ));
    }
    let mine: i32 = w
        .chips
        .iter()
        .filter(|c| c.player == me)
        .map(|c| c.amount)
        .sum();
    if mine + req.amount > ROUND_MAX {
        return Err(conflict(
            "round_max",
            format!("Up to {ROUND_MAX} coins a spin on this table."),
        ));
    }
    let round = charge(
        &state,
        me,
        "roulette",
        req.amount,
        &key,
        json!({ "bet": req.bet }),
    )
    .await?;
    w.chips.push(Chip {
        player: me,
        name: claims.name.clone(),
        bet: req.bet,
        amount: req.amount,
        round,
    });
    w.ready.remove(&me);
    if matches!(w.spin, Spin::Open) {
        w.spin = Spin::Betting {
            closes: now_ms() + BETTING_MS,
        };
    }
    announce(&state, instance, f);
    Ok(Json(floor_json(instance, f)))
}

/// "Spin!": when everyone with chips down has said so, the wheel goes.
async fn roulette_ready(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let instance = floor_of(&state, me).await?;
    let mut floors = state.tables.0.lock().await;
    let f = floors.entry(instance).or_insert_with(Floor::new);
    let w = &mut f.wheel;
    if !w.chips.iter().any(|c| c.player == me) {
        return Err(conflict("no_chips", "Put a chip down first."));
    }
    w.ready.insert(me);
    if matches!(w.spin, Spin::Betting { .. }) && w.chips.iter().all(|c| w.ready.contains(&c.player))
    {
        start_spin(w, now_ms());
    }
    announce(&state, instance, f);
    Ok(Json(floor_json(instance, f)))
}

fn start_spin(w: &mut Wheel, now: u64) {
    w.spin = Spin::Spinning {
        number: casino::wheel(rand::rng().random()),
        lands: now + SPIN_MS,
    };
}

/// Lands the ball: pays every chip, and tells who won.
async fn land(state: &SocialState, instance: u16, w: &mut Wheel, number: u8) {
    let mut won: HashMap<Uuid, (String, i32)> = HashMap::new();
    for c in std::mem::take(&mut w.chips) {
        let payout = c.amount * c.bet.pays(number);
        pay(
            state,
            c.player,
            c.round,
            payout,
            json!({ "number": number, "red": casino::is_red(number), "bet": c.bet, "pays": c.bet.pays(number) }),
        )
        .await;
        if payout > 0 {
            won.entry(c.player).or_insert((c.name.clone(), 0)).1 += payout;
        }
        if matches!(c.bet, Bet::Number { .. }) && payout > 0 {
            cheer(
                state,
                instance,
                format!("🎡 {} hit {number} straight up for {payout} coins!", c.name),
            );
        }
    }
    let mut winners: Vec<(String, i32)> = won.into_values().collect();
    winners.sort_by_key(|w| std::cmp::Reverse(w.1));
    w.last = Some((number, winners));
    w.history.push_front(number);
    w.history.truncate(HISTORY);
    w.ready.clear();
    w.spin = Spin::Open;
}

#[derive(Deserialize)]
struct SitReq {
    table: usize,
    seat: usize,
}

/// Takes a free seat at a blackjack table (one seat in the casino at a time).
async fn sit(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<SitReq>,
) -> ApiResult<Json<Value>> {
    let (me, claims) = me(&state, &headers)?;
    let instance = floor_of(&state, me).await?;
    if req.table >= BJ_TABLES || req.seat >= bj::SEATS {
        return Err(ApiError::bad_request("bad_seat", "There's no such seat."));
    }
    let mut floors = state.tables.0.lock().await;
    let f = floors.entry(instance).or_insert_with(Floor::new);
    for (i, t) in f.tables.iter_mut().enumerate() {
        for (j, s) in t.seats.iter_mut().enumerate() {
            if let Some(seat) = s
                && seat.player == me
            {
                if (i, j) == (req.table, req.seat) {
                    seat.leaving = false;
                    return Ok(Json(floor_json(instance, f)));
                }
                return Err(conflict(
                    "seated",
                    "You're sitting at another seat: stand up there first.",
                ));
            }
        }
    }
    let t = &mut f.tables[req.table];
    if t.seats[req.seat].is_some() {
        return Err(conflict("taken", "Someone's sitting there."));
    }
    t.seats[req.seat] = Some(Seat {
        player: me,
        name: claims.name.clone(),
        bet: 0,
        round: None,
        cards: vec![],
        doubled: false,
        done: false,
        result: None,
        leaving: false,
    });
    announce(&state, instance, f);
    Ok(Json(floor_json(instance, f)))
}

/// Gets up from your seat: now, or (mid-hand) when the hand's over.
async fn stand_up(State(state): S, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let Some(instance) = state
        .hub
        .location(me)
        .filter(|l| l.zone == ZONE)
        .map(|l| l.instance)
    else {
        return Ok(Json(json!({})));
    };
    let mut floors = state.tables.0.lock().await;
    let f = floors.entry(instance).or_insert_with(Floor::new);
    for t in f.tables.iter_mut() {
        leave_seat(&state, t, me).await;
        advance(&state, instance, t, now_ms()).await;
    }
    announce(&state, instance, f);
    Ok(Json(floor_json(instance, f)))
}

/// `p` leaves their seat at `t`: a bet not yet dealt comes back; a hand in
/// play stands, and they get up once it's paid.
async fn leave_seat(state: &SocialState, t: &mut Table, p: Uuid) {
    let Some(i) = t
        .seats
        .iter()
        .position(|s| s.as_ref().is_some_and(|s| s.player == p))
    else {
        return;
    };
    let seat = t.seats[i].as_mut().unwrap();
    match t.phase {
        Phase::Playing if seat.bet > 0 => {
            seat.leaving = true;
            seat.done = true;
        }
        _ => {
            if let (Phase::Betting, Some(round)) = (&t.phase, seat.round) {
                pay(state, p, round, seat.bet, json!({ "refunded": true })).await;
            }
            t.seats[i] = None;
            if t.phase == Phase::Betting && !t.seats.iter().flatten().any(|s| s.bet > 0) {
                t.deal_at = None;
            }
        }
    }
}

#[derive(Deserialize)]
struct BjBetReq {
    amount: i32,
    key: String,
}

/// A bet on the next hand at your seat. When everyone seated has bet, it's dealt.
async fn bj_bet(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<BjBetReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let instance = floor_of(&state, me).await?;
    let (lo, hi) = bj::BET;
    if !(lo..=hi).contains(&req.amount) {
        return Err(ApiError::bad_request(
            "bad_bet",
            format!("Bets here are {lo} to {hi} coins."),
        ));
    }
    let key = our_key(me, &req.key)?;
    let mut floors = state.tables.0.lock().await;
    let f = floors.entry(instance).or_insert_with(Floor::new);
    if key_used(&state, &key).await? {
        return Ok(Json(floor_json(instance, f)));
    }
    let Some(t) = f
        .tables
        .iter_mut()
        .find(|t| t.seats.iter().flatten().any(|s| s.player == me))
    else {
        return Err(conflict("not_seated", "Take a seat at a table first."));
    };
    if t.phase != Phase::Betting {
        return Err(conflict("in_play", "Wait for the next hand."));
    }
    let seat = t
        .seats
        .iter_mut()
        .flatten()
        .find(|s| s.player == me)
        .unwrap();
    if seat.bet > 0 {
        return Err(conflict("already_bet", "Your bet's down for this hand."));
    }
    let round = charge(&state, me, "blackjack", req.amount, &key, json!({})).await?;
    seat.bet = req.amount;
    seat.round = Some(round);
    let now = now_ms();
    if t.deal_at.is_none() {
        t.deal_at = Some(now + DEAL_MS);
    }
    if t.seats.iter().flatten().all(|s| s.bet > 0) {
        deal(&state, instance, t, now).await;
    }
    announce(&state, instance, f);
    Ok(Json(floor_json(instance, f)))
}

#[derive(Deserialize)]
struct ActReq {
    /// "hit", "stand" or "double".
    action: String,
}

/// Your move, on your turn.
async fn act(
    State(state): S,
    headers: HeaderMap,
    Json(req): Json<ActReq>,
) -> ApiResult<Json<Value>> {
    let (me, _) = me(&state, &headers)?;
    let instance = floor_of(&state, me).await?;
    let mut floors = state.tables.0.lock().await;
    let f = floors.entry(instance).or_insert_with(Floor::new);
    let Some(t) = f
        .tables
        .iter_mut()
        .find(|t| t.seats.iter().flatten().any(|s| s.player == me))
    else {
        return Err(conflict("not_seated", "You're not at a table."));
    };
    let Some(turn) = t.turn.filter(|&i| {
        t.phase == Phase::Playing && t.seats[i].as_ref().is_some_and(|s| s.player == me)
    }) else {
        return Err(conflict("not_your_turn", "It's not your turn."));
    };
    match req.action.as_str() {
        "hit" => {
            let c = draw(t);
            let s = t.seats[turn].as_mut().unwrap();
            s.cards.push(c);
            if bj::total(&s.cards).0 >= 21 {
                s.done = true;
            }
        }
        "stand" => t.seats[turn].as_mut().unwrap().done = true,
        "double" => {
            let s = t.seats[turn].as_ref().unwrap();
            if s.cards.len() != 2 || s.doubled {
                return Err(conflict(
                    "cant_double",
                    "You can double on your first two cards.",
                ));
            }
            let (bet, round) = (s.bet, s.round.unwrap());
            raise(&state, me, round, bet).await?;
            let c = draw(t);
            let s = t.seats[turn].as_mut().unwrap();
            s.bet *= 2;
            s.doubled = true;
            s.cards.push(c);
            s.done = true;
        }
        _ => return Err(ApiError::bad_request("bad_action", "Hit, stand or double.")),
    }
    t.until = now_ms() + TURN_MS;
    advance(&state, instance, t, now_ms()).await;
    announce(&state, instance, f);
    Ok(Json(floor_json(instance, f)))
}

// ---- the dealer ------------------------------------------------------------------------

fn draw(t: &mut Table) -> Card {
    if t.shoe.is_empty() {
        t.shoe = bj::shoe();
        t.shoe.shuffle(&mut rand::rng());
    }
    t.shoe.pop().unwrap()
}

/// Deals the hand: two cards each to everyone who's bet, two to the dealer.
/// Seats with no bet sit this one out.
async fn deal(state: &SocialState, instance: u16, t: &mut Table, now: u64) {
    if t.shoe.len() < bj::RESHUFFLE_BELOW {
        t.shoe = bj::shoe();
        t.shoe.shuffle(&mut rand::rng());
    }
    t.phase = Phase::Playing;
    t.deal_at = None;
    t.dealer.clear();
    for _ in 0..2 {
        for i in 0..bj::SEATS {
            if t.seats[i].as_ref().is_some_and(|s| s.bet > 0) {
                let c = draw(t);
                t.seats[i].as_mut().unwrap().cards.push(c);
            }
        }
        let c = draw(t);
        t.dealer.push(c);
    }
    for s in t.seats.iter_mut().flatten() {
        // Sitting out, or a natural 21: nothing to decide.
        s.done = s.bet == 0 || bj::is_blackjack(&s.cards) || s.leaving;
    }
    // The dealer peeks: with blackjack, the hand is over at once.
    if bj::is_blackjack(&t.dealer) {
        for s in t.seats.iter_mut().flatten() {
            s.done = true;
        }
    }
    t.turn = None;
    advance(state, instance, t, now).await;
}

/// The next player's turn, or (everyone done) the dealer plays and pays.
async fn advance(state: &SocialState, instance: u16, t: &mut Table, now: u64) {
    if t.phase != Phase::Playing {
        return;
    }
    let next = (0..bj::SEATS).find(|&i| t.seats[i].as_ref().is_some_and(|s| s.bet > 0 && !s.done));
    if let Some(i) = next {
        if t.turn != Some(i) {
            t.turn = Some(i);
            t.until = now + TURN_MS;
        }
        return;
    }
    t.turn = None;
    // The dealer draws only if someone's still standing.
    let live = t
        .seats
        .iter()
        .flatten()
        .any(|s| s.bet > 0 && !bj::bust(&s.cards));
    while live && !bj::is_blackjack(&t.dealer) && bj::dealer_draws(&t.dealer) {
        let c = draw(t);
        t.dealer.push(c);
    }
    let dealer = t.dealer.clone();
    for s in t.seats.iter_mut().flatten().filter(|s| s.bet > 0) {
        let o = bj::settle(&s.cards, &dealer);
        let paid = o.pays(s.bet);
        s.result = Some((o, paid));
        if let Some(round) = s.round {
            pay(
                state,
                s.player,
                round,
                paid,
                json!({
                    "cards": s.cards.iter().map(|&c| bj::face(c)).collect::<Vec<_>>(),
                    "dealer": dealer.iter().map(|&c| bj::face(c)).collect::<Vec<_>>(),
                    "outcome": o.name(), "doubled": s.doubled,
                }),
            )
            .await;
        }
        if o == bj::Outcome::Blackjack {
            cheer(
                state,
                instance,
                format!("🃏 Blackjack for {}! {paid} coins.", s.name),
            );
        }
    }
    t.phase = Phase::Done;
    t.until = now + DONE_MS;
}

/// After a hand: clear the felt; anyone who left gets up.
fn reset(t: &mut Table) {
    t.phase = Phase::Betting;
    t.dealer.clear();
    t.turn = None;
    t.deal_at = None;
    for s in t.seats.iter_mut() {
        if s.as_ref().is_some_and(|s| s.leaving) {
            *s = None;
        } else if let Some(s) = s {
            s.bet = 0;
            s.round = None;
            s.cards.clear();
            s.doubled = false;
            s.done = false;
            s.result = None;
        }
    }
}

/// Moves every table along: bets close, wheels land, turns time out, hands
/// end; and anyone who's left the casino leaves their seat.
pub async fn tick(state: &SocialState, now: u64) {
    let mut floors = state.tables.0.lock().await;
    for (&instance, f) in floors.iter_mut() {
        let mut changed = false;
        let w = &mut f.wheel;
        match w.spin {
            Spin::Betting { closes } if now >= closes => {
                start_spin(w, now);
                changed = true;
            }
            Spin::Spinning { number, lands } if now >= lands => {
                land(state, instance, w, number).await;
                changed = true;
            }
            _ => {}
        }
        for t in f.tables.iter_mut() {
            let gone: Vec<Uuid> = t
                .seats
                .iter()
                .flatten()
                .filter(|s| !s.leaving && !here(state, s.player, instance))
                .map(|s| s.player)
                .collect();
            for p in gone {
                leave_seat(state, t, p).await;
                changed = true;
            }
            match t.phase {
                Phase::Betting if t.deal_at.is_some_and(|d| now >= d) => {
                    deal(state, instance, t, now).await;
                    changed = true;
                }
                Phase::Playing => {
                    if let Some(i) = t.turn
                        && now >= t.until
                        && let Some(s) = t.seats[i].as_mut()
                    {
                        s.done = true;
                    }
                    let before = (t.turn, t.phase == Phase::Done);
                    advance(state, instance, t, now).await;
                    changed |= before != (t.turn, t.phase == Phase::Done);
                }
                Phase::Done if now >= t.until => {
                    reset(t);
                    changed = true;
                }
                _ => {}
            }
        }
        if changed {
            announce(state, instance, f);
        }
    }
}

/// Refunds what a restart left on the tables, then runs `tick` twice a second.
pub fn spawn_ticker(state: Arc<SocialState>) {
    tokio::spawn(async move {
        refund_unsettled(&state, None).await;
        let mut t = tokio::time::interval(Duration::from_millis(500));
        loop {
            t.tick().await;
            tick(&state, now_ms()).await;
        }
    });
}
