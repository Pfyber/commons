//! The skatepark: anyone in it can get on a board and skate, as many at once
//! as like. The skating itself (the ramps, the tricks, the score) runs on
//! each skater's own client; here each one's moves are passed on to
//! everyone who can see them, their avatar kept on the tile they're over (so
//! they're seen, and stand up there when they step off), and the day's best
//! timed runs and combos kept on the park's board. Dusty's daily quests
//! are paid from here, and 1v1s run: two skaters (or one and the park's
//! bot) paired up, started together, their scores passed between them.

use super::Instance;
use commons_common::ratelimit::Bucket;
use commons_protocol::{ServerMsg, SkateEntry, skate, skate::duel, state};
use commons_sim::TilePos;
use commons_sim::map::MapObject;
use std::collections::HashMap;

/// Moves let through: a burst this big (lag bunches them up), this many a
/// second on and on (clients send 20).
const MOVE_BURST: f32 = 40.0;
const MOVE_RATE: f32 = 30.0;
/// Off the board after this long without a move (ms): they've gone.
const IDLE_MS: u32 = 20_000;
/// How far outside the park (tiles) you may be and still get on a board.
const REACH: u16 = 2;
/// The longest name a combo is given (chars).
const LABEL_MAX: usize = 90;
/// Coins.
const COIN: u32 = 1;
/// A 1v1 not over this long after its minute's up (ms): settled on the scores in.
const DUEL_GRACE_MS: u32 = 8_000;
/// The bot's name, in a 1v1.
const BOT_NAME: &str = "Skate bot 🤖";

/// The park's bot in a 1v1: it banks a combo every few seconds, each worth
/// what a fair skater's might be, so beating it takes a good run.
#[derive(Debug, Clone)]
struct DuelBot {
    next_at: u32,
    points: u32,
    seed: u64,
    /// Grinds only: a grind every few seconds, held a while.
    grinds: bool,
}

impl DuelBot {
    fn new(start: u32, seed: u64, grinds: bool) -> DuelBot {
        let mut b = DuelBot {
            next_at: start,
            points: 0,
            seed: seed | 1,
            grinds,
        };
        b.next_at = start + 1_500 + b.roll(2_500);
        b
    }

    /// 0..n, from its own little generator (the same run for the same seed).
    fn roll(&mut self, n: u32) -> u32 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 7;
        self.seed ^= self.seed << 17;
        (self.seed % n.max(1) as u64) as u32
    }

    /// A combo banked, if it's time: its new total.
    fn tick(&mut self, now: u32, end: u32) -> Option<u32> {
        if now < self.next_at || now >= end {
            return None;
        }
        if self.grinds {
            // A grind (100), and as much again a second it's held (up to 2.5 s).
            self.points += 100 + self.roll(250);
            self.next_at = now + 2_500 + self.roll(3_500);
            return Some(self.points);
        }
        // A couple of tricks, now and then a long line.
        let tricks = 1
            + self.roll(3)
            + if self.roll(5) == 0 {
                3 + self.roll(4)
            } else {
                0
            };
        // (Each trick 60–200, the lot times how many: as a combo's worth.)
        let base = 60 + self.roll(140);
        self.points += base * tricks;
        self.next_at = now + 2_200 + self.roll(3_300);
        Some(self.points)
    }
}

/// A 1v1: who (`b` 0: the bot), when it goes (ms), their scores, whether each is in.
#[derive(Debug, Clone)]
struct Duel {
    a: u32,
    b: u32,
    start: u32,
    pts: [u32; 2],
    done: [bool; 2],
    bot: Option<DuelBot>,
}

