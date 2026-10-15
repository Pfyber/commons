//! The arcade's cabinets (and the dance machine): eight two-player games, each against the arcade's
//! bot or whoever joins you, run here on the instance (the server decides
//! everything; clients draw `ArcadeState` and send `ArcadeInput`). Winners
//! earn tickets (`arcade::TICKET`), which the prize counter trades for clothes.
//!
//! - **Pong** (real time): `value` is your paddle's centre, in tenths of a
//!   unit (0–1200). First to `PONG_WIN`.
//! - **Light cycles** (real time, a step per tick): `value` is the direction
//!   to turn to (0 up, 1 right, 2 down, 3 left). Crash and you lose.
//! - **Connect four**: `value` is the column (0–6).
//! - **Memory match**: `value` is the card to turn over (0–15).
//! - **Contests** (basket catch, turbo racer, dance off): each player plays
//!   the same seeded course on their own screen and reports back: `value`
//!   at or above `arcade::SCORE_FLAG` is their score (or distance raced),
//!   below it where their basket or car is. The server keeps the scores
//!   believable and calls the result.
//! - **Tank duel** (real time, run here): `value` is the controls held
//!   (`arcade::KEY_*`).
//! - **Pinball 1v1** (real time, the machine in the bar; see `pinball`):
//!   `value` is the flippers held (`arcade::FLIP_*`).

mod pinball;

use super::Instance;
use crate::econ::CallError;
use commons_protocol::{ServerMsg, arcade};
use commons_sim::TilePos;
use rand::Rng;
use rand::seq::SliceRandom;

/// The bot takes its turn this long after it comes round.
const BOT_DELAY_MS: u32 = 900;

pub(super) fn kind_for(label: &str) -> u8 {
    match label {
        "Pong" => arcade::PONG,
        "Light Cycles" => arcade::CYCLES,
        "Connect Four" => arcade::CONNECT4,
        "Memory Match" => arcade::MEMORY,
        "Basket Catch" => arcade::CATCH,
        "Turbo Racer" => arcade::RACER,
        "Dance Off" => arcade::DANCE,
        "Pinball" => arcade::PINBALL,
        _ => arcade::TANKS,
    }
}

// ---- the cabinet ---------------------------------------------------------------

#[derive(Debug, Clone)]
pub(super) struct Cabinet {
    tile: TilePos,
    kind: u8,
    a: u32,
    b: u32,
    status: u8,
    game: Game,
    /// When the bot may next move.
    bot_at: u32,
    /// The server time the game state describes.
    t0: u32,
    /// The dance machine: where each player dances (and must stay).
    pads: Option<[TilePos; 2]>,
}

/// A dancer who strays this far (tiles) from their pad has walked off.
const PAD_RANGE: i32 = 2;

impl Cabinet {
    pub(super) fn with_pads(mut self, pads: [TilePos; 2]) -> Self {
        self.pads = Some(pads);
        self
    }

    pub(super) fn new(tile: TilePos, kind: u8) -> Self {
        Cabinet {
            tile,
            kind,
            a: 0,
            b: 0,
            status: arcade::EMPTY,
            game: Game::new(kind, 0),
            bot_at: 0,
            t0: 0,
            pads: None,
        }
    }

    fn state(&self, cab: u8) -> ServerMsg {
        ServerMsg::ArcadeState {
            cab,
            kind: self.kind,
            a: self.a,
            b: self.b,
            status: self.status,
            turn: self.game.turn(),
            t0: self.t0,
            data: self.game.data(),
        }
    }
}

#[derive(Debug, Clone)]
enum Game {
    Pong(Pong),
    Cycles(Cycles),
    Connect4(Connect4),
    Memory(Memory),
    Contest(Contest),
    Tanks(Tanks),
    Pinball(pinball::Pinball),
}

/// What a move or a tick did.
#[derive(Default)]
struct Step {
    changed: bool,
    /// The game ended: `arcade::A_WON`, `B_WON` or `DRAW`.
    over: Option<u8>,
}

impl Game {
    fn new(kind: u8, now: u32) -> Self {
        match kind {
            arcade::PONG => Game::Pong(Pong::new(now)),
            arcade::CYCLES => Game::Cycles(Cycles::new(now)),
            arcade::CONNECT4 => Game::Connect4(Connect4::default()),
            arcade::MEMORY => Game::Memory(Memory::new()),
            arcade::CATCH | arcade::RACER | arcade::DANCE => Game::Contest(Contest::new(kind, now)),
            arcade::PINBALL => Game::Pinball(pinball::Pinball::new(now)),
            _ => Game::Tanks(Tanks::new(now)),
        }
    }

    fn turn(&self) -> u8 {
        match self {
            Game::Connect4(g) => g.turn,
            Game::Memory(g) => g.turn,
            _ => 0,
        }
    }

    /// Real-time games move on by themselves.
    fn realtime(&self) -> bool {
        matches!(self, Game::Pong(_) | Game::Cycles(_) | Game::Contest(_) | Game::Tanks(_) | Game::Pinball(_))
    }

    fn input(&mut self, side: u8, value: u16, now: u32) -> Step {
        match self {
            Game::Pong(g) => g.input(side, value),
            Game::Cycles(g) => g.input(side, value),
            Game::Connect4(g) if g.turn == side => g.play(value as usize),
            Game::Memory(g) if g.turn == side => g.flip(value as usize, now),
            Game::Contest(g) => g.input(side, value, now),
            Game::Tanks(g) => g.input(side, value),
            Game::Pinball(g) => g.input(side, value, now),
            _ => Step::default(),
        }
    }

    /// Time passing: the ball flies, the cycles roll, cards turn back over.
    /// `bot` is the side the bot plays (real-time games steer it here).
    fn tick(&mut self, now: u32, bot: Option<u8>) -> Step {
        match self {
            Game::Pong(g) => g.tick(now, bot),
            Game::Cycles(g) => g.tick(now, bot),
            Game::Memory(g) => g.tick(now),
            Game::Contest(g) => g.tick(now, bot),
            Game::Tanks(g) => g.tick(now, bot),
            Game::Pinball(g) => g.tick(now, bot),
            _ => Step::default(),
        }
    }

    /// The bot's move in a turn-based game.
    fn bot_move(&mut self) -> Option<u16> {
        let mv = match self {
            Game::Connect4(g) => g.best(),
            Game::Memory(g) => g.best(),
            _ => None,
        };
        mv.map(|m| m as u16)
    }

