//! botswarm (spec §6.6): headless bots that join a zone instance over the real
//! protocol and behave like players (wander, crowd at a point, chat, emote).
//!
//! With `--gate` it enforces the CI performance gate: p99 server tick < 20 ms
//! and p99 outbound bandwidth per client < 8 KB/s, measured after ramp-up.
//!
//! Bots mint their own join tokens with the shared secret, so only the zone
//! server needs to be running. With `--api` (the dev stack) each bot also
//! signs in as a real player, "Bot 3", so people can befriend it.
//!
//! Bots are good sports: they accept friend requests, being followed, hugs,
//! high fives, dances and rock paper scissors (picking at random), wave back
//! at people who wave at them, and stop walking when someone comes close.
//! Now and then one goes fishing: walks to the water, casts, reels in (not
//! always well) and smacks a rare catch flopping on the bank (not always fast
//! enough).

use anyhow::{Context, bail};
use clap::{Parser, ValueEnum};
use commons_common::token::{self, AccessClaims, JoinClaims, TrustTier};
use commons_protocol::{
    ClientMsg, EntityInfo, PROTOCOL_VERSION, ServerMsg, emote, fish_event, push_framed, rps, split_frame,
    together,
};
use commons_sim::furniture::{Furniture, Side};
use commons_sim::{Grid, MapFile, Motion, TilePos};
use futures_util::{SinkExt, StreamExt};
use rand::rngs::SmallRng;
use rand::seq::IndexedRandom;
use rand::{Rng, SeedableRng};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;

#[derive(Copy, Clone, Debug, ValueEnum, PartialEq)]
enum Behaviour {
    /// Stroll to random nearby tiles.
    Wander,
    /// Gather around the spawn plaza, as at a festival.
    Crowd,
    /// 70% wander, 30% crowd.
    Mix,
}

#[derive(Parser, Debug, Clone)]
#[command(about = "Commons load-test bots")]
struct Args {
    #[arg(long, default_value = "ws://127.0.0.1:8082/ws")]
    url: String,
    /// Zone server debug stats endpoint (host:port), used for tick timings.
    #[arg(long, default_value = "127.0.0.1:8082")]
    stats_addr: String,
    #[arg(long, default_value_t = 500)]
    bots: usize,
    /// Seconds to run after the ramp completes.
    #[arg(long, default_value_t = 60)]
    duration: u64,
    /// Seconds over which bots connect.
    #[arg(long, default_value_t = 10)]
    ramp: u64,
    #[arg(long, default_value = "founders_park")]
    zone: String,
    #[arg(long, default_value_t = 1)]
    instance: u16,
    #[arg(long, value_enum, default_value_t = Behaviour::Mix)]
    behaviour: Behaviour,
    #[arg(long, default_value = "assets/maps/founders_park.json")]
    map: String,
    /// Viewport in tiles reported by each bot (a 1080p screen at 2× scale ≈ 30×17).
    #[arg(long, default_value_t = 30)]
    view_w: u8,
    #[arg(long, default_value_t = 17)]
    view_h: u8,
    /// Fail (exit 1) if the performance gate is not met.
    #[arg(long)]
    gate: bool,
    #[arg(long, default_value_t = 20.0)]
    max_tick_p99_ms: f64,
    #[arg(long, default_value_t = 8.0)]
    max_client_kbps: f64,
    /// The API (dev mode only): bots sign in as real players, so they can be
    /// befriended. Without it they're anonymous (load tests).
    #[arg(long)]
    api: Option<String>,
    /// The social gateway, where bots answer friend requests (with `--api`).
    #[arg(long, default_value = "http://127.0.0.1:8083")]
    social: String,
}

/// Someone else a bot can see.
struct Other {
    /// A person, not another bot: the one worth waving back at.
    human: bool,
    tile: TilePos,
    motion: Option<Motion>,
}

impl Other {
    fn from(e: &EntityInfo) -> Self {
        let motion = (e.path.len() >= 2).then(|| Motion {
            path: e.path.iter().map(|t| (t.x, t.y)).collect(),
            t0: e.t0,
            speed_x10: e.speed_x10,
            sprint_in: e.sprint_in,
        });
        Other {
            human: !e.name.starts_with("Bot "),
            tile: (e.x, e.y),
            motion,
        }
    }

