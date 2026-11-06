//! The Glowroot Labyrinth (a new one daily; see `commons_sim::labyrinth`).
//!
//! - Sleeping lanterns at the crossings: walk past one and it lights, for
//!   everyone down here today. The last one you passed is where you wake if
//!   a wisp blows your light out.
//! - Wisps drift along the long corridors (`labyrinth::wisp_at`, by the
//!   instance clock): touch one and you wake by your last lantern.
//! - Heartstones, three, far out: touch each to be attuned to it (yours, for
//!   the day). The Great Gate into the heart chamber opens for anyone
//!   attuned to all three, and stays open while they're by it, so whoever's
//!   with them comes in too.
//! - Root gates, shortcuts: a timed one opens for a few seconds when you step
//!   on its rune stone; a twin one while both its stones have someone on them.
//! - Lost glimmers, each yours once a day (a few coins); the Glowroot, the
//!   way back up: coins the first time each day, and everyone hears.
//!
//! Every reward is keyed by the day and the player, so it's paid once a
//! day however often you come back down (or the server restarts).

use super::Instance;
use crate::registry::ZoneDef;
use commons_protocol::{ServerMsg, error_code, lab, state};
use commons_sim::TilePos;
use commons_sim::labyrinth::{self, GateKind, HEARTSTONES};
use commons_sim::map::MapObject;
use std::collections::{HashMap, HashSet};

const COIN: u32 = 1;
const GLIMMER_COINS: i32 = 10;
const OUT_COINS: i32 = 100;
/// A timed root gate stays open this long after you step on its stone.
const TIMED_MS: u32 = 6_000;
/// A twin gate, this long after the second person steps off.
const TWIN_MS: u32 = 8_000;
/// The Great Gate, this long after the last attuned person moves away.
const GREAT_MS: u32 = 12_000;
/// Closer than this (tiles) to a wisp, and it has you.
const CATCH: f64 = 0.72;
/// After waking, a moment before a wisp can have you again.
const SAFE_MS: u32 = 4_000;
const ALL_ATTUNED: u8 = (1 << HEARTSTONES) - 1;

struct Gate {
    kind: GateKind,
    tiles: Vec<TilePos>,
    stones: Vec<TilePos>,
    open: bool,
    until: u32,
}

pub(super) struct Lab {
    lanterns: Vec<TilePos>,
    glimmers: Vec<TilePos>,
    heartstones: Vec<TilePos>,
    /// The Glowroot's tiles (x, y, w, h).
    heart: (u16, u16, u16, u16),
    gates: Vec<Gate>,
    wisps: Vec<MapObject>,
    lit: Vec<bool>,
    /// Today, by player id: glimmers found, heartstones attuned (a bit each).
    found: HashMap<String, u8>,
    attuned: HashMap<String, u8>,
    /// Who's found the way up today.
    out: HashSet<String>,
    /// Rewards being paid right now (so a second step can't ask twice).
    paying: HashSet<String>,
    /// Where each player wakes if a wisp has them: by the last lantern they passed.
    checkpoint: HashMap<String, TilePos>,
    /// Just woken (by avatar id): safe from wisps till then.
    safe_until: HashMap<u32, u32>,
}

/// Objects of `kind`, in the order of their number (their label, before any `:`).
fn numbered<'a>(zone: &'a ZoneDef, kind: &str) -> Vec<&'a MapObject> {
    let num = |o: &MapObject| -> usize {
        o.label
            .as_deref()
            .and_then(|l| l.split(':').next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(usize::MAX)
    };
    let mut v: Vec<&MapObject> = zone.map.objects.iter().filter(|o| o.kind == kind).collect();
    v.sort_by_key(|o| num(o));
    v
}

fn cheb(a: TilePos, b: TilePos) -> i32 {
    (a.0 as i32 - b.0 as i32)
        .abs()
        .max((a.1 as i32 - b.1 as i32).abs())
}

