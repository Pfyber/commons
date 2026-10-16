//! The city map (ADR 0010): the whole grid from `assets/city/` as one zone.
//! Streets run between and around the blocks; every block gets a layout for
//! its type and a sign. Since C2 the founding park's content lives in its
//! blocks: the fountain in the Market, the grove and chess in the Park, the
//! pier at the Pond, the island and campfire at the Lake, and so on.
//!
//! Invisible `spot` objects name places the client walks people to (the
//! Caretaker's rounds, "Show me", gatherings), so no coordinates live in
//! client code.

use super::{Brush, Builder, g, hash, maze, noise, nook};
use commons_sim::city::{APARTMENTS, BlockId, City, STALLS, lot_key};
use commons_sim::map::{MapFile, StreetGrid};
use std::collections::VecDeque;

const CITY: &str = include_str!("../../../../../../assets/city/city.json");
const TYPES: &str = include_str!("../../../../../../assets/city/block_types.json");

/// Layouts below are drawn for this block size.
const N: u16 = 48;

/// One block being laid out, addressed in block-local tiles.
struct Blk<'a> {
    b: &'a mut Builder,
    ox: u16,
    oy: u16,
    salt: u32,
}

impl Blk<'_> {
    fn ground(&mut self, x: u16, y: u16, t: &str) {
        self.b.ground(self.ox + x, self.oy + y, t);
    }
    fn decor(&mut self, x: u16, y: u16, t: &str) {
        self.b.decor(self.ox + x, self.oy + y, t);
    }
    fn rect(&mut self, x: u16, y: u16, w: u16, h: u16, t: &str) {
        self.b.rect(self.ox + x, self.oy + y, w, h, t);
    }
    fn object(&mut self, kind: &str, x: u16, y: u16, w: u16, h: u16, label: &str) {
        let label = (!label.is_empty()).then_some(label);
        self.b
            .object(kind, self.ox + x, self.oy + y, w, h, label, true);
    }
    /// An object nothing collides with (spots, nooks, grove slots).
    fn marker(&mut self, kind: &str, x: u16, y: u16, w: u16, h: u16, label: Option<&str>) {
        self.b
            .object(kind, self.ox + x, self.oy + y, w, h, label, false);
    }
    /// A named place the client can walk people to.
    fn spot(&mut self, key: &str, x: u16, y: u16) {
        self.marker("spot", x, y, 1, 1, Some(key));
    }
    /// Clears decor from a rectangle and lays `ground` on it.
    fn clear(&mut self, x: u16, y: u16, w: u16, h: u16, ground: &str) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.decor(xx, yy, "none");
            }
        }
        self.rect(x, y, w, h, ground);
    }
    fn free(&self, x: u16, y: u16) -> bool {
        self.b.free(self.ox + x, self.oy + y)
    }
    fn hash(&self, x: u16, y: u16, salt: u32) -> u32 {
        hash(self.ox + x, self.oy + y, self.salt ^ salt)
    }
    fn ground_at(&self, x: u16, y: u16) -> u8 {
        self.b.ground[self.b.i(self.ox + x, self.oy + y)]
    }
    /// A smooth path through block-local points.
    fn path(&mut self, pts: &[(f32, f32)], radius: f32) {
        let (ox, oy) = (self.ox as f32, self.oy as f32);
        let pts: Vec<(f32, f32)> = pts.iter().map(|&(x, y)| (ox + x, oy + y)).collect();
        self.b.stroke(&pts, radius, Brush::Path);
    }
    /// A row of `n` bench tiles (drawn as one bench) facing south.
    fn bench(&mut self, x: u16, y: u16, n: u16) {
        for i in 0..n {
            self.decor(x + i, y, "bench");
        }
    }

    /// Grass with darker patches over the whole interior.
    fn lawn(&mut self) {
        for y in 2..N - 2 {
            for x in 2..N - 2 {
                let (gx, gy) = ((self.ox + x) as f32, (self.oy + y) as f32);
                let t = if noise(gx, gy, 7.0, 1) > 0.62 {
                    "grass_dark"
                } else {
                    "grass"
                };
                self.ground(x, y, t);
            }
        }
    }

    /// Trees and bushes on free grass, clear of paths and anything built.
    fn scatter(&mut self, x0: u16, y0: u16, x1: u16, y1: u16, every: u32, kinds: &[&str]) {
        for y in y0..y1 {
            for x in x0..x1 {
                if !self.free(x, y) || self.near_built(x, y) {
                    continue;
                }
                let h = self.hash(x, y, 7);
                if h.is_multiple_of(every) {
                    let k = kinds[(h / every) as usize % kinds.len()];
                    self.decor(x, y, k);
                }
            }
        }
    }

    /// Within a tile of anything that isn't lawn (paths, plazas, buildings,
    /// other trees): keeps scatter from blocking ways through.
    fn near_built(&self, x: u16, y: u16) -> bool {
        for dy in -1i32..=1 {
            for dx in -1i32..=1 {
                let (a, c) = ((self.ox + x) as i32 + dx, (self.oy + y) as i32 + dy);
                let i = self.b.i(a as u16, c as u16);
                let lawn = [g("grass"), g("grass_dark"), g("flowers")].contains(&self.b.ground[i]);
                if !lawn || self.b.solid[i] || (self.b.decor[i] != 0 && (dx, dy) != (0, 0)) {
                    return true;
                }
            }
        }
        false
    }
}

