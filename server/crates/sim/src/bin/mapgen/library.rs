//! The Library (ADR 0012): the entrance hall (`library`) behind the door in
//! the Library block, and a zone for each wing (`library_<wing>`) through
//! the doors along the hall's north gallery.
//!
//! A wing is laid out like real stacks: rows of bookcases facing south, an
//! aisle in front of each, and (in the big wings) two banks either side of a
//! central aisle, with a sign at each row's end saying what's on it. Study
//! carrels along the side walls, reading tables by the way in.
//!
//! Bookcases are `bookcase` objects labelled with their number in the
//! wing's shelf list; signs are `stack_sign` objects labelled "first-last"
//! (bookcase numbers). The client fills them from the catalogue.

use super::Builder;
use commons_sim::library::{WINGS, Wing};
use commons_sim::map::MapFile;

/// Walls of dark wood panelling with tall windows.
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

/// A long reading table along `x0..x0+len` at row `y`, chairs either side.
fn reading_table(b: &mut Builder, x0: u16, y: u16, len: u16) {
    for x in x0..x0 + len {
        b.decor(x, y, "reading_table");
        b.decor(x, y - 1, "chair");
        b.decor(x, y + 1, "chair_n");
    }
}

/// The entrance hall: marble, a runner from the door to the circulation
/// desk, the eight wing doors along the north gallery, the Reading Room on
/// the west side and New Arrivals on the east.
pub fn hall() -> MapFile {
    let (w, h) = (56u16, 34u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "marble");
    let door = (27u16, 2u16);
    walls(&mut b, w, h, door);
    // The wing doors, each with the spot you step out onto coming back.
    for x in 1..w - 1 {
        b.decor(x, 1, "library_wall");
    }
    for (i, wing) in WINGS.iter().enumerate() {
        let x = 3 + i as u16 * 7;
        for dx in 0..3 {
            b.decor(x + dx, 1, "none");
        }
        let zone = wing.zone();
        b.object("wing_door", x, 1, 3, 1, Some(&zone), true);
        b.object("spot", x + 1, 2, 1, 1, Some(&format!("door:{zone}")), false);
    }
    // The runner, from the door up to the gallery.
    b.rect(26, 5, 4, h - 6, "rug");
    b.rect(2, 3, w - 4, 2, "rug");
    // The circulation desk, the librarian behind it, card catalogues either side.
    b.object("circulation_desk", 23, 14, 10, 1, Some("Circulation"), true);
    b.object("card_catalogue", 19, 14, 2, 1, Some("Catalogue"), true);
    b.object("card_catalogue", 35, 14, 2, 1, Some("Catalogue"), true);
    b.object("spot", 28, 16, 1, 1, Some("circulation"), false);
    // The Reading Room: parquet, long tables with green lamps, and quiet
    // (chat here stays here).
    b.rect(2, 18, 20, 13, "parquet");
    for y in [20u16, 24, 28] {
        reading_table(&mut b, 4, y, 6);
        reading_table(&mut b, 13, y, 6);
    }
    b.object("nook", 2, 18, 20, 13, Some("Reading Room"), false);
    b.object(
        "signpost",
        11,
        17,
        1,
        1,
        Some("Reading Room: quiet, please. What you say here stays here."),
        true,
    );
    // New Arrivals, armchairs, a globe.
    b.object("new_arrivals", 41, 19, 4, 1, Some("New Arrivals"), true);
    b.rect(36, 23, 14, 7, "rug");
    for (x, y) in [
        (38u16, 24u16),
        (41, 24),
        (44, 24),
        (47, 24),
        (38, 28),
        (47, 28),
    ] {
        b.decor(x, y, "chair");
    }
    b.decor(51, 22, "globe");
    for (x, y) in [(23u16, 30u16), (32, 30), (2, 6), (53, 6), (2, 15), (53, 15)] {
        b.decor(x, y, "potted_plant");
    }
    b.object(
        "library_exit",
        door.0,
        h - 1,
        door.1,
        1,
        Some("To the city"),
        true,
    );
    b.finish("Library", (28, h - 3))
}

/// Where a wing's bookcases stand: (x, y) of bookcase `n`'s left tile, from
/// the wing's banks and rows.
struct Stacks {
    banks: u16,
    per_bank: u16,
    /// Left edge of each bank.
    bank_x: [u16; 2],
    first_row: u16,
}

impl Stacks {
    const SIDE: u16 = 4; // wall + carrel + chair + walkway
    const AISLE: u16 = 4;

