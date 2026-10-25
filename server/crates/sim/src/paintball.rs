//! Paintball at the Splat Yard: Blue against Red, three a side (bots fill
//! the empty places), on a fenced field of bunkers, hay bales, crates, tyres,
//! steel drums and hedges. Three hits and you're out: back to your base, and
//! a point to the other side. First to ten wins.
//!
//! Everything is in field tiles (the field's top-left corner is 0,0; a
//! tile's middle is .5). People move themselves (the client says where it
//! is; `claim_move` checks it could have got there) and say when they fire
//! (`fire` checks the rate and the hopper); the balls, the hits, the bots,
//! the power-ups and the score are all decided here. The client runs the
//! same ball flight (`Ball::advance`) so a shot looks the same everywhere.
//!
//! The twists: a dodge roll (a burst of speed, untouchable while it lasts);
//! power-ups on two pads (rapid fire, a three-ball spread, a shield, balls
//! that bounce); steel drums that always send a ball back off them; hedges
//! you can hide in (until you shoot or someone comes close); and three outs
//! in a row without going out yourself sets you On Fire (quicker shots, a
//! blazing trail) until somebody shuts you down.

use std::f64::consts::{PI, TAU};

/// Places: 0–2 Blue, 3–5 Red.
pub const SLOTS: usize = 6;
pub const BLUE: u8 = 0;
pub const RED: u8 = 1;
/// `Match::status`.
pub const LOBBY: u8 = 0;
pub const COUNTDOWN: u8 = 1;
pub const PLAYING: u8 = 2;
pub const OVER: u8 = 3;
/// The bots, as player ids (one per place).
pub const BOT_BASE: u32 = 0xffff_ff10;

pub const TO_WIN: u8 = 10;
pub const HP: u8 = 3;
pub const HOPPER: u8 = 12;
pub const RELOAD_MS: u32 = 1300;
/// How early a shot after a reload is still taken (the client finishes it on its own clock).
pub const RELOAD_SLACK_MS: u32 = 200;
pub const FIRE_MS: u32 = 170;
/// On Fire, and with Rapid.
pub const FIRE_HOT_MS: u32 = 125;
pub const FIRE_RAPID_MS: u32 = 85;
pub const SPEED: f64 = 4.8;
pub const DASH_SPEED: f64 = 15.0;
pub const DASH_MS: u32 = 170;
pub const DASH_CD_MS: u32 = 2400;
pub const BALL_SPEED: f64 = 17.0;
/// How far a ball flies (tiles), and how fine its flight is checked.
pub const RANGE: f64 = 14.5;
pub const BALL_STEP: f64 = 0.2;
pub const BALL_R: f64 = 0.12;
pub const PLAYER_R: f64 = 0.3;
/// How close a ball has to pass to splat someone (a little generous: you
/// see others a beat behind).
pub const HIT_R: f64 = 0.46;
/// The muzzle: balls start this far out in front.
pub const MUZZLE: f64 = 0.45;
/// A spread's outer balls, either side of the aim (radians).
pub const SPREAD: f64 = 0.15;
pub const RESPAWN_MS: u32 = 3000;
pub const SPAWN_SHIELD_MS: u32 = 1600;
pub const REGEN_DELAY_MS: u32 = 5000;
pub const REGEN_EVERY_MS: u32 = 2500;
pub const COUNTDOWN_MS: u32 = 3500;
pub const RESULTS_MS: u32 = 9000;
pub const MATCH_MS: u32 = 8 * 60_000;
pub const PAD_EVERY_MS: u32 = 12_000;
pub const STREAK_HOT: u8 = 3;
/// In a hedge you're hidden, unless you shot this recently or an enemy is this close.
pub const HIDE_AFTER_SHOT_MS: u32 = 1200;
pub const REVEAL_R: f64 = 2.2;

/// Obstacles (`pb_*` map objects).
pub mod ob {
    pub const HAY: u8 = 1;
    pub const CRATE: u8 = 2;
    pub const TIRES: u8 = 3;
    /// Steel: balls always glance off it.
    pub const DRUM: u8 = 4;
    pub const SNAKE: u8 = 5;
    pub const XBUNK: u8 = 6;
    /// Walk and shoot through it; hides you.
    pub const HEDGE: u8 = 7;
}

/// Power-ups (`Player::power`, a pad's kind).
pub mod power {
    pub const NONE: u8 = 0;
    pub const RAPID: u8 = 1;
    pub const SPREAD: u8 = 2;
    pub const SHIELD: u8 = 3;
    pub const BOUNCE: u8 = 4;
    pub const ALL: [u8; 4] = [RAPID, SPREAD, SHIELD, BOUNCE];
    /// How long each lasts (ms).
    pub fn lasts(kind: u8) -> u32 {
        match kind {
            RAPID => 7000,
            SPREAD => 8000,
            SHIELD => 12_000,
            BOUNCE => 9000,
            _ => 0,
        }
    }
}

/// `Event::kind` (protocol `PbEvent`).
pub mod ev {
    /// `a` hit `b` (one paint off), at x,y; `n` the ball.
    pub const HIT: u8 = 1;
    /// `a` put `b` out; `n` is `a`'s streak now.
    pub const OUT: u8 = 2;
    /// `b`'s shield took `a`'s ball.
    pub const SHIELDED: u8 = 3;
    /// `a` picked up power `b` (from the pad at x,y).
    pub const PICKUP: u8 = 5;
    /// A power-up `b` appeared on the pad at x,y.
    pub const PAD: u8 = 6;
    /// `a` ended `b`'s streak of `n`.
    pub const SHUTDOWN: u8 = 7;
    /// Team `a` is one away.
    pub const MATCH_POINT: u8 = 8;
    /// `a` is back in, at x,y.
    pub const RESPAWN: u8 = 9;
    /// `a` rolled, from x,y.
    pub const DASH: u8 = 10;
    /// The countdown's done: go!
    pub const START: u8 = 11;
    /// Over: `a` the winners (`BLUE`, `RED`, or 2 for a draw).
    pub const END: u8 = 12;
    /// `a` is reloading.
    pub const RELOAD: u8 = 13;
    /// `a` went On Fire.
    pub const HOT: u8 = 14;
}

