//! The gladiator arena in the park: a walled ring you walk into, where two
//! fight on the sand for anyone about to see. One match at a time, against
//! the bot or another player. The fight itself is `commons_sim::arena`
//! (side on, along one line); here, it's laid along the middle row of the
//! sand: the fighters' own avatars are put there when it starts and moved
//! with it (their walking otherwise held), and everyone who can see the
//! ring gets an `ArenaState` every tick and an `ArenaEvent` for each blow.

use super::Instance;
use commons_protocol::{ArenaFighter, ServerMsg, arena, state};
use commons_sim::TilePos;
use commons_sim::arena as sim;
use commons_sim::map::MapObject;
use rand::Rng;

#[derive(Debug, Clone)]
pub(super) struct Arena {
    /// The ring (tiles).
    x: u16,
    y: u16,
    w: u16,
    h: u16,
    a: u32,
    b: u32,
    status: u8,
    fight: sim::Fight,
}

impl Arena {
    pub(super) fn new(o: &MapObject) -> Self {
        Arena {
            x: o.x,
            y: o.y,
            w: o.w,
            h: o.h,
            a: 0,
            b: 0,
            status: arena::EMPTY,
            fight: sim::Fight::new(0),
        }
    }

    /// The tile a fighter stands on at floor position `x` (on the middle row of the sand).
    fn tile_at(&self, x: f64) -> TilePos {
        let (left, right) = ((self.x + 3) as f64, (self.x + self.w - 4) as f64);
        (
            (left + x / sim::W * (right - left)).round() as u16,
            self.y + self.h / 2,
        )
    }

    fn side(&self, id: u32) -> Option<usize> {
        if self.status != arena::PLAYING {
            None
        } else if self.a == id {
            Some(0)
        } else if self.b == id {
            Some(1)
        } else {
            None
        }
    }

    fn state(&self, now: u32) -> ServerMsg {
        ServerMsg::ArenaState {
            a: self.a,
            b: self.b,
            status: self.status,
            now,
            ends: self.fight.ends,
            fighters: self
                .fight
                .f
                .iter()
                .map(|f| ArenaFighter {
                    x: (f.x * 10.0).round() as u16,
                    facing: (f.facing > 0) as u8,
                    hp: f.hp,
                    stamina: f.stamina.round().clamp(0.0, 100.0) as u8,
                    act: f.act,
                    act_at: f.act_at,
                    blocking: f.blocking,
                    flinch_until: f.flinch_until,
                })
                .collect(),
        }
    }
}

impl Instance {
    /// Whether `id` is fighting in the arena now (they can't walk off).
    pub(super) fn arena_fighting(&self, id: u32) -> bool {
        self.arena.as_ref().is_some_and(|ar| ar.side(id).is_some())
    }

    /// Sends to everyone who can see the ring (watching any cell it covers), once each.
    fn arena_broadcast(&mut self, msg: &ServerMsg) {
        let Some(ar) = &self.arena else { return };
        let (x0, y0, x1, y1) = (ar.x, ar.y, ar.x + ar.w - 1, ar.y + ar.h - 1);
        let mut cells: Vec<u16> = Vec::new();
        for ty in [y0, y1] {
            for tx in [x0, x1] {
                cells.push(self.cell_of((tx, ty)));
            }
        }
        cells.sort_unstable();
        cells.dedup();
        let mut to: Vec<u32> = cells
            .iter()
            .flat_map(|&c| self.watchers[c as usize].iter().copied())
            .collect();
        to.sort_unstable();
        to.dedup();
        let bytes = msg.to_bytes();
        for id in to {
            if let Some(a) = self.avatars.get_mut(&id) {
                a.send(&bytes);
            }
        }
    }

    fn arena_send(&mut self, now: u32) {
        let Some(ar) = &self.arena else { return };
        let msg = ar.state(now);
        self.arena_broadcast(&msg);
    }

    /// A newcomer sees how the arena stands.
    pub(super) fn arena_hello(&mut self, id: u32) {
        let now = self.clock.now_ms();
        if let Some(ar) = &self.arena {
            let msg = ar.state(now);
            self.send_to(id, &msg);
        }
    }

