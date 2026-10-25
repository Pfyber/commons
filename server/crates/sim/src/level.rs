//! How good the bots are, in the minigames that have them (the arena, the
//! Splat Yard): picked in each one's lobby. Medium is how they always played.

pub const EASY: u8 = 0;
pub const MEDIUM: u8 = 1;
pub const HARD: u8 = 2;

/// A level off the wire (anything past hard is hard).
pub fn clamp(level: u8) -> u8 {
    level.min(HARD)
}
