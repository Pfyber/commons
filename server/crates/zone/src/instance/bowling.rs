//! The bowling alley's lanes: who's playing on each, whose ball, and the
//! alley's bot. The game itself (pins and scoring) is `commons_sim::bowling`.
//! A roll goes out as `BowlRolled` (where the ball went, how hard, which
//! pins fell), so everyone watching sees the same, followed by `BowlState`.
//! As at the pool table, a player takes on the bot or waits for someone.

use super::Instance;
use commons_protocol::{ServerMsg, bowl};
use commons_sim::TilePos;
use commons_sim::bowling as sim;
use rand::Rng;

/// No rolls until the last one has finished on everyone's screen: the ball
/// down the lane, the pins falling, the screen's cheer.
const ROLL_MS: u32 = 7_200;

/// How long a roll at `power` (0–1) takes on everyone's screen (as the
/// client's world/bowlfx.ts and lane panel): the swing, the ball down the
/// lane and the pins falling (both much quicker the harder it went), and the
/// moment after to see what's left; plus a little slack. At most `ROLL_MS`.
fn roll_ms(power: f64) -> u32 {
    let p = power.clamp(0.0, 1.0);
    let roll = 550.0 * (3400.0f64 / 550.0).powf(1.0 - p);
    let fall = 280.0 * (1300.0f64 / 280.0).powf(1.0 - p);
    ((850.0 + roll + fall + 1300.0 + 300.0) as u32).min(ROLL_MS)
}
/// The bot steps up this long after that.
const BOT_THINK_MS: u32 = 900;

#[derive(Debug, Clone)]
pub(super) struct Lane {
    /// Where the lane is (its messages go to that cell).
    tile: TilePos,
    a: u32,
    b: u32,
    status: u8,
    game: sim::Game,
    shot: u32,
    busy_until: u32,
}

impl Lane {
    pub(super) fn new(tile: TilePos) -> Self {
        Lane {
            tile,
            a: 0,
            b: 0,
            status: bowl::EMPTY,
            game: sim::Game::new(),
            shot: 0,
            busy_until: 0,
        }
    }

    fn player(&self, turn: u8) -> u32 {
        if turn == 0 { self.a } else { self.b }
    }

    fn start(&mut self, a: u32, b: u32, now: u32) {
        self.a = a;
        self.b = b;
        self.game = sim::Game::new();
        self.status = bowl::PLAYING;
        self.busy_until = now;
    }

    fn state(&self, lane: u8) -> ServerMsg {
        ServerMsg::BowlState {
            lane,
            a: self.a,
            b: self.b,
            status: self.status,
            turn: self.game.turn,
            frame: self.game.frame,
            ball: self.game.ball,
            standing: self.game.standing,
            shot: self.shot,
            rolls_a: self.game.rolls[0].clone(),
            rolls_b: self.game.rolls[1].clone(),
        }
    }
}

impl Instance {
    fn bowl_send(&mut self, lane: usize) {
        let Some(l) = self.lanes.get(lane) else {
            return;
        };
        let (msg, cell) = (l.state(lane as u8), self.cell_of(l.tile));
        self.broadcast(cell, &msg, None);
    }

    /// A newcomer sees how every lane stands.
    pub(super) fn bowl_hello(&mut self, id: u32) {
        let msgs: Vec<ServerMsg> = self
            .lanes
            .iter()
            .enumerate()
            .map(|(i, l)| l.state(i as u8))
            .collect();
        for m in msgs {
            self.send_to(id, &m);
        }
    }

    pub(super) fn bowl_join(&mut self, id: u32, lane: u8, vs_bot: bool, now: u32) {
        // One lane at a time.
        let elsewhere: Vec<usize> = (0..self.lanes.len())
            .filter(|&i| i != lane as usize)
            .collect();
        for i in elsewhere {
            self.bowl_leave(id, i as u8);
        }
        let Some(l) = self.lanes.get_mut(lane as usize) else {
            return;
        };
        match l.status {
            bowl::PLAYING => return, // a game's on; watch, or take another lane
            bowl::WAITING if l.a != id && !vs_bot => {
                let a = l.a;
                l.start(a, id, now);
            }
            _ if vs_bot => l.start(id, bowl::BOT, now),
            _ => {
                l.a = id;
                l.b = 0;
                l.status = bowl::WAITING;
            }
        }
        self.bowl_send(lane as usize);
    }

    /// `id` walks off or leaves: a game in progress goes to the other side.
    pub(super) fn bowl_leave(&mut self, id: u32, lane: u8) {
        let Some(l) = self.lanes.get_mut(lane as usize) else {
            return;
        };
        if l.a != id && l.b != id {
            return;
        }
        match l.status {
            bowl::PLAYING => l.status = if l.a == id { bowl::B_WON } else { bowl::A_WON },
            bowl::WAITING => {
                l.status = bowl::EMPTY;
                l.a = 0;
            }
            _ => return,
        }
        self.bowl_send(lane as usize);
    }

    /// Leaving the zone: off every lane.
    pub(super) fn bowl_leave_all(&mut self, id: u32) {
        for i in 0..self.lanes.len() {
            self.bowl_leave(id, i as u8);
        }
    }

