//! One live copy of a zone (spec §3, §5, §6.1). A single-threaded actor: all
//! state is owned by the task, commands arrive on a channel and are applied at
//! the start of each 10 Hz tick, and each client gets at most one batched frame
//! per tick.
//!
//! Interest management: avatars belong to exactly one 16×16-tile cell; each
//! client watches the cells overlapping its viewport plus a one-cell margin.
//! The server keeps every client's entity set equal to the members of its
//! watched cells via CellEnter/CellLeave (subscription changes) and
//! Spawn/Despawn (an avatar crossing into or out of the watched area).

mod fishing;
mod garden;
mod hangout;
mod home;
pub(crate) mod play;

use crate::econ::EconomyClient;
use crate::games::ChessGame;
use crate::registry::ZoneDef;
use crate::social::{Presence, SocialClient};
use crate::stats::InstanceStats;
use bytes::Bytes;
use commons_common::filter::clean_chat;
use commons_common::ratelimit::Bucket;
use commons_common::token::JoinClaims;
use commons_protocol::{
    CELL_TILES, ClientMsg, EntityInfo, ServerMsg, Tile, emote, error_code, push_framed, state,
};
use commons_sim::{Grid, Motion, TilePos, WALK_SPEED_X10, compress, find_path};
use rand::Rng;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub const TICK: Duration = Duration::from_millis(100);
/// Walks start slightly in the future so most observers receive the
/// MoveStart before the avatar begins moving.
const MOVE_LEAD_MS: u32 = 100;
/// Proximity chat radius in tiles (spec §7).
const CHAT_RADIUS: i32 = 8;
const MAX_PATH_EXPANSIONS: usize = 12_000;
/// Activity (time present, interactions) is reported to the API this often.
const ACTIVITY_EVERY_MS: u32 = 60_000;
/// Cap on interactions counted per avatar per report.
const MAX_INTERACTIONS_PER_REPORT: u32 = 30;
const MAX_VIEW_W: u8 = 64;
const MAX_VIEW_H: u8 = 48;
/// Entities per CellEnter message, keeping each well under the u16 frame limit.
const CELL_ENTER_CHUNK: usize = 200;
/// A client whose unsent output grows past this is disconnected.
const MAX_PENDING_OUT: usize = 256 * 1024;
const INBOX: usize = 16_384;

pub type ConnId = u64;

pub enum Cmd {
    Join {
        conn: ConnId,
        claims: JoinClaims,
        view: (u8, u8),
        out: mpsc::Sender<Bytes>,
    },
    Msg {
        conn: ConnId,
        msg: ClientMsg,
    },
    Leave {
        conn: ConnId,
    },
    /// Continuation of async work (economy calls), run inside the actor.
    Call(Box<dyn FnOnce(&mut Instance) + Send>),
}

/// Something an avatar asked for while walking; done on arrival.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pending {
    Sit(u32),
    Plot {
        x: u16,
        y: u16,
        action: u8,
        item: u32,
    },
    Cast {
        x: u16,
        y: u16,
    },
}

/// Milliseconds since the instance epoch, as used on the wire.
#[derive(Clone, Copy)]
pub struct Clock(Instant);

impl Clock {
    pub fn now_ms(&self) -> u32 {
        self.0.elapsed().as_millis() as u32
    }
}

#[derive(Clone)]
pub struct InstanceHandle {
    pub tx: mpsc::Sender<Cmd>,
    pub clock: Clock,
    pub stats: Arc<InstanceStats>,
}

struct Avatar {
    id: u32,
    conn: ConnId,
    player_id: String,
    name: String,
    look: u32,
    tile: TilePos,
    motion: Option<Motion>,
    cell: u16,
    /// Watched cells, sorted.
    subs: Vec<u16>,
    view: (u8, u8),
    state: u8,
    out: Vec<u8>,
    tx: mpsc::Sender<Bytes>,
    move_rl: Bucket,
    chat_rl: Bucket,
    emote_rl: Bucket,
    game_rl: Bucket,
    /// Jam notes and paint strokes.
    play_rl: Bucket,
    /// Occupied bench, if sitting on one.
    seat: Option<u32>,
    /// Where the avatar stands up to.
    stand_tile: TilePos,
    /// Requested while walking; applied on arrival.
    pending: Option<Pending>,
    /// Unix time a moderation mute ends (0: not muted).
    muted_until: u64,
    /// Activity not yet reported: instance time counted up to, interactions.
    counted_until: u32,
    interactions: u32,
    fish: Option<fishing::FishSession>,
}

impl Avatar {
    fn send(&mut self, msg: &[u8]) {
        push_framed(&mut self.out, msg);
    }

    fn info(&self, now: u32) -> EntityInfo {
        let (speed_x10, t0, path) = match &self.motion {
            Some(m) if !m.is_done(now) => (
                m.speed_x10,
                m.t0,
                m.path.iter().map(|&(x, y)| Tile { x, y }).collect(),
            ),
            _ => (0, 0, Vec::new()),
        };
        EntityInfo {
            id: self.id,
            name: self.name.clone(),
            look: self.look,
            x: self.tile.0,
            y: self.tile.1,
            state: self.state,
            speed_x10,
            t0,
            path,
        }
    }
}

