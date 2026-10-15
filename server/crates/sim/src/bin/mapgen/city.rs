//! The city map (ADR 0010, step C1): the whole grid from `assets/city/` as
//! one zone. Streets run between and around the blocks; every block gets a
//! simple layout for its type and a sign. Today's content still lives in
//! Founders' Park, reached through the gate in the Park block, until C2
//! moves it into its blocks.

use super::{Brush, Builder, g, hash, noise};
use commons_sim::city::{BlockId, City};
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
            "home" => homes(&mut k),
            _ => landmark(&mut k, &t.key, &t.name),
        }
        // Every block names itself on its south sidewalk.
        k.object("signpost", 21, N - 2, 1, 1, &t.name);
    }

    let spawn = geo.block_origin(city.spawn_block);
    let spawn = (spawn.x + 24, spawn.y + 26);
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

/// The Market, where everyone arrives: stalls, the tailor, benches.
fn market(k: &mut Blk) {
    k.rect(2, 2, N - 4, N - 4, "plaza");
    for (x, y) in [(4, 4), (38, 4), (4, 38), (38, 38)] {
        k.rect(x, y, 6, 6, "flowers");
        k.decor(x + 2, y + 2, "tree");
    }
    for (x, y) in [(12, 13), (34, 13), (12, 34), (34, 34)] {
        k.object("market_cart", x, y, 2, 1, "Market");
    }
    k.object("tailor", 35, 22, 3, 2, "Tailor");
    k.object(
        "signpost",
        23,
        22,
        1,
        1,
        "Welcome to Commons! North: the Park and the gate to Founders' Park · South: the Pond · West: the Library · East: the Cinema and the Casino",
    );
    k.bench(14, 29, 3);
    k.bench(31, 29, 3);
    k.bench(14, 18, 3);
    for (x, y) in [(10, 10), (37, 10), (10, 37), (37, 37)] {
        k.decor(x, y, "lamp");
    }
    // Shade trees in planters around the square.
    for (x, y) in [
        (18, 6),
        (29, 6),
        (18, 41),
        (29, 41),
        (6, 18),
        (6, 29),
        (41, 18),
        (41, 29),
    ] {
        k.ground(x, y, "flowers");
        k.decor(x, y, "tree");
    }
}

/// The Park: crossing paths, trees, and the gate to Founders' Park.
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
    k.object("park_gate", 23, 20, 3, 1, "Founders' Park");
    k.object(
        "signpost",
        27,
        21,
        1,
        1,
        "Through the gate: Founders' Park, with the pond, the garden, the Town Hall, the grove and its secret corners",
    );
    for x in [7, 35] {
        k.bench(x, 21, 3);
        k.bench(x, 26, 3);
    }
    k.scatter(3, 3, N - 3, N - 3, 9, &["tree", "tree", "bush", "pine"]);
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

fn pond(k: &mut Blk) {
    k.lawn();
    water(k, 24.0, 23.0, 13.0, 10.0);
    // A path all the way round.
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
    for y in 2..N - 2 {
        for x in 2..N - 2 {
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
    k.bench(5, 22, 3);
    k.bench(40, 22, 3);
    k.scatter(3, 3, N - 3, N - 3, 13, &["tree", "bush", "willow"]);
}

fn lake(k: &mut Blk) {
    k.lawn();
    water(k, 24.0, 22.0, 19.0, 16.0);
    // A little island and a pier out from the south shore.
    for y in 14..21u16 {
        for x in 28..35u16 {
            let (dx, dy) = (x as i32 - 31, y as i32 - 17);
            if dx * dx + dy * dy <= 6 {
                k.ground(x, y, "grass");
            }
        }
    }
    k.decor(31, 17, "willow");
    k.rect(23, 30, 2, 14, "bridge");
    k.rect(22, 44, 4, 2, "path");
    k.scatter(3, 3, N - 3, N - 3, 11, &["pine", "tree", "bush"]);
}

/// Orchard rows and the greenhouse.
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
    k.bench(32, 20, 3);
}

fn woods(k: &mut Blk) {
    k.lawn();
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
}

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
    for (x, y) in [(12, 12), (34, 34), (30, 10)] {
        for i in 0..2 {
            k.decor(x + i, y, "blanket");
        }
    }
    for y in 3..N - 3 {
        for x in 3..N - 3 {
            if k.free(x, y) && k.hash(x, y, 5).is_multiple_of(7) {
                k.decor(x, y, "tallgrass");
            }
        }
    }
    k.scatter(3, 3, N - 3, N - 3, 41, &["tree"]);
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
fn homes(k: &mut Blk) {
    k.lawn();
    for i in 0..3u16 {
        let x0 = 3 + i * 15;
        k.object("house", x0 + 1, 3, 10, 6, "Home");
        k.rect(x0 + 1, 9, 10, 3, "flowers");
        k.object("house", x0 + 1, 39, 10, 6, "Home");
        k.rect(x0 + 1, 35, 10, 3, "flowers");
    }
    k.object("house", 3, 18, 8, 10, "Home");
    k.rect(11, 18, 2, 10, "flowers");
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
        "arcade" => "Arcade: word games inside, more soon".to_string(),
        "casino" => "Casino: opening soon. Play money only, never real money".to_string(),
        "club_hall" => "Club Hall: rooms for clubs, opening soon".to_string(),
        _ => format!("{name}: opening soon"),
    };
    k.object("signpost", 20, 19, 1, 1, &sign);
    if key == "arcade" {
        k.object("arcade", 27, 19, 3, 1, "");
    }
    k.bench(13, 26, 3);
    k.bench(32, 26, 3);
    for (x, y) in [(10, 18), (37, 18), (10, 29), (37, 29)] {
        k.decor(x, y, "lamp");
    }
    k.scatter(3, 3, N - 3, N - 3, 10, &["tree", "bush", "tree"]);
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
}