impl Duel {
    fn side(&self, id: u32) -> Option<usize> {
        if self.a == id {
            Some(0)
        } else if self.b == id && id != 0 {
            Some(1)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone)]
struct Skater {
    last_move: u32,
    /// How their board's built (`SkateOn.kit`), passed on with their moves.
    kit: u32,
    moves: Bucket,
}

#[derive(Debug, Clone)]
struct Line {
    player: String,
    name: String,
    points: u32,
}

#[derive(Debug, Clone)]
pub(super) struct Park {
    /// The concrete (map tiles): x, y, w, h.
    area: (u16, u16, u16, u16),
    skaters: HashMap<u32, Skater>,
    runs: Vec<Line>,
    combos: Vec<Line>,
    /// The day the board is for (days since 1970); a new day, a clean board.
    day: u64,
    /// Who's looking for a 1v1 (and whether grinds only), and the 1v1s going.
    waiting: Vec<(u32, bool)>,
    duels: Vec<Duel>,
}

fn today() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

/// Puts `points` on `board` for `player` (their best only), best first.
/// Whether the board changed.
fn record(board: &mut Vec<Line>, player: &str, name: &str, points: u32) -> bool {
    if let Some(l) = board.iter_mut().find(|l| l.player == player) {
        if l.points >= points {
            return false;
        }
        l.points = points;
        l.name = name.to_string();
    } else {
        if board.len() >= skate::BOARD_LINES && board.last().is_some_and(|l| l.points >= points) {
            return false;
        }
        board.push(Line {
            player: player.to_string(),
            name: name.to_string(),
            points,
        });
    }
    board.sort_by(|a, b| b.points.cmp(&a.points));
    board.truncate(skate::BOARD_LINES);
    true
}

fn entries(board: &[Line]) -> Vec<SkateEntry> {
    board
        .iter()
        .map(|l| SkateEntry {
            name: l.name.clone(),
            points: l.points,
        })
        .collect()
}

/// A combo's name as shown to others: printable, and not too long.
fn clean_label(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .take(LABEL_MAX)
        .collect::<String>()
        .trim()
        .to_string()
}

impl Park {
    pub(super) fn new(objects: &[MapObject]) -> Option<Park> {
        let p = objects.iter().find(|o| o.kind == "sk_park")?;
        Some(Park {
            area: (p.x, p.y, p.w, p.h),
            skaters: HashMap::new(),
            runs: Vec::new(),
            combos: Vec::new(),
            day: today(),
            waiting: Vec::new(),
            duels: Vec::new(),
        })
    }

    fn near(&self, t: TilePos) -> bool {
        let (x, y, w, h) = self.area;
        t.0 + REACH >= x && t.0 < x + w + REACH && t.1 + REACH >= y && t.1 < y + h + REACH
    }

    fn board(&mut self) -> ServerMsg {
        if self.day != today() {
            self.day = today();
            self.runs.clear();
            self.combos.clear();
        }
        ServerMsg::SkateBoard {
            runs: entries(&self.runs),
            combos: entries(&self.combos),
        }
    }
}

impl Instance {
    /// Whether `id` is on a board in the skatepark (they don't walk about).
    pub(super) fn skating(&self, id: u32) -> bool {
        self.skate
            .as_ref()
            .is_some_and(|p| p.skaters.contains_key(&id))
    }

    /// The cells the park's in.
    fn park_cells(&self) -> Vec<u16> {
        let Some(p) = &self.skate else {
            return Vec::new();
        };
        let (x0, y0, w, h) = p.area;
        let mut cells = Vec::new();
        let step = commons_protocol::CELL_TILES;
        let mut y = y0;
        while y < y0 + h + step {
            let mut x = x0;
            while x < x0 + w + step {
                cells.push(self.cell_of((x.min(x0 + w - 1), y.min(y0 + h - 1))));
                x += step;
            }
            y += step;
        }
        cells.sort_unstable();
        cells.dedup();
        cells
    }

    /// To everyone who can see any of the park.
    fn park_broadcast(&mut self, msg: &ServerMsg) {
        let mut to: Vec<u32> = self
            .park_cells()
            .iter()
            .flat_map(|&c| self.watchers[c as usize].iter().copied())
            .collect();
        to.sort_unstable();
        to.dedup();
        let bytes = msg.to_bytes();
        for id in to {
            if let Some(a) = self.avatars.get_mut(&id) {
                a.send(&bytes);
            }
        }
    }

    /// A newcomer sees the park's board.
    pub(super) fn skate_hello(&mut self, id: u32) {
        let Some(p) = self.skate.as_mut() else { return };
        let msg = p.board();
        self.send_to(id, &msg);
    }