pub struct Instance {
    zone: Arc<ZoneDef>,
    number: u16,
    clock: Clock,
    stats: Arc<InstanceStats>,
    next_id: u32,
    avatars: HashMap<u32, Avatar>,
    by_conn: HashMap<ConnId, u32>,
    by_player: HashMap<String, u32>,
    /// Avatars in each cell.
    members: Vec<Vec<u32>>,
    /// Avatars watching each cell.
    watchers: Vec<Vec<u32>>,
    seat_occupant: HashMap<u32, u32>,
    games: HashMap<u32, ChessGame>,
    /// Tables where the Park Elder has the empty side.
    elders: HashMap<u32, hangout::Elder>,
    /// The pitch's ball, if the zone has a pitch.
    ball: Option<play::Ball>,
    /// Activity of players who left since the last report.
    activity_left: Vec<(String, u32, u32)>,
    next_activity_report: u32,
    /// Index of the programme last announced on the big screen.
    screen_index: Option<usize>,
    /// Collision grid; a copy so placed furniture can block tiles.
    grid: Grid,
    /// For private spaces (homes): the owning player.
    owner: Option<String>,
    economy: Option<Arc<EconomyClient>>,
    social: Option<Arc<SocialClient>>,
    /// Lets async work post its results back into the actor.
    self_tx: Option<mpsc::WeakSender<Cmd>>,
    /// Prefix making idempotency keys unique to this instance's lifetime.
    key_prefix: String,
    key_seq: u64,
    soil: HashSet<TilePos>,
    plots: HashMap<TilePos, garden::PlotView>,
    objects: HashMap<TilePos, u32>,
    /// Tiles with an economy call in flight, to refuse double actions.
    busy: HashSet<TilePos>,
    next_garden_tick: u32,
}

impl Instance {
    pub fn new(
        zone: Arc<ZoneDef>,
        number: u16,
        owner: Option<String>,
        economy: Option<Arc<EconomyClient>>,
        social: Option<Arc<SocialClient>>,
    ) -> Self {
        let cells = zone.cells_w as usize * zone.cells_h as usize;
        let soil_kind = zone.map.ground_legend.iter().position(|g| g == "soil");
        let w = zone.map.width as usize;
        let soil = zone
            .map
            .ground
            .iter()
            .enumerate()
            .filter(|(_, g)| Some(**g as usize) == soil_kind)
            .map(|(i, _)| ((i % w) as u16, (i / w) as u16))
            .collect();
        let ball = zone.pitch.as_ref().map(play::Ball::new);
        Instance {
            grid: zone.grid.clone(),
            zone,
            number,
            clock: Clock(Instant::now()),
            stats: Arc::new(InstanceStats::default()),
            next_id: 1,
            avatars: HashMap::new(),
            by_conn: HashMap::new(),
            by_player: HashMap::new(),
            members: vec![Vec::new(); cells],
            watchers: vec![Vec::new(); cells],
            seat_occupant: HashMap::new(),
            games: HashMap::new(),
            elders: HashMap::new(),
            ball,
            activity_left: Vec::new(),
            next_activity_report: ACTIVITY_EVERY_MS,
            screen_index: None,
            owner,
            economy,
            social,
            self_tx: None,
            key_prefix: format!("{:016x}", rand::rng().random::<u64>()),
            key_seq: 0,
            soil,
            plots: HashMap::new(),
            objects: HashMap::new(),
            busy: HashSet::new(),
            next_garden_tick: 0,
        }
    }

    pub fn spawn(
        zone: Arc<ZoneDef>,
        number: u16,
        owner: Option<String>,
        economy: Option<Arc<EconomyClient>>,
        social: Option<Arc<SocialClient>>,
    ) -> InstanceHandle {
        let (tx, rx) = mpsc::channel(INBOX);
        let mut inst = Instance::new(zone, number, owner, economy, social);
        inst.self_tx = Some(tx.downgrade());
        let (clock, stats) = (inst.clock, inst.stats.clone());
        tracing::info!(zone = %inst.zone.id, instance = number, owner = ?inst.owner, "instance started");
        inst.load_persistent();
        tokio::spawn(inst.run(rx));
        InstanceHandle { tx, clock, stats }
    }

