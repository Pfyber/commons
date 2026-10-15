//! Skateboards: step on outdoors and roll along at `SKATE_SPEED_X10`.
//!
//! Being on a board is a posture (`state::SKATING`), so everyone nearby (and
//! anyone arriving later, through `EntityInfo.state`) sees it. Hopping on or
//! off stops you where you are; sitting down or casting a line steps off.

use super::Instance;
use commons_protocol::{ServerMsg, error_code, state};

/// Zones that are indoors: no skating in the shop, the bar or the arcade.
const INDOOR_ZONES: &[&str] = &["shop", "bar", "arcade"];

impl Instance {
    pub(super) fn skate(&mut self, id: u32, on: bool, now: u32) {
        if on && INDOOR_ZONES.contains(&self.zone.id.as_str()) {
            return self.error(id, error_code::NOT_ALLOWED, "no skating indoors");
        }
        let a = self.avatars.get_mut(&id).unwrap();
        if (a.state == state::SKATING) == on || !a.emote_rl.try_take(now as u64) {
            return;
        }
        match a.state {
            state::SITTING => self.stand(id, now),
            state::FISHING => self.stop_fishing(id, false),
            _ => {}
        }
        // Stop where you are: the rest of a walk would be at the wrong speed.
        let a = self.avatars.get_mut(&id).unwrap();
        a.pending = None;
        let tile = a.motion.take().map_or(a.tile, |m| m.tile_at(now));
        a.state = if on { state::SKATING } else { state::IDLE };
        let moved = tile != a.tile;
        a.tile = tile;
        if moved {
            self.on_tile_changed(id, now);
        }
        let a = &self.avatars[&id];
        let msg = ServerMsg::StateChange {
            id,
            state: a.state,
            x: tile.0,
            y: tile.1,
        };
        let cell = a.cell;
        self.broadcast(cell, &msg, None);
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg, state};
    use commons_sim::{SKATE_SPEED_X10, WALK_SPEED_X10};
    use std::sync::Arc;

    fn skate(inst: &mut crate::instance::Instance, on: bool) {
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Skate { on },
        });
    }

    #[test]
    fn on_a_board_you_roll_faster_and_others_see_it() {
        let mut inst = instance_for(Arc::new(ZoneDef::new("park".into(), map(32, 32), None)));
        let _a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        skate(&mut inst, true);
        assert_eq!(inst.avatars[&1].state, state::SKATING);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo { x: 20, y: 20 },
        });
        assert_eq!(inst.avatars[&1].motion.as_ref().unwrap().speed_x10, SKATE_SPEED_X10);
        inst.flush();
        b.pump();
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::StateChange {
                id: 1,
                state: state::SKATING,
                ..
            }
        )));
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::MoveStart {
                id: 1,
                speed_x10: SKATE_SPEED_X10,
                ..
            }
        )));
        // Off again: stopped, and walking pace from here.
        skate(&mut inst, false);
        assert_eq!(inst.avatars[&1].state, state::IDLE);
        assert!(inst.avatars[&1].motion.is_none(), "hopping off stops you");
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo { x: 4, y: 4 },
        });
        assert_eq!(inst.avatars[&1].motion.as_ref().unwrap().speed_x10, WALK_SPEED_X10);
    }

    #[test]
    fn no_skating_in_the_shop() {
        let mut inst = instance_for(Arc::new(ZoneDef::new("shop".into(), map(16, 16), None)));
        let _a = connect(&mut inst, 1, "a", (20, 12));
        skate(&mut inst, true);
        assert_eq!(inst.avatars[&1].state, state::IDLE);
    }
}
