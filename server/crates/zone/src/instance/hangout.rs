//! M2 "hang out" activities on the instance actor: sitting, table games and
//! the big screen (spec §7).

use super::Instance;
use crate::games::MoveError;
use commons_protocol::{ELDER_ID, SEAT_GROUND, ServerMsg, error_code, game_status, state};
use commons_sim::furniture::{Side, adjacent};

/// The zone's single big screen.
const SCREEN_ID: u32 = 1;
/// How long the Park Elder "thinks" before moving.
const ELDER_THINK_MS: u32 = 900;

/// The Park Elder playing one side of a table.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Elder {
    side: Side,
    /// When to make the next move, if it's the elder's turn.
    due: Option<u32>,
}

impl Instance {
    // ---- sitting -----------------------------------------------------------

    /// `Sit` from the client. While walking, the request is kept and applied
    /// on arrival, so clients can send MoveTo + Sit together.
    pub(super) fn sit(&mut self, id: u32, seat: u32, now: u32) {
        if self.moving(id, now) {
            self.avatars.get_mut(&id).unwrap().pending = Some(super::Pending::Sit(seat));
            return;
        }
        self.try_sit(id, seat, now);
    }

    pub(super) fn try_sit(&mut self, id: u32, seat: u32, now: u32) {
        let a = &self.avatars[&id];
        if a.state == state::SITTING {
            if a.seat == Some(seat) {
                return;
            }
            self.stand(id, now);
        }
        let tile = self.avatars[&id].tile;
        let seat_tile = if seat == SEAT_GROUND {
            tile
        } else {
            let Some(s) = self.zone.furniture.seats.get(&seat) else {
                return self.error(id, error_code::BAD_MESSAGE, "that's not a seat");
            };
            if self.seat_occupant.contains_key(&seat) {
                return self.error(id, error_code::SEAT_TAKEN, "someone is sitting there");
            }
            if !adjacent(tile, s.tile) {
                return self.error(id, error_code::TOO_FAR, "walk a little closer");
            }
            s.tile
        };

        let a = self.avatars.get_mut(&id).unwrap();
        a.motion = None;
        a.state = state::SITTING;
        a.stand_tile = tile;
        a.tile = seat_tile;
        if seat != SEAT_GROUND {
            a.seat = Some(seat);
            self.seat_occupant.insert(seat, id);
        }
        if seat_tile != tile {
            self.on_tile_changed(id, now);
        }
        let cell = self.cell_of(seat_tile);
        let msg = ServerMsg::StateChange {
            id,
            state: state::SITTING,
            x: seat_tile.0,
            y: seat_tile.1,
        };
        self.broadcast(cell, &msg, None);
        if let Some((table, _)) = self.zone.furniture.seats.get(&seat).and_then(|s| s.table) {
            self.table_changed(table);
        } else if seat != SEAT_GROUND {
            // Sharing a bench: anyone seated right next to us.
            let near: Vec<u32> = self
                .seat_occupant
                .iter()
                .filter(|&(&s, &who)| {
                    who != id
                        && self.zone.furniture.seats.get(&s).is_some_and(|s| {
                            (s.tile.0 as i32 - seat_tile.0 as i32).abs() <= 1
                                && (s.tile.1 as i32 - seat_tile.1 as i32).abs() <= 1
                        })
                })
                .map(|(_, &who)| who)
                .collect();
            if !near.is_empty() {
                self.sat_together(&[id]);
                self.sat_together(&near);
            }
        }
    }

    /// Marks avatars as having sat with someone (reported with activity).
    fn sat_together(&mut self, ids: &[u32]) {
        for id in ids {
            if let Some(a) = self.avatars.get_mut(id) {
                a.sat_together = true;
            }
        }
    }

    pub(super) fn stand(&mut self, id: u32, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        a.pending = None;
        if a.state != state::SITTING {
            return;
        }
        a.state = state::IDLE;
        let seat = a.seat.take();
        let moved = a.tile != a.stand_tile;
        a.tile = a.stand_tile;
        let tile = a.tile;
        if let Some(seat) = seat {
            self.seat_occupant.remove(&seat);
        }
        if moved {
            self.on_tile_changed(id, now);
        }
        let cell = self.cell_of(tile);
        let msg = ServerMsg::StateChange {
            id,
            state: state::IDLE,
            x: tile.0,
            y: tile.1,
        };
        self.broadcast(cell, &msg, None);
        if let Some((table, _)) = seat
            .and_then(|s| self.zone.furniture.seats.get(&s))
            .and_then(|s| s.table)
        {
            self.table_changed(table);
        }
    }