    pub(super) fn skate_on(&mut self, id: u32, on: bool, kit: u32, now: u32) {
        if !on {
            return self.skate_off(id, now);
        }
        self.skate_join(id, kit, now, false);
    }

    /// Onto a board (or, on one already, a new build). Whether they're on
    /// one now. `quiet`: not asked for (a move from someone the park had
    /// lost: back on their board, no fuss if they can't be).
    fn skate_join(&mut self, id: u32, kit: u32, now: u32, quiet: bool) -> bool {
        let Some(p) = &self.skate else { return false };
        let Some(a) = self.avatars.get(&id) else {
            return false;
        };
        let st = a.state;
        if p.skaters.contains_key(&id) {
            if let Some(s) = self.skate.as_mut().and_then(|p| p.skaters.get_mut(&id)) {
                s.kit = kit;
            }
            return true;
        }
        if !p.near(a.tile) {
            if !quiet {
                self.error(
                    id,
                    commons_protocol::error_code::BAD_MESSAGE,
                    "you need to be at the skatepark to skate",
                );
            }
            return false;
        }
        if self.aboard(id) || self.arena_fighting(id) || self.pb_playing(id) {
            return false;
        }
        match st {
            state::SITTING => self.stand(id, now),
            state::FISHING => self.stop_fishing(id, false),
            _ => {}
        }
        let Some(a) = self.avatars.get_mut(&id) else {
            return false;
        };
        a.motion = None;
        a.pending = None;
        let cell = a.cell;
        if let Some(p) = self.skate.as_mut() {
            p.skaters.insert(
                id,
                Skater {
                    last_move: now,
                    kit,
                    moves: Bucket::new(MOVE_BURST, MOVE_RATE),
                },
            );
        }
        self.broadcast(cell, &ServerMsg::Skating { id, on: true }, Some(id));
        true
    }

    /// Off the board: stood on the nearest place to stand, shown there.
    pub(super) fn skate_off(&mut self, id: u32, now: u32) {
        self.duel_quit(id);
        let Some(p) = self.skate.as_mut() else { return };
        if p.skaters.remove(&id).is_none() {
            return;
        }
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        let t = self.grid.nearest_walkable(a.tile, 6).unwrap_or(a.tile);
        let cell = a.cell;
        self.broadcast(cell, &ServerMsg::Skating { id, on: false }, None);
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if a.tile != t {
            a.tile = t;
            self.on_tile_changed(id, now);
        }
        let cell = self.avatars[&id].cell;
        self.broadcast(cell, &ServerMsg::Snap { id, x: t.0, y: t.1 }, None);
    }

    /// Gone (disconnected, or through a door): off the board, quietly.
    pub(super) fn skate_leave(&mut self, id: u32) {
        self.duel_quit(id);
        if let Some(p) = self.skate.as_mut() {
            p.skaters.remove(&id);
        }
    }