pub fn city() -> MapFile {
    let city = City::from_json(CITY, TYPES).expect("assets/city is invalid");
    let geo = city.geometry;
    assert_eq!(
        geo.block_tiles, N,
        "the block layouts are drawn for {N}-tile blocks"
    );
    let size = geo.size();
    let mut b = Builder::new(size, size);
    b.streets = Some(StreetGrid {
        block_tiles: geo.block_tiles,
        street_tiles: geo.street_tiles,
        blocks: geo.blocks,
    });
    b.rect(0, 0, size, size, "road");

    for (id, t) in city.blocks() {
        let o = geo.block_origin(id);
        let mut k = Blk {
            b: &mut b,
            ox: o.x,
            oy: o.y,
            salt: (id.by as u32) << 8 | id.bx as u32,
        };
        sidewalk(&mut k);
        match t.key.as_str() {
            "market" => market(&mut k),
            "park" => park(&mut k),
            "pond" => pond(&mut k),
            "lake" => lake(&mut k),
            "orchard" => orchard(&mut k),
            "woods" => woods(&mut k),
            "meadow" => meadow(&mut k),
            "club_lot" => club_lot(&mut k),
            "home" => homes(&mut k, id),
            "fairground" => fairground(&mut k),
            _ => landmark(&mut k, &t.key, &t.name),
        }
        // Every block names itself on its south sidewalk.
        k.object("signpost", 21, N - 2, 1, 1, &t.name);
    }

    let spawn = geo.block_origin(city.spawn_block);
    let spawn = (spawn.x + 24, spawn.y + 28);
    let map = b.finish(&city.name, spawn);
    check_reachable(&map, &city);
    map
}

/// Pavement around the block with street lamps along the kerb.
fn sidewalk(k: &mut Blk) {
    for y in 0..N {
        for x in 0..N {
            if x < 2 || y < 2 || x >= N - 2 || y >= N - 2 {
                k.ground(x, y, "curb");
            }
        }
    }
    for i in [6, 17, 30, 41] {
        k.decor(i, 0, "lamp");
        k.decor(i, N - 1, "lamp");
        k.decor(0, i, "lamp");
        k.decor(N - 1, i, "lamp");
    }
}