    /// Puts fighter `id` (if it's a player here) on tile `t`: walking stopped, everyone shown.
    fn arena_place(&mut self, id: u32, t: TilePos, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if a.state == state::SITTING {
            self.stand(id, now);
        }
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        a.motion = None;
        a.pending = None;
        if a.tile != t {
            a.tile = t;
            self.on_tile_changed(id, now);
        }
        let cell = self.avatars[&id].cell;
        self.broadcast(cell, &ServerMsg::Snap { id, x: t.0, y: t.1 }, None);
    }

    pub(super) fn arena_join(&mut self, id: u32, vs_bot: bool, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        let (a, b) = match ar.status {
            arena::PLAYING => return, // one match at a time: watch
            arena::WAITING if ar.a != id && !vs_bot => (ar.a, id),
            _ if vs_bot => (id, arena::BOT),
            _ => {
                ar.a = id;
                ar.b = 0;
                ar.status = arena::WAITING;
                return self.arena_send(now);
            }
        };
        ar.a = a;
        ar.b = b;
        ar.fight = sim::Fight::new(now);
        ar.status = arena::PLAYING;
        // Onto the sand, facing each other.
        let (ta, tb) = (ar.tile_at(ar.fight.f[0].x), ar.tile_at(ar.fight.f[1].x));
        self.arena_place(a, ta, now);
        self.arena_place(b, tb, now);
        self.arena_send(now);
    }

    /// `id` yields (or goes): a match in progress goes to the other side.
    pub(super) fn arena_leave(&mut self, id: u32) {
        let now = self.clock.now_ms();
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.a != id && ar.b != id {
            return;
        }
        match ar.status {
            arena::PLAYING => {
                ar.status = if ar.a == id {
                    arena::B_WON
                } else {
                    arena::A_WON
                };
                ar.fight.status = ar.status;
                self.arena_ended(now);
            }
            arena::WAITING => {
                ar.status = arena::EMPTY;
                ar.a = 0;
            }
            _ => return,
        }
        self.arena_send(now);
    }

    /// The match is over: each fighter left standing where they finished.
    fn arena_ended(&mut self, now: u32) {
        let Some(ar) = &self.arena else { return };
        let spots: Vec<(u32, TilePos)> = [(ar.a, ar.fight.f[0].x), (ar.b, ar.fight.f[1].x)]
            .iter()
            .map(|&(id, x)| (id, ar.tile_at(x)))
            .collect();
        for (id, t) in spots {
            self.arena_place(id, t, now);
        }
    }