impl Lab {
    pub(super) fn for_zone(zone: &ZoneDef) -> Option<Lab> {
        if zone.id != labyrinth::ZONE {
            return None;
        }
        let heart = zone.map.objects.iter().find(|o| o.kind == "lab_heart")?;
        let at = |o: &&MapObject| (o.x, o.y);
        let lanterns: Vec<TilePos> = numbered(zone, "lab_lantern").iter().map(at).collect();
        let stones = numbered(zone, "lab_stone");
        let gates = numbered(zone, "lab_gate")
            .iter()
            .enumerate()
            .filter_map(|(i, o)| {
                let kind = GateKind::parse(o.label.as_deref()?.split(':').nth(1)?)?;
                let tiles = (o.y..o.y + o.h)
                    .flat_map(|y| (o.x..o.x + o.w).map(move |x| (x, y)))
                    .collect();
                let stones = stones
                    .iter()
                    .filter(|s| s.label.as_deref() == Some(i.to_string().as_str()))
                    .map(at)
                    .collect();
                Some(Gate {
                    kind,
                    tiles,
                    stones,
                    open: false,
                    until: 0,
                })
            })
            .collect();
        Some(Lab {
            lit: vec![false; lanterns.len()],
            lanterns,
            glimmers: numbered(zone, "lab_glimmer").iter().map(at).collect(),
            heartstones: numbered(zone, "lab_heartstone").iter().map(at).collect(),
            heart: (heart.x, heart.y, heart.w, heart.h),
            gates,
            wisps: zone
                .map
                .objects
                .iter()
                .filter(|o| o.kind == "lab_wisp")
                .cloned()
                .collect(),
            found: HashMap::new(),
            attuned: HashMap::new(),
            out: HashSet::new(),
            paying: HashSet::new(),
            checkpoint: HashMap::new(),
            safe_until: HashMap::new(),
        })
    }

    fn near_gate(&self, g: usize, t: TilePos, within: i32) -> bool {
        self.gates[g].tiles.iter().any(|&q| cheb(q, t) <= within)
    }
}

impl Instance {
    fn lab_day(&self) -> String {
        self.owner.clone().unwrap_or_default()
    }

    fn lab_all(&mut self, msg: &ServerMsg) {
        let bytes = msg.to_bytes();
        for a in self.avatars.values_mut() {
            a.send(&bytes);
        }
    }

    /// A newcomer sees what's lit and open, and what they've found already.
    pub(super) fn lab_hello(&mut self, id: u32) {
        let Some(lab) = &self.lab else { return };
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        let msg = ServerMsg::LabState {
            lit: (0..lab.lit.len())
                .filter(|&i| lab.lit[i])
                .map(|i| i as u8)
                .collect(),
            gates: (0..lab.gates.len())
                .filter(|&i| lab.gates[i].open)
                .map(|i| i as u8)
                .collect(),
            found: lab.found.get(&a.player_id).copied().unwrap_or(0),
            attuned: lab.attuned.get(&a.player_id).copied().unwrap_or(0),
            finishers: lab.out.len().min(u16::MAX as usize) as u16,
            out: lab.out.contains(&a.player_id),
        };
        self.send_to(id, &msg);
    }

