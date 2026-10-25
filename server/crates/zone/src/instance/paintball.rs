//! The Splat Yard: paintball, Blue against Red, three a side (bots in the
//! empty places). The match itself is `commons_sim::paintball`; here it's
//! put on the map: the players' own avatars go out onto the field when it
//! starts (their walking held: they move with the match), everyone in the
//! hall gets a `PbState` every tick, a `PbShot` for each shot and a
//! `PbEvent` for each splat, and when it's over they're back by the desk.

use super::Instance;
use commons_protocol::{PbPickup, PbPlayer, ServerMsg, state};
use commons_sim::TilePos;
use commons_sim::map::MapObject;
use commons_sim::paintball as pb;
use rand::Rng;

#[derive(Debug, Clone)]
pub(super) struct Yard {
    m: pb::Match,
    /// The field's top-left corner (map tiles).
    origin: (u16, u16),
    /// Where the players stand when they come off the field (by place).
    desk: Vec<TilePos>,
    /// The lobby changed (sent at once, not every tick).
    dirty: bool,
}

impl Yard {
    pub(super) fn new(objects: &[MapObject]) -> Option<Yard> {
        let (field, origin) = pb::Field::from_map(objects)?;
        let desk = objects
            .iter()
            .find(|o| o.kind == "pb_desk")
            .map(|d| {
                (0..pb::SLOTS as u16)
                    .map(|k| (d.x + k % d.w.max(1), d.y + d.h))
                    .collect()
            })
            .unwrap_or_else(|| vec![(origin.0, origin.1 + field.h as u16 + 1); pb::SLOTS]);
        Some(Yard {
            m: pb::Match::new(field),
            origin,
            desk,
            dirty: true,
        })
    }

    /// The map tile under field point (x, y).
    fn tile(&self, x: f64, y: f64) -> TilePos {
        (
            self.origin.0 + x.max(0.0) as u16,
            self.origin.1 + y.max(0.0) as u16,
        )
    }

    fn state(&self, now: u32) -> ServerMsg {
        let m = &self.m;
        let ms = |t: u32| t.saturating_sub(now).min(65_535) as u16;
        ServerMsg::PbState {
            status: m.status,
            now,
            phase_ms: m.phase_end.saturating_sub(now),
            blue: m.score[0],
            red: m.score[1],
            winner: m.winner,
            slots: m.slots.to_vec(),
            players: m
                .players
                .iter()
                .map(|p| PbPlayer {
                    id: p.id,
                    team: p.team,
                    x: x100(p.x),
                    y: x100(p.y),
                    aim: pb::aim_to_u16(p.aim),
                    hp: p.hp,
                    ammo: p.ammo,
                    flags: p.flags(now),
                    power: if now < p.power_until { p.power } else { 0 },
                    power_ms: ms(p.power_until),
                    respawn_ms: if p.out { ms(p.respawn_at) } else { 0 },
                    dash_ms: ms(p.dash_ready),
                    reload_ms: ms(p.reload_until),
                    kills: p.kills,
                    deaths: p.deaths,
                    streak: p.streak,
                    fix: p.fix,
                })
                .collect(),
            pickups: m
                .pads
                .iter()
                .filter(|p| p.kind != 0)
                .map(|p| PbPickup {
                    kind: p.kind,
                    x: x100(p.x),
                    y: x100(p.y),
                })
                .collect(),
            level: m.level,
        }
    }
}

fn x100(v: f64) -> u16 {
    (v * 100.0).round().clamp(0.0, 65_535.0) as u16
}

fn from100(v: u16) -> f64 {
    v as f64 / 100.0
}

impl Instance {
    /// Whether `id` is out on the paintball field (they can't walk off it).
    pub(super) fn pb_playing(&self, id: u32) -> bool {
        self.yard.as_ref().is_some_and(|y| y.m.playing(id))
    }

    /// To everyone in the hall (it's all one room).
    fn pb_broadcast(&mut self, msg: &ServerMsg, except: Option<u32>) {
        let bytes = msg.to_bytes();
        for (id, a) in self.avatars.iter_mut() {
            if Some(*id) != except {
                a.send(&bytes);
            }
        }
    }

    fn pb_send_state(&mut self, now: u32) {
        let Some(y) = &self.yard else { return };
        let msg = y.state(now);
        self.pb_broadcast(&msg, None);
    }

    /// A newcomer sees how the yard stands.
    pub(super) fn pb_hello(&mut self, id: u32) {
        let now = self.clock.now_ms();
        if let Some(y) = &self.yard {
            let msg = y.state(now);
            self.send_to(id, &msg);
        }
    }

