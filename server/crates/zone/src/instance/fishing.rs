//! Fishing (spec §7): cast, wait, a local timing mini-game, then a
//! server-decided outcome. The server picks when the fish bites and, as it
//! bites, which fish it is (by its rarity's odds); the bite tells the
//! angler, whose reel game is the harder the rarer the fish. The client only
//! reports how well the reel was timed: good enough, and that fish is landed.

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
/// The fisherman's upgraded rod (an item): fish bite a quarter sooner, and
/// the reel game gives one more swing of the needle, so the hook holds longer.
pub(crate) const ROD_ITEM: u32 = 112;
const ROD_BITE: f64 = 0.75;
const ROD_EXTRA_MS: u32 = 3_200;
/** Fish this rare (`rarity`) and up land flopping on the bank, to be hit before they jump back. */
const FLOP_FROM: i16 = 2;
/// …and, missed in the reel game, may stay hooked for one more swing (the
/// angler's screen rolls for it): the hook holds this much longer for them.
const SECOND_CHANCE_MS: u32 = 3_000;
/// Legendary and mythical fish must be stopped in the zone twice: more time for the second.
const DOUBLE_HIT_FROM: i16 = 4;
const DOUBLE_HIT_MS: u32 = 2_000;
/** Treasure: a chest instead of a fish, opened on the spot for coins. */
pub(crate) const TREASURE_ITEM: u32 = 113;
const TREASURE_COINS: i32 = 50;
const COIN: u32 = 1;

#[derive(Debug, Clone)]
pub(super) struct FishSession {
    target: TilePos,
    bite_at: u32,
    window_end: u32,
    biting: bool,
    /// The fish on the hook, once it bites.
    fish: Option<u32>,
    /// When the line went in, and whether it's the upgraded rod.
    cast_at: u32,
    rod: bool,
    /// A rare fish flopping on the bank, waiting to be hit.
    flop: Option<Flop>,
}

#[derive(Debug, Clone)]
pub(super) struct Flop {
    item: u32,
    at: TilePos,
    until: u32,
    hits: u32,
    /// Hits it takes, and how far (tiles) each one sends it.
    need: u32,
    reach: i32,
}

/** How hard a fish of `rarity` is to land on the bank: hits needed, and how far it hops. */
pub(crate) fn flop_toughness(rarity: i16) -> (u32, i32) {
    match rarity {
        ..=2 => (3, 1),
        3 => (4, 1),
        4 => (5, 1),
        _ => (5, 2),
    }
}

fn chebyshev(a: TilePos, b: TilePos) -> i32 {
    (a.0 as i32 - b.0 as i32)
        .abs()
        .max((a.1 as i32 - b.1 as i32).abs())
}

