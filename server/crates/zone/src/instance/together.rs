//! Being together on the instance actor: moods, things done with someone,
//! sky lanterns and nooks.
//!
//! - **Moods** are shown above your head so strangers know who'd welcome
//!   company: open to chat, quiet company, up for a game.
//! - **Together:** a hug, a high five or a dance needs both people. One
//!   offers, the other accepts within `OFFER_MS`, standing close.
//! - **Sky lanterns** carry a short wish up into the sky for everyone nearby.
//! - **Nooks** are secret places (map objects `nook`). Chat inside one is
//!   heard only inside it, and chat outside doesn't reach in.

use super::Instance;
use commons_protocol::{ServerMsg, error_code, mood, together};
use commons_sim::TilePos;
use commons_sim::map::MapFile;

/// An offer stands this long.
pub(super) const OFFER_MS: u32 = 20_000;
/// How close (tiles, Chebyshev) two people must be to do something together.
const TOGETHER_RANGE: i32 = 2;
/// Following works across a little more distance: anyone in sight.
const FOLLOW_RANGE: i32 = 16;
/// Rock paper scissors: near enough to see each other's hands.
const RPS_RANGE: i32 = 4;
/// One sky lantern per person this often.
pub(super) const LANTERN_EVERY_MS: u32 = 30_000;

/// For each tile, the nook it's in (1-based, in map object order), or 0.
pub fn nook_map(map: &MapFile) -> Vec<u8> {
    let w = map.width as usize;
    let mut out = vec![0u8; w * map.height as usize];
    for (n, o) in map.objects.iter().filter(|o| o.kind == "nook").enumerate() {
        for y in o.y..(o.y + o.h).min(map.height) {
            for x in o.x..(o.x + o.w).min(map.width) {
                out[y as usize * w + x as usize] = (n + 1).min(255) as u8;
            }
        }
    }
    out
}

impl Instance {
    /// The nook at `t` (0: the open park).
    pub(super) fn nook_at(&self, t: TilePos) -> u8 {
        self.zone
            .nooks
            .get(t.1 as usize * self.zone.map.width as usize + t.0 as usize)
            .copied()
            .unwrap_or(0)
    }

    /// New clothes: everyone nearby sees them at once. (The API saved them;
    /// a look is only cosmetic, so any non-NPC look is fine here.)
    pub(super) fn set_look(&mut self, id: u32, look: u32, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if commons_protocol::NPC_LOOKS.contains(&look)
            || a.look == look
            || !a.emote_rl.try_take(now as u64)
        {
            return;
        }
        a.look = look;
        let cell = a.cell;
        self.broadcast(cell, &ServerMsg::LookChanged { id, look }, None);
    }

    pub(super) fn set_mood(&mut self, id: u32, m: u8, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if m > mood::MAX || a.mood == m || !a.emote_rl.try_take(now as u64) {
            return;
        }
        a.mood = m;
        let cell = a.cell;
        self.broadcast(cell, &ServerMsg::MoodShown { id, mood: m }, None);
    }

    fn close_enough(&self, a: u32, b: u32, kind: u8) -> bool {
        let range = match kind {
            together::FOLLOW | together::STOP_FOLLOW => FOLLOW_RANGE,
            together::RPS => RPS_RANGE,
            _ => TOGETHER_RANGE,
        };
        match (self.avatars.get(&a), self.avatars.get(&b)) {
            (Some(x), Some(y)) => {
                (x.tile.0 as i32 - y.tile.0 as i32).abs() <= range
                    && (x.tile.1 as i32 - y.tile.1 as i32).abs() <= range
            }
            _ => false,
        }
    }

