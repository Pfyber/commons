//! botswarm (spec §6.6): headless bots that join a zone instance over the real
//! protocol and behave like players (wander, crowd at a point, chat, emote).
//!
//! With `--gate` it enforces the CI performance gate: p99 server tick < 20 ms
//! and p99 outbound bandwidth per client < 8 KB/s, measured after ramp-up.
//!
//! Bots mint their own join tokens with the shared secret, so only the zone
//! server needs to be running.

use anyhow::{Context, bail};
use clap::{Parser, ValueEnum};
use commons_common::token::{self, JoinClaims, TrustTier};
use commons_protocol::{ClientMsg, PROTOCOL_VERSION, ServerMsg, emote, push_framed, split_frame};
use commons_sim::furniture::{Furniture, Side};
use commons_sim::{Grid, MapFile, Motion, TilePos};
use futures_util::{SinkExt, StreamExt};
use rand::rngs::SmallRng;
use rand::seq::IndexedRandom;
use rand::{Rng, SeedableRng};
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
    #[arg(long, default_value = "city")]
    zone: String,
    #[arg(long, default_value_t = 1)]
    instance: u16,
    #[arg(long, value_enum, default_value_t = Behaviour::Mix)]
    behaviour: Behaviour,
    #[arg(long, default_value = "assets/maps/city.json")]
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
    let behaviour = match args.behaviour {
        Behaviour::Mix => {
            if rng.random_bool(0.3) {
                Behaviour::Crowd
            } else {
                Behaviour::Wander
            }
        }
        b => b,
    };
    let claims = JoinClaims {
        sub: format!("bot-{i}"),
        name: format!("Bot {i}"),
        look: rng.random(),
        tier: TrustTier::Visitor,
        minor: false,
        zone: args.zone.clone(),
        instance: args.instance,
        owner: None,
        muted_until: 0,
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
                                if e.id == self_id { me = (e.x, e.y); }
                                known.insert(e.id);
                            }
                        }
                        ServerMsg::Spawn { entity } => { known.insert(entity.id); }
                        ServerMsg::CellLeave { ids, .. } => for id in ids { known.remove(&id); },
                        ServerMsg::Despawn { id } => { known.remove(&id); }
                        ServerMsg::MoveStart { id, speed_x10, t0, path } if id == self_id => {
                            motion = Some(Motion { path: path.iter().map(|t| (t.x, t.y)).collect(), t0, speed_x10 });
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
                } else if now >= next_sit && self_id != 0 && behaviour == Behaviour::Wander {
                    next_sit = now + Duration::from_secs(rng.random_range(30..90));
                    // Table seats a third of the time, so games actually happen.
                    let table_seats: Vec<_> = world.furniture.seats.iter().filter(|(_, s)| s.table.is_some()).collect();
                    let all: Vec<_> = world.furniture.seats.iter().collect();
                    let pool = if rng.random_bool(0.35) && !table_seats.is_empty() { table_seats } else { all };
                    if let Some((&id, seat)) = pool.choose(&mut rng).copied()
                        && let Some((x, y)) = approach(grid, seat.tile)
                    {
                        tx.send(frame(&ClientMsg::MoveTo { x, y })).await?;
                        tx.send(frame(&ClientMsg::Sit { seat: id })).await?;
                        next_move = now + Duration::from_secs(20);
                    }
                } else if now >= next_move && self_id != 0 {
                    let target = match behaviour {
                        Behaviour::Crowd => pick_target(grid, &mut rng, spawn, 7),
                        _ => pick_target(grid, &mut rng, me, 12),
                    };
                    if let Some((x, y)) = target {
                        tx.send(frame(&ClientMsg::MoveTo { x, y })).await?;
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
    let world = Arc::new(World {
        grid: map.grid(),
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