/// A flag in `Player::flags` (protocol `PbPlayer.flags`).
pub mod flag {
    pub const OUT: u8 = 1;
    pub const SPAWN_SHIELD: u8 = 2;
    pub const DASHING: u8 = 4;
    pub const HIDDEN: u8 = 8;
    pub const HOT: u8 = 16;
    pub const RELOADING: u8 = 32;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Obstacle {
    pub kind: u8,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Obstacle {
    pub fn blocks(&self) -> bool {
        self.kind != ob::HEDGE
    }
    fn contains(&self, x: f64, y: f64, pad: f64) -> bool {
        x > self.x - pad
            && x < self.x + self.w + pad
            && y > self.y - pad
            && y < self.y + self.h + pad
    }
}

/// The obstacle kind for a map object's kind (`pb_hay` …).
pub fn obstacle_kind(name: &str) -> Option<u8> {
    Some(match name {
        "pb_hay" => ob::HAY,
        "pb_crate" => ob::CRATE,
        "pb_tires" => ob::TIRES,
        "pb_drum" => ob::DRUM,
        "pb_snake" => ob::SNAKE,
        "pb_x" => ob::XBUNK,
        "pb_hedge" => ob::HEDGE,
        _ => return None,
    })
}

/// The field: its size, what's on it, where each side comes in, and the pads.
#[derive(Debug, Clone)]
pub struct Field {
    pub w: f64,
    pub h: f64,
    pub obstacles: Vec<Obstacle>,
    pub spawns: [Vec<(f64, f64)>; 2],
    pub pads: Vec<(f64, f64)>,
}

impl Field {
    /// Whether a circle of radius `r` at (x, y) is clear of everything that blocks, and on the field.
    pub fn free(&self, x: f64, y: f64, r: f64) -> bool {
        x >= r
            && y >= r
            && x <= self.w - r
            && y <= self.h - r
            && !self
                .obstacles
                .iter()
                .any(|o| o.blocks() && circle_hits(o, x, y, r))
    }

    /// Moving a body of radius `r` by (dx, dy), sliding along whatever it runs into.
    pub fn slide(&self, x: f64, y: f64, dx: f64, dy: f64, r: f64) -> (f64, f64) {
        let len = dx.hypot(dy);
        let n = (len / 0.15).ceil().max(1.0);
        let (sx, sy) = (dx / n, dy / n);
        let (mut x, mut y) = (x, y);
        for _ in 0..n as usize {
            if self.free(x + sx, y, r) {
                x += sx;
            }
            if self.free(x, y + sy, r) {
                y += sy;
            }
        }
        (x, y)
    }

    /// Whether nothing that stops a ball lies between a and b.
    pub fn clear_line(&self, ax: f64, ay: f64, bx: f64, by: f64) -> bool {
        let len = (bx - ax).hypot(by - ay);
        let n = (len / 0.25).ceil().max(1.0) as usize;
        (1..n).all(|i| {
            let t = i as f64 / n as f64;
            let (x, y) = (ax + (bx - ax) * t, ay + (by - ay) * t);
            !self
                .obstacles
                .iter()
                .any(|o| o.blocks() && o.contains(x, y, 0.0))
        })
    }

    /// The hedge (x, y) is in, if any.
    pub fn in_hedge(&self, x: f64, y: f64) -> bool {
        self.obstacles
            .iter()
            .any(|o| o.kind == ob::HEDGE && o.contains(x, y, -0.1))
    }

    fn cols(&self) -> usize {
        self.w.ceil() as usize
    }
    fn rows(&self) -> usize {
        self.h.ceil() as usize
    }
    /// The tiles a body can stand in the middle of.
    fn open_tile(&self, cx: usize, cy: usize) -> bool {
        self.free(cx as f64 + 0.5, cy as f64 + 0.5, PLAYER_R + 0.05)
    }
}

impl Field {
    /// The field laid out by a map's `pb_*` objects, and where its corner is
    /// (map tiles): obstacles, spawns (`pb_spawn` labelled blue or red),
    /// pads; None without a `pb_field`.
    pub fn from_map(objects: &[crate::map::MapObject]) -> Option<(Field, (u16, u16))> {
        let f = objects.iter().find(|o| o.kind == "pb_field")?;
        let (ox, oy) = (f.x as f64, f.y as f64);
        let mut field = Field {
            w: f.w as f64,
            h: f.h as f64,
            obstacles: Vec::new(),
            spawns: [Vec::new(), Vec::new()],
            pads: Vec::new(),
        };
        for o in objects {
            let (x, y) = (o.x as f64 - ox, o.y as f64 - oy);
            if let Some(kind) = obstacle_kind(&o.kind) {
                field.obstacles.push(Obstacle {
                    kind,
                    x,
                    y,
                    w: o.w as f64,
                    h: o.h as f64,
                });
            } else if o.kind == "pb_spawn" {
                let t = if o.label.as_deref() == Some("red") {
                    1
                } else {
                    0
                };
                field.spawns[t].push((x + 0.5, y + 0.5));
            } else if o.kind == "pb_pad" {
                field
                    .pads
                    .push((x + o.w as f64 / 2.0, y + o.h as f64 / 2.0));
            }
        }
        Some((field, (f.x, f.y)))
    }
}

fn circle_hits(o: &Obstacle, x: f64, y: f64, r: f64) -> bool {
    let nx = x.clamp(o.x, o.x + o.w);
    let ny = y.clamp(o.y, o.y + o.h);
    (x - nx).powi(2) + (y - ny).powi(2) < r * r
}

/// A ball in flight.
#[derive(Debug, Clone)]
pub struct Ball {
    pub by: u32,
    pub team: u8,
    /// The shot, and which of a spread's three (top bits).
    pub n: u16,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    /// How far it has left to go (tiles).
    pub left: f64,
    /// Bounces it may still make off anything (drums don't count).
    pub bounces: u8,
}

/// What a ball ran into this step.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Flight {
    Flying,
    /// Splatted on a wall or the ground, at x,y.
    Splat(f64, f64),
    /// Reached someone (by index) at x,y.
    Hit(usize, f64, f64),
}

impl Ball {
    /// A ball (or one of a spread) leaving a marker at (x, y) aimed `aim`.
    pub fn new(by: u32, team: u8, n: u16, x: f64, y: f64, aim: f64, bounce: bool) -> Ball {
        let (c, s) = (aim.cos(), aim.sin());
        Ball {
            by,
            team,
            n,
            x: x + c * MUZZLE,
            y: y + s * MUZZLE,
            vx: c,
            vy: s,
            left: RANGE,
            bounces: if bounce { 1 } else { 0 },
        }
    }

    /// Flies `dist` tiles on (in `BALL_STEP`s), off drums and (with bounces
    /// left) walls; `hit` says whether a body at a point is splatted.
    pub fn advance(
        &mut self,
        field: &Field,
        dist: f64,
        mut hit: impl FnMut(f64, f64) -> Option<usize>,
    ) -> Flight {
        let mut todo = dist;
        while todo > 1e-9 {
            if self.left <= 1e-9 {
                return Flight::Splat(self.x, self.y);
            }
            let step = todo.min(BALL_STEP).min(self.left);
            todo -= step;
            let (px, py) = (self.x, self.y);
            let (nx, ny) = (px + self.vx * step, py + self.vy * step);
            self.left -= step;
            // The field's edge (its netting): a splat.
            if nx < 0.0 || ny < 0.0 || nx > field.w || ny > field.h {
                if self.bounces > 0 {
                    self.bounces -= 1;
                    if nx < 0.0 || nx > field.w {
                        self.vx = -self.vx;
                    } else {
                        self.vy = -self.vy;
                    }
                    continue;
                }
                return Flight::Splat(px.clamp(0.0, field.w), py.clamp(0.0, field.h));
            }
            if let Some(o) = field
                .obstacles
                .iter()
                .find(|o| o.blocks() && o.contains(nx, ny, BALL_R))
            {
                if o.kind == ob::DRUM || self.bounces > 0 {
                    if o.kind != ob::DRUM {
                        self.bounces -= 1;
                    }
                    // Off whichever face it came in through.
                    let inside_x = px > o.x - BALL_R && px < o.x + o.w + BALL_R;
                    if inside_x {
                        self.vy = -self.vy;
                    } else {
                        self.vx = -self.vx;
                    }
                    continue;
                }
                return Flight::Splat(px, py);
            }
            self.x = nx;
            self.y = ny;
            if let Some(i) = hit(nx, ny) {
                return Flight::Hit(i, nx, ny);
            }
            if self.left <= 1e-9 {
                return Flight::Splat(self.x, self.y);
            }
        }
        Flight::Flying
    }
}

/// How a bot plays, by level (`crate::level`): how quick it is to open
/// fire on someone it sees, how steady its aim and how well it leads a
/// runner, how far it sees, how long its bursts and breathers, how often it
/// rolls out of a ball's way, how fast it moves, how far it goes for a
/// power-up.
struct Skill {
    /// Before it shoots at someone new (ms: base, plus up to).
    react: (f64, f64),
    /// Aim drift: how much each shot, at most.
    wobble: (f64, f64),
    sight: f64,
    /// How much of a runner's run it aims ahead.
    lead: f64,
    /// Shots a burst (base, plus up to), and the breather after (ms: base, plus up to).
    burst: (u8, f64),
    pause: (f64, f64),
    /// Slower than the gun allows, between shots in a burst (ms: base, plus up to).
    slack: (f64, f64),
    /// Its chance of rolling out of a ball's way.
    dodge: f64,
    /// Of full speed.
    speed: f64,
    pad_r: f64,
    /// Back off to this far when it's down to its last hit.
    wary: f64,
}

fn skill(level: u8) -> Skill {
    match level {
        crate::level::EASY => Skill {
            react: (700.0, 650.0),
            wobble: (0.5, 0.55),
            sight: 10.0,
            lead: 0.15,
            burst: (2, 2.0),
            pause: (1100.0, 1000.0),
            slack: (170.0, 260.0),
            dodge: 0.04,
            speed: 0.78,
            pad_r: 8.0,
            wary: 6.5,
        },
        crate::level::HARD => Skill {
            react: (170.0, 170.0),
            wobble: (0.15, 0.16),
            sight: 14.5,
            lead: 1.0,
            burst: (4, 3.0),
            pause: (380.0, 380.0),
            slack: (20.0, 80.0),
            dodge: 0.7,
            speed: 0.98,
            pad_r: 17.0,
            wary: 10.0,
        },
        _ => Skill {
            react: (380.0, 380.0),
            wobble: (0.3, 0.32),
            sight: 13.0,
            lead: 0.8,
            burst: (3, 3.0),
            pause: (650.0, 700.0),
            slack: (60.0, 160.0),
            dodge: 0.3,
            speed: 0.92,
            pad_r: 14.0,
            wary: 9.0,
        },
    }
}

/// What a bot is up to.
#[derive(Debug, Clone, Default)]
pub struct Ai {
    target: Option<u32>,
    /// It reacts to a new target only after this.
    react_at: u32,
    strafe: f64,
    strafe_until: u32,
    /// Where it's heading when it has nobody to shoot at, and its way there.
    goal: Option<(usize, usize)>,
    goal_until: u32,
    nav: Vec<u16>,
    next_fire: u32,
    /// A little off with each shot (radians), drifting.
    wobble: f64,
    /// Shots left in this burst (then a breather).
    burst: u8,
}

#[derive(Debug, Clone)]
pub struct Player {
    pub id: u32,
    pub team: u8,
    pub bot: bool,
    pub x: f64,
    pub y: f64,
    pub aim: f64,
    pub hp: u8,
    pub ammo: u8,
    /// Reloading until (0: not).
    pub reload_until: u32,
    pub last_fire: u32,
    pub dash_until: u32,
    pub dash_ready: u32,
    pub out: bool,
    pub respawn_at: u32,
    pub shield_until: u32,
    pub power: u8,
    pub power_until: u32,
    /// Hits a Shield power-up still takes.
    pub shield_hits: u8,
    pub last_hit: u32,
    pub next_regen: u32,
    pub kills: u8,
    pub deaths: u8,
    pub streak: u8,
    /// Bumped whenever it's put somewhere (respawned, or corrected): the
    /// client takes the server's word for where it is then.
    pub fix: u8,
    /// When we last heard where it is, and how fast it's going (for the bots to lead it).
    pub moved_at: u32,
    /// Shots in hand (see `fire`), as of when.
    pub fire_credit: f64,
    pub credit_at: u32,
    pub vx: f64,
    pub vy: f64,
    pub hidden: bool,
    pub ai: Ai,
}

impl Player {
    fn new(id: u32, team: u8, bot: bool, at: (f64, f64)) -> Player {
        Player {
            id,
            team,
            bot,
            x: at.0,
            y: at.1,
            aim: if team == BLUE { 0.0 } else { PI },
            hp: HP,
            ammo: HOPPER,
            reload_until: 0,
            last_fire: 0,
            dash_until: 0,
            dash_ready: 0,
            out: false,
            respawn_at: 0,
            shield_until: 0,
            power: 0,
            power_until: 0,
            shield_hits: 0,
            last_hit: 0,
            next_regen: 0,
            kills: 0,
            deaths: 0,
            streak: 0,
            fix: 0,
            moved_at: 0,
            fire_credit: 3.0,
            credit_at: 0,
            vx: 0.0,
            vy: 0.0,
            hidden: false,
            ai: Ai::default(),
        }
    }