    /// One of Dusty's daily quests done: its coins paid (once a day each,
    /// whatever's asked: the ledger's key is the player, the day, the slot).
    pub(super) fn skate_quest(&mut self, id: u32, day: u32, slot: u8, now: u32) {
        let Some(p) = &self.skate else { return };
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        // (Today's, or (a clock a little behind, just past midnight) yesterday's.)
        let today = today() as u32;
        if slot as usize >= skate::QUEST_COINS.len() || day > today || day + 1 < today {
            return;
        }
        if !p.near(a.tile) || !a.game_rl.try_take(now as u64) {
            return;
        }
        let Some(econ) = self.economy.clone() else {
            return;
        };
        let player = a.player_id.clone();
        let coins = skate::QUEST_COINS[slot as usize];
        let key = format!("skate_quest:{player}:{day}:{slot}");
        self.spawn_call(
            async move {
                econ.grant(&player, COIN, coins as i32, "skate_quest", &key)
                    .await
            },
            move |inst, result| match result {
                Ok(applied) if inst.avatars.contains_key(&id) => {
                    let already = applied.duplicate;
                    if !already {
                        inst.send_granted(id, &applied);
                    }
                    inst.send_to(
                        id,
                        &ServerMsg::SkateQuestPaid {
                            day,
                            slot,
                            coins,
                            already,
                        },
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(?e, "skate quest: couldn't pay"),
            },
        );
    }

    /// Into a 1v1 (paired with whoever's waiting, or the bot), or out of one.
    pub(super) fn skate_duel(&mut self, id: u32, join: bool, bot: bool, grinds: bool, now: u32) {
        if !join {
            return self.duel_quit(id);
        }
        let Some(p) = &self.skate else { return };
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        if !p.near(a.tile) || p.duels.iter().any(|d| d.side(id).is_some()) {
            return;
        }
        let other = if bot {
            Some(0)
        } else {
            p.waiting
                .iter()
                .find(|&&(w, g)| w != id && g == grinds && self.avatars.contains_key(&w))
                .map(|&(w, _)| w)
        };
        let Some(other) = other else {
            if let Some(p) = self.skate.as_mut() {
                p.waiting.retain(|&(w, _)| w != id);
                p.waiting.push((id, grinds));
            }
            self.send_to(
                id,
                &ServerMsg::SkateDuelState {
                    phase: duel::WAITING,
                    opp: 0,
                    name: String::new(),
                    start_in: 0,
                    grinds,
                },
            );
            return;
        };
        let start = now + duel::COUNT_MS;
        let seed = (now as u64) << 20 ^ id as u64;
        if let Some(p) = self.skate.as_mut() {
            p.waiting.retain(|&(w, _)| w != id && w != other);
            p.duels.push(Duel {
                a: id,
                b: other,
                start,
                pts: [0, 0],
                done: [false, other == 0],
                bot: (other == 0).then(|| DuelBot::new(start, seed, grinds)),
            });
        }
        let name_of = |inst: &Instance, who: u32| {
            if who == 0 {
                BOT_NAME.to_string()
            } else {
                inst.avatars
                    .get(&who)
                    .map(|a| a.name.clone())
                    .unwrap_or_default()
            }
        };
        let (na, nb) = (name_of(self, id), name_of(self, other));
        let count = duel::COUNT_MS as u16;
        self.send_to(
            id,
            &ServerMsg::SkateDuelState {
                phase: duel::STARTING,
                opp: other,
                name: nb,
                start_in: count,
                grinds,
            },
        );
        if other != 0 {
            self.send_to(
                other,
                &ServerMsg::SkateDuelState {
                    phase: duel::STARTING,
                    opp: id,
                    name: na,
                    start_in: count,
                    grinds,
                },
            );
        }
    }

    /// A 1v1 score in: kept (it only goes up), passed on to the other one.
    pub(super) fn skate_duel_score(&mut self, id: u32, points: u32, done: bool, now: u32) {
        let Some(p) = self.skate.as_mut() else { return };
        let Some(k) = p.duels.iter().position(|d| d.side(id).is_some()) else {
            return;
        };
        let d = &mut p.duels[k];
        let s = d.side(id).unwrap_or(0);
        // (Not before it's begun; no more once in.)
        if now + 500 < d.start || d.done[s] {
            return;
        }
        d.pts[s] = d.pts[s].max(points.min(skate::MAX_POINTS));
        d.done[s] |= done;
        let (other, pts, both) = (
            if s == 0 { d.b } else { d.a },
            d.pts[s],
            d.done[0] && d.done[1],
        );
        if other != 0 {
            self.send_to(other, &ServerMsg::SkateDuelScore { points: pts });
        }
        if both {
            self.duel_end(k, None);
        }
    }

    /// Out of the queue, or out of a 1v1 (it's the other one's).
    fn duel_quit(&mut self, id: u32) {
        let Some(p) = self.skate.as_mut() else { return };
        p.waiting.retain(|&(w, _)| w != id);
        if let Some(k) = p.duels.iter().position(|d| d.side(id).is_some()) {
            self.duel_end(k, Some(id));
        }
    }

    /// A 1v1 over: each told how it went. `quit`: who walked out of it.
    fn duel_end(&mut self, k: usize, quit: Option<u32>) {
        let Some(p) = self.skate.as_mut() else { return };
        let d = p.duels.swap_remove(k);
        for (s, who) in [(0, d.a), (1, d.b)] {
            if who == 0 || Some(who) == quit {
                continue;
            }
            let (mine, theirs) = (d.pts[s], d.pts[1 - s]);
            let result = if quit.is_some() {
                duel::WALKOVER
            } else if mine > theirs {
                duel::WON
            } else if mine < theirs {
                duel::LOST
            } else {
                duel::DRAW
            };
            self.send_to(
                who,
                &ServerMsg::SkateDuelEnd {
                    mine,
                    theirs,
                    result,
                },
            );
        }
    }

    /// The 1v1s: the bot's combos, and any whose minute is long up settled.
    fn duel_tick(&mut self, now: u32) {
        let Some(p) = self.skate.as_mut() else { return };
        let mut tell = Vec::new();
        let mut over = Vec::new();
        for (k, d) in p.duels.iter_mut().enumerate() {
            let end = d.start + duel::RUN_MS;
            if let Some(b) = d.bot.as_mut()
                && let Some(pts) = b.tick(now, end)
            {
                d.pts[1] = pts;
                tell.push((d.a, pts));
            }
            if now > end + DUEL_GRACE_MS {
                over.push(k);
            }
        }
        for (id, points) in tell {
            self.send_to(id, &ServerMsg::SkateDuelScore { points });
        }
        // (Last first: removing one doesn't move the rest.)
        for k in over.into_iter().rev() {
            self.duel_end(k, None);
        }
    }

    /// A skater's move, passed on to everyone who can see them. (From
    /// someone the park's lost track of, a lag spike long enough to stand
    /// them down, say: back on their board, carrying on.)
    #[allow(clippy::too_many_arguments)]
    pub(super) fn skate_move(
        &mut self,
        id: u32,
        x: u16,
        y: u16,
        z: u8,
        dir: u16,
        pose: u8,
        trick: u8,
        spin: u16,
        sent: u16,
        kit: u32,
        now: u32,
    ) {
        if !self.skating(id) && !self.skate_join(id, kit, now, true) {
            return;
        }
        let Some(p) = self.skate.as_mut() else { return };
        let (ax, ay, aw, ah) = p.area;
        let Some(s) = p.skaters.get_mut(&id) else {
            return;
        };
        // (Lag bunches moves up: a burst is let through, a flood isn't.)
        if !s.moves.try_take(now as u64) {
            return;
        }
        s.last_move = now;
        s.kit = kit;
        // On the concrete, whatever they say.
        let x = x.clamp(ax * 100, (ax + aw) * 100 - 1);
        let y = y.clamp(ay * 100, (ay + ah) * 100 - 1);
        let pose = pose.min(skate::pose::MAX);
        let tile = (x / 100, y / 100);
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if a.tile != tile {
            a.tile = tile;
            self.on_tile_changed(id, now);
        }
        let cell = self.avatars[&id].cell;
        let msg = ServerMsg::Skater {
            id,
            x,
            y,
            z,
            dir,
            pose,
            trick,
            spin,
            sent,
            kit,
        };
        self.broadcast(cell, &msg, Some(id));
    }

    pub(super) fn skate_score(&mut self, id: u32, kind: u8, points: u32, label: String, now: u32) {
        if !self.skating(id) {
            return;
        }
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if !a.game_rl.try_take(now as u64) {
            return;
        }
        let points = points.min(skate::MAX_POINTS);
        let label = clean_label(&label);
        let (player, name, cell) = (a.player_id.clone(), a.name.clone(), a.cell);
        let changed = {
            let Some(p) = self.skate.as_mut() else { return };
            let _ = p.board();
            match kind {
                skate::score::COMBO => record(&mut p.combos, &player, &name, points),
                skate::score::RUN => record(&mut p.runs, &player, &name, points),
                _ => false,
            }
        };
        self.broadcast(
            cell,
            &ServerMsg::SkateEvent {
                id,
                kind,
                points,
                label,
            },
            Some(id),
        );
        if changed && let Some(p) = self.skate.as_mut() {
            let msg = p.board();
            self.park_broadcast(&msg);
        }
    }

    /// Anyone who's stopped sending moves a while is off their board.
    pub(super) fn skate_tick(&mut self, now: u32) {
        self.duel_tick(now);
        let Some(p) = &self.skate else { return };
        let gone: Vec<u32> = p
            .skaters
            .iter()
            .filter(|(_, s)| now.saturating_sub(s.last_move) > IDLE_MS)
            .map(|(&id, _)| id)
            .collect();
        for id in gone {
            self.skate_off(id, now);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::Cmd;
    use crate::instance::Instance;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::ClientMsg;
    use std::sync::Arc;

    #[test]
    fn a_move_from_someone_the_park_lost_puts_them_back_on_a_board_and_a_burst_gets_through() {
        let mut m = map(40, 40);
        m.objects = vec![MapObject {
            kind: "sk_park".into(),
            x: 0,
            y: 0,
            w: 40,
            h: 40,
            label: None,
        }];
        let mut inst = instance_for(Arc::new(ZoneDef::new("city".into(), m, None)));
        let mut a = connect(&mut inst, 1, "a", (40, 40));
        let mut b = connect(&mut inst, 2, "b", (40, 40));
        a.pump();
        b.pump();
        let id = inst.by_conn[&1];
        // No SkateOn (lost to lag, say): straight to moves, ten bunched up at once.
        for i in 0..10u16 {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::SkateMove {
                    x: 1000 + i * 10,
                    y: 1000,
                    z: 0,
                    dir: 0,
                    pose: 0,
                    trick: 0,
                    spin: 0,
                    sent: i * 50,
                    kit: 7,
                },
            });
        }
        inst.flush();
        b.pump();
        assert!(inst.skating(id), "back on a board");
        let relayed = b
            .log
            .iter()
            .filter(|m| matches!(m, ServerMsg::Skater { id: s, kit: 7, .. } if *s == id))
            .count();
        assert_eq!(relayed, 10, "the whole burst passed on");
    }

    /// A park filling the whole 40×40 map, and two skaters in it (ids, and their clients).
    fn park_with_two() -> (Instance, u32, u32, Client, Client) {
        let mut m = map(40, 40);
        m.objects = vec![MapObject {
            kind: "sk_park".into(),
            x: 0,
            y: 0,
            w: 40,
            h: 40,
            label: None,
        }];
        let mut inst = instance_for(Arc::new(ZoneDef::new("city".into(), m, None)));
        let mut a = connect(&mut inst, 1, "a", (40, 40));
        let mut b = connect(&mut inst, 2, "b", (40, 40));
        a.pump();
        b.pump();
        let (ia, ib) = (inst.by_conn[&1], inst.by_conn[&2]);
        (inst, ia, ib, a, b)
    }

    fn duel_ends(c: &Client) -> Vec<(u32, u32, u8)> {
        c.log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::SkateDuelEnd {
                    mine,
                    theirs,
                    result,
                } => Some((*mine, *theirs, *result)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn two_skaters_are_paired_for_a_1v1_their_scores_passed_between_them_and_the_higher_wins() {
        let (mut inst, ia, ib, mut a, mut b) = park_with_two();
        inst.skate_duel(ia, true, false, false, 1_000);
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::SkateDuelState {
                phase: duel::WAITING,
                ..
            }
        )));
        inst.skate_duel(ib, true, false, false, 2_000);
        inst.flush();
        a.pump();
        b.pump();
        assert!(a.log.iter().any(|m| matches!(m, ServerMsg::SkateDuelState { phase: duel::STARTING, opp, .. } if *opp == ib)));
        assert!(b.log.iter().any(|m| matches!(m, ServerMsg::SkateDuelState { phase: duel::STARTING, opp, .. } if *opp == ia)));
        let go = 2_000 + duel::COUNT_MS;
        inst.skate_duel_score(ia, 1_200, false, go + 5_000);
        inst.flush();
        b.pump();
        assert!(
            b.log
                .iter()
                .any(|m| matches!(m, ServerMsg::SkateDuelScore { points: 1_200 })),
            "passed on"
        );
        inst.skate_duel_score(ia, 3_000, true, go + 60_000);
        inst.skate_duel_score(ib, 2_500, true, go + 60_100);
        inst.flush();
        a.pump();
        b.pump();
        assert_eq!(duel_ends(&a), vec![(3_000, 2_500, duel::WON)]);
        assert_eq!(duel_ends(&b), vec![(2_500, 3_000, duel::LOST)]);
    }

    #[test]
    fn a_grinds_only_1v1_pairs_only_with_another_and_says_so() {
        let (mut inst, ia, ib, mut a, mut b) = park_with_two();
        inst.skate_duel(ia, true, false, true, 0);
        // Someone after the usual sort: not paired with them.
        inst.skate_duel(ib, true, false, false, 0);
        inst.flush();
        a.pump();
        assert!(!a.log.iter().any(|m| matches!(
            m,
            ServerMsg::SkateDuelState {
                phase: duel::STARTING,
                ..
            }
        )));
        inst.skate_duel(ib, false, false, false, 0);
        inst.skate_duel(ib, true, false, true, 0);
        inst.flush();
        a.pump();
        b.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::SkateDuelState {
                phase: duel::STARTING,
                grinds: true,
                ..
            }
        )));
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::SkateDuelState {
                phase: duel::STARTING,
                grinds: true,
                ..
            }
        )));
    }

    #[test]
    fn walking_out_of_a_1v1_hands_it_to_the_other_one() {
        let (mut inst, ia, ib, mut a, _b) = park_with_two();
        inst.skate_duel(ia, true, false, false, 0);
        inst.skate_duel(ib, true, false, false, 0);
        inst.skate_duel(ib, false, false, false, 10_000);
        inst.flush();
        a.pump();
        assert_eq!(duel_ends(&a).first().map(|e| e.2), Some(duel::WALKOVER));
    }

    #[test]
    fn the_bot_banks_combos_through_its_minute_and_is_settled_after() {
        let (mut inst, ia, _ib, mut a, _b) = park_with_two();
        inst.skate_duel(ia, true, true, false, 0);
        let go = duel::COUNT_MS;
        let mut t = 0;
        while t < go + duel::RUN_MS + DUEL_GRACE_MS + 1_000 {
            t += 100;
            inst.duel_tick(t);
        }
        inst.flush();
        a.pump();
        let bot: Vec<u32> = a
            .log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::SkateDuelScore { points } => Some(*points),
                _ => None,
            })
            .collect();
        assert!(bot.len() >= 8, "a combo every few seconds: {bot:?}");
        assert!(bot.windows(2).all(|w| w[0] < w[1]));
        let last = *bot.last().unwrap();
        assert!((1_500..40_000).contains(&last), "a fair score: {last}");
        // Never played: settled on the scores in.
        assert_eq!(duel_ends(&a), vec![(0, last, duel::LOST)]);
    }

    #[test]
    fn the_board_keeps_each_skaters_best_best_first() {
        let mut b = Vec::new();
        assert!(record(&mut b, "a", "Ann", 500));
        assert!(record(&mut b, "b", "Bo", 900));
        assert!(!record(&mut b, "a", "Ann", 400), "a worse score is no news");
        assert!(record(&mut b, "a", "Ann", 1200));
        assert_eq!(b.len(), 2);
        assert_eq!(b[0].name, "Ann");
        assert_eq!(b[0].points, 1200);
        for i in 0..20 {
            record(&mut b, &format!("p{i}"), "x", 1000 + i);
        }
        assert_eq!(b.len(), skate::BOARD_LINES);
        assert!(b.windows(2).all(|w| w[0].points >= w[1].points));
        assert!(
            !record(&mut b, "late", "Late", 1),
            "too low for a full board"
        );
    }

    #[test]
    fn labels_are_cleaned_and_cut_short() {
        assert_eq!(
            clean_label("  Kickflip\n + 50-50\u{7}  "),
            "Kickflip + 50-50"
        );
        assert_eq!(clean_label(&"x".repeat(500)).len(), LABEL_MAX);
    }
}