/// Picks what bites, by each fish's odds (`weight`: common ones often,
/// mythical ones seldom); night-only fish appear only at night.
pub(crate) fn roll_fish(fish: &[FishInfo], night: bool, roll: f64) -> Option<u32> {
    let weight = |f: &FishInfo| -> f64 {
        if f.night && !night {
            0.0
        } else {
            f.weight as f64
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
            fish: None,
            cast_at: now,
            rod: false,
            flop: None,
        });
        let (tile, cell, player) = (a.tile, a.cell, a.player_id.clone());
        // The upgraded rod? (Asked of the economy; the answer's back long before a bite.)
        if let Some(econ) = self.economy.clone() {
            self.spawn_call(
                async move { econ.has(&player, ROD_ITEM).await },
                move |inst, has| {
                    if !matches!(has, Ok(q) if q > 0) {
                        return;
                    }
                    let Some(s) = inst.avatars.get_mut(&id).and_then(|a| a.fish.as_mut()) else {
                        return;
                    };
                    if s.cast_at != now || s.biting {
                        return;
                    }
                    s.rod = true;
                    s.bite_at = now + ((s.bite_at - now) as f64 * ROD_BITE) as u32;
                    s.window_end = s.bite_at + WINDOW_MS + ROD_EXTRA_MS;
                },
            );
        }
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
        // A fish flopping on the bank always goes back in, so screens don't keep it.
        if escaped || session.flop.is_some() {
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
        let Some(item) = session.fish else {
            return self.stop_fishing(id, true);
        };
        // A rare fish (not a chest) comes out flopping onto the bank: hit it to land it.
        let rarity = econ
            .catalog()
            .and_then(|c| c.fish.iter().find(|f| f.id == item).map(|f| f.rarity))
            .unwrap_or(0);
        if rarity >= FLOP_FROM && item != TREASURE_ITEM {
            let a = &self.avatars[&id];
            let at = self.flop_spot(a.tile, session.target, None, 1);
            let (need, reach) = flop_toughness(rarity);
            let a = self.avatars.get_mut(&id).unwrap();
            // The rod goes down: the angler may walk about after the fish now.
            a.state = state::IDLE;
            let (tile, cell) = (a.tile, a.cell);
            let s = a.fish.as_mut().unwrap();
            s.biting = false;
            s.flop = Some(Flop {
                item,
                at,
                until: now + fish_event::FLOP_MS,
                hits: 0,
                need,
                reach,
            });
            let msg = ServerMsg::FishEvent {
                id,
                kind: fish_event::FLOP,
                x: at.0,
                y: at.1,
                item,
            };
            self.broadcast(cell, &msg, None);
            let idle = ServerMsg::StateChange {
                id,
                state: state::IDLE,
                x: tile.0,
                y: tile.1,
            };
            return self.broadcast(cell, &idle, None);
        }
        self.land(id, item, session.target);
    }

    /**
     * Where a fish flops: the dry tile around `at` nearest `water` (as it
     * comes out); or, hit (`from` its spot), a random dry tile right next
     * to where it was (never water; if there's none, it stays put).
     */
    fn flop_spot(&self, at: TilePos, water: TilePos, from: Option<TilePos>, reach: i32) -> TilePos {
        let mut spots = vec![];
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                let (x, y) = (at.0 as i32 + dx, at.1 as i32 + dy);
                if (dx == 0 && dy == 0) || x < 0 || y < 0 {
                    continue;
                }
                let t = (x as u16, y as u16);
                if self.grid.walkable(t.0, t.1) && !self.is_water(t) {
                    spots.push(t);
                }
            }
        }
        if from.is_some() {
            if spots.is_empty() {
                return at;
            }
            return spots[rand::rng().random_range(0..spots.len())];
        }
        spots
            .into_iter()
            .min_by_key(|t| {
                (t.0 as i32 - water.0 as i32).pow(2) + (t.1 as i32 - water.1 as i32).pow(2)
            })
            .unwrap_or(at)
    }

    /// A smack at your flopping fish: enough of them and it's yours.
    pub(super) fn fish_hit(&mut self, id: u32, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        let cell = a.cell;
        let Some(f) = a.fish.as_mut().and_then(|s| s.flop.as_mut()) else {
            return;
        };
        if now > f.until + GRACE_MS || !a.hit_rl.try_take(now as u64) {
            return;
        }
        f.hits += 1;
        let (item, at, hits, need, reach) = (f.item, f.at, f.hits, f.need, f.reach);
        // Smacked, it flops off to a tile nearby (unless that was the last hit).
        let at = if hits < need {
            let water = self.avatars[&id]
                .fish
                .as_ref()
                .map(|s| s.target)
                .unwrap_or(at);
            let next = self.flop_spot(at, water, Some(at), reach);
            if let Some(f) = self
                .avatars
                .get_mut(&id)
                .and_then(|a| a.fish.as_mut())
                .and_then(|s| s.flop.as_mut())
            {
                f.at = next;
            }
            next
        } else {
            at
        };
        let msg = ServerMsg::FishEvent {
            id,
            kind: fish_event::HIT,
            x: at.0,
            y: at.1,
            item: hits,
        };
        self.broadcast(cell, &msg, None);
        if hits >= need {
            self.land(id, item, at);
        }
    }

    /// The catch is landed (from `from`): everyone sees it, the economy records it.
    fn land(&mut self, id: u32, item: u32, from: TilePos) {
        let Some(econ) = self.economy.clone() else {
            return self.stop_fishing(id, true);
        };
        let a = self.avatars.get_mut(&id).unwrap();
        a.fish = None;
        a.state = state::IDLE;
        let (tile, cell, player) = (a.tile, a.cell, a.player_id.clone());
        let catch = ServerMsg::FishEvent {
            id,
            kind: fish_event::CAUGHT,
            x: from.0,
            y: from.1,
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
        let (grant, qty) = if item == TREASURE_ITEM {
            (COIN, TREASURE_COINS)
        } else {
            (item, 1)
        };
        self.spawn_call(
            async move { econ.grant(&player, grant, qty, "fishing", &key).await },
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
            if let Some(f) = &s.flop {
                // Not hit in time: it flops back into the water.
                if now > f.until + GRACE_MS {
                    self.stop_fishing(id, true);
                }
                continue;
            }
            if !s.biting && now >= s.bite_at {
                s.biting = true;
                // What's on the hook: the angler sees how rare (and so how hard) it is.
                let catalog = self.economy.as_ref().and_then(|e| e.catalog());
                s.fish = catalog
                    .as_ref()
                    .and_then(|c| roll_fish(&c.fish, is_night(), rand::rng().random()));
                // A rare one may get a second swing at it.
                let rarity = catalog.as_ref().and_then(|c| {
                    s.fish
                        .and_then(|id| c.fish.iter().find(|f| f.id == id).map(|f| f.rarity))
                });
                if rarity.is_some_and(|r| r >= FLOP_FROM) {
                    s.window_end += SECOND_CHANCE_MS;
                }
                if rarity.is_some_and(|r| r >= DOUBLE_HIT_FROM) {
                    s.window_end += DOUBLE_HIT_MS;
                }
                let (target, cell, item) = (s.target, a.cell, s.fish.unwrap_or(0));
                let bite = ServerMsg::FishEvent {
                    id,
                    kind: fish_event::BITE,
                    x: target.0,
                    y: target.1,
                    item,
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
    fn roll_respects_night_and_rarity() {
        let fish = ZoneCatalog::for_tests().fish;
        // Moonfish (106) is night-only.
        for i in 0..100 {
            assert_ne!(roll_fish(&fish, false, i as f64 / 100.0), Some(106));
        }
        let count = |id: u32| {
            (0..1000)
                .filter(|i| roll_fish(&fish, true, *i as f64 / 1000.0) == Some(id))
                .count()
        };
        assert!(
            count(100) > count(107) && count(107) > count(105),
            "common minnows, fewer boots, a rare koi"
        );
        assert!(count(105) > 0, "but koi do bite");
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

    #[test]
    fn an_epic_fish_flops_on_the_bank_until_hit_four_times() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast { x: 5, y: 6 },
        });
        // A koi (epic, in the test catalogue: four hits) bites.
        {
            let s = inst.avatars.get_mut(&1).unwrap().fish.as_mut().unwrap();
            s.biting = true;
            s.fish = Some(105);
            s.window_end = now + 60_000;
        }
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        assert!(
            inst.avatars[&1].fish.as_ref().unwrap().flop.is_some(),
            "flopping on the bank"
        );
        for _ in 0..3 {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishHit {},
            });
        }
        assert!(
            inst.avatars[&1].fish.is_some(),
            "three isn't enough for an epic fish"
        );
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishHit {},
        });
        assert!(inst.avatars[&1].fish.is_none(), "landed");
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
            &kinds[1..],
            &[
                fish_event::FLOP,
                fish_event::HIT,
                fish_event::HIT,
                fish_event::HIT,
                fish_event::HIT,
                fish_event::CAUGHT
            ]
        );
    }

    #[test]
    fn an_unhit_fish_jumps_back_in() {
        let mut inst = pond_instance();
        let _a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast { x: 5, y: 6 },
        });
        {
            let s = inst.avatars.get_mut(&1).unwrap().fish.as_mut().unwrap();
            s.biting = true;
            s.fish = Some(105);
            s.window_end = now + 60_000;
        }
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishHit {},
        });
        inst.fish_tick(now + fish_event::FLOP_MS + GRACE_MS + 1_000);
        assert!(inst.avatars[&1].fish.is_none(), "it got away");
        assert_eq!(inst.avatars[&1].state, state::IDLE);
    }

    #[test]
    fn walking_after_a_flopping_fish_keeps_it_and_hits_make_it_hop() {
        let mut inst = pond_instance();
        let mut a = connect(&mut inst, 1, "angler", (20, 12));
        place(&mut inst, 1, (5, 4));
        let now = inst.clock.now_ms();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishCast { x: 5, y: 6 },
        });
        {
            let s = inst.avatars.get_mut(&1).unwrap().fish.as_mut().unwrap();
            s.biting = true;
            s.fish = Some(105);
            s.window_end = now + 60_000;
        }
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishReel { quality: 900 },
        });
        assert_eq!(
            inst.avatars[&1].state,
            state::IDLE,
            "rod down, free to move"
        );
        // Walk off after it: the fish is still there to be hit.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo {
                x: 6,
                y: 3,
                sprint: false,
            },
        });
        let spot = |inst: &crate::instance::Instance| {
            inst.avatars[&1]
                .fish
                .as_ref()
                .unwrap()
                .flop
                .as_ref()
                .unwrap()
                .at
        };
        let before = spot(&inst);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::FishHit {},
        });
        let after = spot(&inst);
        assert_ne!(after, before, "a hit sends it flopping somewhere else");
        assert!(
            (after.0 as i32 - before.0 as i32).abs() <= 1
                && (after.1 as i32 - before.1 as i32).abs() <= 1,
            "just one tile over"
        );
        assert!(!inst.is_water(after), "and never into the water");
        for _ in 0..3 {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::FishHit {},
            });
        }
        assert!(inst.avatars[&1].fish.is_none(), "landed");
        inst.flush();
        a.pump();
        assert!(a.log.iter().any(|m| matches!(
            m,
            ServerMsg::FishEvent {
                kind: fish_event::CAUGHT,
                ..
            }
        )));
    }

    #[test]
    fn rarer_fish_take_more_hits_and_mythical_ones_hop_further() {
        assert_eq!(flop_toughness(2), (3, 1), "rare");
        assert_eq!(flop_toughness(3), (4, 1), "epic");
        assert_eq!(flop_toughness(4), (5, 1), "legendary");
        assert_eq!(flop_toughness(5), (5, 2), "mythical: two tiles");
    }
}
