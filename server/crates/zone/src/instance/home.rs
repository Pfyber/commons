//! Homes (spec §8.2): a private instance of the `home` zone per player, where
//! the owner places and picks up furniture. Placements persist through the
//! economy service (which moves the item out of / back into the inventory)
//! and block movement like any other prop. A club's room (`clubroom`, one
//! instance per club, ADR 0014) works the same way for all its members: the
//! economy service checks they're members and gives each piece back to
//! whoever placed it.

use super::Instance;
use crate::econ::CallError;
use commons_protocol::{ServerMsg, error_code};
use commons_sim::TilePos;

/// How often the city looks over its front yards again.
const YARD_TICK_MS: u32 = 60_000;

/// The zone whose instances are club rooms, owned by a club.
pub(crate) const CLUB_ROOM: &str = "clubroom";

impl Instance {
    fn is_club_room(&self) -> bool {
        self.zone.id == CLUB_ROOM
    }

    pub(super) fn load_home(&self) {
        // (Only homes and club rooms keep furniture; other zones' owners are something else, a labyrinth's day.)
        if self.is_city() {
            return self.load_yards();
        }
        if self.zone.id != "home" && !self.is_club_room() {
            return;
        }
        let (Some(econ), Some(owner)) = (self.economy.clone(), self.owner.clone()) else {
            return;
        };
        let club = self.is_club_room();
        self.spawn_call(
            async move {
                loop {
                    let r = if club {
                        econ.club_objects(&owner).await
                    } else {
                        econ.home_objects(&owner).await
                    };
                    match r {
                        Err(CallError::Unavailable) => {
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await
                        }
                        other => return other,
                    }
                }
            },
            |inst, result| match result {
                Ok(objects) => {
                    for o in objects {
                        inst.show_object(&o);
                    }
                }
                Err(e) => tracing::error!(?e, "loading home failed"),
            },
        );
    }

    fn is_city(&self) -> bool {
        self.zone.id == "city"
    }

    /// A saved piece, put where it was left.
    fn show_object(&mut self, o: &crate::econ::HomeObject) {
        let (t, item, rot) = ((o.x as u16, o.y as u16), o.item as u32, o.rot as u8);
        if o.layer == 1 {
            self.set_top(t, item, rot);
        } else {
            self.set_object(t, item, rot);
        }
        if o.fed > 0 {
            self.fed.insert(t, o.fed as u32);
        }
        if !o.fish.is_empty() {
            self.set_tank(t, o.fish.iter().map(|&f| f as u32).collect());
            // (Anyone here already hears when they last ate.)
            self.broadcast(
                self.cell_of(t),
                &ServerMsg::TankFed {
                    x: t.0,
                    y: t.1,
                    fed: o.fed as u32,
                },
                None,
            );
        }
    }

    /// The city's front yards, as saved. Asked again now and then: moving
    /// out empties a yard without the zone being told.
    fn load_yards(&self) {
        let Some(econ) = self.economy.clone() else {
            return;
        };
        self.spawn_call(
            async move { econ.yard_objects().await },
            |inst, r| match r {
                Ok(objects) => {
                    let keep: std::collections::HashSet<TilePos> =
                        objects.iter().map(|o| (o.x as u16, o.y as u16)).collect();
                    let gone: Vec<TilePos> = inst
                        .objects
                        .keys()
                        .filter(|t| !keep.contains(*t) && !inst.portable.contains_key(*t))
                        .copied()
                        .collect();
                    for t in gone {
                        inst.set_top(t, 0, 0);
                        inst.set_object(t, 0, 0);
                    }
                    for o in &objects {
                        let t = (o.x as u16, o.y as u16);
                        let shown = if o.layer == 1 {
                            inst.tops.get(&t)
                        } else {
                            inst.objects.get(&t)
                        };
                        if shown != Some(&(o.item as u32)) {
                            inst.show_object(o);
                        }
                    }
                }
                Err(e) => tracing::warn!(?e, "loading yards failed"),
            },
        );
    }

    pub(super) fn yard_tick(&mut self, now: u32) {
        if now >= self.next_yard_tick && self.is_city() {
            self.next_yard_tick = now + YARD_TICK_MS;
            self.load_yards();
        }
    }

