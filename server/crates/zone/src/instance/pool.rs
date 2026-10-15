//! The bar's pool table: who's playing, whose shot, and the bar's bot.
//!
//! The game itself (physics and 8-ball rules) is `commons_sim::pool`. Shots
//! go out as `PoolShot` (so everyone nearby watches it roll, with the same
//! physics) followed by `PoolState` where everything came to rest. A player
//! can take on the bot or wait at the table for someone to join.

use super::Instance;
use commons_protocol::{PoolBall, ServerMsg, pool};
use commons_sim::pool as sim;
use commons_sim::TilePos;
use rand::Rng;

/// The bot steps up to the table this long after the balls stop…
const BOT_THINK_MS: u32 = 600;
/// …swings its cue round onto the line for this long…
const BOT_AIM_MS: u32 = 1_300;
/// …then draws it back for this long, and shoots.
const BOT_PULL_MS: u32 = 700;
/// Aim updates are passed on at most this often (ms).
const AIM_EVERY_MS: u32 = 50;
/// The bot's aim is off by up to this much (radians), so it can be beaten.
const BOT_WOBBLE: f64 = 0.035;

#[derive(Debug, Clone)]
pub(super) struct Table {
    /// Where the table stands (its messages go to that cell).
    tile: TilePos,
    a: u32,
    b: u32,
    status: u8,
    game: sim::Game,
    shot: u32,
    /// No shots until the last one has finished rolling on everyone's screen.
    busy_until: u32,
    /// The bot's shot as it lines it up (shown to everyone as `PoolAim`).
    bot_plan: Option<BotPlan>,
    /// When an aim was last passed on.
    aim_at: u32,
}

#[derive(Debug, Clone, Copy)]
struct BotPlan {
    vx: i32,
    vy: i32,
    /// Where its cue starts swinging from, and to (radians).
    from: f64,
    to: f64,
    start: u32,
}

impl Table {
    pub(super) fn new(tile: TilePos) -> Self {
        Table {
            tile,
            a: 0,
            b: 0,
            status: pool::EMPTY,
            game: sim::Game::new(),
            shot: 0,
            busy_until: 0,
            bot_plan: None,
            aim_at: 0,
        }
    }

    fn player(&self, turn: u8) -> u32 {
        if turn == 0 { self.a } else { self.b }
    }

    fn start(&mut self, a: u32, b: u32, now: u32) {
        self.a = a;
        self.b = b;
        self.game = sim::Game::new();
        self.status = pool::PLAYING;
        self.busy_until = now;
        self.bot_plan = None;
    }

    fn state(&self) -> ServerMsg {
        ServerMsg::PoolState {
            a: self.a,
            b: self.b,
            turn: self.game.turn,
            groups: self.game.groups,
            status: self.status,
            shot: self.shot,
            hole: if self.status == pool::PLAYING { self.game.eight_hole(self.game.turn) } else { sim::NO_HOLE },
            balls: self
                .game
                .balls
                .iter()
                .filter(|b| b.on)
                .map(|b| PoolBall {
                    n: b.n,
                    x: b.x as u16,
                    y: b.y as u16,
                })
                .collect(),
        }
    }
}

impl Instance {
    /// Tells everyone near the table how it stands.
    fn pool_send(&mut self) {
        let Some(t) = &self.pool else { return };
        let (msg, cell) = (t.state(), self.cell_of(t.tile));
        self.broadcast(cell, &msg, None);
    }

    /// A newcomer sees the table as it is.
    pub(super) fn pool_hello(&mut self, id: u32) {
        if let Some(t) = &self.pool {
            let msg = t.state();
            self.send_to(id, &msg);
        }
    }

