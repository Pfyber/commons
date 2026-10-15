//! Interactive furniture derived from a map: seats (benches, the swing,
//! picnic blankets, logs round the campfire) and game tables.
//! Ids are tile indices (`y * width + x`), so client, server and bots agree
//! without extra data. Mirrored in `client/src/world/furniture.ts`.

use crate::TilePos;
use crate::map::MapFile;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    White,
    Black,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seat {
    pub tile: TilePos,
    /// Set when the seat belongs to a game table.
    pub table: Option<(u32, Side)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Table {
    pub tile: TilePos,
    pub white_seat: u32,
    pub black_seat: u32,
}

#[derive(Debug, Clone, Default)]
pub struct Furniture {
    pub seats: BTreeMap<u32, Seat>,
    pub tables: BTreeMap<u32, Table>,
}

impl Furniture {
    pub fn from_map(map: &MapFile) -> Self {
        let w = map.width as u32;
        let kind = |name: &str| {
            map.decor_legend
                .iter()
                .position(|n| n == name)
                .map(|i| i as u8)
        };
        let (bench, swing, table) = (kind("bench"), kind("swing"), kind("chess_table"));
        let (blanket, log_seat) = (kind("blanket"), kind("log_seat"));
        let mut f = Furniture::default();
        for (i, &d) in map.decor.iter().enumerate() {
            let tile = ((i as u32 % w) as u16, (i as u32 / w) as u16);
            if Some(d) == bench || Some(d) == swing || Some(d) == blanket || Some(d) == log_seat {
                f.seats.insert(i as u32, Seat { tile, table: None });
            }
        }
        for (i, &d) in map.decor.iter().enumerate() {
            if Some(d) != table {
                continue;
            }
            let i = i as u32;
            let tile = ((i % w) as u16, (i / w) as u16);
            // Players sit on the benches directly left (white) and right (black).
            let (left, right) = (i.wrapping_sub(1), i + 1);
            if tile.0 == 0 || !f.seats.contains_key(&left) || !f.seats.contains_key(&right) {
                continue;
            }
            f.seats.get_mut(&left).unwrap().table = Some((i, Side::White));
            f.seats.get_mut(&right).unwrap().table = Some((i, Side::Black));
            f.tables.insert(
                i,
                Table {
                    tile,
                    white_seat: left,
                    black_seat: right,
                },
            );
        }
        f
    }

    pub fn seat_id(map: &MapFile, t: TilePos) -> u32 {
        Self::seat_id_for(map.width, t)
    }

    pub fn seat_id_for(width: u16, t: TilePos) -> u32 {
        t.1 as u32 * width as u32 + t.0 as u32
    }
}

/// Chebyshev distance: 1 means the tiles touch, diagonals included.
pub fn adjacent(a: TilePos, b: TilePos) -> bool {
    let dx = (a.0 as i32 - b.0 as i32).abs();
    let dy = (a.1 as i32 - b.1 as i32).abs();
    dx.max(dy) == 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::Spawn;

    #[test]
    fn finds_benches_and_tables() {
        let (w, h) = (6u16, 3u16);
        let n = (w * h) as usize;
        let mut decor = vec![0u8; n];
        // row 1: bench, table, bench at x=1..3; lone bench at x=5
        decor[7] = 1;
        decor[8] = 2;
        decor[9] = 1;
        decor[11] = 1;
        let map = MapFile {
            name: "t".into(),
            width: w,
            height: h,
            spawn: Spawn { x: 0, y: 0 },
            ground_legend: vec!["grass".into()],
            decor_legend: vec!["none".into(), "bench".into(), "chess_table".into()],
            ground: vec![0; n],
            decor,
            collision: vec![0; n],
            objects: vec![],
            streets: None,
        };
        let f = Furniture::from_map(&map);
        assert_eq!(f.seats.len(), 3);
        assert_eq!(
            f.tables[&8],
            Table {
                tile: (2, 1),
                white_seat: 7,
                black_seat: 9
            }
        );
        assert_eq!(f.seats[&7].table, Some((8, Side::White)));
        assert_eq!(f.seats[&11].table, None);
        assert!(adjacent((1, 1), (2, 2)) && !adjacent((1, 1), (1, 1)) && !adjacent((1, 1), (3, 1)));
    }
}
