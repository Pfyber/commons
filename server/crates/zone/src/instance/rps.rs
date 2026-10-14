//! Rock paper scissors between two people (`together::RPS`): one asks,
//! anyone may be asked, and once they accept both have `rps::CHOOSE_MS` to
//! pick. Picks stay secret until both are in (or time runs out); then the
//! reveal goes to everyone nearby, who see the "rock, paper, scissors, shoot"
//! and the result. Leaving mid-match cancels it.

use super::Instance;
use commons_protocol::{ServerMsg, error_code, rps};

#[derive(Debug, Clone)]
pub(super) struct RpsMatch {
    a: u32,
    b: u32,
    a_pick: u8,
    b_pick: u8,
    ends: u32,
}

impl RpsMatch {
    fn has(&self, id: u32) -> bool {
        self.a == id || self.b == id
    }
}

impl Instance {
    /// `b` accepted `a`'s challenge: the clock starts.
    pub(super) fn rps_start(&mut self, a: u32, b: u32, now: u32) {
        if self.rps.iter().any(|m| m.has(a) || m.has(b)) {
            return self.error(b, error_code::NOT_ALLOWED, "finish the game you're in first");
        }
        let m = RpsMatch {
            a,
            b,
            a_pick: 0,
            b_pick: 0,
            ends: now + rps::CHOOSE_MS,
        };
        self.rps_send(&m, rps::CHOOSING);
        self.rps.push(m);
    }

    pub(super) fn rps_pick(&mut self, id: u32, pick: u8) {
        if !(rps::ROCK..=rps::SCISSORS).contains(&pick) {
            return;
        }
        let Some(i) = self.rps.iter().position(|m| m.has(id)) else {
            return;
        };
        let m = &mut self.rps[i];
        let slot = if m.a == id { &mut m.a_pick } else { &mut m.b_pick };
        if *slot == 0 {
            *slot = pick;
        }
        if m.a_pick != 0 && m.b_pick != 0 {
            self.rps_end(i, rps::REVEAL);
        }
    }

    /// Time's up: reveal whatever was picked.
    pub(super) fn rps_tick(&mut self, now: u32) {
        while let Some(i) = self.rps.iter().position(|m| m.ends <= now) {
            self.rps_end(i, rps::REVEAL);
        }
    }

    /// `id` is leaving: their match, if any, is off.
    pub(super) fn rps_leave(&mut self, id: u32) {
        if let Some(i) = self.rps.iter().position(|m| m.has(id)) {
            self.rps_end(i, rps::CANCELLED);
        }
    }

    fn rps_end(&mut self, i: usize, phase: u8) {
        let m = self.rps.swap_remove(i);
        self.rps_send(&m, phase);
    }

    /// Tells everyone near the players; picks only once revealed.
    fn rps_send(&mut self, m: &RpsMatch, phase: u8) {
        let Some(cell) = [m.a, m.b]
            .iter()
            .find_map(|id| self.avatars.get(id).map(|a| a.cell))
        else {
            return;
        };
        let shown = phase == rps::REVEAL;
        let msg = ServerMsg::Rps {
            a: m.a,
            b: m.b,
            phase,
            a_pick: if shown { m.a_pick } else { 0 },
            b_pick: if shown { m.b_pick } else { 0 },
            ends_t: if phase == rps::CHOOSING { m.ends } else { 0 },
        };
        self.broadcast(cell, &msg, None);
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg, rps, together};
    use std::sync::Arc;

    fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn rps_log(c: &Client) -> Vec<(u8, u8, u8)> {
        c.log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::Rps {
                    phase,
                    a_pick,
                    b_pick,
                    ..
                } => Some((*phase, *a_pick, *b_pick)),
                _ => None,
            })
            .collect()
    }

    /// Two people side by side; `a` challenges `b` and `b` accepts.
    fn challenge() -> (crate::instance::Instance, Client, Client) {
        let mut inst = instance_for(Arc::new(ZoneDef::new("park".into(), map(32, 32), None)));
        let a = connect(&mut inst, 1, "a", (20, 12));
        let b = connect(&mut inst, 2, "b", (20, 12));
        place(&mut inst, 1, (5, 5));
        place(&mut inst, 2, (6, 5));
        send(&mut inst, 1, ClientMsg::Offer { to: 2, kind: together::RPS });
        send(&mut inst, 2, ClientMsg::Accept { from: 1, kind: together::RPS });
        (inst, a, b)
    }

    #[test]
    fn picks_stay_secret_until_both_are_in() {
        let (mut inst, mut a, mut b) = challenge();
        send(&mut inst, 1, ClientMsg::RpsPick { pick: rps::ROCK });
        send(&mut inst, 1, ClientMsg::RpsPick { pick: rps::PAPER }); // no changing your mind
        send(&mut inst, 2, ClientMsg::RpsPick { pick: rps::SCISSORS });
        inst.flush();
        a.pump();
        b.pump();
        let want = vec![(rps::CHOOSING, 0, 0), (rps::REVEAL, rps::ROCK, rps::SCISSORS)];
        assert_eq!(rps_log(&a), want);
        assert_eq!(rps_log(&b), want);
        assert!(rps::beats(rps::ROCK, rps::SCISSORS));
    }

    #[test]
    fn time_runs_out_and_leaving_cancels() {
        let (mut inst, mut a, _b) = challenge();
        send(&mut inst, 2, ClientMsg::RpsPick { pick: rps::PAPER });
        let now = inst.clock.now_ms();
        inst.rps_tick(now + rps::CHOOSE_MS + 1);
        inst.flush();
        a.pump();
        assert_eq!(rps_log(&a).last(), Some(&(rps::REVEAL, 0, rps::PAPER)));
        assert!(rps::beats(rps::PAPER, 0), "not choosing loses");

        // A rematch, then b leaves.
        send(&mut inst, 1, ClientMsg::Offer { to: 2, kind: together::RPS });
        send(&mut inst, 2, ClientMsg::Accept { from: 1, kind: together::RPS });
        inst.handle(Cmd::Leave { conn: 2 });
        inst.flush();
        a.pump();
        assert_eq!(rps_log(&a).last(), Some(&(rps::CANCELLED, 0, 0)));
    }
}
