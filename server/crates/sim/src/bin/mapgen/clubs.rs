//! The Club Hall (ADR 0014): its lobby (`club_hall`, behind the door in the
//! Club Hall block) and the club room every club rents (`clubroom`, one
//! instance per club, like a home). Leaving a club room, you come down the
//! lobby's stairs (`door:clubroom`).

use super::Builder;
use commons_sim::map::MapFile;

/// Panelled walls, the way out at the bottom middle.
fn walls(b: &mut Builder, w: u16, h: u16, door: (u16, u16)) {
    for x in 0..w {
        b.decor(x, 0, "library_wall");
        if !(door.0..door.0 + door.1).contains(&x) {
            b.decor(x, h - 1, "library_wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "library_wall");
        b.decor(w - 1, y, "library_wall");
    }
}

/// The lobby: the front desk (found a club, see yours), the directory of
/// clubs on the wall, the week's leaderboard and the "What's on" board of
/// club events (C3), the stairs up to the club rooms, armchairs to wait in.
pub fn lobby() -> MapFile {
    let (w, h) = (32u16, 20u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "parquet");
    let door = (15u16, 2u16);
    walls(&mut b, w, h, door);
    // A runner from the door to the desk, and a rug by the armchairs.
    b.rect(15, 9, 2, h - 10, "rug");
    b.rect(3, 11, 8, 5, "rug");
    b.object("club_directory", 6, 1, 6, 1, Some("Club directory"), true);
    b.object(
        "club_leaderboard",
        14,
        1,
        4,
        1,
        Some("Clubs of the week"),
        true,
    );
    b.object("club_events", 18, 1, 3, 1, Some("What's on"), true);
    b.object("club_desk", 12, 7, 8, 1, Some("Club desk"), true);
    b.object(
        "club_stairs",
        24,
        1,
        4,
        1,
        Some("Up to the club rooms"),
        true,
    );
    b.object("spot", 25, 2, 1, 1, Some("door:clubroom"), false);
    for (x, y) in [(4u16, 12u16), (6, 12), (8, 12), (4, 14), (8, 14)] {
        b.decor(x, y, "chair");
    }
    b.decor(6, 14, "reading_table");
    for (x, y) in [(1u16, 1u16), (13, 1), (22, 1), (30, 1), (1, 17), (30, 17)] {
        b.decor(x, y, "potted_plant");
    }
    b.decor(27, 12, "globe");
    b.object(
        "signpost",
        18,
        h - 3,
        1,
        1,
        Some("Club Hall: found a club at the desk, or go up to your club's room."),
        true,
    );
    b.object(
        "clubhall_exit",
        door.0,
        h - 1,
        door.1,
        1,
        Some("To the city"),
        true,
    );
    b.finish("Club Hall", (16, h - 3))
}

/// A club's room: its banner (crest and colours) on the back wall, the
/// board, a long table, armchairs round a rug.
pub fn room() -> MapFile {
    let (w, h) = (20u16, 14u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "parquet");
    let door = (9u16, 2u16);
    walls(&mut b, w, h, door);
    b.object("club_banner", 8, 1, 4, 1, Some("Banner"), true);
    b.object("club_board", 2, 1, 3, 1, Some("Club board"), true);
    b.rect(5, 6, 10, 5, "rug");
    for x in 7..13u16 {
        b.decor(x, 8, "reading_table");
        b.decor(x, 7, "chair");
        b.decor(x, 9, "chair_n");
    }
    for (x, y) in [(1u16, 1u16), (18, 1), (1, 12), (18, 12)] {
        b.decor(x, y, "potted_plant");
    }
    b.decor(16, 4, "globe");
    b.object(
        "clubroom_exit",
        door.0,
        h - 1,
        door.1,
        1,
        Some("Down to the Club Hall"),
        true,
    );
    b.finish("Club room", (10, h - 3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_in_the_hall_and_rooms_can_be_reached() {
        for map in [lobby(), room()] {
            let grid = map.grid();
            let from = (map.spawn.x, map.spawn.y);
            for o in map.objects.iter().filter(|o| o.kind != "spot") {
                // Used from the tile in front (the exit: from above it).
                let to = if o.y + o.h >= map.height {
                    (o.x, o.y - 1)
                } else {
                    (o.x, o.y + o.h)
                };
                assert!(
                    commons_sim::find_path(&grid, from, to, 100_000).is_some(),
                    "{}: {} unreachable",
                    map.name,
                    o.kind
                );
            }
        }
    }
}
