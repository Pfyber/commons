//! Plant growth (spec §7: "grows over real days"). A plant advances one stage
//! per period, but only if it was watered during that stage; unwatered plants
//! simply wait. Pure and shared by the API (persistence) and zone servers
//! (display). Times are unix milliseconds.

pub const SEED: u8 = 0;
pub const SPROUT: u8 = 1;
pub const GROWING: u8 = 2;
pub const RIPE: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Growth {
    pub stage: u8,
    pub stage_started_ms: i64,
    pub watered: bool,
}

impl Growth {
    pub fn planted(now_ms: i64) -> Self {
        Growth {
            stage: SEED,
            stage_started_ms: now_ms,
            watered: false,
        }
    }

    /// The state at `now_ms` given `stage_ms` per stage.
    pub fn at(self, now_ms: i64, stage_ms: i64) -> Self {
        let mut g = self;
        while g.stage < RIPE && g.watered && now_ms - g.stage_started_ms >= stage_ms {
            g.stage += 1;
            g.stage_started_ms += stage_ms;
            g.watered = false;
        }
        g
    }

    /// Watering counts for the current stage. Watering a plant that already
    /// waited past its period restarts the stage clock now, so neglect delays
    /// growth instead of being skipped over.
    pub fn water(self, now_ms: i64, stage_ms: i64) -> Self {
        let mut g = self.at(now_ms, stage_ms);
        if g.stage >= RIPE || g.watered {
            return g;
        }
        if now_ms - g.stage_started_ms >= stage_ms {
            g.stage_started_ms = now_ms;
        }
        g.watered = true;
        g
    }

    pub fn ripe(self) -> bool {
        self.stage >= RIPE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: i64 = 3_600_000;

    #[test]
    fn grows_only_when_watered() {
        let g = Growth::planted(0);
        assert_eq!(g.at(10 * H, H).stage, SEED, "never watered");
        let g = g.water(0, H);
        assert_eq!(g.at(H - 1, H).stage, SEED);
        let g1 = g.at(H, H);
        assert_eq!((g1.stage, g1.watered), (SPROUT, false));
        // Stays a sprout until watered again.
        assert_eq!(g.at(5 * H, H).stage, SPROUT);
        let g = g.water(5 * H, H).water(5 * H, H);
        assert_eq!(g.stage, SPROUT);
        assert_eq!(
            g.stage_started_ms,
            5 * H,
            "neglect restarts the stage clock"
        );
        let g = g.at(6 * H, H).water(6 * H, H).at(7 * H, H);
        assert!(g.ripe());
        assert_eq!(
            g.water(8 * H, H),
            g.at(8 * H, H),
            "ripe plants don't change"
        );
    }
}