    pub(super) fn pool_join(&mut self, id: u32, vs_bot: bool, now: u32) {
        let Some(t) = self.pool.as_mut() else { return };
        match t.status {
            pool::PLAYING => return, // a game's on; watch or wait
            pool::WAITING if t.a != id && !vs_bot => {
                let a = t.a;
                t.start(a, id, now);
            }
            _ if vs_bot => t.start(id, pool::BOT, now),
            _ => {
                t.a = id;
                t.b = 0;
                t.status = pool::WAITING;
            }
        }
        self.pool_send();
    }

    /// `id` puts the cue down or leaves: a game in progress goes to the other side.
    pub(super) fn pool_leave(&mut self, id: u32) {
        let Some(t) = self.pool.as_mut() else { return };
        if t.a != id && t.b != id {
            return;
        }
        match t.status {
            pool::PLAYING => t.status = if t.a == id { pool::B_WON } else { pool::A_WON },
            pool::WAITING => {
                t.status = pool::EMPTY;
                t.a = 0;
            }
            _ => return,
        }
        self.pool_send();
    }

    pub(super) fn pool_shoot(&mut self, id: u32, angle: u16, power: u16, now: u32) {
        let Some(t) = &self.pool else { return };
        if t.status != pool::PLAYING || t.player(t.game.turn) != id || now < t.busy_until {
            return;
        }
        let theta = angle as f64 / 65_536.0 * std::f64::consts::TAU;
        let speed = sim::shot_speed(power.min(1000));
        self.pool_play(id, (theta.cos() * speed) as i32, (theta.sin() * speed) as i32, now);
    }

    /// The player whose shot it is shows where they're aiming; everyone else at the table sees it.
    pub(super) fn pool_aim(&mut self, id: u32, angle: u16, pull: u16, now: u32) {
        let Some(t) = self.pool.as_mut() else { return };
        if t.status != pool::PLAYING || t.player(t.game.turn) != id || now < t.busy_until || now < t.aim_at + AIM_EVERY_MS {
            return;
        }
        t.aim_at = now;
        let tile = t.tile;
        let cell = self.cell_of(tile);
        self.broadcast(cell, &ServerMsg::PoolAim { by: id, angle, pull: pull.min(1000) }, Some(id));
    }

    fn pool_play(&mut self, by: u32, vx: i32, vy: i32, now: u32) {
        let Some(t) = self.pool.as_mut() else { return };
        t.bot_plan = None;
        t.shot += 1;
        let msg = ServerMsg::PoolShot {
            by,
            vx: (vx + pool::V_OFFSET) as u16,
            vy: (vy + pool::V_OFFSET) as u16,
            shot: t.shot,
        };
        let result = t.game.shoot(vx, vy);
        t.status = t.game.status; // sim::PLAYING / A_WON / B_WON match pool::*
        t.busy_until = now + result.steps * 1000 / 240;
        let tile = t.tile;
        let cell = self.cell_of(tile);
        self.broadcast(cell, &msg, None);
        self.pool_send();
    }

    /// The bot's turn: once the balls stop it picks its shot, swings its
    /// cue round onto the line and draws it back where everyone can see,
    /// then plays it.
    pub(super) fn pool_tick(&mut self, now: u32) {
        let Some(t) = self.pool.as_mut() else { return };
        if t.status != pool::PLAYING || t.player(t.game.turn) != pool::BOT || now < t.busy_until + BOT_THINK_MS {
            return;
        }
        let plan = match t.bot_plan {
            Some(p) => p,
            None => {
                let mut rng = rand::rng();
                let wobble = rng.random_range(-BOT_WOBBLE..=BOT_WOBBLE);
                let (vx, vy) = t.game.ai_shot(wobble);
                let to = (vy as f64).atan2(vx as f64);
                let swing = rng.random_range(0.5..1.2) * if rng.random_bool(0.5) { 1.0 } else { -1.0 };
                let p = BotPlan { vx, vy, from: to + swing, to, start: now };
                t.bot_plan = Some(p);
                p
            }
        };
        let since = now - plan.start;
        if since >= BOT_AIM_MS + BOT_PULL_MS {
            return self.pool_play(pool::BOT, plan.vx, plan.vy, now);
        }
        // Swing in, easing onto the line; then draw back toward the shot's power.
        let swing = (since as f64 / BOT_AIM_MS as f64).min(1.0);
        let ease = 1.0 - (1.0 - swing).powi(3);
        let angle = plan.from + (plan.to - plan.from) * ease;
        let power = ((plan.vx as f64).hypot(plan.vy as f64) / sim::MAX_SPEED).min(1.0);
        let pull = since.saturating_sub(BOT_AIM_MS) as f64 / BOT_PULL_MS as f64 * power;
        let turn = angle.rem_euclid(std::f64::consts::TAU) / std::f64::consts::TAU;
        let msg = ServerMsg::PoolAim { by: pool::BOT, angle: ((turn * 65_536.0) as u32 % 65_536) as u16, pull: (pull * 1000.0) as u16 };
        let tile = t.tile;
        let cell = self.cell_of(tile);
        self.broadcast(cell, &msg, None);
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use super::{BOT_AIM_MS, BOT_PULL_MS};
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg, pool};
    use commons_sim::map::MapObject;
    use std::sync::Arc;

