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

use crate::registry::ZoneDef;
use crate::stats::InstanceStats;
use bytes::Bytes;
use commons_common::filter::clean_chat;
use commons_common::ratelimit::Bucket;
use commons_common::token::JoinClaims;
use commons_protocol::{
    CELL_TILES, ClientMsg, EntityInfo, ServerMsg, Tile, emote, error_code, push_framed, state,
};
use commons_sim::{Motion, TilePos, WALK_SPEED_X10, compress, find_path};
use rand::Rng;
use std::collections::HashMap;
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
const MAX_PATH_EXPANSIONS: usize = 8_000;
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
}

impl Instance {
    pub fn spawn(zone: Arc<ZoneDef>, number: u16) -> InstanceHandle {
        let (tx, rx) = mpsc::channel(INBOX);
        let clock = Clock(Instant::now());
        let stats = Arc::new(InstanceStats::default());
        let cells = zone.cells_w as usize * zone.cells_h as usize;
        let inst = Instance {
            zone,
            number,
            clock,
            stats: stats.clone(),
            next_id: 1,
            avatars: HashMap::new(),
            by_conn: HashMap::new(),
            by_player: HashMap::new(),
            members: vec![Vec::new(); cells],
            watchers: vec![Vec::new(); cells],
        };
        tracing::info!(zone = %inst.zone.id, instance = number, "instance started");
        tokio::spawn(inst.run(rx));
        InstanceHandle { tx, clock, stats }
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
            (spawn.x as i32 + rng.random_range(-3..=3)).clamp(0, self.zone.grid.w as i32 - 1)
                as u16,
            (spawn.y as i32 + rng.random_range(-2..=2)).clamp(0, self.zone.grid.h as i32 - 1)
                as u16,
        );
        let tile = self
            .zone
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
        self.stats
            .population
            .store(self.avatars.len() as u32, Ordering::Relaxed);
    }

    fn remove(&mut self, id: u32) {
        let Some(a) = self.avatars.remove(&id) else {
            return;
        };
        self.by_conn.remove(&a.conn);
        if self.by_player.get(&a.player_id) == Some(&id) {
            self.by_player.remove(&a.player_id);
        }
        self.members[a.cell as usize].retain(|&m| m != id);
        for c in &a.subs {
            self.watchers[*c as usize].retain(|&w| w != id);
        }
        self.broadcast(a.cell, &ServerMsg::Despawn { id }, None);
        self.stats
            .population
            .store(self.avatars.len() as u32, Ordering::Relaxed);
        // Dropping `a.tx` closes the connection's outbound channel, which ends the session.
    }

    // ---- client messages -------------------------------------------------

    fn on_message(&mut self, id: u32, msg: ClientMsg) {
        let now = self.clock.now_ms();
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
            ClientMsg::Hello { .. } => self.error(id, error_code::BAD_MESSAGE, "already joined"),
        }
    }

    fn move_to(&mut self, id: u32, target: TilePos, now: u32) {
        let grid = &self.zone.grid;
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.move_rl.try_take(now as u64) {
            return;
        }
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
            if m.is_done(now) {
                a.motion = None;
            }
            if tile != a.tile {
                a.tile = tile;
                self.on_tile_changed(id, now);
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

#[cfg(test)]
mod tests {
    use super::*;
    use commons_common::token::TrustTier;
    use commons_protocol::split_frame;
    use commons_sim::MapFile;
    use commons_sim::map::Spawn;

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
        Arc::new(ZoneDef::new("test".into(), map))
    }

    fn instance() -> Instance {
        let zone = zone();
        let cells = zone.cells_w as usize * zone.cells_h as usize;
        Instance {
            zone,
            number: 1,
            clock: Clock(Instant::now()),
            stats: Arc::new(InstanceStats::default()),
            next_id: 1,
            avatars: HashMap::new(),
            by_conn: HashMap::new(),
            by_player: HashMap::new(),
            members: vec![Vec::new(); cells],
            watchers: vec![Vec::new(); cells],
        }
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
        }
    }

    struct Client {
        rx: mpsc::Receiver<Bytes>,
        known: std::collections::HashSet<u32>,
        log: Vec<ServerMsg>,
    }

    impl Client {
        /// Applies received messages to a client-side entity set, like the real client.
        fn pump(&mut self) {
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

    fn connect(inst: &mut Instance, conn: ConnId, name: &str, view: (u8, u8)) -> Client {
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
        let mut grid = inst.zone.grid.clone();
        grid.set_blocked(20, 20, true);
        inst.zone = Arc::new(ZoneDef {
            grid,
            ..ZoneDef::new("test".into(), inst.zone.map.clone())
        });
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
