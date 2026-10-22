//! The lucky crate: one at a time, sat on some walkable tile of the park.
//! Whoever walks up to it (within a tile) picks it up into their bag; the
//! next turns up somewhere else once the park has gone five minutes
//! without one. Left alone for half an hour, it moves somewhere new.
//! Opened from the bag, it holds coins (for now).

use super::Instance;
use crate::econ::CallError;
use commons_protocol::{ServerMsg, error_code};
use commons_sim::TilePos;
use rand::Rng;
use std::collections::VecDeque;

pub(crate) const CRATE_ITEM: u32 = 118;
const COIN: u32 = 1;
/// How long the park goes without a crate before the next one turns up.
const RESPAWN_MS: u32 = 5 * 60_000;
/// Left alone this long, it moves somewhere else.
const MOVE_MS: u32 = 30 * 60_000;
/// Kept this far from the map's edges (where it could hide off to the side).
const EDGE: u16 = 4;
/// The first one, soon after the park opens.
const FIRST_MS: u32 = 20_000;
/// What's inside (coins), equally likely.
const PRIZES: [i32; 3] = [30, 50, 100];

#[derive(Default)]
pub(super) struct Lucky {
    /// Where the crate sits, if there is one.
    at: Option<TilePos>,
    /// When the next may turn up (instance time).
    next: u32,
    /// When the one out there moves somewhere else.
    moves: u32,
    /// A pickup in flight (the crate is spoken for).
    taking: bool,
    /// Tiles you can walk to from the spawn, worked out once.
    reachable: Vec<TilePos>,
}

impl Lucky {
    pub(super) fn new() -> Self {
        Lucky {
            next: FIRST_MS,
            ..Default::default()
        }
    }
}

fn chebyshev(a: TilePos, b: TilePos) -> i32 {
    (a.0 as i32 - b.0 as i32)
        .abs()
        .max((a.1 as i32 - b.1 as i32).abs())
}

impl Instance {
    fn lucky_on(&self) -> bool {
        self.zone.id == super::OUTDOORS && self.economy.is_some()
    }