/// The Market, where everyone arrives: the town square with the fountain
/// (the town's goal), the boards, stalls, the tailor and benches.
fn market(k: &mut Blk) {
    k.rect(2, 2, N - 4, N - 4, "plaza");
    for (x, y) in [(4, 4), (38, 4), (4, 38), (38, 38)] {
        k.rect(x, y, 6, 6, "flowers");
        k.decor(x + 2, y + 2, "tree");
    }
    // The fountain in a ring of flowerbeds.
    for y in 17..32u16 {
        for x in 17..32u16 {
            let (dx, dy) = (x as i32 - 24, y as i32 - 24);
            let r2 = dx * dx + dy * dy;
            if (30..=42).contains(&r2) && dx.abs() > 1 && dy.abs() > 1 {
                k.ground(x, y, "flowers");
            }
        }
    }
    k.object("fountain", 23, 23, 3, 3, "");
    for (x, y) in [(19, 20), (28, 20), (19, 28), (28, 28)] {
        k.bench(x, y, 2);
    }
    k.object("story_board", 19, 32, 2, 1, "Story of the Town");
    k.object("notice_board", 27, 32, 2, 1, "Notice Board");
    k.spot("fountain", 24, 27);
    for (x, y) in [(12, 13), (34, 13), (12, 34), (34, 34)] {
        k.object("market_cart", x, y, 2, 1, "Market");
    }
    k.object("tailor", 37, 22, 3, 2, "Tailor");
    // The post office: where your home is, and finding one if you have none.
    k.object("post_office", 2, 20, 7, 6, "Post Office");
    k.spot("post_office", 5, 26);
    k.object(
        "signpost",
        23,
        35,
        1,
        1,
        "Welcome to Commons! North: the Park with the Founders' Grove and chess · South: the Pond and its pier · West: the Library and the Town Hall · East: the Cinema and the Casino",
    );
    k.bench(14, 18, 3);
    for (x, y) in [(10, 10), (37, 10), (10, 37), (37, 37)] {
        k.decor(x, y, "lamp");
    }
    // Shade trees in planters around the square.
    for (x, y) in [(6, 18), (6, 29), (41, 18), (41, 29)] {
        k.ground(x, y, "flowers");
        k.decor(x, y, "tree");
    }
    // Apartments above the shops along the north side (C4): one door, a
    // `door:apt:<n>` spot per flat so each tenant steps out of it.
    k.object("apartments", 11, 2, 26, 7, "Market Apartments");
    for n in 1..=APARTMENTS {
        k.spot(&format!("door:apt:{n}"), 24, 9);
    }
    k.spot("apartments", 24, 10);
    // Market stalls along the south side, to rent and sell from.
    for n in 0..STALLS as u16 {
        let x = 12 + n * 4;
        k.object("stall", x, 39, 3, 2, &format!("stall:{}", n + 1));
        k.spot(&format!("stall:{}", n + 1), x + 1, 38);
    }
}

/// The Park: chess tables, the Founders' Grove with its stone, the Old Oak
/// with a swing and the wishing well, on crossing paths.
fn park(k: &mut Blk) {
    k.lawn();
    k.rect(22, 2, 4, N - 4, "path");
    k.rect(2, 22, N - 4, 4, "path");
    for y in 17..31u16 {
        for x in 17..31u16 {
            let (dx, dy) = (x as i32 - 24, y as i32 - 24);
            if dx * dx + dy * dy <= 36 {
                k.ground(x, y, "plaza");
            }
        }
    }
    // Chess under the trees (north-west), benches either side of each table.
    k.rect(5, 5, 14, 14, "plaza");
    for (tx, ty) in [(8u16, 8u16), (14, 8), (8, 14), (14, 14)] {
        k.decor(tx, ty, "chess_table");
        k.decor(tx - 1, ty, "bench");
        k.decor(tx + 1, ty, "bench");
    }
    k.rect(11, 19, 2, 3, "path");
    k.spot("chess", 11, 17);
    // The Old Oak and its swing, and the wishing well (south-west).
    k.object("old_oak", 8, 30, 3, 3, "The Old Oak");
    k.decor(10, 34, "swing");
    k.spot("oak", 12, 33);
    k.object("well", 15, 38, 2, 2, "Wishing Well");
    k.spot("well", 16, 41);
    k.bench(4, 38, 2);
    // The Founders' Grove (spec §11): a stone with every founder's name,
    // seedlings filling out from it across the north-east and south-east.
    let stone = (35u16, 19u16);
    k.object("founders_stone", stone.0, stone.1, 2, 1, "Founders' Stone");
    k.spot("grove", 36, 21);
    let mut slots = vec![];
    for (x0, y0, x1, y1) in [(27u16, 3u16, 45u16, 17u16), (27, 27, 45, 44)] {
        for (r, y) in (y0 + 1..=y1).step_by(2).enumerate() {
            for x in (x0 + 1 + (r % 2) as u16..=x1).step_by(2) {
                if k.free(x, y) {
                    slots.push((x, y));
                }
            }
        }
    }
    let d2 = |&(x, y): &(u16, u16)| {
        let (dx, dy) = (
            x as i32 * 2 - (stone.0 as i32 * 2 + 1),
            y as i32 - stone.1 as i32,
        );
        (dx * dx + dy * dy * 4, y, x)
    };
    slots.sort_by_key(d2);
    assert!(
        slots.len() >= commons_sim::GROVE_SLOTS,
        "only {} grove slots",
        slots.len()
    );
    for &(x, y) in &slots[..commons_sim::GROVE_SLOTS] {
        k.marker("grove_slot", x, y, 1, 1, None);
    }
    for x in [5, 37] {
        k.bench(x, 26, 3);
    }
    k.scatter(3, 27, 21, N - 3, 7, &["tree", "tree", "bush", "pine"]);
    k.scatter(19, 3, 21, 21, 5, &["tree", "bush"]);
}

