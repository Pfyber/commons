//! Path-based movement (spec §5.1): an avatar walks straight segments between
//! waypoints at constant speed starting at `t0`. Server and clients evaluate the
//! same function, so no per-tick position updates are needed.
//! Mirrored in `client/src/world/motion.ts`.

use crate::TilePos;

/// Walking speed in tenths of a tile per second.
pub const WALK_SPEED_X10: u8 = 40;

#[derive(Debug, Clone, PartialEq)]
pub struct Motion {
    pub path: Vec<TilePos>,
    pub t0: u32,
    pub speed_x10: u8,
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

    pub fn duration_ms(&self) -> u32 {
        let len: f64 = self.path.windows(2).map(|w| seg_len(w[0], w[1])).sum();
        (len * self.ms_per_tile()).ceil() as u32
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
        let mut remaining = (t - self.t0) as f64 / self.ms_per_tile();
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
        };
        assert_eq!(m.duration_ms(), 1750);
        assert_eq!(m.pos_at(0), (0.0, 0.0));
        assert_eq!(m.pos_at(1500), (2.0, 0.0));
        assert_eq!(m.pos_at(2250), (4.0, 1.0));
        assert_eq!(m.tile_at(9999), (4, 3));
        assert!(m.is_done(2750));
        assert!(!m.is_done(2749));
    }
}
