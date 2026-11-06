//! The gladiator arena in the park: Crown of the Colosseum, four
//! gladiators (bots in the empty places), last one standing takes the
//! round's crown, three crowns wins. The fighting itself is
//! `commons_sim::arena`; here it's put on the map: the fighters' own avatars
//! go onto the sand (their walking held: they move with the match), anyone
//! standing in the ring when a round begins is shown out through the gate
//! (and kept out till the match is done), and everyone who can see the
//! ring gets an `ArenaState` every tick and an `ArenaEvent` for each blow.

use super::Instance;
use crate::econ::CallError;
use commons_protocol::{
    ArenaCloud, ArenaFighter, ArenaGift, ArenaLion, ServerMsg, error_code, state,
};
use commons_sim::TilePos;
use commons_sim::arena as sim;
use commons_sim::map::MapObject;
use rand::Rng;

/// A spectator's bet: who, on what, and whether the stake's been taken yet.
/// (The coin's item id.)
const COIN: u32 = 1;

#[derive(Debug, Clone)]
struct Bet {
    id: u32,
    player: String,
    pick: u8,
    paid: bool,
}

#[derive(Debug, Clone)]
pub(super) struct Arena {
    m: sim::Match,
    /// The sand's top-left corner (map tiles), and the whole ring (walls too).
    origin: (u16, u16),
    ring: (u16, u16, u16, u16),
    /// Outside the north gate: where bystanders are shown out to, and where
    /// fighters come back out after.
    gate: TilePos,
    dirty: bool,
    /// The spectators' bets on this round.
    bets: Vec<Bet>,
    /// When anyone last did anything in the lobby.
    lobby_at: u32,
    /// Nobody's played since then (or someone's just looked at the sign):
    /// the bots put on a match of their own once it's been a while.
    quiet_until: u32,
}

/// How long the arena stands empty before the bots put on a match; and
/// after someone looks at the sign (and doesn't play), a while longer.
const EXHIBIT_AFTER_MS: u32 = 5000;
/// Places taken in the lobby and nothing happening for this long (a rematch
/// nobody's started, say): they're stood down, and the sand's free again.
const LOBBY_IDLE_MS: u32 = 20_000;

impl Arena {
    pub(super) fn new(objects: &[MapObject]) -> Option<Arena> {
        let (ring, origin) = sim::Ring::from_map(objects)?;
        let a = objects.iter().find(|o| o.kind == "arena")?;
        let gate = objects
            .iter()
            .find(|o| o.kind == "spot" && o.label.as_deref() == Some("arena"))
            .map(|o| (o.x, o.y))
            .unwrap_or((a.x + a.w / 2, a.y.saturating_sub(1)));
        Some(Arena {
            m: sim::Match::new(ring),
            origin,
            ring: (a.x, a.y, a.w, a.h),
            gate,
            dirty: true,
            bets: Vec::new(),
            lobby_at: 0,
            quiet_until: EXHIBIT_AFTER_MS,
        })
    }

    /// The map tile under arena point (x, y).
    fn tile(&self, x: f64, y: f64) -> TilePos {
        (
            self.origin.0 + x.max(0.0) as u16,
            self.origin.1 + y.max(0.0) as u16,
        )
    }

    /// Whether tile `t` is on the sand (or its wall): not the stands
    /// round an oval ring, though they're within its corners.
    fn inside(&self, t: TilePos) -> bool {
        let (x, y, w, h) = self.ring;
        t.0 >= x
            && t.1 >= y
            && t.0 < x + w
            && t.1 < y + h
            && self.m.ring.on_sand(
                t.0 as f64 - self.origin.0 as f64 + 0.5,
                t.1 as f64 - self.origin.1 as f64 + 0.5,
                1.0,
            )
    }