    /// The lot whose front yard `t` is in, unless it's the path to the door.
    fn yard_at(&self, t: TilePos) -> Option<String> {
        let m = &self.zone.map;
        let ground = m.ground[t.1 as usize * m.width as usize + t.0 as usize] as usize;
        if m.ground_legend.get(ground).is_some_and(|g| g == "path") {
            return None;
        }
        m.objects
            .iter()
            .find(|o| {
                o.kind == "yard"
                    && (o.x..o.x + o.w).contains(&t.0)
                    && (o.y..o.y + o.h).contains(&t.1)
            })
            .and_then(|o| o.label.clone())
    }

    /// Where seat `seat` is: one the map has, or a chair or sofa placed at
    /// that tile (seat ids are tile indices).
    pub(super) fn seat_tile(&self, seat: u32) -> Option<TilePos> {
        if let Some(s) = self.zone.furniture.seats.get(&seat) {
            return Some(s.tile);
        }
        let w = self.zone.map.width as u32;
        let t = ((seat % w) as u16, (seat / w) as u16);
        let item = self.objects.get(&t)?;
        let catalog = self.economy.as_ref()?.catalog()?;
        catalog.seats.contains(item).then_some(t)
    }

    /// A garden pond's tiles, from its top left.
    fn pond_tiles(t: TilePos) -> [TilePos; 4] {
        [t, (t.0 + 1, t.1), (t.0, t.1 + 1), (t.0 + 1, t.1 + 1)]
    }

    /// Whether a pond fits at `t`, all of it in one yard.
    fn pond_fits(&self, t: TilePos, lot: &str) -> bool {
        Self::pond_tiles(t).iter().all(|&p| {
            p.0 < self.zone.map.width
                && p.1 < self.zone.map.height
                && self.grid.walkable(p.0, p.1)
                && !self.objects.contains_key(&p)
                && !self.avatars.values().any(|a| a.tile == p)
                && self.yard_at(p).as_deref() == Some(lot)
        })
    }

    /// Whether a UV light hangs just above `t`.
    fn uv_over(&self, t: TilePos) -> bool {
        let Some(c) = self.economy.as_ref().and_then(|e| e.catalog()) else {
            return false;
        };
        let above = (t.0, t.1.wrapping_sub(1));
        [self.objects.get(&above), self.tops.get(&above)]
            .into_iter()
            .flatten()
            .any(|i| c.uv.contains(i))
    }

    /// A UV light came or went at `t`: the plant under it notices.
    fn refresh_uv(&mut self, t: TilePos) {
        let below = (t.0, t.1 + 1);
        let uv = self.uv_over(below);
        if let Some(p) = self.plots.get_mut(&below)
            && p.uv != uv
        {
            p.uv = uv;
            self.broadcast_plot(below);
        }
    }

    /// Adds (item > 0) or removes (item = 0) furniture and tells watchers.
    fn set_object(&mut self, t: TilePos, item: u32, rot: u8) {
        let cat = self.economy.as_ref().and_then(|e| e.catalog());
        let planter = cat.as_ref().is_some_and(|c| c.planters.contains(&item));
        let walk_on = cat.as_ref().is_some_and(|c| c.walk.contains(&item));
        let pond = cat.as_ref().is_some_and(|c| c.ponds.contains(&item));
        let was_pond = cat
            .as_ref()
            .zip(self.objects.get(&t))
            .is_some_and(|(c, old)| c.ponds.contains(old));
        if was_pond && item == 0 {
            for p in Self::pond_tiles(t) {
                self.pond_water.remove(&p);
                self.grid.set_blocked(
                    p.0,
                    p.1,
                    self.zone.grid.blocked[self.zone.grid.idx(p.0, p.1)],
                );
            }
        }
        if pond {
            for p in Self::pond_tiles(t) {
                self.pond_water.insert(p);
                self.grid.set_blocked(p.0, p.1, true);
            }
        }
        if item == 0 {
            // Whoever's sitting on it gets up first.
            let seat = t.1 as u32 * self.zone.map.width as u32 + t.0 as u32;
            if let Some(&who) = self.seat_occupant.get(&seat) {
                let now = self.clock.now_ms();
                self.stand(who, now);
            }
            self.objects.remove(&t);
            self.rots.remove(&(t, 0));
            if !self.tops.contains_key(&t) {
                self.lit.remove(&t);
                self.tanks.remove(&t);
                self.fed.remove(&t);
            }
            if self.zone.id == "home" {
                self.soil.remove(&t);
            }
            self.grid.set_blocked(
                t.0,
                t.1,
                self.zone.grid.blocked[self.zone.grid.idx(t.0, t.1)],
            );
        } else {
            self.objects.insert(t, item);
            self.rots.insert((t, 0), rot);
            // (Rugs are walked over.)
            self.grid.set_blocked(t.0, t.1, !walk_on);
            if planter && self.zone.id == "home" {
                self.soil.insert(t);
            }
        }
        self.broadcast(
            self.cell_of(t),
            &ServerMsg::ObjectUpdate {
                x: t.0,
                y: t.1,
                item,
                rot,
            },
            None,
        );
        self.refresh_uv(t);
    }