    pub(super) fn bowl_roll(&mut self, id: u32, lane: u8, aim: u16, power: u16, now: u32) {
        let Some(l) = self.lanes.get(lane as usize) else {
            return;
        };
        if l.status != bowl::PLAYING || l.player(l.game.turn) != id || now < l.busy_until {
            return;
        }
        let aim = (aim.min(2000) as f64 - bowl::AIM_MIDDLE as f64) / 1000.0;
        self.bowl_play(lane as usize, id, aim, power.min(1000) as f64 / 1000.0, now);
    }

    fn bowl_play(&mut self, lane: usize, by: u32, aim: f64, power: f64, now: u32) {
        let Some(l) = self.lanes.get_mut(lane) else {
            return;
        };
        let mut rng = rand::rng();
        let knocked = sim::roll(l.game.standing, aim, power, &mut || rng.random::<f64>());
        l.shot += 1;
        let msg = ServerMsg::BowlRolled {
            lane: lane as u8,
            by,
            aim: ((aim * 1000.0).round() as i32 + bowl::AIM_MIDDLE as i32).clamp(0, 2000) as u16,
            power: (power * 1000.0).round() as u16,
            knocked,
            shot: l.shot,
        };
        l.game.bowled(knocked);
        l.status = l.game.status; // sim::PLAYING / A_WON / B_WON / DRAW match bowl::*
        l.busy_until = now + roll_ms(power);
        let tile = l.tile;
        let cell = self.cell_of(tile);
        self.broadcast(cell, &msg, None);
        self.bowl_send(lane);
    }

    /// The bot's ball: once everything has settled, it steps up and bowls.
    pub(super) fn bowl_tick(&mut self, now: u32) {
        for lane in 0..self.lanes.len() {
            let l = &self.lanes[lane];
            if l.status != bowl::PLAYING
                || l.player(l.game.turn) != bowl::BOT
                || now < l.busy_until + BOT_THINK_MS
            {
                continue;
            }
            let mut rng = rand::rng();
            let (aim, power) = l.game.ai_roll(rng.random(), rng.random());
            self.bowl_play(lane, bowl::BOT, aim, power, now);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{BOT_THINK_MS, ROLL_MS};
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg, bowl};
    use commons_sim::map::MapObject;
    use std::sync::Arc;

    fn alley() -> crate::instance::Instance {
        let mut m = map(24, 16);
        m.objects = (0..2)
            .map(|i| MapObject {
                kind: "bowling_lane".into(),
                x: 2 + i * 4,
                y: 2,
                w: 3,
                h: 9,
                label: None,
            })
            .collect();
        instance_for(Arc::new(ZoneDef::new("bowling".into(), m, None)))
    }

    fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn last_state(c: &Client, lane: u8) -> Option<(u32, u32, u8, u8, usize)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::BowlState {
                lane: l,
                a,
                b,
                status,
                turn,
                rolls_a,
                ..
            } if *l == lane => Some((*a, *b, *status, *turn, rolls_a.len())),
            _ => None,
        })
    }

    #[test]
    fn two_players_take_turns_and_the_bot_bowls_its_frames() {
        let mut inst = alley();
        let mut a = connect(&mut inst, 1, "a", (20, 13));
        let _b = connect(&mut inst, 2, "b", (20, 13));
        // Lane 0: a waits, b joins, b can't bowl first, a does.
        send(
            &mut inst,
            1,
            ClientMsg::BowlJoin {
                lane: 0,
                vs_bot: false,
            },
        );
        send(
            &mut inst,
            2,
            ClientMsg::BowlJoin {
                lane: 0,
                vs_bot: false,
            },
        );
        send(
            &mut inst,
            2,
            ClientMsg::BowlRoll {
                lane: 0,
                aim: 1000,
                power: 1000,
            },
        );
        inst.flush();
        a.pump();
        assert_eq!(
            last_state(&a, 0).map(|s| (s.0, s.1, s.2, s.4)),
            Some((1, 2, bowl::PLAYING, 0))
        );
        send(
            &mut inst,
            1,
            ClientMsg::BowlRoll {
                lane: 0,
                aim: 1000,
                power: 1000,
            },
        );
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::BowlRolled {
                lane: 0,
                by: 1,
                shot: 1,
                ..
            }
        )));
        assert_eq!(last_state(&a, 0).map(|s| s.4), Some(1));
        // Leaving forfeits.
        inst.handle(Cmd::Leave { conn: 2 });
        inst.flush();
        a.pump();
        assert_eq!(last_state(&a, 0).map(|s| s.2), Some(bowl::A_WON));

        // Lane 1 against the bot: a gutter ball, then the bot's frame plays out.
        send(
            &mut inst,
            1,
            ClientMsg::BowlJoin {
                lane: 1,
                vs_bot: true,
            },
        );
        send(
            &mut inst,
            1,
            ClientMsg::BowlRoll {
                lane: 1,
                aim: 0,
                power: 500,
            },
        );
        // (The second ball once the first has rolled: avatar 1 is a's.)
        let mut now = inst.clock.now_ms() + ROLL_MS;
        inst.bowl_roll(1, 1, 0, 500, now);
        for _ in 0..4 {
            now += ROLL_MS + BOT_THINK_MS;
            inst.bowl_tick(now);
        }
        inst.flush();
        a.pump();
        assert!(
            a.log.iter().any(|m| matches!(
                m,
                ServerMsg::BowlRolled {
                    lane: 1,
                    by: bowl::BOT,
                    ..
                }
            )),
            "the bot bowled"
        );
    }
}