    pub(super) fn arena_move(&mut self, id: u32, dir: u8) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if let Some(p) = ar.side(id) {
            ar.fight.walk(
                p,
                match dir {
                    1 => -1,
                    2 => 1,
                    _ => 0,
                },
            );
        }
    }

    pub(super) fn arena_act(&mut self, id: u32, act: u8, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if let Some(p) = ar.side(id)
            && ar.fight.input(p, act, now)
        {
            self.arena_send(now);
        }
    }

    /// A tick of the match: the bot, the fight, the fighters' tiles, and everyone told.
    pub(super) fn arena_tick(&mut self, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.status != arena::PLAYING {
            return;
        }
        if ar.b == arena::BOT {
            let mut rng = rand::rng();
            let (dir, act) = ar.fight.ai(1, now, &mut || rng.random::<f64>());
            ar.fight.walk(1, dir);
            if let Some(a) = act {
                ar.fight.input(1, a, now);
            }
        }
        let events = ar.fight.step(now);
        ar.status = ar.fight.status; // sim::PLAYING / A_WON / B_WON / DRAW match arena::*
        let players = [ar.a, ar.b];
        let tiles = [ar.tile_at(ar.fight.f[0].x), ar.tile_at(ar.fight.f[1].x)];
        let over = ar.status != arena::PLAYING;
        // The avatars stand where they fight (so cells and the nearby know).
        for (id, t) in players.into_iter().zip(tiles) {
            if let Some(a) = self.avatars.get_mut(&id)
                && a.tile != t
            {
                a.tile = t;
                self.on_tile_changed(id, now);
            }
        }
        for e in events {
            let msg = ServerMsg::ArenaEvent {
                kind: e.kind,
                by: players[e.by as usize],
                dmg: e.dmg,
                x: (e.x * 10.0).round() as u16,
            };
            self.arena_broadcast(&msg);
        }
        if over {
            self.arena_ended(now);
        }
        self.arena_send(now);
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg, arena};
    use commons_sim::map::MapObject;
    use std::sync::Arc;

    fn park() -> crate::instance::Instance {
        let mut m = map(40, 30);
        m.objects = vec![MapObject {
            kind: "arena".into(),
            x: 10,
            y: 5,
            w: 22,
            h: 15,
            label: None,
        }];
        instance_for(Arc::new(ZoneDef::new("founders_park".into(), m, None)))
    }

    fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn last_status(c: &Client) -> Option<(u32, u32, u8)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::ArenaState { a, b, status, .. } => Some((*a, *b, *status)),
            _ => None,
        })
    }

    #[test]
    fn fighters_take_the_sand_and_one_match_runs_at_a_time() {
        let mut inst = park();
        let mut a = connect(&mut inst, 1, "a", (20, 22));
        let _b = connect(&mut inst, 2, "b", (21, 22));
        let _c = connect(&mut inst, 3, "c", (22, 22));
        send(&mut inst, 1, ClientMsg::ArenaJoin { vs_bot: false });
        send(&mut inst, 2, ClientMsg::ArenaJoin { vs_bot: false });
        // A third can only watch.
        send(&mut inst, 3, ClientMsg::ArenaJoin { vs_bot: true });
        inst.flush();
        a.pump();
        assert_eq!(last_status(&a), Some((1, 2, arena::PLAYING)));
        // Both on the middle row of the sand, a apart from b.
        let (ta, tb) = (inst.avatars[&1].tile, inst.avatars[&2].tile);
        assert_eq!((ta.1, tb.1), (12, 12));
        assert!(ta.0 < tb.0 && ta.0 > 10 && tb.0 < 31, "{ta:?} {tb:?}");
        // Fighters can't walk off.
        send(
            &mut inst,
            1,
            ClientMsg::MoveTo {
                x: 2,
                y: 2,
                sprint: false,
            },
        );
        assert!(inst.avatars[&1].motion.is_none());
        // Walking in the fight moves the avatar.
        send(&mut inst, 1, ClientMsg::ArenaMove { dir: 1 });
        let now = inst.clock.now_ms();
        for k in 1..20 {
            inst.arena_tick(now + k * 100);
        }
        assert!(inst.avatars[&1].tile.0 < ta.0, "walked left");
        // Blows are passed on.
        send(&mut inst, 1, ClientMsg::ArenaMove { dir: 0 });
        send(&mut inst, 1, ClientMsg::ArenaAct { act: 1 });
        for k in 20..32 {
            inst.arena_tick(now + k * 100);
        }
        inst.flush();
        a.pump();
        assert!(
            a.log
                .iter()
                .any(|m| matches!(m, ServerMsg::ArenaEvent { by: 1, .. })),
            "a's swing"
        );
        // Yielding ends it; then a takes on the bot.
        send(&mut inst, 2, ClientMsg::ArenaLeave {});
        send(&mut inst, 1, ClientMsg::ArenaJoin { vs_bot: true });
        inst.flush();
        a.pump();
        assert_eq!(last_status(&a), Some((1, arena::BOT, arena::PLAYING)));
        let now = inst.clock.now_ms();
        for k in 1..400 {
            inst.arena_tick(now + k * 100);
        }
        inst.flush();
        a.pump();
        assert!(
            a.log
                .iter()
                .any(|m| matches!(m, ServerMsg::ArenaEvent { by: arena::BOT, .. })),
            "the bot fights"
        );
    }
}
