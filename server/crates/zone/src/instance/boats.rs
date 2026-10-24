//! The Lake's rowboats: hire one at the boat hire by the pier (coins, for a
//! while), invite up to `boat::SEATS` people aboard (`together::BOAT`, offered
//! and accepted like a hug), and row them round the lake.
//!
//! The captain rows over the water only (`Lake::water`, the lake's own grid:
//! its water tiles, nothing else); everyone aboard gets the captain's very
//! walk, so the boat moves as one. Anyone can get out where the boat is near
//! a bank (the captain takes everyone ashore; a passenger hops off), and when
//! the hire is up, everyone's set down on the pier.
//!
//! Others see the boat through `EntityInfo.vehicle` (`boat::CAPTAIN` under
//! the captain, `boat::PASSENGER + seat` on each passenger); the people
//! aboard get `BoatState`.

use super::{Instance, MAX_PATH_EXPANSIONS, MOVE_LEAD_MS, OUTDOORS};
use crate::econ::CallError;
use commons_protocol::{ServerMsg, Tile, boat, error_code, state, together};
use commons_sim::map::MapFile;
use commons_sim::{Grid, Motion, TilePos, compress, route, vehicles};

/// Coin's item id.
const COIN: u32 = 1;
/// How near the pier you hire a boat (the hut is a few steps up the bank).
const HIRE_RANGE: i32 = 8;
/// How near the boat someone must be to climb aboard.
pub(super) const BOARD_RANGE: i32 = 4;
/// How far from the boat a bank may be to get out onto it.
const ASHORE_RANGE: u16 = 2;
/// Clicking on land from the boat rows to the water this close to it.
const NEAR_WATER: u16 = 4;

/// The lake boats go on, where the map has one: its water, where boats set
/// out from (`launch`, on the water by the pier) and where people are set
/// down when the hire's up (`dock`, on the pier).
pub(super) struct Lake {
    water: Grid,
    launch: TilePos,
    dock: TilePos,
}

impl Lake {
    /// From the map's `boat_lake` marker (the lake's bounds) and its
    /// `boat_launch` and `boat_dock` spots.
    pub(super) fn from_map(map: &MapFile) -> Option<Lake> {
        let area = map.objects.iter().find(|o| o.kind == "boat_lake")?;
        let spot = |key: &str| {
            map.objects
                .iter()
                .find(|o| o.kind == "spot" && o.label.as_deref() == Some(key))
                .map(|o| (o.x, o.y))
        };
        let water_kind = map.ground_legend.iter().position(|g| g == "water")? as u8;
        let mut water = Grid::open(map.width, map.height);
        for y in 0..map.height {
            for x in 0..map.width {
                let inside = (area.x..area.x + area.w).contains(&x)
                    && (area.y..area.y + area.h).contains(&y);
                let wet = map.ground[y as usize * map.width as usize + x as usize] == water_kind;
                water.set_blocked(x, y, !(inside && wet));
            }
        }
        let launch = spot("boat_launch")?;
        if !water.walkable(launch.0, launch.1) {
            return None;
        }
        Some(Lake {
            water,
            launch,
            dock: spot("boat_dock")?,
        })
    }
}

/// A boat out on the lake: who rows it, who's aboard, till when.
pub(super) struct Boat {
    pub(super) captain: u32,
    pub(super) seats: Vec<u32>,
    pub(super) until: u32,
}

/// The open tile of `grid` nearest `p` within `radius` (fewest steps, then
/// straightest, then top-left first); the client's `nearestWater` mirrors it.
pub(super) fn nearest(grid: &Grid, p: TilePos, radius: u16) -> Option<TilePos> {
    let r = radius as i32;
    let mut best: Option<((i32, i32, i32, i32), TilePos)> = None;
    for dy in -r..=r {
        for dx in -r..=r {
            let (x, y) = (p.0 as i32 + dx, p.1 as i32 + dy);
            if !grid.walkable_i(x, y) {
                continue;
            }
            let key = (dx.abs().max(dy.abs()), dx.abs() + dy.abs(), dy, dx);
            if best.is_none_or(|(k, _)| key < k) {
                best = Some((key, (x as u16, y as u16)));
            }
        }
    }
    best.map(|(_, t)| t)
}