    fn state(&self, now: u32) -> ServerMsg {
        let m = &self.m;
        ServerMsg::ArenaState {
            status: m.status,
            now,
            phase_ms: m.phase_end.saturating_sub(now),
            round: m.round,
            fire: (m.fire(now) * 1000.0).round() as u16,
            spikes: (0..m.ring.spikes.len())
                .map(|k| m.spike_phase(k, now).0)
                .collect(),
            slots: m.slots.to_vec(),
            crowns: m.crowns.to_vec(),
            fighters: m
                .fighters
                .iter()
                .map(|f| ArenaFighter {
                    id: f.id,
                    x: x100(f.x),
                    y: x100(f.y),
                    aim: sim::aim_to_u16(f.aim),
                    hp: f.hp.max(0.0).ceil().min(65_535.0) as u16,
                    stamina: f.stamina.round().clamp(0.0, 100.0) as u8,
                    rage: f.rage.floor().clamp(0.0, 100.0) as u8,
                    act: f.act,
                    act_ms: now.saturating_sub(f.act_at).min(65_535) as u16,
                    charge: (f.charge * 100.0).round() as u8,
                    flags: f.flags(now),
                    buffs: f.buffs(now),
                    holding: f.holding,
                    fix: f.fix,
                    kit: (m.picks.get(f.slot).copied().unwrap_or(0) & sim::kit::PICKED) | f.kit,
                })
                .collect(),
            gifts: m
                .gifts
                .iter()
                .map(|g| ArenaGift {
                    kind: g.kind,
                    x: x100(g.x),
                    y: x100(g.y),
                    lands_ms: g.lands.saturating_sub(now).min(65_535) as u16,
                })
                .collect(),
            winner: m.winner,
            level: m.level,
            mode: m.mode,
            goliath: m.goliath as u8,
            kits: m.kits,
            choose_ms: if m.choosing(now) {
                m.choose_end.saturating_sub(now).min(65_535) as u16
            } else {
                0
            },
            exhibition: m.exhibition,
            wheel: m.wheel,
            disaster: m.disaster_shown(),
            disaster_stage: m.disaster_stage,
            disaster_ms: m.disaster_end.saturating_sub(now).min(65_535) as u16,
            disaster_votes: m.disaster_tally().to_vec(),
            disaster_pool: m.disaster_pool,
            lava: (m.lava(now) * 1000.0).round() as u16,
            disasters: m.disasters,
            bet_ms: m.bet_ms(now).min(65_535) as u16,
            bets: {
                let mut n = vec![0u8; 4];
                for b in &self.bets {
                    if let Some(c) = n.get_mut(b.pick as usize) {
                        *c = c.saturating_add(1);
                    }
                }
                n
            },
            bet_pay: m.bet_pay() as u16,
            clouds: m
                .clouds
                .iter()
                .filter(|c| c.delay <= now)
                .map(|c| ArenaCloud {
                    id: c.id,
                    x: x100(c.x(now) + sim::ACID_OFF),
                    y: x100(c.y),
                })
                .collect(),
            lions: m
                .lions
                .iter()
                .map(|l| ArenaLion {
                    id: l.id,
                    kind: if l.thief {
                        2
                    } else if l.big && !l.scorpion {
                        3
                    } else {
                        l.scorpion as u8
                    },
                    x: x100(l.x),
                    y: x100(l.y),
                    aim: sim::aim_to_u16(l.aim),
                    hp: l.hp.max(0.0).ceil().min(255.0) as u8,
                    act: l.act,
                    act_ms: now.saturating_sub(l.act_at).min(65_535) as u16,
                    to_x: x100(l.to.0),
                    to_y: x100(l.to.1),
                    item: l.item,
                })
                .collect(),
        }
    }
}

fn x100(v: f64) -> u16 {
    (v * 100.0).round().clamp(0.0, 65_535.0) as u16
}

fn from100(v: u16) -> f64 {
    v as f64 / 100.0
}

fn event_msg(e: &sim::Event) -> ServerMsg {
    let v = |x: f64| ((x * 100.0).round() + 32768.0).clamp(0.0, 65_535.0) as u16;
    ServerMsg::ArenaEvent {
        kind: e.kind,
        a: e.a,
        b: e.b,
        x: x100(e.x),
        y: x100(e.y),
        n: e.n,
        m: e.m,
        vx: v(e.vx),
        vy: v(e.vy),
    }
}

impl Instance {
    /// Whether `id` is fighting in the arena now (they can't walk off).
    pub(super) fn arena_fighting(&self, id: u32) -> bool {
        self.arena.as_ref().is_some_and(|ar| ar.m.playing(id))
    }

    /// Whether a walk to `t` would go into the ring while a match is on (not for bystanders).
    pub(super) fn arena_closed(&self, t: TilePos) -> bool {
        self.arena
            .as_ref()
            .is_some_and(|ar| ar.m.running() && ar.inside(t))
    }