    pub fn hot(&self) -> bool {
        self.streak >= STREAK_HOT
    }

    pub fn flags(&self, now: u32) -> u8 {
        let mut f = 0;
        if self.out {
            f |= flag::OUT;
        }
        if now < self.shield_until {
            f |= flag::SPAWN_SHIELD;
        }
        if now < self.dash_until {
            f |= flag::DASHING;
        }
        if self.hidden {
            f |= flag::HIDDEN;
        }
        if self.hot() {
            f |= flag::HOT;
        }
        if self.reload_until > now {
            f |= flag::RELOADING;
        }
        f
    }

    /// The shortest gap between shots for it now.
    pub fn fire_ms(&self, now: u32) -> u32 {
        if self.power == power::RAPID && now < self.power_until {
            FIRE_RAPID_MS
        } else if self.hot() {
            FIRE_HOT_MS
        } else {
            FIRE_MS
        }
    }

    fn powered(&self, kind: u8, now: u32) -> bool {
        self.power == kind && now < self.power_until
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Event {
    pub kind: u8,
    pub a: u32,
    pub b: u32,
    pub x: f64,
    pub y: f64,
    pub n: u16,
}

/// A shot fired (protocol `PbShot`), for everyone to fly the same.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shot {
    pub by: u32,
    pub n: u16,
    pub x: f64,
    pub y: f64,
    pub aim: f64,
    /// Bit 0: bouncing; bit 1: a spread of three.
    pub kind: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pad {
    pub x: f64,
    pub y: f64,
    /// What's on it (`power::*`), 0 for nothing yet.
    pub kind: u8,
    pub next: u32,
}

/// A match (and the lobby before it).
#[derive(Debug, Clone)]
pub struct Match {
    pub field: Field,
    pub status: u8,
    /// When the countdown, the match (its time limit) or the results end.
    pub phase_end: u32,
    pub score: [u8; 2],
    /// Who has which place (0: free; bots are `BOT_BASE + place`).
    pub slots: [u32; SLOTS],
    pub players: Vec<Player>,
    pub balls: Vec<Ball>,
    pub pads: Vec<Pad>,
    /// The winners when it's over (`BLUE`, `RED`, 2: a draw).
    pub winner: u8,
    /// How good the bots are (`crate::level`), picked in the lobby.
    pub level: u8,
    next_bot_shot: u16,
    match_point: [bool; 2],
}

pub fn team_of_slot(s: usize) -> u8 {
    if s < 3 { BLUE } else { RED }
}

pub fn is_bot(id: u32) -> bool {
    (BOT_BASE..BOT_BASE + SLOTS as u32).contains(&id)
}

/// Angles on the wire: a fraction of a full turn.
pub fn aim_to_u16(a: f64) -> u16 {
    ((a.rem_euclid(TAU) / TAU) * 65536.0).round() as u32 as u16
}
pub fn aim_from_u16(v: u16) -> f64 {
    v as f64 / 65536.0 * TAU
}

impl Match {
    pub fn new(field: Field) -> Match {
        let pads = field
            .pads
            .iter()
            .map(|&(x, y)| Pad {
                x,
                y,
                kind: 0,
                next: 0,
            })
            .collect();
        Match {
            field,
            status: LOBBY,
            phase_end: 0,
            score: [0, 0],
            slots: [0; SLOTS],
            players: Vec::new(),
            balls: Vec::new(),
            pads,
            winner: 2,
            level: crate::level::MEDIUM,
            next_bot_shot: 0,
            match_point: [false; 2],
        }
    }

    pub fn slot_of(&self, id: u32) -> Option<usize> {
        self.slots.iter().position(|&s| s == id && id != 0)
    }

    pub fn player(&self, id: u32) -> Option<&Player> {
        self.players.iter().find(|p| p.id == id)
    }

    fn index(&self, id: u32) -> Option<usize> {
        self.players.iter().position(|p| p.id == id)
    }

    /// Whether `id` is out on the field now (they don't walk about the hall).
    pub fn playing(&self, id: u32) -> bool {
        matches!(self.status, COUNTDOWN | PLAYING) && self.index(id).is_some()
    }

    pub fn humans(&self) -> usize {
        self.slots.iter().filter(|&&s| s != 0 && !is_bot(s)).count()
    }

    /// `id` takes a place on `team` (`2`: whichever has room): a free one,
    /// else a bot's (the bot steps aside). The first to sign up in the lobby
    /// gets bots in all the other places (to take out, or put back, with
    /// `set_bot`). Returns whether they're in.
    pub fn join(&mut self, id: u32, team: u8, now: u32) -> bool {
        if let Some(s) = self.slot_of(id) {
            // Already in: switching sides in the lobby (with a bot, if it takes one's place, swapping over).
            if self.status != LOBBY || team == 2 || team_of_slot(s) == team {
                return true;
            }
            if let Some(f) = self.free_slot(team, true) {
                let had_bot = is_bot(self.slots[f]);
                self.slots[s] = if had_bot { BOT_BASE + s as u32 } else { 0 };
                self.slots[f] = id;
            }
            return true;
        }
        let in_match = matches!(self.status, COUNTDOWN | PLAYING);
        let pick = |m: &Match, t: u8| m.free_slot(t, true);
        let s = match team {
            BLUE | RED => pick(self, team),
            _ => {
                let blue = (0..3)
                    .filter(|&i| self.slots[i] != 0 && !is_bot(self.slots[i]))
                    .count();
                let red = (3..6)
                    .filter(|&i| self.slots[i] != 0 && !is_bot(self.slots[i]))
                    .count();
                let first = if blue <= red { BLUE } else { RED };
                pick(self, first).or_else(|| pick(self, 1 - first))
            }
        };
        let Some(s) = s else { return false };
        let old = self.slots[s];
        self.slots[s] = id;
        if self.status == LOBBY && self.humans() == 1 {
            for k in 0..SLOTS {
                if self.slots[k] == 0 {
                    self.slots[k] = BOT_BASE + k as u32;
                }
            }
        }
        if in_match {
            let t = team_of_slot(s);
            if let Some(i) = self.index(old) {
                self.players.remove(i);
            }
            let at = self.spawn_point(t, s % 3);
            let mut p = Player::new(id, t, false, at);
            p.shield_until = now + SPAWN_SHIELD_MS;
            self.players.push(p);
        }
        true
    }

    /// A place on `team`: a free one, or (in a match) one a bot holds.
    fn free_slot(&self, team: u8, take_bot: bool) -> Option<usize> {
        let range = if team == BLUE { 0..3 } else { 3..6 };
        range.clone().find(|&i| self.slots[i] == 0).or_else(|| {
            if take_bot {
                range.into_iter().find(|&i| is_bot(self.slots[i]))
            } else {
                None
            }
        })
    }

    /// In the lobby, someone with a place puts a bot in place `slot` (`on`) or
    /// takes it out. Returns whether anything changed.
    pub fn set_bot(&mut self, by: u32, slot: usize, on: bool) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() || slot >= SLOTS {
            return false;
        }
        match (on, self.slots[slot]) {
            (true, 0) => self.slots[slot] = BOT_BASE + slot as u32,
            (false, s) if is_bot(s) => self.slots[slot] = 0,
            _ => return false,
        }
        true
    }

    /// In the lobby, someone with a place picks how good the bots are.
    /// Returns whether it changed.
    pub fn set_level(&mut self, by: u32, level: u8) -> bool {
        let level = crate::level::clamp(level);
        if self.status != LOBBY || self.slot_of(by).is_none() || self.level == level {
            return false;
        }
        self.level = level;
        true
    }

    /// Whether each side has someone (a player or a bot): a match can start.
    pub fn sides_filled(&self) -> bool {
        (0..3).any(|i| self.slots[i] != 0) && (3..6).any(|i| self.slots[i] != 0)
    }

    /// `id` leaves: in a match, a bot takes their place (or, with no one
    /// left, it's called off).
    pub fn leave(&mut self, id: u32, now: u32) {
        let Some(s) = self.slot_of(id) else { return };
        let in_match = matches!(self.status, COUNTDOWN | PLAYING);
        self.slots[s] = 0;
        if !in_match {
            // Nobody left in the lobby: the bots go too (and the level's back to medium).
            if self.humans() == 0 {
                self.clear_bots();
                self.level = crate::level::MEDIUM;
            }
            return;
        }
        if self.humans() == 0 {
            self.back_to_lobby();
            return;
        }
        let bot = BOT_BASE + s as u32;
        self.slots[s] = bot;
        if let Some(i) = self.index(id) {
            let old = self.players[i].clone();
            let mut b = Player::new(bot, old.team, true, (old.x, old.y));
            b.hp = old.hp;
            b.out = old.out;
            b.respawn_at = old.respawn_at;
            b.kills = old.kills;
            b.deaths = old.deaths;
            b.shield_until = now + 600;
            self.players[i] = b;
        }
    }

    /// Back to the lobby: the same places (bots and all) for a rematch, unless nobody's left.
    fn back_to_lobby(&mut self) {
        self.status = LOBBY;
        self.players.clear();
        self.balls.clear();
        if self.humans() == 0 {
            self.clear_bots();
        }
        for p in self.pads.iter_mut() {
            p.kind = 0;
        }
    }

    fn clear_bots(&mut self) {
        for s in self.slots.iter_mut() {
            if is_bot(*s) {
                *s = 0;
            }
        }
    }

    /// The match begins (from the lobby): with `bots`, the empty places are
    /// filled; without, each side needs someone. Returns whether it started.
    pub fn start(&mut self, by: u32, bots: bool, now: u32) -> bool {
        if self.status != LOBBY || self.slot_of(by).is_none() {
            return false;
        }
        if bots {
            for s in 0..SLOTS {
                if self.slots[s] == 0 {
                    self.slots[s] = BOT_BASE + s as u32;
                }
            }
        } else if !self.sides_filled() {
            return false;
        }
        self.players = (0..SLOTS)
            .filter(|&s| self.slots[s] != 0)
            .map(|s| {
                let t = team_of_slot(s);
                let id = self.slots[s];
                let mut p = Player::new(id, t, is_bot(id), self.spawn_point(t, s % 3));
                p.ai.react_at = now + COUNTDOWN_MS;
                p
            })
            .collect();
        self.score = [0, 0];
        self.balls.clear();
        self.match_point = [false; 2];
        self.winner = 2;
        for p in self.pads.iter_mut() {
            p.kind = 0;
            p.next = now + COUNTDOWN_MS + 5000;
        }
        self.status = COUNTDOWN;
        self.phase_end = now + COUNTDOWN_MS;
        true
    }

    fn spawn_point(&self, team: u8, k: usize) -> (f64, f64) {
        let sp = &self.field.spawns[team as usize];
        if sp.is_empty() {
            let x = if team == BLUE {
                1.5
            } else {
                self.field.w - 1.5
            };
            return (x, self.field.h / 2.0);
        }
        sp[k % sp.len()]
    }

    /// The client says where it is (and aims): taken if it could have got
    /// there, else as far as it could (and it's told: `fix`).
    pub fn claim_move(&mut self, id: u32, x: f64, y: f64, aim: f64, now: u32) {
        let Some(i) = self.index(id) else { return };
        let p = &mut self.players[i];
        p.aim = aim;
        if self.status != PLAYING || p.out {
            return;
        }
        // (At least 50 ms: moves that reach us in the same tick are still fair.)
        let dt = (now.saturating_sub(p.moved_at)).clamp(50, 500) as f64 / 1000.0;
        let dash = if now < p.dash_until + 250 {
            DASH_SPEED
        } else {
            SPEED
        };
        let allowed = dash * dt * 1.4 + 0.4;
        let (dx, dy) = (x - p.x, y - p.y);
        let d = dx.hypot(dy);
        let (tx, ty) = if d <= allowed {
            (x, y)
        } else {
            (p.x + dx / d * allowed, p.y + dy / d * allowed)
        };
        let ok = d <= allowed && self.field.free(tx, ty, PLAYER_R - 0.05);
        let p = &mut self.players[i];
        if ok {
            p.vx = (tx - p.x) / dt;
            p.vy = (ty - p.y) / dt;
            p.x = tx;
            p.y = ty;
        } else {
            let (sx, sy) = self.field.slide(p.x, p.y, tx - p.x, ty - p.y, PLAYER_R);
            let p = &mut self.players[i];
            p.x = sx;
            p.y = sy;
            p.fix = p.fix.wrapping_add(1);
        }
        self.players[i].moved_at = now;
    }

    /// A roll: quick and untouchable, then a while before the next.
    pub fn dash(&mut self, id: u32, now: u32) -> Option<Event> {
        let i = self.index(id)?;
        let p = &mut self.players[i];
        if self.status != PLAYING || p.out || now < p.dash_ready {
            return None;
        }
        p.dash_until = now + DASH_MS;
        p.dash_ready = now + DASH_CD_MS;
        Some(Event {
            kind: ev::DASH,
            a: id,
            b: 0,
            x: p.x,
            y: p.y,
            n: 0,
        })
    }

    pub fn reload(&mut self, id: u32, now: u32) -> Option<Event> {
        let i = self.index(id)?;
        let p = &mut self.players[i];
        if p.out || p.reload_until > now || p.ammo >= HOPPER {
            return None;
        }
        p.reload_until = now + RELOAD_MS;
        Some(Event {
            kind: ev::RELOAD,
            a: id,
            b: 0,
            x: p.x,
            y: p.y,
            n: 0,
        })
    }

    /// `id` fires shot `n` from (x, y) (near where they are) toward `aim`.
    pub fn fire(&mut self, id: u32, n: u16, x: f64, y: f64, aim: f64, now: u32) -> Option<Shot> {
        let i = self.index(id)?;
        let field = &self.field;
        let p = &mut self.players[i];
        if self.status != PLAYING || p.out || p.reload_until > now + RELOAD_SLACK_MS {
            return None;
        }
        // A reload all but done here is done (the shooter's clock ran it a beat ahead).
        if p.reload_until != 0 {
            p.reload_until = 0;
            p.ammo = HOPPER;
        }
        // The rate: shots earn back a credit each fire_ms (up to a few), so
        // ones the network (or the tick) bunches together still count, but
        // nobody fires faster than the rate for long.
        let gap = p.fire_ms(now) as f64;
        p.fire_credit = (p.fire_credit + now.saturating_sub(p.credit_at) as f64 / gap).min(3.0);
        p.credit_at = now;
        if p.fire_credit < 0.7 {
            return None;
        }
        p.fire_credit -= 1.0;
        let rapid = p.powered(power::RAPID, now);
        if p.ammo == 0 && !rapid {
            return None;
        }
        let (ox, oy) = if (x - p.x).hypot(y - p.y) < 1.2 && field.free(x, y, 0.05) {
            (x, y)
        } else {
            (p.x, p.y)
        };
        p.last_fire = now;
        p.aim = aim;
        if !rapid {
            p.ammo -= 1;
        }
        // Shooting gives you away, and ends the spawn shield.
        p.shield_until = 0;
        p.ai.next_fire = p.ai.next_fire.max(now);
        let bounce = p.powered(power::BOUNCE, now);
        let spread = p.powered(power::SPREAD, now);
        let team = p.team;
        let auto_reload = p.ammo == 0 && !rapid;
        let n = n & 0x0fff;
        if spread {
            for (k, off) in [(0u16, 0.0), (1, -SPREAD), (2, SPREAD)] {
                self.balls
                    .push(Ball::new(id, team, n | k << 12, ox, oy, aim + off, bounce));
            }
        } else {
            self.balls.push(Ball::new(id, team, n, ox, oy, aim, bounce));
        }
        if auto_reload {
            self.players[i].reload_until = now + RELOAD_MS;
        }
        Some(Shot {
            by: id,
            n,
            x: ox,
            y: oy,
            aim,
            kind: bounce as u8 | (spread as u8) << 1,
        })
    }

    /// A tick: the countdown, the bots, the balls, the hits, respawns,
    /// regen, the pads and the score. Returns what happened, and the bots' shots.
    pub fn step(
        &mut self,
        now: u32,
        dt_ms: u32,
        rng: &mut impl FnMut() -> f64,
    ) -> (Vec<Event>, Vec<Shot>) {
        let mut evs = Vec::new();
        let mut shots = Vec::new();
        match self.status {
            COUNTDOWN if now >= self.phase_end => {
                self.status = PLAYING;
                self.phase_end = now + MATCH_MS;
                for p in self.players.iter_mut() {
                    p.moved_at = now;
                    p.shield_until = now + 800;
                }
                evs.push(Event {
                    kind: ev::START,
                    a: 0,
                    b: 0,
                    x: 0.0,
                    y: 0.0,
                    n: 0,
                });
            }
            OVER if now >= self.phase_end => self.back_to_lobby(),
            _ => {}
        }
        if self.status != PLAYING {
            return (evs, shots);
        }
        let dt = dt_ms as f64 / 1000.0;
        // The bots think and move (and shoot).
        for i in 0..self.players.len() {
            if self.players[i].bot {
                self.bot(i, now, dt, rng, &mut shots, &mut evs);
            }
        }
        // Reloads finish; power-ups wear off; paint washes off; the out come back.
        for p in self.players.iter_mut() {
            if p.reload_until != 0 && now >= p.reload_until {
                p.reload_until = 0;
                p.ammo = HOPPER;
            }
            if p.power != 0 && now >= p.power_until {
                p.power = 0;
                p.shield_hits = 0;
            }
            if p.out && now >= p.respawn_at {
                p.out = false;
                p.hp = HP;
                p.ammo = HOPPER;
                p.reload_until = 0;
                p.shield_until = now + SPAWN_SHIELD_MS;
                p.fix = p.fix.wrapping_add(1);
                p.moved_at = now;
                evs.push(Event {
                    kind: ev::RESPAWN,
                    a: p.id,
                    b: 0,
                    x: p.x,
                    y: p.y,
                    n: 0,
                });
            } else if !p.out
                && p.hp < HP
                && now >= p.last_hit + REGEN_DELAY_MS
                && now >= p.next_regen
            {
                p.hp += 1;
                p.next_regen = now + REGEN_EVERY_MS;
            }
        }
        // Hidden in a hedge?
        for i in 0..self.players.len() {
            let p = &self.players[i];
            let hid = !p.out
                && self.field.in_hedge(p.x, p.y)
                && now >= p.last_fire + HIDE_AFTER_SHOT_MS
                && !self
                    .players
                    .iter()
                    .any(|q| q.team != p.team && !q.out && (q.x - p.x).hypot(q.y - p.y) < REVEAL_R);
            self.players[i].hidden = hid;
        }
        // The balls fly.
        let dist = BALL_SPEED * dt;
        let mut balls = std::mem::take(&mut self.balls);
        let mut hits: Vec<(usize, usize, f64, f64)> = Vec::new();
        balls.retain_mut(|b| {
            let players = &self.players;
            let team = b.team;
            let flight = b.advance(&self.field, dist, |x, y| {
                players.iter().position(|p| {
                    p.team != team
                        && !p.out
                        && now >= p.dash_until
                        && (p.x - x).hypot(p.y - y) < HIT_R
                })
            });
            match flight {
                Flight::Flying => true,
                Flight::Splat(..) => false,
                Flight::Hit(i, x, y) => {
                    hits.push((usize::MAX, i, x, y));
                    let k = hits.len() - 1;
                    // Who threw it.
                    hits[k].0 = players
                        .iter()
                        .position(|p| p.id == b.by)
                        .unwrap_or(usize::MAX);
                    evs.push(Event {
                        kind: 0,
                        a: b.by,
                        b: players[i].id,
                        x,
                        y,
                        n: b.n,
                    });
                    false
                }
            }
        });
        self.balls = balls;
        // Settle the hits (in order: each placeholder event above becomes its outcome).
        let mut hit_ev = evs
            .iter()
            .enumerate()
            .filter(|(_, e)| e.kind == 0)
            .map(|(k, _)| k)
            .collect::<Vec<_>>()
            .into_iter();
        let mut extra = Vec::new();
        for (shooter, victim, x, y) in hits {
            let k = hit_ev.next().unwrap();
            let outcome = self.splat(shooter, victim, x, y, now, &mut extra);
            evs[k].kind = outcome;
        }
        evs.extend(extra);
        // The pads.
        for k in 0..self.pads.len() {
            let pad = self.pads[k];
            if pad.kind == 0 && now >= pad.next {
                let kind =
                    power::ALL[(rng() * power::ALL.len() as f64) as usize % power::ALL.len()];
                self.pads[k].kind = kind;
                evs.push(Event {
                    kind: ev::PAD,
                    a: 0,
                    b: kind as u32,
                    x: pad.x,
                    y: pad.y,
                    n: 0,
                });
            } else if pad.kind != 0
                && let Some(p) = self
                    .players
                    .iter_mut()
                    .find(|p| !p.out && (p.x - pad.x).hypot(p.y - pad.y) < 0.75)
            {
                p.power = pad.kind;
                p.power_until = now + power::lasts(pad.kind);
                p.shield_hits = if pad.kind == power::SHIELD { 2 } else { 0 };
                if pad.kind == power::RAPID {
                    p.ammo = HOPPER;
                    p.reload_until = 0;
                }
                evs.push(Event {
                    kind: ev::PICKUP,
                    a: p.id,
                    b: pad.kind as u32,
                    x: pad.x,
                    y: pad.y,
                    n: 0,
                });
                self.pads[k].kind = 0;
                self.pads[k].next = now + PAD_EVERY_MS;
            }
        }
        // Won? (Or out of time: the side ahead, or a draw.)
        let won = if self.score[0] >= TO_WIN {
            Some(BLUE)
        } else if self.score[1] >= TO_WIN {
            Some(RED)
        } else if now >= self.phase_end {
            Some(match self.score[0].cmp(&self.score[1]) {
                std::cmp::Ordering::Greater => BLUE,
                std::cmp::Ordering::Less => RED,
                std::cmp::Ordering::Equal => 2,
            })
        } else {
            None
        };
        if let Some(w) = won {
            self.winner = w;
            self.status = OVER;
            self.phase_end = now + RESULTS_MS;
            self.balls.clear();
            evs.push(Event {
                kind: ev::END,
                a: w as u32,
                b: 0,
                x: 0.0,
                y: 0.0,
                n: 0,
            });
        }
        (evs, shots)
    }

    /// A ball from `shooter` reached `victim`: shielded, a hit, or out.
    fn splat(
        &mut self,
        shooter: usize,
        victim: usize,
        x: f64,
        y: f64,
        now: u32,
        evs: &mut Vec<Event>,
    ) -> u8 {
        let shooter_id = self.players.get(shooter).map_or(0, |p| p.id);
        let v = &mut self.players[victim];
        if now < v.shield_until {
            return ev::SHIELDED;
        }
        if v.shield_hits > 0 && v.powered(power::SHIELD, now) {
            v.shield_hits -= 1;
            if v.shield_hits == 0 {
                v.power = 0;
            }
            return ev::SHIELDED;
        }
        v.hp = v.hp.saturating_sub(1);
        v.last_hit = now;
        v.next_regen = now + REGEN_DELAY_MS;
        if v.hp > 0 {
            return ev::HIT;
        }
        // Out: back to base, and a point to the others.
        let (vid, vteam, vstreak) = (v.id, v.team, v.streak);
        v.out = true;
        v.deaths += 1;
        v.streak = 0;
        v.power = 0;
        v.shield_hits = 0;
        v.respawn_at = now + RESPAWN_MS;
        v.reload_until = 0;
        let slot = self.slots.iter().position(|&s| s == vid).unwrap_or(0);
        let home = self.spawn_point(vteam, slot % 3);
        let v = &mut self.players[victim];
        v.x = home.0;
        v.y = home.1;
        let other = 1 - vteam as usize;
        self.score[other] = self.score[other].saturating_add(1);
        if let Some(s) = self.players.get_mut(shooter) {
            s.kills += 1;
            s.streak += 1;
            if s.streak == STREAK_HOT {
                evs.push(Event {
                    kind: ev::HOT,
                    a: s.id,
                    b: 0,
                    x: s.x,
                    y: s.y,
                    n: s.streak as u16,
                });
            }
        }
        if vstreak >= STREAK_HOT {
            evs.push(Event {
                kind: ev::SHUTDOWN,
                a: shooter_id,
                b: vid,
                x,
                y,
                n: vstreak as u16,
            });
        }
        if self.score[other] == TO_WIN - 1 && !self.match_point[other] {
            self.match_point[other] = true;
            evs.push(Event {
                kind: ev::MATCH_POINT,
                a: other as u32,
                b: 0,
                x: 0.0,
                y: 0.0,
                n: 0,
            });
        }
        ev::OUT
    }

    // ---- the bots ----------------------------------------------------------

    fn bot(
        &mut self,
        i: usize,
        now: u32,
        dt: f64,
        rng: &mut impl FnMut() -> f64,
        shots: &mut Vec<Shot>,
        evs: &mut Vec<Event>,
    ) {
        if self.players[i].out {
            return;
        }
        let me = self.players[i].clone();
        let sk = skill(self.level);
        // Who can it see?
        let target = self
            .players
            .iter()
            .filter(|q| {
                q.team != me.team
                    && !q.out
                    && (!q.hidden || (q.x - me.x).hypot(q.y - me.y) < REVEAL_R)
            })
            .filter(|q| {
                (q.x - me.x).hypot(q.y - me.y) < sk.sight
                    && self.field.clear_line(me.x, me.y, q.x, q.y)
            })
            .min_by(|a, b| {
                let da = (a.x - me.x).hypot(a.y - me.y);
                let db = (b.x - me.x).hypot(b.y - me.y);
                da.total_cmp(&db)
            })
            .cloned();
        let ai = &mut self.players[i].ai;
        match &target {
            Some(t) if ai.target != Some(t.id) => {
                ai.target = Some(t.id);
                ai.react_at = now + (sk.react.0 + rng() * sk.react.1) as u32;
            }
            None => ai.target = None,
            _ => {}
        }
        // Where to go.
        let (mut mx, mut my) = (0.0, 0.0);
        if let Some(t) = &target {
            let (dx, dy) = (t.x - me.x, t.y - me.y);
            let d = dx.hypot(dy).max(0.01);
            let (ux, uy) = (dx / d, dy / d);
            if now >= ai.strafe_until {
                ai.strafe = if rng() < 0.5 { -1.0 } else { 1.0 } * (0.6 + rng() * 0.4);
                ai.strafe_until = now + 500 + (rng() * 900.0) as u32;
            }
            // Keep a fighting distance; back off when hurt and the other isn't.
            let want = if me.hp == 1 && t.hp > 1 { sk.wary } else { 5.5 };
            let radial = ((d - want) / 2.0).clamp(-1.0, 1.0);
            mx = ux * radial - uy * ai.strafe;
            my = uy * radial + ux * ai.strafe;
        } else {
            // Nobody in sight: a power-up nearby, else out to somewhere on their side.
            let pad = self
                .pads
                .iter()
                .filter(|p| p.kind != 0 && (p.x - me.x).hypot(p.y - me.y) < sk.pad_r)
                .min_by(|a, b| {
                    (a.x - me.x)
                        .hypot(a.y - me.y)
                        .total_cmp(&(b.x - me.x).hypot(b.y - me.y))
                })
                .copied();
            let goal_tile =
                |x: f64, y: f64| (x.floor().max(0.0) as usize, y.floor().max(0.0) as usize);
            let want = match pad {
                Some(p) => Some(goal_tile(p.x, p.y)),
                None if ai.goal.is_none() || now >= ai.goal_until => {
                    // Somewhere across the middle, toward them.
                    let (w, h) = (self.field.w, self.field.h);
                    let x = if me.team == BLUE {
                        w * (0.45 + rng() * 0.35)
                    } else {
                        w * (0.2 + rng() * 0.35)
                    };
                    let y = 1.5 + rng() * (h - 3.0);
                    ai.goal_until = now + 2500 + (rng() * 3000.0) as u32;
                    Some(goal_tile(x, y))
                }
                None => ai.goal,
            };
            if want != ai.goal || ai.nav.is_empty() {
                ai.goal = want;
                ai.nav = want.map(|g| nav_field(&self.field, g)).unwrap_or_default();
            }
            if let Some(g) = ai.goal
                && let Some((nx, ny)) = nav_step(&self.field, &ai.nav, me.x, me.y)
            {
                let (dx, dy) = (nx - me.x, ny - me.y);
                let d = dx.hypot(dy);
                if d > 0.05 {
                    mx = dx / d;
                    my = dy / d;
                }
                if (me.x.floor() as usize, me.y.floor() as usize) == g {
                    ai.goal_until = now;
                }
            }
        }
        // Dodge a ball coming at it.
        let threat = self.balls.iter().any(|b| {
            if b.team == me.team {
                return false;
            }
            let (rx, ry) = (me.x - b.x, me.y - b.y);
            let along = rx * b.vx + ry * b.vy;
            along > 0.0 && along < 4.0 && (rx * b.vy - ry * b.vx).abs() < 0.7
        });
        let can_dash = now >= me.dash_ready;
        let len = mx.hypot(my);
        if len > 1.0 {
            mx /= len;
            my /= len;
        }
        let ai_wobble = {
            let ai = &mut self.players[i].ai;
            ai.wobble =
                (ai.wobble * 0.6 + (rng() - 0.5) * sk.wobble.0).clamp(-sk.wobble.1, sk.wobble.1);
            ai.wobble
        };
        if threat
            && can_dash
            && rng() < sk.dodge
            && let Some(e) = self.dash(me.id, now)
        {
            evs.push(e);
        }
        let p = &mut self.players[i];
        let speed = if now < p.dash_until {
            DASH_SPEED
        } else {
            SPEED * sk.speed
        };
        let (dx, dy) = if now < p.dash_until && len < 0.1 {
            (p.aim.cos(), p.aim.sin())
        } else {
            (mx, my)
        };
        let (nx, ny) = self
            .field
            .slide(p.x, p.y, dx * speed * dt, dy * speed * dt, PLAYER_R);
        let p = &mut self.players[i];
        p.vx = (nx - p.x) / dt;
        p.vy = (ny - p.y) / dt;
        p.x = nx;
        p.y = ny;
        // Aim (leading a little) and shoot.
        if let Some(t) = &target {
            let d = (t.x - p.x).hypot(t.y - p.y);
            let lead = d / BALL_SPEED * sk.lead;
            let (ax, ay) = (t.x + t.vx * lead, t.y + t.vy * lead);
            let moving = (t.vx.hypot(t.vy) > 1.0) as u8 as f64;
            let aim = (ay - p.y).atan2(ax - p.x) + ai_wobble * (0.6 + moving);
            p.aim = aim;
            if now >= p.ai.react_at && now >= p.ai.next_fire && p.reload_until <= now {
                if p.ammo == 0 && !p.powered(power::RAPID, now) {
                    p.reload_until = now + RELOAD_MS;
                } else {
                    // Bursts of three to five, then a breather.
                    if p.ai.burst == 0 {
                        p.ai.burst = sk.burst.0 + (rng() * sk.burst.1) as u8;
                    }
                    p.ai.burst -= 1;
                    let gap = if p.ai.burst == 0 {
                        (sk.pause.0 + rng() * sk.pause.1) as u32
                    } else {
                        p.fire_ms(now) + (sk.slack.0 + rng() * sk.slack.1) as u32
                    };
                    p.ai.next_fire = now + gap;
                    p.last_fire = now.saturating_sub(1000);
                    self.next_bot_shot = self.next_bot_shot.wrapping_add(1) & 0x0fff;
                    let (id, x, y, n) = (p.id, p.x, p.y, self.next_bot_shot);
                    if let Some(s) = self.fire(id, n, x, y, aim, now) {
                        shots.push(s);
                    }
                }
            }
        } else {
            if len > 0.1 {
                p.aim = my.atan2(mx);
            }
            if p.ammo < HOPPER / 2 && p.reload_until <= now {
                p.reload_until = now + RELOAD_MS;
            }
        }
    }
}

/// Steps to `goal` from every tile (8 ways, no corner cutting), 0xffff where it can't.
fn nav_field(field: &Field, goal: (usize, usize)) -> Vec<u16> {
    let (cols, rows) = (field.cols(), field.rows());
    let mut d = vec![u16::MAX; cols * rows];
    let g = (goal.0.min(cols - 1), goal.1.min(rows - 1));
    let mut q = std::collections::VecDeque::new();
    d[g.1 * cols + g.0] = 0;
    q.push_back(g);
    while let Some((x, y)) = q.pop_front() {
        let here = d[y * cols + x];
        for (dx, dy) in [
            (1i32, 0i32),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx < 0 || ny < 0 || nx >= cols as i32 || ny >= rows as i32 {
                continue;
            }
            let (nx, ny) = (nx as usize, ny as usize);
            if !field.open_tile(nx, ny) || d[ny * cols + nx] != u16::MAX {
                continue;
            }
            if dx != 0 && dy != 0 && (!field.open_tile(x, ny) || !field.open_tile(nx, y)) {
                continue;
            }
            d[ny * cols + nx] = here + 1;
            q.push_back((nx, ny));
        }
    }
    d
}

/// The middle of the next tile on the way, from (x, y).
fn nav_step(field: &Field, nav: &[u16], x: f64, y: f64) -> Option<(f64, f64)> {
    let cols = field.cols();
    let (cx, cy) = (x.floor() as i32, y.floor() as i32);
    let at = |tx: i32, ty: i32| -> u16 {
        if tx < 0 || ty < 0 || tx >= cols as i32 || ty >= field.rows() as i32 {
            u16::MAX
        } else {
            nav[ty as usize * cols + tx as usize]
        }
    };
    let here = at(cx, cy);
    if here == 0 {
        return Some((cx as f64 + 0.5, cy as f64 + 0.5));
    }
    let mut best = (here, None);
    for (dx, dy) in [
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (1, 1),
        (1, -1),
        (-1, 1),
        (-1, -1),
    ] {
        let v = at(cx + dx, cy + dy);
        if v < best.0 {
            best = (v, Some((cx + dx, cy + dy)));
        }
    }
    best.1.map(|(tx, ty)| (tx as f64 + 0.5, ty as f64 + 0.5))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field() -> Field {
        Field {
            w: 40.0,
            h: 24.0,
            obstacles: vec![
                Obstacle {
                    kind: ob::HAY,
                    x: 10.0,
                    y: 11.0,
                    w: 2.0,
                    h: 1.0,
                },
                Obstacle {
                    kind: ob::DRUM,
                    x: 20.0,
                    y: 5.0,
                    w: 1.0,
                    h: 1.0,
                },
                Obstacle {
                    kind: ob::HEDGE,
                    x: 30.0,
                    y: 11.0,
                    w: 2.0,
                    h: 2.0,
                },
            ],
            spawns: [
                vec![(1.5, 10.5), (1.5, 12.5), (1.5, 14.5)],
                vec![(38.5, 10.5), (38.5, 12.5), (38.5, 14.5)],
            ],
            pads: vec![(20.5, 2.5), (20.5, 21.5)],
        }
    }

    fn rng() -> impl FnMut() -> f64 {
        let mut s = 12345u64;
        move || {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (s >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    fn yard() -> Field {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../assets/maps/paintball.json"
        ))
        .unwrap();
        let map = crate::map::MapFile::from_json(&text).unwrap();
        Field::from_map(&map.objects).unwrap().0
    }

    #[test]
    fn the_yard_is_open_end_to_end_and_fair() {
        let f = yard();
        assert_eq!((f.w, f.h), (40.0, 24.0));
        assert_eq!(f.spawns[0].len(), 3);
        assert_eq!(f.pads.len(), 2);
        for side in 0..2 {
            for &(x, y) in &f.spawns[side] {
                assert!(f.free(x, y, PLAYER_R), "spawn {x},{y} is clear");
            }
        }
        // From every spawn, the other base can be reached.
        let red = f.spawns[1][1];
        let nav = nav_field(&f, (red.0 as usize, red.1 as usize));
        for &(x, y) in &f.spawns[0] {
            assert!(
                nav[y as usize * 40 + x as usize] < u16::MAX,
                "blue {x},{y} reaches red"
            );
        }
        // Mirrored: each obstacle has its twin.
        for o in &f.obstacles {
            assert!(
                f.obstacles.iter().any(|p| p.kind == o.kind
                    && (p.x - (f.w - o.x - o.w)).abs() < 1e-9
                    && p.y == o.y),
                "{o:?} has a twin"
            );
        }
    }

    #[test]
    fn bot_matches_on_the_yard_last_a_while() {
        let mut total = 0;
        for seed in 0..4u64 {
            let mut m = Match::new(yard());
            m.join(1, BLUE, 0);
            m.start(1, true, 0);
            m.leave(1, 0);
            // (Called off with nobody left: so a bot-only match, by hand.)
            m.join(1, BLUE, 0);
            m.start(1, true, 0);
            let i = m.players.iter().position(|p| p.id == 1).unwrap();
            m.players[i].bot = true;
            let mut s = 99 + seed * 7919;
            let mut r = move || {
                s = s
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                (s >> 11) as f64 / (1u64 << 53) as f64
            };
            let mut now = 0;
            let mut shots = 0;
            while m.status != OVER && now < MATCH_MS + 10_000 {
                now += 100;
                shots += m.step(now, 100, &mut r).1.len();
            }
            eprintln!("YARD: {}s, {:?}, {shots} shots", now / 1000, m.score);
            total += now;
        }
        let avg = total / 4 / 1000;
        assert!(
            (100..=420).contains(&avg),
            "a bot match takes {avg}s on average"
        );
    }

    #[test]
    fn the_lobby_gets_bots_to_take_out_or_put_back() {
        let mut m = Match::new(field());
        assert!(m.join(7, BLUE, 0));
        assert_eq!(
            m.slots.iter().filter(|&&s| is_bot(s)).count(),
            5,
            "bots everywhere else"
        );
        // Out with the red bots: no one on red, so no match.
        for k in 3..6 {
            assert!(m.set_bot(7, k, false));
        }
        assert!(!m.set_bot(9, 1, false), "only those in can");
        assert!(!m.start(7, false, 0));
        // One back: a 3 v 1.
        assert!(m.set_bot(7, 4, true));
        assert!(!m.set_bot(7, 4, true), "already there");
        // Someone else comes for red: they take a free place, not the bot's.
        assert!(m.join(8, RED, 0));
        assert_eq!(m.slot_of(8), Some(3));
        // And a third, for blue: a bot steps aside.
        assert!(m.join(9, BLUE, 0));
        assert_eq!(m.slots.iter().filter(|&&s| is_bot(s)).count(), 2);
        // Switching sides.
        assert!(m.join(9, RED, 0));
        assert_eq!(team_of_slot(m.slot_of(9).unwrap()), RED);
        assert_eq!(m.slots.iter().filter(|&&s| s != 0).count(), 5);
        // The level: picked by those in, in the lobby.
        assert!(m.set_level(7, crate::level::HARD));
        assert!(!m.set_level(42, crate::level::EASY));
        assert!(m.start(7, false, 0));
        assert_eq!(m.players.len(), 5);
        assert!(!m.set_level(7, crate::level::EASY), "not mid-match");
        // Everyone gone: the bots go, the level's back to medium.
        let mut m = Match::new(field());
        m.join(7, BLUE, 0);
        m.set_level(7, crate::level::EASY);
        m.leave(7, 0);
        assert!(m.slots.iter().all(|&s| s == 0));
        assert_eq!(m.level, crate::level::MEDIUM);
    }

    #[test]
    fn harder_bots_hit_harder() {
        // One red bot against someone standing about in the open: how often it gets them.
        let outs = |level: u8| {
            let mut total = 0;
            for seed in 0..4u64 {
                let mut m = Match::new(field());
                m.join(1, BLUE, 0);
                for k in [0, 1, 2, 4, 5] {
                    m.set_bot(1, k, false);
                }
                m.set_level(1, level);
                assert!(m.start(1, false, 0));
                let mut s = 7 + seed * 104_729;
                let mut r = move || {
                    s = s
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    (s >> 11) as f64 / (1u64 << 53) as f64
                };
                let mut now = 0;
                while now < COUNTDOWN_MS + 60_000 {
                    now += 100;
                    let me = m.players.iter_mut().find(|p| p.id == 1).unwrap();
                    if !me.out {
                        me.x = 12.0;
                        me.y = 6.0;
                    }
                    total += m
                        .step(now, 100, &mut r)
                        .0
                        .iter()
                        .filter(|e| e.kind == ev::OUT)
                        .count();
                }
            }
            total
        };
        let (easy, medium, hard) = (
            outs(crate::level::EASY),
            outs(crate::level::MEDIUM),
            outs(crate::level::HARD),
        );
        eprintln!("PB LEVELS: easy {easy}, medium {medium}, hard {hard}");
        assert!(
            easy < medium && medium < hard,
            "easy {easy}, medium {medium}, hard {hard}"
        );
    }

    #[test]
    fn lobby_fills_with_bots_and_counts_down() {
        let mut m = Match::new(field());
        assert!(m.join(7, BLUE, 0));
        assert!(!m.start(8, true, 0), "only those in can start");
        assert!(m.start(7, true, 0));
        assert_eq!(m.players.len(), 6);
        assert_eq!(m.slots.iter().filter(|&&s| is_bot(s)).count(), 5);
        let mut r = rng();
        let (evs, _) = m.step(COUNTDOWN_MS, 100, &mut r);
        assert_eq!(m.status, PLAYING);
        assert!(evs.iter().any(|e| e.kind == ev::START));
    }

    #[test]
    fn three_hits_put_you_out_and_score() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.join(2, RED, 0);
        for k in 0..SLOTS {
            m.set_bot(1, k, false);
        }
        assert!(m.start(1, false, 0));
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let t0 = COUNTDOWN_MS + 2000;
        // Face to face across open grass.
        m.players[0].x = 5.0;
        m.players[0].y = 5.0;
        m.players[1].x = 9.0;
        m.players[1].y = 5.0;
        m.players[1].shield_until = 0;
        let mut outs = 0;
        let mut now = t0;
        for k in 0..3u16 {
            now += 300;
            m.players[1].x = 9.0;
            m.players[1].y = 5.0;
            assert!(m.fire(1, k, 5.0, 5.0, 0.0, now).is_some());
            for _ in 0..5 {
                now += 100;
                let (evs, _) = m.step(now, 100, &mut r);
                outs += evs.iter().filter(|e| e.kind == ev::OUT).count();
            }
        }
        assert_eq!(outs, 1);
        assert_eq!(m.score, [1, 0]);
        assert!(m.players[1].out);
        // Back in after a while, shielded.
        let (evs, _) = m.step(now + RESPAWN_MS, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::RESPAWN));
        assert!(!m.players[1].out);
    }