    pub(super) fn objects_in_cell(&self, cell: u16) -> Vec<ServerMsg> {
        let mut out: Vec<ServerMsg> = self
            .objects
            .iter()
            .filter(|(t, _)| self.cell_of(**t) == cell)
            .map(|(t, item)| ServerMsg::ObjectUpdate {
                x: t.0,
                y: t.1,
                item: *item,
                rot: self.rots.get(&(*t, 0)).copied().unwrap_or(0),
            })
            .collect();
        // What's on the tables, what's on, and what swims in the tanks.
        for (t, item) in self.tops.iter().filter(|(t, _)| self.cell_of(**t) == cell) {
            out.push(ServerMsg::ObjectTop {
                x: t.0,
                y: t.1,
                item: *item,
                rot: self.rots.get(&(*t, 1)).copied().unwrap_or(0),
            });
        }
        for t in self.lit.iter().filter(|t| self.cell_of(**t) == cell) {
            out.push(ServerMsg::ObjectOn {
                x: t.0,
                y: t.1,
                on: true,
            });
        }
        for (t, fish) in self.tanks.iter().filter(|(t, _)| self.cell_of(**t) == cell) {
            out.push(ServerMsg::TankFish {
                x: t.0,
                y: t.1,
                fish: fish.clone(),
            });
            if let Some(&fed) = self.fed.get(t) {
                out.push(ServerMsg::TankFed {
                    x: t.0,
                    y: t.1,
                    fed,
                });
            }
        }
        out
    }

    /// A win (or any tally) for the player behind avatar `id`, on the leaderboards.
    pub(super) fn count_stat(&mut self, id: u32, stat: &'static str) {
        let (Some(econ), Some(a)) = (self.economy.clone(), self.avatars.get(&id)) else {
            return;
        };
        let player = a.player_id.clone();
        self.spawn_call(
            async move { econ.stat_add(&player, stat, 1).await },
            |_, r| {
                if let Err(e) = r {
                    tracing::warn!(?e, "couldn't count a win");
                }
            },
        );
    }

    /// What stands on the table at `t` (0: taken off), told to whoever's watching.
    fn set_top(&mut self, t: TilePos, item: u32, rot: u8) {
        if item == 0 {
            self.tops.remove(&t);
            self.rots.remove(&(t, 1));
            self.lit.remove(&t);
            self.tanks.remove(&t);
            self.fed.remove(&t);
        } else {
            self.tops.insert(t, item);
            self.rots.insert((t, 1), rot);
        }
        self.broadcast(
            self.cell_of(t),
            &ServerMsg::ObjectTop {
                x: t.0,
                y: t.1,
                item,
                rot,
            },
            None,
        );
        self.refresh_uv(t);
    }

    /// The thing at `t` you'd use (what's on the table, else the table or whatever's there), and its layer.
    fn used_at(&self, t: TilePos) -> Option<(u32, u8)> {
        self.tops
            .get(&t)
            .map(|&i| (i, 1))
            .or_else(|| self.objects.get(&t).map(|&i| (i, 0)))
    }

    /// Whether `t` is a wall a picture can hang on: a wall (as built) with
    /// the home's floor on the side it faces: just below it, or turned side
    /// on (`rot` 1 or 3), to its right or left.
    fn wall_face(&self, t: TilePos, rot: u8) -> bool {
        let m = &self.zone.map;
        let front = match rot {
            1 => (t.0 + 1, t.1),
            3 => (t.0.wrapping_sub(1), t.1),
            _ => (t.0, t.1 + 1),
        };
        if front.1 >= m.height || front.0 >= m.width {
            return false;
        }
        let floor = m.ground[front.1 as usize * m.width as usize + front.0 as usize] as usize;
        self.zone.grid.blocked[self.zone.grid.idx(t.0, t.1)]
            && self.grid.walkable(front.0, front.1)
            && m.ground_legend.get(floor).is_some_and(|n| n == "floor")
    }

