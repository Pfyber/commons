//! Path-based movement (spec §5.1): an avatar walks straight segments between
//! waypoints at constant speed starting at `t0`. Server and clients evaluate the
//! same function, so no per-tick position updates are needed.
//! Mirrored in `client/src/world/motion.ts`.

use crate::TilePos;

/// Walking speed in tenths of a tile per second.
pub const WALK_SPEED_X10: u8 = 40;
/// Sprinting (asked for by the player, outdoors; see `sprint_in`).
pub const SPRINT_SPEED_X10: u8 = 58;
/// Setting off on a skateboard. A skate (a motion at this speed) picks up
/// speed as it goes, to three times this over `SKATE_RAMP_MS`, and glides to
/// a stop at its end, braking at `SKATE_BRAKE`: further the faster it was
/// going. For a skate, `sprint_in` is how far along that ramp it starts
/// (ms of pushing already done: its momentum, carried from the last stretch).
pub const SKATE_SPEED_X10: u8 = 82;
/// How long the push from setting-off speed to top speed takes.
pub const SKATE_RAMP_MS: u32 = 7_000;
/// Top skating speed, as a multiple of setting off.
const SKATE_TOP: f64 = 3.0;
/// Braking on a skateboard, in tiles per ms² (42 tiles/s²).
const SKATE_BRAKE: f64 = 42e-6;

/// The Vespa: quick off the mark, and it keeps on pulling, to well past the
/// skateboard's best and sooner (`VESPA_TOP` times its start, over
/// `VESPA_RAMP_MS`), braking harder at the end. Ramps as a skate does
/// (`sprint_in`: how far along its ramp it starts).
pub const VESPA_SPEED_X10: u8 = 130;
pub const VESPA_RAMP_MS: u32 = 4_500;
const VESPA_TOP: f64 = 3.2;
const VESPA_BRAKE: f64 = 70e-6;

/// A ride that picks up speed as it goes (a skateboard, a Vespa): its
/// setting-off speed (tiles per ms), top speed (times that), how long the
/// ramp up takes, and how hard it brakes.
#[derive(Debug, Clone, Copy)]
struct RampRide {
    base: f64,
    top: f64,
    ramp_ms: f64,
    brake: f64,
}

/// The ramp of a motion at `speed_x10`, if it's a ramped ride.
fn ramp_ride(speed_x10: u8) -> Option<RampRide> {
    match speed_x10 {
        SKATE_SPEED_X10 => Some(RampRide {
            base: SKATE_SPEED_X10 as f64 / 10_000.0,
            top: SKATE_TOP,
            ramp_ms: SKATE_RAMP_MS as f64,
            brake: SKATE_BRAKE,
        }),
        VESPA_SPEED_X10 => Some(RampRide {
            base: VESPA_SPEED_X10 as f64 / 10_000.0,
            top: VESPA_TOP,
            ramp_ms: VESPA_RAMP_MS as f64,
            brake: VESPA_BRAKE,
        }),
        _ => None,
    }
}

/// Whether a motion at `speed_x10` picks up speed as it goes (and carries it on to the next stretch).
pub fn is_ramped(speed_x10: u8) -> bool {
    ramp_ride(speed_x10).is_some()
}

/// Turning less than this far into a step, a walk turns from the tile it's
/// just left (a step's worth back at most half a tile) instead of walking
/// on into the next first: keys and taps answer at once.
pub const TURN_EARLY: f64 = 0.5;

#[derive(Debug, Clone, PartialEq)]
pub struct Motion {
    pub path: Vec<TilePos>,
    pub t0: u32,
    pub speed_x10: u8,
    /// A walk that breaks into a sprint: this many ms after `t0` the speed
    /// rises to `SPRINT_SPEED_X10` (0: it never does).
    pub sprint_in: u16,
}

fn seg_len(a: TilePos, b: TilePos) -> f64 {
    let dx = b.0 as f64 - a.0 as f64;
    let dy = b.1 as f64 - a.1 as f64;
    (dx * dx + dy * dy).sqrt()
}