    #[test]
    fn hay_stops_balls_and_drums_send_them_back() {
        let f = field();
        // Into the hay bale: a splat on its face.
        let mut b = Ball::new(1, BLUE, 0, 8.0, 11.5, 0.0, false);
        let fl = b.advance(&f, 10.0, |_, _| None);
        assert!(
            matches!(fl, Flight::Splat(x, _) if x < 10.0 && x > 9.0),
            "{fl:?}"
        );
        // Off the drum: comes back.
        let mut b = Ball::new(1, BLUE, 0, 17.0, 5.5, 0.0, false);
        b.advance(&f, 4.0, |_, _| None);
        assert!(b.vx < 0.0, "bounced back off the drum");
    }

    #[test]
    fn a_reload_refills_and_a_shot_just_before_it_ends_counts() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let mut now = COUNTDOWN_MS + 100;
        // Empty the hopper: it reloads by itself.
        for k in 0..HOPPER as u16 {
            now += FIRE_MS;
            assert!(m.fire(1, k, 2.0, 12.0, 0.0, now).is_some(), "shot {k}");
        }
        let p = m.player(1).unwrap();
        assert_eq!(p.ammo, 0);
        assert!(p.reload_until > now);
        // No shooting mid-reload…
        assert!(m.fire(1, 50, 2.0, 12.0, 0.0, now + 300).is_none());
        // …but a shot a beat before it ends (by the server's clock) is taken, from a full hopper.
        let done = m.player(1).unwrap().reload_until;
        assert!(m.fire(1, 51, 2.0, 12.0, 0.0, done - 150).is_some());
        assert_eq!(m.player(1).unwrap().ammo, HOPPER - 1);
        // R: reloads, and the tick refills it.
        let t = done + 500;
        assert!(m.reload(1, t).is_some());
        assert!(m.reload(1, t + 100).is_none(), "already reloading");
        m.step(t + RELOAD_MS, 100, &mut r);
        assert_eq!(m.player(1).unwrap().ammo, HOPPER);
    }