    /// A tank's fish now, told to whoever's watching.
    fn set_tank(&mut self, t: TilePos, fish: Vec<u32>) {
        self.broadcast(
            self.cell_of(t),
            &ServerMsg::TankFish {
                x: t.0,
                y: t.1,
                fish: fish.clone(),
            },
            None,
        );
        if fish.is_empty() {
            self.tanks.remove(&t);
            self.fed.remove(&t);
        } else {
            self.tanks.insert(t, fish);
        }
    }

    /// Anyone here turns a lamp (the TV, the fireplace…) on or off.
    pub(super) fn use_object(&mut self, id: u32, t: TilePos) {
        let Some((item, _)) = self.used_at(t) else {
            return;
        };
        let toggles = self
            .economy
            .as_ref()
            .and_then(|e| e.catalog())
            .is_some_and(|c| c.toggles.contains(&item));
        if !toggles
            || self.avatars[&id]
                .tile
                .0
                .abs_diff(t.0)
                .max(self.avatars[&id].tile.1.abs_diff(t.1))
                > 3
        {
            return;
        }
        let on = !self.lit.remove(&t);
        if on {
            self.lit.insert(t);
        }
        self.broadcast(
            self.cell_of(t),
            &ServerMsg::ObjectOn { x: t.0, y: t.1, on },
            None,
        );
    }