    fn at(&self, t: u32) -> TilePos {
        self.motion.as_ref().map_or(self.tile, |m| m.tile_at(t))
    }
}

/// How close (tiles) someone must come for a bot to stop and say hello.
const STOP_NEAR: i32 = 2;
/// How close a wave must be for a bot to wave back.
const WAVE_BACK_NEAR: i32 = 8;

fn cheb(a: TilePos, b: TilePos) -> i32 {
    (a.0 as i32 - b.0 as i32).abs().max((a.1 as i32 - b.1 as i32).abs())
}

/// Signs in (dev mode) as `name`, creating the account the first time.
/// Returns the player's id and look. Waits for the API to come up.
async fn sign_in(api: &str, name: &str) -> anyhow::Result<(String, u32)> {
    let http = reqwest::Client::new();
    let mut last = anyhow::anyhow!("no answer");
    for _ in 0..60 {
        let res = http
            .post(format!("{api}/api/auth/dev-login"))
            .json(&serde_json::json!({ "display_name": name }))
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => {
                let v: serde_json::Value = r.json().await?;
                let id = v["player"]["id"].as_str().context("no player id")?.to_string();
                let look = v["player"]["look"].as_u64().unwrap_or(0) as u32;
                return Ok((id, look));
            }
            Ok(r) => last = anyhow::anyhow!("dev login: {}", r.status()),
            Err(e) => last = e.into(),
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err(last)
}

/// Accepts every friend request a bot gets, the way a friendly player would.
async fn answer_friends(social: String, secret: Vec<u8>, claims: AccessClaims, end: Instant) {
    let http = reqwest::Client::new();
    while Instant::now() < end {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let bearer = format!("Bearer {}", token::sign(&secret, &claims, 300));
        let Ok(res) = http
            .get(format!("{social}/api/social/notifications"))
            .header("authorization", &bearer)
            .send()
            .await
        else {
            continue;
        };
        let Ok(list) = res.json::<serde_json::Value>().await else {
            continue;
        };
        let mut unread = false;
        for n in list.as_array().into_iter().flatten() {
            if n["read"].as_bool() == Some(true) {
                continue;
            }
            unread = true;
            if n["kind"] == "friend_request"
                && let Some(from) = n["body"]["from_id"].as_str()
            {
                let _ = http
                    .post(format!("{social}/api/social/respond"))
                    .header("authorization", &bearer)
                    .json(&serde_json::json!({ "id": from, "accept": true }))
                    .send()
                    .await;
            }
        }
        if unread {
            let _ = http
                .post(format!("{social}/api/social/notifications/read"))
                .header("authorization", &bearer)
                .json(&serde_json::json!({}))
                .send()
                .await;
        }
    }
}

#[derive(Default, Debug)]
struct BotReport {
    connected: bool,
    error: Option<String>,
    /// Bytes received during the measurement window.
    window_bytes: u64,
    window_secs: f64,
    frames: u64,
    decode_errors: u64,
    server_errors: u64,
    rtts_ms: Vec<f64>,
    entities_seen_max: usize,
}

const PHRASES: &[&str] = &[
    "hi!",
    "lovely evening",
    "anyone up for chess?",
    "the pond is so calm",
    "nice hat",
    "brb",
    "who planted the tulips?",
    "see you at the fountain",
    "haha",
    "good morning everyone",
];

fn frame(msg: &ClientMsg) -> Message {
    let mut f = Vec::new();
    push_framed(&mut f, &msg.to_bytes());
    Message::Binary(f.into())
}

/// Map data every bot shares.
struct World {
    grid: Grid,
    furniture: Furniture,
    /// Where one can fish: a dry tile to stand on and a water tile in casting reach.
    fishing: Vec<(TilePos, TilePos)>,
}

/// Bots fish within this many tiles of the fisherman (the pond by the pier).
const FISHING_NEAR: i32 = 14;
/// One bot in this many is a keen angler, out at the pond nearly all the
/// time, so there's almost always someone fishing.
const ANGLER_EVERY: usize = 7;

/// Every dry, walkable tile right by the water, with a water tile next to it;
/// around the fisherman's pond if the map has him.
fn fishing_spots(map: &MapFile, grid: &Grid) -> Vec<(TilePos, TilePos)> {
    let fisherman = map.objects.iter().find(|o| o.kind == "fisherman").map(|o| (o.x, o.y));
    let Some(water) = map.ground_legend.iter().position(|n| n == "water") else {
        return vec![];
    };
    let is_water = |x: i32, y: i32| {
        x >= 0 && y >= 0 && (x as u16) < map.width && (y as u16) < map.height && map.ground[y as usize * map.width as usize + x as usize] as usize == water
    };
    let mut spots = vec![];
    for y in 0..map.height as i32 {
        for x in 0..map.width as i32 {
            if !grid.walkable_i(x, y) || is_water(x, y) {
                continue;
            }
            if fisherman.is_some_and(|f| cheb(f, (x as u16, y as u16)) > FISHING_NEAR) {
                continue;
            }
            if let Some((wx, wy)) = [(0, 1), (0, -1), (1, 0), (-1, 0)].iter().map(|(dx, dy)| (x + dx, y + dy)).find(|&(wx, wy)| is_water(wx, wy)) {
                spots.push(((x as u16, y as u16), (wx as u16, wy as u16)));
            }
        }
    }
    spots
}

/// A walkable tile next to `seat`, to stand on before sitting.
fn approach(grid: &Grid, seat: TilePos) -> Option<TilePos> {
    for (dx, dy) in [
        (0, 1),
        (-1, 1),
        (1, 1),
        (-1, 0),
        (1, 0),
        (0, -1),
        (-1, -1),
        (1, -1),
    ] {
        let (x, y) = (seat.0 as i32 + dx, seat.1 as i32 + dy);
        if grid.walkable_i(x, y) {
            return Some((x as u16, y as u16));
        }
    }
    None
}

fn pick_target(grid: &Grid, rng: &mut impl Rng, around: TilePos, radius: i32) -> Option<TilePos> {
    for _ in 0..20 {
        let x = around.0 as i32 + rng.random_range(-radius..=radius);
        let y = around.1 as i32 + rng.random_range(-radius..=radius);
        if grid.walkable_i(x, y) {
            return Some((x as u16, y as u16));
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
async fn run_bot(
    i: usize,
    args: Arc<Args>,
    world: Arc<World>,
    spawn: TilePos,
    secret: Arc<Vec<u8>>,
    start_delay: Duration,
    window_start: Instant,
    end: Instant,
) -> BotReport {
    tokio::time::sleep(start_delay).await;
    let mut report = BotReport::default();
    if let Err(e) = bot_loop(
        i,
        &args,
        &world,
        spawn,
        &secret,
        window_start,
        end,
        &mut report,
    )
    .await
    {
        report.error = Some(format!("{e:#}"));
    }
    report
}

#[allow(clippy::too_many_arguments)]
async fn bot_loop(
    i: usize,
    args: &Args,
    world: &World,
    spawn: TilePos,
    secret: &[u8],
    window_start: Instant,
    end: Instant,
    report: &mut BotReport,
) -> anyhow::Result<()> {
    let mut rng = SmallRng::seed_from_u64(i as u64 ^ rand::random::<u64>());
    // Keen anglers wander (between casts) and fish all day.
    let angler = i % ANGLER_EVERY == 0;
    let behaviour = if angler { Behaviour::Wander } else { match args.behaviour {
        Behaviour::Mix => {
            if rng.random_bool(0.3) {
                Behaviour::Crowd
            } else {
                Behaviour::Wander
            }
        }
        b => b,
    } };
    let name = format!("Bot {i}");
    let (sub, look) = match &args.api {
        Some(api) => sign_in(api, &name).await?,
        None => (format!("bot-{i}"), rng.random()),
    };
    if args.api.is_some() {
        let me = AccessClaims {
            sub: sub.clone(),
            name: name.clone(),
            look,
            tier: TrustTier::Newcomer,
            minor: false,
            muted_until: 0,
        };
        tokio::spawn(answer_friends(args.social.clone(), secret.to_vec(), me, end));
    }
    let claims = JoinClaims {
        sub,
        name,
        look,
        tier: TrustTier::Visitor,
        minor: false,
        zone: args.zone.clone(),
        instance: args.instance,
        owner: None,
        muted_until: 0,
        arrive: None,
    };
    let join_token = token::sign(secret, &claims, 300);
    let (ws, _) = tokio_tungstenite::connect_async(&args.url)
        .await
        .context("connect")?;
    let (mut tx, mut rx) = ws.split();
    tx.send(frame(&ClientMsg::Hello {
        join_token,
        version: PROTOCOL_VERSION,
        view_w: args.view_w,
        view_h: args.view_h,
    }))
    .await?;
    report.connected = true;

    let local_epoch = Instant::now();
    let mut server_offset: i64 = 0; // server_t - local ms
    let mut self_id = 0u32;
    let mut me: TilePos = spawn;
    let mut motion: Option<Motion> = None;
    let mut known = std::collections::HashSet::new();

    let local_ms = || local_epoch.elapsed().as_millis() as i64;
    let mut next_move = Instant::now() + Duration::from_millis(rng.random_range(500..3000));
    let mut next_chat = Instant::now() + Duration::from_secs(rng.random_range(10..40));
    let mut next_emote = Instant::now() + Duration::from_secs(rng.random_range(5..20));
    let mut next_ping = Instant::now() + Duration::from_secs(1);
    let mut timer = tokio::time::interval(Duration::from_millis(250));
    let grid = &world.grid;
    // Sitting and chess: some bots take a bench now and then; at a table they
    // play random legal moves.
    let mut sitting = false;
    let mut my_table: Option<(u32, Side)> = None;
    let mut next_sit = Instant::now() + Duration::from_secs(rng.random_range(5..40));
    let mut stand_at = Instant::now();
    let mut chess_move: Option<(Instant, u32, String)> = None;
    // Being a good sport: who's around, answers waiting to be sent, and a
    // pause while someone stands close.
    let mut others: HashMap<u32, Other> = HashMap::new();
    let mut replies: Vec<(Instant, ClientMsg)> = Vec::new();
    let mut paused_until = Instant::now();
    let mut next_wave_back = Instant::now();
    // Fishing: when to go next, and, while out fishing, when to give up on it.
    let mut next_fish = Instant::now() + Duration::from_secs(if angler { rng.random_range(3..15) } else { rng.random_range(20..90) });
    let mut fishing_until: Option<Instant> = None;

    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(msg) = msg else { bail!("server closed connection") };
                let data = match msg? {
                    Message::Binary(d) => d,
                    Message::Close(_) => bail!("server closed connection"),
                    _ => continue,
                };
                report.frames += 1;
                if Instant::now() >= window_start {
                    report.window_bytes += data.len() as u64;
                }
                for raw in split_frame(&data) {
                    let Ok(m) = raw.and_then(ServerMsg::decode) else {
                        report.decode_errors += 1;
                        continue;
                    };
                    match m {
                        ServerMsg::Welcome { self_id: id, server_t, .. } => {
                            self_id = id;
                            server_offset = server_t as i64 - local_ms();
                        }
                        ServerMsg::CellEnter { entities, .. } => {
                            for e in entities {
                                if e.id == self_id { me = (e.x, e.y); } else { others.insert(e.id, Other::from(&e)); }
                                known.insert(e.id);
                            }
                        }
                        ServerMsg::Spawn { entity } => {
                            if entity.id != self_id { others.insert(entity.id, Other::from(&entity)); }
                            known.insert(entity.id);
                        }
                        ServerMsg::CellLeave { ids, .. } => for id in ids { known.remove(&id); others.remove(&id); },
                        ServerMsg::Despawn { id } => { known.remove(&id); others.remove(&id); }
                        ServerMsg::MoveStart { id, speed_x10, t0, sprint_in, path } if id != self_id => {
                            if let Some(o) = others.get_mut(&id) {
                                o.motion = Some(Motion { path: path.iter().map(|t| (t.x, t.y)).collect(), t0, speed_x10, sprint_in });
                            }
                        }
                        ServerMsg::Snap { id, x, y } | ServerMsg::StateChange { id, x, y, .. } if id != self_id => {
                            if let Some(o) = others.get_mut(&id) {
                                o.tile = (x, y);
                                o.motion = None;
                            }
                        }
                        // Say yes to whatever's offered: following, a hug, a game…
                        ServerMsg::Offered { from, kind } if kind != together::STOP_FOLLOW => {
                            let after = Duration::from_millis(rng.random_range(500..1500));
                            replies.push((Instant::now() + after, ClientMsg::Accept { from, kind }));
                        }
                        ServerMsg::Rps { a, b, phase, .. } if phase == rps::CHOOSING && (a == self_id || b == self_id) => {
                            let after = Duration::from_millis(rng.random_range(1000..4000));
                            let pick = rng.random_range(rps::ROCK..=rps::SCISSORS);
                            replies.push((Instant::now() + after, ClientMsg::RpsPick { pick }));
                        }
                        // Someone nearby waved: wave back.
                        ServerMsg::EmoteShown { id, emote: emote::WAVE } if Instant::now() >= next_wave_back => {
                            let server_now = (local_ms() + server_offset).max(0) as u32;
                            if others.get(&id).is_some_and(|o| o.human && cheb(o.at(server_now), me) <= WAVE_BACK_NEAR) {
                                next_wave_back = Instant::now() + Duration::from_secs(3);
                                let after = Duration::from_millis(rng.random_range(400..1000));
                                replies.push((Instant::now() + after, ClientMsg::Emote { emote: emote::WAVE }));
                            }
                        }
                        ServerMsg::MoveStart { id, speed_x10, t0, sprint_in, path } if id == self_id => {
                            motion = Some(Motion { path: path.iter().map(|t| (t.x, t.y)).collect(), t0, speed_x10, sprint_in });
                        }
                        ServerMsg::Pong { client_t, server_t } => {
                            let rtt = local_ms() - client_t as i64;
                            report.rtts_ms.push(rtt as f64);
                            server_offset = server_t as i64 + rtt / 2 - local_ms();
                        }
                        ServerMsg::StateChange { id, state, x, y } if id == self_id => {
                            sitting = state == commons_protocol::state::SITTING;
                            motion = None;
                            me = (x, y);
                            my_table = None;
                            if sitting {
                                let seat = Furniture::seat_id_for(grid.w, (x, y));
                                my_table = world.furniture.seats.get(&seat).and_then(|s| s.table);
                                let secs = if my_table.is_some() { 60..180 } else { 10..40 };
                                stand_at = Instant::now() + Duration::from_secs(rng.random_range(secs));
                            }
                        }
                        ServerMsg::GameState { table, status, white, black, fen, legal, .. }
                            if my_table.is_some_and(|(t, _)| t == table) =>
                        {
                            let white_to_move = fen.split(' ').nth(1) == Some("w");
                            let mine = (white_to_move && white == self_id) || (!white_to_move && black == self_id);
                            let delay = Duration::from_millis(rng.random_range(800..3000));
                            if status == commons_protocol::game_status::PLAYING && mine && !legal.is_empty() {
                                let mv = legal.choose(&mut rng).unwrap().clone();
                                chess_move = Some((Instant::now() + delay, table, mv));
                            } else if status >= commons_protocol::game_status::WHITE_WON {
                                chess_move = Some((Instant::now() + delay * 3, table, "new".into()));
                            }
                        }
                        // Out fishing: reel in a bite (fumbling it now and then); smack a fish
                        // flopping on the bank, mostly quick enough; done when it's caught or gone.
                        ServerMsg::FishEvent { id, kind, .. } if id == self_id => match kind {
                            fish_event::BITE => {
                                let after = Duration::from_millis(rng.random_range(500..1800));
                                let quality = if rng.random_bool(0.75) { rng.random_range(500..1000) } else { 100 };
                                replies.push((Instant::now() + after, ClientMsg::FishReel { quality }));
                            }
                            fish_event::FLOP => {
                                let hits = if rng.random_bool(0.8) { 5 } else { 2 };
                                let mut at = Instant::now();
                                for _ in 0..hits {
                                    at += Duration::from_millis(rng.random_range(450..850));
                                    replies.push((at, ClientMsg::FishHit {}));
                                }
                            }
                            fish_event::CAUGHT | fish_event::ESCAPED => {
                                fishing_until = None;
                                if angler {
                                    // Straight back to it, from about the same spot.
                                    next_fish = Instant::now() + Duration::from_secs(rng.random_range(5..15));
                                    next_move = next_fish + Duration::from_secs(30);
                                } else {
                                    next_fish = Instant::now() + Duration::from_secs(rng.random_range(60..180));
                                    next_move = Instant::now() + Duration::from_secs(rng.random_range(2..6));
                                }
                            }
                            _ => {}
                        },
                        ServerMsg::Error { code, message } => {
                            report.server_errors += 1;
                            if code == commons_protocol::error_code::UNAUTHORIZED { bail!("unauthorized: {message}"); }
                        }
                        _ => {}
                    }
                }
                report.entities_seen_max = report.entities_seen_max.max(known.len());
            }
            _ = timer.tick() => {
                let now = Instant::now();
                if now >= end {
                    let _ = tx.send(Message::Close(None)).await;
                    break;
                }
                let server_now = (local_ms() + server_offset).max(0) as u32;
                if let Some(m) = &motion {
                    me = m.tile_at(server_now);
                    if m.is_done(server_now) { motion = None; }
                }
                // Answers that are due.
                let (due, later): (Vec<_>, Vec<_>) = replies.drain(..).partition(|(at, _)| *at <= now);
                replies = later;
                for (_, msg) in due {
                    tx.send(frame(&msg)).await?;
                }
                // Someone's right here: stop on the tile we're walking into and stay a while.
                if others.values().any(|o| o.human && cheb(o.at(server_now), me) <= STOP_NEAR) {
                    paused_until = now + Duration::from_secs(3);
                    if let Some(m) = &motion
                        && let Some((_, next, _)) = m.splice(server_now)
                        && m.path.last() != Some(&next)
                    {
                        tx.send(frame(&ClientMsg::MoveTo { x: next.0, y: next.1, sprint: false })).await?;
                    }
                }
                let paused = now < paused_until;
                if let Some((at, table, uci)) = chess_move.take() {
                    if now >= at {
                        tx.send(frame(&ClientMsg::GameMove { table, uci })).await?;
                    } else {
                        chess_move = Some((at, table, uci));
                    }
                }
                if sitting {
                    if now >= stand_at {
                        tx.send(frame(&ClientMsg::Stand {})).await?;
                        sitting = false;
                        next_move = now + Duration::from_secs(1);
                    }
                } else if paused {
                    // Standing still for the person close by.
                } else if let Some(until) = fishing_until {
                    // Out fishing; giving up if nothing comes of it.
                    if now >= until {
                        fishing_until = None;
                        next_move = now;
                    }
                } else if now >= next_fish && self_id != 0 && behaviour == Behaviour::Wander && !world.fishing.is_empty() {
                    // Off to the water: walk to a spot nearby (casting on arrival).
                    next_fish = now + Duration::from_secs(if angler { rng.random_range(5..15) } else { rng.random_range(60..180) });
                    // An angler already at the pond stays near where they were; others pick any spot there.
                    let near: Vec<_> = world.fishing.iter().filter(|(stand, _)| cheb(*stand, me) <= 4).collect();
                    let pick = if angler && !near.is_empty() { near.choose(&mut rng).copied() } else { world.fishing.choose(&mut rng) };
                    if let Some(&(stand, water)) = pick {
                        tx.send(frame(&ClientMsg::MoveTo { x: stand.0, y: stand.1, sprint: false })).await?;
                        tx.send(frame(&ClientMsg::FishCast { x: water.0, y: water.1 })).await?;
                        fishing_until = Some(now + Duration::from_secs(60));
                    }
                } else if now >= next_sit && self_id != 0 && behaviour == Behaviour::Wander && !angler {
                    next_sit = now + Duration::from_secs(rng.random_range(30..90));
                    // Table seats a third of the time, so games actually happen.
                    let table_seats: Vec<_> = world.furniture.seats.iter().filter(|(_, s)| s.table.is_some()).collect();
                    let all: Vec<_> = world.furniture.seats.iter().collect();
                    let pool = if rng.random_bool(0.35) && !table_seats.is_empty() { table_seats } else { all };
                    if let Some((&id, seat)) = pool.choose(&mut rng).copied()
                        && let Some((x, y)) = approach(grid, seat.tile)
                    {
                        tx.send(frame(&ClientMsg::MoveTo { x, y, sprint: false })).await?;
                        tx.send(frame(&ClientMsg::Sit { seat: id })).await?;
                        next_move = now + Duration::from_secs(20);
                    }
                } else if now >= next_move && self_id != 0 {
                    let target = match behaviour {
                        Behaviour::Crowd => pick_target(grid, &mut rng, spawn, 7),
                        _ => pick_target(grid, &mut rng, me, 12),
                    };
                    if let Some((x, y)) = target {
                        tx.send(frame(&ClientMsg::MoveTo { x, y, sprint: false })).await?;
                    }
                    next_move = now + Duration::from_millis(rng.random_range(2000..8000));
                }
                if now >= next_chat {
                    let text = PHRASES.choose(&mut rng).unwrap().to_string();
                    tx.send(frame(&ClientMsg::ChatSay { text })).await?;
                    next_chat = now + Duration::from_secs(rng.random_range(20..60));
                }
                if now >= next_emote {
                    tx.send(frame(&ClientMsg::Emote { emote: rng.random_range(1..=emote::MAX) })).await?;
                    next_emote = now + Duration::from_secs(rng.random_range(8..25));
                }
                if now >= next_ping {
                    tx.send(frame(&ClientMsg::Ping { client_t: local_ms() as u32 })).await?;
                    next_ping = now + Duration::from_secs(5);
                }
            }
        }
    }
    report.window_secs = end.saturating_duration_since(window_start).as_secs_f64();
    Ok(())
}

/// Minimal HTTP GET for the zone server's /debug/stats (no TLS needed).
async fn fetch_stats(addr: &str) -> anyhow::Result<serde_json::Value> {
    let mut s = tokio::net::TcpStream::connect(addr).await?;
    s.write_all(
        format!("GET /debug/stats HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n")
            .as_bytes(),
    )
    .await?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).await?;
    let text = String::from_utf8_lossy(&buf);
    let body = text
        .split_once("\r\n\r\n")
        .map(|(_, b)| b)
        .context("bad http response")?;
    Ok(serde_json::from_str(body)?)
}