    #[test]
    fn shots_bunched_into_one_tick_all_count_but_the_rate_holds() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let t = COUNTDOWN_MS + 1000;
        // Two that arrive together (sent 170 ms apart): both taken.
        assert!(m.fire(1, 1, 2.0, 12.0, 0.0, t).is_some());
        assert!(m.fire(1, 2, 2.0, 12.0, 0.0, t).is_some());
        // Spamming: soon refused, then allowed again at the rate.
        let taken = (3..20)
            .filter(|&k| m.fire(1, k, 2.0, 12.0, 0.0, t).is_some())
            .count();
        assert!(taken <= 2, "{taken} more in the same instant");
        let mut ok = 0;
        for k in 0..20u16 {
            if m.fire(1, 100 + k, 2.0, 12.0, 0.0, t + 100 + k as u32 * FIRE_MS)
                .is_some()
            {
                ok += 1;
            }
        }
        assert!(ok >= 8, "at the rate: {ok}");
    }

    #[test]
    fn moves_too_far_are_cut_short() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        m.step(COUNTDOWN_MS, 100, &mut r);
        let (x0, y0) = (m.players[0].x, m.players[0].y);
        m.claim_move(1, x0 + 10.0, y0, 0.0, COUNTDOWN_MS + 100);
        let p = &m.players[0];
        assert!(p.x - x0 < 1.5, "teleport refused");
        assert_eq!(p.fix, 1);
    }

    #[test]
    fn bots_play_a_whole_match() {
        let mut m = Match::new(field());
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        // The human stands aside (a bot takes their place).
        m.leave(1, 0);
        assert_eq!(m.status, LOBBY, "nobody left: called off");
        m.join(1, BLUE, 0);
        m.start(1, true, 0);
        let mut r = rng();
        let mut now = 0;
        let mut shots = 0;
        while m.status != OVER && now < MATCH_MS + 10_000 {
            now += 100;
            // The human just stands at home.
            let (_, s) = m.step(now, 100, &mut r);
            shots += s.len();
        }
        eprintln!(
            "PACE: over at {}s, score {:?}, shots {shots}, kd {:?}",
            now / 1000,
            m.score,
            m.players
                .iter()
                .map(|p| (p.kills, p.deaths))
                .collect::<Vec<_>>()
        );
        assert_eq!(m.status, OVER);
        assert!(shots > 20, "the bots shot ({shots})");
        assert!(
            m.score[0] + m.score[1] > 0,
            "and splatted somebody: {:?}",
            m.score
        );
    }
}