    fn data(&self) -> Vec<u16> {
        match self {
            Game::Pong(g) => g.data(),
            Game::Cycles(g) => g.data(),
            Game::Connect4(g) => g.data(),
            Game::Memory(g) => g.data(),
            Game::Contest(g) => g.data(),
            Game::Tanks(g) => g.data(),
            Game::Pinball(g) => g.data(),
        }
    }
}

fn result(a: u32, b: u32) -> Option<u8> {
    Some(match a.cmp(&b) {
        std::cmp::Ordering::Greater => arcade::A_WON,
        std::cmp::Ordering::Less => arcade::B_WON,
        std::cmp::Ordering::Equal => arcade::DRAW,
    })
}

// ---- Pong ---------------------------------------------------------------------

/// The court, in units; paddles on the short ends.
const PONG_W: f64 = 200.0;
const PONG_H: f64 = 120.0;
const PADDLE_X: [f64; 2] = [8.0, 192.0];
const PADDLE_HALF: f64 = 14.0;
const BALL_R: f64 = 2.0;
const SERVE_SPEED: f64 = 90.0;
const MAX_SPEED: f64 = 200.0;
const PONG_WIN: u16 = 5;
/// The bot's paddle speed, units per second.
const PONG_BOT_SPEED: f64 = 70.0;

#[derive(Debug, Clone)]
struct Pong {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    paddle: [f64; 2],
    score: [u16; 2],
    /// The ball waits on the centre spot until then.
    serve_at: Option<u32>,
    /// Who gets served at next (the side that just lost a point).
    serve_to: u8,
    /// Last time the ball was moved on.
    t: u32,
}

impl Pong {
    fn new(now: u32) -> Self {
        Pong {
            x: PONG_W / 2.0,
            y: PONG_H / 2.0,
            vx: 0.0,
            vy: 0.0,
            paddle: [PONG_H / 2.0; 2],
            score: [0; 2],
            serve_at: Some(now + 1500),
            serve_to: 1,
            t: now,
        }
    }

    fn input(&mut self, side: u8, value: u16) -> Step {
        let y = (value as f64 / 10.0).clamp(PADDLE_HALF, PONG_H - PADDLE_HALF);
        let changed = (y - self.paddle[side as usize]).abs() > 0.05;
        self.paddle[side as usize] = y;
        Step { changed, over: None }
    }

    fn tick(&mut self, now: u32, bot: Option<u8>) -> Step {
        let mut step = Step::default();
        let dt_total = now.saturating_sub(self.t) as f64 / 1000.0;
        // The bot's paddle follows the ball, no faster than a hand could.
        if let Some(side) = bot {
            let s = side as usize;
            let target = if self.serve_at.is_some() { PONG_H / 2.0 } else { self.y };
            let d = (target - self.paddle[s]).clamp(-PONG_BOT_SPEED * dt_total, PONG_BOT_SPEED * dt_total);
            if d.abs() > 0.05 {
                self.paddle[s] = (self.paddle[s] + d).clamp(PADDLE_HALF, PONG_H - PADDLE_HALF);
                step.changed = true;
            }
        }
        if let Some(at) = self.serve_at {
            if now >= at {
                let mut rng = rand::rng();
                self.serve_at = None;
                self.x = PONG_W / 2.0;
                self.y = PONG_H / 2.0;
                self.vx = if self.serve_to == 0 { -SERVE_SPEED } else { SERVE_SPEED };
                self.vy = rng.random_range(-45.0..45.0);
                step.changed = true;
            }
            self.t = now;
            return step;
        }
        // Move on in small steps, so no bounce is missed.
        let mut t = self.t;
        while t < now {
            let ms = (now - t).min(5);
            t += ms;
            let dt = ms as f64 / 1000.0;
            self.x += self.vx * dt;
            self.y += self.vy * dt;
            if self.y < BALL_R {
                self.y = 2.0 * BALL_R - self.y;
                self.vy = -self.vy;
                step.changed = true;
            } else if self.y > PONG_H - BALL_R {
                self.y = 2.0 * (PONG_H - BALL_R) - self.y;
                self.vy = -self.vy;
                step.changed = true;
            }
            for side in 0..2 {
                let px = PADDLE_X[side];
                let toward = if side == 0 { self.vx < 0.0 } else { self.vx > 0.0 };
                let reached = if side == 0 { self.x - BALL_R <= px } else { self.x + BALL_R >= px };
                let behind = if side == 0 { self.x < px - 4.0 } else { self.x > px + 4.0 };
                if toward && reached && !behind {
                    let off = self.y - self.paddle[side];
                    if off.abs() <= PADDLE_HALF + BALL_R {
                        // A hit: back it goes, a little faster, angled by where it struck.
                        let speed = (self.vx.abs() * 1.07).min(MAX_SPEED);
                        self.vx = if side == 0 { speed } else { -speed };
                        self.vy = (self.vy + off / PADDLE_HALF * 60.0).clamp(-140.0, 140.0);
                        self.x = if side == 0 { px + BALL_R } else { px - BALL_R };
                        step.changed = true;
                    }
                }
            }
            if self.x < 0.0 || self.x > PONG_W {
                // A point to whoever's end it didn't leave by.
                let to = if self.x < 0.0 { 1 } else { 0 };
                self.score[to] += 1;
                self.serve_to = 1 - to as u8;
                self.serve_at = Some(t + 1000);
                self.x = PONG_W / 2.0;
                self.y = PONG_H / 2.0;
                self.vx = 0.0;
                self.vy = 0.0;
                step.changed = true;
                if self.score[to] >= PONG_WIN {
                    step.over = Some(if to == 0 { arcade::A_WON } else { arcade::B_WON });
                }
                break;
            }
        }
        self.t = now;
        step
    }

    fn data(&self) -> Vec<u16> {
        let v = |f: f64| (f * 10.0 + 32_768.0).round() as u16;
        vec![
            (self.x * 10.0).round() as u16,
            (self.y * 10.0).round() as u16,
            v(self.vx),
            v(self.vy),
            (self.paddle[0] * 10.0).round() as u16,
            (self.paddle[1] * 10.0).round() as u16,
            self.score[0],
            self.score[1],
            self.serve_at.is_some() as u16,
        ]
    }
}

// ---- Light cycles ----------------------------------------------------------------

const CYC_W: i32 = 40;
const CYC_H: i32 = 24;
const DIRS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

#[derive(Debug, Clone)]
struct Cycles {
    /// 0 empty, 1 a's trail, 2 b's trail.
    grid: Vec<u8>,
    head: [(i32, i32); 2],
    dir: [u8; 2],
    /// Turns asked for since the last step.
    want: [u8; 2],
    /// The countdown before the first step.
    start_at: u32,
    steps: u16,
}

