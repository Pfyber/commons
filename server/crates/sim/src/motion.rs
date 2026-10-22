//! Path-based movement (spec §5.1): an avatar walks straight segments between
//! waypoints at constant speed starting at `t0`. Server and clients evaluate the
//! same function, so no per-tick position updates are needed.
//! Mirrored in `client/src/world/motion.ts`.

use crate::TilePos;

/// Walking speed in tenths of a tile per second.
pub const WALK_SPEED_X10: u8 = 40;
/// Sprinting (asked for by the player, outdoors; see `sprint_in`).
pub const SPRINT_SPEED_X10: u8 = 58;

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

impl Motion {
    fn ms_per_tile(&self) -> f64 {
        10_000.0 / self.speed_x10.max(1) as f64
    }

    /// Tiles covered by `t` (walking, then sprinting once `sprint_in` is up).
    fn dist_at(&self, t: u32) -> f64 {
        if t <= self.t0 {
            return 0.0;
        }
        let dt = (t - self.t0) as f64;
        let s = self.sprint_in as f64;
        if self.sprint_in == 0 || dt <= s {
            return dt / self.ms_per_tile();
        }
        s / self.ms_per_tile() + (dt - s) / (10_000.0 / SPRINT_SPEED_X10 as f64)
    }

    /// When `d` tiles have been covered (ms after `t0`): the inverse of `dist_at`.
    fn time_for(&self, d: f64) -> f64 {
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
            || (self.sprint_in > 0 && t > self.t0 + self.sprint_in as u32)
    }

    pub fn duration_ms(&self) -> u32 {
        let len: f64 = self.path.windows(2).map(|w| seg_len(w[0], w[1])).sum();
        self.time_for(len).ceil() as u32
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
                return Some((
                    (prev.0 as u16, prev.1 as u16),
                    (next.0 as u16, next.1 as u16),
                    t_prev,
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
