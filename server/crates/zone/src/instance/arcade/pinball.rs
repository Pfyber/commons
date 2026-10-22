//! Pinball 1v1, the machine in the bar: a playfield lying on its side, each
//! player's flippers guarding their own hole at their end (a on the left, b
//! on the right). Knock the ball into the other's hole for a point; first to
//! `arcade::PINBALL_WIN`. Bumpers between light up and kick the ball on;
//! posts in front of each hole make you shoot round them. The ball rolls on
//! the table's cloth: it slows a little until something hits it again.
//!
//! `value` is the flippers held (`arcade::FLIP_TOP` | `FLIP_BOTTOM`). Each
//! press is played from the moment it arrived, not the next tick. The client
//! (client/src/activities/pinball.ts) runs this same physics, the bot
//! included (its choices come from the time, not chance), to carry the ball
//! on smoothly between states.

use super::{Step, result};
use commons_protocol::arcade;
use rand::Rng;

/// The playfield, in units.
pub(super) const W: f64 = 260.0;
pub(super) const H: f64 = 156.0;
const BALL_R: f64 = 2.8;
/// Each end's hole, behind the flippers: this far either side of the middle.
const HOLE_HALF: f64 = 22.0;
/// Flippers: tapered bars, wide at the pivot, slim at the tip.
const FLIP_LEN: f64 = 24.0;
const FLIP_BASE_R: f64 = 3.6;
const FLIP_TIP_R: f64 = 1.6;
/// Flippers swing up this fast and fall back this fast (radians a second).
const FLIP_UP: f64 = 15.0;
const FLIP_DOWN: f64 = 9.0;
/// Pivot, resting angle and raised angle of each flipper: a's top and
/// bottom, then b's (y grows downward, angles from +x). At rest they point
/// in toward the middle and back toward the hole, like a real machine's
/// turned on its side; raised, in and up the table.
const FLIPPERS: [(f64, f64, f64, f64); 4] = [
    (30.0, 50.0, 2.094, 1.047),
    (30.0, 106.0, -2.094, -1.047),
    (230.0, 50.0, 1.047, 2.094),
    (230.0, 106.0, -1.047, -2.094),
];
/// Guide rails from the long walls down to the flipper pivots (as a real
/// machine's inlanes), so the ball can only reach a hole between the flippers.
const RAILS: [(f64, f64, f64, f64); 4] = [
    (12.0, 0.0, 30.0, 50.0),
    (12.0, 156.0, 30.0, 106.0),
    (248.0, 0.0, 230.0, 50.0),
    (248.0, 156.0, 230.0, 106.0),
];
const RAIL_R: f64 = 1.6;
/// Bumpers and posts: centre, radius, and the speed they kick the ball off
/// at (0: a plain post, which just bounces it).
pub(super) const BUMPERS: [(f64, f64, f64, f64); 9] = [
    (130.0, 78.0, 10.0, 175.0),
    (92.0, 44.0, 7.0, 165.0),
    (168.0, 44.0, 7.0, 165.0),
    (92.0, 112.0, 7.0, 165.0),
    (168.0, 112.0, 7.0, 165.0),
    (130.0, 24.0, 5.5, 155.0),
    (130.0, 132.0, 5.5, 155.0),
    (66.0, 78.0, 3.5, 0.0),
    (194.0, 78.0, 3.5, 0.0),
];
/// The table tilts down from the middle to each end's hole: the ball drifts
/// toward the nearer one this fast (units/s²), so it never just circles,
/// and rolls down the rails onto the flippers like on a real machine.
const TILT: f64 = 34.0;
/// Speed lost per second rolling: it slows climbing toward the middle,
/// stops, and rolls back down.
const FRICTION: f64 = 10.0;
const MAX_SPEED: f64 = 300.0;
const SERVE_SPEED: f64 = 120.0;
/// A ball slower than this for `STUCK_MS` is balanced on something (a post's
/// top, a flipper's pivot): the table gets a bump, `BUMP` units/s across
/// the slope, one way then the other each time, so nothing balances for ever.
const STUCK_SPEED: f64 = 4.0;
const STUCK_MS: u32 = 1_000;
const BUMP: f64 = 70.0;
/// Physics step, ms.
const STEP_MS: u32 = 2;
/// The bot keeps a flipper up this long, and saves this many in a hundred.
const BOT_HOLD_MS: u32 = 170;
const BOT_SKILL: u32 = 78;