impl Cycles {
    fn new(now: u32) -> Self {
        let mut g = Cycles {
            grid: vec![0; (CYC_W * CYC_H) as usize],
            head: [(5, CYC_H / 2), (CYC_W - 6, CYC_H / 2)],
            dir: [1, 3],
            want: [1, 3],
            start_at: now + 2000,
            steps: 0,
        };
        for (s, &(x, y)) in g.head.clone().iter().enumerate() {
            g.grid[(y * CYC_W + x) as usize] = s as u8 + 1;
        }
        g
    }

    fn free(&self, (x, y): (i32, i32)) -> bool {
        (0..CYC_W).contains(&x) && (0..CYC_H).contains(&y) && self.grid[(y * CYC_W + x) as usize] == 0
    }

    fn input(&mut self, side: u8, value: u16) -> Step {
        let d = (value % 4) as u8;
        let s = side as usize;
        // No turning straight back into your own trail.
        if d != (self.dir[s] + 2) % 4 {
            self.want[s] = d;
        }
        Step::default()
    }

    /// Open cells reachable from `from` (capped), for the bot.
    fn room(&self, from: (i32, i32), cap: usize) -> usize {
        if !self.free(from) {
            return 0;
        }
        let mut seen = vec![false; self.grid.len()];
        let mut stack = vec![from];
        seen[(from.1 * CYC_W + from.0) as usize] = true;
        let mut n = 0;
        while let Some((x, y)) = stack.pop() {
            n += 1;
            if n >= cap {
                break;
            }
            for (dx, dy) in DIRS {
                let p = (x + dx, y + dy);
                if self.free(p) && !seen[(p.1 * CYC_W + p.0) as usize] {
                    seen[(p.1 * CYC_W + p.0) as usize] = true;
                    stack.push(p);
                }
            }
        }
        n
    }

    fn tick(&mut self, now: u32, bot: Option<u8>) -> Step {
        if now < self.start_at {
            return Step::default();
        }
        if let Some(side) = bot {
            // The bot heads for the most open space, keeping straight on ties.
            let s = side as usize;
            let (x, y) = self.head[s];
            let mut best = (0usize, self.dir[s]);
            for k in 0..4u8 {
                let d = (self.dir[s] + k) % 4;
                if d == (self.dir[s] + 2) % 4 {
                    continue;
                }
                let (dx, dy) = DIRS[d as usize];
                let r = self.room((x + dx, y + dy), 300);
                if r > best.0 {
                    best = (r, d);
                }
            }
            self.want[s] = best.1;
        }
        let mut next = [(0, 0); 2];
        for s in 0..2 {
            self.dir[s] = self.want[s];
            let (dx, dy) = DIRS[self.dir[s] as usize];
            next[s] = (self.head[s].0 + dx, self.head[s].1 + dy);
        }
        let crash_a = !self.free(next[0]) || next[0] == next[1];
        let crash_b = !self.free(next[1]) || next[0] == next[1];
        self.steps += 1;
        let over = match (crash_a, crash_b) {
            (true, true) => Some(arcade::DRAW),
            (true, false) => Some(arcade::B_WON),
            (false, true) => Some(arcade::A_WON),
            _ => None,
        };
        if over.is_none() {
            for s in 0..2 {
                self.head[s] = next[s];
                let (x, y) = next[s];
                self.grid[(y * CYC_W + x) as usize] = s as u8 + 1;
            }
        }
        Step { changed: true, over }
    }

    /// Heads, directions, the step and the whole grid, two bits a cell.
    fn data(&self) -> Vec<u16> {
        let mut d = vec![
            self.head[0].0 as u16,
            self.head[0].1 as u16,
            self.head[1].0 as u16,
            self.head[1].1 as u16,
            self.dir[0] as u16,
            self.dir[1] as u16,
            self.steps,
        ];
        for chunk in self.grid.chunks(8) {
            let mut w = 0u16;
            for (i, &c) in chunk.iter().enumerate() {
                w |= (c as u16) << (i * 2);
            }
            d.push(w);
        }
        d
    }
}

// ---- Connect four -------------------------------------------------------------------

const C4_W: usize = 7;
const C4_H: usize = 6;

/// Cells column by column, bottom up: index `col * 6 + row`.
#[derive(Debug, Clone)]
struct Connect4 {
    cells: [u8; 42],
    turn: u8,
    last: Option<usize>,
}

impl Default for Connect4 {
    fn default() -> Self {
        Connect4 { cells: [0; 42], turn: 0, last: None }
    }
}

impl Connect4 {
    fn height(&self, col: usize) -> usize {
        (0..C4_H).take_while(|&r| self.cells[col * C4_H + r] != 0).count()
    }

    fn drop(&mut self, col: usize, who: u8) -> Option<usize> {
        if col >= C4_W || self.height(col) >= C4_H {
            return None;
        }
        let i = col * C4_H + self.height(col);
        self.cells[i] = who;
        Some(i)
    }

    fn at(&self, c: i32, r: i32) -> u8 {
        if (0..C4_W as i32).contains(&c) && (0..C4_H as i32).contains(&r) {
            self.cells[c as usize * C4_H + r as usize]
        } else {
            0
        }
    }

    fn winner(&self) -> u8 {
        for c in 0..C4_W as i32 {
            for r in 0..C4_H as i32 {
                let p = self.at(c, r);
                if p == 0 {
                    continue;
                }
                for (dc, dr) in [(1, 0), (0, 1), (1, 1), (1, -1)] {
                    if (1..4).all(|k| self.at(c + dc * k, r + dr * k) == p) {
                        return p;
                    }
                }
            }
        }
        0
    }

    fn play(&mut self, col: usize) -> Step {
        let Some(i) = self.drop(col, self.turn + 1) else {
            return Step::default();
        };
        self.last = Some(i);
        let over = match self.winner() {
            1 => Some(arcade::A_WON),
            2 => Some(arcade::B_WON),
            _ if self.cells.iter().all(|&c| c != 0) => Some(arcade::DRAW),
            _ => None,
        };
        self.turn = 1 - self.turn;
        Step { changed: true, over }
    }

