//! Fishing (spec §7): cast, wait, a local timing mini-game, then a
//! server-decided outcome. The server picks when the fish bites and what is
//! caught; the client only reports how well the reel was timed.

use super::{Instance, Pending};
use crate::econ::{CallError, FishInfo};
use commons_protocol::{ServerMsg, error_code, fish_event, state};
use commons_sim::TilePos;
use rand::Rng;

const BITE_MIN_MS: u32 = 2_500;
const BITE_MAX_MS: u32 = 9_000;
/// How long the fish stays on the hook.
const WINDOW_MS: u32 = 2_500;
/// Extra allowance for the reel message's network trip.
const GRACE_MS: u32 = 400;
/// Casts reach this far (Chebyshev tiles) from where you stand.
const CAST_RANGE: i32 = 2;
/// Reels scoring below this lose the fish.
const MIN_QUALITY: u16 = 250;

#[derive(Debug, Clone)]
pub(super) struct FishSession {
    target: TilePos,
    bite_at: u32,
    window_end: u32,
    biting: bool,
}

fn chebyshev(a: TilePos, b: TilePos) -> i32 {
    (a.0 as i32 - b.0 as i32)
        .abs()
        .max((a.1 as i32 - b.1 as i32).abs())
}

/// Picks a catch. Better timing (`quality` 0–1000) makes rare fish likelier
/// and junk less likely; night-only fish appear only at night.
pub(crate) fn roll_fish(fish: &[FishInfo], quality: u16, night: bool, roll: f64) -> Option<u32> {
    let q = quality.min(1000) as f64 / 1000.0;
    let weight = |f: &FishInfo| -> f64 {
        if f.night && !night {
            return 0.0;
        }
        let base = f.weight as f64;
        match f.rarity {
            0 if f.id == 107 => base * (1.0 - 0.8 * q), // junk: the old boot
            r if r >= 2 => base * (1.0 + 2.0 * q),
            _ => base,
        }
    };
    let total: f64 = fish.iter().map(weight).sum();
    if total <= 0.0 {
        return None;
    }
    let mut x = roll * total;
    for f in fish {
        x -= weight(f);
        if x < 0.0 {
            return Some(f.id);
        }
    }
    fish.last().map(|f| f.id)
}

fn is_night() -> bool {
    use chrono::Timelike;
    let h = chrono::Local::now().hour();
    !(6..21).contains(&h)
}

impl Instance {
    fn is_water(&self, t: TilePos) -> bool {
        let m = &self.zone.map;
        if t.0 >= m.width || t.1 >= m.height {
            return false;
        }
        let g = m.ground[t.1 as usize * m.width as usize + t.0 as usize] as usize;
        m.ground_legend.get(g).is_some_and(|n| n == "water")
    }

    pub(super) fn fish_cast(&mut self, id: u32, target: TilePos, now: u32) {
        if self.moving(id, now) {
            self.avatars.get_mut(&id).unwrap().pending = Some(Pending::Cast {
                x: target.0,
                y: target.1,
            });
            return;
        }
        self.do_cast(id, target, now);
    }

    pub(super) fn do_cast(&mut self, id: u32, target: TilePos, now: u32) {
        if self.economy.as_ref().and_then(|e| e.catalog()).is_none() {
            return self.error(id, error_code::UNAVAILABLE, "the fish aren't biting yet");
        }
        if !self.is_water(target) {
            return self.error(id, error_code::BAD_MESSAGE, "cast into the water");
        }
        let a = &self.avatars[&id];
        if a.fish.is_some() {
            return;
        }
        if chebyshev(a.tile, target) > CAST_RANGE {
            return self.error(id, error_code::TOO_FAR, "walk closer to the water");
        }
        if a.state == state::SITTING {
            self.stand(id, now);
        }
        let bite_at = now + rand::rng().random_range(BITE_MIN_MS..=BITE_MAX_MS);
        let a = self.avatars.get_mut(&id).unwrap();
        a.state = state::FISHING;
        a.fish = Some(FishSession {
            target,
            bite_at,
            window_end: bite_at + WINDOW_MS,
            biting: false,
        });
        let (tile, cell) = (a.tile, a.cell);
        self.broadcast(
            cell,
            &ServerMsg::StateChange {
                id,
                state: state::FISHING,
                x: tile.0,
                y: tile.1,
            },
            None,
        );
        self.broadcast(
            cell,
            &ServerMsg::FishEvent {
                id,
                kind: fish_event::CAST,
                x: target.0,
                y: target.1,
                item: 0,
            },
            None,
        );
    }

