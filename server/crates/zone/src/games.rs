//! Table games (spec §7). Chess for M2; the server is authoritative for every
//! move and sends the legal moves, so clients need no chess rules.

use chess::{Board, BoardStatus, ChessMove, Color, MoveGen, Piece};
use commons_protocol::game_status;
use std::str::FromStr;

/// Games longer than this are declared drawn (stands in for the 50-move and
/// repetition rules, which the move generator doesn't track).
const MAX_PLIES: u16 = 400;

#[derive(Debug, Clone)]
pub struct ChessGame {
    board: Board,
    pub status: u8,
    pub last: String,
    plies: u16,
}

impl Default for ChessGame {
    fn default() -> Self {
        ChessGame {
            board: Board::default(),
            status: game_status::WAITING,
            last: String::new(),
            plies: 0,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MoveError {
    NotPlaying,
    NotYourTurn,
    Illegal,
}

impl ChessGame {
    pub fn start(&mut self) {
        *self = ChessGame {
            status: game_status::PLAYING,
            ..Default::default()
        };
    }

    pub fn reset_waiting(&mut self) {
        *self = ChessGame::default();
    }

    pub fn is_over(&self) -> bool {
        matches!(
            self.status,
            game_status::WHITE_WON | game_status::BLACK_WON | game_status::DRAW
        )
    }

    pub fn white_to_move(&self) -> bool {
        self.board.side_to_move() == Color::White
    }

    pub fn play(&mut self, white: bool, uci: &str) -> Result<(), MoveError> {
        if self.status != game_status::PLAYING {
            return Err(MoveError::NotPlaying);
        }
        if white != self.white_to_move() {
            return Err(MoveError::NotYourTurn);
        }
        let mv = ChessMove::from_str(uci).map_err(|_| MoveError::Illegal)?;
        if !self.board.legal(mv) {
            return Err(MoveError::Illegal);
        }
        self.board = self.board.make_move_new(mv);
        self.last = mv.to_string();
        self.plies += 1;
        self.status = match self.board.status() {
            BoardStatus::Checkmate if white => game_status::WHITE_WON,
            BoardStatus::Checkmate => game_status::BLACK_WON,
            BoardStatus::Stalemate => game_status::DRAW,
            BoardStatus::Ongoing if self.plies >= MAX_PLIES => game_status::DRAW,
            BoardStatus::Ongoing => game_status::PLAYING,
        };
        Ok(())
    }

    pub fn resign(&mut self, white: bool) {
        if self.status == game_status::PLAYING {
            self.status = if white {
                game_status::BLACK_WON
            } else {
                game_status::WHITE_WON
            };
        }
    }

    pub fn fen(&self) -> String {
        self.board.to_string()
    }

    /// The Park Elder's reply: a gentle opponent for when nobody else is
    /// around. Looks two plies ahead (its move and your answer) on material
    /// alone, with a little noise from `seed` so games differ and it can be
    /// beaten. `None` if it isn't playing or has no move.
    pub fn elder_move(&self, seed: u64) -> Option<String> {
        if self.status != game_status::PLAYING {
            return None;
        }
        let mut best: Option<(i32, ChessMove)> = None;
        for (i, mv) in MoveGen::new_legal(&self.board).enumerate() {
            let child = self.board.make_move_new(mv);
            let noise = (mix(seed ^ (i as u64 + 1)) % 41) as i32 - 20;
            let score = -negamax(&child, 1, -MATE, MATE) + noise;
            if best.is_none_or(|(b, _)| score > b) {
                best = Some((score, mv));
            }
        }
        best.map(|(_, mv)| mv.to_string())
    }

    pub fn legal(&self) -> Vec<String> {
        if self.status != game_status::PLAYING {
            return Vec::new();
        }
        MoveGen::new_legal(&self.board)
            .map(|m| m.to_string())
            .collect()
    }
}

const MATE: i32 = 100_000;

fn mix(mut h: u64) -> u64 {
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^ (h >> 33)
}

/// Material balance from the side to move's point of view, in centipawns.
fn material(board: &Board) -> i32 {
    const VALUES: [(Piece, i32); 5] = [
        (Piece::Pawn, 100),
        (Piece::Knight, 300),
        (Piece::Bishop, 320),
        (Piece::Rook, 500),
        (Piece::Queen, 900),
    ];
    let us = board.color_combined(board.side_to_move());
    let them = board.color_combined(!board.side_to_move());
    VALUES
        .iter()
        .map(|&(piece, v)| {
            let p = board.pieces(piece);
            ((p & us).popcnt() as i32 - (p & them).popcnt() as i32) * v
        })
        .sum()
}

/// Plain alpha-beta negamax on material; mates are scored as such.
fn negamax(board: &Board, depth: u8, mut alpha: i32, beta: i32) -> i32 {
    match board.status() {
        BoardStatus::Checkmate => return -MATE,
        BoardStatus::Stalemate => return 0,
        BoardStatus::Ongoing => {}
    }
    if depth == 0 {
        return material(board);
    }
    let mut best = -MATE;
    for mv in MoveGen::new_legal(board) {
        let score = -negamax(&board.make_move_new(mv), depth - 1, -beta, -alpha);
        best = best.max(score);
        alpha = alpha.max(score);
        if alpha >= beta {
            break;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plays_fools_mate() {
        let mut g = ChessGame::default();
        assert_eq!(g.play(true, "e2e4"), Err(MoveError::NotPlaying));
        g.start();
        assert_eq!(g.legal().len(), 20);
        assert_eq!(g.play(false, "e7e5"), Err(MoveError::NotYourTurn));
        assert_eq!(g.play(true, "e2e5"), Err(MoveError::Illegal));
        assert_eq!(g.play(true, "garbage"), Err(MoveError::Illegal));
        for (white, mv) in [
            (true, "f2f3"),
            (false, "e7e5"),
            (true, "g2g4"),
            (false, "d8h4"),
        ] {
            g.play(white, mv).unwrap();
        }
        assert_eq!(g.status, game_status::BLACK_WON);
        assert_eq!(g.last, "d8h4");
        assert!(g.is_over() && g.legal().is_empty());
    }

    #[test]
    fn elder_takes_free_material_and_mates_in_one() {
        // Black's queen wandered to f5, where the e4 pawn can take it.
        let mut g = ChessGame::default();
        g.start();
        for (white, mv) in [
            (true, "e2e4"),
            (false, "e7e6"),
            (true, "a2a3"),
            (false, "d8f6"),
            (true, "a3a4"),
            (false, "f6f5"),
        ] {
            g.play(white, mv).unwrap();
        }
        assert_eq!(g.elder_move(7).as_deref(), Some("e4f5"));

        // Fool's mate is there for black: the elder finds it.
        let mut g = ChessGame::default();
        g.start();
        for (white, mv) in [(true, "f2f3"), (false, "e7e5"), (true, "g2g4")] {
            g.play(white, mv).unwrap();
        }
        assert_eq!(g.elder_move(3).as_deref(), Some("d8h4"));
    }

    #[test]
    fn elder_varies_its_replies() {
        let mut g = ChessGame::default();
        g.start();
        g.play(true, "e2e4").unwrap();
        let replies: std::collections::HashSet<String> = (0..40u64)
            .map(|seed| g.elder_move(seed * 1_000 + 17).unwrap())
            .collect();
        assert!(replies.len() >= 5, "only {replies:?}");
    }

    #[test]
    fn elder_plays_legal_games_to_the_end() {
        let mut g = ChessGame::default();
        g.start();
        let mut plies = 0;
        while let Some(mv) = g.elder_move(plies) {
            let white = g.white_to_move();
            g.play(white, &mv).unwrap();
            plies += 1;
        }
        assert!(
            g.is_over(),
            "a game between two elders finishes ({plies} plies)"
        );
    }

    #[test]
    fn resign_and_restart() {
        let mut g = ChessGame::default();
        g.start();
        g.resign(true);
        assert_eq!(g.status, game_status::BLACK_WON);
        g.start();
        assert_eq!(g.status, game_status::PLAYING);
        assert!(g.white_to_move());
    }
}
