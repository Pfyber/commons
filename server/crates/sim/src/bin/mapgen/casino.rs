//! The Casino (ADR 0017): its own zone behind its doors on the Casino block.
//! Six slot machines along the back wall, the roulette table in the middle
//! on a red carpet with a blackjack table either side (numbered from the
//! left, as `social::tables` numbers them), the cashier's desk (the rules, the limits, today's play,
//! taking a break), little tables to sit at, and the way out.

use super::Builder;
use commons_sim::map::MapFile;

pub fn floor() -> MapFile {
    let (w, h) = (26u16, 18u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "parquet");
    b.rect(2, 6, w - 4, h - 8, "rug");
    let door = (12u16, 2u16);
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
    // The slot machines, a step out from the back wall.
    for i in 0..6u16 {
        b.object("slot_machine", 2 + i * 3, 2, 2, 2, Some("Slots"), true);
    }
    b.object("roulette_table", 8, 8, 8, 3, Some("Roulette"), true);
    b.object("blackjack_table", 2, 8, 5, 3, Some("Blackjack"), true);
    b.object("blackjack_table", 18, 8, 5, 3, Some("Blackjack"), true);
    b.object("casino_cage", 20, 2, 4, 2, Some("Cashier"), true);
    for (x, y) in [(4u16, 13u16), (20, 13)] {
        b.decor(x, y, "bar_table");
        b.decor(x - 1, y, "stool");
        b.decor(x + 1, y, "stool");
    }
    for (x, y) in [(1u16, 1u16), (24, 1), (1, 16), (24, 16)] {
        b.decor(x, y, "potted_plant");
    }
    b.object(
        "signpost",
        15,
        h - 3,
        1,
        1,
        Some("The Casino: coins only, never real money. 16 and over. You can lose 300 coins a day at most; take a break any time at the cashier's."),
        true,
    );
    b.object(
        "casino_exit",
        door.0,
        h - 1,
        door.1,
        1,
        Some("To the city"),
        true,
    );
    b.finish("Casino", (12, h - 3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_machine_the_table_and_the_cashier_can_be_reached() {
        let map = floor();
        let grid = map.grid();
        let from = (map.spawn.x, map.spawn.y);
        for o in map.objects.iter().filter(|o| o.kind != "signpost") {
            let to = if o.y + o.h >= map.height {
                (o.x, o.y - 1)
            } else {
                (o.x, o.y + o.h)
            };
            assert!(
                commons_sim::find_path(&grid, from, to, 100_000).is_some(),
                "{} unreachable",
                o.kind
            );
        }
    }
}