    /// Ends a fishing session; `escaped` tells everyone the fish got away.
    pub(super) fn stop_fishing(&mut self, id: u32, escaped: bool) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        let Some(session) = a.fish.take() else { return };
        a.state = state::IDLE;
        let (tile, cell) = (a.tile, a.cell);
        if escaped {
            let msg = ServerMsg::FishEvent {
                id,
                kind: fish_event::ESCAPED,
                x: session.target.0,
                y: session.target.1,
                item: 0,
            };
            self.broadcast(cell, &msg, None);
        }
        self.broadcast(
            cell,
            &ServerMsg::StateChange {
                id,
                state: state::IDLE,
                x: tile.0,
                y: tile.1,
            },
            None,
        );
    }

    pub(super) fn fish_reel(&mut self, id: u32, quality: u16, now: u32) {
        let Some(session) = self.avatars[&id].fish.clone() else {
            return;
        };
        let in_window = session.biting && now <= session.window_end + GRACE_MS;
        if !in_window || quality < MIN_QUALITY {
            return self.stop_fishing(id, true);
        }
        let Some(econ) = self.economy.clone() else {
            return self.stop_fishing(id, true);
        };
        let Some(catalog) = econ.catalog() else {
            return self.stop_fishing(id, true);
        };
        let Some(item) = roll_fish(&catalog.fish, quality, is_night(), rand::rng().random()) else {
            return self.stop_fishing(id, true);
        };
        // The fish is landed now; the economy records it in the background.
        let a = self.avatars.get_mut(&id).unwrap();
        a.fish = None;
        a.state = state::IDLE;
        let (tile, cell, player) = (a.tile, a.cell, a.player_id.clone());
        let catch = ServerMsg::FishEvent {
            id,
            kind: fish_event::CAUGHT,
            x: session.target.0,
            y: session.target.1,
            item,
        };
        self.broadcast(cell, &catch, None);
        self.broadcast(
            cell,
            &ServerMsg::StateChange {
                id,
                state: state::IDLE,
                x: tile.0,
                y: tile.1,
            },
            None,
        );
        let key = self.next_key("fish");
        self.spawn_call(
            async move { econ.grant(&player, item, 1, "fishing", &key).await },
            move |inst, result| match result {
                Ok(applied) if inst.avatars.contains_key(&id) => inst.send_granted(id, &applied),
                Ok(_) => {}
                Err(CallError::Rejected(msg)) => inst.error(id, error_code::NOT_ALLOWED, &msg),
                Err(CallError::Unavailable) => inst.error(
                    id,
                    error_code::UNAVAILABLE,
                    "the catch couldn't be saved; please try again",
                ),
            },
        );
    }

    /// Bites and timeouts.
    pub(super) fn fish_tick(&mut self, now: u32) {
        let fishing: Vec<u32> = self
            .avatars
            .values()
            .filter(|a| a.fish.is_some())
            .map(|a| a.id)
            .collect();
        for id in fishing {
            let a = self.avatars.get_mut(&id).unwrap();
            let s = a.fish.as_mut().unwrap();
            if !s.biting && now >= s.bite_at {
                s.biting = true;
                let (target, cell) = (s.target, a.cell);
                let bite = ServerMsg::FishEvent {
                    id,
                    kind: fish_event::BITE,
                    x: target.0,
                    y: target.1,
                    item: 0,
                };
                self.broadcast(cell, &bite, None);
            } else if s.biting && now > s.window_end + GRACE_MS {
                self.stop_fishing(id, true);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::econ::ZoneCatalog;
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use commons_protocol::{ClientMsg, ServerMsg};

    #[test]
    fn roll_respects_night_and_quality() {
        let fish = ZoneCatalog::for_tests().fish;
        // Moonfish (106) is night-only.
        for i in 0..100 {
            assert_ne!(roll_fish(&fish, 500, false, i as f64 / 100.0), Some(106));
        }
        let count = |q: u16, id: u32| {
            (0..1000)
                .filter(|i| roll_fish(&fish, q, true, *i as f64 / 1000.0) == Some(id))
                .count()
        };
        assert!(
            count(1000, 105) > count(0, 105),
            "perfect timing finds more koi"
        );
        assert!(count(1000, 107) < count(0, 107), "and fewer boots");
    }

    #[test]
    fn cast_bite_and_escape() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast { x: 5, y: 6 },
        });
        assert_eq!(inst.avatars[&1].state, state::FISHING);
        // Too far.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast { x: 5, y: 9 },
        });
        // Reeling before the bite scares the fish.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        assert_eq!(inst.avatars[&1].state, state::IDLE);
        // Cast again and let the fish get away.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast { x: 5, y: 6 },
        });
        inst.fish_tick(now + BITE_MAX_MS + 1);
        assert!(inst.avatars[&1].fish.as_ref().unwrap().biting);
        inst.fish_tick(now + BITE_MAX_MS + WINDOW_MS + GRACE_MS + 2);
        assert!(inst.avatars[&1].fish.is_none());
        inst.flush();
        a.pump();
        let kinds: Vec<u8> = a
            .log
            .iter()
            .filter_map(|m| match m {
                ServerMsg::FishEvent { kind, .. } => Some(*kind),
                _ => None,
            })
            .collect();
        assert_eq!(
            kinds,
            vec![
                fish_event::CAST,
                fish_event::ESCAPED,
                fish_event::CAST,
                fish_event::BITE,
                fish_event::ESCAPED
            ]
        );
    }
}