    pub(super) fn offer(&mut self, id: u32, to: u32, kind: u8, now: u32) {
        if !(1..=together::MAX).contains(&kind) || to == id || !self.avatars.contains_key(&to) {
            return;
        }
        if !self
            .avatars
            .get_mut(&id)
            .unwrap()
            .emote_rl
            .try_take(now as u64)
        {
            return;
        }
        if !self.close_enough(id, to, kind) {
            return self.error(id, error_code::TOO_FAR, "walk a little closer");
        }
        if kind == together::STOP_FOLLOW {
            // Nothing to accept: just let the other side know.
            return self.send_to(to, &ServerMsg::Offered { from: id, kind });
        }
        self.offers.retain(|_, &mut (_, until)| until > now);
        self.offers.insert((id, to), (kind, now + OFFER_MS));
        self.send_to(to, &ServerMsg::Offered { from: id, kind });
    }

    pub(super) fn accept(&mut self, id: u32, from: u32, kind: u8, now: u32) {
        let Some((k, until)) = self.offers.remove(&(from, id)) else {
            return;
        };
        if k != kind || until <= now || !self.close_enough(id, from, kind) {
            return;
        }
        for who in [id, from] {
            if let Some(a) = self.avatars.get_mut(&who) {
                a.interactions = (a.interactions + 1).min(super::MAX_INTERACTIONS_PER_REPORT);
                // A hug or a dance is time together; agreeing to be followed isn't yet.
                a.sat_together |= kind < together::FOLLOW;
            }
        }
        if kind == together::RPS {
            return self.rps_start(from, id, now);
        }
        let cell = self.avatars[&id].cell;
        self.broadcast(
            cell,
            &ServerMsg::Together {
                a: from,
                b: id,
                kind,
            },
            None,
        );
    }