    /// Scores every window of four for `me` (positive is good).
    fn eval(&self, me: u8) -> i32 {
        let mut score = 0;
        for c in 0..C4_W as i32 {
            for r in 0..C4_H as i32 {
                for (dc, dr) in [(1, 0), (0, 1), (1, 1), (1, -1)] {
                    let (mut mine, mut theirs) = (0, 0);
                    for k in 0..4 {
                        let (cc, rr) = (c + dc * k, r + dr * k);
                        if !(0..C4_W as i32).contains(&cc) || !(0..C4_H as i32).contains(&rr) {
                            mine = -1;
                            break;
                        }
                        match self.at(cc, rr) {
                            0 => {}
                            p if p == me => mine += 1,
                            _ => theirs += 1,
                        }
                    }
                    if mine < 0 || (mine > 0 && theirs > 0) {
                        continue;
                    }
                    score += [0, 1, 4, 16, 1000][mine as usize] - [0, 1, 5, 20, 1000][theirs];
                }
            }
        }
        score + (0..C4_H as i32).filter(|&r| self.at(3, r) == me).count() as i32 * 3
    }

    fn search(&self, depth: u32, mut alpha: i32, beta: i32, me: u8) -> i32 {
        match self.winner() {
            0 => {}
            w if w == me => return 100_000 + depth as i32,
            _ => return -100_000 - depth as i32,
        }
        if depth == 0 || self.cells.iter().all(|&c| c != 0) {
            return self.eval(me);
        }
        let mover = self.turn + 1;
        let mut best = i32::MIN + 1;
        for col in [3, 2, 4, 1, 5, 0, 6] {
            let mut g = self.clone();
            if g.drop(col, mover).is_none() {
                continue;
            }
            g.turn = 1 - g.turn;
            let v = -g.search(depth - 1, -beta, -alpha, 3 - me);
            best = best.max(v);
            alpha = alpha.max(v);
            if alpha >= beta {
                break;
            }
        }
        best
    }

    fn best(&self) -> Option<usize> {
        let me = self.turn + 1;
        let mut best: Option<(i32, usize)> = None;
        for col in [3, 2, 4, 1, 5, 0, 6] {
            let mut g = self.clone();
            if g.drop(col, me).is_none() {
                continue;
            }
            g.turn = 1 - g.turn;
            let v = -g.search(4, -1_000_000, 1_000_000, 3 - me);
            if best.is_none_or(|(b, _)| v > b) {
                best = Some((v, col));
            }
        }
        best.map(|(_, c)| c)
    }

    fn data(&self) -> Vec<u16> {
        let mut d: Vec<u16> = self.cells.iter().map(|&c| c as u16).collect();
        d.push(self.last.map_or(u16::MAX, |i| i as u16));
        d
    }
}

// ---- Memory match -------------------------------------------------------------------------

/// Two mismatched cards stay face up this long.
const MEMORY_SHOW_MS: u32 = 1300;

#[derive(Debug, Clone)]
struct Memory {
    /// Pictures 1–8, two of each.
    cards: [u8; 16],
    /// Who matched each card (0 nobody yet, 1 a, 2 b).
    owner: [u8; 16],
    up: Vec<usize>,
    hide_at: Option<u32>,
    turn: u8,
    score: [u16; 2],
    /// What the bot has seen (and may remember).
    seen: [u8; 16],
}

impl Memory {
    fn new() -> Self {
        let mut cards: Vec<u8> = (1..=8).flat_map(|p| [p, p]).collect();
        cards.shuffle(&mut rand::rng());
        Memory {
            cards: cards.try_into().unwrap(),
            owner: [0; 16],
            up: vec![],
            hide_at: None,
            turn: 0,
            score: [0; 2],
            seen: [0; 16],
        }
    }

    fn flip(&mut self, i: usize, now: u32) -> Step {
        if i >= 16 || self.hide_at.is_some() || self.owner[i] != 0 || self.up.contains(&i) {
            return Step::default();
        }
        self.up.push(i);
        self.seen[i] = self.cards[i];
        if self.up.len() == 2 {
            let (p, q) = (self.up[0], self.up[1]);
            if self.cards[p] == self.cards[q] {
                // A pair: yours, and go again.
                self.owner[p] = self.turn + 1;
                self.owner[q] = self.turn + 1;
                self.score[self.turn as usize] += 1;
                self.up.clear();
                if self.owner.iter().all(|&o| o != 0) {
                    return Step {
                        changed: true,
                        over: result(self.score[0] as u32, self.score[1] as u32),
                    };
                }
            } else {
                self.hide_at = Some(now + MEMORY_SHOW_MS);
            }
        }
        Step { changed: true, over: None }
    }

    fn tick(&mut self, now: u32) -> Step {
        match self.hide_at {
            Some(at) if now >= at => {
                self.hide_at = None;
                self.up.clear();
                self.turn = 1 - self.turn;
                Step { changed: true, over: None }
            }
            _ => Step::default(),
        }
    }

    /// The bot remembers about three cards in four it has seen.
    fn best(&self) -> Option<usize> {
        if self.hide_at.is_some() {
            return None;
        }
        let mut rng = rand::rng();
        let open = |i: usize| self.owner[i] == 0 && !self.up.contains(&i);
        let recall = |i: usize, rng: &mut rand::rngs::ThreadRng| self.seen[i] != 0 && rng.random_bool(0.75);
        if let Some(&first) = self.up.first() {
            let want = self.cards[first];
            if let Some(i) = (0..16).find(|&i| open(i) && self.seen[i] == want && recall(i, &mut rng)) {
                return Some(i);
            }
        } else {
            // A pair it knows of?
            for i in 0..16 {
                if open(i) && self.seen[i] != 0 && (i + 1..16).any(|j| open(j) && self.seen[j] == self.seen[i]) && recall(i, &mut rng) {
                    return Some(i);
                }
            }
        }
        let unknown: Vec<usize> = (0..16).filter(|&i| open(i) && self.seen[i] == 0).collect();
        let any: Vec<usize> = (0..16).filter(|&i| open(i)).collect();
        let pool = if unknown.is_empty() { any } else { unknown };
        pool.get(rng.random_range(0..pool.len().max(1))).copied()
    }

    /// Each card: its picture if face up or matched (with who matched it,
    /// or 3 while just turned over), else 0. Then the scores.
    fn data(&self) -> Vec<u16> {
        let mut d: Vec<u16> = (0..16)
            .map(|i| {
                if self.owner[i] != 0 {
                    self.cards[i] as u16 | (self.owner[i] as u16) << 4
                } else if self.up.contains(&i) {
                    self.cards[i] as u16 | 3 << 4
                } else {
                    0
                }
            })
            .collect();
        d.extend(self.score);
        d
    }
}

// ---- Contests: basket catch, turbo racer, dance off ----------------------------------

/// A server time as two u16s (high, low), for `data`.
fn split(t: u32) -> [u16; 2] {
    [(t >> 16) as u16, t as u16]
}