/// Water inside an ellipse, with a sandy shore.
fn water(k: &mut Blk, cx: f32, cy: f32, rx: f32, ry: f32) {
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            let (dx, dy) = ((x as f32 + 0.5 - cx) / rx, (y as f32 + 0.5 - cy) / ry);
            let r = dx * dx + dy * dy;
            if r <= 1.0 {
                k.ground(x, y, "water");
            } else if r <= 1.25 {
                k.ground(x, y, "sand");
            }
        }
    }
}

/// Reeds on the shore and lily pads out on the water.
fn reeds(k: &mut Blk) {
    for y in 3..N - 3 {
        for x in 3..N - 3 {
            if k.ground_at(x, y) == g("water") && k.hash(x, y, 3).is_multiple_of(11) {
                let edge = [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
                    .iter()
                    .any(|&(a, c)| k.ground_at(a, c) != g("water"));
                if edge {
                    k.decor(x, y, "reeds");
                } else if k.hash(x, y, 4).is_multiple_of(3) {
                    k.decor(x, y, "lilypad");
                }
            }
        }
    }
}

/// The Pond: a path all the way round, the fishing pier and the bottles.
fn pond(k: &mut Blk) {
    k.lawn();
    water(k, 24.0, 23.0, 13.0, 10.0);
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            let (dx, dy) = (
                (x as f32 + 0.5 - 24.0) / 13.0,
                (y as f32 + 0.5 - 23.0) / 10.0,
            );
            let r = dx * dx + dy * dy;
            if (1.55..=1.9).contains(&r) {
                k.ground(x, y, "path");
            }
        }
    }
    k.rect(22, 38, 4, 8, "path");
    reeds(k);
    // The pier reaches into the pond from the south path.
    k.clear(23, 27, 2, 9, "bridge");
    k.spot("pier", 24, 30);
    k.object("bottles", 27, 37, 1, 1, "Messages in bottles");
    k.bench(5, 22, 3);
    k.bench(40, 22, 3);
    k.scatter(3, 3, N - 3, N - 3, 13, &["tree", "bush", "willow"]);
}

/// The Lake: the Little Island across stepping stones from the pier, and
/// the campfire circle on the south-west shore.
fn lake(k: &mut Blk) {
    k.lawn();
    water(k, 24.0, 22.0, 19.0, 16.0);
    reeds(k);
    k.scatter(3, 3, N - 3, N - 3, 11, &["pine", "tree", "bush"]);
    // The Little Island: chat there stays there.
    let mut inside = vec![];
    for y in 10..21u16 {
        for x in 25..38u16 {
            let (dx, dy) = ((x as f32 + 0.5 - 31.5) / 4.0, (y as f32 + 0.5 - 15.5) / 2.8);
            let e = dx * dx + dy * dy;
            if e <= 1.0 {
                k.ground(x, y, if e < 0.55 { "grass" } else { "sand" });
                k.decor(x, y, "none");
                inside.push((k.ox + x, k.oy + y));
            }
        }
    }
    k.bench(30, 14, 2);
    k.decor(34, 15, "lantern");
    k.decor(32, 17, "willow");
    nook(k.b, &inside, "The Little Island");
    k.spot("island", 30, 16);
    // The pier, and stepping stones on from its end to the island.
    k.clear(23, 30, 2, 14, "bridge");
    k.rect(22, 44, 4, 2, "path");
    let mut y = 29;
    while k.ground_at(24, y) == g("water") && y > 15 {
        k.clear(24, y, 1, 1, "stones");
        y -= 1;
    }
    let mut x = 24;
    while k.ground_at(x, 15) != g("grass") && k.ground_at(x, 15) != g("sand") && x < 30 {
        k.clear(x, 15, 1, 1, "stones");
        x += 1;
    }
    // The campfire: logs to sit on, and a question to talk about.
    let (fx, fy) = (9u16, 41u16);
    k.clear(fx - 2, fy - 2, 5, 5, "sand");
    k.object("campfire", fx, fy, 1, 1, "Campfire");
    for (x, y) in [
        (fx - 2, fy - 1),
        (fx - 2, fy + 1),
        (fx + 2, fy - 1),
        (fx + 2, fy + 1),
        (fx, fy - 2),
        (fx, fy + 2),
    ] {
        k.decor(x, y, "log_seat");
    }
    k.clear(fx + 3, fy, 9, 1, "path");
    k.spot("campfire", fx + 3, fy + 1);
}