    /// Frees a leaving avatar's seat without messages to the avatar itself.
    pub(super) fn leave_seat(&mut self, id: u32) {
        let Some(seat) = self.avatars.get_mut(&id).and_then(|a| a.seat.take()) else {
            return;
        };
        self.seat_occupant.remove(&seat);
        if let Some((table, _)) = self.zone.furniture.seats.get(&seat).and_then(|s| s.table) {
            self.table_changed(table);
        }
    }

    // ---- table games -------------------------------------------------------

    /// Who plays white and black: a seated player, the Park Elder, or 0.
    fn players(&self, table: u32) -> (u32, u32) {
        let t = &self.zone.furniture.tables[&table];
        let elder = self.elders.get(&table).map(|e| e.side);
        let occ = |s, side| match self.seat_occupant.get(&s) {
            Some(&id) => id,
            None if elder == Some(side) => ELDER_ID,
            None => 0,
        };
        (
            occ(t.white_seat, Side::White),
            occ(t.black_seat, Side::Black),
        )
    }

    /// Seated players only (the elder doesn't count).
    fn humans(&self, table: u32) -> (u32, u32) {
        let t = &self.zone.furniture.tables[&table];
        let occ = |s| self.seat_occupant.get(&s).copied().unwrap_or(0);
        (occ(t.white_seat), occ(t.black_seat))
    }

    /// Schedules the elder's reply if it's its turn.
    fn elder_schedule(&mut self, table: u32, now: u32) {
        let Some(game) = self.games.get(&table) else {
            return;
        };
        let turn = if game.white_to_move() {
            Side::White
        } else {
            Side::Black
        };
        let playing = game.status == game_status::PLAYING;
        if let Some(e) = self.elders.get_mut(&table) {
            e.due = (playing && e.side == turn).then_some(now + ELDER_THINK_MS);
        }
    }

    /// Plays the elder's due moves (called every tick).
    pub(super) fn elder_tick(&mut self, now: u32) {
        let due: Vec<u32> = self
            .elders
            .iter()
            .filter(|(_, e)| e.due.is_some_and(|d| d <= now))
            .map(|(&t, _)| t)
            .collect();
        for table in due {
            let side = self.elders[&table].side;
            self.elders.get_mut(&table).unwrap().due = None;
            let game = self.games.entry(table).or_default();
            if let Some(mv) = game.elder_move(now as u64 ^ ((table as u64) << 32)) {
                let _ = game.play(side == Side::White, &mv);
            }
            self.broadcast_game(table);
        }
    }

    fn game_state(&self, table: u32) -> ServerMsg {
        let (white, black) = self.players(table);
        let game = self.games.get(&table).cloned().unwrap_or_default();
        ServerMsg::GameState {
            table,
            status: game.status,
            white,
            black,
            fen: game.fen(),
            last: game.last.clone(),
            legal: game.legal(),
        }
    }

    fn broadcast_game(&mut self, table: u32) {
        let tile = self.zone.furniture.tables[&table].tile;
        let msg = self.game_state(table);
        self.broadcast(self.cell_of(tile), &msg, None);
    }

    /// Starts a game when both seats fill; abandons it when a player leaves.
    /// The elder leaves when the table empties or someone takes its seat.
    fn table_changed(&mut self, table: u32) {
        if let Some(e) = self.elders.get(&table) {
            let (hw, hb) = self.humans(table);
            let taken = match e.side {
                Side::White => hw != 0,
                Side::Black => hb != 0,
            };
            if taken || (hw == 0 && hb == 0) {
                self.elders.remove(&table);
                if taken {
                    // A real opponent sat down: a fresh game between people.
                    self.games.entry(table).or_default().reset_waiting();
                }
            }
        }
        let (white, black) = self.players(table);
        let both = white != 0 && black != 0;
        let game = self.games.entry(table).or_default();
        if both && game.status == game_status::WAITING {
            game.start();
            // A game with someone (the Park Elder counts) is sitting together.
            self.sat_together(&[white, black]);
        } else if !both && game.status != game_status::WAITING {
            game.reset_waiting();
        }
        self.broadcast_game(table);
    }

    /// GameState for every table in `cell`, sent when a client starts watching it.
    pub(super) fn games_in_cell(&self, cell: u16) -> Vec<ServerMsg> {
        self.zone
            .furniture
            .tables
            .iter()
            .filter(|(_, t)| self.cell_of(t.tile) == cell)
            .map(|(&id, _)| self.game_state(id))
            .collect()
    }

