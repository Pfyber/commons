//! The gladiator arena in the park: Crown of the Colosseum. Up to four
//! gladiators (bots fill the empty places), every one for themselves, on
//! the sand inside the arena's walls. Last one standing takes the round's
//! crown; three crowns and you're champion.
//!
//! Everything is in arena tiles (the sand's top-left corner is 0,0). People
//! move themselves (the client says where it is; `claim_move` checks it
//! could have got there), except while they're knocked flying; everything
//! else is decided here, ten times a second: the swings and what they hit,
//! blocks and parries, knockback (and slamming into walls and pillars), the
//! spikes, the crowd's gifts and what's thrown, the ring of fire, the bots.
//!
//! The moves: quick slashes that chain into a three-hit combo; a heavy
//! blow, charged up, that lunges and breaks a guard; a shield to block (and
//! raised just as a blow lands, a parry that leaves them reeling); a roll
//! that nothing touches; and, once your rage is full, the whirlwind. The
//! arena: two pillars to hide behind (or be slammed into), spike plates that
//! rise in turn, gifts the crowd throws in (a roast leg, a spear or a bomb to
//! throw, a fury helmet), and after a while a ring of fire closing in.

use std::f64::consts::{PI, TAU};

pub const SLOTS: usize = 4;
/// `Match::status`.
pub const LOBBY: u8 = 0;
/// A round about to begin (the fighters at their gates).
pub const COUNTDOWN: u8 = 1;
pub const FIGHTING: u8 = 2;
/// A round won: a moment to see who's standing.
pub const ROUND_END: u8 = 3;
/// The champion crowned.
pub const OVER: u8 = 4;
/// The bots, as player ids (one per place).
pub const BOT_BASE: u32 = 0xffff_ff20;

pub const TO_WIN: u8 = 3;
pub const HP: f64 = 100.0;
pub const STAMINA: f64 = 100.0;
pub const RAGE: f64 = 100.0;
pub const SPEED: f64 = 4.2;
pub const BODY_R: f64 = 0.32;
/// How long each part of a slash lasts (ms): wind-up, the blow, recovery.
pub const LIGHT: [(u32, u32, u32); 3] = [(110, 90, 200), (110, 90, 200), (170, 110, 320)];
pub const LIGHT_DMG: [f64; 3] = [8.0, 9.0, 16.0];
pub const LIGHT_KB: [f64; 3] = [2.5, 2.5, 7.0];
pub const LIGHT_REACH: f64 = 1.35;
pub const LIGHT_ARC: f64 = 1.0;
pub const LIGHT_COST: f64 = 9.0;
/// A heavy blow: charged for at least `HEAVY_MIN_MS`, full at `HEAVY_FULL_MS`;
/// then a short wind-up, the lunge (the blow), recovery.
pub const HEAVY_MIN_MS: u32 = 220;
pub const HEAVY_FULL_MS: u32 = 1000;
pub const HEAVY: (u32, u32, u32) = (70, 190, 360);
pub const HEAVY_REACH: f64 = 1.55;
pub const HEAVY_ARC: f64 = 1.25;
pub const HEAVY_LUNGE: f64 = 1.7;
pub const HEAVY_COST: f64 = 28.0;
pub const BLOCK_ARC: f64 = 1.35;
/// Blocking this soon before a blow lands is a parry.
pub const PARRY_MS: u32 = 190;
pub const PARRIED_STUN_MS: u32 = 750;
/// A heavy blow parried: the attacker's left wide open, and winded.
pub const HEAVY_PARRIED_STUN_MS: u32 = 1300;
pub const HEAVY_PARRIED_COST: f64 = 30.0;
/// Stamina: it comes back this fast (a second), this long after it's used,
/// at this share while blocking; run it right out and you're winded a while.
pub const STAMINA_REGEN: f64 = 28.0;
pub const STAMINA_DELAY_MS: u32 = 700;
pub const BLOCK_REGEN: f64 = 0.35;
pub const BLOCK_HIT_COST: f64 = 13.0;
pub const WINDED_MS: u32 = 1200;
/// A whirlwind asked for while busy (rolling, reeling, mid-blow) goes off
/// as soon as it can, if that's within this long.
pub const SPECIAL_BUFFER_MS: u32 = 700;
pub const ROLL_MS: u32 = 260;
pub const ROLL_DIST: f64 = 2.3;
pub const ROLL_COST: f64 = 24.0;
pub const ROLL_CD_MS: u32 = 450;
/// The whirlwind: how long, how often it hits each one in reach, how far.
pub const SPIN_MS: u32 = 750;
pub const SPIN_EVERY_MS: u32 = 140;
pub const SPIN_REACH: f64 = 1.75;
pub const SPIN_DMG: f64 = 9.0;
/// Throwing: wind-up, recovery.
pub const THROW: (u32, u32) = (130, 220);
pub const SPEAR_SPEED: f64 = 15.0;
pub const SPEAR_RANGE: f64 = 11.0;
pub const SPEAR_DMG: f64 = 26.0;
pub const BOMB_SPEED: f64 = 9.0;
pub const BOMB_RANGE: f64 = 6.5;
pub const BOMB_R: f64 = 1.9;
pub const BOMB_DMG: f64 = 34.0;
pub const WALL_SLAM_SPEED: f64 = 4.6;
pub const WALL_SLAM_DMG: f64 = 10.0;
/// Knockback dies away at this rate (per second).
pub const KB_FRICTION: f64 = 5.0;
pub const COUNTDOWN_MS: u32 = 3200;
pub const ROUND_END_MS: u32 = 3800;
/// The champion's parade: out of the ring through the south gate, down the
/// red carpet, the rest trailing behind (see `parade_end`).
pub const OVER_MS: u32 = 15_000;
/// Where the parade ends: this far below the sand's top edge (arena tiles),
/// down the carpet; those who lost this far behind, one after another.
pub const PARADE_END: f64 = 9.0;
pub const PARADE_GAP: f64 = 1.6;
pub const PARADE_FIRST_GAP: f64 = 2.2;
/// The ring of fire starts closing this long into a round, and takes this long to close.
pub const FIRE_AFTER_MS: u32 = 45_000;
pub const FIRE_CLOSE_MS: u32 = 22_000;
/// How far it closes (as a fraction of the ring, middle to side), and how hot it is.
pub const FIRE_MIN: f64 = 0.28;
pub const FIRE_DPS: f64 = 12.0;
/// The crowd throws a gift in this often (ms, plus up to `GIFT_JITTER_MS`).
pub const GIFT_EVERY_MS: u32 = 8000;
pub const GIFT_JITTER_MS: u32 = 5000;
pub const GIFT_FALL_MS: u32 = 900;
pub const GIFT_LASTS_MS: u32 = 15_000;
pub const FURY_MS: u32 = 8000;
pub const HEAL: f64 = 35.0;
/// Each spike plate's cycle, its warning and how long the spikes are up.
pub const SPIKE_CYCLE_MS: u32 = 6000;
pub const SPIKE_WARN_MS: u32 = 900;
pub const SPIKE_UP_MS: u32 = 800;
pub const SPIKE_DMG: f64 = 15.0;

/// What a fighter is doing (`Fighter::act`, protocol `ArenaFighter.act`).
pub mod act {
    pub const NONE: u8 = 0;
    pub const LIGHT1: u8 = 1;
    pub const LIGHT2: u8 = 2;
    pub const LIGHT3: u8 = 3;
    /// Charging a heavy blow.
    pub const CHARGE: u8 = 4;
    pub const HEAVY: u8 = 5;
    pub const BLOCK: u8 = 6;
    pub const ROLL: u8 = 7;
    /// Reeling (hit, parried, slammed).
    pub const STUN: u8 = 8;
    pub const THROW: u8 = 9;
    pub const SPIN: u8 = 10;
    pub const DOWN: u8 = 11;
}

/// What a client asks for (protocol `ArenaAct.act`).
pub mod input {
    pub const LIGHT: u8 = 1;
    pub const HEAVY_START: u8 = 2;
    pub const HEAVY_RELEASE: u8 = 3;
    pub const BLOCK_ON: u8 = 4;
    pub const BLOCK_OFF: u8 = 5;
    /// A roll, the way `aim` says.
    pub const ROLL: u8 = 6;
    pub const THROW: u8 = 7;
    pub const SPECIAL: u8 = 8;
}

/// The crowd's gifts (`Gift::kind`, `Fighter::holding`).
pub mod gift {
    pub const HEALTH: u8 = 1;
    pub const SPEAR: u8 = 2;
    pub const BOMB: u8 = 3;
    pub const FURY: u8 = 4;
    pub const ALL: [u8; 4] = [HEALTH, SPEAR, BOMB, FURY];
}

/// What happened (protocol `ArenaEvent`).
pub mod ev {
    /// `a` hit `b` for `n`; `m`: bits (1 blocked, 2 heavy, 4 combo finisher,
    /// 8 thrown, 16 whirlwind, 32 bomb); knocked (`vx`, `vy`).
    pub const HIT: u8 = 1;
    /// `a` parried `b`.
    pub const PARRY: u8 = 2;
    /// `a` broke `b`'s guard.
    pub const GUARD_BREAK: u8 = 3;
    /// `b` slammed into a wall (by `a`'s blow) for `n`.
    pub const WALL_SLAM: u8 = 4;
    /// `b` is down (`a` did it, or 0).
    pub const DOWN: u8 = 5;
    /// `a` swings (`n` the act).
    pub const SWING: u8 = 6;
    /// `a` rolled.
    pub const ROLL: u8 = 7;
    /// A gift (`n` its kind) is on its way to (x, y).
    pub const GIFT_INCOMING: u8 = 8;
    /// `a` picked up a gift (`n` its kind).
    pub const PICKUP: u8 = 10;
    /// `a` threw (`n` the kind) from (x, y) toward `m` (the aim).
    pub const THROW: u8 = 11;
    /// A bomb went off at (x, y) (`a` threw it).
    pub const BOOM: u8 = 12;
    /// Spikes hit `b` for `n`.
    pub const SPIKED: u8 = 14;
    /// Round `n` is about to begin.
    pub const ROUND_START: u8 = 15;
    pub const FIGHT: u8 = 16;
    /// `a` won round `n` (0: nobody standing).
    pub const ROUND_WON: u8 = 17;
    /// `a` is champion.
    pub const CHAMPION: u8 = 18;
    /// `a` unleashed the whirlwind.
    pub const SPECIAL: u8 = 19;
    /// The ring of fire starts closing.
    pub const FIRE: u8 = 20;
    /// A thrown spear stuck in a wall at (x, y) (`a` threw it, `m` its aim).
    pub const STUCK: u8 = 21;
    /// `a`'s rage is full: the whirlwind's ready.
    pub const RAGE_FULL: u8 = 22;
}

/// `Fighter::flags` (protocol `ArenaFighter.flags`).
pub mod flag {
    pub const DOWN: u8 = 1;
    pub const FURY: u8 = 2;
    pub const KNOCKED: u8 = 4;
    pub const IFRAMES: u8 = 8;
    pub const QUEUED: u8 = 16;
    /// Out of breath: no rolls or heavy blows till it passes.
    pub const WINDED: u8 = 32;
}