/// The skating profile of a motion of length `len`, ramp at `ramp0` (see
/// `SKATE_SPEED_X10`). Speeds in tiles per ms. Mirrored in motion.ts.
struct Skate {
    /// Speed at the start, and its acceleration (while ramping up).
    v0: f64,
    acc: f64,
    /// Ramp time left at the start (ms).
    ramp_left: f64,
    /// Where braking starts (tiles), when (ms), at what speed, and how hard.
    brake_at: f64,
    brake_t: f64,
    brake_v: f64,
    brake: f64,
    len: f64,
}

impl Skate {
    fn new(ride: RampRide, ramp0: f64, len: f64) -> Skate {
        let base = ride.base;
        let top = base * ride.top;
        let acc = (top - base) / ride.ramp_ms;
        let ramp0 = ramp0.clamp(0.0, ride.ramp_ms);
        let mut s = Skate {
            v0: base + acc * ramp0,
            acc,
            ramp_left: ride.ramp_ms - ramp0,
            brake_at: 0.0,
            brake_t: 0.0,
            brake_v: 0.0,
            brake: ride.brake,
            len,
        };
        // Brake where the glide just reaches the end: s + v(s)²/2b = len.
        let stops = |s: &Skate, d: f64| {
            let v = s.speed_after(s.time_to(d));
            d + v * v / (2.0 * ride.brake)
        };
        if stops(&s, 0.0) >= len {
            // Too short to glide at the usual rate: brake just hard enough.
            s.brake = if len > 0.0 {
                s.v0 * s.v0 / (2.0 * len)
            } else {
                1.0
            };
        } else {
            let (mut lo, mut hi) = (0.0, len);
            for _ in 0..40 {
                let mid = (lo + hi) / 2.0;
                if stops(&s, mid) < len {
                    lo = mid
                } else {
                    hi = mid
                }
            }
            s.brake_at = lo;
        }
        s.brake_t = s.time_to(s.brake_at);
        s.brake_v = s.speed_after(s.brake_t);
        s
    }

    /// Speed `dt` ms in, before braking.
    fn speed_after(&self, dt: f64) -> f64 {
        self.v0 + self.acc * dt.min(self.ramp_left)
    }

    /// Distance `dt` ms in, before braking.
    fn dist_by(&self, dt: f64) -> f64 {
        let r = dt.min(self.ramp_left);
        let d = self.v0 * r + self.acc / 2.0 * r * r;
        d + (dt - r).max(0.0) * (self.v0 + self.acc * self.ramp_left)
    }

    /// Time to cover `d` tiles, before braking.
    fn time_to(&self, d: f64) -> f64 {
        let ramp_d = self.v0 * self.ramp_left + self.acc / 2.0 * self.ramp_left * self.ramp_left;
        if d <= ramp_d && self.acc > 0.0 {
            (-self.v0 + (self.v0 * self.v0 + 2.0 * self.acc * d).sqrt()) / self.acc
        } else {
            self.ramp_left + (d - ramp_d) / (self.v0 + self.acc * self.ramp_left)
        }
    }

    fn dist_at(&self, dt: f64) -> f64 {
        if dt <= self.brake_t {
            return self.dist_by(dt);
        }
        let u = (dt - self.brake_t).min(self.brake_v / self.brake);
        (self.brake_at + self.brake_v * u - self.brake / 2.0 * u * u).min(self.len)
    }

    fn time_for(&self, d: f64) -> f64 {
        if d <= self.brake_at {
            return self.time_to(d);
        }
        let rem = (d - self.brake_at).min(self.len - self.brake_at);
        let disc = (self.brake_v * self.brake_v - 2.0 * self.brake * rem).max(0.0);
        self.brake_t + (self.brake_v - disc.sqrt()) / self.brake
    }

    /// Speed at `dt` ms in (braking included).
    fn speed_at(&self, dt: f64) -> f64 {
        if dt <= self.brake_t {
            self.speed_after(dt)
        } else {
            (self.brake_v - self.brake * (dt - self.brake_t)).max(0.0)
        }
    }
}

impl Motion {
    fn len(&self) -> f64 {
        self.path.windows(2).map(|w| seg_len(w[0], w[1])).sum()
    }

    fn skate(&self) -> Option<Skate> {
        ramp_ride(self.speed_x10).map(|r| Skate::new(r, self.sprint_in as f64, self.len()))
    }