/// The Orchard & Greenhouse, with the Community Garden's soil rows.
fn orchard(k: &mut Blk) {
    k.lawn();
    k.rect(22, 2, 4, N - 4, "path");
    for y in 4..44u16 {
        for x in 4..20u16 {
            if x % 5 == 4 && y % 5 == 3 {
                k.decor(x, y, "apple_tree");
            }
        }
    }
    k.object("building", 30, 8, 13, 8, "Greenhouse");
    k.rect(30, 16, 13, 3, "plaza");
    k.rect(26, 17, 4, 2, "path");
    for y in 24..42u16 {
        for x in 29..44u16 {
            if y % 3 == 0 {
                k.ground(x, y, "soil");
            }
        }
    }
    k.rect(26, 22, 3, 2, "path");
    k.object("garden_sign", 29, 21, 1, 1, "Community Garden");
    k.spot("garden", 30, 23);
    k.bench(32, 20, 3);
}

/// The Woods: winding paths through pines, the Moss Grotto behind a pine
/// that isn't one, a fairy ring, a tiny door and the hedge maze.
fn woods(k: &mut Blk) {
    k.lawn();
    // A brook from a spring in the east, out under the south pavement.
    let (ox, oy) = (k.ox as f32, k.oy as f32);
    let brook: Vec<(f32, f32)> = [(44.0, 30.0), (39.0, 35.0), (35.0, 41.0), (32.0, 46.0)]
        .iter()
        .map(|&(x, y)| (ox + x, oy + y))
        .collect();
    k.b.stroke(&brook, 0.9, Brush::Water);
    k.path(
        &[(2.0, 24.0), (14.0, 16.0), (28.0, 30.0), (46.0, 22.0)],
        1.2,
    );
    k.path(
        &[(24.0, 2.0), (20.0, 18.0), (26.0, 34.0), (24.0, 46.0)],
        1.2,
    );
    k.scatter(3, 3, N - 3, N - 3, 3, &["pine", "tree", "pine", "bush"]);
    for y in 3..N - 3 {
        for x in 3..N - 3 {
            if k.free(x, y) && k.hash(x, y, 21).is_multiple_of(37) {
                k.decor(x, y, "mushrooms");
            }
        }
    }
    // The hedge maze (north-east), with a nook at its heart.
    let (mx, my) = (k.ox + 29, k.oy + 4);
    let (mw, mh) = maze(k.b, mx, my, 7, 5, 4242);
    let (hx, hy) = (mx + mw / 2, my + mh / 2);
    k.b.object(
        "maze_heart",
        hx,
        hy,
        1,
        1,
        Some("The heart of the maze"),
        true,
    );
    k.b.object(
        "nook",
        hx - 1,
        hy - 1,
        3,
        3,
        Some("The Heart of the Maze"),
        false,
    );
    k.path(&[(36.5, 15.5), (37.0, 20.0), (37.5, 25.5)], 0.8);
    // The Moss Grotto (west): a ring of pines; the middle one on its west
    // side lets you through.
    let mut inside = vec![];
    for y in 29..=37u16 {
        for x in 6..=12u16 {
            if (7..=11).contains(&x) && (30..=36).contains(&y) {
                k.ground(x, y, "grass_dark");
                k.decor(x, y, "none");
                inside.push((k.ox + x, k.oy + y));
            } else {
                k.decor(x, y, "pine");
            }
        }
    }
    k.decor(6, 33, "pine_secret");
    k.clear(4, 33, 2, 1, "grass_dark");
    k.path(&[(4.5, 33.5), (3.5, 29.0), (3.5, 25.0)], 0.6);
    k.decor(9, 31, "log_seat");
    k.decor(10, 31, "log_seat");
    k.decor(8, 31, "lantern");
    for (x, y) in [(8u16, 34u16), (10, 35), (8, 35), (11, 33)] {
        k.decor(x, y, "mushrooms");
    }
    nook(k.b, &inside, "The Moss Grotto");
    // A fairy ring in a little clearing (south), found by walking into it.
    let (rx, ry) = (15u16, 41u16);
    k.clear(rx - 3, ry - 3, 7, 7, "grass");
    for (dx, dy) in [
        (-2i32, 0i32),
        (2, 0),
        (0, -2),
        (0, 2),
        (-1, -2),
        (1, -2),
        (-2, 1),
        (2, 1),
        (-1, 2),
        (1, 2),
    ] {
        k.decor(
            (rx as i32 + dx) as u16,
            (ry as i32 + dy) as u16,
            "mushrooms",
        );
    }
    k.path(&[(18.5, 41.5), (24.5, 41.5)], 0.6);
    k.spot("fairy_ring", rx, ry);
    // A tiny door in an old tree by the path.
    k.clear(8, 17, 1, 2, "grass_dark");
    k.object("tiny_door", 8, 17, 1, 1, "A tiny door");
}