    /// `id` stepped onto a new tile.
    pub(super) fn lab_near(&mut self, id: u32, now: u32) {
        let Some(lab) = &mut self.lab else { return };
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        let (tile, player) = (a.tile, a.player_id.clone());

        // Lanterns: lit as you pass, and the last one is where you'd wake.
        let mut newly = Vec::new();
        for i in 0..lab.lanterns.len() {
            if cheb(lab.lanterns[i], tile) <= 1 {
                lab.checkpoint.insert(player.clone(), tile);
                if !lab.lit[i] {
                    lab.lit[i] = true;
                    newly.push(i);
                }
            }
        }
        let glimmer = (0..lab.glimmers.len()).find(|&i| {
            cheb(lab.glimmers[i], tile) <= 1
                && lab.found.get(&player).is_none_or(|f| f & (1 << i) == 0)
        });
        let attune = (0..lab.heartstones.len()).find(|&i| {
            cheb(lab.heartstones[i], tile) <= 1
                && lab.attuned.get(&player).is_none_or(|f| f & (1 << i) == 0)
        });
        if let Some(i) = attune {
            *lab.attuned.entry(player.clone()).or_insert(0) |= 1 << i;
        }
        let attuned = lab.attuned.get(&player).copied().unwrap_or(0) == ALL_ATTUNED;
        // Gates this step opens: a timed one's stone, a twin's (if its other
        // stone's taken too), the Great Gate for the attuned.
        let occupied: HashSet<TilePos> = self.avatars.values().map(|a| a.tile).collect();
        let mut opens: Vec<(usize, u32)> = Vec::new();
        for (g, gate) in lab.gates.iter().enumerate() {
            match gate.kind {
                GateKind::Timed if gate.stones.contains(&tile) => opens.push((g, now + TIMED_MS)),
                GateKind::Twin
                    if gate.stones.contains(&tile)
                        && gate.stones.iter().all(|s| occupied.contains(s)) =>
                {
                    opens.push((g, now + TWIN_MS))
                }
                GateKind::Great if attuned && lab.near_gate(g, tile, 2) => {
                    opens.push((g, now + GREAT_MS))
                }
                _ => {}
            }
        }
        let (hx, hy, hw, hh) = lab.heart;
        let at_heart = tile.0 >= hx && tile.0 < hx + hw && tile.1 >= hy && tile.1 < hy + hh;
        let going_up = at_heart && !lab.out.contains(&player);

        for i in newly {
            self.lab_all(&ServerMsg::LabEvent {
                kind: lab::LIT,
                id,
                n: i as u16,
            });
        }
        if let Some(i) = attune {
            self.send_to(
                id,
                &ServerMsg::LabEvent {
                    kind: lab::ATTUNED,
                    id,
                    n: i as u16,
                },
            );
        }
        for (g, until) in opens {
            self.lab_open(g, until);
        }
        if let Some(i) = glimmer {
            self.lab_glimmer(id, player.clone(), i);
        }
        if going_up {
            self.lab_out(id, player);
        }
    }

    /// Opens gate `g` (if shut) until at least `until`.
    fn lab_open(&mut self, g: usize, until: u32) {
        let Some(lab) = self.lab.as_mut() else { return };
        let gate = &mut lab.gates[g];
        gate.until = gate.until.max(until);
        if gate.open {
            return;
        }
        gate.open = true;
        for &(x, y) in &gate.tiles {
            self.grid.set_blocked(x, y, false);
        }
        self.lab_all(&ServerMsg::LabEvent {
            kind: lab::GATE_OPEN,
            id: 0,
            n: g as u16,
        });
    }