#[derive(Debug, Clone)]
struct Contest {
    kind: u8,
    /// Everyone plays the same course: falling items, traffic, the dance chart.
    seed: u16,
    start: u32,
    end: u32,
    score: [u16; 2],
    /// Where each player's basket or car is (0–1000).
    pos: [u16; 2],
    /// Racers over the line.
    finished: [bool; 2],
    /// When each side last reported a score.
    reported: [u32; 2],
    /// The bot's next move, and how long it's slowed after a crash.
    bot_next: u32,
    bot_slow_until: u32,
    /// The bot's distance in the race, finer than `score`.
    bot_dist: f64,
}

impl Contest {
    fn new(kind: u8, now: u32) -> Self {
        let start = now + arcade::COUNTDOWN_MS;
        let len = match kind {
            arcade::CATCH => arcade::CATCH_MS,
            arcade::RACER => arcade::RACE_MS,
            _ => arcade::BEAT_MS * arcade::DANCE_BEATS,
        };
        Contest {
            kind,
            seed: rand::rng().random(),
            start,
            end: start + len,
            score: [0; 2],
            pos: [500; 2],
            finished: [false; 2],
            reported: [start; 2],
            bot_next: start,
            bot_slow_until: 0,
            bot_dist: 0.0,
        }
    }

    /// The most a score can believably have grown in `ms`.
    fn max_gain(&self, ms: u32) -> u32 {
        match self.kind {
            // Up to a star (3) every 400 ms.
            arcade::CATCH => 3 + ms * 3 / 400,
            arcade::RACER => ms * arcade::RACE_TOP_SPEED / 1000 + 60,
            // At most two notes a beat, 300 points each (and a combo bonus).
            _ => 700 + ms * 1400 / arcade::BEAT_MS,
        }
    }

    fn input(&mut self, side: u8, value: u16, now: u32) -> Step {
        let s = side as usize;
        if value < arcade::SCORE_FLAG {
            self.pos[s] = value.min(1000);
            return Step { changed: true, over: None };
        }
        if now < self.start || now > self.end + 1_000 || self.finished[s] {
            return Step::default();
        }
        let want = (value - arcade::SCORE_FLAG) as u32;
        let cap = self.score[s] as u32 + self.max_gain(now.saturating_sub(self.reported[s]));
        self.score[s] = want.min(cap).min(u16::MAX as u32 - 1) as u16;
        self.reported[s] = now;
        Step { changed: true, over: self.race_over(s) }
    }

    /// A racer reached the line: the first one there wins.
    fn race_over(&mut self, s: usize) -> Option<u8> {
        if self.kind != arcade::RACER || self.score[s] < arcade::RACE_GOAL || self.finished[s] {
            return None;
        }
        self.finished[s] = true;
        Some(if s == 0 { arcade::A_WON } else { arcade::B_WON })
    }

    fn tick(&mut self, now: u32, bot: Option<u8>) -> Step {
        let mut step = Step::default();
        if let Some(side) = bot
            && now >= self.start
            && now < self.end
        {
            let s = side as usize;
            let mut rng = rand::rng();
            match self.kind {
                arcade::CATCH if now >= self.bot_next => {
                    // About as good as a careful player.
                    let r: f64 = rng.random();
                    let sc = self.score[s];
                    self.score[s] = if r < 0.5 {
                        sc + 1
                    } else if r < 0.58 {
                        sc + 3
                    } else if r < 0.64 {
                        sc.saturating_sub(3)
                    } else {
                        sc
                    };
                    self.pos[s] = rng.random_range(80..920);
                    self.bot_next = now + 600;
                    step.changed = true;
                }
                arcade::RACER => {
                    // Picks up speed, now and then clips a car and slows right down.
                    let t = (now - self.start) as f64 / 1000.0;
                    let mut speed = (70.0 + t * 2.0).min(arcade::RACE_TOP_SPEED as f64 * 0.92);
                    if now < self.bot_slow_until {
                        speed *= 0.3;
                    } else if rng.random_bool(0.025) {
                        self.bot_slow_until = now + 1_500;
                        self.pos[s] = rng.random_range(100..900);
                    }
                    self.bot_dist += speed * 0.1;
                    self.score[s] = (self.bot_dist as u16).min(arcade::RACE_GOAL);
                    step.changed = true;
                    step.over = self.race_over(s);
                }
                arcade::DANCE if now >= self.bot_next => {
                    // Dances to the same chart as you: hits most arrows, not
                    // all of them on the dot.
                    let b = (now - self.start) / arcade::BEAT_MS;
                    let half = arcade::dance_half(b) && rng.random_bool(0.5);
                    for _ in 0..arcade::dance_notes(b) + half as u32 {
                        if rng.random_bool(0.72) {
                            self.score[s] += rng.random_range(110..=260);
                        }
                    }
                    self.pos[s] = rng.random_range(0..4);
                    self.bot_next = self.start + (b + 1) * arcade::BEAT_MS;
                    step.changed = true;
                }
                _ => {}
            }
        }
        if step.over.is_none() && now >= self.end {
            step.changed = true;
            step.over = result(self.score[0] as u32, self.score[1] as u32);
        }
        step
    }

    /// The seed, start and end, then each side's score, position and whether
    /// they've finished.
    fn data(&self) -> Vec<u16> {
        let mut d = vec![self.seed];
        d.extend(split(self.start));
        d.extend(split(self.end));
        d.extend(self.score);
        d.extend(self.pos);
        d.extend(self.finished.map(|f| f as u16));
        d
    }
}

// ---- Tank duel ------------------------------------------------------------------------------

/// The arena, in units, and the walls inside it (x0, y0, x1, y1).
const ARENA_W: f64 = 160.0;
const ARENA_H: f64 = 100.0;
const WALLS: [(f64, f64, f64, f64); 4] = [(36.0, 14.0, 44.0, 40.0), (116.0, 60.0, 124.0, 86.0), (72.0, 44.0, 88.0, 56.0), (60.0, 80.0, 76.0, 86.0)];
const TANK_R: f64 = 5.0;
const TANK_SPEED: f64 = 34.0;
const TANK_TURN: f64 = 2.6;
const SHELL_SPEED: f64 = 110.0;
const SHELL_MS: u32 = 1_800;
const RELOAD_MS: u32 = 700;
const TANK_HP: u16 = 3;

#[derive(Debug, Clone)]
struct Tank {
    x: f64,
    y: f64,
    ang: f64,
    hp: u16,
    keys: u16,
    reload_at: u32,
}