    /// For a skate, how far along its ramp its speed at `t` is (ms of pushing):
    /// a new stretch joining it at `t` carries on at that speed. 0 otherwise.
    pub fn skate_ramp_at(&self, t: u32) -> u16 {
        let (Some(s), Some(r)) = (self.skate(), ramp_ride(self.speed_x10)) else {
            return 0;
        };
        let v = s.speed_at(t.saturating_sub(self.t0) as f64);
        (((v - r.base) / s.acc).clamp(0.0, r.ramp_ms)).round() as u16
    }

    fn ms_per_tile(&self) -> f64 {
        10_000.0 / self.speed_x10.max(1) as f64
    }

    /// Tiles covered by `t` (walking, then sprinting once `sprint_in` is up).
    fn dist_at(&self, t: u32) -> f64 {
        if t <= self.t0 {
            return 0.0;
        }
        let dt = (t - self.t0) as f64;
        if let Some(sk) = self.skate() {
            return sk.dist_at(dt);
        }
        let s = self.sprint_in as f64;
        if self.sprint_in == 0 || dt <= s {
            return dt / self.ms_per_tile();
        }
        s / self.ms_per_tile() + (dt - s) / (10_000.0 / SPRINT_SPEED_X10 as f64)
    }

    /// When `d` tiles have been covered (ms after `t0`): the inverse of `dist_at`.
    fn time_for(&self, d: f64) -> f64 {
        if let Some(sk) = self.skate() {
            return sk.time_for(d);
        }
        let s = self.sprint_in as f64;
        let walked = s / self.ms_per_tile();
        if self.sprint_in == 0 || d <= walked {
            return d * self.ms_per_tile();
        }
        s + (d - walked) * (10_000.0 / SPRINT_SPEED_X10 as f64)
    }

    /// Whether they're sprinting at `t`.
    pub fn sprinting_at(&self, t: u32) -> bool {
        self.speed_x10 == SPRINT_SPEED_X10
            || (!is_ramped(self.speed_x10)
                && self.sprint_in > 0
                && t > self.t0 + self.sprint_in as u32)
    }

    pub fn duration_ms(&self) -> u32 {
        self.time_for(self.len()).ceil() as u32
    }

    pub fn end_t(&self) -> u32 {
        self.t0.saturating_add(self.duration_ms())
    }

    pub fn is_done(&self, t: u32) -> bool {
        t >= self.end_t()
    }

    /// Fractional tile position at instance time `t`.
    pub fn pos_at(&self, t: u32) -> (f64, f64) {
        let first = self.path[0];
        if t <= self.t0 || self.path.len() == 1 {
            return (first.0 as f64, first.1 as f64);
        }
        let mut remaining = self.dist_at(t);
        for w in self.path.windows(2) {
            let len = seg_len(w[0], w[1]);
            if remaining < len {
                let f = remaining / len;
                return (
                    w[0].0 as f64 + (w[1].0 as f64 - w[0].0 as f64) * f,
                    w[0].1 as f64 + (w[1].1 as f64 - w[0].1 as f64) * f,
                );
            }
            remaining -= len;
        }
        let last = *self.path.last().unwrap();
        (last.0 as f64, last.1 as f64)
    }

    /// The tile the avatar occupies at time `t` (nearest tile to its position).
    pub fn tile_at(&self, t: u32) -> TilePos {
        let (x, y) = self.pos_at(t);
        (x.round() as u16, y.round() as u16)
    }

    /// Where a walk in progress can be redirected without a visible seam: the
    /// tile most recently passed, the tile being walked into, and the time the
    /// avatar was at the former. A new path `[prev, next, ...]` starting at that
    /// time reproduces the current motion exactly up to `next`.
    /// `None` if the walk hasn't started yet or has finished.
    pub fn splice(&self, t: u32) -> Option<(TilePos, TilePos, u32)> {
        self.splice_at(t)
            .map(|(prev, next, t_prev, _)| (prev, next, t_prev))
    }

