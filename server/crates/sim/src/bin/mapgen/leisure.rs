//! The arcade and the bar (from the arcade and bar merge): their own small
//! zones behind doors in the city, the arcade in the Arcade block and the
//! bar, The Mossy Mug, in the Café block. Leaving, you come out of the same
//! door (`door:arcade`, `door:bar`).

use super::Builder;
use commons_sim::map::MapFile;

/// Inside the bar (spec: a cosy room of wood): log walls, a counter with
/// shelves of bottles behind it and stools in front, two little tables,
/// barrels, the pool table, and a pinball machine in the corner, played from
/// its left side. The door leads back out to the city.
pub fn bar() -> MapFile {
    let (w, h) = (20u16, 13u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "tavern_floor");
    for x in 0..w {
        b.decor(x, 0, "wood_wall");
        if !(9..=10).contains(&x) {
            b.decor(x, h - 1, "wood_wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "wood_wall");
        b.decor(w - 1, y, "wood_wall");
    }
    // The bar: shelves on the back wall, the bartender's aisle, the counter.
    b.object("bottle_shelf", 2, 1, 8, 1, Some("Bottles"), true);
    b.object("bar_counter", 2, 3, 8, 1, Some("Bar"), true);
    for x in [3, 5, 7, 9] {
        b.decor(x, 4, "stool");
    }
    // Two little tables, a stool either side.
    for (tx, ty) in [(4u16, 8u16), (8, 9)] {
        b.decor(tx, ty, "bar_table");
        b.decor(tx - 1, ty, "stool");
        b.decor(tx + 1, ty, "stool");
    }
    b.object("pool_table", 12, 4, 4, 2, Some("Pool table"), true);
    b.object("pinball", 16, 9, 3, 2, Some("Pinball"), true);
    for (x, y) in [(1u16, 1u16), (1, 11), (18, 1), (11, 1)] {
        b.decor(x, y, "barrel");
    }
    b.decor(17, 6, "lantern");
    b.decor(2, 6, "lantern");
    b.object("bar_exit", 9, h - 1, 2, 1, Some("To the city"), true);
    b.finish("The Mossy Mug", (9, 10))
}

/// Inside the arcade: a dim carpeted hall, seven cabinets along the back
/// wall, the Dance Off machine with its light-up floor on the left, tables
/// on the right, claw machines and the prize counter. The door leads back
/// out to the city.
pub fn arcade() -> MapFile {
    let (w, h) = (26u16, 16u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "arcade_carpet");
    for x in 0..w {
        b.decor(x, 0, "neon_wall");
        if !(12..=13).contains(&x) {
            b.decor(x, h - 1, "neon_wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "neon_wall");
        b.decor(w - 1, y, "neon_wall");
    }
    // The cabinets, in a row a step out from the back wall (so their tops
    // aren't cut off at the map's edge), then the dance machine.
    // Their order is their number in ArcadeJoin; the label is the game.
    let games = [
        "Pong",
        "Light Cycles",
        "Connect Four",
        "Memory Match",
        "Basket Catch",
        "Turbo Racer",
        "Tank Duel",
    ];
    for (i, game) in games.iter().enumerate() {
        b.object(
            "arcade_cabinet",
            2 + i as u16 * 3,
            2,
            2,
            2,
            Some(game),
            true,
        );
    }
    b.object("dance_machine", 2, 7, 4, 2, Some("Dance Off"), true);
    // The dancers stand on the light-up floor in front of it.
    b.object("dance_floor", 2, 9, 4, 1, None, false);
    // Two tables with stools, in a tidy row on the right.
    for ty in [7u16, 10] {
        b.decor(22, ty, "bar_table");
        b.decor(21, ty, "stool");
        b.decor(23, ty, "stool");
    }
    b.object("claw_machine", 2, 12, 2, 2, Some("Claw machine"), true);
    b.object("claw_machine", 5, 12, 2, 2, Some("Claw machine"), true);
    b.object("prize_counter", 15, 13, 6, 1, Some("Prizes"), true);
    b.object("arcade_exit", 12, h - 1, 2, 1, Some("To the city"), true);
    b.finish("Arcade", (12, 13))
}
