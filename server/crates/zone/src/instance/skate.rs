//! The skatepark: anyone in it can get on a board and skate, as many at once
//! as like. The skating itself (the ramps, the tricks, the score) runs on
//! each skater's own client; here each one's moves are passed on to
//! everyone who can see them, their avatar kept on the tile they're over (so
//! they're seen, and stand up there when they step off), and the day's best
//! timed runs and combos kept on the park's board.

use super::Instance;
use commons_protocol::{ServerMsg, SkateEntry, skate, state};
use commons_sim::TilePos;
use commons_sim::map::MapObject;
use std::collections::HashMap;

/// Moves faster than this apart (ms) are dropped (clients send ~12 a second).
const MOVE_GAP_MS: u32 = 35;
/// Off the board after this long without a move (ms): they've gone.
const IDLE_MS: u32 = 20_000;
/// How far outside the park (tiles) you may be and still get on a board.
const REACH: u16 = 2;
/// The longest name a combo is given (chars).
const LABEL_MAX: usize = 90;

#[derive(Debug, Clone)]
struct Skater {
    last_move: u32,
    /// How their board's built (`SkateOn.kit`), passed on with their moves.
    kit: u32,
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
        let Some(p) = &self.skate else { return };
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        let st = a.state;
        // On a board already: a new build.
        if p.skaters.contains_key(&id) {
            if let Some(s) = self.skate.as_mut().and_then(|p| p.skaters.get_mut(&id)) {
                s.kit = kit;
            }
            return;
        }
        if !p.near(a.tile) {
            self.error(
                id,
                commons_protocol::error_code::BAD_MESSAGE,
                "you need to be at the skatepark to skate",
            );
            return;
        }
        if self.aboard(id) || self.arena_fighting(id) || self.pb_playing(id) {
            return;
        }
        match st {
            state::SITTING => self.stand(id, now),
            state::FISHING => self.stop_fishing(id, false),
            _ => {}
        }
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
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
                },
            );
        }
        self.broadcast(cell, &ServerMsg::Skating { id, on: true }, Some(id));
    }

    /// Off the board: stood on the nearest place to stand, shown there.
    pub(super) fn skate_off(&mut self, id: u32, now: u32) {
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
        if let Some(p) = self.skate.as_mut() {
            p.skaters.remove(&id);
        }
    }

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
        now: u32,
    ) {
        let Some(p) = self.skate.as_mut() else { return };
        let (ax, ay, aw, ah) = p.area;
        let Some(s) = p.skaters.get_mut(&id) else {
            return;
        };
        if now.saturating_sub(s.last_move) < MOVE_GAP_MS {
            return;
        }
        s.last_move = now;
        let kit = s.kit;
        // On the concrete, whatever they say.
        let x = x.clamp(ax * 100, (ax + aw) * 100 - 1);
        let y = y.clamp(ay * 100, (ay + ah) * 100 - 1);
        let pose = pose.min(skate::pose::MAX);
        let t = (x / 100, y / 100);
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if a.tile != t {
            a.tile = t;
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