    /// Every tick: gates held open or shut again, and the wisps.
    pub(super) fn lab_tick(&mut self, now: u32) {
        let Some(lab) = self.lab.as_mut() else { return };
        let tiles: Vec<(u32, TilePos, String)> = self
            .avatars
            .values()
            .map(|a| (a.id, a.tile, a.player_id.clone()))
            .collect();
        let occupied: HashSet<TilePos> = tiles.iter().map(|t| t.1).collect();
        let mut shut = Vec::new();
        for g in 0..lab.gates.len() {
            if !lab.gates[g].open {
                continue;
            }
            // Held open: a twin while both stones are stood on; the Great Gate
            // while someone attuned is by it. And never shut on anyone.
            let held = match lab.gates[g].kind {
                GateKind::Twin => lab.gates[g].stones.iter().all(|s| occupied.contains(s)),
                GateKind::Great => tiles.iter().any(|(_, t, p)| {
                    lab.attuned.get(p).copied().unwrap_or(0) == ALL_ATTUNED
                        && lab.near_gate(g, *t, 2)
                }),
                GateKind::Timed => false,
            };
            if held {
                let hold = if lab.gates[g].kind == GateKind::Twin {
                    TWIN_MS
                } else {
                    GREAT_MS
                };
                lab.gates[g].until = lab.gates[g].until.max(now + hold);
            }
            let in_the_way = tiles.iter().any(|(_, t, _)| lab.near_gate(g, *t, 1));
            if now >= lab.gates[g].until && !in_the_way {
                lab.gates[g].open = false;
                shut.push(g);
            }
        }
        // Wisps: anyone they touch (and not just woken) is blown back to their last lantern.
        lab.safe_until.retain(|_, &mut t| t > now);
        let wisps: Vec<(f64, f64)> = lab
            .wisps
            .iter()
            .map(|w| labyrinth::wisp_at(w, now))
            .collect();
        let mut caught: Vec<(u32, TilePos)> = Vec::new();
        for a in self.avatars.values() {
            if lab.safe_until.contains_key(&a.id) || a.state == state::SITTING {
                continue;
            }
            let (x, y) = a
                .motion
                .as_ref()
                .map_or((a.tile.0 as f64, a.tile.1 as f64), |m| m.pos_at(now));
            if wisps.iter().any(|&(wx, wy)| (wx - x).hypot(wy - y) < CATCH) {
                let spawn = (self.zone.map.spawn.x, self.zone.map.spawn.y);
                caught.push((
                    a.id,
                    lab.checkpoint.get(&a.player_id).copied().unwrap_or(spawn),
                ));
            }
        }
        for &(id, _) in &caught {
            lab.safe_until.insert(id, now + SAFE_MS);
        }
        for g in shut {
            let tiles = self.lab.as_ref().unwrap().gates[g].tiles.clone();
            for (x, y) in tiles {
                self.grid.set_blocked(x, y, true);
            }
            self.lab_all(&ServerMsg::LabEvent {
                kind: lab::GATE_SHUT,
                id: 0,
                n: g as u16,
            });
        }
        for (id, at) in caught {
            self.lab_all(&ServerMsg::LabEvent {
                kind: lab::CAUGHT,
                id,
                n: 0,
            });
            self.lab_place(id, at, now);
        }
    }