/// A pillar or a spike plate, in arena tiles.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64, pad: f64) -> bool {
        x > self.x - pad
            && x < self.x + self.w + pad
            && y > self.y - pad
            && y < self.y + self.h + pad
    }
    fn hits(&self, x: f64, y: f64, r: f64) -> bool {
        let nx = x.clamp(self.x, self.x + self.w);
        let ny = y.clamp(self.y, self.y + self.h);
        (x - nx).powi(2) + (y - ny).powi(2) < r * r
    }
}

/// The sand: its size, its pillars and spike plates.
#[derive(Debug, Clone)]
pub struct Ring {
    pub w: f64,
    pub h: f64,
    pub pillars: Vec<Rect>,
    pub spikes: Vec<Rect>,
}

impl Ring {
    /// The ring laid out by a map's objects: the `arena` marker's inside
    /// (its walls are its edge tiles), `arena_pillar`s and `arena_spikes`.
    /// Returns it and where its corner is (map tiles).
    pub fn from_map(objects: &[crate::map::MapObject]) -> Option<(Ring, (u16, u16))> {
        let a = objects.iter().find(|o| o.kind == "arena")?;
        let (ox, oy) = (a.x + 1, a.y + 1);
        let rect = |o: &crate::map::MapObject| Rect {
            x: o.x as f64 - ox as f64,
            y: o.y as f64 - oy as f64,
            w: o.w as f64,
            h: o.h as f64,
        };
        Some((
            Ring {
                w: a.w.saturating_sub(2) as f64,
                h: a.h.saturating_sub(2) as f64,
                pillars: objects
                    .iter()
                    .filter(|o| o.kind == "arena_pillar")
                    .map(rect)
                    .collect(),
                spikes: objects
                    .iter()
                    .filter(|o| o.kind == "arena_spikes")
                    .map(rect)
                    .collect(),
            },
            (ox, oy),
        ))
    }

    pub fn free(&self, x: f64, y: f64, r: f64) -> bool {
        x >= r
            && y >= r
            && x <= self.w - r
            && y <= self.h - r
            && !self.pillars.iter().any(|p| p.hits(x, y, r))
    }

    /// Moving a body by (dx, dy), sliding along what it runs into; and whether it ran into anything.
    pub fn slide(&self, x: f64, y: f64, dx: f64, dy: f64, r: f64) -> (f64, f64, bool) {
        let n = (dx.hypot(dy) / 0.12).ceil().max(1.0);
        let (sx, sy) = (dx / n, dy / n);
        let (mut x, mut y, mut bumped) = (x, y, false);
        for _ in 0..n as usize {
            if self.free(x + sx, y, r) {
                x += sx;
            } else {
                bumped = true;
            }
            if self.free(x, y + sy, r) {
                y += sy;
            } else {
                bumped = true;
            }
        }
        (x, y, bumped)
    }

    pub fn clear_line(&self, ax: f64, ay: f64, bx: f64, by: f64) -> bool {
        let n = ((bx - ax).hypot(by - ay) / 0.25).ceil().max(1.0) as usize;
        (1..n).all(|i| {
            let t = i as f64 / n as f64;
            !self
                .pillars
                .iter()
                .any(|p| p.contains(ax + (bx - ax) * t, ay + (by - ay) * t, 0.0))
        })
    }

    /// The corners the gladiators start from.
    pub fn gate(&self, k: usize) -> (f64, f64) {
        let (l, r, t, b) = (2.0, self.w - 2.0, 2.0, self.h - 2.0);
        [(l, t), (r, b), (r, t), (l, b)][k % 4]
    }

    /// How far out (x, y) is, as a fraction of the ring (1 at its edge, middle to side).
    pub fn reach(&self, x: f64, y: f64) -> f64 {
        let (cx, cy) = (self.w / 2.0, self.h / 2.0);
        (((x - cx) / cx).powi(2) + ((y - cy) / cy).powi(2)).sqrt()
    }
}

/// Something thrown: a spear or a bomb.
#[derive(Debug, Clone)]
pub struct Missile {
    pub by: u32,
    pub kind: u8,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub left: f64,
}

/// What a missile did this step.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Flight {
    Flying,
    /// Into a wall or pillar (or as far as it goes) at x, y.
    Stopped(f64, f64),
    /// Reached fighter `i` at x, y.
    Hit(usize, f64, f64),
}

impl Missile {
    pub fn new(by: u32, kind: u8, x: f64, y: f64, aim: f64) -> Missile {
        let speed = if kind == gift::BOMB {
            BOMB_SPEED
        } else {
            SPEAR_SPEED
        };
        let (c, s) = (aim.cos(), aim.sin());
        Missile {
            by,
            kind,
            x: x + c * 0.5,
            y: y + s * 0.5,
            vx: c * speed,
            vy: s * speed,
            left: if kind == gift::BOMB {
                BOMB_RANGE
            } else {
                SPEAR_RANGE
            },
        }
    }

    /// Flies on for `dt` seconds, in small steps; `hit` says whether a body is at a point.
    pub fn advance(
        &mut self,
        ring: &Ring,
        dt: f64,
        mut hit: impl FnMut(f64, f64) -> Option<usize>,
    ) -> Flight {
        let speed = self.vx.hypot(self.vy);
        let mut todo = speed * dt;
        while todo > 1e-9 {
            if self.left <= 1e-9 {
                return Flight::Stopped(self.x, self.y);
            }
            let step = todo.min(0.15).min(self.left);
            todo -= step;
            self.left -= step;
            let (nx, ny) = (
                self.x + self.vx / speed * step,
                self.y + self.vy / speed * step,
            );
            if !ring.free(nx, ny, 0.05) {
                return Flight::Stopped(self.x, self.y);
            }
            self.x = nx;
            self.y = ny;
            if let Some(i) = hit(nx, ny) {
                return Flight::Hit(i, nx, ny);
            }
        }
        Flight::Flying
    }
}

/// A gift from the crowd: on its way down, then lying on the sand.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Gift {
    pub kind: u8,
    pub x: f64,
    pub y: f64,
    /// When it lands (and when it's gone).
    pub lands: u32,
    pub gone: u32,
}

/// How a bot fights, by level (`crate::level`): how steady its aim, how
/// often it defends and how quick it is on the uptake (quick enough, a parry),
/// how hard it presses, how fast it moves, how well it minds the spikes and
/// uses what the crowd throws in.
struct Skill {
    /// Aim drift, at most (radians).
    wobble: f64,
    /// Its chances of rolling from or blocking a blow, scaled.
    defend: f64,
    /// How long before it acts on a swing it's seen (ms: base, plus up to).
    uptake: (f64, f64),
    /// Between one flurry and the next (ms: base, plus up to).
    gap: (f64, f64),
    /// Up to this many more slashes in a combo.
    combo: f64,
    /// Its chance of a heavy blow at someone blocking or reeling.
    punish: f64,
    /// Its chance (each think) of a lunging heavy from a little way off.
    lunge: f64,
    /// Of full walking speed.
    speed: f64,
    /// How far ahead it minds the spikes (ms).
    spike_ms: u32,
    /// How far it goes for a gift (tiles).
    gift_r: f64,
    /// Its chance (each think) to throw what it holds.
    throw: f64,
}

fn skill(level: u8) -> Skill {
    match level {
        crate::level::EASY => Skill {
            wobble: 0.55,
            defend: 0.45,
            uptake: (200.0, 260.0),
            gap: (900.0, 1000.0),
            combo: 1.6,
            punish: 0.2,
            lunge: 0.015,
            speed: 0.78,
            spike_ms: 0,
            gift_r: 3.5,
            throw: 0.12,
        },
        crate::level::HARD => Skill {
            wobble: 0.12,
            defend: 1.3,
            uptake: (0.0, 70.0),
            gap: (260.0, 380.0),
            combo: 3.0,
            punish: 0.85,
            lunge: 0.07,
            speed: 1.0,
            spike_ms: 500,
            gift_r: 8.0,
            throw: 0.6,
        },
        _ => Skill {
            wobble: 0.3,
            defend: 1.0,
            uptake: (60.0, 220.0),
            gap: (450.0, 700.0),
            combo: 3.0,
            punish: 0.55,
            lunge: 0.04,
            speed: 0.95,
            spike_ms: 300,
            gift_r: 6.0,
            throw: 0.4,
        },
    }
}

/// What a bot is up to.
#[derive(Debug, Clone, Default)]
pub struct Ai {
    next_attack: u32,
    /// The enemy swing it last decided about (whose, and when it began), and what it chose.
    seen_swing: (u32, u32),
    plan: u8,
    plan_at: u32,
    strafe: f64,
    strafe_until: u32,
    charge_for: u32,
    combo_left: u8,
    wobble: f64,
}

#[derive(Debug, Clone)]
pub struct Fighter {
    pub id: u32,
    pub slot: usize,
    pub bot: bool,
    pub x: f64,
    pub y: f64,
    pub aim: f64,
    pub hp: f64,
    pub stamina: f64,
    pub rage: f64,
    pub act: u8,
    pub act_at: u32,
    pub act_until: u32,
    /// A slash asked for during the last one (the next in the combo follows on).
    pub queued: bool,
    /// Whether the current swing's blow has been dealt (each lands once).
    pub struck: bool,
    /// Who the current lunge or whirlwind has already hit (and when).
    pub hit_list: Vec<(u32, u32)>,
    /// When the shield went up (for parries).
    pub block_at: u32,
    pub roll_dir: f64,
    pub roll_ready: u32,
    /// How charged the heavy blow under way is (0..1).
    pub charge: f64,
    /// Knocked flying: velocity, until when (the server moves them then),
    /// whether they've slammed into a wall this time, and who did it.
    pub kvx: f64,
    pub kvy: f64,
    pub knocked_until: u32,
    pub slammed: bool,
    pub knocked_by: u32,
    pub down: bool,
    pub holding: u8,
    pub fury_until: u32,
    pub stamina_used: u32,
    /// Out of breath till then (stamina ran right out).
    pub winded_until: u32,
    /// A whirlwind asked for while busy, and when (0: none).
    pub special_at: u32,
    /// The spike rising that last hit them (once each).
    pub spiked: u32,
    /// Bumped whenever the server puts them somewhere (the client then takes its word).
    pub fix: u8,
    pub moved_at: u32,
    pub vx: f64,
    pub vy: f64,
    pub dealt: f64,
    pub downs: u8,
    pub ai: Ai,
}

impl Fighter {
    fn new(id: u32, slot: usize, at: (f64, f64), w: f64) -> Fighter {
        Fighter {
            id,
            slot,
            bot: is_bot(id),
            x: at.0,
            y: at.1,
            aim: if at.0 < w / 2.0 { 0.0 } else { PI },
            hp: HP,
            stamina: STAMINA,
            rage: 0.0,
            act: act::NONE,
            act_at: 0,
            act_until: 0,
            queued: false,
            struck: false,
            hit_list: Vec::new(),
            block_at: 0,
            roll_dir: 0.0,
            roll_ready: 0,
            charge: 0.0,
            kvx: 0.0,
            kvy: 0.0,
            knocked_until: 0,
            slammed: false,
            knocked_by: 0,
            down: false,
            holding: 0,
            fury_until: 0,
            stamina_used: 0,
            winded_until: 0,
            special_at: 0,
            spiked: 0,
            fix: 0,
            moved_at: 0,
            vx: 0.0,
            vy: 0.0,
            dealt: 0.0,
            downs: 0,
            ai: Ai::default(),
        }
    }

