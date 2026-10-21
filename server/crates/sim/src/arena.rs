//! The gladiator arena: a sword duel, side on, between players 0 and 1.
//!
//! Each fighter walks left and right on the sand, always facing the other,
//! and fights with stamina rather than turns:
//!
//! * **Short swing**: quick to land, light damage, cheap on stamina.
//! * **Big swing**: a long wind-up and double the damage; it even chips
//!   through a block. But it costs a lot of stamina, and a short swing that
//!   lands while it's still winding up cuts it off (for half a short
//!   swing's damage).
//! * **Block** (held): short swings glance off; big swings only chip.
//!
//! Stamina comes back whenever you aren't swinging (walking, standing or
//! blocking), starting a moment after your last swing; empty it completely
//! and it takes a while longer to start coming back. Swinging needs enough
//! for the swing. Getting hit staggers you for a moment and pushes you back
//! a step; a big hit also spoils whatever you were winding up.
//!
//! Down to no health, or the most health when time's up, decides it.
//! Units: the arena floor is `W` wide; times are ms on the zone's clock.

pub const W: f64 = 200.0;
/// Where the two start.
pub const START: [f64; 2] = [60.0, 140.0];
/// Walking speed (units/s); slower while blocking or swinging.
pub const SPEED: f64 = 60.0;
/// A sword reaches this far (between the fighters' middles)…
pub const REACH: f64 = 34.0;
/// …and they never stand closer than this.
pub const BODY: f64 = 16.0;
pub const HP: u8 = 100;
pub const STAMINA: f64 = 100.0;

/// A short swing: lands this long after it starts, and the pose holds this long after.
pub const SHORT_WINDUP_MS: u32 = 260;
pub const SHORT_RECOVER_MS: u32 = 220;
pub const SHORT_DMG: u8 = 8;
pub const SHORT_COST: f64 = 15.0;
/// A big swing: slow to wind up, and double the damage.
pub const BIG_WINDUP_MS: u32 = 650;
pub const BIG_RECOVER_MS: u32 = 380;
pub const BIG_DMG: u8 = 16;
pub const BIG_COST: f64 = 32.0;
/// Through a block, a big swing still does this much.
pub const CHIP_DMG: u8 = 4;
/// A short swing cutting off a big one does this (half a short swing).
pub const COUNTER_DMG: u8 = SHORT_DMG / 2;
/// Stamina back per second, once it starts coming back…
pub const REGEN: f64 = 26.0;
/// …this long after the last swing ends…
pub const REGEN_DELAY_MS: u32 = 400;
/// …or this long, if they ran it right out.
pub const EXHAUSTED_DELAY_MS: u32 = 1_600;
/// Hit: staggered this long (can't swing or block), and pushed back this far.
pub const FLINCH_MS: u32 = 260;
pub const KNOCKBACK: f64 = 9.0;
/// A match lasts at most this long.
pub const MATCH_MS: u32 = 90_000;

/// What a fighter is doing (`Fighter::act`).
pub mod act {
    pub const NONE: u8 = 0;
    pub const SHORT: u8 = 1;
    pub const BIG: u8 = 2;
}

/// What they ask for (`Fight::input`): a swing, or holding/letting go of their block.
pub mod input {
    pub const SHORT: u8 = 1;
    pub const BIG: u8 = 2;
    pub const BLOCK: u8 = 3;
    pub const UNBLOCK: u8 = 4;
}

/// What happened (`Event::kind`), for the show and the sounds.
pub mod event {
    /// A swing landed (`dmg`).
    pub const HIT: u8 = 1;
    /// A short swing cut off a big one (`dmg`).
    pub const COUNTER: u8 = 2;
    /// Blocked clean.
    pub const BLOCK: u8 = 3;
    /// A big swing through a block (`dmg`).
    pub const CHIP: u8 = 4;
    /// Swung at nothing.
    pub const WHIFF: u8 = 5;
    /// Out of stamina.
    pub const TIRED: u8 = 6;
}

