//! The Concert Hall (ADR 0015): its own zone behind its door on the Theater
//! block. A stage across the front (the performer stands on it), a velvet
//! backdrop, the microphone stand where you take the stage, speakers either
//! side, and rows of seats facing it with an aisle down the middle.

use super::Builder;
use commons_sim::map::MapFile;

pub fn hall() -> MapFile {
    let (w, h) = (28u16, 20u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "parquet");
    let door = (13u16, 2u16);
    for x in 0..w {
        b.decor(x, 0, "wood_wall");
        if !(door.0..door.0 + door.1).contains(&x) {
            b.decor(x, h - 1, "wood_wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "wood_wall");
        b.decor(w - 1, y, "wood_wall");
    }
    // The backdrop and the stage in front of it (walked on: the performer
    // stands there, so it's a marker drawn flat, not a wall).
    // The microphone stands at the front of the stage: listed before the
    // stage, so a tap on it finds the microphone, not the boards.
    b.object("concert_mic", 14, 5, 1, 1, Some("Microphone"), true);
    b.object("concert_curtain", 6, 1, 16, 1, Some("Stage"), true);
    b.object("concert_stage", 6, 2, 16, 4, Some("Stage"), false);
    b.object("spot", 14, 3, 1, 1, Some("stage_spot"), false);
    for x in [4u16, 23] {
        b.object("concert_speaker", x, 2, 1, 2, None, true);
    }
    // A carpet up the aisle, rows of seats either side, facing the stage.
    b.rect(13, 7, 2, h - 8, "rug");
    for y in (8..16u16).step_by(2) {
        for x in (3..12u16).chain(16..25) {
            b.decor(x, y, "chair_n");
        }
    }
    for (x, y) in [(1u16, 1u16), (26, 1), (1, 17), (26, 17)] {
        b.decor(x, y, "potted_plant");
    }
    for y in [7u16, 12] {
        b.decor(1, y, "lantern");
        b.decor(26, y, "lantern");
    }
    b.object(
        "signpost",
        16,
        h - 3,
        1,
        1,
        Some("Concert Hall: take the stage at the microphone, and everyone in the hall hears you (16 and over)."),
        true,
    );
    b.object(
        "concert_exit",
        door.0,
        h - 1,
        door.1,
        1,
        Some("To the city"),
        true,
    );
    b.finish("Concert Hall", (13, h - 3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stage_the_mic_and_every_seat_can_be_reached() {
        let map = hall();
        let grid = map.grid();
        let from = (map.spawn.x, map.spawn.y);
        for to in [(14, 3), (14, 6), (3, 9), (24, 15)] {
            assert!(
                commons_sim::find_path(&grid, from, to, 100_000).is_some(),
                "{to:?} unreachable"
            );
        }
    }
}