    /// Puts `id` on tile `t` (woken by a lantern): walking stopped, everyone shown.
    fn lab_place(&mut self, id: u32, t: TilePos, now: u32) {
        let Some(t) = self.grid.nearest_walkable(t, 3) else {
            return;
        };
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

    fn lab_glimmer(&mut self, id: u32, player: String, i: usize) {
        let key = format!("lab:{}:{player}:glimmer{i}", self.lab_day());
        let lab = self.lab.as_mut().unwrap();
        if !lab.paying.insert(key.clone()) {
            return;
        }
        *lab.found.entry(player.clone()).or_insert(0) |= 1 << i;
        self.send_to(
            id,
            &ServerMsg::LabEvent {
                kind: lab::GLIMMER,
                id,
                n: i as u16,
            },
        );
        let Some(econ) = self.economy.clone() else {
            self.lab.as_mut().unwrap().paying.remove(&key);
            return;
        };
        let k = key.clone();
        self.spawn_call(
            async move {
                econ.grant(&player, COIN, GLIMMER_COINS, "labyrinth_glimmer", &k)
                    .await
            },
            move |inst, r| {
                if let Some(lab) = inst.lab.as_mut() {
                    lab.paying.remove(&key);
                }
                match r {
                    Ok(applied) => inst.send_granted(id, &applied),
                    // (Found already today, before a restart: nothing more to pay.)
                    Err(crate::econ::CallError::Rejected(_)) => {}
                    Err(_) => inst.error(
                        id,
                        error_code::UNAVAILABLE,
                        "the glimmer's coins got stuck: they'll turn up",
                    ),
                }
            },
        );
    }

    fn lab_out(&mut self, id: u32, player: String) {
        let key = format!("lab:{}:{player}:out", self.lab_day());
        let lab = self.lab.as_mut().unwrap();
        if !lab.paying.insert(key.clone()) {
            return;
        }
        lab.out.insert(player.clone());
        let rank = lab.out.len().min(u16::MAX as usize) as u16;
        // Everyone hears it (and you're off back up, on your side).
        self.lab_all(&ServerMsg::LabEvent {
            kind: lab::OUT,
            id,
            n: rank,
        });
        let Some(econ) = self.economy.clone() else {
            self.lab.as_mut().unwrap().paying.remove(&key);
            return;
        };
        let k = key.clone();
        self.spawn_call(
            async move {
                econ.grant(&player, COIN, OUT_COINS, "labyrinth_out", &k)
                    .await
            },
            move |inst, r| {
                if let Some(lab) = inst.lab.as_mut() {
                    lab.paying.remove(&key);
                }
                if let Ok(applied) = r {
                    inst.send_granted(id, &applied);
                }
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::tests::*;
    use crate::instance::{Cmd, Instance};
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg, lab};
    use commons_sim::TilePos;
    use commons_sim::labyrinth;
    use commons_sim::map::MapFile;
    use std::sync::Arc;

    /// A labyrinth with its wisps taken out (they'd make the walks below a lottery).
    fn calm(day: u32) -> (MapFile, Instance) {
        let mut map = labyrinth::generate(day);
        map.objects.retain(|o| o.kind != "lab_wisp");
        let zone = Arc::new(ZoneDef::new(labyrinth::ZONE.into(), map.clone(), None));
        (
            map,
            Instance::new(zone, 1, Some(labyrinth::day_key(day)), None, None),
        )
    }

    /// Walks `id` to `to` on a synthetic clock; returns the time it got there.
    fn walk(inst: &mut Instance, c: &mut Client, mut now: u32, id: u32, to: TilePos) -> u32 {
        inst.handle(Cmd::Msg {
            conn: id as u64,
            msg: ClientMsg::MoveTo {
                x: to.0,
                y: to.1,
                sprint: false,
            },
        });
        for _ in 0..4000 {
            now += 100;
            inst.step(now);
            inst.lab_tick(now);
            inst.flush();
            c.pump();
            if inst.avatars[&id].tile == to
                && inst.avatars[&id]
                    .motion
                    .as_ref()
                    .is_none_or(|m| m.is_done(now))
            {
                break;
            }
        }
        assert_eq!(inst.avatars[&id].tile, to, "walked to {to:?}");
        now
    }

    fn beside(map: &MapFile, o: (u16, u16)) -> TilePos {
        map.grid().nearest_walkable(o, 1).unwrap()
    }

    fn got(c: &Client, kind: u8) -> usize {
        c.log
            .iter()
            .filter(|m| matches!(m, ServerMsg::LabEvent { kind: k, .. } if *k == kind))
            .count()
    }

    #[test]
    fn the_heart_opens_only_once_youre_attuned_to_all_three_heartstones() {
        let day = 20_400;
        let (map, mut inst) = calm(day);
        let mut c = connect(&mut inst, 1, "a", (20, 12));
        inst.flush();
        c.pump();
        assert!(c.log.iter().any(|m| matches!(
            m,
            ServerMsg::LabState {
                found: 0,
                attuned: 0,
                out: false,
                ..
            }
        )));
        let great = map
            .objects
            .iter()
            .find(|o| {
                o.kind == "lab_gate" && o.label.as_deref().is_some_and(|l| l.ends_with(":great"))
            })
            .unwrap();
        let outside = (great.x, great.y + 1);
        let g = map
            .objects
            .iter()
            .filter(|o| o.kind == "lab_gate")
            .position(|o| std::ptr::eq(o, great))
            .unwrap() as u16;
        let great_opened = |c: &Client| {
            c.log
                .iter()
                .filter(
                    |m| matches!(m, ServerMsg::LabEvent { kind: lab::GATE_OPEN, n, .. } if *n == g),
                )
                .count()
        };
        let mut now = inst.clock.now_ms();
        // Not attuned: the gate stays shut.
        now = walk(&mut inst, &mut c, now, 1, outside);
        assert_eq!(great_opened(&c), 0);
        for h in map.objects.iter().filter(|o| o.kind == "lab_heartstone") {
            now = walk(&mut inst, &mut c, now, 1, beside(&map, (h.x, h.y)));
        }
        assert_eq!(got(&c, lab::ATTUNED), 3);
        assert!(got(&c, lab::LIT) > 0, "lanterns lit on the way");
        now = walk(&mut inst, &mut c, now, 1, outside);
        assert_eq!(great_opened(&c), 1);
        let heart = map.objects.iter().find(|o| o.kind == "lab_heart").unwrap();
        walk(&mut inst, &mut c, now, 1, (heart.x, heart.y));
        assert!(c.log.iter().any(|m| matches!(
            m,
            ServerMsg::LabEvent {
                kind: lab::OUT,
                id: 1,
                n: 1
            }
        )));
    }

    #[test]
    fn a_timed_gate_opens_from_its_stone_and_shuts_again() {
        let (map, mut inst) = calm(20_401);
        let mut c = connect(&mut inst, 1, "a", (20, 12));
        let (g, gate) = map
            .objects
            .iter()
            .filter(|o| o.kind == "lab_gate")
            .enumerate()
            .find(|(_, o)| o.label.as_deref().is_some_and(|l| l.ends_with(":timed")))
            .expect("a timed gate");
        let stone = map
            .objects
            .iter()
            .find(|o| o.kind == "lab_stone" && o.label.as_deref() == Some(g.to_string().as_str()))
            .unwrap();
        let this = |c: &Client, kind: u8| {
            c.log
                .iter()
                .filter(|m| matches!(m, ServerMsg::LabEvent { kind: k, n, .. } if *k == kind && *n as usize == g))
                .count()
        };
        assert!(!inst.grid.walkable(gate.x, gate.y));
        let start = inst.clock.now_ms();
        let mut now = walk(&mut inst, &mut c, start, 1, (stone.x, stone.y));
        assert_eq!(this(&c, lab::GATE_OPEN), 1);
        assert!(inst.grid.walkable(gate.x, gate.y));
        // Left alone, it shuts.
        for _ in 0..100 {
            now += 100;
            inst.lab_tick(now);
        }
        inst.flush();
        c.pump();
        assert_eq!(this(&c, lab::GATE_SHUT), 1);
        assert!(!inst.grid.walkable(gate.x, gate.y));
    }

    #[test]
    fn a_wisp_blows_you_back_to_your_last_lantern() {
        let day = 20_402;
        let map = labyrinth::generate(day);
        let zone = Arc::new(ZoneDef::new(labyrinth::ZONE.into(), map.clone(), None));
        let mut inst = Instance::new(zone, 1, Some(labyrinth::day_key(day)), None, None);
        let mut c = connect(&mut inst, 1, "a", (20, 12));
        let w = map
            .objects
            .iter()
            .find(|o| o.kind == "lab_wisp")
            .unwrap()
            .clone();
        // Stand right where the wisp will be.
        let now = inst.clock.now_ms();
        let (x, y) = labyrinth::wisp_at(&w, now + 100);
        let at = (x.round() as u16, y.round() as u16);
        inst.avatars.get_mut(&1).unwrap().tile = at;
        inst.lab_tick(now + 100);
        inst.flush();
        c.pump();
        assert_eq!(got(&c, lab::CAUGHT), 1);
        assert_eq!(
            inst.avatars[&1].tile,
            (map.spawn.x, map.spawn.y),
            "no lantern yet: back at the stair"
        );
    }
}