/// The Meadow: wildflowers, the Willow Hideaway, and the picnic lawn where
/// wish lanterns go up.
fn meadow(k: &mut Blk) {
    k.lawn();
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            let (gx, gy) = ((k.ox + x) as f32, (k.oy + y) as f32);
            if noise(gx, gy, 5.0, 11) > 0.5 {
                k.ground(x, y, "flowers");
            }
        }
    }
    k.path(
        &[(2.0, 30.0), (18.0, 22.0), (32.0, 26.0), (46.0, 16.0)],
        1.0,
    );
    k.path(&[(34.0, 26.0), (34.5, 36.0), (34.0, 46.0)], 1.0);
    for y in 3..N - 3 {
        for x in 3..N - 3 {
            if k.free(x, y) && k.hash(x, y, 5).is_multiple_of(7) {
                k.decor(x, y, "tallgrass");
            }
        }
    }
    k.scatter(3, 3, N - 3, N - 3, 41, &["tree"]);
    // The Willow Hideaway: a ring of weeping willows; one curtain of
    // branches on the east side parts as you walk through.
    let (hx, hy, hrx, hry) = (11.0f32, 12.0f32, 4.6f32, 3.4f32);
    let mut inside = vec![];
    for y in 6..19u16 {
        for x in 3..21u16 {
            let (dx, dy) = ((x as f32 - hx) / hrx, (y as f32 - hy) / hry);
            let e = dx * dx + dy * dy;
            if e < 1.0 {
                k.ground(x, y, "flowers");
                k.decor(x, y, "none");
                inside.push((k.ox + x, k.oy + y));
            } else if e < 1.9 {
                k.ground(x, y, "grass_dark");
                k.decor(x, y, "willow");
            }
        }
    }
    let gap = (hx + hrx).ceil() as u16;
    k.clear(gap, hy as u16, 2, 1, "flowers");
    k.decor(gap, hy as u16, "willow_curtain");
    k.decor(gap + 1, hy as u16, "willow_curtain");
    k.clear(gap + 2, hy as u16, 3, 1, "grass");
    k.decor(10, 10, "bench");
    k.decor(11, 10, "bench");
    k.decor(13, 10, "lantern");
    nook(k.b, &inside, "The Willow Hideaway");
    // The picnic lawn and the wish lanterns.
    k.clear(26, 29, 16, 10, "grass");
    for (x, y) in [(27u16, 31u16), (31, 34), (38, 31), (37, 36)] {
        k.decor(x, y, "blanket");
        k.decor(x + 1, y, "blanket");
    }
    k.rect(34, 29, 1, 10, "path");
    k.object("lantern_stand", 35, 30, 1, 1, "Wish lanterns");
    k.spot("picnic", 33, 33);
}