    /// Free to start something new.
    pub fn free(&self, now: u32) -> bool {
        !self.down
            && (self.act == act::NONE
                || self.act == act::BLOCK
                || (self.act_until <= now && self.act != act::STUN && self.act != act::CHARGE))
            && now >= self.knocked_until
    }

    pub fn flags(&self, now: u32) -> u8 {
        let mut f = 0;
        if self.down {
            f |= flag::DOWN;
        }
        if now < self.fury_until {
            f |= flag::FURY;
        }
        if now < self.knocked_until {
            f |= flag::KNOCKED;
        }
        if self.act == act::ROLL && now < self.act_at + ROLL_MS - 60 {
            f |= flag::IFRAMES;
        }
        if self.queued {
            f |= flag::QUEUED;
        }
        if now < self.winded_until {
            f |= flag::WINDED;
        }
        f
    }

    fn spend(&mut self, cost: f64, now: u32) -> bool {
        if self.stamina < cost * 0.5 {
            return false;
        }
        self.drain(cost, now);
        true
    }

    /// Stamina used up (run right out: winded).
    fn drain(&mut self, cost: f64, now: u32) {
        self.stamina = (self.stamina - cost).max(0.0);
        self.stamina_used = now;
        if self.stamina <= 0.0 && now >= self.winded_until {
            self.winded_until = now + WINDED_MS;
        }
    }

    pub fn winded(&self, now: u32) -> bool {
        now < self.winded_until
    }

    /// Rage gained (full once it's all but there, so "full" means full).
    fn gain_rage(&mut self, amount: f64) {
        self.rage = (self.rage + amount).min(RAGE);
        if self.rage > RAGE - 1.0 {
            self.rage = RAGE;
        }
    }

    /// Into the whirlwind (rage spent).
    fn whirl(&mut self, now: u32, evs: &mut Vec<Event>) {
        self.rage = 0.0;
        self.queued = false;
        self.special_at = 0;
        self.set(act::SPIN, now, SPIN_MS);
        evs.push(Event::new(ev::SPECIAL, self.id, 0, self.x, self.y, 0));
    }

    /// Free to roll or whirl: free, or in the tail of a slash, or charging (both cut short).
    pub fn can_cancel(&self, now: u32) -> bool {
        if self.down || now < self.knocked_until {
            return false;
        }
        if self.free(now) || self.act == act::CHARGE {
            return true;
        }
        match self.act {
            act::LIGHT1 | act::LIGHT2 | act::LIGHT3 => {
                let (w, a, _) = LIGHT[(self.act - act::LIGHT1) as usize];
                now >= self.act_at + w + a
            }
            _ => false,
        }
    }

    fn set(&mut self, a: u8, now: u32, len: u32) {
        self.act = a;
        self.act_at = now;
        self.act_until = now.saturating_add(len);
        self.struck = false;
        self.hit_list.clear();
    }

    fn fury(&self, now: u32) -> f64 {
        if now < self.fury_until { 1.5 } else { 1.0 }
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
    pub m: u16,
    pub vx: f64,
    pub vy: f64,
}

impl Event {
    fn new(kind: u8, a: u32, b: u32, x: f64, y: f64, n: u16) -> Event {
        Event {
            kind,
            a,
            b,
            x,
            y,
            n,
            m: 0,
            vx: 0.0,
            vy: 0.0,
        }
    }
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

/// The turn from angle `a` to `b`, -π..π.
fn turn(a: f64, b: f64) -> f64 {
    (b - a + PI).rem_euclid(TAU) - PI
}

#[derive(Debug, Clone)]
pub struct Match {
    pub ring: Ring,
    pub status: u8,
    pub phase_end: u32,
    pub round: u8,
    pub round_at: u32,
    /// Who has which place (0: free; bots are `BOT_BASE + place`), and their crowns.
    pub slots: [u32; SLOTS],
    pub crowns: [u8; SLOTS],
    pub fighters: Vec<Fighter>,
    pub missiles: Vec<Missile>,
    pub gifts: Vec<Gift>,
    pub next_gift: u32,
    /// The round's (and in the end the match's) winner: a player id, or 0.
    pub winner: u32,
    /// How good the bots are (`crate::level`), picked in the lobby.
    pub level: u8,
    fire_announced: bool,
}

impl Match {
    pub fn new(ring: Ring) -> Match {
        Match {
            ring,
            status: LOBBY,
            phase_end: 0,
            round: 0,
            round_at: 0,
            slots: [0; SLOTS],
            crowns: [0; SLOTS],
            fighters: Vec::new(),
            missiles: Vec::new(),
            gifts: Vec::new(),
            next_gift: 0,
            winner: 0,
            level: crate::level::MEDIUM,
            fire_announced: false,
        }
    }

    pub fn slot_of(&self, id: u32) -> Option<usize> {
        self.slots.iter().position(|&s| s == id && id != 0)
    }

    pub fn fighter(&self, id: u32) -> Option<&Fighter> {
        self.fighters.iter().find(|f| f.id == id)
    }

    fn index(&self, id: u32) -> Option<usize> {
        self.fighters.iter().position(|f| f.id == id)
    }

    pub fn running(&self) -> bool {
        matches!(self.status, COUNTDOWN | FIGHTING | ROUND_END)
    }

    /// Whether `id` is in a match now (on the sand: they don't walk about).
    pub fn playing(&self, id: u32) -> bool {
        (self.running() || self.status == OVER) && self.index(id).is_some()
    }

    /// Where each fighter's parade ends (arena tiles): the champion at the
    /// foot of the carpet, the others in a line behind (most crowns first).
    pub fn parade_end(&self) -> Vec<(u32, f64, f64)> {
        let x = self.ring.w / 2.0;
        let y = self.ring.h + PARADE_END;
        let mut rest: Vec<&Fighter> = self
            .fighters
            .iter()
            .filter(|f| f.id != self.winner)
            .collect();
        rest.sort_by_key(|f| (std::cmp::Reverse(self.crowns[f.slot]), f.slot));
        let mut out = Vec::new();
        if self.winner != 0 {
            out.push((self.winner, x, y));
        }
        for (k, f) in rest.iter().enumerate() {
            let side = if k % 2 == 0 { -0.55 } else { 0.55 };
            out.push((f.id, x + side, y - PARADE_FIRST_GAP - PARADE_GAP * k as f64));
        }
        out
    }

    pub fn humans(&self) -> usize {
        self.slots.iter().filter(|&&s| s != 0 && !is_bot(s)).count()
    }

    /// How far the ring of fire has closed: 1.15 (not at all) … `FIRE_MIN`.
    pub fn fire(&self, now: u32) -> f64 {
        if self.status != FIGHTING || now < self.round_at + FIRE_AFTER_MS {
            return 1.15;
        }
        let t = (now - self.round_at - FIRE_AFTER_MS) as f64 / FIRE_CLOSE_MS as f64;
        1.15 - (1.15 - FIRE_MIN) * t.min(1.0)
    }

    /// Spike plate `k` now: 0 down, 1 rattling (about to rise), 2 up; and which rising it is.
    pub fn spike_phase(&self, k: usize, now: u32) -> (u8, u32) {
        if self.status != FIGHTING {
            return (0, 0);
        }
        let n = self.ring.spikes.len().max(1) as u32;
        let t = now.saturating_sub(self.round_at) + 2000 + (k as u32) * (SPIKE_CYCLE_MS / n);
        let cycle = t / SPIKE_CYCLE_MS;
        let into = t % SPIKE_CYCLE_MS;
        let up_at = SPIKE_CYCLE_MS - SPIKE_UP_MS;
        let phase = if into >= up_at {
            2
        } else if into >= up_at - SPIKE_WARN_MS {
            1
        } else {
            0
        };
        (phase, cycle * 16 + k as u32 + 1)
    }

    /// `id` takes a place: a free one, or a bot's (the bot steps aside). The
    /// first to sign up in the lobby gets bots in all the other places (to
    /// take out, or put back, with `set_bot`).
    pub fn join(&mut self, id: u32, now: u32) -> bool {
        if self.slot_of(id).is_some() {
            return true;
        }
        let s = if self.running() {
            (0..SLOTS)
                .find(|&k| is_bot(self.slots[k]))
                .or_else(|| (0..SLOTS).find(|&k| self.slots[k] == 0))
        } else {
            (0..SLOTS)
                .find(|&k| self.slots[k] == 0)
                .or_else(|| (0..SLOTS).find(|&k| is_bot(self.slots[k])))
        };
        let Some(s) = s else { return false };
        let old = self.slots[s];
        self.slots[s] = id;
        if !self.running() && self.humans() == 1 {
            for k in 0..SLOTS {
                if self.slots[k] == 0 {
                    self.slots[k] = BOT_BASE + k as u32;
                }
            }
        }
        if self.running() {
            if let Some(i) = self.index(old) {
                // Into the bot's sandals: where it stood, as hurt as it was.
                let b = &mut self.fighters[i];
                b.id = id;
                b.bot = false;
                b.ai = Ai::default();
                b.moved_at = now;
                b.fix = b.fix.wrapping_add(1);
                if !b.down {
                    b.act = act::NONE;
                }
            } else {
                // Arriving into an empty place mid-round: in from the next one.
                let mut f = Fighter::new(id, s, self.ring.gate(s), self.ring.w);
                if self.status == FIGHTING {
                    f.down = true;
                    f.hp = 0.0;
                    f.act = act::DOWN;
                }
                self.fighters.push(f);
            }
        }
        true
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

    /// `id` leaves: mid-match, a bot takes their place (or, with nobody left, it's called off).
    pub fn leave(&mut self, id: u32) {
        let Some(s) = self.slot_of(id) else { return };
        self.slots[s] = 0;
        if !self.running() {
            // Nobody left in the lobby: the bots go too (and the level's back to medium).
            if self.humans() == 0 {
                for s in self.slots.iter_mut() {
                    if is_bot(*s) {
                        *s = 0;
                    }
                }
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
            let f = &mut self.fighters[i];
            f.id = bot;
            f.bot = true;
            f.ai = Ai::default();
            if !f.down {
                f.act = act::NONE;
            }
        }
    }

    /// Back to the lobby: the same places (bots and all) for another, unless nobody's left.
    fn back_to_lobby(&mut self) {
        self.status = LOBBY;
        self.fighters.clear();
        self.missiles.clear();
        self.gifts.clear();
        self.round = 0;
        self.crowns = [0; SLOTS];
        if self.humans() == 0 {
            for s in self.slots.iter_mut() {
                if is_bot(*s) {
                    *s = 0;
                }
            }
        }
    }

    /// The match begins, with whoever (and whichever bots) have the places;
    /// with `bots`, any empty places filled with bots too. Two at least.
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
        }
        if self.slots.iter().filter(|&&s| s != 0).count() < 2 {
            return false;
        }
        self.crowns = [0; SLOTS];
        self.round = 0;
        self.fighters = (0..SLOTS)
            .filter(|&s| self.slots[s] != 0)
            .map(|s| Fighter::new(self.slots[s], s, self.ring.gate(s), self.ring.w))
            .collect();
        self.begin_round(now);
        true
    }