    /// Runs `work` off the actor and applies its result inside it.
    fn spawn_call<F, T>(&self, work: F, then: impl FnOnce(&mut Instance, T) + Send + 'static)
    where
        F: std::future::Future<Output = T> + Send + 'static,
        T: Send + 'static,
    {
        let Some(tx) = self.self_tx.as_ref().and_then(|w| w.upgrade()) else {
            return;
        };
        tokio::spawn(async move {
            let out = work.await;
            let _ = tx
                .send(Cmd::Call(Box::new(move |inst: &mut Instance| {
                    then(inst, out)
                })))
                .await;
        });
    }

    /// A fresh idempotency key for an economy call.
    fn next_key(&mut self, kind: &str) -> String {
        self.key_seq += 1;
        format!("{kind}:{}:{}", self.key_prefix, self.key_seq)
    }

    /// Reports each player's time present and interactions since the last
    /// report (for activity days, spec §10.2). Bots aren't accounts and are
    /// left out.
    fn report_activity(&mut self, now: u32) {
        let rows = self.take_activity(now);
        if let (Some(econ), false) = (&self.economy, rows.is_empty()) {
            econ.report_activity(rows);
        }
    }

    /// Activity since the last report: (player, seconds, interactions).
    fn take_activity(&mut self, now: u32) -> Vec<(String, u32, u32)> {
        let mut rows = std::mem::take(&mut self.activity_left);
        for a in self.avatars.values_mut() {
            rows.push((
                a.player_id.clone(),
                now.saturating_sub(a.counted_until) / 1000,
                a.interactions,
            ));
            a.counted_until = now;
            a.interactions = 0;
        }
        rows.retain(|(p, secs, n)| crate::social::is_account(p) && (*secs > 0 || *n > 0));
        rows
    }

    fn report_presence(&self, player: &str, present: bool) {
        if let Some(social) = &self.social {
            social.report(Presence {
                player,
                zone: &self.zone.id,
                zone_name: &self.zone.map.name,
                instance: self.number,
                owner: self.owner.as_deref(),
                present,
                at_ms: now_ms(),
            });
        }
    }

    /// Loads garden plots and (for homes) furniture from the economy service.
    fn load_persistent(&self) {
        self.load_plots();
        self.load_home();
    }

    async fn run(mut self, mut rx: mpsc::Receiver<Cmd>) {
        let mut tick = tokio::time::interval(TICK);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let labels = [
            ("zone", self.zone.id.clone()),
            ("instance", self.number.to_string()),
        ];
        let tick_hist = metrics::histogram!("zone_tick_seconds", &labels);
        let pop_gauge = metrics::gauge!("zone_instance_population", &labels);
        let bytes_ctr = metrics::counter!("zone_bytes_out_total", &labels);
        loop {
            tick.tick().await;
            let start = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(cmd) => self.handle(cmd),
                    Err(mpsc::error::TryRecvError::Empty) => break,
                    Err(mpsc::error::TryRecvError::Disconnected) => return,
                }
            }
            let now = self.clock.now_ms();
            self.step(now);
            self.elder_tick(now);
            self.ball_tick(now);
            if now >= self.next_activity_report {
                self.next_activity_report = now + ACTIVITY_EVERY_MS;
                self.report_activity(now);
            }
            self.screen_tick(now);
            self.fish_tick(now);
            self.garden_tick(now);
            let bytes = self.flush();
            let elapsed = start.elapsed();
            self.stats.record_tick(elapsed);
            tick_hist.record(elapsed.as_secs_f64());
            pop_gauge.set(self.avatars.len() as f64);
            bytes_ctr.increment(bytes);
        }
    }

    fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Join {
                conn,
                claims,
                view,
                out,
            } => self.join(conn, claims, view, out),
            Cmd::Leave { conn } => {
                if let Some(id) = self.by_conn.get(&conn).copied() {
                    self.remove(id);
                }
            }
            Cmd::Msg { conn, msg } => {
                if let Some(id) = self.by_conn.get(&conn).copied() {
                    self.on_message(id, msg);
                }
            }
            Cmd::Call(f) => f(self),
        }
    }

    // ---- helpers -------------------------------------------------------

    fn cell_of(&self, t: TilePos) -> u16 {
        (t.1 / CELL_TILES) * self.zone.cells_w + t.0 / CELL_TILES
    }

    /// Cells overlapping the viewport centred on `t`, plus a one-cell margin.
    fn desired_subs(&self, t: TilePos, view: (u8, u8)) -> Vec<u16> {
        let (cw, ch) = (self.zone.cells_w as i32, self.zone.cells_h as i32);
        let cell = CELL_TILES as i32;
        let (hw, hh) = (view.0 as i32 / 2 + 1, view.1 as i32 / 2 + 1);
        let x0 = ((t.0 as i32 - hw).max(0) / cell - 1).max(0);
        let x1 = ((t.0 as i32 + hw) / cell + 1).min(cw - 1);
        let y0 = ((t.1 as i32 - hh).max(0) / cell - 1).max(0);
        let y1 = ((t.1 as i32 + hh) / cell + 1).min(ch - 1);
        let mut out = Vec::with_capacity(((x1 - x0 + 1) * (y1 - y0 + 1)) as usize);
        for cy in y0..=y1 {
            for cx in x0..=x1 {
                out.push((cy * cw + cx) as u16);
            }
        }
        out
    }

    fn moving(&self, id: u32, now: u32) -> bool {
        self.avatars[&id]
            .motion
            .as_ref()
            .is_some_and(|m| !m.is_done(now))
    }

    /// Tells a player what they received (and new totals) after an economy call.
    fn send_granted(&mut self, id: u32, applied: &crate::econ::Applied) {
        let msgs: Vec<ServerMsg> = applied
            .totals
            .iter()
            .map(|&(item, total)| {
                let added = applied
                    .added
                    .iter()
                    .find(|(i, _)| *i == item)
                    .map_or(0, |(_, n)| *n);
                ServerMsg::Granted {
                    item: item as u32,
                    added: added.clamp(0, u16::MAX as i32) as u16,
                    total: total.max(0) as u32,
                    first: applied.firsts.contains(&item),
                }
            })
            .collect();
        for m in msgs {
            self.send_to(id, &m);
        }
    }

    fn send_to(&mut self, id: u32, msg: &ServerMsg) {
        if let Some(a) = self.avatars.get_mut(&id) {
            a.send(&msg.to_bytes());
        }
    }

    fn error(&mut self, id: u32, code: u16, message: &str) {
        self.send_to(
            id,
            &ServerMsg::Error {
                code,
                message: message.into(),
            },
        );
    }

    /// Sends to everyone watching `cell`, optionally skipping one avatar.
    fn broadcast(&mut self, cell: u16, msg: &ServerMsg, except: Option<u32>) {
        let bytes = msg.to_bytes();
        for w in &self.watchers[cell as usize] {
            if Some(*w) != except
                && let Some(a) = self.avatars.get_mut(w)
            {
                a.send(&bytes);
            }
        }
    }

    // ---- lifecycle -----------------------------------------------------

    fn join(&mut self, conn: ConnId, claims: JoinClaims, view: (u8, u8), out: mpsc::Sender<Bytes>) {
        // One presence per player: a new connection replaces the old one.
        if let Some(old) = self.by_player.get(&claims.sub).copied() {
            if let Some(a) = self.avatars.get(&old) {
                let mut frame = Vec::new();
                let msg = ServerMsg::Error {
                    code: error_code::REPLACED,
                    message: "signed in elsewhere".into(),
                };
                push_framed(&mut frame, &msg.to_bytes());
                let _ = a.tx.try_send(Bytes::from(frame));
            }
            self.remove(old);
        }

        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        let spawn = &self.zone.map.spawn;
        let mut rng = rand::rng();
        let jitter = (
            (spawn.x as i32 + rng.random_range(-3..=3)).clamp(0, self.grid.w as i32 - 1) as u16,
            (spawn.y as i32 + rng.random_range(-2..=2)).clamp(0, self.grid.h as i32 - 1) as u16,
        );
        let tile = self
            .grid
            .nearest_walkable(jitter, 8)
            .unwrap_or((spawn.x, spawn.y));
        let cell = self.cell_of(tile);
        let now = self.clock.now_ms();

        let mut avatar = Avatar {
            id,
            conn,
            player_id: claims.sub.clone(),
            name: claims.name,
            look: claims.look,
            tile,
            motion: None,
            cell,
            subs: Vec::new(),
            view: (view.0.clamp(1, MAX_VIEW_W), view.1.clamp(1, MAX_VIEW_H)),
            state: state::IDLE,
            out: Vec::with_capacity(4096),
            tx: out,
            move_rl: Bucket::new(10.0, 5.0),
            chat_rl: Bucket::new(3.0, 0.5),
            emote_rl: Bucket::new(3.0, 1.0),
            game_rl: Bucket::new(5.0, 2.0),
            play_rl: Bucket::new(24.0, 12.0),
            seat: None,
            stand_tile: tile,
            pending: None,
            fish: None,
            muted_until: claims.muted_until,
            counted_until: now,
            interactions: 0,
        };
        avatar.send(
            &ServerMsg::Welcome {
                zone: self.zone.id.clone(),
                instance: self.number,
                self_id: id,
                server_t: now,
            }
            .to_bytes(),
        );
        let spawn_msg = ServerMsg::Spawn {
            entity: avatar.info(now),
        };
        self.avatars.insert(id, avatar);
        self.by_conn.insert(conn, id);
        self.by_player.insert(claims.sub, id);
        self.members[cell as usize].push(id);
        self.broadcast(cell, &spawn_msg, Some(id));
        self.update_subs(id, now);
        let player = self.avatars[&id].player_id.clone();
        self.report_presence(&player, true);
        if let Some(msg) = self.screen_state(now) {
            self.send_to(id, &msg);
        }
        self.stats
            .population
            .store(self.avatars.len() as u32, Ordering::Relaxed);
    }

    fn remove(&mut self, id: u32) {
        self.leave_seat(id);
        self.stop_fishing(id, false);
        let Some(a) = self.avatars.remove(&id) else {
            return;
        };
        let now = self.clock.now_ms();
        self.activity_left.push((
            a.player_id.clone(),
            now.saturating_sub(a.counted_until) / 1000,
            a.interactions,
        ));
        self.by_conn.remove(&a.conn);
        if self.by_player.get(&a.player_id) == Some(&id) {
            self.by_player.remove(&a.player_id);
        }
        self.members[a.cell as usize].retain(|&m| m != id);
        for c in &a.subs {
            self.watchers[*c as usize].retain(|&w| w != id);
        }
        self.broadcast(a.cell, &ServerMsg::Despawn { id }, None);
        self.report_presence(&a.player_id, false);
        self.stats
            .population
            .store(self.avatars.len() as u32, Ordering::Relaxed);
        // Dropping `a.tx` closes the connection's outbound channel, which ends the session.
    }

    // ---- client messages -------------------------------------------------

    fn on_message(&mut self, id: u32, msg: ClientMsg) {
        let now = self.clock.now_ms();
        if matches!(
            msg,
            ClientMsg::ChatSay { .. }
                | ClientMsg::GameMove { .. }
                | ClientMsg::FishCast { .. }
                | ClientMsg::PlotAction { .. }
                | ClientMsg::Place { .. }
                | ClientMsg::JamNote { .. }
                | ClientMsg::Paint { .. }
        ) && let Some(a) = self.avatars.get_mut(&id)
        {
            a.interactions = (a.interactions + 1).min(MAX_INTERACTIONS_PER_REPORT);
        }
        match msg {
            ClientMsg::MoveTo { x, y } => self.move_to(id, (x, y), now),
            ClientMsg::Emote { emote: e } => {
                let a = self.avatars.get_mut(&id).unwrap();
                if !(1..=emote::MAX).contains(&e) || !a.emote_rl.try_take(now as u64) {
                    return;
                }
                let cell = a.cell;
                self.broadcast(cell, &ServerMsg::EmoteShown { id, emote: e }, None);
            }
            ClientMsg::ChatSay { text } => self.chat(id, &text, now),
            ClientMsg::Ping { client_t } => {
                self.send_to(
                    id,
                    &ServerMsg::Pong {
                        client_t,
                        server_t: now,
                    },
                );
            }
            ClientMsg::Sit { seat } => self.sit(id, seat, now),
            ClientMsg::Stand {} => self.stand(id, now),
            ClientMsg::GameMove { table, uci } => self.game_move(id, table, &uci, now),
            ClientMsg::FishCast { x, y } => self.fish_cast(id, (x, y), now),
            ClientMsg::FishReel { quality } => self.fish_reel(id, quality, now),
            ClientMsg::PlotAction { x, y, action, item } => {
                self.plot_action(id, (x, y), action, item, now)
            }
            ClientMsg::Place { item, x, y } => self.place(id, item, (x, y)),
            ClientMsg::Pickup { x, y } => self.pickup(id, (x, y)),
            ClientMsg::JamNote {
                instrument,
                pitch,
                beat,
            } => self.jam_note(id, instrument, pitch, beat, now),
            ClientMsg::Paint { easel, cell, color } => self.paint(id, easel, cell, color, now),
            ClientMsg::Hello { .. } => self.error(id, error_code::BAD_MESSAGE, "already joined"),
        }
    }

    fn move_to(&mut self, id: u32, target: TilePos, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.move_rl.try_take(now as u64) {
            return;
        }
        a.pending = None;
        match a.state {
            state::SITTING => self.stand(id, now),
            state::FISHING => self.stop_fishing(id, false),
            _ => {}
        }
        let grid = &self.grid;
        let a = self.avatars.get_mut(&id).unwrap();
        // Mid-walk, continue through the tile being walked into so the new path
        // joins the old one without a seam. Otherwise start shortly in the future
        // so observers receive the MoveStart before the walk begins.
        let (prefix, start, t0) = match a.motion.as_ref().and_then(|m| m.splice(now)) {
            Some((prev, next, t_prev)) => (Some(prev), next, t_prev),
            None => {
                let from = match &a.motion {
                    Some(m) if !m.is_done(now) => m.path[0],
                    _ => a.tile,
                };
                (None, from, now + MOVE_LEAD_MS)
            }
        };
        let Some(mut full) = find_path(grid, start, target, MAX_PATH_EXPANSIONS) else {
            self.error(id, error_code::NO_PATH, "can't get there");
            return;
        };
        if let Some(prev) = prefix {
            full.insert(0, prev);
        }
        if full.len() < 2 {
            return;
        }
        let motion = Motion {
            path: compress(&full),
            t0,
            speed_x10: WALK_SPEED_X10,
        };
        let msg = ServerMsg::MoveStart {
            id,
            speed_x10: motion.speed_x10,
            t0: motion.t0,
            path: motion.path.iter().map(|&(x, y)| Tile { x, y }).collect(),
        };
        a.motion = Some(motion);
        let cell = a.cell;
        self.broadcast(cell, &msg, None);
    }

    fn chat(&mut self, id: u32, text: &str, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if a.muted_until > now_ms().max(0) as u64 / 1000 {
            self.error(
                id,
                error_code::NOT_ALLOWED,
                "you're muted for a little while",
            );
            return;
        }
        if !a.chat_rl.try_take(now as u64) {
            self.error(id, error_code::RATE_LIMITED, "slow down a little");
            return;
        }
        let Some(text) = clean_chat(text) else { return };
        let origin = a.tile;
        let bytes = ServerMsg::ChatBubble { id, text }.to_bytes();
        // Everyone within CHAT_RADIUS tiles, found through the cells around the speaker.
        let (cw, ch) = (self.zone.cells_w as i32, self.zone.cells_h as i32);
        let cell = CELL_TILES as i32;
        let cx0 = ((origin.0 as i32 - CHAT_RADIUS).max(0) / cell).min(cw - 1);
        let cx1 = ((origin.0 as i32 + CHAT_RADIUS) / cell).min(cw - 1);
        let cy0 = ((origin.1 as i32 - CHAT_RADIUS).max(0) / cell).min(ch - 1);
        let cy1 = ((origin.1 as i32 + CHAT_RADIUS) / cell).min(ch - 1);
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                for m in &self.members[(cy * cw + cx) as usize] {
                    let Some(listener) = self.avatars.get_mut(m) else {
                        continue;
                    };
                    let dx = listener.tile.0 as i32 - origin.0 as i32;
                    let dy = listener.tile.1 as i32 - origin.1 as i32;
                    if dx * dx + dy * dy <= CHAT_RADIUS * CHAT_RADIUS {
                        listener.send(&bytes);
                    }
                }
            }
        }
    }

    // ---- simulation ------------------------------------------------------

    /// Advances walking avatars and applies cell membership changes.
    fn step(&mut self, now: u32) {
        let moving: Vec<u32> = self
            .avatars
            .values()
            .filter(|a| a.motion.is_some())
            .map(|a| a.id)
            .collect();
        for id in moving {
            let a = self.avatars.get_mut(&id).unwrap();
            let m = a.motion.as_ref().unwrap();
            let tile = m.tile_at(now);
            let arrived = m.is_done(now);
            if arrived {
                a.motion = None;
            }
            if tile != a.tile {
                a.tile = tile;
                self.on_tile_changed(id, now);
            }
            if arrived && let Some(p) = self.avatars.get_mut(&id).unwrap().pending.take() {
                match p {
                    Pending::Sit(seat) => self.try_sit(id, seat, now),
                    Pending::Plot { x, y, action, item } => {
                        self.do_plot_action(id, (x, y), action, item)
                    }
                    Pending::Cast { x, y } => self.do_cast(id, (x, y), now),
                }
            }
        }
    }

    fn on_tile_changed(&mut self, id: u32, now: u32) {
        let (tile, old_cell) = {
            let a = &self.avatars[&id];
            (a.tile, a.cell)
        };
        let new_cell = self.cell_of(tile);
        if new_cell != old_cell {
            self.change_cell(id, old_cell, new_cell, now);
        }
        self.update_subs(id, now);
    }

    fn change_cell(&mut self, id: u32, old: u16, new: u16, now: u32) {
        let info = {
            let a = self.avatars.get_mut(&id).unwrap();
            a.cell = new;
            a.info(now)
        };
        self.members[old as usize].retain(|&m| m != id);
        self.members[new as usize].push(id);

        let despawn = ServerMsg::Despawn { id }.to_bytes();
        let spawn = ServerMsg::Spawn { entity: info }.to_bytes();
        // Watchers of the old cell that can't see the new one lose the avatar…
        for w in &self.watchers[old as usize] {
            if *w == id {
                continue;
            }
            let wa = self.avatars.get_mut(w).unwrap();
            if wa.subs.binary_search(&new).is_err() {
                wa.send(&despawn);
            }
        }
        // …and watchers of the new cell that couldn't see the old one gain it.
        for w in &self.watchers[new as usize] {
            if *w == id {
                continue;
            }
            let wa = self.avatars.get_mut(w).unwrap();
            if wa.subs.binary_search(&old).is_err() {
                wa.send(&spawn);
            }
        }
    }

    /// Re-derives an avatar's watched cells from its position and sends the
    /// resulting CellEnter / CellLeave messages to it.
    fn update_subs(&mut self, id: u32, now: u32) {
        let (desired, current) = {
            let a = &self.avatars[&id];
            (self.desired_subs(a.tile, a.view), a.subs.clone())
        };
        if desired == current {
            return;
        }
        let mut out = Vec::new();
        for &c in current.iter().filter(|c| desired.binary_search(c).is_err()) {
            self.watchers[c as usize].retain(|&w| w != id);
            let ids: Vec<u32> = self.members[c as usize]
                .iter()
                .copied()
                .filter(|&m| m != id)
                .collect();
            out.push(ServerMsg::CellLeave { cell: c, ids }.to_bytes());
        }
        for &c in desired.iter().filter(|c| current.binary_search(c).is_err()) {
            self.watchers[c as usize].push(id);
            let infos: Vec<EntityInfo> = self.members[c as usize]
                .iter()
                .map(|m| self.avatars[m].info(now))
                .collect();
            if infos.is_empty() {
                out.push(
                    ServerMsg::CellEnter {
                        cell: c,
                        entities: Vec::new(),
                    }
                    .to_bytes(),
                );
            }
            for chunk in infos.chunks(CELL_ENTER_CHUNK) {
                out.push(
                    ServerMsg::CellEnter {
                        cell: c,
                        entities: chunk.to_vec(),
                    }
                    .to_bytes(),
                );
            }
        }
        for &c in desired.iter().filter(|c| current.binary_search(c).is_err()) {
            out.extend(self.games_in_cell(c).iter().map(|m| m.to_bytes()));
            out.extend(self.ball_in_cell(c).iter().map(|m| m.to_bytes()));
            out.extend(self.plots_in_cell(c, now_ms()).iter().map(|m| m.to_bytes()));
            out.extend(self.objects_in_cell(c).iter().map(|m| m.to_bytes()));
        }
        let a = self.avatars.get_mut(&id).unwrap();
        a.subs = desired;
        for m in out {
            a.send(&m);
        }
    }

    /// Sends each client its batched frame for this tick. Returns bytes sent.
    fn flush(&mut self) -> u64 {
        let mut total = 0u64;
        let mut frames = 0u64;
        let mut kick = Vec::new();
        for a in self.avatars.values_mut() {
            if a.out.is_empty() {
                continue;
            }
            if a.out.len() > MAX_PENDING_OUT {
                kick.push(a.id);
                continue;
            }
            let frame = Bytes::from(std::mem::replace(&mut a.out, Vec::with_capacity(1024)));
            let len = frame.len() as u64;
            match a.tx.try_send(frame) {
                Ok(()) => {
                    total += len;
                    frames += 1;
                }
                Err(mpsc::error::TrySendError::Full(_)) => {
                    tracing::warn!(id = a.id, "slow consumer, disconnecting");
                    kick.push(a.id);
                }
                Err(mpsc::error::TrySendError::Closed(_)) => kick.push(a.id),
            }
        }
        for id in kick {
            self.remove(id);
        }
        self.stats.bytes_out.fetch_add(total, Ordering::Relaxed);
        self.stats.frames_out.fetch_add(frames, Ordering::Relaxed);
        total
    }
}