/// Game status, as protocol `arena::*`.
pub const PLAYING: u8 = 1;
pub const A_WON: u8 = 2;
pub const B_WON: u8 = 3;
pub const DRAW: u8 = 5;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fighter {
    pub x: f64,
    /// -1 facing left, 1 right.
    pub facing: i8,
    pub hp: u8,
    pub stamina: f64,
    /// The swing under way (`act::*`), when it started, and whether it's landed.
    pub act: u8,
    pub act_at: u32,
    pub struck: bool,
    /// Holding their block.
    pub blocking: bool,
    pub flinch_until: u32,
    /// When stamina starts coming back.
    pub regen_at: u32,
    /// Walking: -1 left, 0 still, 1 right.
    pub dir: i8,
}

impl Fighter {
    fn new(x: f64, facing: i8) -> Self {
        Fighter { x, facing, hp: HP, stamina: STAMINA, act: act::NONE, act_at: 0, struck: false, blocking: false, flinch_until: 0, regen_at: 0, dir: 0 }
    }

    fn windup(&self) -> u32 {
        if self.act == act::BIG { BIG_WINDUP_MS } else { SHORT_WINDUP_MS }
    }

    fn recover(&self) -> u32 {
        if self.act == act::BIG { BIG_RECOVER_MS } else { SHORT_RECOVER_MS }
    }

    /// Winding up a swing that hasn't landed yet.
    pub fn winding(&self) -> bool {
        self.act != act::NONE && !self.struck
    }