    fn begin_round(&mut self, now: u32) {
        self.round += 1;
        self.status = COUNTDOWN;
        self.phase_end = now + COUNTDOWN_MS;
        self.missiles.clear();
        self.gifts.clear();
        self.winner = 0;
        self.fire_announced = false;
        let w = self.ring.w;
        let gates: Vec<(f64, f64)> = (0..SLOTS).map(|k| self.ring.gate(k)).collect();
        for f in self.fighters.iter_mut() {
            let mut n = Fighter::new(f.id, f.slot, gates[f.slot], w);
            n.fix = f.fix.wrapping_add(1);
            n.bot = f.bot;
            n.dealt = f.dealt;
            n.downs = f.downs;
            n.moved_at = now;
            n.ai.next_attack = now + COUNTDOWN_MS + 400;
            *f = n;
        }
    }

    /// The client says where it is (and aims): taken if it could have got
    /// there (rolls and lunges included), else as far as it could (and
    /// it's told). Not while knocked flying or reeling: then the server has them.
    pub fn claim_move(&mut self, id: u32, x: f64, y: f64, aim: f64, now: u32) {
        let Some(i) = self.index(id) else { return };
        let ring = &self.ring;
        let f = &mut self.fighters[i];
        if f.down || self.status != FIGHTING {
            return;
        }
        if !matches!(f.act, act::ROLL | act::STUN | act::HEAVY | act::SPIN) {
            f.aim = aim;
        }
        if now < f.knocked_until || f.act == act::STUN {
            f.moved_at = now;
            return;
        }
        // (At least 50 ms: moves that reach us in the same tick are still fair.)
        let dt = now.saturating_sub(f.moved_at).clamp(50, 500) as f64 / 1000.0;
        let fast = matches!(f.act, act::ROLL | act::HEAVY)
            || now < f.roll_ready.saturating_sub(ROLL_CD_MS) + 250;
        let speed = if fast { 10.0 } else { SPEED };
        let allowed = speed * dt * 1.4 + 0.4;
        let (dx, dy) = (x - f.x, y - f.y);
        let d = dx.hypot(dy);
        if d <= allowed && ring.free(x, y, BODY_R - 0.06) {
            f.vx = dx / dt;
            f.vy = dy / dt;
            f.x = x;
            f.y = y;
        } else {
            let k = (allowed / d.max(1e-9)).min(1.0);
            let (nx, ny, _) = ring.slide(f.x, f.y, dx * k, dy * k, BODY_R);
            f.x = nx;
            f.y = ny;
            f.fix = f.fix.wrapping_add(1);
        }
        f.moved_at = now;
    }