#[derive(Debug, Clone)]
struct Shell {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    owner: usize,
    until: u32,
}

#[derive(Debug, Clone)]
struct Tanks {
    tank: [Tank; 2],
    shells: Vec<Shell>,
    start: u32,
    end: u32,
    last: u32,
}

fn in_wall(x: f64, y: f64, r: f64) -> bool {
    x < r || y < r || x > ARENA_W - r || y > ARENA_H - r || WALLS.iter().any(|&(x0, y0, x1, y1)| x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r)
}

/// Whether a shell could fly straight from `a` to `b` without hitting a wall.
fn clear_line(a: (f64, f64), b: (f64, f64)) -> bool {
    let n = (((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt() / 2.0).ceil().max(1.0) as usize;
    (1..n).all(|i| {
        let t = i as f64 / n as f64;
        !in_wall(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, 0.5)
    })
}

impl Tanks {
    fn new(now: u32) -> Self {
        let start = now + arcade::COUNTDOWN_MS;
        let tank = |x: f64, ang: f64| Tank { x, y: ARENA_H / 2.0, ang, hp: TANK_HP, keys: 0, reload_at: 0 };
        Tanks {
            tank: [tank(14.0, 0.0), tank(ARENA_W - 14.0, std::f64::consts::PI)],
            shells: vec![],
            start,
            end: start + arcade::TANK_MS,
            last: start,
        }
    }

    fn input(&mut self, side: u8, value: u16) -> Step {
        self.tank[side as usize].keys = value;
        Step::default()
    }

    /// The bot: with a clear shot, turn toward the other tank, close in and
    /// fire when lined up; with a wall in the way, drive round the side of
    /// the arena to get a clear line.
    fn bot_keys(&self, s: usize, now: u32) -> u16 {
        let (me, them) = (&self.tank[s], &self.tank[1 - s]);
        let clear = clear_line((me.x, me.y), (them.x, them.y));
        let (gx, gy) = if clear {
            (them.x, them.y)
        } else {
            // Round the top or the bottom, whichever is nearer.
            let lane = if me.y < ARENA_H / 2.0 { 8.0 } else { ARENA_H - 8.0 };
            if (me.y - lane).abs() > 4.0 { (me.x, lane) } else { (them.x, lane) }
        };
        let want = (gy - me.y).atan2(gx - me.x);
        let mut diff = want - me.ang;
        while diff > std::f64::consts::PI {
            diff -= std::f64::consts::TAU;
        }
        while diff < -std::f64::consts::PI {
            diff += std::f64::consts::TAU;
        }
        let dist = ((them.x - me.x).powi(2) + (them.y - me.y).powi(2)).sqrt();
        let mut keys = 0;
        if diff > 0.08 {
            keys |= arcade::KEY_RIGHT;
        } else if diff < -0.08 {
            keys |= arcade::KEY_LEFT;
        }
        // Weave every few seconds, so it isn't a sitting duck.
        let weave = (now / 1_700) % 3 == 0;
        if !clear {
            if diff.abs() < 0.6 {
                keys |= arcade::KEY_FORWARD;
            }
        } else if diff.abs() < 0.6 && (dist > 45.0 || weave) {
            keys |= if weave && dist < 45.0 { arcade::KEY_BACK } else { arcade::KEY_FORWARD };
        }
        if clear && diff.abs() < 0.12 {
            keys |= arcade::KEY_FIRE;
        }
        keys
    }

    fn tick(&mut self, now: u32, bot: Option<u8>) -> Step {
        if now < self.start {
            return Step::default();
        }
        if let Some(b) = bot {
            self.tank[b as usize].keys = self.bot_keys(b as usize, now);
        }
        let dt = now.saturating_sub(self.last).min(250) as f64 / 1000.0;
        self.last = now;
        for t in self.tank.iter_mut() {
            if t.hp == 0 {
                continue;
            }
            if t.keys & arcade::KEY_LEFT != 0 {
                t.ang -= TANK_TURN * dt;
            }
            if t.keys & arcade::KEY_RIGHT != 0 {
                t.ang += TANK_TURN * dt;
            }
            let dir = (t.keys & arcade::KEY_FORWARD != 0) as i32 - (t.keys & arcade::KEY_BACK != 0) as i32;
            if dir != 0 {
                let (dx, dy) = (t.ang.cos() * TANK_SPEED * dt * dir as f64, t.ang.sin() * TANK_SPEED * dt * dir as f64);
                // Slide along walls: each axis on its own.
                if !in_wall(t.x + dx, t.y, TANK_R) {
                    t.x += dx;
                }
                if !in_wall(t.x, t.y + dy, TANK_R) {
                    t.y += dy;
                }
            }
        }
        for s in 0..2 {
            let t = &mut self.tank[s];
            if t.hp > 0 && t.keys & arcade::KEY_FIRE != 0 && now >= t.reload_at {
                t.reload_at = now + RELOAD_MS;
                let (c, sn) = (t.ang.cos(), t.ang.sin());
                self.shells.push(Shell {
                    x: t.x + c * (TANK_R + 2.0),
                    y: t.y + sn * (TANK_R + 2.0),
                    vx: c * SHELL_SPEED,
                    vy: sn * SHELL_SPEED,
                    owner: s,
                    until: now + SHELL_MS,
                });
            }
        }
        // Shells fly in small steps, stopping at walls or a tank.
        let tanks = &mut self.tank;
        self.shells.retain_mut(|sh| {
            for _ in 0..4 {
                sh.x += sh.vx * dt / 4.0;
                sh.y += sh.vy * dt / 4.0;
                if in_wall(sh.x, sh.y, 0.5) || now > sh.until {
                    return false;
                }
                let target = &mut tanks[1 - sh.owner];
                if target.hp > 0 && (target.x - sh.x).powi(2) + (target.y - sh.y).powi(2) < (TANK_R + 1.0).powi(2) {
                    target.hp -= 1;
                    return false;
                }
            }
            true
        });
        let (a, b) = (self.tank[0].hp, self.tank[1].hp);
        let over = if a == 0 || b == 0 || now >= self.end { result(a as u32, b as u32) } else { None };
        Step { changed: true, over }
    }

    /// Start and end, then each tank (x, y in tenths, angle in thousandths
    /// of a radian, health), then the shells in flight (x, y in tenths).
    fn data(&self) -> Vec<u16> {
        let mut d = vec![];
        d.extend(split(self.start));
        d.extend(split(self.end));
        for t in &self.tank {
            let ang = t.ang.rem_euclid(std::f64::consts::TAU);
            d.extend([(t.x * 10.0) as u16, (t.y * 10.0) as u16, (ang * 1000.0) as u16, t.hp]);
        }
        d.push(self.shells.len() as u16);
        for sh in &self.shells {
            d.extend([(sh.x * 10.0).max(0.0) as u16, (sh.y * 10.0).max(0.0) as u16]);
        }
        d
    }
}

// ---- the instance's side ---------------------------------------------------------------

impl Instance {
    fn arcade_send(&mut self, cab: u8) {
        let Some(c) = self.cabinets.get(cab as usize) else {
            return;
        };
        let (msg, cell) = (c.state(cab), self.cell_of(c.tile));
        self.broadcast(cell, &msg, None);
    }

    /// A newcomer sees every cabinet as it is.
    pub(super) fn arcade_hello(&mut self, id: u32) {
        let msgs: Vec<ServerMsg> = self.cabinets.iter().enumerate().map(|(i, c)| c.state(i as u8)).collect();
        for m in msgs {
            self.send_to(id, &m);
        }
    }

    pub(super) fn arcade_join(&mut self, id: u32, cab: u8, vs_bot: bool, now: u32) {
        let Some(c) = self.cabinets.get_mut(cab as usize) else {
            return;
        };
        let start = |c: &mut Cabinet, a: u32, b: u32| {
            c.a = a;
            c.b = b;
            c.game = Game::new(c.kind, now);
            c.status = arcade::PLAYING;
            c.bot_at = now + BOT_DELAY_MS;
            c.t0 = now;
        };
        match c.status {
            arcade::PLAYING => return,
            arcade::WAITING if c.a != id && !vs_bot => {
                let a = c.a;
                start(c, a, id);
            }
            _ if vs_bot => start(c, id, arcade::BOT),
            _ => {
                c.a = id;
                c.b = 0;
                c.status = arcade::WAITING;
            }
        }
        // Dancers step up onto the pads as the dance begins.
        let c = &self.cabinets[cab as usize];
        if c.status == arcade::PLAYING
            && let Some(pads) = c.pads
        {
            for (id, pad) in [(c.a, pads[0]), (c.b, pads[1])] {
                self.put_on_pad(id, pad, now);
            }
        }
        self.arcade_send(cab);
    }

    pub(super) fn arcade_leave(&mut self, id: u32, cab: Option<u8>) {
        let cabs: Vec<u8> = (0..self.cabinets.len() as u8).filter(|&i| cab.is_none_or(|c| c == i)).collect();
        for i in cabs {
            let c = &mut self.cabinets[i as usize];
            if c.a != id && c.b != id {
                continue;
            }
            match c.status {
                arcade::PLAYING => {
                    let status = if c.a == id { arcade::B_WON } else { arcade::A_WON };
                    self.arcade_end(i, status);
                }
                arcade::WAITING => {
                    c.status = arcade::EMPTY;
                    c.a = 0;
                    self.arcade_send(i);
                }
                _ => {}
            }
        }
    }

    pub(super) fn arcade_input(&mut self, id: u32, cab: u8, value: u16, now: u32) {
        let Some(c) = self.cabinets.get_mut(cab as usize) else {
            return;
        };
        if c.status != arcade::PLAYING || (c.a != id && c.b != id) {
            return;
        }
        let side = if c.a == id { 0 } else { 1 };
        let step = c.game.input(side, value, now);
        // A real-time game's state still describes its last tick (the ball
        // and the tanks only move on there): stamping it with now made
        // screens carry the ball on from the wrong moment, and it hopped.
        if !c.game.realtime() {
            c.t0 = now;
            if step.changed {
                c.bot_at = now + BOT_DELAY_MS;
            }
        }
        self.arcade_after(cab, step);
    }

    fn arcade_after(&mut self, cab: u8, step: Step) {
        if let Some(status) = step.over {
            self.arcade_end(cab, status);
        } else if step.changed {
            self.arcade_send(cab);
        }
    }

    /// Moves a dancer straight onto their pad, facing the machine.
    fn put_on_pad(&mut self, id: u32, pad: TilePos, now: u32) {
        let Some(a) = self.avatars.get(&id) else { return };
        if a.state == commons_protocol::state::SITTING {
            self.stand(id, now);
        }
        let a = self.avatars.get_mut(&id).unwrap();
        a.motion = None;
        a.pending = None;
        let moved = a.tile != pad;
        a.tile = pad;
        if moved {
            self.on_tile_changed(id, now);
        }
        let cell = self.avatars[&id].cell;
        self.broadcast(cell, &ServerMsg::Snap { id, x: pad.0, y: pad.1 }, None);
    }

    /// A dancer who walks off the floor gives the dance to the other side.
    fn walked_off(&self, cab: usize) -> Option<u8> {
        let c = &self.cabinets[cab];
        let pads = c.pads?;
        for (side, id) in [c.a, c.b].into_iter().enumerate() {
            let Some(a) = self.avatars.get(&id) else { continue };
            let pad = pads[side];
            let far = (a.tile.0 as i32 - pad.0 as i32).abs().max((a.tile.1 as i32 - pad.1 as i32).abs()) > PAD_RANGE;
            if far {
                return Some(if side == 0 { arcade::B_WON } else { arcade::A_WON });
            }
        }
        None
    }

    /// Real-time games run on; bots take their turns.
    pub(super) fn arcade_tick(&mut self, now: u32) {
        for cab in 0..self.cabinets.len() as u8 {
            if self.cabinets[cab as usize].status == arcade::PLAYING
                && let Some(status) = self.walked_off(cab as usize)
            {
                self.arcade_end(cab, status);
                continue;
            }
            let c = &mut self.cabinets[cab as usize];
            if c.status != arcade::PLAYING {
                continue;
            }
            let bot = [c.a, c.b].iter().position(|&p| p == arcade::BOT).map(|s| s as u8);
            let mut step = c.game.tick(now, bot);
            if step.changed {
                c.t0 = now;
                c.bot_at = c.bot_at.max(now + BOT_DELAY_MS / 2);
            }
            if step.over.is_none()
                && !c.game.realtime()
                && bot == Some(c.game.turn())
                && now >= c.bot_at
                && let Some(mv) = c.game.bot_move()
            {
                let side = c.game.turn();
                let s = c.game.input(side, mv, now);
                c.t0 = now;
                c.bot_at = now + BOT_DELAY_MS;
                step.changed |= s.changed;
                step.over = s.over;
            }
            self.arcade_after(cab, step);
        }
    }

    /// The game's over: tell everyone, and hand out tickets.
    fn arcade_end(&mut self, cab: u8, status: u8) {
        let c = &mut self.cabinets[cab as usize];
        c.status = status;
        let (a, b) = (c.a, c.b);
        let vs_bot = a == arcade::BOT || b == arcade::BOT;
        self.arcade_send(cab);
        for (side, id) in [(0u8, a), (1u8, b)] {
            if id == arcade::BOT || id == 0 {
                continue;
            }
            let won = (status == arcade::A_WON && side == 0) || (status == arcade::B_WON && side == 1);
            // Tickets are for winning.
            if won {
                self.give_tickets(id, if vs_bot { arcade::TICKETS_WIN_BOT } else { arcade::TICKETS_WIN });
            }
        }
    }

    fn give_tickets(&mut self, id: u32, n: i32) {
        let (Some(econ), Some(a)) = (self.economy.clone(), self.avatars.get(&id)) else {
            return;
        };
        let player = a.player_id.clone();
        let key = self.next_key("tickets");
        self.spawn_call(
            async move { econ.grant(&player, arcade::TICKET, n, "arcade", &key).await },
            move |inst, result| match result {
                Ok(applied) if inst.avatars.contains_key(&id) => inst.send_granted(id, &applied),
                Ok(_) | Err(CallError::Rejected(_)) | Err(CallError::Unavailable) => {}
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::ClientMsg;
    use commons_sim::map::MapObject;
    use std::sync::Arc;

    #[test]
    fn connect_four_finds_a_win_and_blocks_one() {
        let mut g = Connect4::default();
        // a has three in a row along the bottom; b to move must block.
        for col in [0, 1, 2] {
            g.drop(col, 1);
        }
        g.turn = 1;
        assert_eq!(g.best(), Some(3));
        // and takes a win of its own when it has one
        let mut g = Connect4::default();
        for _ in 0..3 {
            g.drop(5, 2);
        }
        g.turn = 1;
        assert_eq!(g.best(), Some(5));
    }

    #[test]
    fn contests_keep_scores_believable() {
        let mut g = Contest::new(arcade::CATCH, 0);
        let start = g.start;
        // Before the start nothing counts; a big jump is cut down to size.
        assert!(!g.input(0, arcade::SCORE_FLAG + 2, start - 1_000).changed);
        g.input(0, arcade::SCORE_FLAG + 500, start + 1_000);
        assert!(g.score[0] <= 3 + 3 * 1_000 / 400, "{}", g.score[0]);
        // And the time limit decides it.
        let s = g.tick(g.end, None);
        assert_eq!(s.over, Some(arcade::A_WON));
    }

    #[test]
    fn the_first_racer_over_the_line_wins() {
        let mut g = Contest::new(arcade::RACER, 0);
        let mut t = g.start;
        let mut over = None;
        while over.is_none() && t < g.end {
            t += 100;
            over = g.tick(t, Some(1)).over;
        }
        assert_eq!(over, Some(arcade::B_WON), "the bot finishes the course");
        assert!(g.finished[1]);
    }

    #[test]
    fn dancers_step_onto_the_pads_and_walking_off_loses() {
        let mut m = map(26, 16);
        m.objects = vec![
            MapObject { kind: "dance_machine".into(), x: 2, y: 7, w: 4, h: 2, label: Some("Dance Off".into()) },
            MapObject { kind: "dance_floor".into(), x: 2, y: 9, w: 4, h: 1, label: None },
        ];
        let mut inst = instance_for(Arc::new(ZoneDef::new("arcade".into(), m, None)));
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        inst.handle(Cmd::Msg { conn: 1, msg: ClientMsg::ArcadeJoin { cab: 0, vs_bot: true } });
        assert_eq!(inst.avatars[&1].tile, (3, 9), "on the left pad");
        // Walk off across the room.
        place(&mut inst, 1, (15, 9));
        let now = inst.clock.now_ms();
        inst.arcade_tick(now + 100);
        inst.flush();
        a.pump();
        let last = a.log.iter().rev().find_map(|m| match m {
            ServerMsg::ArcadeState { status, .. } => Some(*status),
            _ => None,
        });
        assert_eq!(last, Some(arcade::B_WON), "walking off hands the bot the win");
    }

    #[test]
    fn tanks_drive_shoot_and_lose_health() {
        let mut g = Tanks::new(0);
        let start = g.start;
        // a sits still; the bot hunts it down.
        let mut over = None;
        let mut t = start;
        while over.is_none() && t < start + 60_000 {
            t += 100;
            over = g.tick(t, Some(1)).over;
        }
        assert_eq!(over, Some(arcade::B_WON));
        assert_eq!(g.tank[0].hp, 0);
    }

    #[test]
    fn light_cycles_crash_into_the_wall() {
        let mut g = Cycles::new(0);
        g.input(0, 0); // a turns up
        let mut over = None;
        for t in 0..100 {
            let s = g.tick(2000 + t, Some(1));
            if s.over.is_some() {
                over = s.over;
                break;
            }
        }
        assert_eq!(over, Some(arcade::B_WON), "a rode into the top wall; the bot kept clear");
    }

    #[test]
    fn pong_scores_when_the_ball_gets_past() {
        let mut g = Pong::new(0);
        g.tick(1500, None); // served toward b
        g.paddle[1] = 14.0; // b's paddle far from the ball
        g.vy = 0.0;
        let mut t = 1500;
        while g.score == [0, 0] && t < 10_000 {
            t += 100;
            g.tick(t, None);
        }
        assert_eq!(g.score, [1, 0]);
    }

    #[test]
    fn a_game_against_the_bot_is_played_out() {
        let mut m = map(22, 14);
        m.objects = vec![MapObject {
            kind: "arcade_cabinet".into(),
            x: 2,
            y: 1,
            w: 2,
            h: 2,
            label: Some("Connect Four".into()),
        }];
        let mut inst = instance_for(Arc::new(ZoneDef::new("arcade".into(), m, None)));
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::ArcadeJoin { cab: 0, vs_bot: true },
        });
        // We keep dropping in column 0; the bot answers each time.
        let mut now = inst.clock.now_ms();
        for _ in 0..30 {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::ArcadeInput { cab: 0, value: 0 },
            });
            now += 2000;
            inst.arcade_tick(now);
        }
        inst.flush();
        a.pump();
        let last = a.log.iter().rev().find_map(|m| match m {
            ServerMsg::ArcadeState { status, .. } => Some(*status),
            _ => None,
        });
        assert_eq!(last, Some(arcade::B_WON), "the bot wins against a column-zero spammer");
    }
}