fn cheb(a: TilePos, b: TilePos) -> i32 {
    (a.0 as i32 - b.0 as i32)
        .abs()
        .max((a.1 as i32 - b.1 as i32).abs())
}

impl Instance {
    /// The boat `id` is in (as captain or passenger), by index.
    pub(super) fn boat_of(&self, id: u32) -> Option<usize> {
        self.boats
            .iter()
            .position(|b| b.captain == id || b.seats.contains(&id))
    }

    pub(super) fn aboard(&self, id: u32) -> bool {
        self.boat_of(id).is_some()
    }

    pub(super) fn is_captain(&self, id: u32) -> bool {
        self.boats.iter().any(|b| b.captain == id)
    }

    /// What `id` should be seen riding, ashore: their own wheels outdoors.
    fn wheels(&self, id: u32) -> u8 {
        let a = &self.avatars[&id];
        let test = a.ride & vehicles::TEST_RIDE != 0;
        match vehicles::speed_x10(a.ride) {
            Some(_) if (self.zone.id == OUTDOORS) != test => a.ride & !vehicles::TEST_RIDE,
            _ => 0,
        }
    }

    fn set_vehicle(&mut self, id: u32, vehicle: u8) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if a.vehicle != vehicle {
            a.vehicle = vehicle;
            self.look_changed(id);
        }
    }

    /// Tells everyone aboard boat `b` how it stands, and shows who sits where.
    fn boat_changed(&mut self, b: usize) {
        let (captain, until, seats) = {
            let boat = &self.boats[b];
            (boat.captain, boat.until, boat.seats.clone())
        };
        self.set_vehicle(captain, boat::CAPTAIN);
        for (i, &p) in seats.iter().enumerate() {
            self.set_vehicle(p, boat::PASSENGER + i as u8);
        }
        let msg = ServerMsg::BoatState {
            captain,
            until,
            seats: seats.clone(),
        };
        for p in std::iter::once(captain).chain(seats) {
            self.send_to(p, &msg);
        }
    }

    /// Puts `id` on tile `t` at once: walking stopped, everyone shown.
    fn boat_place(&mut self, id: u32, t: TilePos, now: u32) {
        match self.avatars.get(&id).map(|a| a.state) {
            None => return,
            Some(state::SITTING) => self.stand(id, now),
            Some(state::FISHING) => self.stop_fishing(id, false),
            _ => {}
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

    /// Land tiles round `at` (nearest first) for `n` people, none shared.
    fn landing(&self, at: TilePos, radius: u16, n: usize) -> Option<Vec<TilePos>> {
        let mut out: Vec<TilePos> = Vec::with_capacity(n);
        let r = radius as i32;
        let mut ring: Vec<(i32, TilePos)> = Vec::new();
        for dy in -r..=r {
            for dx in -r..=r {
                let (x, y) = (at.0 as i32 + dx, at.1 as i32 + dy);
                if self.grid.walkable_i(x, y) {
                    ring.push((
                        dx.abs().max(dy.abs()) * 10 + dx.abs() + dy.abs(),
                        (x as u16, y as u16),
                    ));
                }
            }
        }
        ring.sort();
        for (_, t) in ring {
            if out.len() == n {
                break;
            }
            out.push(t);
        }
        (out.len() == n).then_some(out)
    }

    /// `Boat { op }`: hire one, or get out.
    pub(super) fn boat_op(&mut self, id: u32, op: u8, now: u32) {
        match op {
            boat::RENT => self.hire(id, now),
            boat::ASHORE => self.ashore(id, now),
            _ => {}
        }
    }

    fn hire(&mut self, id: u32, now: u32) {
        let Some(lake) = self.lake.as_ref() else {
            return self.error(id, error_code::NOT_ALLOWED, "there are no boats here");
        };
        let dock = lake.dock;
        if self.aboard(id) {
            return self.error(id, error_code::NOT_ALLOWED, "you're already in a boat");
        }
        if cheb(self.avatars[&id].tile, dock) > HIRE_RANGE {
            return self.error(id, error_code::TOO_FAR, "boats are hired by the pier");
        }
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.emote_rl.try_take(now as u64) {
            return;
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(
                id,
                error_code::UNAVAILABLE,
                "the boat hire's closed just now",
            );
        };
        let player = self.avatars[&id].player_id.clone();
        let key = self.next_key("boat");
        self.spawn_call(
            async move {
                econ.grant(&player, COIN, -boat::PRICE, "boat_hire", &key)
                    .await
            },
            move |inst, result| match result {
                Ok(applied) if inst.avatars.contains_key(&id) => {
                    inst.send_granted(id, &applied);
                    inst.launch(id);
                }
                Ok(_) => {}
                Err(CallError::Rejected(_)) => inst.error(
                    id,
                    error_code::NOT_ALLOWED,
                    "a boat's 10 coins: not enough just now",
                ),
                Err(CallError::Unavailable) => inst.error(
                    id,
                    error_code::UNAVAILABLE,
                    "the boat hire's till is stuck; try again",
                ),
            },
        );
    }

    /// Paid for: into a boat at the launch, captain.
    pub(super) fn launch(&mut self, id: u32) {
        let Some(launch) = self.lake.as_ref().map(|l| l.launch) else {
            return;
        };
        if self.aboard(id) {
            return;
        }
        let now = self.clock.now_ms();
        // Whoever this was following, they row their own way now.
        self.follows.remove(&id);
        self.leave_seat(id);
        self.stop_fishing(id, false);
        self.boat_place(id, launch, now);
        self.boats.push(Boat {
            captain: id,
            seats: Vec::new(),
            until: now + boat::HIRE_MS,
        });
        let b = self.boats.len() - 1;
        self.boat_changed(b);
    }

    /// `id` accepted `captain`'s invitation: into the next free seat.
    pub(super) fn board(&mut self, captain: u32, id: u32, now: u32) {
        let Some(b) = self.boats.iter().position(|b| b.captain == captain) else {
            return self.error(id, error_code::NOT_ALLOWED, "that boat's gone back");
        };
        if self.aboard(id) {
            return self.error(id, error_code::NOT_ALLOWED, "you're in a boat already");
        }
        if self.boats[b].seats.len() >= boat::SEATS {
            return self.error(id, error_code::NOT_ALLOWED, "the boat's full");
        }
        self.follows.remove(&id);
        self.leave_seat(id);
        self.stop_fishing(id, false);
        // In beside the captain, and from now on wherever the boat goes.
        let at = self.avatars[&captain].tile;
        self.boat_place(id, at, now);
        let m = self.avatars[&captain].motion.clone();
        if let Some(m) = m.filter(|m| !m.is_done(now)) {
            self.ride_along(id, &m);
        }
        self.boats[b].seats.push(id);
        self.boat_changed(b);
        let cell = self.avatars[&captain].cell;
        self.broadcast(
            cell,
            &ServerMsg::Together {
                a: id,
                b: captain,
                kind: together::BOAT,
            },
            None,
        );
    }

    /// Passenger `id` moves with the boat: the captain's walk, as theirs.
    fn ride_along(&mut self, id: u32, m: &Motion) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        a.motion = Some(m.clone());
        let cell = a.cell;
        let msg = ServerMsg::MoveStart {
            id,
            speed_x10: m.speed_x10,
            t0: m.t0,
            sprint_in: m.sprint_in,
            path: m.path.iter().map(|&(x, y)| Tile { x, y }).collect(),
        };
        self.broadcast(cell, &msg, None);
    }

    /// The captain rows toward `target` (or the water nearest it), and
    /// everyone aboard goes too. Passengers can't steer.
    pub(super) fn row_to(&mut self, id: u32, target: TilePos, now: u32) {
        let Some(b) = self.boats.iter().position(|b| b.captain == id) else {
            return self.error(id, error_code::NOT_ALLOWED, "the captain does the rowing");
        };
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.move_rl.try_take(now as u64) {
            return;
        }
        let Some(lake) = self.lake.as_ref() else {
            return;
        };
        let Some(target) = nearest(&lake.water, target, NEAR_WATER) else {
            return self.error(
                id,
                error_code::NO_PATH,
                "row to the water's edge, then go ashore",
            );
        };
        let a = &self.avatars[&id];
        let (prefix, start, t0) = match a.motion.as_ref().and_then(|m| m.splice(now)) {
            Some((prev, next, t_prev)) => (Some(prev), next, t_prev),
            None => {
                let from = match &a.motion {
                    Some(m) if !m.is_done(now) => m.path[0],
                    _ => a.tile,
                };
                (None, from, now + MOVE_LEAD_MS)
            }
        };
        let Some(mut full) = route(&lake.water, start, target, MAX_PATH_EXPANSIONS) else {
            return self.error(id, error_code::NO_PATH, "can't row there");
        };
        if let Some(prev) = prefix {
            full.insert(0, prev);
        }
        if full.len() < 2 {
            return;
        }
        let motion = Motion {
            path: compress(&full),
            t0,
            speed_x10: boat::SPEED_X10,
            sprint_in: 0,
        };
        for p in std::iter::once(id).chain(self.boats[b].seats.clone()) {
            self.ride_along(p, &motion);
        }
    }

    /// Out of the boat: a passenger hops off; the captain takes everyone
    /// ashore (and the boat goes back). Only where there's a bank close by.
    pub(super) fn ashore(&mut self, id: u32, now: u32) {
        let Some(b) = self.boat_of(id) else {
            return;
        };
        let at = self.avatars[&id].tile;
        if self.boats[b].captain == id {
            let all: Vec<u32> = std::iter::once(id)
                .chain(self.boats[b].seats.clone())
                .collect();
            let Some(spots) = self.landing(at, ASHORE_RANGE, all.len()) else {
                return self.error(id, error_code::TOO_FAR, "row up to the bank first");
            };
            self.end_boat(b, Some(spots), now);
        } else {
            let Some(spot) = self.landing(at, ASHORE_RANGE, 1) else {
                return self.error(id, error_code::TOO_FAR, "wait till the boat's by the bank");
            };
            self.boats[b].seats.retain(|&p| p != id);
            self.boat_place(id, spot[0], now);
            let wheels = self.wheels(id);
            self.set_vehicle(id, wheels);
            self.send_to(
                id,
                &ServerMsg::BoatState {
                    captain: 0,
                    until: 0,
                    seats: vec![],
                },
            );
            self.boat_changed(b);
        }
    }

    /// The boat goes back: everyone set down on `spots` (by the boat), or on
    /// the pier.
    fn end_boat(&mut self, b: usize, spots: Option<Vec<TilePos>>, now: u32) {
        let boat = self.boats.remove(b);
        let all: Vec<u32> = std::iter::once(boat.captain)
            .chain(boat.seats)
            .filter(|p| self.avatars.contains_key(p))
            .collect();
        let spots = spots.or_else(|| {
            let dock = self.lake.as_ref()?.dock;
            self.landing(dock, 3, all.len())
        });
        for (i, &p) in all.iter().enumerate() {
            if let Some(t) = spots.as_ref().and_then(|s| s.get(i)) {
                self.boat_place(p, *t, now);
            }
            let wheels = self.wheels(p);
            self.set_vehicle(p, wheels);
            self.send_to(
                p,
                &ServerMsg::BoatState {
                    captain: 0,
                    until: 0,
                    seats: vec![],
                },
            );
        }
    }

    /// Someone's leaving the zone: out of their boat first (a captain's
    /// passengers are set down by the boat if they can be, else on the pier).
    pub(super) fn boat_leave(&mut self, id: u32, now: u32) {
        let Some(b) = self.boat_of(id) else {
            return;
        };
        if self.boats[b].captain == id {
            let n = self.boats[b].seats.len();
            let at = self.avatars[&id].tile;
            let spots = self.landing(at, ASHORE_RANGE, n + 1);
            self.end_boat(b, spots, now);
        } else {
            self.boats[b].seats.retain(|&p| p != id);
            self.boat_changed(b);
        }
    }

    /// The hire's up: back to the pier.
    pub(super) fn boat_tick(&mut self, now: u32) {
        while let Some(b) = self.boats.iter().position(|b| now >= b.until) {
            self.end_boat(b, None, now);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::tests::*;
    use crate::instance::*;
    use commons_protocol::{ClientMsg, boat, together};
    use commons_sim::map::{MapFile, MapObject};

    /// A shore on the left, a pond of water on the right with its bounds
    /// marked, the launch on the water by the dock.
    fn lake_map() -> MapFile {
        let mut m = map(30, 12);
        m.ground_legend = vec!["grass".into(), "water".into()];
        for y in 0..12u16 {
            for x in 10..30u16 {
                let i = y as usize * 30 + x as usize;
                m.ground[i] = 1;
                m.collision[i] = 1;
            }
        }
        let obj = |kind: &str, x, y, w, h, label: Option<&str>| MapObject {
            kind: kind.into(),
            x,
            y,
            w,
            h,
            label: label.map(Into::into),
        };
        m.objects.push(obj("boat_lake", 10, 0, 20, 12, None));
        m.objects
            .push(obj("spot", 10, 5, 1, 1, Some("boat_launch")));
        m.objects.push(obj("spot", 9, 5, 1, 1, Some("boat_dock")));
        m
    }

    fn lake_instance() -> Instance {
        let inst = instance_for(Arc::new(ZoneDef::new("test".into(), lake_map(), None)));
        assert!(inst.lake.is_some(), "the lake's found");
        inst
    }

    /// Joins `name` on connection `conn` at `at`; their avatar's id.
    fn join(inst: &mut Instance, conn: ConnId, name: &str, at: TilePos) -> (u32, Client) {
        let c = connect(inst, conn, name, (20, 12));
        let id = inst.by_conn[&conn];
        place(inst, id, at);
        (id, c)
    }

    fn send(inst: &mut Instance, conn: ConnId, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn invite(inst: &mut Instance, (cap, cap_conn): (u32, ConnId), (id, conn): (u32, ConnId)) {
        send(
            inst,
            cap_conn,
            ClientMsg::Offer {
                to: id,
                kind: together::BOAT,
            },
        );
        send(
            inst,
            conn,
            ClientMsg::Accept {
                from: cap,
                kind: together::BOAT,
            },
        );
    }

    #[test]
    fn a_captain_rows_three_friends_round_the_lake_and_brings_them_ashore() {
        let mut inst = lake_instance();
        let (cap, mut cc) = join(&mut inst, 1, "Cap", (8, 5));
        let mut keep = vec![];
        let friends: Vec<(u32, ConnId)> = (0..4u64)
            .map(|i| {
                let (id, c) = join(&mut inst, 10 + i, &format!("F{i}"), (8, 3 + i as u16));
                keep.push(c);
                (id, 10 + i)
            })
            .collect();
        // Paid for (the economy's tested elsewhere): a boat at the launch.
        inst.launch(cap);
        assert_eq!(inst.avatars[&cap].tile, (10, 5));
        assert_eq!(inst.avatars[&cap].vehicle, boat::CAPTAIN);
        inst.flush();
        cc.pump();
        assert!(
            cc.log
                .iter()
                .any(|m| matches!(m, ServerMsg::BoatState { captain, .. } if *captain == cap))
        );
        // Three friends climb aboard; a fourth doesn't fit.
        for (i, &f) in friends.iter().enumerate() {
            invite(&mut inst, (cap, 1), f);
            let a = &inst.avatars[&f.0];
            if i < 3 {
                assert_eq!(
                    (a.tile, a.vehicle),
                    ((10, 5), boat::PASSENGER + i as u8),
                    "seat {i}"
                );
            } else {
                assert_eq!(a.vehicle, 0, "full");
            }
        }
        // Passengers can't steer; the captain rows, and the boat goes as one.
        let (f0, f0c) = friends[0];
        send(
            &mut inst,
            f0c,
            ClientMsg::MoveTo {
                x: 20,
                y: 5,
                sprint: false,
            },
        );
        assert!(inst.avatars[&f0].motion.is_none());
        send(
            &mut inst,
            1,
            ClientMsg::MoveTo {
                x: 25,
                y: 8,
                sprint: false,
            },
        );
        let m = inst.avatars[&cap].motion.clone().expect("rowing");
        assert_eq!(m.speed_x10, boat::SPEED_X10);
        assert_eq!(m.path.last().copied(), Some((25, 8)));
        for f in &friends[..3] {
            assert_eq!(
                inst.avatars[&f.0].motion.as_ref().map(|x| x.path.clone()),
                Some(m.path.clone())
            );
        }
        inst.step(m.t0 + 60_000);
        for f in &friends[..3] {
            assert_eq!(inst.avatars[&f.0].tile, (25, 8));
        }
        // Out in the middle: no bank to get out onto.
        send(&mut inst, 1, ClientMsg::Boat { op: boat::ASHORE });
        assert!(inst.aboard(cap));
        // Clicking on the grass rows to the water by it; there everyone steps
        // out onto the grass, a tile each, and the boat goes back.
        send(
            &mut inst,
            1,
            ClientMsg::MoveTo {
                x: 7,
                y: 5,
                sprint: false,
            },
        );
        let m = inst.avatars[&cap].motion.clone().unwrap();
        assert_eq!(
            m.path.last().copied(),
            Some((10, 5)),
            "the water nearest the grass"
        );
        inst.step(m.t0 + 60_000);
        send(&mut inst, 1, ClientMsg::Boat { op: boat::ASHORE });
        assert!(inst.boats.is_empty());
        let mut tiles = std::collections::HashSet::new();
        for id in std::iter::once(cap).chain(friends[..3].iter().map(|f| f.0)) {
            let a = &inst.avatars[&id];
            assert!(a.tile.0 < 10, "ashore: {:?}", a.tile);
            assert_eq!(a.vehicle, 0);
            assert!(tiles.insert(a.tile), "a tile each");
        }
    }

    #[test]
    fn a_passenger_hops_off_by_the_bank_and_the_hire_runs_out_on_the_pier() {
        let mut inst = lake_instance();
        let (cap, _cc) = join(&mut inst, 1, "Cap", (8, 5));
        let (f, _fc) = join(&mut inst, 2, "F", (2, 6));
        inst.launch(cap);
        // Too far to climb aboard from up the bank.
        invite(&mut inst, (cap, 1), (f, 2));
        assert!(!inst.aboard(f));
        place(&mut inst, f, (8, 6));
        invite(&mut inst, (cap, 1), (f, 2));
        assert!(inst.aboard(f));
        // Still by the bank: the passenger hops off; the captain rows on alone.
        send(&mut inst, 2, ClientMsg::Boat { op: boat::ASHORE });
        assert!(!inst.aboard(f) && inst.aboard(cap));
        assert!(inst.avatars[&f].tile.0 < 10);
        // Out on the lake when the hire runs out: set down on the pier.
        send(
            &mut inst,
            1,
            ClientMsg::MoveTo {
                x: 20,
                y: 5,
                sprint: false,
            },
        );
        let t = inst.avatars[&cap].motion.as_ref().unwrap().t0 + 60_000;
        inst.step(t);
        let until = inst.boats[0].until;
        inst.boat_tick(until);
        assert!(inst.boats.is_empty());
        let a = &inst.avatars[&cap];
        assert!(a.tile.0 < 10 && a.tile.0 >= 6, "on the pier: {:?}", a.tile);
        assert_eq!(a.vehicle, 0);
        // A captain who leaves sets their passengers down too.
        inst.launch(cap);
        place(&mut inst, f, (8, 6));
        invite(&mut inst, (cap, 1), (f, 2));
        assert!(inst.aboard(f));
        inst.handle(Cmd::Leave { conn: 1 });
        assert!(!inst.aboard(f));
        assert!(inst.avatars[&f].tile.0 < 10);
    }
}