    fn new(wing: &Wing) -> Self {
        let banks = if wing.cols >= 8 { 2 } else { 1 };
        let per_bank = wing.cols / banks;
        let a = Self::SIDE;
        let b = a + per_bank * 2 + Self::AISLE;
        Stacks {
            banks,
            per_bank,
            bank_x: [a, b],
            first_row: 2,
        }
    }
    fn row_y(&self, r: u16) -> u16 {
        self.first_row + r * 3
    }
    fn case(&self, n: u16) -> (u16, u16) {
        let cols = self.per_bank * self.banks;
        let (r, c) = (n / cols, n % cols);
        let bank = c / self.per_bank;
        (
            self.bank_x[bank as usize] + (c % self.per_bank) * 2,
            self.row_y(r),
        )
    }
    fn width(&self) -> u16 {
        self.bank_x[self.banks as usize - 1] + self.per_bank * 2 + Self::SIDE
    }
}

/// One wing: its stacks, carrels along the side walls, reading tables by
/// the way in, and the door back to the hall. The Children's Library has a
/// rug with cushions for a story circle instead of tables.
pub fn wing(wing: &Wing) -> MapFile {
    let st = Stacks::new(wing);
    // A small wing gets a reading corner beside its single bank.
    let corner = if st.banks == 1 { 10 } else { 0 };
    let w = st.width() + corner;
    let stacks_end = st.row_y(wing.rows - 1) + 3;
    let front = 8u16;
    let h = stacks_end + front;
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "parquet");
    let door = (w / 2 - 1, 2u16);
    walls(&mut b, w, h, door);

    for n in 0..wing.rows * wing.cols {
        let (x, y) = st.case(n);
        b.object("bookcase", x, y, 2, 1, Some(&n.to_string()), true);
    }
    // A sign at each end of a row facing the central aisle (one bank: at the
    // right end), saying which bookcases (and so which books) it holds.
    for r in 0..wing.rows {
        let y = st.row_y(r);
        let first = r * wing.cols;
        for bank in 0..st.banks {
            let (a, z) = (
                first + bank * st.per_bank,
                first + (bank + 1) * st.per_bank - 1,
            );
            let x = if bank == 0 {
                st.bank_x[0] + st.per_bank * 2
            } else {
                st.bank_x[1] - 1
            };
            b.object("stack_sign", x, y, 1, 1, Some(&format!("{a}-{z}")), true);
        }
    }
    // Carrels against the side walls, every other aisle.
    for r in (0..wing.rows).step_by(2) {
        let y = st.row_y(r) + 1;
        b.decor(1, y, "carrel");
        b.decor(2, y, "chair");
        if corner == 0 {
            b.decor(w - 2, y, "carrel");
            b.decor(w - 3, y, "chair");
        }
    }
    if corner > 0 {
        // The reading corner: a table and armchairs beside the bank.
        let x0 = st.width();
        b.rect(x0, 2, corner - 1, 8, "rug");
        reading_table(&mut b, x0 + 2, 5, 5);
        b.decor(x0 + 7, 9, "globe");
    }
    // By the way in: reading tables, or the story circle.
    let fy = stacks_end + 1;
    if wing.key == "children" {
        let (cx, cy) = (w / 2, fy + 2);
        b.rect(cx - 4, fy, 9, 5, "rug");
        for (dx, dy) in [
            (-3i16, 0i16),
            (-2, -1),
            (0, -2),
            (2, -1),
            (3, 0),
            (-2, 1),
            (2, 1),
        ] {
            b.decor((cx as i16 + dx) as u16, (cy as i16 + dy) as u16, "cushion");
        }
        b.decor(cx, cy, "chair");
        b.object("spot", cx, cy + 1, 1, 1, Some("story_circle"), false);
        b.decor(3, fy + 1, "potted_plant");
        b.decor(w - 4, fy + 1, "potted_plant");
    } else {
        let len = 5;
        reading_table(&mut b, 4, fy + 2, len);
        reading_table(&mut b, w - 4 - len, fy + 2, len);
    }
    b.object("signpost", door.0 - 2, h - 2, 1, 1, Some(wing.name), true);
    b.object(
        "wing_exit",
        door.0,
        h - 1,
        door.1,
        1,
        Some("To the hall"),
        true,
    );
    b.finish(wing.name, (door.0, h - 3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bookcase_and_aisle_is_reachable() {
        for wing in WINGS {
            let map = super::wing(&wing);
            let grid = map.grid();
            let cases: Vec<_> = map
                .objects
                .iter()
                .filter(|o| o.kind == "bookcase")
                .collect();
            assert_eq!(cases.len(), wing.cases(), "{}", wing.key);
            let from = (map.spawn.x, map.spawn.y);
            for c in cases {
                // Browsed from the aisle in front.
                let to = (c.x, c.y + 1);
                assert!(
                    commons_sim::find_path(&grid, from, to, 100_000).is_some(),
                    "{} bookcase {:?} unreachable",
                    wing.key,
                    c.label
                );
            }
        }
        let hall = hall();
        let grid = hall.grid();
        for d in hall.objects.iter().filter(|o| o.kind == "wing_door") {
            let to = (d.x + 1, d.y + 1);
            assert!(
                commons_sim::find_path(&grid, (hall.spawn.x, hall.spawn.y), to, 100_000).is_some()
            );
        }
    }
}