    /// The owner feeds a tank.
    pub(super) fn tank_feed(&mut self, id: u32, t: TilePos) {
        if !self.tanks.contains_key(&t) {
            return;
        }
        let Some(owner) = self.check_owner(id) else {
            return;
        };
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "try again in a moment");
        };
        if !self.busy.insert(t) {
            return;
        }
        let layer = self.used_at(t).map_or(0, |(_, l)| l);
        let key = self.next_key("feed");
        self.spawn_call(
            async move { econ.tank_feed(&owner, t.0, t.1, layer, &key).await },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(done) => {
                        inst.fed.insert(t, done.fed as u32);
                        inst.broadcast(
                            inst.cell_of(t),
                            &ServerMsg::TankFed {
                                x: t.0,
                                y: t.1,
                                fed: done.fed as u32,
                            },
                            None,
                        );
                        inst.send_granted(id, &done.applied);
                    }
                    Err(e) => inst.economy_error(id, e),
                }
            },
        );
    }

    /// The owner puts a fish from their bag in a tank.
    pub(super) fn tank_put(&mut self, id: u32, t: TilePos, fish: u32) {
        if self.zone.id != "home" {
            return self.error(id, error_code::NOT_ALLOWED, "keep fish in a tank at home");
        }
        let Some(owner) = self.check_owner(id) else {
            return;
        };
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "try again in a moment");
        };
        let (tank, layer) = self.used_at(t).unwrap_or((0, 0));
        let holds = econ
            .catalog()
            .and_then(|c| c.tanks.get(&tank).copied())
            .unwrap_or(0) as usize;
        if holds == 0 {
            return self.error(id, error_code::BAD_MESSAGE, "that isn't a fish tank");
        }
        if self.tanks.get(&t).map_or(0, |f| f.len()) >= holds {
            return self.error(id, error_code::NOT_ALLOWED, "it's full");
        }
        if !self.busy.insert(t) {
            return;
        }
        let key = self.next_key("tank");
        self.spawn_call(
            async move { econ.tank_put(&owner, t.0, t.1, layer, fish, &key).await },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(done) => {
                        inst.set_tank(t, done.fish.iter().map(|&f| f as u32).collect());
                        inst.send_granted(id, &done.applied);
                    }
                    Err(e) => inst.economy_error(id, e),
                }
            },
        );
    }

    /// The owner takes a fish out of a tank, back into their bag.
    pub(super) fn tank_take(&mut self, id: u32, t: TilePos, index: u8) {
        if !self.tanks.contains_key(&t) || self.zone.id != "home" {
            return;
        }
        let Some(owner) = self.check_owner(id) else {
            return;
        };
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "try again in a moment");
        };
        if !self.busy.insert(t) {
            return;
        }
        let layer = self.used_at(t).map_or(0, |(_, l)| l);
        let key = self.next_key("tank");
        self.spawn_call(
            async move { econ.tank_take(&owner, t.0, t.1, layer, index, &key).await },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(done) => {
                        inst.set_tank(t, done.fish.iter().map(|&f| f as u32).collect());
                        inst.send_granted(id, &done.applied);
                    }
                    Err(e) => inst.economy_error(id, e),
                }
            },
        );
    }

    /// Whoever may arrange this place: a home's owner, or (checked again by
    /// the economy service) anyone in a club's room, who got in as a member.
    fn check_owner(&mut self, id: u32) -> Option<String> {
        let player = self.avatars[&id].player_id.clone();
        // (In the city, the economy service checks whose yard it is.)
        if self.is_club_room() || self.is_city() {
            return Some(player);
        }
        if self.owner.as_deref() != Some(player.as_str()) {
            self.error(
                id,
                error_code::NOT_ALLOWED,
                "you can only arrange your own home",
            );
            return None;
        }
        Some(player)
    }

    /// Folds away the lawn chairs `id`'s player set up (they've left).
    pub(super) fn fold_chairs(&mut self, id: u32) {
        let Some(player) = self.avatars.get(&id).map(|a| a.player_id.clone()) else {
            return;
        };
        // (Unless they're here twice over.)
        if self
            .avatars
            .values()
            .filter(|a| a.player_id == player)
            .count()
            > 1
        {
            return;
        }
        let mine: Vec<TilePos> = self
            .portable
            .iter()
            .filter(|(_, p)| **p == player)
            .map(|(t, _)| *t)
            .collect();
        for t in mine {
            self.portable.remove(&t);
            self.set_object(t, 0, 0);
        }
    }

    /// A lawn chair set up in the open: anywhere free, one each, while they've one in the bag.
    fn place_portable(&mut self, id: u32, item: u32, t: TilePos, rot: u8) {
        let free = self.grid.walkable(t.0, t.1)
            && !self.soil.contains(&t)
            && !self.objects.contains_key(&t)
            && !self.avatars.values().any(|a| a.tile == t);
        if !free {
            return self.error(id, error_code::NOT_ALLOWED, "there's no room there");
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "try again in a moment");
        };
        let player = self.avatars[&id].player_id.clone();
        if !self.busy.insert(t) {
            return;
        }
        let who = player.clone();
        self.spawn_call(async move { econ.has(&who, item).await }, move |inst, r| {
            inst.busy.remove(&t);
            match r {
                Ok(n) if n > 0 => {
                    // (One each: the last one folds up as the new one goes down.)
                    let old: Vec<TilePos> = inst
                        .portable
                        .iter()
                        .filter(|(_, p)| **p == player)
                        .map(|(t, _)| *t)
                        .collect();
                    for o in old {
                        inst.portable.remove(&o);
                        inst.set_object(o, 0, 0);
                    }
                    if inst.objects.contains_key(&t) || !inst.grid.walkable(t.0, t.1) {
                        return inst.error(id, error_code::NOT_ALLOWED, "there's no room there");
                    }
                    inst.portable.insert(t, player);
                    inst.set_object(t, item, rot);
                }
                Ok(_) => inst.error(id, error_code::NOT_ALLOWED, "you don't have one of those"),
                Err(e) => inst.economy_error(id, e),
            }
        });
    }

    pub(super) fn place(&mut self, id: u32, item: u32, t: TilePos, rot: u8) {
        let rot = rot % 4;
        let portable = self
            .economy
            .as_ref()
            .and_then(|e| e.catalog())
            .is_some_and(|c| c.portable.contains(&item));
        if portable && self.is_city() {
            return self.place_portable(id, item, t, rot);
        }
        let yard = if self.is_city() {
            match self.yard_at(t) {
                Some(lot) => Some(lot),
                None => {
                    return self.error(id, error_code::NOT_ALLOWED, "that goes in your front yard");
                }
            }
        } else {
            None
        };
        let Some(owner) = self.check_owner(id) else {
            return;
        };
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "try again in a moment");
        };
        if econ.catalog().is_some_and(|c| !c.furniture.contains(&item)) {
            return self.error(id, error_code::BAD_MESSAGE, "that can't be placed");
        }
        let cat = econ.catalog();
        let is = |set: fn(&crate::econ::ZoneCatalog) -> &std::collections::HashSet<u32>, i: u32| {
            cat.as_ref().is_some_and(|c| set(c).contains(&i))
        };
        let home = !self.is_club_room();
        if is(|c| &c.planters, item) && self.zone.id != "home" {
            return self.error(id, error_code::NOT_ALLOWED, "planters are for indoors");
        }
        if is(|c| &c.ponds, item) {
            let fits = yard.as_deref().is_some_and(|lot| self.pond_fits(t, lot));
            if !fits {
                return self.error(
                    id,
                    error_code::NOT_ALLOWED,
                    "a pond needs two tiles by two, free, in your front yard",
                );
            }
        }
        let on_wall = self.wall_face(t, rot);
        // Where it goes: on a wall, on a table, or on the floor.
        let layer: u8 = if home && is(|c| &c.walls, item) && (on_wall || !is(|c| &c.stands, item)) {
            if !on_wall || self.objects.contains_key(&t) {
                return self.error(
                    id,
                    error_code::NOT_ALLOWED,
                    "hang it on a wall (just above the floor)",
                );
            }
            0
        } else if home
            && is(|c| &c.tops, item)
            && self
                .objects
                .get(&t)
                .is_some_and(|&under| is(|c| &c.surfaces, under))
        {
            if self.tops.contains_key(&t) {
                return self.error(
                    id,
                    error_code::NOT_ALLOWED,
                    "there's something on that table already",
                );
            }
            1
        } else {
            // (A rug can go down under someone's feet.)
            let occupied_by_avatar =
                !is(|c| &c.walk, item) && self.avatars.values().any(|a| a.tile == t);
            if !self.grid.walkable(t.0, t.1)
                || self.soil.contains(&t)
                || occupied_by_avatar
                || self.objects.contains_key(&t)
            {
                return self.error(id, error_code::NOT_ALLOWED, "there's no room there");
            }
            0
        };
        if !self.busy.insert(t) {
            return;
        }
        let key = self.next_key("place");
        let club = self.is_club_room().then(|| self.owner.clone()).flatten();
        self.spawn_call(
            async move {
                match club {
                    Some(club) => econ.club_place(&club, &owner, item, t.0, t.1, &key).await,
                    None => {
                        econ.place(&owner, item, t.0, t.1, layer, rot, yard.as_deref(), &key)
                            .await
                    }
                }
            },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(applied) => {
                        if layer == 1 {
                            inst.set_top(t, item, rot);
                        } else {
                            inst.set_object(t, item, rot);
                        }
                        inst.fed.insert(t, (super::now_ms() / 1000) as u32);
                        inst.send_granted(id, &applied);
                    }
                    Err(e) => inst.economy_error(id, e),
                }
            },
        );
    }

    pub(super) fn pickup(&mut self, id: u32, t: TilePos) {
        // A lawn chair in the open folds up, for whoever set it up.
        if let Some(owner) = self.portable.get(&t) {
            if *owner != self.avatars[&id].player_id {
                return self.error(id, error_code::NOT_ALLOWED, "that's someone else's chair");
            }
            self.portable.remove(&t);
            return self.set_object(t, 0, 0);
        }
        let Some(owner) = self.check_owner(id) else {
            return;
        };
        if !self.objects.contains_key(&t) {
            return;
        }
        if self.plots.contains_key(&t) && self.zone.id == "home" {
            return self.error(
                id,
                error_code::NOT_ALLOWED,
                "harvest what's growing in it first",
            );
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "try again in a moment");
        };
        if !self.busy.insert(t) {
            return;
        }
        let yard = self.is_city();
        // What's on a table comes off first.
        let layer: u8 = if self.tops.contains_key(&t) { 1 } else { 0 };
        let key = self.next_key("pickup");
        let club = self.is_club_room().then(|| self.owner.clone()).flatten();
        let me = owner.clone();
        self.spawn_call(
            async move {
                match club {
                    Some(club) => econ.club_pickup(&club, &owner, t.0, t.1, &key).await,
                    None => econ
                        .pickup(&owner, t.0, t.1, layer, yard, &key)
                        .await
                        .map(|applied| crate::econ::ClubPickup {
                            applied,
                            to: owner.clone(),
                        }),
                }
            },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(p) => {
                        if layer == 1 {
                            inst.set_top(t, 0, 0);
                        } else {
                            inst.set_object(t, 0, 0);
                        }
                        // Back in its placer's bag: tell them, if they're here.
                        let to = if p.to == me {
                            Some(id)
                        } else {
                            inst.avatars
                                .iter()
                                .find(|(_, a)| a.player_id == p.to)
                                .map(|(i, _)| *i)
                        };
                        if let Some(to) = to {
                            inst.send_granted(to, &p.applied);
                        }
                    }
                    Err(e) => inst.economy_error(id, e),
                }
            },
        );
    }
}