/// The Fairground: the bandstand stage for jams, and the sports pitch.
fn fairground(k: &mut Blk) {
    k.lawn();
    k.rect(8, 5, 32, 13, "pitch");
    k.object("goal", 8, 10, 1, 3, "");
    k.object("goal", 39, 10, 1, 3, "");
    k.spot("pitch", 24, 19);
    k.rect(22, 18, 4, 6, "path");
    k.rect(12, 24, 24, 12, "plaza");
    k.object("bandstand", 21, 25, 5, 3, "");
    k.bench(15, 31, 4);
    k.bench(29, 31, 4);
    k.spot("stage", 23, 30);
    k.rect(22, 36, 4, 10, "path");
    for (x, y) in [(12, 24), (35, 24), (12, 35), (35, 35)] {
        k.decor(x, y, "lamp");
    }
    k.scatter(3, 20, 11, N - 3, 6, &["tree", "bush"]);
    k.scatter(37, 20, N - 3, N - 3, 6, &["tree", "bush"]);
}

/// A fenced lot waiting for a club.
fn club_lot(k: &mut Blk) {
    k.lawn();
    for i in 6..42u16 {
        if !(22..26).contains(&i) {
            k.decor(i, 6, "fence");
            k.decor(i, 41, "fence");
            k.decor(6, i, "fence");
            k.decor(41, i, "fence");
        }
    }
    k.rect(22, 41, 4, 5, "path");
    k.object(
        "signpost",
        27,
        43,
        1,
        1,
        "Club lot: a club can make its home here (clubs are coming soon)",
    );
    k.scatter(3, 3, 6, N - 3, 5, &["tree", "bush"]);
    k.scatter(42, 3, N - 3, N - 3, 5, &["tree", "bush"]);
}

/// Seven homes around a shared courtyard (the C3 layout, without doors yet):
/// three along the north edge, three along the south, one on the west.
fn homes(k: &mut Blk, block: BlockId) {
    k.lawn();
    // Each house is labelled with its lot id; a `door:<lot>` spot in front
    // of its door is where its owner steps out, and its postbox stands by.
    let house = |k: &mut Blk, i: u8, (x, y, w, h): (u16, u16, u16, u16)| {
        let lot = lot_key(block, i);
        k.object("house", x, y, w, h, &lot);
        let door = (x + w / 2, y + h);
        k.spot(&format!("door:{lot}"), door.0, door.1);
        k.object("postbox", door.0 + 3, door.1, 1, 1, &lot);
    };
    for i in 0..3u16 {
        let x0 = 3 + i * 15;
        k.rect(x0 + 1, 9, 10, 3, "flowers");
        k.rect(x0 + 1, 35, 10, 3, "flowers");
        house(k, i as u8, (x0 + 1, 3, 10, 6));
        house(k, 3 + i as u8, (x0 + 1, 39, 10, 6));
    }
    k.rect(11, 18, 2, 10, "flowers");
    house(k, 6, (3, 18, 8, 10));
    // The courtyard, hedged, with its gate to the east street.
    for x in 16..44u16 {
        k.decor(x, 15, "hedge");
        k.decor(x, 32, "hedge");
    }
    for y in 15..33u16 {
        k.decor(16, y, "hedge");
        if !(22..26).contains(&y) {
            k.decor(43, y, "hedge");
        }
    }
    k.rect(17, 22, 31, 4, "path");
    k.rect(24, 18, 12, 2, "soil");
    k.rect(24, 28, 12, 2, "soil");
    k.decor(20, 18, "tree");
    k.decor(20, 29, "tree");
    k.bench(26, 21, 3);
    k.bench(32, 26, 3);
    k.object(
        "signpost",
        44,
        26,
        1,
        1,
        "Homes: seven houses around a shared courtyard. Moving in opens soon",
    );
}