    fn bar() -> crate::instance::Instance {
        let mut m = map(20, 13);
        m.objects = vec![MapObject {
            kind: "pool_table".into(),
            x: 12,
            y: 3,
            w: 4,
            h: 2,
            label: None,
        }];
        instance_for(Arc::new(ZoneDef::new("bar".into(), m, None)))
    }

    fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn last_state(c: &Client) -> Option<(u32, u32, u8, u8)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::PoolState { a, b, turn, status, .. } => Some((*a, *b, *turn, *status)),
            _ => None,
        })
    }

    #[test]
    fn two_players_take_turns_and_leaving_forfeits() {
        let mut inst = bar();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let _b = connect(&mut inst, 2, "b", (20, 12));
        send(&mut inst, 1, ClientMsg::PoolJoin { vs_bot: false });
        inst.flush();
        a.pump();
        assert_eq!(last_state(&a), Some((1, 0, 0, pool::WAITING)));
        send(&mut inst, 2, ClientMsg::PoolJoin { vs_bot: false });
        // Not b's turn yet.
        send(&mut inst, 2, ClientMsg::PoolShoot { angle: 0, power: 1000 });
        inst.flush();
        a.pump();
        assert_eq!(last_state(&a), Some((1, 2, 0, pool::PLAYING)));
        // a breaks.
        send(&mut inst, 1, ClientMsg::PoolShoot { angle: 0, power: 1000 });
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(m, ServerMsg::PoolShot { by: 1, shot: 1, .. })));
        inst.handle(Cmd::Leave { conn: 1 });
        inst.flush();
        let mut b = _b;
        b.pump();
        assert_eq!(last_state(&b).map(|s| s.3), Some(pool::B_WON));
    }

    #[test]
    fn the_bot_plays_its_turn() {
        let mut inst = bar();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        send(&mut inst, 1, ClientMsg::PoolJoin { vs_bot: true });
        // A soft break that pots nothing, so the bot is up.
        send(&mut inst, 1, ClientMsg::PoolShoot { angle: 0, power: 300 });
        let now = inst.clock.now_ms() + 60_000;
        // It steps up and lines its cue up where everyone can see…
        inst.pool_tick(now);
        inst.pool_tick(now + BOT_AIM_MS / 2);
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(m, ServerMsg::PoolAim { by: pool::BOT, .. })), "the bot shows its aim");
        assert!(!a.log.iter().any(|m| matches!(m, ServerMsg::PoolShot { by: pool::BOT, .. })), "not shot yet");
        // …then plays it.
        inst.pool_tick(now + BOT_AIM_MS + BOT_PULL_MS);
        inst.flush();
        a.pump();
        assert!(
            a.log.iter().any(|m| matches!(m, ServerMsg::PoolShot { by: pool::BOT, .. })),
            "the bot took its shot"
        );
    }
}