    /// A move asked for: a slash, charging and loosing a heavy blow, the
    /// shield up or down, a roll, a throw, the whirlwind.
    pub fn input(&mut self, id: u32, what: u8, aim: f64, now: u32) -> Vec<Event> {
        let mut evs = Vec::new();
        let Some(i) = self.index(id) else { return evs };
        if self.status != FIGHTING {
            return evs;
        }
        let f = &mut self.fighters[i];
        if f.down || now < f.knocked_until || f.act == act::STUN {
            if what == input::BLOCK_OFF && f.act == act::BLOCK {
                f.act = act::NONE;
            }
            if what == input::SPECIAL && !f.down && f.rage >= RAGE {
                f.special_at = now.max(1);
            }
            return evs;
        }
        match what {
            input::LIGHT => {
                if matches!(f.act, act::LIGHT1 | act::LIGHT2) {
                    // Mid-combo: the next slash follows on.
                    f.queued = true;
                } else if f.free(now) && f.spend(LIGHT_COST, now) {
                    f.aim = aim;
                    let (w, a, r) = LIGHT[0];
                    f.set(act::LIGHT1, now, w + a + r);
                    evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::LIGHT1 as u16));
                }
            }
            input::HEAVY_START => {
                if f.free(now) {
                    f.aim = aim;
                    f.set(act::CHARGE, now, u32::MAX - now);
                }
            }
            input::HEAVY_RELEASE => {
                if f.act == act::CHARGE {
                    let held = now.saturating_sub(f.act_at);
                    f.aim = aim;
                    if held < HEAVY_MIN_MS {
                        // Let go too soon: just a slash.
                        if f.spend(LIGHT_COST, now) {
                            let (w, a, r) = LIGHT[0];
                            f.set(act::LIGHT1, now, w + a + r);
                            evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::LIGHT1 as u16));
                        } else {
                            f.act = act::NONE;
                        }
                    } else if !f.winded(now) && f.spend(HEAVY_COST, now) {
                        f.charge = ((held - HEAVY_MIN_MS) as f64
                            / (HEAVY_FULL_MS - HEAVY_MIN_MS) as f64)
                            .min(1.0);
                        let (w, a, r) = HEAVY;
                        f.set(act::HEAVY, now, w + a + r);
                        evs.push(Event::new(ev::SWING, f.id, 0, f.x, f.y, act::HEAVY as u16));
                    } else {
                        f.act = act::NONE;
                    }
                }
            }
            input::BLOCK_ON => {
                if f.free(now) && f.act != act::BLOCK {
                    f.act = act::BLOCK;
                    f.act_at = now;
                    f.block_at = now;
                    f.act_until = u32::MAX;
                }
            }
            input::BLOCK_OFF => {
                if f.act == act::BLOCK {
                    f.act = act::NONE;
                    f.act_until = now;
                }
            }
            input::ROLL => {
                if f.can_cancel(now)
                    && now >= f.roll_ready
                    && !f.winded(now)
                    && f.spend(ROLL_COST, now)
                {
                    f.queued = false;
                    f.roll_dir = aim;
                    f.set(act::ROLL, now, ROLL_MS);
                    f.roll_ready = now + ROLL_MS + ROLL_CD_MS;
                    evs.push(Event::new(ev::ROLL, f.id, 0, f.x, f.y, 0));
                }
            }
            input::THROW => {
                if f.holding != 0 && f.free(now) {
                    f.aim = aim;
                    f.set(act::THROW, now, THROW.0 + THROW.1);
                }
            }
            input::SPECIAL if f.rage >= RAGE => {
                if f.can_cancel(now) {
                    f.whirl(now, &mut evs);
                } else {
                    // Busy: it goes off the moment they're free.
                    f.special_at = now.max(1);
                }
            }
            _ => {}
        }
        evs
    }

    /// A tick: the round's phases, the bots, every swing's blow, knockback,
    /// missiles, spikes, gifts, the fire, and who's still standing.
    pub fn step(&mut self, now: u32, dt_ms: u32, rng: &mut impl FnMut() -> f64) -> Vec<Event> {
        let mut evs = Vec::new();
        match self.status {
            COUNTDOWN if now >= self.phase_end => {
                self.status = FIGHTING;
                self.round_at = now;
                self.next_gift = now + 5000 + (rng() * GIFT_JITTER_MS as f64) as u32;
                for f in self.fighters.iter_mut() {
                    f.moved_at = now;
                }
                evs.push(Event::new(ev::FIGHT, 0, 0, 0.0, 0.0, self.round as u16));
            }
            ROUND_END if now >= self.phase_end => {
                self.begin_round(now);
                evs.push(Event::new(
                    ev::ROUND_START,
                    0,
                    0,
                    0.0,
                    0.0,
                    self.round as u16,
                ));
            }
            OVER if now >= self.phase_end => self.back_to_lobby(),
            _ => {}
        }
        if self.status != FIGHTING {
            return evs;
        }
        let dt = dt_ms as f64 / 1000.0;
        for i in 0..self.fighters.len() {
            if self.fighters[i].bot {
                let more = self.bot(i, now, dt, rng);
                evs.extend(more);
            }
        }
        for i in 0..self.fighters.len() {
            self.tick_fighter(i, now, dt, &mut evs);
        }
        self.fly(now, dt, &mut evs);
        self.spikes(now, &mut evs);
        self.gifts(now, rng, &mut evs);
        // The fire.
        let fire = self.fire(now);
        if fire < 1.15 && !self.fire_announced {
            self.fire_announced = true;
            evs.push(Event::new(ev::FIRE, 0, 0, 0.0, 0.0, 0));
        }
        for i in 0..self.fighters.len() {
            let f = &self.fighters[i];
            if !f.down && self.ring.reach(f.x, f.y) > fire {
                self.fighters[i].hp -= FIRE_DPS * dt;
                if self.fighters[i].hp <= 0.0 {
                    self.knock_down(i, 0, now, &mut evs);
                }
            }
        }
        // Who's left?
        let standing: Vec<u32> = self
            .fighters
            .iter()
            .filter(|f| !f.down)
            .map(|f| f.id)
            .collect();
        if standing.len() <= 1 {
            let winner = standing.first().copied().unwrap_or(0);
            self.winner = winner;
            if let Some(s) = self.slot_of(winner) {
                self.crowns[s] += 1;
            }
            evs.push(Event::new(
                ev::ROUND_WON,
                winner,
                0,
                0.0,
                0.0,
                self.round as u16,
            ));
            if self.crowns.iter().any(|&c| c >= TO_WIN) {
                self.status = OVER;
                self.phase_end = now + OVER_MS;
                evs.push(Event::new(ev::CHAMPION, winner, 0, 0.0, 0.0, 0));
            } else {
                self.status = ROUND_END;
                self.phase_end = now + ROUND_END_MS;
            }
            self.missiles.clear();
        }
        evs
    }

    /// One fighter's tick: stamina, their swing playing out (its blow
    /// landing), being knocked flying.
    fn tick_fighter(&mut self, i: usize, now: u32, dt: f64, evs: &mut Vec<Event>) {
        if self.fighters[i].down {
            return;
        }
        {
            let f = &mut self.fighters[i];
            if now >= f.stamina_used + STAMINA_DELAY_MS && !f.winded(now) && f.act != act::CHARGE {
                let rate = if f.act == act::BLOCK {
                    STAMINA_REGEN * BLOCK_REGEN
                } else {
                    STAMINA_REGEN
                };
                f.stamina = (f.stamina + rate * dt).min(STAMINA);
            }
        }
        // A whirlwind asked for while busy: now, if it can.
        {
            let f = &mut self.fighters[i];
            if f.special_at != 0 {
                if now > f.special_at + SPECIAL_BUFFER_MS || f.rage < RAGE {
                    f.special_at = 0;
                } else if f.can_cancel(now) {
                    f.whirl(now, evs);
                }
            }
        }
        // Knocked flying.
        let (kvx, kvy) = (self.fighters[i].kvx, self.fighters[i].kvy);
        if kvx.hypot(kvy) > 0.3 {
            let f = &self.fighters[i];
            let speed = kvx.hypot(kvy);
            let (nx, ny, bumped) = self.ring.slide(f.x, f.y, kvx * dt, kvy * dt, BODY_R);
            let decay = (-KB_FRICTION * dt).exp();
            let f = &mut self.fighters[i];
            f.x = nx;
            f.y = ny;
            f.kvx *= decay;
            f.kvy *= decay;
            if bumped && speed > WALL_SLAM_SPEED && !f.slammed {
                f.slammed = true;
                f.kvx = 0.0;
                f.kvy = 0.0;
                let by = f.knocked_by;
                f.hp -= WALL_SLAM_DMG;
                f.set(act::STUN, now, 500);
                f.knocked_until = now;
                evs.push(Event::new(
                    ev::WALL_SLAM,
                    by,
                    f.id,
                    f.x,
                    f.y,
                    WALL_SLAM_DMG as u16,
                ));
                if f.hp <= 0.0 {
                    self.knock_down(i, by, now, evs);
                    return;
                }
            } else if bumped {
                f.kvx *= 0.3;
                f.kvy *= 0.3;
            }
            let f = &mut self.fighters[i];
            if f.kvx.hypot(f.kvy) < 0.3 {
                f.kvx = 0.0;
                f.kvy = 0.0;
            }
        }
        let f = self.fighters[i].clone();
        let since = now.saturating_sub(f.act_at);
        match f.act {
            act::LIGHT1 | act::LIGHT2 | act::LIGHT3 => {
                let k = (f.act - act::LIGHT1) as usize;
                let (w, a, _) = LIGHT[k];
                if !f.struck && since >= w {
                    self.fighters[i].struck = true;
                    let dmg = LIGHT_DMG[k] * f.fury(now);
                    let (bits, stun) = if k == 2 { (4, 380) } else { (0, 230) };
                    self.cleave(
                        i,
                        LIGHT_REACH,
                        LIGHT_ARC,
                        dmg,
                        LIGHT_KB[k],
                        bits,
                        stun,
                        now,
                        evs,
                    );
                }
                let g = &self.fighters[i];
                if g.act != f.act {
                    // (Parried mid-swing: it's over.)
                } else if now >= g.act_until {
                    let g = &mut self.fighters[i];
                    if g.queued && k < 2 && g.spend(LIGHT_COST, now) {
                        g.queued = false;
                        let next = act::LIGHT1 + k as u8 + 1;
                        let (w, a, r) = LIGHT[k + 1];
                        g.set(next, now, w + a + r);
                        evs.push(Event::new(ev::SWING, g.id, 0, g.x, g.y, next as u16));
                    } else {
                        g.queued = false;
                        g.act = act::NONE;
                    }
                } else if since >= w + a && g.queued && k < 2 {
                    // Chained in: no need to wait out the recovery.
                    self.fighters[i].act_until = now;
                }
            }
            act::HEAVY => {
                let (w, a, _) = HEAVY;
                if since >= w && since < w + a + 100 {
                    // The lunge: forward (the bots, by the server; people, by their clients).
                    if f.bot {
                        let step = HEAVY_LUNGE * (1.0 + f.charge * 0.3) / (a as f64 / 1000.0) * dt;
                        let (nx, ny, _) = self.ring.slide(
                            f.x,
                            f.y,
                            f.aim.cos() * step,
                            f.aim.sin() * step,
                            BODY_R,
                        );
                        self.fighters[i].x = nx;
                        self.fighters[i].y = ny;
                    }
                    let dmg = (20.0 + 18.0 * f.charge) * f.fury(now);
                    let kb = 7.0 + 6.0 * f.charge;
                    self.cleave(i, HEAVY_REACH, HEAVY_ARC, dmg, kb, 2, 520, now, evs);
                }
                if self.fighters[i].act == act::HEAVY && now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::ROLL => {
                if f.bot && since < ROLL_MS {
                    let step = ROLL_DIST / (ROLL_MS as f64 / 1000.0) * dt;
                    let (nx, ny, _) = self.ring.slide(
                        f.x,
                        f.y,
                        f.roll_dir.cos() * step,
                        f.roll_dir.sin() * step,
                        BODY_R,
                    );
                    self.fighters[i].x = nx;
                    self.fighters[i].y = ny;
                }
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::THROW => {
                if !f.struck && since >= THROW.0 {
                    self.fighters[i].struck = true;
                    let kind = f.holding;
                    self.fighters[i].holding = 0;
                    if kind != 0 {
                        self.missiles
                            .push(Missile::new(f.id, kind, f.x, f.y, f.aim));
                        let mut e = Event::new(ev::THROW, f.id, 0, f.x, f.y, kind as u16);
                        e.m = aim_to_u16(f.aim);
                        evs.push(e);
                    }
                }
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::SPIN => {
                self.cleave(
                    i,
                    SPIN_REACH,
                    PI + 0.01,
                    SPIN_DMG * f.fury(now),
                    4.5,
                    16,
                    200,
                    now,
                    evs,
                );
                if now >= f.act_until {
                    self.fighters[i].act = act::NONE;
                }
            }
            act::STUN if now >= f.act_until => {
                self.fighters[i].act = act::NONE;
            }
            _ => {}
        }
    }

    /// Fighter `i`'s blade sweeps the arc in front of them (`arc` either side
    /// of their aim, `reach` far): each one in it is struck (once per swing;
    /// a whirlwind's, every `SPIN_EVERY_MS`).
    #[allow(clippy::too_many_arguments)]
    fn cleave(
        &mut self,
        i: usize,
        reach: f64,
        arc: f64,
        dmg: f64,
        kb: f64,
        bits: u16,
        stun: u32,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let a = self.fighters[i].clone();
        let victims: Vec<usize> = (0..self.fighters.len())
            .filter(|&j| j != i)
            .filter(|&j| {
                let v = &self.fighters[j];
                if v.down {
                    return false;
                }
                let d = (v.x - a.x).hypot(v.y - a.y);
                d < reach + BODY_R
                    && turn(a.aim, (v.y - a.y).atan2(v.x - a.x)).abs() <= arc
                    && self.ring.clear_line(a.x, a.y, v.x, v.y)
            })
            .collect();
        for j in victims {
            let vid = self.fighters[j].id;
            let spin = a.act == act::SPIN;
            if let Some(&(_, at)) = self.fighters[i].hit_list.iter().find(|(id, _)| *id == vid)
                && (!spin || now < at + SPIN_EVERY_MS)
            {
                continue;
            }
            self.fighters[i].hit_list.retain(|(id, _)| *id != vid);
            self.fighters[i].hit_list.push((vid, now));
            self.strike(i, j, (a.x, a.y), dmg, kb, bits, stun, now, evs);
        }
    }

    /// Attacker `i`'s blow, coming from `from`, lands on `j` (unless they've
    /// rolled clear, blocked or parried it).
    #[allow(clippy::too_many_arguments)]
    fn strike(
        &mut self,
        i: usize,
        j: usize,
        from: (f64, f64),
        dmg: f64,
        kb: f64,
        bits: u16,
        stun: u32,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let ((ax, ay), aid) = (from, self.fighters[i].id);
        let v = &self.fighters[j];
        if v.down || v.flags(now) & flag::IFRAMES != 0 {
            return;
        }
        let dir = (v.y - ay).atan2(v.x - ax);
        let rage_before = (self.fighters[i].rage, v.rage);
        let (mut dmg, mut kb, mut stun, mut bits) = (dmg, kb, stun, bits);
        let heavy = bits & 2 != 0;
        let thrown = bits & 8 != 0;
        // The shield: facing the blow (a bomb's blast goes round it).
        if v.act == act::BLOCK && bits & 32 == 0 && turn(v.aim, dir + PI).abs() <= BLOCK_ARC {
            if now.saturating_sub(v.block_at) <= PARRY_MS && !thrown && bits & 16 == 0 {
                // A parry! The attacker reels.
                let vid = v.id;
                let a = &mut self.fighters[i];
                a.set(
                    act::STUN,
                    now,
                    if heavy {
                        HEAVY_PARRIED_STUN_MS
                    } else {
                        PARRIED_STUN_MS
                    },
                );
                a.queued = false;
                if heavy {
                    a.drain(HEAVY_PARRIED_COST, now);
                }
                let v = &mut self.fighters[j];
                v.gain_rage(if heavy { 35.0 } else { 25.0 });
                v.block_at = 0;
                evs.push(Event::new(ev::PARRY, vid, aid, v.x, v.y, heavy as u16));
                if rage_before.1 < RAGE && v.rage >= RAGE {
                    evs.push(Event::new(ev::RAGE_FULL, vid, 0, v.x, v.y, 0));
                }
                return;
            }
            let v = &mut self.fighters[j];
            if heavy {
                v.drain(40.0, now);
                v.act = act::NONE;
                dmg *= 0.5;
                kb *= 0.7;
                stun = 600;
                evs.push(Event::new(ev::GUARD_BREAK, aid, v.id, v.x, v.y, 0));
            } else {
                v.drain(BLOCK_HIT_COST, now);
                dmg *= 0.15;
                kb *= 0.35;
                stun = 0;
                bits |= 1;
                if v.stamina <= 0.0 {
                    v.act = act::NONE;
                    stun = 500;
                    evs.push(Event::new(ev::GUARD_BREAK, aid, v.id, v.x, v.y, 0));
                }
            }
        }
        let v = &mut self.fighters[j];
        // The whirling can't be stopped.
        if v.act == act::SPIN {
            dmg *= 0.5;
            kb = 0.0;
            stun = 0;
        }
        v.hp -= dmg;
        v.gain_rage(dmg * 0.9);
        if kb > 0.0 {
            v.kvx = dir.cos() * kb;
            v.kvy = dir.sin() * kb;
            v.knocked_until = now + (kb * 45.0) as u32;
            v.slammed = false;
            v.knocked_by = aid;
        }
        if stun > 0 && v.act != act::SPIN {
            v.set(act::STUN, now, stun);
            v.queued = false;
        }
        let mut e = Event::new(ev::HIT, aid, v.id, v.x, v.y, dmg.round() as u16);
        e.m = bits;
        e.vx = v.kvx;
        e.vy = v.kvy;
        evs.push(e);
        let a = &mut self.fighters[i];
        a.gain_rage(dmg * 0.6);
        a.dealt += dmg;
        for (k, before) in [(i, rage_before.0), (j, rage_before.1)] {
            let f = &self.fighters[k];
            if before < RAGE && f.rage >= RAGE && !f.down {
                evs.push(Event::new(ev::RAGE_FULL, f.id, 0, f.x, f.y, 0));
            }
        }
        if self.fighters[j].hp <= 0.0 {
            self.knock_down(j, aid, now, evs);
        }
    }

    fn knock_down(&mut self, i: usize, by: u32, now: u32, evs: &mut Vec<Event>) {
        let f = &mut self.fighters[i];
        if f.down {
            return;
        }
        f.down = true;
        f.hp = 0.0;
        f.act = act::DOWN;
        f.act_at = now;
        f.kvx *= 0.5;
        f.kvy *= 0.5;
        f.holding = 0;
        let (id, x, y) = (f.id, f.x, f.y);
        evs.push(Event::new(ev::DOWN, by, id, x, y, 0));
        if let Some(k) = self.fighters.iter_mut().find(|k| k.id == by && k.id != id) {
            k.downs += 1;
        }
    }

    fn fly(&mut self, now: u32, dt: f64, evs: &mut Vec<Event>) {
        let mut missiles = std::mem::take(&mut self.missiles);
        let mut landed: Vec<(Missile, Flight)> = Vec::new();
        missiles.retain_mut(|m| {
            let fighters = &self.fighters;
            let by = m.by;
            let flight = m.advance(&self.ring, dt, |x, y| {
                fighters.iter().position(|f| {
                    f.id != by
                        && !f.down
                        && f.flags(now) & flag::IFRAMES == 0
                        && (f.x - x).hypot(f.y - y) < BODY_R + 0.2
                })
            });
            if flight == Flight::Flying {
                true
            } else {
                landed.push((m.clone(), flight));
                false
            }
        });
        self.missiles = missiles;
        for (m, flight) in landed {
            let shooter = self.index(m.by);
            let (x, y) = match flight {
                Flight::Stopped(x, y) | Flight::Hit(_, x, y) => (x, y),
                Flight::Flying => continue,
            };
            if m.kind == gift::BOMB {
                evs.push(Event::new(ev::BOOM, m.by, 0, x, y, 0));
                for j in 0..self.fighters.len() {
                    let f = &self.fighters[j];
                    let d = (f.x - x).hypot(f.y - y);
                    if f.down || d > BOMB_R {
                        continue;
                    }
                    let dmg = BOMB_DMG * (1.0 - d / BOMB_R * 0.6);
                    match shooter {
                        Some(i) if i != j => self.blast(i, j, x, y, dmg, now, evs),
                        _ => {
                            // Caught in your own blast: it still hurts.
                            let f = &mut self.fighters[j];
                            f.hp -= dmg * 0.6;
                            if f.hp <= 0.0 {
                                self.knock_down(j, 0, now, evs);
                            }
                        }
                    }
                }
            } else if let Flight::Hit(j, _, _) = flight {
                if let Some(i) = shooter {
                    // As if struck from the way it came.
                    let from = (x - m.vx / SPEAR_SPEED, y - m.vy / SPEAR_SPEED);
                    let dmg = SPEAR_DMG * self.fighters[i].fury(now);
                    self.strike(i, j, from, dmg, 6.5, 8, 400, now, evs);
                }
            } else {
                let mut e = Event::new(ev::STUCK, m.by, 0, x, y, 0);
                e.m = aim_to_u16(m.vy.atan2(m.vx));
                evs.push(e);
            }
        }
    }

    /// A bomb's blast from (x, y) reaching `j` (thrown by `i`): no shield holds it.
    #[allow(clippy::too_many_arguments)]
    fn blast(
        &mut self,
        i: usize,
        j: usize,
        x: f64,
        y: f64,
        dmg: f64,
        now: u32,
        evs: &mut Vec<Event>,
    ) {
        let v = &self.fighters[j];
        // Right on top of it: blown whichever way.
        let from = if (v.x - x).hypot(v.y - y) < 0.05 {
            (x - 0.05, y)
        } else {
            (x, y)
        };
        self.strike(i, j, from, dmg, 9.0, 32, 450, now, evs);
    }

    fn spikes(&mut self, now: u32, evs: &mut Vec<Event>) {
        for k in 0..self.ring.spikes.len() {
            let (phase, rising) = self.spike_phase(k, now);
            if phase != 2 {
                continue;
            }
            let plate = self.ring.spikes[k];
            for j in 0..self.fighters.len() {
                let f = &self.fighters[j];
                if f.down
                    || f.spiked == rising
                    || f.flags(now) & flag::IFRAMES != 0
                    || !plate.contains(f.x, f.y, -0.1)
                {
                    continue;
                }
                let f = &mut self.fighters[j];
                f.spiked = rising;
                f.hp -= SPIKE_DMG;
                if f.act != act::SPIN {
                    f.set(act::STUN, now, 350);
                }
                let (id, x, y) = (f.id, f.x, f.y);
                evs.push(Event::new(ev::SPIKED, 0, id, x, y, SPIKE_DMG as u16));
                if self.fighters[j].hp <= 0.0 {
                    let by = self.fighters[j].knocked_by;
                    self.knock_down(j, by, now, evs);
                }
            }
        }
    }

    fn gifts(&mut self, now: u32, rng: &mut impl FnMut() -> f64, evs: &mut Vec<Event>) {
        self.gifts.retain(|g| now < g.gone);
        if now >= self.next_gift && self.gifts.len() < 3 {
            self.next_gift = now + GIFT_EVERY_MS + (rng() * GIFT_JITTER_MS as f64) as u32;
            // Somewhere open, inside the fire.
            let fire = self.fire(now + GIFT_FALL_MS);
            for _ in 0..20 {
                let x = 1.5 + rng() * (self.ring.w - 3.0);
                let y = 1.5 + rng() * (self.ring.h - 3.0);
                if !self.ring.free(x, y, 0.5)
                    || self.ring.spikes.iter().any(|s| s.contains(x, y, 0.4))
                    || self.ring.reach(x, y) > fire - 0.1
                {
                    continue;
                }
                // The crowd favours whoever's hurting: more roast legs when somebody's low.
                let hurt = self.fighters.iter().any(|f| !f.down && f.hp < 45.0);
                let kind = if hurt && rng() < 0.45 {
                    gift::HEALTH
                } else {
                    gift::ALL[(rng() * 4.0) as usize % 4]
                };
                self.gifts.push(Gift {
                    kind,
                    x,
                    y,
                    lands: now + GIFT_FALL_MS,
                    gone: now + GIFT_FALL_MS + GIFT_LASTS_MS,
                });
                evs.push(Event::new(ev::GIFT_INCOMING, 0, 0, x, y, kind as u16));
                break;
            }
        }
        let mut k = 0;
        while k < self.gifts.len() {
            let g = self.gifts[k];
            if now < g.lands {
                k += 1;
                continue;
            }
            let taker = self.fighters.iter().position(|f| {
                !f.down
                    && (f.x - g.x).hypot(f.y - g.y) < 0.75
                    && (matches!(g.kind, gift::HEALTH | gift::FURY) || f.holding == 0)
            });
            if let Some(j) = taker {
                let f = &mut self.fighters[j];
                match g.kind {
                    gift::HEALTH => f.hp = (f.hp + HEAL).min(HP),
                    gift::FURY => f.fury_until = now + FURY_MS,
                    kind => f.holding = kind,
                }
                evs.push(Event::new(ev::PICKUP, f.id, 0, g.x, g.y, g.kind as u16));
                self.gifts.remove(k);
            } else {
                k += 1;
            }
        }
    }

    // ---- the bots ----------------------------------------------------------

    /// A bot thinks (what's dangerous, whom to fight, how) and moves.
    fn bot(&mut self, i: usize, now: u32, dt: f64, rng: &mut impl FnMut() -> f64) -> Vec<Event> {
        let mut evs = Vec::new();
        let me = self.fighters[i].clone();
        if me.down || now < me.knocked_until {
            return evs;
        }
        let fire = self.fire(now);
        let sk = skill(self.level);
        // The nearest foe (the weakest a little nearer).
        let target = self
            .fighters
            .iter()
            .filter(|f| f.id != me.id && !f.down)
            .min_by(|a, b| {
                let score = |f: &Fighter| (f.x - me.x).hypot(f.y - me.y) + f.hp / 60.0;
                score(a).total_cmp(&score(b))
            })
            .cloned();
        let Some(t) = target else { return evs };
        let (dx, dy) = (t.x - me.x, t.y - me.y);
        let dist = dx.hypot(dy).max(0.01);
        let toward = dy.atan2(dx);
        {
            let ai = &mut self.fighters[i].ai;
            ai.wobble =
                (ai.wobble * 0.6 + (rng() - 0.5) * sk.wobble * 0.85).clamp(-sk.wobble, sk.wobble);
        }
        let aim = toward + self.fighters[i].ai.wobble;
        // Answering a blow coming its way.
        let heavy = matches!(t.act, act::HEAVY | act::CHARGE);
        let threat = matches!(
            t.act,
            act::LIGHT1 | act::LIGHT2 | act::LIGHT3 | act::CHARGE | act::HEAVY
        ) && dist < if heavy { 3.2 } else { 2.0 }
            && turn(t.aim, toward + PI).abs() < 0.9;
        if threat && self.fighters[i].ai.seen_swing != (t.id, t.act_at) {
            let r = rng();
            let roll = if heavy { 0.45 } else { 0.22 } * sk.defend;
            let block = (roll + if heavy { 0.15 } else { 0.46 } * sk.defend).min(0.95);
            let plan = if me.stamina > 30.0 && r < roll {
                2 // roll away
            } else if r < block && me.stamina > 15.0 {
                1 // block (sometimes in time to parry)
            } else {
                0 // trade blows
            };
            let ai = &mut self.fighters[i].ai;
            ai.seen_swing = (t.id, t.act_at);
            ai.plan = plan;
            // How quick it is on the uptake (a parry needs good timing; often it's early).
            ai.plan_at = now + (sk.uptake.0 + rng() * sk.uptake.1) as u32;
        }
        let mut want_block = false;
        if self.fighters[i].ai.seen_swing.0 == t.id && threat && now >= self.fighters[i].ai.plan_at
        {
            match self.fighters[i].ai.plan {
                1 => want_block = true,
                2 => {
                    let away = toward + PI + if rng() < 0.5 { 0.8 } else { -0.8 };
                    evs.extend(self.input(me.id, input::ROLL, away, now));
                    self.fighters[i].ai.plan = 0;
                }
                _ => {}
            }
        }
        let f = self.fighters[i].clone();
        if want_block && f.act != act::BLOCK && f.free(now) {
            evs.extend(self.input(me.id, input::BLOCK_ON, toward, now));
        } else if !want_block && f.act == act::BLOCK && (now > f.block_at + 450 || !threat) {
            evs.extend(self.input(me.id, input::BLOCK_OFF, toward, now));
        }
        // Moves.
        let f = self.fighters[i].clone();
        if f.free(now) && f.act != act::BLOCK {
            let crowd = self
                .fighters
                .iter()
                .filter(|o| o.id != f.id && !o.down && (o.x - f.x).hypot(o.y - f.y) < 2.2)
                .count();
            if f.rage >= RAGE && (dist < SPIN_REACH + 0.2 || crowd >= 2) {
                evs.extend(self.input(me.id, input::SPECIAL, aim, now));
            } else if f.holding != 0
                && (2.5..9.0).contains(&dist)
                && self.ring.clear_line(f.x, f.y, t.x, t.y)
                && rng() < sk.throw
            {
                let lead = dist
                    / if f.holding == gift::BOMB {
                        BOMB_SPEED
                    } else {
                        SPEAR_SPEED
                    };
                let a =
                    (t.y + t.vy * lead - f.y).atan2(t.x + t.vx * lead - f.x) + f.ai.wobble * 0.5;
                evs.extend(self.input(me.id, input::THROW, a, now));
            } else if dist < LIGHT_REACH + 0.15 && now >= f.ai.next_attack && f.stamina > LIGHT_COST
            {
                if (t.act == act::BLOCK || t.act == act::STUN)
                    && f.stamina > HEAVY_COST + 5.0
                    && rng() < sk.punish
                {
                    evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                    self.fighters[i].ai.charge_for = 250 + (rng() * 500.0) as u32;
                } else {
                    evs.extend(self.input(me.id, input::LIGHT, aim, now));
                    self.fighters[i].ai.combo_left = (rng() * sk.combo) as u8;
                }
            } else if dist < HEAVY_REACH + HEAVY_LUNGE * 0.7
                && dist > 1.6
                && now >= f.ai.next_attack
                && f.stamina > HEAVY_COST + 10.0
                && rng() < sk.lunge
            {
                evs.extend(self.input(me.id, input::HEAVY_START, aim, now));
                self.fighters[i].ai.charge_for = 300 + (rng() * 400.0) as u32;
            }
        }
        // Combos and charges play out.
        let f = self.fighters[i].clone();
        if matches!(f.act, act::LIGHT1 | act::LIGHT2)
            && f.ai.combo_left > 0
            && !f.queued
            && now >= f.act_at + 100
        {
            self.fighters[i].ai.combo_left -= 1;
            evs.extend(self.input(me.id, input::LIGHT, aim, now));
        }
        if f.act == act::CHARGE && now >= f.act_at + f.ai.charge_for {
            evs.extend(self.input(me.id, input::HEAVY_RELEASE, aim, now));
            self.fighters[i].ai.next_attack = now + (sk.gap.0 * 1.4 + rng() * sk.gap.1) as u32;
        }
        if f.act == act::LIGHT3
            || (matches!(f.act, act::LIGHT1 | act::LIGHT2) && f.ai.combo_left == 0 && !f.queued)
        {
            let ai = &mut self.fighters[i].ai;
            if ai.next_attack <= now {
                ai.next_attack = now + (sk.gap.0 + rng() * sk.gap.1) as u32;
            }
        }
        // Walking: off spikes and out of the fire, to a gift, or into range (circling a little).
        let f = self.fighters[i].clone();
        if !f.free(now) && f.act != act::BLOCK && f.act != act::CHARGE {
            if !matches!(f.act, act::ROLL | act::HEAVY | act::STUN | act::SPIN) {
                self.fighters[i].aim = aim;
            }
            return evs;
        }
        let (cx, cy) = (self.ring.w / 2.0, self.ring.h / 2.0);
        let danger_spike = self
            .ring
            .spikes
            .iter()
            .enumerate()
            .find(|(k, s)| {
                self.spike_phase(*k, now + sk.spike_ms).0 >= 1 && s.contains(f.x, f.y, 0.4)
            })
            .map(|(_, s)| *s);
        let gift_near = self
            .gifts
            .iter()
            .filter(|g| {
                now + 400 >= g.lands
                    && (matches!(g.kind, gift::HEALTH | gift::FURY) || f.holding == 0)
            })
            .filter(|g| g.kind != gift::HEALTH || f.hp < 75.0)
            .map(|g| (g.x, g.y, (g.x - f.x).hypot(g.y - f.y)))
            .filter(|g| g.2 < sk.gift_r && g.2 < dist + 1.5)
            .min_by(|a, b| a.2.total_cmp(&b.2));
        let (mut mx, mut my) = if self.ring.reach(f.x, f.y) > fire - 0.12 {
            (cx - f.x, cy - f.y)
        } else if let Some(s) = danger_spike {
            (f.x - (s.x + s.w / 2.0), f.y - (s.y + s.h / 2.0))
        } else if let Some((gx, gy, _)) = gift_near {
            (gx - f.x, gy - f.y)
        } else {
            if now >= f.ai.strafe_until {
                let ai = &mut self.fighters[i].ai;
                ai.strafe = if rng() < 0.5 { -1.0 } else { 1.0 } * (0.3 + rng() * 0.5);
                ai.strafe_until = now + 600 + (rng() * 900.0) as u32;
            }
            let want = if f.stamina < 25.0 { 2.6 } else { 1.05 };
            let radial = ((dist - want) / 0.8).clamp(-1.0, 1.0);
            let (ux, uy) = (dx / dist, dy / dist);
            let strafe = self.fighters[i].ai.strafe;
            (ux * radial - uy * strafe, uy * radial + ux * strafe)
        };
        let len = mx.hypot(my);
        if len > 1.0 {
            mx /= len;
            my /= len;
        }
        let slow = match f.act {
            act::BLOCK => 0.45,
            act::CHARGE => 0.55,
            _ => sk.speed,
        };
        let (nx, ny, _) = self.ring.slide(
            f.x,
            f.y,
            mx * SPEED * slow * dt,
            my * SPEED * slow * dt,
            BODY_R,
        );
        let f = &mut self.fighters[i];
        f.vx = (nx - f.x) / dt;
        f.vy = (ny - f.y) / dt;
        f.x = nx;
        f.y = ny;
        f.aim = aim;
        evs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring() -> Ring {
        Ring {
            w: 20.0,
            h: 13.0,
            pillars: vec![
                Rect {
                    x: 4.0,
                    y: 5.0,
                    w: 2.0,
                    h: 2.0,
                },
                Rect {
                    x: 14.0,
                    y: 5.0,
                    w: 2.0,
                    h: 2.0,
                },
            ],
            spikes: vec![
                Rect {
                    x: 9.0,
                    y: 1.0,
                    w: 2.0,
                    h: 2.0,
                },
                Rect {
                    x: 9.0,
                    y: 10.0,
                    w: 2.0,
                    h: 2.0,
                },
            ],
        }
    }

    fn rng(seed: u64) -> impl FnMut() -> f64 {
        let mut s = seed.wrapping_mul(2654435761).wrapping_add(1);
        move || {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (s >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// Two people facing off in the open, the round under way.
    fn duel() -> (Match, u32) {
        let mut m = Match::new(ring());
        m.join(1, 0);
        m.join(2, 0);
        // Just the two of them: the bots out.
        m.set_bot(1, 2, false);
        m.set_bot(1, 3, false);
        assert!(m.start(1, false, 0));
        assert_eq!(m.fighters.len(), 2);
        let mut r = rng(1);
        m.step(COUNTDOWN_MS, 100, &mut r);
        assert_eq!(m.status, FIGHTING);
        let t = COUNTDOWN_MS + 100;
        m.fighters[0].x = 9.0;
        m.fighters[0].y = 6.5;
        m.fighters[0].aim = 0.0;
        m.fighters[1].x = 10.0;
        m.fighters[1].y = 6.5;
        m.fighters[1].aim = PI;
        (m, t)
    }

    #[test]
    fn the_level_is_picked_in_the_lobby_and_harder_bots_fight_better() {
        let mut m = Match::new(ring());
        m.join(1, 0);
        assert!(m.set_level(1, crate::level::HARD));
        assert!(!m.set_level(1, crate::level::HARD), "no change");
        assert!(!m.set_level(2, crate::level::EASY), "only those in");
        assert_eq!(m.level, crate::level::HARD);
        m.leave(1);
        assert_eq!(
            m.level,
            crate::level::MEDIUM,
            "back to medium with nobody left"
        );
        // One bot against someone who just stands there: how long it takes to put them down.
        let down_in = |level: u8| {
            let mut total = 0;
            for seed in 0..6u64 {
                let mut m = Match::new(ring());
                m.join(1, 0);
                for k in 2..SLOTS {
                    m.set_bot(1, k, false);
                }
                m.set_level(1, level);
                assert!(m.start(1, false, 0));
                let mut r = rng(seed + 11);
                let mut now = 0;
                let from = loop {
                    now += 100;
                    m.step(now, 100, &mut r);
                    if m.status == FIGHTING {
                        break now;
                    }
                };
                while now < from + 60_000 {
                    now += 100;
                    m.step(now, 100, &mut r);
                    if m.fighter(1).is_none_or(|f| f.down) {
                        break;
                    }
                }
                total += now - from;
            }
            total / 6
        };
        let (easy, medium, hard) = (
            down_in(crate::level::EASY),
            down_in(crate::level::MEDIUM),
            down_in(crate::level::HARD),
        );
        eprintln!("ARENA LEVELS (ms to down someone): easy {easy}, medium {medium}, hard {hard}");
        assert!(
            easy > medium && medium > hard,
            "easy {easy}, medium {medium}, hard {hard}"
        );
    }

    #[test]
    fn bots_fill_the_places_and_can_be_taken_out_or_put_back() {
        let mut m = Match::new(ring());
        assert!(m.join(1, 0));
        // By default, bots in all the other places.
        assert!(m.slots[1..].iter().all(|&s| is_bot(s)));
        // Out with two of them: a one-on-one with a bot.
        assert!(m.set_bot(1, 2, false));
        assert!(m.set_bot(1, 3, false));
        assert!(!m.set_bot(7, 1, false), "only those with a place");
        assert!(m.start(1, false, 0));
        assert_eq!(m.fighters.len(), 2);
        assert!(m.fighters.iter().any(|f| f.bot));
        // Alone, with no bots: no match.
        let mut m = Match::new(ring());
        m.join(1, 0);
        for k in 1..SLOTS {
            m.set_bot(1, k, false);
        }
        assert!(!m.start(1, false, 0));
        // A bot put back, then someone else joins: they take an empty place first, then a bot's.
        m.set_bot(1, 2, true);
        m.join(2, 0);
        assert_eq!(m.slots[1], 2);
        m.join(3, 0);
        m.join(4, 0);
        assert_eq!(
            m.slots.iter().filter(|&&s| s != 0 && !is_bot(s)).count(),
            4,
            "{:?}",
            m.slots
        );
    }

    #[test]
    fn the_parade_ends_down_the_carpet_champion_first() {
        let (mut m, _) = duel();
        m.winner = 2;
        m.crowns = [1, 3, 0, 0];
        let end = m.parade_end();
        assert_eq!(end[0].0, 2, "the champion leads");
        assert_eq!(end[0].2, m.ring.h + PARADE_END);
        assert!(end[1].2 < end[0].2, "the others behind");
    }

    #[test]
    fn a_combo_lands_three_slashes() {
        let (mut m, mut t) = duel();
        let mut r = rng(2);
        m.input(1, input::LIGHT, 0.0, t);
        m.input(1, input::LIGHT, 0.0, t + 50);
        let mut hits = 0;
        for _ in 0..12 {
            t += 100;
            let evs = m.step(t, 100, &mut r);
            hits += evs.iter().filter(|e| e.kind == ev::HIT && e.a == 1).count();
            if m.fighters[0].act == act::LIGHT2 && !m.fighters[0].queued {
                m.input(1, input::LIGHT, 0.0, t);
            }
            // b stands its ground (back where it was, so every slash reaches).
            let b = &mut m.fighters[1];
            b.x = 10.0;
            b.kvx = 0.0;
            b.knocked_until = 0;
            if b.act == act::STUN {
                b.act = act::NONE;
            }
        }
        assert_eq!(hits, 3, "all three slashes");
        assert!(m.fighters[1].hp < HP - 30.0, "{}", m.fighters[1].hp);
    }

    #[test]
    fn a_parry_staggers_the_attacker_and_an_early_block_just_blocks() {
        let (mut m, t) = duel();
        let mut r = rng(3);
        m.input(1, input::LIGHT, 0.0, t);
        m.input(2, input::BLOCK_ON, PI, t + 60);
        let evs = m.step(t + 150, 100, &mut r);
        assert!(
            evs.iter().any(|e| e.kind == ev::PARRY && e.a == 2),
            "{evs:?}"
        );
        assert_eq!(m.fighters[0].act, act::STUN);
        assert_eq!(m.fighters[1].hp, HP);
        let (mut m, t) = duel();
        m.input(2, input::BLOCK_ON, PI, t - 500);
        m.input(1, input::LIGHT, 0.0, t);
        let evs = m.step(t + 150, 100, &mut r);
        let hit = evs
            .iter()
            .find(|e| e.kind == ev::HIT)
            .expect("a blocked hit");
        assert!(hit.m & 1 == 1 && hit.n <= 2, "{hit:?}");
    }

    #[test]
    fn a_heavy_blow_breaks_a_guard_and_slams_them_into_the_wall() {
        let (mut m, mut t) = duel();
        let mut r = rng(4);
        m.fighters[0].x = 17.3;
        m.fighters[1].x = 18.5;
        m.input(2, input::BLOCK_ON, PI, t - 500);
        m.input(1, input::HEAVY_START, 0.0, t);
        t += 900;
        m.input(1, input::HEAVY_RELEASE, 0.0, t);
        let mut seen = Vec::new();
        for _ in 0..10 {
            t += 100;
            seen.extend(m.step(t, 100, &mut r));
        }
        assert!(
            seen.iter().any(|e| e.kind == ev::GUARD_BREAK),
            "guard broken: {seen:?}"
        );
        assert!(
            seen.iter().any(|e| e.kind == ev::WALL_SLAM),
            "slammed: {seen:?}"
        );
    }

    #[test]
    fn a_parried_heavy_blow_leaves_the_attacker_open_and_winded() {
        let (mut m, mut t) = duel();
        let mut r = rng(11);
        m.input(1, input::HEAVY_START, 0.0, t);
        t += 600;
        m.input(1, input::HEAVY_RELEASE, 0.0, t);
        // b raises the shield just as the lunge lands.
        m.input(2, input::BLOCK_ON, PI, t + 60);
        let evs = m.step(t + 100, 100, &mut r);
        let p = evs.iter().find(|e| e.kind == ev::PARRY).expect("parried");
        assert_eq!(p.n, 1, "a heavy one");
        let a = &m.fighters[0];
        assert_eq!(a.act, act::STUN);
        assert!(a.act_until >= t + 100 + HEAVY_PARRIED_STUN_MS - 1);
        assert_eq!(m.fighters[1].hp, HP);
    }

    #[test]
    fn the_whirlwind_goes_off_when_rage_is_full_even_mid_swing() {
        let (mut m, t) = duel();
        let mut r = rng(12);
        // Rage that's all but full is full.
        m.fighters[0].gain_rage(99.4);
        assert_eq!(m.fighters[0].rage, RAGE);
        // Mid-slash (its tail): still goes.
        m.input(1, input::LIGHT, 0.0, t);
        m.step(t + 100, 100, &mut r);
        m.step(t + 200, 100, &mut r);
        let evs = m.input(1, input::SPECIAL, 0.0, t + 210);
        assert!(evs.iter().any(|e| e.kind == ev::SPECIAL), "whirled");
        assert_eq!(m.fighters[0].act, act::SPIN);
        let mut hits = 0;
        for k in 1..9 {
            m.fighters[1].x = 10.0;
            m.fighters[1].kvx = 0.0;
            hits += m
                .step(t + 210 + k * 100, 100, &mut r)
                .iter()
                .filter(|e| e.kind == ev::HIT && e.a == 1 && e.m & 16 != 0)
                .count();
        }
        assert!(hits >= 3, "the whirlwind keeps hitting: {hits}");
    }

    #[test]
    fn a_whirlwind_asked_for_mid_roll_goes_off_when_the_roll_ends() {
        let (mut m, t) = duel();
        let mut r = rng(13);
        m.fighters[0].gain_rage(100.0);
        m.input(1, input::ROLL, PI, t);
        assert_eq!(m.fighters[0].act, act::ROLL);
        assert!(
            m.input(1, input::SPECIAL, 0.0, t + 50).is_empty(),
            "not mid-roll"
        );
        let mut whirled = false;
        for k in 1..=6 {
            whirled |= m
                .step(t + k * 100, 100, &mut r)
                .iter()
                .any(|e| e.kind == ev::SPECIAL && e.a == 1);
        }
        assert!(whirled, "as soon as the roll was done");
    }

    #[test]
    fn running_out_of_stamina_leaves_you_winded() {
        let (mut m, t) = duel();
        m.fighters[0].stamina = 20.0;
        assert!(
            m.input(1, input::ROLL, 1.0, t)
                .iter()
                .any(|e| e.kind == ev::ROLL)
        );
        assert!(m.fighters[0].winded(t + 10));
        // No more rolls till it passes.
        m.fighters[0].act = act::NONE;
        m.fighters[0].stamina = 80.0;
        assert!(
            m.input(1, input::ROLL, 1.0, t + ROLL_MS + ROLL_CD_MS + 10)
                .is_empty()
        );
    }

    #[test]
    fn rolling_dodges_the_blow() {
        let (mut m, t) = duel();
        let mut r = rng(5);
        m.input(1, input::LIGHT, 0.0, t);
        m.input(2, input::ROLL, PI / 2.0, t + 50);
        let evs = m.step(t + 150, 100, &mut r);
        assert!(!evs.iter().any(|e| e.kind == ev::HIT), "{evs:?}");
    }

    #[test]
    fn last_standing_takes_the_crown_and_the_next_round_begins() {
        let (mut m, t) = duel();
        let mut r = rng(6);
        m.fighters[1].hp = 5.0;
        m.input(1, input::LIGHT, 0.0, t);
        let evs = m.step(t + 150, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::DOWN && e.b == 2));
        assert!(evs.iter().any(|e| e.kind == ev::ROUND_WON && e.a == 1));
        assert_eq!(m.crowns[0], 1);
        assert_eq!(m.status, ROUND_END);
        let evs = m.step(t + 150 + ROUND_END_MS, 100, &mut r);
        assert!(evs.iter().any(|e| e.kind == ev::ROUND_START && e.n == 2));
        assert_eq!(m.fighters[1].hp, HP);
        assert!(!m.fighters[1].down);
    }

    #[test]
    fn spikes_rise_in_turn_and_hurt_whoever_stands_on_them() {
        let (mut m, t) = duel();
        let mut r = rng(7);
        let mut spiked = 0;
        for k in 0..80 {
            let now = t + k * 100;
            let f = &mut m.fighters[0];
            f.x = 10.0;
            f.y = 2.0;
            f.act = act::NONE;
            f.hp = HP;
            spiked += m
                .step(now, 100, &mut r)
                .iter()
                .filter(|e| e.kind == ev::SPIKED && e.b == 1)
                .count();
        }
        assert!((1..=2).contains(&spiked), "{spiked}");
    }

    #[test]
    fn the_fire_closes_in_and_burns() {
        let (mut m, t) = duel();
        let mut r = rng(8);
        m.fighters[0].x = 1.0;
        m.fighters[0].y = 1.0;
        let late = t + FIRE_AFTER_MS + FIRE_CLOSE_MS / 2;
        assert!(m.fire(late) < 1.0);
        let hp = m.fighters[0].hp;
        m.step(late, 100, &mut r);
        assert!(m.fighters[0].hp < hp);
        assert_eq!(m.fighters[1].hp, HP, "the one in the middle is safe");
    }

    #[test]
    fn spears_fly_and_bombs_blow_up() {
        let (mut m, mut t) = duel();
        let mut r = rng(9);
        m.fighters[0].x = 3.0;
        m.fighters[0].y = 9.5;
        m.fighters[1].x = 9.0;
        m.fighters[1].y = 9.5;
        m.fighters[0].holding = gift::SPEAR;
        m.input(1, input::THROW, 0.0, t);
        let mut seen = Vec::new();
        for _ in 0..8 {
            t += 100;
            seen.extend(m.step(t, 100, &mut r));
        }
        assert!(
            seen.iter().any(|e| e.kind == ev::HIT && e.m & 8 != 0),
            "spear hit: {seen:?}"
        );
        let f = &mut m.fighters[0];
        f.holding = gift::BOMB;
        f.act = act::NONE;
        f.knocked_until = 0;
        let b = &mut m.fighters[1];
        b.x = 6.0;
        b.y = 9.5;
        b.knocked_until = 0;
        b.kvx = 0.0;
        m.input(1, input::THROW, 0.0, t);
        let mut seen = Vec::new();
        for _ in 0..12 {
            t += 100;
            seen.extend(m.step(t, 100, &mut r));
        }
        assert!(seen.iter().any(|e| e.kind == ev::BOOM), "boom: {seen:?}");
    }

    #[test]
    fn bots_fight_a_whole_match_to_a_champion() {
        let mut lengths = Vec::new();
        for seed in 0..4 {
            let mut m = Match::new(ring());
            m.join(1, 0);
            m.start(1, true, 0);
            // The person leaves: with nobody left, it's called off.
            m.leave(1);
            assert_eq!(m.status, LOBBY);
            m.join(1, 0);
            m.start(1, true, 0);
            let i = m.fighters.iter().position(|f| f.id == 1).unwrap();
            m.fighters[i].bot = true;
            let mut r = rng(100 + seed);
            let mut now = 0;
            let mut rounds = 0;
            while m.status != OVER && now < 20 * 60_000 {
                now += 100;
                rounds += m
                    .step(now, 100, &mut r)
                    .iter()
                    .filter(|e| e.kind == ev::ROUND_WON)
                    .count();
            }
            assert_eq!(m.status, OVER, "seed {seed}");
            eprintln!(
                "ARENA: {}s, {rounds} rounds, crowns {:?} downs {:?} dealt {:?}",
                now / 1000,
                m.crowns,
                m.fighters
                    .iter()
                    .map(|f| (f.slot, f.downs))
                    .collect::<Vec<_>>(),
                m.fighters
                    .iter()
                    .map(|f| f.dealt as u32)
                    .collect::<Vec<_>>()
            );
            lengths.push(now / rounds.max(1) as u32);
        }
        let avg = lengths.iter().sum::<u32>() / lengths.len() as u32 / 1000;
        assert!((15..=80).contains(&avg), "a round takes {avg}s on average");
    }
}