    /// Puts player `id` on tile `t`: walking stopped, everyone shown.
    fn pb_place(&mut self, id: u32, t: TilePos, now: u32) {
        let Some(a) = self.avatars.get(&id) else {
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

    /// Everyone on the field to where the match has them.
    fn pb_place_all(&mut self, now: u32) {
        let Some(y) = &self.yard else { return };
        let spots: Vec<(u32, TilePos)> =
            y.m.players
                .iter()
                .filter(|p| !p.bot)
                .map(|p| (p.id, y.tile(p.x, p.y)))
                .collect();
        for (id, t) in spots {
            self.pb_place(id, t, now);
        }
    }

    /// `id` back by the desk (off the field).
    fn pb_to_desk(&mut self, id: u32, slot: usize, now: u32) {
        let Some(y) = &self.yard else { return };
        let t = y.desk[slot % y.desk.len()];
        self.pb_place(id, t, now);
    }

    pub(super) fn pb_join(&mut self, id: u32, team: u8, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        let was_playing = y.m.playing(id);
        if !y.m.join(id, team, now) {
            self.error(
                id,
                commons_protocol::error_code::BAD_MESSAGE,
                "both teams are full",
            );
            return;
        }
        y.dirty = true;
        // Dropped into a match in progress: straight out to their base.
        if !was_playing && y.m.playing(id) {
            let t = y.m.player(id).map(|p| y.tile(p.x, p.y));
            if let Some(t) = t {
                self.pb_place(id, t, now);
            }
        }
        self.pb_send_state(now);
    }

    pub(super) fn pb_leave(&mut self, id: u32) {
        let now = self.clock.now_ms();
        let Some(y) = self.yard.as_mut() else { return };
        let Some(slot) = y.m.slot_of(id) else { return };
        let was_playing = y.m.playing(id);
        let was_on = y.m.status != pb::LOBBY;
        y.m.leave(id, now);
        y.dirty = true;
        let called_off = was_on && y.m.status == pb::LOBBY;
        if was_playing && self.avatars.contains_key(&id) {
            self.pb_to_desk(id, slot, now);
        }
        if called_off {
            self.pb_all_to_desk(now);
        }
        self.pb_send_state(now);
    }

    /// Everyone with a place, back off the field.
    fn pb_all_to_desk(&mut self, now: u32) {
        let Some(y) = &self.yard else { return };
        let ids: Vec<(u32, usize)> =
            y.m.slots
                .iter()
                .enumerate()
                .filter(|(_, s)| **s != 0 && !pb::is_bot(**s))
                .map(|(k, &s)| (s, k))
                .collect();
        for (id, k) in ids {
            self.pb_to_desk(id, k, now);
        }
    }

    pub(super) fn pb_start(&mut self, id: u32, bots: bool, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if !y.m.start(id, bots, now) {
            self.error(
                id,
                commons_protocol::error_code::BAD_MESSAGE,
                "each side needs a player (or fill with bots)",
            );
            return;
        }
        y.dirty = true;
        self.pb_place_all(now);
        self.pb_send_state(now);
    }

    pub(super) fn pb_bot(&mut self, id: u32, slot: u8, on: bool, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if y.m.set_bot(id, slot as usize, on) {
            y.dirty = true;
            self.pb_send_state(now);
        }
    }

    pub(super) fn pb_level(&mut self, id: u32, level: u8, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        if y.m.set_level(id, level) {
            y.dirty = true;
            self.pb_send_state(now);
        }
    }

    pub(super) fn pb_move(&mut self, id: u32, x: u16, y: u16, aim: u16, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        yd.m.claim_move(id, from100(x), from100(y), pb::aim_from_u16(aim), now);
    }

    pub(super) fn pb_fire(&mut self, id: u32, shot: u16, x: u16, y: u16, aim: u16, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        if let Some(s) =
            yd.m.fire(id, shot, from100(x), from100(y), pb::aim_from_u16(aim), now)
        {
            let msg = shot_msg(&s);
            // The shooter already flies their own.
            self.pb_broadcast(&msg, Some(id));
        }
    }

    pub(super) fn pb_dash(&mut self, id: u32, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        if let Some(e) = yd.m.dash(id, now) {
            self.pb_broadcast(&event_msg(&e), Some(id));
        }
    }

    pub(super) fn pb_reload(&mut self, id: u32, now: u32) {
        let Some(yd) = self.yard.as_mut() else { return };
        if let Some(e) = yd.m.reload(id, now) {
            self.pb_broadcast(&event_msg(&e), None);
        }
    }

    /// A tick of the match: everything moves on, the avatars stand where
    /// their players are, and everyone's told.
    pub(super) fn pb_tick(&mut self, now: u32) {
        let Some(y) = self.yard.as_mut() else { return };
        let before = y.m.status;
        if before == pb::LOBBY {
            if y.dirty {
                y.dirty = false;
                self.pb_send_state(now);
            }
            return;
        }
        let mut rng = rand::rng();
        let (evs, shots) = y.m.step(now, 100, &mut || rng.random::<f64>());
        let after = y.m.status;
        // The avatars stand where their players are (so the cells know).
        let spots: Vec<(u32, TilePos)> =
            y.m.players
                .iter()
                .filter(|p| !p.bot)
                .map(|p| (p.id, y.tile(p.x, p.y)))
                .collect();
        for (id, t) in spots {
            if let Some(a) = self.avatars.get_mut(&id)
                && a.tile != t
            {
                a.tile = t;
                self.on_tile_changed(id, now);
            }
        }
        for s in &shots {
            self.pb_broadcast(&shot_msg(s), None);
        }
        for e in &evs {
            self.pb_broadcast(&event_msg(e), None);
        }
        if before != pb::LOBBY && after == pb::LOBBY {
            self.pb_all_to_desk(now);
        }
        self.pb_send_state(now);
    }
}

fn shot_msg(s: &pb::Shot) -> ServerMsg {
    ServerMsg::PbShot {
        by: s.by,
        shot: s.n,
        x: x100(s.x),
        y: x100(s.y),
        aim: pb::aim_to_u16(s.aim),
        kind: s.kind,
    }
}

fn event_msg(e: &pb::Event) -> ServerMsg {
    ServerMsg::PbEvent {
        kind: e.kind,
        a: e.a,
        b: e.b,
        x: x100(e.x),
        y: x100(e.y),
        n: e.n,
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg};
    use commons_sim::map::MapObject;
    use commons_sim::paintball as pb;
    use std::sync::Arc;

    fn yard() -> crate::instance::Instance {
        let mut m = map(30, 30);
        let o = |kind: &str, x, y, w, h, label: Option<&str>| MapObject {
            kind: kind.into(),
            x,
            y,
            w,
            h,
            label: label.map(Into::into),
        };
        m.objects = vec![
            o("pb_field", 2, 2, 20, 12, None),
            o("pb_hay", 10, 6, 1, 2, None),
            o("pb_spawn", 3, 7, 1, 1, Some("blue")),
            o("pb_spawn", 20, 7, 1, 1, Some("red")),
            o("pb_pad", 11, 3, 1, 1, None),
            o("pb_desk", 10, 20, 6, 1, None),
        ];
        instance_for(Arc::new(ZoneDef::new("paintball".into(), m, None)))
    }

    fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn last_state(c: &Client) -> Option<(u8, Vec<u32>)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::PbState { status, slots, .. } => Some((*status, slots.clone())),
            _ => None,
        })
    }

    #[test]
    fn a_match_with_bots_runs_and_players_go_out_and_back() {
        let mut inst = yard();
        let mut a = connect(&mut inst, 1, "a", (12, 25));
        let _b = connect(&mut inst, 2, "b", (13, 25));
        send(&mut inst, 1, ClientMsg::PbJoin { team: 0 });
        send(&mut inst, 2, ClientMsg::PbJoin { team: 1 });
        send(&mut inst, 1, ClientMsg::PbStart { bots: true });
        inst.flush();
        a.pump();
        let (status, slots) = last_state(&a).unwrap();
        assert_eq!(status, pb::COUNTDOWN);
        assert_eq!(slots[0], 1);
        assert_eq!(slots[3], 2);
        assert!(slots.iter().filter(|&&s| pb::is_bot(s)).count() == 4);
        // Out on the field, at their bases; no walking off.
        let t = inst.avatars[&1].tile;
        assert_eq!(t, (3, 7));
        send(
            &mut inst,
            1,
            ClientMsg::MoveTo {
                x: 12,
                y: 25,
                sprint: false,
            },
        );
        assert!(inst.avatars[&1].motion.is_none());
        let now = inst.clock.now_ms();
        for k in 1..=40 {
            inst.pb_tick(now + k * 100);
        }
        // Moving and firing.
        let at = now + 4100;
        send(
            &mut inst,
            1,
            ClientMsg::PbMove {
                x: 250,
                y: 560,
                aim: 0,
            },
        );
        send(
            &mut inst,
            1,
            ClientMsg::PbFire {
                shot: 1,
                x: 250,
                y: 560,
                aim: 0,
            },
        );
        let _ = at;
        for k in 41..=80 {
            inst.pb_tick(now + k * 100);
        }
        inst.flush();
        a.pump();
        assert!(
            a.log.iter().any(|m| matches!(m, ServerMsg::PbShot { .. })),
            "shots are seen"
        );
        assert_eq!(last_state(&a).unwrap().0, pb::PLAYING);
        // b leaves: a bot takes the place; b's back by the desk.
        send(&mut inst, 2, ClientMsg::PbLeave {});
        inst.flush();
        a.pump();
        let (_, slots) = last_state(&a).unwrap();
        assert!(pb::is_bot(slots[3]));
        assert_eq!(inst.avatars[&2].tile.1, 21);
        // a leaves too: nobody left, it's called off.
        send(&mut inst, 1, ClientMsg::PbLeave {});
        inst.flush();
        a.pump();
        assert_eq!(last_state(&a).unwrap().0, pb::LOBBY);
    }
}
