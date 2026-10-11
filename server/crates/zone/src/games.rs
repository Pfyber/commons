//! Table games (spec §7). Chess for M2; the server is authoritative for every
//! move and sends the legal moves, so clients need no chess rules.

use chess::{Board, BoardStatus, ChessMove, Color, MoveGen};
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

    pub fn legal(&self) -> Vec<String> {
        if self.status != game_status::PLAYING {
            return Vec::new();
        }
        MoveGen::new_legal(&self.board)
            .map(|m| m.to_string())
            .collect()
    }
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