/// A landmark building with a forecourt; most are placeholders for now.
fn landmark(k: &mut Blk, key: &str, name: &str) {
    k.lawn();
    k.rect(10, 18, 28, 12, "plaza");
    k.rect(22, 30, 4, 16, "path");
    k.rect(2, 33, 44, 3, "path");
    match key {
        "town_hall" => {
            k.object("town_hall", 19, 10, 10, 7, "Town Hall");
            k.rect(19, 17, 10, 1, "plaza");
        }
        _ => k.object("building", 12, 7, 24, 11, name),
    }
    let sign = match key {
        "town_hall" => "Town Hall: the town's votes and proposals".to_string(),
        "gallery" => "Gallery: paint on the easels outside; the gallery opens soon".to_string(),
        "cinema" => "Cinema: the big screen plays outside; the cinema opens soon".to_string(),
        "arcade" => "Arcade: word games inside, more soon".to_string(),
        "casino" => "Casino: opening soon. Play money only, never real money".to_string(),
        "club_hall" => "Club Hall: rooms for clubs, opening soon".to_string(),
        _ => format!("{name}: opening soon"),
    };
    k.object("signpost", 20, 19, 1, 1, &sign);
    if key == "arcade" {
        k.object("arcade", 27, 19, 3, 1, "");
    }
    if key == "gallery" {
        k.object("easels", 26, 21, 3, 1, "");
        k.spot("easels", 27, 23);
    }
    k.bench(13, 26, 3);
    k.bench(32, 26, 3);
    for (x, y) in [(10, 18), (37, 18), (10, 29), (37, 29)] {
        k.decor(x, y, "lamp");
    }
    k.scatter(3, 3, N - 3, N - 3, 10, &["tree", "bush", "tree"]);
    if key == "cinema" {
        // The outdoor big screen, with a lawn and blankets in front of it.
        k.clear(14, 36, 20, 10, "grass");
        k.object("big_screen", 17, 37, 13, 3, "Big Screen");
        for (x, y) in [(18u16, 42u16), (23, 43), (28, 42)] {
            k.decor(x, y, "blanket");
            k.decor(x + 1, y, "blanket");
        }
        k.spot("screen", 24, 41);
    }
}

/// Nearly every walkable tile can be reached from the spawn, and each
/// block's sign can be walked up to: no block is sealed off.
fn check_reachable(map: &MapFile, city: &City) {
    let grid = map.grid();
    let w = map.width as usize;
    let mut seen = vec![false; w * map.height as usize];
    let mut q = VecDeque::from([(map.spawn.x, map.spawn.y)]);
    seen[map.spawn.y as usize * w + map.spawn.x as usize] = true;
    while let Some((x, y)) = q.pop_front() {
        for (dx, dy) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if grid.walkable_i(nx, ny) && !seen[ny as usize * w + nx as usize] {
                seen[ny as usize * w + nx as usize] = true;
                q.push_back((nx as u16, ny as u16));
            }
        }
    }
    let walkable = grid.blocked.iter().filter(|b| !**b).count();
    let reached = seen.iter().filter(|s| **s).count();
    assert!(
        reached * 100 >= walkable * 97,
        "only {reached} of {walkable} walkable tiles reachable"
    );
    for (id, _) in city.blocks() {
        let BlockId { bx, by } = id;
        let o = city.geometry.block_origin(id);
        let inside = (o.y + 3..o.y + N - 3)
            .flat_map(|y| (o.x + 3..o.x + N - 3).map(move |x| (x, y)))
            .filter(|&(x, y)| seen[y as usize * w + x as usize])
            .count();
        assert!(inside > 200, "block ({bx},{by}) is closed off");
    }
    let near = |x: u16, y: u16, r: u16| {
        (y.saturating_sub(r)..=y + r)
            .any(|yy| (x.saturating_sub(r)..=x + r).any(|xx| seen[yy as usize * w + xx as usize]))
    };
    let mut lots = 0;
    for o in &map.objects {
        let ok = match o.kind.as_str() {
            "spot" | "grove_slot" => near(o.x, o.y, if o.kind == "spot" { 0 } else { 1 }),
            "house" => {
                lots += 1;
                continue;
            }
            "nook" => (o.y..o.y + o.h)
                .any(|y| (o.x..o.x + o.w).any(|x| seen[y as usize * w + x as usize])),
            _ => continue,
        };
        assert!(
            ok,
            "{} {:?} at ({}, {}) can't be reached",
            o.kind, o.label, o.x, o.y
        );
    }
    assert_eq!(lots, city.home_lots().len(), "a house for every home lot");
    for lot in city.home_lots() {
        let door = format!("door:{lot}");
        assert!(
            map.objects
                .iter()
                .any(|o| o.kind == "spot" && o.label.as_deref() == Some(door.as_str())),
            "no door for lot {lot}"
        );
    }
}