/// Wall-clock unix milliseconds (garden growth runs on real days).
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use commons_common::token::TrustTier;
    use commons_protocol::split_frame;
    use commons_sim::MapFile;
    use commons_sim::map::Spawn;

    fn map(w: u16, h: u16) -> MapFile {
        let n = w as usize * h as usize;
        MapFile {
            name: "test".into(),
            width: w,
            height: h,
            spawn: Spawn { x: 8, y: 8 },
            ground_legend: vec!["grass".into()],
            decor_legend: vec!["none".into(), "bench".into(), "chess_table".into()],
            ground: vec![0; n],
            decor: vec![0; n],
            collision: vec![0; n],
            objects: vec![],
        }
    }

    fn instance_for(zone: Arc<ZoneDef>) -> Instance {
        Instance::new(zone, 1, None, None, None)
    }

    /// 16×16 park with one chess table at (5,5) and its benches at (4,5) and (6,5).
    pub(crate) fn chess_instance() -> Instance {
        let mut m = map(16, 16);
        for (x, d) in [(4u16, 1u8), (5, 2), (6, 1)] {
            let i = 5 * 16 + x as usize;
            m.decor[i] = d;
            m.collision[i] = 1;
        }
        instance_for(Arc::new(ZoneDef::new("test".into(), m, None)))
    }

    /// 16×16 meadow: water from row 6 down, soil plots at (2..=5, 2), and a
    /// preloaded fish catalogue.
    pub(crate) fn pond_instance() -> Instance {
        let mut m = map(16, 16);
        m.ground_legend = vec!["grass".into(), "water".into(), "soil".into()];
        for y in 6..16usize {
            for x in 0..16usize {
                m.ground[y * 16 + x] = 1;
                m.collision[y * 16 + x] = 1;
            }
        }
        for x in 2..=5usize {
            m.ground[2 * 16 + x] = 2;
        }
        let econ = crate::econ::EconomyClient::with_catalog(crate::econ::ZoneCatalog::for_tests());
        Instance::new(
            Arc::new(ZoneDef::new("test".into(), m, None)),
            1,
            None,
            Some(econ),
            None,
        )
    }

    /// 40×40 park with a pitch (x 10..=25, y 10..=20) and goals at both
    /// ends (mouth y 14..17), a bandstand at (0,0) and three easels at (4,0).
    pub(crate) fn pitch_instance() -> Instance {
        use commons_sim::map::MapObject;
        let mut m = map(40, 40);
        m.ground_legend = vec!["grass".into(), "pitch".into()];
        for y in 10..=20usize {
            for x in 10..=25usize {
                m.ground[y * 40 + x] = 1;
            }
        }
        let obj = |kind: &str, x: u16, y: u16, w: u16, h: u16| MapObject {
            kind: kind.into(),
            x,
            y,
            w,
            h,
            label: None,
        };
        m.objects = vec![
            obj("goal", 10, 14, 1, 3),
            obj("goal", 25, 14, 1, 3),
            obj("bandstand", 0, 0, 3, 1),
            obj("easels", 4, 0, 3, 1),
        ];
        for (x, y0) in [(10usize, 14usize), (25, 14)] {
            for y in y0..y0 + 3 {
                m.collision[y * 40 + x] = 1;
            }
        }
        instance_for(Arc::new(ZoneDef::new("test".into(), m, None)))
    }

    /// Teleports an idle avatar (test setup only).
    pub(crate) fn place(inst: &mut Instance, id: u32, tile: TilePos) {
        inst.avatars.get_mut(&id).unwrap().tile = tile;
        let now = inst.clock.now_ms();
        inst.on_tile_changed(id, now);
    }

    fn zone() -> Arc<ZoneDef> {
        let (w, h) = (64u16, 64u16);
        let n = w as usize * h as usize;
        let map = MapFile {
            name: "test".into(),
            width: w,
            height: h,
            spawn: Spawn { x: 8, y: 8 },
            ground_legend: vec!["grass".into()],
            decor_legend: vec!["none".into()],
            ground: vec![0; n],
            decor: vec![0; n],
            collision: vec![0; n],
            objects: vec![],
        };
        Arc::new(ZoneDef::new("test".into(), map, None))
    }

    fn instance() -> Instance {
        instance_for(zone())
    }

    fn claims(name: &str) -> JoinClaims {
        JoinClaims {
            sub: name.into(),
            name: name.into(),
            look: 0,
            tier: TrustTier::Visitor,
            minor: false,
            zone: "test".into(),
            instance: 1,
            owner: None,
            muted_until: 0,
        }
    }

    pub(crate) struct Client {
        rx: mpsc::Receiver<Bytes>,
        pub(crate) known: std::collections::HashSet<u32>,
        pub(crate) log: Vec<ServerMsg>,
    }

    impl Client {
        /// Applies received messages to a client-side entity set, like the real client.
        pub(crate) fn pump(&mut self) {
            while let Ok(frame) = self.rx.try_recv() {
                for m in split_frame(&frame) {
                    let msg = ServerMsg::decode(m.unwrap()).unwrap();
                    match &msg {
                        ServerMsg::CellEnter { entities, .. } => {
                            self.known.extend(entities.iter().map(|e| e.id))
                        }
                        ServerMsg::Spawn { entity } => {
                            self.known.insert(entity.id);
                        }
                        ServerMsg::CellLeave { ids, .. } => ids.iter().for_each(|i| {
                            self.known.remove(i);
                        }),
                        ServerMsg::Despawn { id } => {
                            self.known.remove(id);
                        }
                        _ => {}
                    }
                    self.log.push(msg);
                }
            }
        }
    }

    pub(crate) fn connect(inst: &mut Instance, conn: ConnId, name: &str, view: (u8, u8)) -> Client {
        let (tx, rx) = mpsc::channel(1024);
        inst.handle(Cmd::Join {
            conn,
            claims: claims(name),
            view,
            out: tx,
        });
        Client {
            rx,
            known: Default::default(),
            log: vec![],
        }
    }

    /// The set of avatars the server believes a client can see.
    fn expected(inst: &Instance, id: u32) -> std::collections::HashSet<u32> {
        inst.avatars[&id]
            .subs
            .iter()
            .flat_map(|c| inst.members[*c as usize].iter().copied())
            .collect()
    }

    #[test]
    fn join_sees_self_and_neighbours() {
        let mut inst = instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        inst.flush();
        a.pump();
        b.pump();
        assert!(matches!(a.log[0], ServerMsg::Welcome { self_id: 1, .. }));
        assert_eq!(a.known, [1, 2].into());
        assert_eq!(b.known, [1, 2].into());
    }

    #[test]
    fn interest_sets_stay_consistent_while_walking() {
        let mut inst = instance();
        let mut clients: Vec<Client> = (0..6)
            .map(|i| connect(&mut inst, i as u64 + 1, &format!("p{i}"), (12, 10)))
            .collect();
        let targets = [(60, 60), (2, 60), (60, 2), (30, 30), (5, 5), (45, 10)];
        for (i, t) in targets.iter().enumerate() {
            inst.handle(Cmd::Msg {
                conn: i as u64 + 1,
                msg: ClientMsg::MoveTo { x: t.0, y: t.1 },
            });
        }
        // Simulate 25 seconds of ticks with a synthetic clock.
        let mut now = inst.clock.now_ms();
        for _ in 0..250 {
            now += 100;
            inst.step(now);
            inst.flush();
            for (i, c) in clients.iter_mut().enumerate() {
                c.pump();
                assert_eq!(
                    c.known,
                    expected(&inst, i as u32 + 1),
                    "client {i} diverged at t={now}"
                );
            }
        }
        for (i, t) in targets.iter().enumerate() {
            assert_eq!(inst.avatars[&(i as u32 + 1)].tile, *t);
        }
    }

    #[test]
    fn muted_players_cant_chat_and_activity_is_counted_for_accounts() {
        let mut inst = instance();
        let account = "99083e44-0c20-4878-982a-065ea718d9e4";
        let mut claims = claims(account);
        claims.muted_until = (now_ms() / 1000) as u64 + 3600;
        let (tx, mut rx) = mpsc::channel(256);
        inst.handle(Cmd::Join {
            conn: 1,
            claims,
            view: (20, 12),
            out: tx,
        });
        let mut b = connect(&mut inst, 2, "bot-7", (20, 12));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::ChatSay {
                text: "hello".into(),
            },
        });
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::ChatSay { text: "hi".into() },
        });
        inst.flush();
        let mut muted = false;
        while let Ok(frame) = rx.try_recv() {
            for m in split_frame(&frame) {
                if let Ok(ServerMsg::Error { code, .. }) = ServerMsg::decode(m.unwrap()) {
                    muted |= code == error_code::NOT_ALLOWED;
                }
            }
        }
        assert!(muted, "the muted player is told");
        b.pump();
        assert!(
            !b.log
                .iter()
                .any(|m| matches!(m, ServerMsg::ChatBubble { text, .. } if text == "hello"))
        );

        // A minute later: the account's time and interaction are reported;
        // the bot isn't.
        let now = inst.clock.now_ms() + 60_000;
        let rows = inst.take_activity(now);
        assert_eq!(rows.len(), 1, "{rows:?}");
        assert_eq!(rows[0].0, account);
        assert!(rows[0].1 >= 59 && rows[0].2 == 1, "{rows:?}");
        assert!(inst.take_activity(now).is_empty(), "nothing twice");
    }

    #[test]
    fn chat_is_proximity_limited_and_filtered() {
        let mut inst = instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        let mut far = connect(&mut inst, 3, "far", (20, 12));
        inst.avatars.get_mut(&3).unwrap().tile = (40, 40);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::ChatSay {
                text: "hello  shit".into(),
            },
        });
        inst.flush();
        for c in [&mut a, &mut b, &mut far] {
            c.pump();
        }
        let bubble = |c: &Client| {
            c.log.iter().find_map(|m| match m {
                ServerMsg::ChatBubble { text, .. } => Some(text.clone()),
                _ => None,
            })
        };
        assert_eq!(bubble(&a).as_deref(), Some("hello ****"));
        assert_eq!(bubble(&b).as_deref(), Some("hello ****"));
        assert_eq!(bubble(&far), None);
    }

    #[test]
    fn unreachable_target_is_rejected() {
        let mut inst = instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        inst.grid.set_blocked(20, 20, true);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo { x: 20, y: 20 },
        });
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::Error {
                code: error_code::NO_PATH,
                ..
            }
        )));
        assert!(inst.avatars[&1].motion.is_none());
    }

    #[test]
    fn rejoin_replaces_old_presence() {
        let mut inst = instance();
        let _a1 = connect(&mut inst, 1, "a", (20, 12));
        let _a2 = connect(&mut inst, 2, "a", (20, 12));
        assert_eq!(inst.avatars.len(), 1);
        assert_eq!(inst.by_conn.get(&2), Some(&2));
        assert!(!inst.by_conn.contains_key(&1));
    }
}