#[derive(Debug, Clone)]
pub(super) struct Pinball {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    /// Each flipper's angle now.
    ang: [f64; 4],
    /// Flippers held, per side, and presses not yet played (time, side, keys).
    keys: [u16; 2],
    pending: Vec<(u32, u8, u16)>,
    pub(super) score: [u16; 2],
    serve_at: Option<u32>,
    serve_to: u8,
    /// Times each bumper has been hit (clients light it up when it goes up).
    hits: [u16; 9],
    /// Last time the game was moved on.
    t: u32,
    /// The bot: holding each flipper until then; leaving this approach alone until then.
    bot_hold: [u32; 2],
    bot_rest: u32,
    /// How long the ball's been all but still, and how many bumps so far.
    still: u32,
    bumps: u16,
}

/// The closest point to (x, y) on the segment a–b, and how far along it is (0–1).
fn closest(x: f64, y: f64, ax: f64, ay: f64, bx: f64, by: f64) -> (f64, f64, f64) {
    let (dx, dy) = (bx - ax, by - ay);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 {
        (((x - ax) * dx + (y - ay) * dy) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (ax + dx * t, ay + dy * t, t)
}

/// Which way is downhill at (x, y): toward the nearer end's hole.
fn tilt(x: f64, y: f64) -> (f64, f64) {
    let end = if x < W / 2.0 { 0.0 } else { W };
    let (dx, dy) = (end - x, H / 2.0 - y);
    let d = (dx * dx + dy * dy).sqrt();
    if d < 1.0 {
        (0.0, 0.0)
    } else {
        (dx / d, dy / d)
    }
}

/// The bot's luck, from the time (so a screen can replay it exactly).
fn bot_saves(t: u32) -> bool {
    let mut x = t / 40;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x % 100 < BOT_SKILL
}

impl Pinball {
    pub(super) fn new(now: u32) -> Self {
        Pinball {
            x: W / 2.0,
            y: H / 2.0,
            vx: 0.0,
            vy: 0.0,
            ang: [FLIPPERS[0].2, FLIPPERS[1].2, FLIPPERS[2].2, FLIPPERS[3].2],
            keys: [0; 2],
            pending: vec![],
            score: [0; 2],
            serve_at: Some(now + 1_500),
            serve_to: rand::rng().random_range(0..2),
            hits: [0; 9],
            t: now,
            bot_hold: [0; 2],
            bot_rest: 0,
            still: 0,
            bumps: 0,
        }
    }

    pub(super) fn input(&mut self, side: u8, value: u16, now: u32) -> Step {
        self.pending
            .push((now, side, value & (arcade::FLIP_TOP | arcade::FLIP_BOTTOM)));
        Step::default()
    }

    /// The flipper's tip, at its angle now.
    fn tip(&self, f: usize) -> (f64, f64) {
        let (px, py, _, _) = FLIPPERS[f];
        (
            px + self.ang[f].cos() * FLIP_LEN,
            py + self.ang[f].sin() * FLIP_LEN,
        )
    }

    /// Bounces the ball off a round-ended bar from a to b, `r0` thick at a and
    /// `r1` at b, whose surface moves at `surf` where it's touched.
    #[allow(clippy::too_many_arguments)]
    fn off_bar(
        &mut self,
        ax: f64,
        ay: f64,
        bx: f64,
        by: f64,
        r0: f64,
        r1: f64,
        e: f64,
        surf: impl Fn(f64, f64) -> (f64, f64),
    ) {
        let (cx, cy, t) = closest(self.x, self.y, ax, ay, bx, by);
        let r = r0 + (r1 - r0) * t;
        let (dx, dy) = (self.x - cx, self.y - cy);
        let d = (dx * dx + dy * dy).sqrt();
        if d >= BALL_R + r {
            return;
        }
        let (nx, ny) = if d > 1e-9 {
            (dx / d, dy / d)
        } else {
            (0.0, -1.0)
        };
        self.x = cx + nx * (BALL_R + r);
        self.y = cy + ny * (BALL_R + r);
        let (sx, sy) = surf(cx, cy);
        let (rx, ry) = (self.vx - sx, self.vy - sy);
        let vn = rx * nx + ry * ny;
        if vn < 0.0 {
            self.vx -= (1.0 + e) * vn * nx;
            self.vy -= (1.0 + e) * vn * ny;
        }
    }

    /// The bot's flippers: up when the ball comes at its hole within reach,
    /// most of the time (so it can be beaten).
    fn bot(&mut self, side: usize, now: u32) {
        let toward = if side == 0 {
            self.vx < 0.0
        } else {
            self.vx > 0.0
        };
        let mut keys = 0;
        for k in 0..2 {
            if now < self.bot_hold[k] {
                keys |= 1 << k;
            }
        }
        if toward && now >= self.bot_rest && keys == 0 {
            for k in 0..2 {
                let f = side * 2 + k;
                let (px, py, _, _) = FLIPPERS[f];
                let (tx, ty) = self.tip(f);
                let (cx, cy, _) = closest(self.x, self.y, px, py, tx, ty);
                if (self.x - cx).hypot(self.y - cy) < 10.0 {
                    if bot_saves(now) {
                        self.bot_hold[k] = now + BOT_HOLD_MS;
                        keys |= 1 << k;
                    } else {
                        // Missed its chance this time.
                        self.bot_rest = now + 400;
                    }
                    break;
                }
            }
        }
        self.keys[side] = keys;
    }

    pub(super) fn tick(&mut self, now: u32, bot: Option<u8>) -> Step {
        let mut step = Step {
            changed: true,
            over: None,
        };
        self.pending.sort_by_key(|p| p.0);
        let mut t = self.t;
        while t < now {
            let ms = (now - t).min(STEP_MS);
            t += ms;
            let dt = ms as f64 / 1000.0;
            // Presses that had arrived by now.
            while let Some(&(at, side, keys)) = self.pending.first() {
                if at > t {
                    break;
                }
                self.keys[side as usize] = keys;
                self.pending.remove(0);
            }
            if let Some(b) = bot {
                self.bot(b as usize, t);
            }
            // Flippers swing; how fast each moves, for what it hits.
            let mut spin = [0.0; 4];
            for f in 0..4 {
                let (_, _, rest, up) = FLIPPERS[f];
                let held = self.keys[f / 2] & (1 << (f % 2)) != 0;
                let (goal, speed) = if held {
                    (up, FLIP_UP)
                } else {
                    (rest, FLIP_DOWN)
                };
                let mv = (goal - self.ang[f]).clamp(-speed * dt, speed * dt);
                self.ang[f] += mv;
                spin[f] = mv / dt;
            }
            if let Some(at) = self.serve_at {
                if t >= at {
                    self.serve_at = None;
                    let mut rng = rand::rng();
                    self.x = W / 2.0;
                    self.y = if rng.random_bool(0.5) { 50.0 } else { H - 50.0 };
                    self.vx = if self.serve_to == 0 {
                        -SERVE_SPEED
                    } else {
                        SERVE_SPEED
                    };
                    self.vy = rng.random_range(-40.0..40.0);
                }
                continue;
            }
            // Downhill toward the nearer end, rolling on, slowing a little.
            let (gx, gy) = tilt(self.x, self.y);
            self.vx += gx * TILT * dt;
            self.vy += gy * TILT * dt;
            let s = (self.vx * self.vx + self.vy * self.vy).sqrt();
            if s > FRICTION * dt {
                let k = (s - FRICTION * dt) / s;
                self.vx *= k;
                self.vy *= k;
            }
            self.x += self.vx * dt;
            self.y += self.vy * dt;
            // The long walls.
            if self.y < BALL_R {
                self.y = BALL_R;
                self.vy = self.vy.abs() * 0.9;
            } else if self.y > H - BALL_R {
                self.y = H - BALL_R;
                self.vy = -self.vy.abs() * 0.9;
            }
            // The ends: walls, but for the holes.
            if (self.y - H / 2.0).abs() >= HOLE_HALF {
                if self.x < BALL_R {
                    self.x = BALL_R;
                    self.vx = self.vx.abs() * 0.9;
                } else if self.x > W - BALL_R {
                    self.x = W - BALL_R;
                    self.vx = -self.vx.abs() * 0.9;
                }
            }
            for &(ax, ay, bx, by) in &RAILS {
                self.off_bar(ax, ay, bx, by, RAIL_R, RAIL_R, 0.5, |_, _| (0.0, 0.0));
            }
            for f in 0..4 {
                let (px, py, _, _) = FLIPPERS[f];
                let (tx, ty) = self.tip(f);
                let w = spin[f];
                self.off_bar(px, py, tx, ty, FLIP_BASE_R, FLIP_TIP_R, 0.5, |cx, cy| {
                    (-w * (cy - py), w * (cx - px))
                });
            }
            for (i, &(bx, by, br, kick)) in BUMPERS.iter().enumerate() {
                let (dx, dy) = (self.x - bx, self.y - by);
                let d = (dx * dx + dy * dy).sqrt();
                if d >= br + BALL_R {
                    continue;
                }
                let (nx, ny) = if d > 1e-9 {
                    (dx / d, dy / d)
                } else {
                    (1.0, 0.0)
                };
                self.x = bx + nx * (br + BALL_R);
                self.y = by + ny * (br + BALL_R);
                let vn = self.vx * nx + self.vy * ny;
                if vn < 0.0 {
                    let e = if kick > 0.0 { 1.0 } else { 0.85 };
                    self.vx -= (1.0 + e) * vn * nx;
                    self.vy -= (1.0 + e) * vn * ny;
                    self.hits[i] = self.hits[i].wrapping_add(1);
                }
                if kick > 0.0 {
                    let s = (self.vx * self.vx + self.vy * self.vy).sqrt().max(1e-9);
                    let k = s.max(kick) * 1.04 / s;
                    self.vx *= k;
                    self.vy *= k;
                }
            }
            let s = (self.vx * self.vx + self.vy * self.vy).sqrt();
            if s > MAX_SPEED {
                self.vx *= MAX_SPEED / s;
                self.vy *= MAX_SPEED / s;
            }
            if s < STUCK_SPEED {
                self.still += ms;
                if self.still >= STUCK_MS {
                    // Balanced: bump the table, across the slope.
                    let (gx, gy) = tilt(self.x, self.y);
                    let side = if self.bumps.is_multiple_of(2) {
                        1.0
                    } else {
                        -1.0
                    };
                    let (px, py) = if gx == 0.0 && gy == 0.0 {
                        (0.0, 1.0)
                    } else {
                        (-gy, gx)
                    };
                    self.vx += px * BUMP * side;
                    self.vy += py * BUMP * side;
                    self.bumps = self.bumps.wrapping_add(1);
                    self.still = 0;
                }
            } else {
                self.still = 0;
            }
            // Through a hole: a point to the other end.
            if self.x < -BALL_R || self.x > W + BALL_R {
                let to = if self.x < 0.0 { 1 } else { 0 };
                self.score[to] += 1;
                self.serve_to = 1 - to as u8;
                self.serve_at = Some(t + 1_400);
                self.x = W / 2.0;
                self.y = H / 2.0;
                self.vx = 0.0;
                self.vy = 0.0;
                if self.score[to] >= arcade::PINBALL_WIN {
                    step.over = result(self.score[0] as u32, self.score[1] as u32);
                    break;
                }
            }
        }
        self.t = now;
        step
    }

    /// Ball (x, y in tenths; speeds in tenths + 32768), the scores, whether
    /// it's waiting to be served, the four flipper angles (thousandths of a
    /// radian + 4000), each bumper's hit count, the flippers held (a's bits,
    /// then b's shifted up 2), and the bot's timers (ms from now).
    pub(super) fn data(&self) -> Vec<u16> {
        let v = |f: f64| (f * 10.0 + 32_768.0).round() as u16;
        let mut d = vec![
            (self.x * 10.0).round().max(0.0) as u16,
            (self.y * 10.0).round().max(0.0) as u16,
            v(self.vx),
            v(self.vy),
            self.score[0],
            self.score[1],
            self.serve_at.is_some() as u16,
        ];
        d.extend(self.ang.iter().map(|a| ((a + 4.0) * 1000.0).round() as u16));
        d.extend(self.hits);
        d.push(self.keys[0] | self.keys[1] << 2);
        let rel = |at: u32| at.saturating_sub(self.t).min(60_000) as u16;
        d.extend([
            rel(self.bot_hold[0]),
            rel(self.bot_hold[1]),
            rel(self.bot_rest),
            self.still.min(60_000) as u16,
            self.bumps,
        ]);
        d
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rolling(x: f64, y: f64, vx: f64, vy: f64) -> Pinball {
        let mut g = Pinball::new(0);
        g.serve_at = None;
        (g.x, g.y, g.vx, g.vy) = (x, y, vx, vy);
        g
    }

    /// A ball rolled straight at a's hole, flippers down, goes in: a point to b.
    #[test]
    fn through_the_hole_scores_for_the_other_end() {
        // Between the flippers, past the post, and in.
        let mut g = rolling(50.0, H / 2.0, -130.0, 0.0);
        g.tick(1_500, None);
        assert_eq!(g.score, [0, 1]);
    }

    /// The same ball, but a's flippers come up as it arrives: knocked back out.
    #[test]
    fn a_flipper_knocks_it_away() {
        let mut g = rolling(50.0, H / 2.0 + 8.0, -130.0, 0.0);
        g.input(0, arcade::FLIP_BOTTOM | arcade::FLIP_TOP, 160);
        let mut back = false;
        for now in (10..=900).step_by(10) {
            g.tick(now, None);
            back |= g.vx > 100.0;
        }
        assert_eq!(g.score, [0, 0], "saved");
        assert!(back, "sent back up the table, hard");
    }

    #[test]
    fn bumpers_kick_and_count() {
        let mut g = rolling(130.0, 50.0, 0.0, 80.0);
        g.tick(250, None);
        assert_eq!(g.hits[0], 1);
        assert!(g.vy < 0.0 && (g.vx * g.vx + g.vy * g.vy).sqrt() > 150.0);
    }

    /// Rolled up toward the middle it slows, stops, and rolls back down.
    #[test]
    fn the_ball_slows_uphill_and_rolls_back() {
        let mut g = rolling(225.0, 148.0, -30.0, 0.0);
        let mut turned = false;
        for now in (50..=3_000).step_by(50) {
            g.tick(now, None);
            turned |= g.vx > 0.0;
        }
        assert!(turned, "rolled back down toward its end");
    }

    /// Two bots play it out: someone gets to ten.
    #[test]
    fn a_game_is_played_to_ten() {
        let mut g = Pinball::new(0);
        let mut over = None;
        let mut now = 0;
        while over.is_none() && now < 60 * 60_000 {
            now += 100;
            // The bot plays a; b never flips.
            over = g.tick(now, Some(0)).over;
        }
        assert!(over.is_some(), "{:?}", g.score);
        assert_eq!(g.score.iter().max(), Some(&arcade::PINBALL_WIN));
    }

    /// Screens carry the game on with their own copy of this physics
    /// (client/src/activities/pinball.ts): from a state, they must land
    /// where the server does. After changing the physics, run with
    /// UPDATE_PINBALL_VECTORS=1.
    #[test]
    fn client_vectors_match() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../client/src/activities/pinball.vectors.json"
        );
        let starts = [
            (60.0, 40.0, -90.0, 60.0, None),
            (200.0, 120.0, 140.0, -30.0, None),
            (130.0, 50.0, 0.0, 90.0, None),
            (50.0, 82.0, -120.0, 10.0, Some(0u8)),
            (215.0, 70.0, 150.0, 20.0, Some(1u8)),
        ];
        let cases: Vec<serde_json::Value> = starts
            .iter()
            .map(|&(x, y, vx, vy, bot)| {
                let mut g = Pinball::new(0);
                g.serve_at = None;
                (g.x, g.y, g.vx, g.vy) = (x, y, vx, vy);
                g.tick(200, bot);
                // What a screen gets: the state as sent (rounded), then where the server has it later.
                let data = g.data();
                let mut d = data.clone();
                let back = |v: u16| (v as f64 - 32_768.0) / 10.0;
                (g.x, g.y, g.vx, g.vy) = (d[0] as f64 / 10.0, d[1] as f64 / 10.0, back(d[2]), back(d[3]));
                for f in 0..4 {
                    g.ang[f] = d[7 + f] as f64 / 1000.0 - 4.0;
                }
                g.tick(380, bot);
                d.truncate(data.len());
                serde_json::json!({ "data": d, "t0": 200, "now": 380, "bot": bot.map(|b| b as i32).unwrap_or(-1), "x": (g.x * 1000.0).round() / 1000.0, "y": (g.y * 1000.0).round() / 1000.0 })
            })
            .collect();
        let json = serde_json::to_string_pretty(&cases).unwrap() + "\n";
        if std::env::var("UPDATE_PINBALL_VECTORS").is_ok() {
            std::fs::write(path, &json).unwrap();
        }
        // A Windows checkout may have CRLF line endings.
        let have = std::fs::read_to_string(path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        assert_eq!(
            have, json,
            "pinball vectors are stale: run with UPDATE_PINBALL_VECTORS=1"
        );
    }
}
#[cfg(test)]
/// Many bot games: the ball never comes to rest balanced on something.
mod stress {
    use super::*;
    #[test]
    fn stress_no_stall() {
        let mut stalls = 0;
        for game in 0..60 {
            let mut g = Pinball::new(0);
            let mut now = 0;
            let mut still_for = 0;
            let mut over = None;
            while over.is_none() && now < 60 * 60_000 {
                now += 100;
                over = g.tick(now, Some(0)).over;
                let slow = g.serve_at.is_none()
                    && (g.vx * g.vx + g.vy * g.vy).sqrt() < 15.0
                    && (g.x - g.x.round()).abs() < 10.0;
                still_for = if slow { still_for + 100 } else { 0 };
                if still_for > 8_000 {
                    eprintln!(
                        "game {game}: stall at x={:.2} y={:.2} vx={:.3} vy={:.3} serve={:?} score={:?}",
                        g.x, g.y, g.vx, g.vy, g.serve_at, g.score
                    );
                    stalls += 1;
                    break;
                }
            }
        }
        assert_eq!(stalls, 0);
    }
}
