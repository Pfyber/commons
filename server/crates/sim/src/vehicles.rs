//! Vehicles (ADR 0011, M6): cosmetic speed outdoors. A vehicle's `code` (in
//! its item's meta, and in protocol `EntityInfo::vehicle`) picks how it looks
//! and how fast it goes; [`TEST_RIDE`] marks a ride on the mall's test track
//! (anything on show there, owned or not, but only on the track).

use crate::WALK_SPEED_X10;

/// Set on a ride that's a test ride on the mall's track.
pub const TEST_RIDE: u8 = 0x80;

/// The ground the mall's test track is made of.
pub const TRACK_GROUND: &str = "track";

/// How much faster than walking each vehicle goes, in tenths.
const SPEEDUP_X10: [(u8, u16); 4] = [
    (1, 13), // roller skates
    (2, 15), // kick scooter
    (3, 18), // city bike
    (4, 18), // vintage bike
];

/// Speed riding vehicle `code` (test-ride bit ignored), in tenths of a tile
/// a second; `None` for no vehicle (or one that doesn't exist).
pub fn speed_x10(code: u8) -> Option<u8> {
    let code = code & !TEST_RIDE;
    SPEEDUP_X10
        .iter()
        .find(|&&(c, _)| c == code)
        .map(|&(_, k)| (WALK_SPEED_X10 as u16 * k / 10) as u8)
}

/// The vehicle codes there are.
pub fn codes() -> impl Iterator<Item = u8> {
    SPEEDUP_X10.iter().map(|&(c, _)| c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faster_than_walking() {
        assert_eq!(speed_x10(0), None);
        assert_eq!(speed_x10(1), Some(52));
        assert_eq!(speed_x10(3), Some(72));
        assert_eq!(speed_x10(3 | TEST_RIDE), Some(72));
        for c in codes() {
            assert!(speed_x10(c).unwrap() > WALK_SPEED_X10);
        }
    }
}