    /// Sends to everyone who can see the ring (watching any cell it covers), once each.
    fn arena_broadcast(&mut self, msg: &ServerMsg) {
        let Some(ar) = &self.arena else { return };
        let (x0, y0, w, h) = ar.ring;
        let (x1, y1) = (x0 + w - 1, y0 + h - 1);
        let mut cells: Vec<u16> = Vec::new();
        for ty in [y0, y1] {
            for tx in [x0, x1] {
                cells.push(self.cell_of((tx, ty)));
            }
        }
        cells.sort_unstable();
        cells.dedup();
        let mut to: Vec<u32> = cells
            .iter()
            .flat_map(|&c| self.watchers[c as usize].iter().copied())
            .collect();
        to.sort_unstable();
        to.dedup();
        let bytes = msg.to_bytes();
        for id in to {
            if let Some(a) = self.avatars.get_mut(&id) {
                a.send(&bytes);
            }
        }
    }

    fn arena_send(&mut self, now: u32) {
        let Some(ar) = &self.arena else { return };
        let msg = ar.state(now);
        self.arena_broadcast(&msg);
    }

    /// A newcomer sees how the arena stands.
    pub(super) fn arena_hello(&mut self, id: u32) {
        let now = self.clock.now_ms();
        if let Some(ar) = &self.arena {
            let msg = ar.state(now);
            self.send_to(id, &msg);
        }
    }