    pub(super) fn game_move(&mut self, id: u32, table: u32, uci: &str, now: u32) {
        let a = self.avatars.get_mut(&id).unwrap();
        if !a.game_rl.try_take(now as u64) {
            return;
        }
        let side = a
            .seat
            .and_then(|s| self.zone.furniture.seats.get(&s))
            .and_then(|s| s.table);
        let white = match side {
            Some((t, side)) if t == table => side == Side::White,
            _ => return self.error(id, error_code::TOO_FAR, "sit at the table to play"),
        };
        let (wp, bp) = self.players(table);
        if uci == "elder" {
            // Only for someone sitting alone at a free table.
            if (wp == 0) == (bp == 0) || self.elders.contains_key(&table) {
                return;
            }
            let side = if wp == 0 { Side::White } else { Side::Black };
            self.elders.insert(table, Elder { side, due: None });
            self.table_changed(table);
            self.elder_schedule(table, now);
            return;
        }
        let game = self.games.entry(table).or_default();
        match uci {
            "new" if wp != 0 && bp != 0 && game.is_over() => game.start(),
            "new" => return,
            "resign" => game.resign(white),
            _ => match game.play(white, uci) {
                Ok(()) => {}
                Err(MoveError::NotYourTurn) => {
                    return self.error(id, error_code::ILLEGAL_MOVE, "it's not your turn");
                }
                Err(MoveError::NotPlaying) => {
                    return self.error(id, error_code::ILLEGAL_MOVE, "the game hasn't started");
                }
                Err(MoveError::Illegal) => {
                    return self.error(id, error_code::ILLEGAL_MOVE, "that move isn't legal");
                }
            },
        }
        self.broadcast_game(table);
        self.elder_schedule(table, now);
    }

    // ---- big screen ----------------------------------------------------------

    pub(super) fn screen_state(&self, now: u32) -> Option<ServerMsg> {
        let playlist = self.zone.playlist.as_ref()?;
        let (_, p, started_t) = playlist.at(now);
        Some(ServerMsg::ScreenState {
            screen: SCREEN_ID,
            title: p.title.clone(),
            source: p.source.clone(),
            started_t,
            duration_ms: p.duration_s * 1000,
        })
    }