    /// [`Motion::splice`], and how far into the step from `prev` to `next`
    /// the avatar is at `t` (0 just left `prev`, 1 at `next`).
    pub fn splice_at(&self, t: u32) -> Option<(TilePos, TilePos, u32, f64)> {
        if t <= self.t0 || self.is_done(t) {
            return None;
        }
        let travelled = self.dist_at(t);
        let mut before = 0.0;
        for w in self.path.windows(2) {
            let (a, b) = (w[0], w[1]);
            let (dx, dy) = (
                (b.0 as i32 - a.0 as i32).signum(),
                (b.1 as i32 - a.1 as i32).signum(),
            );
            let steps = (b.0 as i32 - a.0 as i32)
                .abs()
                .max((b.1 as i32 - a.1 as i32).abs());
            let len = seg_len(a, b);
            if travelled < before + len {
                let step_len = len / steps as f64;
                let k = (((travelled - before) / step_len).floor() as i32).min(steps - 1);
                let prev = (a.0 as i32 + dx * k, a.1 as i32 + dy * k);
                let next = (prev.0 + dx, prev.1 + dy);
                let t_prev = self.t0 + self.time_for(before + k as f64 * step_len).round() as u32;
                let into = ((travelled - before) / step_len - k as f64).clamp(0.0, 1.0);
                return Some((
                    (prev.0 as u16, prev.1 as u16),
                    (next.0 as u16, next.1 as u16),
                    t_prev,
                    into,
                ));
            }
            before += len;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skate(len: u16, ramp0: u16) -> Motion {
        Motion {
            path: vec![(0, 0), (len, 0)],
            t0: 1000,
            speed_x10: SKATE_SPEED_X10,
            sprint_in: ramp0,
        }
    }

    /// The Vespa: quick off the mark, and quicker as it goes (pinned for
    /// motion.test.ts too, which checks the client mirror gives the same).
    #[test]
    fn a_vespa_sets_off_quick_and_keeps_pulling() {
        for (len, ramp0, end, mid, at3000) in [
            (200u16, 0u16, 7652u32, 78.391455, 67.6),
            (10, 3000, 1541, 7.443125, 10.0),
            (3, 0, 1320, 2.108376, 3.0),
            (60, 4500, 2740, 36.192, 60.0),
        ] {
            let m = Motion {
                path: vec![(0, 0), (len, 0)],
                t0: 1000,
                speed_x10: VESPA_SPEED_X10,
                sprint_in: ramp0,
            };
            assert_eq!(m.end_t(), end);
            assert!((m.pos_at(1000 + (end - 1000) / 2).0 - mid).abs() < 1e-5);
            assert!((m.pos_at(4000).0 - at3000).abs() < 1e-5);
        }
        let m = Motion {
            path: vec![(0, 0), (300, 0)],
            t0: 1000,
            speed_x10: VESPA_SPEED_X10,
            sprint_in: 0,
        };
        let speed = |t: u32| (m.pos_at(t + 100).0 - m.pos_at(t).0) * 10.0;
        assert!(speed(1000) > 12.0, "quick off the mark");
        assert!(
            speed(1000 + VESPA_RAMP_MS) > 40.0,
            "and really fast once it's going"
        );
        assert!(
            speed(1000 + VESPA_RAMP_MS) > SKATE_SPEED_X10 as f64 / 10.0 * SKATE_TOP,
            "past the skateboard's best"
        );
        assert!(
            is_ramped(VESPA_SPEED_X10) && is_ramped(SKATE_SPEED_X10) && !is_ramped(WALK_SPEED_X10)
        );
    }

    /// Pinned for motion.test.ts, which checks the client mirror gives the same.
    #[test]
    fn skate_numbers_for_the_client_mirror() {
        for (len, ramp0, end, mid, at3000) in [
            (200u16, 0u16, 11757u32, 77.980693, 35.142857),
            (10, 3000, 1823, 6.456822, 10.0),
            (3, 0, 1455, 1.921763, 3.0),
            (40, 7000, 2919, 23.5914, 40.0),
        ] {
            let m = skate(len, ramp0);
            assert_eq!(m.end_t(), end);
            assert!((m.pos_at(1000 + (end - 1000) / 2).0 - mid).abs() < 1e-5);
            assert!((m.pos_at(4000).0 - at3000).abs() < 1e-5);
        }
    }

    #[test]
    fn a_skate_picks_up_speed_then_glides_to_a_stop() {
        let m = skate(200, 0);
        let speed = |t: u32| (m.pos_at(t + 100).0 - m.pos_at(t).0) * 10.0; // tiles a second
        let start = speed(1000);
        assert!(
            (start - 8.2).abs() < 0.6,
            "sets off at skating speed: {start}"
        );
        let later = speed(1000 + SKATE_RAMP_MS + 500);
        assert!(
            (later - 24.6).abs() < 0.6,
            "three times as fast once pushed up: {later}"
        );
        let end = m.end_t();
        assert!(
            speed(end - 150) < later / 2.0,
            "slowing to a stop at the end"
        );
        assert_eq!(m.tile_at(end), (200, 0));
        // The glide at top speed is a good few tiles long; from setting off, short.
        let quick = skate(200, SKATE_RAMP_MS as u16);
        let (x, _) = quick.pos_at(quick.end_t() - 300);
        assert!(200.0 - x > 1.5, "a long glide from top speed ({x})");
        let slow = skate(3, 0);
        let (x, _) = slow.pos_at(slow.end_t() - 100);
        assert!(
            200.0 - x > 0.0 && 3.0 - x < 0.8,
            "a short glide from setting off ({x})"
        );
    }

    #[test]
    fn a_skate_carries_its_speed_into_the_next_stretch() {
        let m = skate(200, 0);
        let t = 1000 + 4_000;
        let ramp = m.skate_ramp_at(t);
        assert!((3_900..=4_100).contains(&ramp), "momentum carried: {ramp}");
        // Splicing keeps the timing exact, as for walking.
        let (prev, next, t_prev) = m.splice(t).unwrap();
        assert!(t_prev <= t && next.0 == prev.0 + 1);
    }

    #[test]
    fn walks_at_speed() {
        let m = Motion {
            path: vec![(0, 0), (4, 0), (4, 3)],
            t0: 1000,
            speed_x10: 40,
            sprint_in: 0,
        };
        assert_eq!(m.duration_ms(), 1750);
        assert_eq!(m.pos_at(0), (0.0, 0.0));
        assert_eq!(m.pos_at(1500), (2.0, 0.0));
        assert_eq!(m.pos_at(2250), (4.0, 1.0));
        assert_eq!(m.tile_at(9999), (4, 3));
        assert!(m.is_done(2750));
        assert!(!m.is_done(2749));
    }

    #[test]
    fn splice_is_seamless() {
        let m = Motion {
            path: vec![(0, 0), (4, 0), (7, 3)],
            t0: 1000,
            speed_x10: 40,
            sprint_in: 0,
        };
        assert_eq!(m.splice(1000), None);
        assert_eq!(m.splice(1600), Some(((2, 0), (3, 0), 1500)));
        let (prev, next, t_prev) = m.splice(2400).unwrap();
        assert_eq!((prev, next), ((5, 1), (6, 2)));
        // Redirecting through `next` reproduces the old motion until `next`.
        let redirected = Motion {
            path: vec![prev, next, (6, 9)],
            t0: t_prev,
            speed_x10: 40,
            sprint_in: 0,
        };
        for t in [2400, 2450, 2500] {
            let (a, b) = (m.pos_at(t), redirected.pos_at(t));
            assert!(
                (a.0 - b.0).abs() < 0.01 && (a.1 - b.1).abs() < 0.01,
                "t={t}: {a:?} vs {b:?}"
            );
        }
        assert_eq!(m.splice(9999), None);
    }

    #[test]
    fn breaks_into_a_sprint() {
        // 2 tiles walking (500 ms), then sprinting.
        let sp = SPRINT_SPEED_X10 as f64 / 10.0;
        let m = Motion {
            path: vec![(0, 0), (15, 0)],
            t0: 1000,
            speed_x10: WALK_SPEED_X10,
            sprint_in: 500,
        };
        assert_eq!(m.pos_at(1500), (2.0, 0.0));
        assert!((m.pos_at(2500).0 - (2.0 + sp)).abs() < 1e-9);
        assert_eq!(m.duration_ms(), (500.0 + 13.0 / sp * 1000.0).ceil() as u32);
        assert!(!m.sprinting_at(1400) && m.sprinting_at(1600));
        // Splicing mid-sprint still lines up.
        let (prev, next, t_prev) = m.splice(2000).unwrap();
        let k = (2.0 + 0.5 * sp).floor() as u16;
        assert_eq!((prev, next), ((k, 0), (k + 1, 0)));
        assert!((m.pos_at(t_prev).0 - k as f64).abs() < 0.01);
    }
}
