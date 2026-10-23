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
                        inst.set_object((o.x as u16, o.y as u16), o.item as u32);
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
        self.objects
            .iter()
            .filter(|(t, _)| self.cell_of(**t) == cell)
            .map(|(t, item)| ServerMsg::ObjectUpdate {
                x: t.0,
                y: t.1,
                item: *item,
            })
            .collect()
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
        let occupied_by_avatar = self.avatars.values().any(|a| a.tile == t);
        if !self.grid.walkable(t.0, t.1)
            || self.soil.contains(&t)
            || occupied_by_avatar
            || self.objects.contains_key(&t)
        {
            return self.error(id, error_code::NOT_ALLOWED, "there's no room there");
        }
        if !self.busy.insert(t) {
            return;
        }
        let key = self.next_key("place");
        let club = self.is_club_room().then(|| self.owner.clone()).flatten();
        self.spawn_call(
            async move {
                match club {
                    Some(club) => econ.club_place(&club, &owner, item, t.0, t.1, &key).await,
                    None => econ.place(&owner, item, t.0, t.1, &key).await,
                }
            },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(applied) => {
                        inst.set_object(t, item);
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
        let key = self.next_key("pickup");
        let club = self.is_club_room().then(|| self.owner.clone()).flatten();
        let me = owner.clone();
        self.spawn_call(
            async move {
                match club {
                    Some(club) => econ.club_pickup(&club, &owner, t.0, t.1, &key).await,
                    None => econ.pickup(&owner, t.0, t.1, &key).await.map(|applied| {
                        crate::econ::ClubPickup {
                            applied,
                            to: owner.clone(),
                        }
                    }),
                }
            },
            move |inst, r| {
                inst.busy.remove(&t);
                match r {
                    Ok(p) => {
                        inst.set_object(t, 0);
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