    /// Puts `id` (a player here) on tile `t`: walking stopped, everyone shown.
    fn arena_place(&mut self, id: u32, t: TilePos, now: u32) {
        let Some(a) = self.avatars.get(&id) else {
            return;
        };
        if a.state == state::SITTING {
            self.stand(id, now);
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

    /// A round begins: the fighters onto the sand at their gates, anyone
    /// else in the ring shown out.
    fn arena_take_places(&mut self, now: u32) {
        let Some(ar) = &self.arena else { return };
        let fighters: Vec<(u32, TilePos)> =
            ar.m.fighters
                .iter()
                .filter(|f| !f.bot)
                .map(|f| (f.id, ar.tile(f.x, f.y)))
                .collect();
        let gate = ar.gate;
        let inside: Vec<u32> = self
            .avatars
            .iter()
            // (Anyone sitting watching stays put.)
            .filter(|(id, a)| {
                a.state != state::SITTING
                    && ar.inside(a.tile)
                    && !fighters.iter().any(|(f, _)| f == *id)
            })
            .map(|(id, _)| *id)
            .collect();
        for (id, t) in fighters {
            self.arena_place(id, t, now);
        }
        for id in inside {
            self.arena_place(id, gate, now);
        }
    }

    /// `id` back outside the north gate.
    fn arena_out(&mut self, id: u32, now: u32) {
        let Some(ar) = &self.arena else { return };
        let gate = ar.gate;
        if self.avatars.contains_key(&id) {
            self.arena_place(id, gate, now);
        }
    }

    pub(super) fn arena_join(&mut self, id: u32, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        let was = ar.m.playing(id);
        if !ar.m.join(id, now) {
            self.error(
                id,
                commons_protocol::error_code::BAD_MESSAGE,
                "the arena's full: watch from the stands",
            );
            return;
        }
        ar.dirty = true;
        // Into a match under way: onto the sand.
        if !was && ar.m.playing(id) {
            let t = ar.m.fighter(id).map(|f| ar.tile(f.x, f.y));
            if let Some(t) = t {
                self.arena_place(id, t, now);
            }
        }
        self.arena_send(now);
    }

    pub(super) fn arena_leave(&mut self, id: u32) {
        let now = self.clock.now_ms();
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.slot_of(id).is_none() {
            return;
        }
        let was = ar.m.playing(id);
        let on = ar.m.running();
        ar.m.leave(id);
        ar.dirty = true;
        let called_off = on && !ar.m.running();
        let others: Vec<u32> = if called_off {
            ar.m.slots
                .iter()
                .copied()
                .filter(|&s| s != 0 && !sim::is_bot(s))
                .collect()
        } else {
            Vec::new()
        };
        if was {
            self.arena_out(id, now);
        }
        for o in others {
            self.arena_out(o, now);
        }
        self.arena_send(now);
    }

    pub(super) fn arena_start(&mut self, id: u32, bots: bool, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if !ar.m.start(id, bots, now) {
            self.error(
                id,
                commons_protocol::error_code::BAD_MESSAGE,
                "two gladiators needed (or fill with bots)",
            );
            return;
        }
        ar.dirty = true;
        self.arena_take_places(now);
        self.arena_broadcast(&event_msg(&sim::Event {
            kind: sim::ev::ROUND_START,
            a: 0,
            b: 0,
            x: 0.0,
            y: 0.0,
            n: 1,
            m: 0,
            vx: 0.0,
            vy: 0.0,
        }));
        self.arena_send(now);
    }

    /// Someone opened the sign: the lobby's state, for them to look at. (The
    /// bots' match plays on: it only makes way when someone takes a place.)
    pub(super) fn arena_lobby(&mut self, _id: u32, now: u32) {
        self.arena_send(now);
    }

    pub(super) fn arena_bot(&mut self, id: u32, slot: u8, on: bool, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.set_bot(id, slot as usize, on) {
            ar.dirty = true;
            self.arena_send(now);
        }
    }

    pub(super) fn arena_mode(&mut self, id: u32, mode: u8, goliath: u8, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.set_mode(id, mode, goliath as usize) {
            ar.dirty = true;
            self.arena_send(now);
        }
    }

    pub(super) fn arena_kits(&mut self, id: u32, on: bool, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.set_kits(id, on) {
            ar.dirty = true;
            self.arena_send(now);
        }
    }

    pub(super) fn arena_wheel(&mut self, id: u32, on: bool, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.set_wheel(id, on) {
            ar.dirty = true;
            self.arena_send(now);
        }
    }

    pub(super) fn arena_disasters(&mut self, id: u32, on: bool, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.set_disasters(id, on) {
            ar.dirty = true;
            self.arena_send(now);
        }
    }

    /// A spectator's vote for the round's disaster.
    /// Over to another place, in the lobby.
    pub(super) fn arena_switch(&mut self, id: u32, slot: u8, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.switch_place(id, slot as usize) {
            ar.dirty = true;
            self.arena_send(now);
        }
    }

    /// A spectator's bet on the round: the stake taken, or told why not.
    pub(super) fn arena_bet(&mut self, id: u32, pick: u8, now: u32) {
        let Some(a) = self.avatars.get_mut(&id) else {
            return;
        };
        if !a.emote_rl.try_take(now as u64) {
            return;
        }
        let (player, minor) = (a.player_id.clone(), a.minor);
        let Some(ar) = self.arena.as_ref() else {
            return;
        };
        // (Betting's kept from under-18s, as the casino is.)
        if minor && !commons_common::config::env_or("COMMONS_CASINO_MINORS", false) {
            return self.error(id, error_code::NOT_ALLOWED, "betting's for grown-ups");
        }
        if ar.m.bet_ms(now) == 0 {
            return self.error(
                id,
                error_code::NOT_ALLOWED,
                "bets are closed for this round",
            );
        }
        if ar.m.playing(id) {
            return self.error(id, error_code::NOT_ALLOWED, "no betting from the sand");
        }
        if !ar.m.bet_ok(pick) || ar.bets.iter().any(|b| b.id == id) {
            return;
        }
        let pays = ar.m.bet_pay() as u16;
        let Some(econ) = self.economy.clone() else {
            return self.error(id, error_code::UNAVAILABLE, "the bookie's away just now");
        };
        if let Some(ar) = self.arena.as_mut() {
            ar.bets.push(Bet {
                id,
                player: player.clone(),
                pick,
                paid: false,
            });
        }
        let key = self.next_key("arena_bet");
        let who = player.clone();
        self.spawn_call(
            async move {
                econ.grant(&who, COIN, -sim::BET_STAKE, "arena_bet", &key)
                    .await
            },
            move |inst, result| {
                let bet = inst
                    .arena
                    .as_mut()
                    .and_then(|ar| ar.bets.iter_mut().find(|b| b.id == id));
                match (result, bet) {
                    (Ok(applied), Some(b)) => {
                        b.paid = true;
                        if inst.avatars.contains_key(&id) {
                            inst.send_granted(id, &applied);
                            inst.send_to(id, &ServerMsg::ArenaBetPlaced { pick, pays });
                        }
                    }
                    // (The round was over before the till rang: it's handed straight back.)
                    (Ok(applied), None) => {
                        if inst.avatars.contains_key(&id) {
                            inst.send_granted(id, &applied);
                        }
                        inst.arena_pay(id, player, sim::BET_STAKE, true);
                    }
                    (Err(e), _) => {
                        if let Some(ar) = inst.arena.as_mut() {
                            ar.bets.retain(|b| b.id != id);
                        }
                        let (code, msg) = match e {
                            CallError::Rejected(_) => {
                                (error_code::NOT_ALLOWED, "not enough coins for a bet")
                            }
                            CallError::Unavailable => {
                                (error_code::UNAVAILABLE, "the bookie's busy; try again")
                            }
                        };
                        inst.error(id, code, msg);
                    }
                }
            },
        );
    }

    /// The round's decided (`side`: who took it; none: nobody did): good
    /// bets paid, the rest told. Anyone who's since jumped in gets their stake back.
    fn arena_settle(&mut self, side: Option<u8>) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        let bets = std::mem::take(&mut ar.bets);
        let pay = ar.m.bet_pay();
        let fighting: Vec<bool> = bets.iter().map(|b| ar.m.playing(b.id)).collect();
        for (b, fought) in bets.into_iter().zip(fighting) {
            if !b.paid {
                continue;
            }
            if side.is_none() || fought {
                self.arena_pay(b.id, b.player, sim::BET_STAKE, true);
            } else if side == Some(b.pick) {
                self.arena_pay(b.id, b.player, pay, false);
            } else {
                self.send_to(
                    b.id,
                    &ServerMsg::ArenaBetSettled {
                        coins: 0,
                        refund: false,
                    },
                );
            }
        }
    }

    /// Coins back to a spectator (wherever they've got to: it's theirs).
    fn arena_pay(&mut self, id: u32, player: String, coins: i32, refund: bool) {
        let Some(econ) = self.economy.clone() else {
            return;
        };
        let reason = if refund {
            "arena_bet_back"
        } else {
            "arena_bet_won"
        };
        let key = self.next_key("arena_bet_pay");
        self.spawn_call(
            async move { econ.grant(&player, COIN, coins, reason, &key).await },
            move |inst, result| match result {
                Ok(applied) if inst.avatars.contains_key(&id) => {
                    inst.send_granted(id, &applied);
                    inst.send_to(
                        id,
                        &ServerMsg::ArenaBetSettled {
                            coins: coins as u16,
                            refund,
                        },
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(?e, coins, "arena bet: couldn't pay out"),
            },
        );
    }

    pub(super) fn arena_vote(&mut self, id: u32, kind: u8, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.vote(id, kind) {
            self.arena_send(now);
        }
    }

    /// A class picked for the round (shown at once to all).
    pub(super) fn arena_kit(&mut self, id: u32, kit: u8, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.choose_kit(id, kit, now) {
            self.arena_send(now);
        }
    }

    pub(super) fn arena_level(&mut self, id: u32, level: u8, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if ar.m.set_level(id, level) {
            ar.dirty = true;
            self.arena_send(now);
        }
    }

    pub(super) fn arena_move(&mut self, id: u32, x: u16, y: u16, aim: u16, reach: u16, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        // (How far off the mouse is, too: where the Goliath leaps, and hurls whoever it holds.)
        ar.m.reach(id, reach as f64 / 100.0);
        let evs =
            ar.m.claim_move(id, from100(x), from100(y), sim::aim_from_u16(aim), now);
        // (A heavy blow's lunge striking whoever it went through on the way.)
        for e in &evs {
            self.arena_broadcast(&event_msg(e));
        }
    }

    pub(super) fn arena_act(&mut self, id: u32, act: u8, aim: u16, reach: u16, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        // (How far off the mouse is, in hundredths of a tile: the Goliath leaps no further.)
        ar.m.reach(id, reach as f64 / 100.0);
        let evs = ar.m.input(id, act, sim::aim_from_u16(aim), now);
        for e in &evs {
            self.arena_broadcast(&event_msg(e));
        }
    }

    /// A tick of the match: it plays on, the fighters' avatars stand where
    /// they are on the sand, and everyone watching is told.
    pub(super) fn arena_tick(&mut self, now: u32) {
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        let before = ar.m.status;
        // Places taken, and nobody doing anything with them: stood down.
        if before == sim::LOBBY && ar.m.slots.iter().any(|&s| s != 0) {
            if ar.dirty {
                ar.lobby_at = now;
            }
            ar.quiet_until = ar.quiet_until.max(now + EXHIBIT_AFTER_MS);
            if now >= ar.lobby_at + LOBBY_IDLE_MS {
                let people: Vec<u32> =
                    ar.m.slots
                        .iter()
                        .copied()
                        .filter(|&s| s != 0 && !sim::is_bot(s))
                        .collect();
                for &id in &people {
                    ar.m.leave(id);
                }
                ar.m.clear_lobby();
                ar.dirty = true;
                ar.quiet_until = now + EXHIBIT_AFTER_MS;
                for id in people {
                    self.send_to(id, &ServerMsg::ArenaStoodDown {});
                }
            }
        }
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        if before == sim::LOBBY && now >= ar.quiet_until && !self.avatars.is_empty() {
            let mut rng = rand::rng();
            if ar.m.exhibit(now, &mut || rng.random::<f64>()) {
                self.arena_take_places(now);
                self.arena_broadcast(&event_msg(&sim::Event {
                    kind: sim::ev::ROUND_START,
                    a: 0,
                    b: 0,
                    x: 0.0,
                    y: 0.0,
                    n: 1,
                    m: 0,
                    vx: 0.0,
                    vy: 0.0,
                }));
                self.arena_send(now);
                return;
            }
        }
        let Some(ar) = self.arena.as_mut() else {
            return;
        };
        let before = ar.m.status;
        if before == sim::LOBBY {
            // (Called off, with bets down: they're handed back.)
            if !ar.bets.is_empty() {
                self.arena_settle(None);
                return;
            }
            if ar.dirty {
                ar.dirty = false;
                self.arena_send(now);
            }
            return;
        }
        // The parade's end, worked out before the match is cleared away.
        let parade: Vec<(u32, TilePos)> = if before == sim::OVER {
            ar.m.parade_end()
                .into_iter()
                .map(|(id, x, y)| (id, ar.tile(x, y)))
                .collect()
        } else {
            Vec::new()
        };
        let mut rng = rand::rng();
        let evs = ar.m.step(now, 100, &mut || rng.random::<f64>());
        let after = ar.m.status;
        let spots: Vec<(u32, TilePos)> =
            ar.m.fighters
                .iter()
                .filter(|f| !f.bot)
                .map(|f| (f.id, ar.tile(f.x, f.y)))
                .collect();
        let people: Vec<u32> =
            ar.m.slots
                .iter()
                .copied()
                .filter(|&s| s != 0 && !sim::is_bot(s))
                .collect();
        for (id, t) in spots {
            if let Some(a) = self.avatars.get_mut(&id)
                && a.tile != t
            {
                a.tile = t;
                self.on_tile_changed(id, now);
            }
        }
        for e in &evs {
            self.arena_broadcast(&event_msg(e));
        }
        if let Some(e) = evs.iter().find(|e| e.kind == sim::ev::ROUND_WON) {
            let side = self.arena.as_ref().and_then(|ar| ar.m.won_by(e.a));
            self.arena_settle(side);
        }
        // The match won: a gladiator's win, on the leaderboard (not a bot's).
        if after == sim::OVER && before != sim::OVER {
            let w = self.arena.as_ref().map_or(0, |ar| ar.m.winner);
            if w != 0 && !sim::is_bot(w) {
                self.count_stat(w, "arena_wins");
            }
        }
        // A new round: everyone back to their gates (and the ring cleared).
        if after == sim::COUNTDOWN && before != sim::COUNTDOWN {
            self.arena_take_places(now);
        }
        // Over: the parade's done; everyone stands where it ended, down the
        // red carpet (anyone not in it, out through the gate).
        if after == sim::LOBBY {
            if let Some(ar) = self.arena.as_mut() {
                ar.quiet_until = now + EXHIBIT_AFTER_MS;
                ar.lobby_at = now;
            }
            for id in people {
                match parade.iter().find(|(p, _)| *p == id) {
                    Some(&(_, t)) => self.arena_place(id, t, now),
                    None => self.arena_out(id, now),
                }
            }
        }
        self.arena_send(now);
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::Cmd;
    use crate::instance::tests::*;
    use crate::registry::ZoneDef;
    use commons_protocol::{ClientMsg, ServerMsg};
    use commons_sim::arena as sim;
    use commons_sim::map::MapObject;
    use std::sync::Arc;

    fn park() -> crate::instance::Instance {
        let mut m = map(40, 30);
        let o = |kind: &str, x, y, w, h, label: Option<&str>| MapObject {
            kind: kind.into(),
            x,
            y,
            w,
            h,
            label: label.map(Into::into),
        };
        m.objects = vec![
            o("arena", 10, 5, 22, 15, None),
            o("arena_pillar", 15, 11, 2, 2, None),
            o("arena_spikes", 20, 7, 2, 2, None),
            o("spot", 20, 4, 1, 1, Some("arena")),
        ];
        instance_for(Arc::new(ZoneDef::new("founders_park".into(), m, None)))
    }

    fn send(inst: &mut crate::instance::Instance, conn: u64, msg: ClientMsg) {
        inst.handle(Cmd::Msg { conn, msg });
    }

    fn last_state(c: &Client) -> Option<(u8, Vec<u32>)> {
        c.log.iter().rev().find_map(|m| match m {
            ServerMsg::ArenaState { status, slots, .. } => Some((*status, slots.clone())),
            _ => None,
        })
    }

    #[test]
    fn gladiators_take_the_sand_bystanders_are_shown_out_and_bots_fight() {
        let mut inst = park();
        let mut a = connect(&mut inst, 1, "a", (20, 22));
        let _b = connect(&mut inst, 2, "b", (21, 22));
        // Someone wandering about inside the ring.
        let _c = connect(&mut inst, 3, "c", (25, 15));
        inst.avatars.get_mut(&3).unwrap().tile = (25, 15);
        send(&mut inst, 1, ClientMsg::ArenaJoin {});
        send(&mut inst, 2, ClientMsg::ArenaJoin {});
        send(&mut inst, 1, ClientMsg::ArenaStart { bots: true });
        inst.flush();
        a.pump();
        let (status, slots) = last_state(&a).unwrap();
        assert_eq!(status, sim::COUNTDOWN);
        assert_eq!(&slots[..2], &[1, 2]);
        assert!(slots[2..].iter().all(|&s| sim::is_bot(s)));
        // On the sand at their gates; the bystander's outside the gate.
        let ta = inst.avatars[&1].tile;
        assert!(ta.0 > 10 && ta.0 < 31 && ta.1 > 5 && ta.1 < 19, "{ta:?}");
        assert_eq!(inst.avatars[&3].tile, (20, 4));
        // Fighters can't walk off; nobody walks in.
        send(
            &mut inst,
            1,
            ClientMsg::MoveTo {
                x: 2,
                y: 2,
                sprint: false,
            },
        );
        assert!(inst.avatars[&1].motion.is_none());
        send(
            &mut inst,
            3,
            ClientMsg::MoveTo {
                x: 25,
                y: 12,
                sprint: false,
            },
        );
        assert!(inst.avatars[&3].motion.is_none());
        // The match runs: bots swing.
        let now = inst.clock.now_ms();
        for k in 1..=200 {
            inst.arena_tick(now + k * 100);
        }
        send(
            &mut inst,
            1,
            ClientMsg::ArenaAct {
                act: sim::input::LIGHT,
                aim: 0,
                reach: 0,
            },
        );
        inst.flush();
        a.pump();
        assert!(
            a.log.iter().any(|m| matches!(
                m,
                ServerMsg::ArenaEvent {
                    kind: sim::ev::SWING,
                    ..
                }
            )),
            "swings are seen"
        );
        // b leaves: a bot takes the place.
        send(&mut inst, 2, ClientMsg::ArenaLeave {});
        inst.flush();
        a.pump();
        let (_, slots) = last_state(&a).unwrap();
        assert!(sim::is_bot(slots[1]));
        // a leaves too: nobody left, called off; a's back out the gate.
        send(&mut inst, 1, ClientMsg::ArenaLeave {});
        inst.flush();
        a.pump();
        assert_eq!(last_state(&a).unwrap().0, sim::LOBBY);
        assert_eq!(inst.avatars[&1].tile, (20, 4));
    }
}
