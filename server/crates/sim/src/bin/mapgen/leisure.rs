//! The arcade, the bar and the bowling alley (from the merges with the
//! fork): their own small zones behind doors in the city, the arcade in the
//! Arcade block, the bar, The Mossy Mug, in the Café block and the alley in
//! the Bowling block. Leaving, you come out of the same door (`door:arcade`,
//! `door:bar`, `door:bowling`).

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

/// Inside the bowling alley: a dim, carpeted hall with four lanes along the
/// back (pins at the far end, a scoreboard screen over each), benches at the
/// foot of each lane, and the shoe counter on the right with its racks of
/// rental shoes behind. The door leads back out to the city.
pub fn bowling() -> MapFile {
    let (w, h) = (24u16, 16u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "arcade_carpet");
    for x in 0..w {
        b.decor(x, 0, "neon_wall");
        if !(11..=12).contains(&x) {
            b.decor(x, h - 1, "neon_wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "neon_wall");
        b.decor(w - 1, y, "neon_wall");
    }
    // The lanes, a step apart; their order is their number in BowlJoin.
    for i in 0..4u16 {
        let x = 2 + i * 4;
        let name = format!("Lane {}", i + 1);
        b.object("bowling_lane", x, 2, 3, 9, Some(&name), true);
        // Somewhere to sit at the foot of it.
        b.decor(x, 13, "stool");
        b.decor(x + 2, 13, "stool");
    }
    // The shoe counter, its racks against the wall behind.
    b.object("shoe_rack", 18, 1, 5, 1, Some("Shoes"), true);
    b.object("shoe_counter", 18, 4, 5, 1, Some("Shoe rental"), true);
    b.decor(22, 8, "lantern");
    b.object("bowling_exit", 11, h - 1, 2, 1, Some("To the city"), true);
    b.finish("Bowling", (11, 13))
}

/// Inside the Splat Yard: a big timber barn with a paintball field of
/// turf filling most of it (fenced with netting: you go on only in a
/// match), Blue's base on the left and Red's on the right, and between them
/// inflatable snake bunkers, hay bales, crates, tyre stacks, steel drums,
/// hedges to hide in, the big yellow X in the middle and a power-up pad up
/// each flank. Everything on the field is mirrored, so neither side has the
/// better of it. Below: benches to watch from, the sign-up desk, and the
/// door back out to the city.
pub fn paintball() -> MapFile {
    let (w, h) = (46u16, 36u16);
    let (fx, fy, fw, fh) = (3u16, 2u16, 40u16, 24u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "tavern_floor");
    b.rect(fx, fy, fw, fh, "pitch");
    for x in 0..w {
        b.decor(x, 0, "wood_wall");
        if !(22..=23).contains(&x) {
            b.decor(x, h - 1, "wood_wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "wood_wall");
        b.decor(w - 1, y, "wood_wall");
    }
    // The field (solid: nobody wanders on while a match is on).
    b.object("pb_field", fx, fy, fw, fh, Some("Splat Yard"), true);
    // The left half, mirrored onto the right: (kind, x, y, w, h) in field tiles.
    let half: &[(&str, u16, u16, u16, u16)] = &[
        ("pb_snake", 4, 5, 1, 4),
        ("pb_snake", 4, 15, 1, 4),
        ("pb_hay", 5, 11, 1, 2),
        ("pb_hedge", 8, 2, 2, 2),
        ("pb_hedge", 8, 20, 2, 2),
        ("pb_crate", 9, 8, 1, 1),
        ("pb_crate", 10, 8, 1, 1),
        ("pb_crate", 9, 9, 1, 1),
        ("pb_crate", 9, 15, 1, 1),
        ("pb_crate", 10, 15, 1, 1),
        ("pb_crate", 9, 14, 1, 1),
        ("pb_tires", 12, 11, 1, 2),
        ("pb_drum", 13, 4, 1, 1),
        ("pb_drum", 13, 19, 1, 1),
        ("pb_snake", 15, 7, 3, 1),
        ("pb_snake", 15, 16, 3, 1),
        ("pb_hay", 17, 10, 2, 1),
        ("pb_hay", 17, 13, 2, 1),
        ("pb_hedge", 16, 2, 2, 2),
        ("pb_hedge", 16, 20, 2, 2),
        // Two more to lie up in, midfield, either side of the tyres.
        ("pb_hedge", 12, 7, 2, 2),
        ("pb_hedge", 12, 15, 2, 2),
    ];
    for &(k, x, y, ow, oh) in half {
        b.object(k, fx + x, fy + y, ow, oh, None, false);
        b.object(k, fx + fw - x - ow, fy + y, ow, oh, None, false);
    }
    // The middle: the X, and a tyre stack above and below it.
    b.object("pb_x", fx + 19, fy + 11, 2, 2, None, false);
    b.object("pb_tires", fx + 19, fy + 6, 2, 1, None, false);
    b.object("pb_tires", fx + 19, fy + 17, 2, 1, None, false);
    // The power-up pads, up each flank.
    b.object("pb_pad", fx + 19, fy + 1, 2, 2, None, false);
    b.object("pb_pad", fx + 19, fy + 21, 2, 2, None, false);
    // Where each side comes in.
    for y in [8u16, 11, 15] {
        b.object("pb_spawn", fx + 1, fy + y, 1, 1, Some("blue"), false);
        b.object("pb_spawn", fx + fw - 2, fy + y, 1, 1, Some("red"), false);
    }
    // The stands: benches to watch from, lanterns along the wall.
    for x in [4u16, 9, 14, 29, 34, 39] {
        b.decor(x, 28, "bench");
        b.decor(x + 1, 28, "bench");
        b.decor(x + 2, 28, "bench");
    }
    for x in [2u16, 12, 33, 43] {
        b.decor(x, 33, "lantern");
    }
    b.decor(2, 27, "barrel");
    b.decor(43, 27, "barrel");
    // The sign-up desk, the racks of markers, and the way out.
    b.object("pb_desk", 20, 30, 6, 1, Some("Sign up"), true);
    b.object("pb_rack", 4, 32, 4, 1, Some("Markers"), true);
    b.object("pb_rack", 38, 32, 4, 1, Some("Masks"), true);
    b.object("pb_exit", 22, h - 1, 2, 1, Some("To the city"), true);
    b.finish("Splat Yard", (22, 32))
}