    /// Announces programme changes to everyone in the instance.
    pub(super) fn screen_tick(&mut self, now: u32) {
        let Some(playlist) = self.zone.playlist.clone() else {
            return;
        };
        let (index, _, _) = playlist.at(now);
        if self.screen_index == Some(index) {
            return;
        }
        let first = self.screen_index.is_none();
        self.screen_index = Some(index);
        if first {
            return; // joiners already received the current programme
        }
        let bytes = self.screen_state(now).unwrap().to_bytes();
        for a in self.avatars.values_mut() {
            a.send(&bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::instance::tests::*;
    use crate::instance::*;
    use commons_protocol::{ClientMsg, SEAT_GROUND, ServerMsg, game_status, state};

    #[test]
    fn sit_on_bench_and_play_chess() {
        let mut inst = chess_instance();
        let mut a = connect(&mut inst, 1, "white", (20, 12));
        let mut b = connect(&mut inst, 2, "black", (20, 12));
        // Table at (5,5): benches at (4,5) white and (6,5) black.
        place(&mut inst, 1, (4, 6));
        place(&mut inst, 2, (6, 4));
        let (ws, bs, table) = (5 * 16 + 4, 5 * 16 + 6, 5 * 16 + 5);
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Sit { seat: ws },
        });
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::Sit { seat: bs },
        });
        assert_eq!(inst.avatars[&1].state, state::SITTING);
        assert_eq!(inst.avatars[&1].tile, (4, 5));
        assert_eq!(inst.games[&table].status, game_status::PLAYING);
        assert!(
            inst.avatars[&1].sat_together && inst.avatars[&2].sat_together,
            "a game together counts for the Caretaker's 'sit with someone'"
        );

        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::GameMove {
                table,
                uci: "e7e5".into(),
            },
        });
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::GameMove {
                table,
                uci: "e2e4".into(),
            },
        });
        inst.flush();
        b.pump();
        let last = b.log.iter().rev().find_map(|m| match m {
            ServerMsg::GameState {
                last, white, black, ..
            } => Some((last.clone(), *white, *black)),
            _ => None,
        });
        assert_eq!(last, Some(("e2e4".into(), 1, 2)));
        assert!(b.log.iter().any(|m| matches!(
            m,
            ServerMsg::StateChange {
                id: 1,
                state: state::SITTING,
                x: 4,
                y: 5
            }
        )));

        // Black walks away: the game is abandoned and white's seat stays taken.
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::MoveTo { x: 10, y: 10 },
        });
        assert_eq!(inst.avatars[&2].state, state::IDLE);
        assert_eq!(inst.avatars[&2].tile, (6, 4));
        assert_eq!(inst.games[&table].status, game_status::WAITING);

        // Someone else can't take white's seat.
        let mut c = connect(&mut inst, 3, "c", (20, 12));
        place(&mut inst, 3, (3, 5));
        inst.handle(Cmd::Msg {
            conn: 3,
            msg: ClientMsg::Sit { seat: ws },
        });
        inst.flush();
        c.pump();
        assert!(c.log.iter().any(|m| matches!(
            m,
            ServerMsg::Error {
                code: commons_protocol::error_code::SEAT_TAKEN,
                ..
            }
        )));
        a.pump();
    }

    #[test]
    fn the_park_elder_plays_when_nobody_else_is_around() {
        let mut inst = chess_instance();
        let mut a = connect(&mut inst, 1, "black", (20, 12));
        let (bs, table) = (5 * 16 + 6, 5 * 16 + 5);
        place(&mut inst, 1, (6, 4));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Sit { seat: bs },
        });
        let ask = |inst: &mut Instance| {
            inst.handle(Cmd::Msg {
                conn: 1,
                msg: ClientMsg::GameMove {
                    table,
                    uci: "elder".into(),
                },
            })
        };
        ask(&mut inst);
        assert_eq!(inst.games[&table].status, game_status::PLAYING);
        assert_eq!(inst.players(table), (commons_protocol::ELDER_ID, 1));

        // The elder has white and moves first, after thinking a moment.
        let now = inst.clock.now_ms();
        inst.elder_tick(now);
        assert!(inst.games[&table].white_to_move(), "not yet");
        inst.elder_tick(now + 1000);
        assert!(!inst.games[&table].white_to_move(), "the elder moved");
        let reply = inst.games[&table].legal()[0].clone();
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::GameMove { table, uci: reply },
        });
        inst.elder_tick(now + 3000);
        assert!(!inst.games[&table].white_to_move(), "and answered");

        // Someone real takes the elder's seat: a fresh game between people.
        let mut b = connect(&mut inst, 2, "white", (20, 12));
        place(&mut inst, 2, (4, 6));
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::Sit { seat: 5 * 16 + 4 },
        });
        assert!(inst.elders.is_empty());
        assert_eq!(inst.players(table), (2, 1));
        assert_eq!(inst.games[&table].status, game_status::PLAYING);
        assert_eq!(inst.games[&table].last, "", "a new game");

        // Asking for the elder at a full table does nothing.
        ask(&mut inst);
        assert!(inst.elders.is_empty());

        // Alone again and the elder sits in; leaving sends it home too.
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::MoveTo { x: 10, y: 10 },
        });
        ask(&mut inst);
        assert_eq!(inst.players(table), (commons_protocol::ELDER_ID, 1));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo { x: 10, y: 10 },
        });
        assert!(inst.elders.is_empty());
        assert_eq!(inst.games[&table].status, game_status::WAITING);
        inst.flush();
        a.pump();
        b.pump();
    }

    #[test]
    fn sit_request_while_walking_applies_on_arrival() {
        let mut inst = chess_instance();
        let _a = connect(&mut inst, 1, "a", (20, 12));
        place(&mut inst, 1, (1, 1));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::MoveTo { x: 3, y: 5 },
        });
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Sit { seat: 5 * 16 + 4 },
        });
        assert_eq!(inst.avatars[&1].state, state::IDLE);
        let mut now = inst.clock.now_ms();
        for _ in 0..30 {
            now += 100;
            inst.step(now);
        }
        assert_eq!(inst.avatars[&1].state, state::SITTING);
        assert_eq!(inst.avatars[&1].tile, (4, 5));
        // Standing returns to where they sat down from.
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Stand {},
        });
        assert_eq!(inst.avatars[&1].tile, (3, 5));
    }

    #[test]
    fn ground_sit_and_leaving_frees_seats() {
        let mut inst = chess_instance();
        let _a = connect(&mut inst, 1, "a", (20, 12));
        inst.handle(Cmd::Msg {
            conn: 1,
            msg: ClientMsg::Sit { seat: SEAT_GROUND },
        });
        assert_eq!(inst.avatars[&1].state, state::SITTING);
        let _b = connect(&mut inst, 2, "b", (20, 12));
        place(&mut inst, 2, (4, 4));
        inst.handle(Cmd::Msg {
            conn: 2,
            msg: ClientMsg::Sit { seat: 5 * 16 + 4 },
        });
        assert_eq!(inst.seat_occupant.len(), 1);
        inst.handle(Cmd::Leave { conn: 2 });
        assert!(inst.seat_occupant.is_empty());
    }
}