    /// Every tile reachable on foot from the spawn (so a crate never lands
    /// somewhere fenced off).
    fn reachable_tiles(&self) -> Vec<TilePos> {
        let g = &self.grid;
        let s = &self.zone.map.spawn;
        let Some(start) = g.nearest_walkable((s.x, s.y), 8) else {
            return Vec::new();
        };
        let mut seen = vec![false; g.w as usize * g.h as usize];
        let mut out = Vec::new();
        let mut q = VecDeque::from([start]);
        seen[g.idx(start.0, start.1)] = true;
        while let Some((x, y)) = q.pop_front() {
            out.push((x, y));
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                if !g.walkable_i(nx, ny) {
                    continue;
                }
                let i = g.idx(nx as u16, ny as u16);
                if !seen[i] {
                    seen[i] = true;
                    q.push_back((nx as u16, ny as u16));
                }
            }
        }
        out
    }

    /// Out in the open, where you'd spot it: open ground all round, nothing
    /// in front of it (a tree or a wall drawn over it), away from the edges.
    fn in_the_open(&self, t: TilePos) -> bool {
        let g = &self.grid;
        if t.0 < EDGE || t.1 < EDGE || t.0 + EDGE >= g.w || t.1 + EDGE >= g.h {
            return false;
        }
        let m = &self.zone.map;
        let bare = |x: i32, y: i32| {
            g.walkable_i(x, y)
                && m.decor_legend
                    .get(m.decor[g.idx(x as u16, y as u16)] as usize)
                    .is_none_or(|d| d == "none" || d == "wildflowers")
        };
        let (x, y) = (t.0 as i32, t.1 as i32);
        // Clear round it, and three rows in front (tall things there would cover it).
        (-1..=1).all(|dx| (-1..=3).all(|dy| bare(x + dx, y + dy)))
            && !m.objects.iter().any(|o| {
                let (ox, oy) = (o.x as i32, o.y as i32);
                x >= ox - 1 && x <= ox + o.w as i32 && y >= oy - 2 && y <= oy + o.h as i32 + 1
            })
    }

    /// A random open spot away from everyone (and from `not`), if one turns up.
    fn lucky_spot(&mut self, not: Option<TilePos>) -> Option<TilePos> {
        if self.lucky.reachable.is_empty() {
            self.lucky.reachable = self.reachable_tiles();
        }
        if self.lucky.reachable.is_empty() {
            return None;
        }
        let mut rng = rand::rng();
        for _ in 0..400 {
            let t = self.lucky.reachable[rng.random_range(0..self.lucky.reachable.len())];
            if Some(t) != not
                && self.in_the_open(t)
                && not.is_none_or(|n| chebyshev(n, t) > 10)
                && self.avatars.values().all(|a| chebyshev(a.tile, t) > 3)
            {
                return Some(t);
            }
        }
        None
    }

    fn lucky_place(&mut self, t: TilePos, now: u32) {
        self.lucky.at = Some(t);
        self.lucky.moves = now + MOVE_MS;
        let bytes = ServerMsg::LuckyShown {
            x: t.0,
            y: t.1,
            moves: self.lucky.moves,
        }
        .to_bytes();
        for a in self.avatars.values_mut() {
            a.send(&bytes);
        }
    }

    pub(super) fn lucky_tick(&mut self, now: u32) {
        if !self.lucky_on() || self.lucky.taking {
            return;
        }
        match self.lucky.at {
            // Nobody's found it in half an hour: off it goes, somewhere else.
            Some(at) if now >= self.lucky.moves => match self.lucky_spot(Some(at)) {
                Some(t) => self.lucky_place(t, now),
                None => self.lucky.moves = now + 10_000,
            },
            Some(_) => {}
            None if now >= self.lucky.next => match self.lucky_spot(None) {
                Some(t) => self.lucky_place(t, now),
                None => self.lucky.next = now + 10_000,
            },
            None => {}
        }
    }

    /// A newcomer sees the crate, if there is one.
    pub(super) fn lucky_hello(&mut self, id: u32) {
        if let Some(t) = self.lucky.at {
            self.send_to(
                id,
                &ServerMsg::LuckyShown {
                    x: t.0,
                    y: t.1,
                    moves: self.lucky.moves,
                },
            );
        }
    }

    /// `id` just stepped onto a tile: close enough to the crate, it's theirs.
    pub(super) fn lucky_near(&mut self, id: u32, now: u32) {
        let Some(at) = self.lucky.at else { return };
        if self.lucky.taking {
            return;
        }
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        if chebyshev(a.tile, at) > 1 {
            return;
        }
        let Some(econ) = self.economy.clone() else {
            return;
        };
        let player = a.player_id.clone();
        let key = self.next_key("lucky");
        self.lucky.taking = true;
        self.spawn_call(
            async move {
                econ.grant(&player, CRATE_ITEM, 1, "lucky_crate", &key)
                    .await
            },
            move |inst, r| {
                inst.lucky.taking = false;
                // On failure it's still there for the next one to walk by (or this one, again).
                if let Ok(applied) = r {
                    inst.lucky.at = None;
                    inst.lucky.next = now + RESPAWN_MS;
                    if inst.avatars.contains_key(&id) {
                        inst.send_granted(id, &applied);
                    }
                    // Everyone sees it go (and who found it).
                    let bytes = ServerMsg::LuckyFound {
                        id,
                        x: at.0,
                        y: at.1,
                    }
                    .to_bytes();
                    for a in inst.avatars.values_mut() {
                        a.send(&bytes);
                    }
                }
            },
        );
    }

    /// `id` opens a lucky crate from their bag.
    pub(super) fn open_crate(&mut self, id: u32, now: u32) {
        // One at a time (a spammed button mustn't flood the economy).
        if !self
            .avatars
            .get_mut(&id)
            .is_some_and(|a| a.game_rl.try_take(now as u64))
        {
            return;
        }
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "can't open it just now");
        };
        let player = self.avatars[&id].player_id.clone();
        let key = self.next_key("crate_open");
        let prize = PRIZES[rand::rng().random_range(0..PRIZES.len())];
        self.spawn_call(
            async move {
                let used = econ
                    .grant(&player, CRATE_ITEM, -1, "crate_open", &key)
                    .await?;
                // The coins: tried again if the first go fails (same key, so never twice).
                let coin_key = format!("{key}:coins");
                let mut paid = econ
                    .grant(&player, COIN, prize, "crate_open", &coin_key)
                    .await;
                if matches!(paid, Err(CallError::Unavailable)) {
                    paid = econ
                        .grant(&player, COIN, prize, "crate_open", &coin_key)
                        .await;
                }
                Ok::<_, CallError>((used, paid))
            },
            move |inst, r| match r {
                Ok((used, paid)) => {
                    if !inst.avatars.contains_key(&id) {
                        return;
                    }
                    inst.send_granted(id, &used);
                    match paid {
                        Ok(paid) => {
                            inst.send_granted(id, &paid);
                            inst.send_to(
                                id,
                                &ServerMsg::LuckyOpened {
                                    coins: prize as u16,
                                },
                            );
                        }
                        Err(_) => inst.error(
                            id,
                            error_code::UNAVAILABLE,
                            "the coins got stuck: they'll turn up shortly",
                        ),
                    }
                }
                Err(CallError::Rejected(_)) => {
                    inst.error(id, error_code::NOT_ALLOWED, "you don't have a lucky crate")
                }
                Err(CallError::Unavailable) => inst.error(
                    id,
                    error_code::UNAVAILABLE,
                    "couldn't open it just now, try again",
                ),
            },
        );
    }
}
