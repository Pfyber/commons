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

/// The zone whose instances are club rooms, owned by a club.
pub(crate) const CLUB_ROOM: &str = "clubroom";

impl Instance {
    fn is_club_room(&self) -> bool {
        self.zone.id == CLUB_ROOM
    }

    pub(super) fn load_home(&self) {
        // (Only homes and club rooms keep furniture; other zones' owners are something else, a labyrinth's day.)
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
                        let t = (o.x as u16, o.y as u16);
                        if o.layer == 1 {
                            inst.set_top(t, o.item as u32);
                        } else {
                            inst.set_object(t, o.item as u32);
                        }
                        if !o.fish.is_empty() {
                            inst.set_tank(t, o.fish.iter().map(|&f| f as u32).collect());
                        }
                    }
                }
                Err(e) => tracing::error!(?e, "loading home failed"),
            },
        );
    }

    /// Adds (item > 0) or removes (item = 0) furniture and tells watchers.
    fn set_object(&mut self, t: TilePos, item: u32) {
        if item == 0 {
            self.objects.remove(&t);
            if !self.tops.contains_key(&t) {
                self.lit.remove(&t);
                self.tanks.remove(&t);
            }
            self.grid.set_blocked(
                t.0,
                t.1,
                self.zone.grid.blocked[self.zone.grid.idx(t.0, t.1)],
            );
        } else {
            self.objects.insert(t, item);
            self.grid.set_blocked(t.0, t.1, true);
        }
        self.broadcast(
            self.cell_of(t),
            &ServerMsg::ObjectUpdate {
                x: t.0,
                y: t.1,
                item,
            },
            None,
        );
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
            })
            .collect();
        // What's on the tables, what's on, and what swims in the tanks.
        for (t, item) in self.tops.iter().filter(|(t, _)| self.cell_of(**t) == cell) {
            out.push(ServerMsg::ObjectTop {
                x: t.0,
                y: t.1,
                item: *item,
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
    fn set_top(&mut self, t: TilePos, item: u32) {
        if item == 0 {
            self.tops.remove(&t);
            self.lit.remove(&t);
            self.tanks.remove(&t);
        } else {
            self.tops.insert(t, item);
        }
        self.broadcast(
            self.cell_of(t),
            &ServerMsg::ObjectTop {
                x: t.0,
                y: t.1,
                item,
            },
            None,
        );
    }

    /// The thing at `t` you'd use (what's on the table, else the table or whatever's there), and its layer.
    fn used_at(&self, t: TilePos) -> Option<(u32, u8)> {
        self.tops
            .get(&t)
            .map(|&i| (i, 1))
            .or_else(|| self.objects.get(&t).map(|&i| (i, 0)))
    }

    /// Whether `t` is a wall a picture can hang on: a wall (as built) with the home's floor just below it.
    fn wall_face(&self, t: TilePos) -> bool {
        let m = &self.zone.map;
        let below = (t.0, t.1 + 1);
        if below.1 >= m.height || t.0 >= m.width {
            return false;
        }
        let floor = m.ground[below.1 as usize * m.width as usize + below.0 as usize] as usize;
        self.zone.grid.blocked[self.zone.grid.idx(t.0, t.1)]
            && self.grid.walkable(below.0, below.1)
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

    /// The owner puts a fish from their bag in a tank.
    pub(super) fn tank_put(&mut self, id: u32, t: TilePos, fish: u32) {
        if self.is_club_room() {
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
        if self.is_club_room() {
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

    pub(super) fn place(&mut self, id: u32, item: u32, t: TilePos) {
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
        // Where it goes: on a wall, on a table, or on the floor.
        let layer: u8 = if home && is(|c| &c.walls, item) {
            if !self.wall_face(t) || self.objects.contains_key(&t) {
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
            let occupied_by_avatar = self.avatars.values().any(|a| a.tile == t);
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
                    None => econ.place(&owner, item, t.0, t.1, layer, &key).await,
                }
            },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(applied) => {
                        if layer == 1 {
                            inst.set_top(t, item);
                        } else {
                            inst.set_object(t, item);
                        }
                        inst.send_granted(id, &applied);
                    }
                    Err(e) => inst.economy_error(id, e),
                }
            },
        );
    }

    pub(super) fn pickup(&mut self, id: u32, t: TilePos) {
        let Some(owner) = self.check_owner(id) else {
            return;
        };
        if !self.objects.contains_key(&t) {
            return;
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "try again in a moment");
        };
        if !self.busy.insert(t) {
            return;
        }
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
                        .pickup(&owner, t.0, t.1, layer, &key)
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
                            inst.set_top(t, 0);
                        } else {
                            inst.set_object(t, 0);
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