    /// Free to swing or block: not mid-swing, not staggered.
    pub fn free(&self, now: u32) -> bool {
        self.act == act::NONE && now >= self.flinch_until
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Event {
    pub kind: u8,
    /// Who did it (0 or 1): the swinger, the blocker, the one who tired.
    pub by: u8,
    pub dmg: u8,
    /// Where (floor units).
    pub x: f64,
}

#[derive(Debug, Clone)]
pub struct Fight {
    pub f: [Fighter; 2],
    pub ends: u32,
    pub status: u8,
    last: u32,
}

impl Fight {
    pub fn new(now: u32) -> Self {
        Fight { f: [Fighter::new(START[0], 1), Fighter::new(START[1], -1)], ends: now + MATCH_MS, status: PLAYING, last: now }
    }

    /// Walking left (-1), still (0) or right (1).
    pub fn walk(&mut self, p: usize, dir: i8) {
        self.f[p].dir = dir.signum();
    }

    /// Fighter `p` swings, or holds or lets go of their block (`input::*`).
    /// False if they can't (mid-swing, staggered, or short of stamina).
    pub fn input(&mut self, p: usize, what: u8, now: u32) -> bool {
        if self.status != PLAYING {
            return false;
        }
        let f = &mut self.f[p];
        match what {
            input::BLOCK => {
                f.blocking = true;
                true
            }
            input::UNBLOCK => {
                f.blocking = false;
                true
            }
            input::SHORT | input::BIG => {
                let cost = if what == input::BIG { BIG_COST } else { SHORT_COST };
                if !f.free(now) || f.stamina < cost {
                    return false;
                }
                f.stamina -= cost;
                f.act = what;
                f.act_at = now;
                f.struck = false;
                // Swinging lowers the guard.
                f.blocking = false;
                true
            }
            _ => false,
        }
    }

    /// Plays the fight on to `now`; returns what happened.
    pub fn step(&mut self, now: u32) -> Vec<Event> {
        let mut events = Vec::new();
        if self.status != PLAYING {
            return events;
        }
        let dt = now.saturating_sub(self.last).min(250) as f64 / 1000.0;
        self.last = now;
        // Walking (slower behind a block or mid-swing), and stamina coming back.
        for f in &mut self.f {
            if now >= f.flinch_until {
                let slow = f.blocking || f.act != act::NONE;
                f.x += f.dir as f64 * SPEED * if slow { 0.5 } else { 1.0 } * dt;
            }
            if f.act == act::NONE && now >= f.regen_at {
                f.stamina = (f.stamina + REGEN * dt).min(STAMINA);
            }
        }
        self.separate();
        for p in 0..2 {
            let other = self.f[1 - p].x;
            let f = &mut self.f[p];
            if (other - f.x).abs() > 0.5 {
                f.facing = if other > f.x { 1 } else { -1 };
            }
        }
        // Swings landing (the first started goes first).
        let order = if self.f[1].act_at < self.f[0].act_at { [1, 0] } else { [0, 1] };
        for p in order {
            let f = self.f[p];
            if f.winding() && now >= f.act_at + f.windup() {
                self.land(p, now, &mut events);
            }
        }
        // Swings ending: stamina starts back a moment later (longer if it ran out).
        for (p, f) in self.f.iter_mut().enumerate() {
            if f.act != act::NONE && f.struck && now >= f.act_at + f.windup() + f.recover() {
                f.act = act::NONE;
                let empty = f.stamina < 1.0;
                f.regen_at = now + if empty { EXHAUSTED_DELAY_MS } else { REGEN_DELAY_MS };
                if empty {
                    events.push(Event { kind: event::TIRED, by: p as u8, dmg: 0, x: f.x });
                }
            }
        }
        let (a, b) = (self.f[0].hp, self.f[1].hp);
        if a == 0 || b == 0 || now >= self.ends {
            self.status = if a > b { A_WON } else if b > a { B_WON } else { DRAW };
        }
        events
    }

    /// Keeps them apart and on the sand.
    fn separate(&mut self) {
        for f in &mut self.f {
            f.x = f.x.clamp(10.0, W - 10.0);
        }
        let gap = self.f[1].x - self.f[0].x;
        if gap.abs() < BODY {
            let push = (BODY - gap.abs()) / 2.0;
            let s = if gap >= 0.0 { 1.0 } else { -1.0 };
            self.f[0].x -= s * push;
            self.f[1].x += s * push;
            for f in &mut self.f {
                f.x = f.x.clamp(10.0, W - 10.0);
            }
        }
    }

    /// Fighter `p`'s swing lands now.
    fn land(&mut self, p: usize, now: u32, events: &mut Vec<Event>) {
        let o = 1 - p;
        self.f[p].struck = true;
        let (me, them) = (self.f[p], self.f[o]);
        if (them.x - me.x).abs() > REACH + 2.0 {
            events.push(Event { kind: event::WHIFF, by: p as u8, dmg: 0, x: me.x + me.facing as f64 * REACH });
            return;
        }
        let big = me.act == act::BIG;
        // A short swing into a big one still winding up: cut off.
        if !big && them.act == act::BIG && them.winding() {
            let t = &mut self.f[o];
            t.struck = true;
            t.act = act::NONE;
            t.regen_at = now + REGEN_DELAY_MS;
            self.hurt(o, p, COUNTER_DMG, now);
            events.push(Event { kind: event::COUNTER, by: p as u8, dmg: COUNTER_DMG, x: them.x });
            return;
        }
        // Behind a block (facing the swing): a short glances off, a big chips through.
        if them.blocking && now >= them.flinch_until && them.act == act::NONE {
            if big {
                self.hurt(o, p, CHIP_DMG, now);
                events.push(Event { kind: event::CHIP, by: p as u8, dmg: CHIP_DMG, x: them.x });
            } else {
                events.push(Event { kind: event::BLOCK, by: o as u8, dmg: 0, x: (me.x + them.x) / 2.0 });
            }
            return;
        }
        let dmg = if big { BIG_DMG } else { SHORT_DMG };
        self.hurt(o, p, dmg, now);
        // A big hit spoils whatever they were winding up.
        if big && self.f[o].winding() {
            let t = &mut self.f[o];
            t.struck = true;
            t.act = act::NONE;
            t.regen_at = now + REGEN_DELAY_MS;
        }
        events.push(Event { kind: event::HIT, by: p as u8, dmg, x: them.x });
    }

    /// `v` takes `dmg` from `by`: knocked back, staggered.
    fn hurt(&mut self, v: usize, by: usize, dmg: u8, now: u32) {
        let away = (self.f[v].x - self.f[by].x).signum();
        let f = &mut self.f[v];
        f.hp = f.hp.saturating_sub(dmg);
        f.x += away * KNOCKBACK;
        f.flinch_until = now + FLINCH_MS;
        self.separate();
    }

    /// The bot's move for fighter `p` this tick: walking (left, still, right)
    /// and maybe an input (`input::*`). `r` gives numbers in [0, 1).
    pub fn ai(&self, p: usize, now: u32, r: &mut impl FnMut() -> f64) -> (i8, Option<u8>) {
        let (me, them) = (self.f[p], self.f[1 - p]);
        let gap = them.x - me.x;
        let dist = gap.abs();
        let toward = gap.signum() as i8;
        let tired = me.stamina < SHORT_COST + 5.0;
        // Close in to just inside reach; back off to get its breath back.
        let mut dir = if tired && dist < REACH + 20.0 {
            -toward
        } else if dist > REACH - 4.0 {
            toward
        } else if dist < BODY + 6.0 {
            -toward
        } else {
            0
        };
        if r() < 0.03 {
            dir = -toward;
        }
        if !me.free(now) {
            return (dir, None);
        }
        // They're winding up a big one: cut it off with a short, or block it.
        if them.winding() && them.act == act::BIG && dist <= REACH + 4.0 && now >= them.act_at + 120 {
            if me.stamina >= SHORT_COST && r() < 0.35 {
                return (dir, Some(input::SHORT));
            }
            if !me.blocking && r() < 0.3 {
                return (dir, Some(input::BLOCK));
            }
        }
        // A short coming: guard.
        if them.winding() && them.act == act::SHORT && !me.blocking && r() < 0.25 {
            return (dir, Some(input::BLOCK));
        }
        // Guard down when nothing's coming.
        if me.blocking && !them.winding() && r() < 0.2 {
            return (dir, Some(input::UNBLOCK));
        }
        if dist <= REACH && !tired {
            // They're hiding behind a block, or low: a big one. Otherwise mostly short.
            let big = (them.blocking && r() < 0.5) || (me.stamina > 70.0 && r() < 0.3);
            if big && me.stamina >= BIG_COST && r() < 0.2 {
                return (dir, Some(input::BIG));
            }
            if r() < 0.16 {
                return (dir, Some(input::SHORT));
            }
        }
        (dir, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two fighters `gap` apart, ready.
    fn fight(gap: f64) -> Fight {
        let mut f = Fight::new(0);
        f.f[0].x = 100.0 - gap / 2.0;
        f.f[1].x = 100.0 + gap / 2.0;
        f.step(1);
        f
    }

    fn run(f: &mut Fight, from: u32, to: u32) -> Vec<Event> {
        let mut out = Vec::new();
        let mut t = from;
        while t <= to {
            out.extend(f.step(t));
            t += 50;
        }
        out
    }

    #[test]
    fn short_and_big_swings_land_for_their_damage() {
        let mut f = fight(30.0);
        assert!(f.input(0, input::SHORT, 100));
        let ev = run(&mut f, 100, 700);
        assert!(ev.iter().any(|e| e.kind == event::HIT && e.dmg == SHORT_DMG), "{ev:?}");
        // (The hit pushed them back a step: close in again.)
        f.f[1].x = f.f[0].x + 30.0;
        assert!(f.input(0, input::BIG, 800));
        let ev = run(&mut f, 800, 1_900);
        assert!(ev.iter().any(|e| e.kind == event::HIT && e.dmg == BIG_DMG), "{ev:?}");
        assert_eq!(BIG_DMG, 2 * SHORT_DMG);
        assert_eq!(f.f[1].hp, HP - SHORT_DMG - BIG_DMG);
        // Out of reach: a miss.
        let mut f = fight(80.0);
        f.input(0, input::SHORT, 100);
        assert!(run(&mut f, 100, 700).iter().any(|e| e.kind == event::WHIFF));
    }

    #[test]
    fn a_short_swing_cuts_off_a_big_one() {
        let mut f = fight(30.0);
        f.input(1, input::BIG, 100);
        f.input(0, input::SHORT, 200);
        let ev = run(&mut f, 100, 1_400);
        assert!(ev.iter().any(|e| e.kind == event::COUNTER && e.by == 0 && e.dmg == COUNTER_DMG), "{ev:?}");
        assert_eq!(f.f[1].hp, HP - COUNTER_DMG);
        assert_eq!(f.f[0].hp, HP, "the big swing never lands");
    }

    #[test]
    fn a_block_stops_short_swings_but_big_ones_chip_through() {
        let mut f = fight(30.0);
        f.input(1, input::BLOCK, 50);
        f.input(0, input::SHORT, 100);
        let ev = run(&mut f, 100, 700);
        assert!(ev.iter().any(|e| e.kind == event::BLOCK && e.by == 1), "{ev:?}");
        assert_eq!(f.f[1].hp, HP);
        f.input(0, input::BIG, 800);
        let ev = run(&mut f, 800, 1_900);
        assert!(ev.iter().any(|e| e.kind == event::CHIP && e.dmg == CHIP_DMG), "{ev:?}");
        assert_eq!(f.f[1].hp, HP - CHIP_DMG);
    }

    #[test]
    fn stamina_runs_out_and_comes_back_slower_when_spent() {
        let mut f = fight(30.0);
        let mut t = 100;
        let mut swings = 0;
        // Swing as fast as it lets us until it won't.
        while t < 20_000 {
            if f.input(0, input::BIG, t) {
                swings += 1;
            } else if f.f[0].act == act::NONE && f.f[0].stamina < BIG_COST {
                break;
            }
            t += 50;
            f.step(t);
        }
        assert!((3..=4).contains(&swings), "{swings} big swings from a full bar");
        assert!(!f.input(0, input::BIG, t), "not enough left for another");
        // Not swinging, it comes back.
        let low = f.f[0].stamina;
        let mut tt = t;
        while tt < t + 3_000 {
            tt += 50;
            f.step(tt);
        }
        assert!(f.f[0].stamina > low + 30.0, "{} -> {}", low, f.f[0].stamina);
        // Run right out: a longer wait before it starts back.
        let mut g = fight(30.0);
        g.f[0].stamina = SHORT_COST;
        g.input(0, input::SHORT, 100);
        let ev = run(&mut g, 100, 600);
        assert!(ev.iter().any(|e| e.kind == event::TIRED), "{ev:?}");
        run(&mut g, 650, 1_500);
        assert!(g.f[0].stamina < 1.0, "still empty a second later: {}", g.f[0].stamina);
        run(&mut g, 1_550, 3_500);
        assert!(g.f[0].stamina > 10.0, "then it comes back: {}", g.f[0].stamina);
    }

    #[test]
    fn knocked_out_or_out_of_time() {
        let mut f = fight(30.0);
        f.f[1].hp = 5;
        f.input(0, input::SHORT, 100);
        run(&mut f, 100, 700);
        assert_eq!(f.status, A_WON);
        let mut f = fight(150.0);
        f.f[0].hp = 50;
        run(&mut f, 100, 200);
        f.step(MATCH_MS + 1);
        assert_eq!(f.status, B_WON);
    }

    #[test]
    fn the_bot_fights_back() {
        let mut s: u64 = 9;
        let mut r = move || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 11) as f64 / (1u64 << 53) as f64
        };
        let mut f = Fight::new(0);
        let mut t = 0;
        while f.status == PLAYING && t < MATCH_MS + 200 {
            t += 100;
            for p in if (t / 100) % 2 == 0 { [0, 1] } else { [1, 0] } {
                let (dir, a) = f.ai(p, t, &mut r);
                f.walk(p, dir);
                if let Some(a) = a {
                    f.input(p, a, t);
                }
            }
            f.step(t);
        }
        assert_ne!(f.status, PLAYING, "the match ends");
        assert!(f.f[0].hp < HP && f.f[1].hp < HP, "both land blows: {:?}", f.f);
    }
}