fn pct(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() - 1) as f64 * q).round() as usize]
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Arc::new(Args::parse());
    let map_text =
        std::fs::read_to_string(&args.map).with_context(|| format!("reading {}", args.map))?;
    let map = MapFile::from_json(&map_text).map_err(anyhow::Error::msg)?;
    let grid = map.grid();
    let world = Arc::new(World {
        fishing: fishing_spots(&map, &grid),
        grid,
        furniture: Furniture::from_map(&map),
    });
    let spawn = (map.spawn.x, map.spawn.y);
    let secret = Arc::new(commons_common::config::secret());

    println!(
        "botswarm: {} bots ({:?}) → {} zone={} instance={}, ramp {}s, measure {}s",
        args.bots, args.behaviour, args.url, args.zone, args.instance, args.ramp, args.duration
    );
    let t0 = Instant::now();
    let window_start = t0 + Duration::from_secs(args.ramp + 2);
    let end = window_start + Duration::from_secs(args.duration);

    let mut handles = Vec::with_capacity(args.bots);
    for i in 0..args.bots {
        let delay = Duration::from_millis(args.ramp * 1000 * i as u64 / args.bots.max(1) as u64);
        handles.push(tokio::spawn(run_bot(
            i,
            args.clone(),
            world.clone(),
            spawn,
            secret.clone(),
            delay,
            window_start,
            end,
        )));
    }

    // Sample server tick stats near the end of the window, while all bots are connected.
    let stats_at = end - Duration::from_secs(1);
    tokio::time::sleep_until(stats_at.into()).await;
    let stats = fetch_stats(&args.stats_addr).await;

    let mut reports = Vec::new();
    for h in handles {
        reports.push(h.await?);
    }

    let connected = reports.iter().filter(|r| r.connected).count();
    let failed: Vec<_> = reports.iter().filter_map(|r| r.error.as_ref()).collect();
    let mut kbps: Vec<f64> = reports
        .iter()
        .filter(|r| r.error.is_none() && r.window_secs > 0.0)
        .map(|r| r.window_bytes as f64 / 1024.0 / r.window_secs)
        .collect();
    kbps.sort_by(f64::total_cmp);
    let mut rtts: Vec<f64> = reports
        .iter()
        .flat_map(|r| r.rtts_ms.iter().copied())
        .collect();
    rtts.sort_by(f64::total_cmp);
    let decode_errors: u64 = reports.iter().map(|r| r.decode_errors).sum();
    let server_errors: u64 = reports.iter().map(|r| r.server_errors).sum();
    let seen_max = reports
        .iter()
        .map(|r| r.entities_seen_max)
        .max()
        .unwrap_or(0);

    println!("\n== clients ==");
    println!("connected            {connected}/{}", args.bots);
    println!("failed               {}", failed.len());
    for e in failed.iter().take(5) {
        println!("  e.g. {e}");
    }
    println!("decode errors        {decode_errors}");
    println!("server errors        {server_errors} (e.g. no path, rate limited)");
    println!("max entities in view {seen_max}");
    println!(
        "KB/s per client      p50 {:.2}  p99 {:.2}  max {:.2}",
        pct(&kbps, 0.5),
        pct(&kbps, 0.99),
        pct(&kbps, 1.0)
    );
    println!(
        "ping RTT ms          p50 {:.1}  p99 {:.1}",
        pct(&rtts, 0.5),
        pct(&rtts, 0.99)
    );

    let mut tick_p99_ms = f64::NAN;
    println!("\n== server ==");
    match &stats {
        Ok(v) => {
            for inst in v["instances"].as_array().into_iter().flatten() {
                if inst["zone"] == args.zone.as_str() && inst["instance"] == args.instance {
                    tick_p99_ms = inst["tick_p99_us"].as_f64().unwrap_or(f64::NAN) / 1000.0;
                }
                println!(
                    "{}#{}  pop {}  tick µs p50 {} p99 {} max {}",
                    inst["zone"].as_str().unwrap_or("?"),
                    inst["instance"],
                    inst["population"],
                    inst["tick_p50_us"],
                    inst["tick_p99_us"],
                    inst["tick_max_us"]
                );
            }
        }
        Err(e) => println!("could not read stats from {}: {e:#}", args.stats_addr),
    }

    if args.gate {
        let client_p99 = pct(&kbps, 0.99);
        let mut problems = Vec::new();
        if connected < args.bots || !failed.is_empty() {
            problems.push(format!(
                "{} of {} bots failed",
                args.bots - connected + failed.len(),
                args.bots
            ));
        }
        if decode_errors > 0 {
            problems.push(format!("{decode_errors} decode errors"));
        }
        if tick_p99_ms.is_nan() || tick_p99_ms >= args.max_tick_p99_ms {
            problems.push(format!(
                "server tick p99 {tick_p99_ms:.2} ms ≥ {} ms",
                args.max_tick_p99_ms
            ));
        }
        if client_p99 >= args.max_client_kbps {
            problems.push(format!(
                "client p99 {client_p99:.2} KB/s ≥ {} KB/s",
                args.max_client_kbps
            ));
        }
        println!("\n== perf gate ==");
        if problems.is_empty() {
            println!(
                "PASS  tick p99 {tick_p99_ms:.2} ms < {} ms, client p99 {client_p99:.2} KB/s < {} KB/s",
                args.max_tick_p99_ms, args.max_client_kbps
            );
        } else {
            for p in &problems {
                println!("FAIL  {p}");
            }
            std::process::exit(1);
        }
    }
    Ok(())
}