    pub(super) fn sky_lantern(&mut self, id: u32, text: &str, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if a.muted_until > super::now_ms().max(0) as u64 / 1000 {
            return self.error(
                id,
                error_code::NOT_ALLOWED,
                "you're muted for a little while",
            );
        }
        if a.next_lantern > now {
            return self.error(
                id,
                error_code::RATE_LIMITED,
                "your next lantern is nearly ready",
            );
        }
        let Some(text) = super::clean_chat(text) else {
            return;
        };
        let text: String = text.chars().take(60).collect();
        a.next_lantern = now + LANTERN_EVERY_MS;
        a.interactions = (a.interactions + 1).min(super::MAX_INTERACTIONS_PER_REPORT);
        let (x, y) = a.tile;
        let cell = a.cell;
        self.broadcast(cell, &ServerMsg::LanternRise { id, x, y, text }, None);
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::tests::*;
    use crate::instance::*;
    use commons_protocol::{ClientMsg, ServerMsg, mood, together};
    use commons_sim::map::MapObject;

    /// 32×32 park with a nook at (20..24, 20..24).
    fn nook_instance() -> Instance {
        let mut m = map(32, 32);
        m.objects = vec![MapObject {
            kind: "nook".into(),
            x: 20,
            y: 20,
            w: 4,
            h: 4,
            label: Some("The Willow Hideaway".into()),
        }];
        instance_for(Arc::new(ZoneDef::new("test".into(), m, None)))
    }

    fn heard(c: &mut Client, text: &str) -> bool {
        c.pump();
        c.log
            .iter()
            .any(|m| matches!(m, ServerMsg::ChatBubble { text: t, .. } if t == text))
    }

    #[test]
    fn nooks_keep_conversations_private() {
        let mut inst = nook_instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        let mut out = connect(&mut inst, 3, "out", (20, 12));
        place(&mut inst, 1, (21, 21));
        place(&mut inst, 2, (22, 22));
        place(&mut inst, 3, (19, 21)); // right outside, two tiles away
        let say = |inst: &mut Instance, conn, text: &str| {
            inst.handle(Cmd::Msg {
                conn,
                msg: ClientMsg::ChatSay { text: text.into() },
            });
            inst.flush();
        };
        say(&mut inst, 1, "just between us");
        assert!(heard(&mut b, "just between us"), "inside the nook");
        assert!(heard(&mut a, "just between us"), "the speaker sees it");
        assert!(!heard(&mut out, "just between us"), "outside can't hear");
        say(&mut inst, 3, "hello?");
        assert!(!heard(&mut b, "hello?"), "outside doesn't reach in");
    }

    #[test]
    fn a_hug_needs_both_and_moods_are_shown() {
        let mut inst = nook_instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        place(&mut inst, 1, (5, 5));
        place(&mut inst, 2, (6, 5));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::SetMood { mood: mood::OPEN },
        });
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Offer {
                to: 2,
                kind: together::HUG,
            },
        });
        inst.flush();
        b.pump();
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::MoodShown {
                id: 1,
                mood: mood::OPEN
            }
        )));
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::Offered {
                from: 1,
                kind: together::HUG
            }
        )));
        // Accepting something that wasn't offered does nothing.
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::Accept {
                from: 1,
                kind: together::DANCE,
            },
        });
        inst.flush();
        a.pump();
        assert!(
            !a.log
                .iter()
                .any(|m| matches!(m, ServerMsg::Together { .. }))
        );
        // The real offer was used up by the wrong answer; offer again and accept.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Offer {
                to: 2,
                kind: together::HUG,
            },
        });
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::Accept {
                from: 1,
                kind: together::HUG,
            },
        });
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::Together {
                a: 1,
                b: 2,
                kind: together::HUG
            }
        )));
        assert!(inst.avatars[&1].sat_together && inst.avatars[&2].sat_together);
        // A newcomer sees the mood in the snapshot.
        assert_eq!(inst.avatars[&1].info(inst.clock.now_ms()).mood, mood::OPEN);
    }

    #[test]
    fn new_clothes_are_seen_at_once_but_npc_looks_are_refused() {
        let mut inst = nook_instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::SetLook { look: 0x8100_00ff },
        });
        inst.flush();
        b.pump();
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::LookChanged {
                id: 1,
                look: 0x8100_00ff
            }
        )));
        assert_eq!(inst.avatars[&1].info(inst.clock.now_ms()).look, 0x8100_00ff);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::SetLook {
                look: commons_protocol::NPC_LOOKS[0],
            },
        });
        inst.flush();
        a.pump();
        assert_eq!(
            inst.avatars[&1].look, 0x8100_00ff,
            "nobody dresses as the Caretaker"
        );
    }

    #[test]
    fn following_needs_a_yes_and_works_from_further_away() {
        let mut inst = nook_instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        let mut b = connect(&mut inst, 2, "b", (20, 12));
        place(&mut inst, 1, (2, 2));
        place(&mut inst, 2, (12, 8)); // ten tiles away: too far for a hug
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Offer {
                to: 2,
                kind: together::FOLLOW,
            },
        });
        inst.flush();
        b.pump();
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::Offered {
                from: 1,
                kind: together::FOLLOW
            }
        )));
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::Accept {
                from: 1,
                kind: together::FOLLOW,
            },
        });
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::Together {
                a: 1,
                b: 2,
                kind: together::FOLLOW
            }
        )));
        assert!(
            !inst.avatars[&1].sat_together,
            "being followed isn't sitting together"
        );
        // Either side can stop it; the other is told.
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::Offer {
                to: 1,
                kind: together::STOP_FOLLOW,
            },
        });
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::Offered {
                from: 2,
                kind: together::STOP_FOLLOW
            }
        )));
    }

    #[test]
    fn sky_lanterns_rise_once_in_a_while() {
        let mut inst = nook_instance();
        let mut a = connect(&mut inst, 1, "a", (20, 12));
        for text in ["for everyone", "again"] {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::SkyLantern { text: text.into() },
            });
        }
        inst.flush();
        a.pump();
        let n = a
            .log
            .iter()
            .filter(|m| matches!(m, ServerMsg::LanternRise { .. }))
            .count();
        assert_eq!(n, 1, "one lantern per half minute");
    }
}
