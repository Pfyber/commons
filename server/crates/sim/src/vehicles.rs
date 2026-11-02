//! Vehicles (ADR 0011, M6): real speed outdoors, two to three and a half
//! times walking, so crossing the city on wheels is worth it. A vehicle's `code` (in
//! its item's meta, and in protocol `EntityInfo::vehicle`) picks how it looks
//! and how fast it goes; [`TEST_RIDE`] marks a ride on the mall's test track
//! (anything on show there, owned or not, but only on the track).

use crate::WALK_SPEED_X10;

/// Set on a ride that's a test ride on the mall's track.
pub const TEST_RIDE: u8 = 0x80;

/// The ground the mall's test track is made of.
pub const TRACK_GROUND: &str = "track";

/// The skateboard: free for everyone, with its own pace (`SKATE_SPEED_X10`:
/// a push-off, then a glide).
pub const SKATEBOARD: u8 = 5;
use crate::motion::{SKATE_SPEED_X10, VESPA_SPEED_X10};
/// The Vespa: quick, and quicker the longer it rides (`VESPA_SPEED_X10`).
pub const VESPA: u8 = 10;

/// How much faster than walking each vehicle goes, in tenths: dearer goes
/// faster, and even the cheapest is well past a sprint.
const SPEEDUP_X10: [(u8, u16); 6] = [
    (1, 22), // roller skates
    (2, 27), // kick scooter
    (3, 32), // city bike
    (4, 35), // vintage bike
    (5, 0),  // skateboard: its own speed (`SKATE_SPEED_X10`)
    (10, 0), // Vespa: its own speed (`VESPA_SPEED_X10`)
];

/// Speed riding vehicle `code` (test-ride bit ignored), in tenths of a tile
/// a second; `None` for no vehicle (or one that doesn't exist).
pub fn speed_x10(code: u8) -> Option<u8> {
    let code = code & !TEST_RIDE;
    if code == SKATEBOARD {
        return Some(SKATE_SPEED_X10);
    }
    if code == VESPA {
        return Some(VESPA_SPEED_X10);
    }
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
        assert_eq!(speed_x10(1), Some(88));
        assert_eq!(speed_x10(3), Some(128));
        assert_eq!(speed_x10(3 | TEST_RIDE), Some(128));
        assert_eq!(speed_x10(SKATEBOARD), Some(82));
        for c in codes() {
            // Every one at least twice walking: well past a sprint.
            assert!(speed_x10(c).unwrap() >= 2 * WALK_SPEED_X10);
            assert!(speed_x10(c).unwrap() > crate::SPRINT_SPEED_X10);
        }
    }
}
