//! The city map (ADR 0010): the whole grid from `assets/city/` as one zone.
//! Streets run between and around the blocks; every block gets a layout for
//! its type and a sign. Since C2 the founding park's content lives in its
//! blocks: the fountain in the Market, the grove and chess in the Park, the
//! pier at the Pond, the island and campfire at the Lake, and so on.
//!
//! Invisible `spot` objects name places the client walks people to (the
//! Caretaker's rounds, "Show me", gatherings), so no coordinates live in
//! client code.

use super::{Brush, Builder, d, g, hash, maze, noise, nook};
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
    fn decor_at(&self, x: u16, y: u16) -> u8 {
        self.b.decor[self.b.i(self.ox + x, self.oy + y)]
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

/// The metro's stations (ADR 0016): the block, a key and a name. A cross
/// through the middle and the four corners, so nowhere is far from one.
pub const STATIONS: &[(u8, u8, &str, &str)] = &[
    (3, 3, "market", "Market"),
    (3, 0, "north", "North Homes"),
    (6, 3, "east", "East Homes"),
    (3, 6, "south", "South Homes"),
    (0, 3, "west", "West Homes"),
    (1, 1, "orchard", "Orchard"),
    (5, 1, "woods", "Woods"),
    (5, 5, "lake", "Lake"),
    (1, 5, "meadow", "Meadow"),
];

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

    // Each block's name by where it is (for the Market's signposts).
    let names: std::collections::HashMap<(i32, i32), String> = city
        .blocks()
        .map(|(id, t)| ((id.bx as i32, id.by as i32), t.name.clone()))
        .collect();
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
            "market" => {
                market(&mut k);
                let (bx, by) = (id.bx as i32, id.by as i32);
                market_extras(&mut k, &|dx, dy| {
                    names.get(&(bx + dx, by + dy)).cloned().unwrap_or_default()
                });
            }
            "park" => park(&mut k),
            "pond" => pond(&mut k),
            "lake" => lake(&mut k),
            "orchard" => orchard(&mut k),
            "woods" => woods(&mut k),
            "meadow" => meadow(&mut k),
            "club_lot" => club_lot(&mut k, id),
            "home" => homes(&mut k, id),
            "fairground" => fairground(&mut k),
            "arena" => arena(&mut k),
            "arcade" => fun_corner(&mut k),
            _ => landmark(&mut k, &t.key, &t.name),
        }
        // Where bugs and mushrooms turn up in the green blocks (ADR 0019).
        match t.key.as_str() {
            "park" => forage(&mut k, "park", 12, 6),
            "pond" => forage(&mut k, "park", 10, 4),
            "lake" => forage(&mut k, "park", 12, 4),
            "orchard" => forage(&mut k, "orchard", 12, 8),
            "woods" => forage(&mut k, "woods", 14, 14),
            "meadow" => forage(&mut k, "meadow", 14, 8),
            _ => {}
        }
        // Every block names itself on its south sidewalk (the Market's a
        // little to the side, clear of its south road's rounded corner).
        let sign_x = if t.key == "market" { 18 } else { 21 };
        k.object("signpost", sign_x, N - 2, 1, 1, &t.name);
        // A metro station's entrance beside the signpost on some (ADR 0016):
        // stairs down to the underground; you come up at `door:metro_<key>`.
        if let Some((_, _, key, name)) = STATIONS.iter().find(|s| (s.0, s.1) == (id.bx, id.by)) {
            k.object("metro_entrance", 25, N - 2, 2, 2, name);
            k.spot(&format!("door:metro_{key}"), 27, N - 2);
            k.spot(&format!("metro_{key}"), 27, N - 2);
        }
    }

    for (id, _) in city.blocks() {
        let o = geo.block_origin(id);
        round_corners(&mut b, o.x, o.y);
    }

    let spawn = geo.block_origin(city.spawn_block);
    let spawn = (spawn.x + 24, spawn.y + 28);
    let map = b.finish(&city.name, spawn);
    check_reachable(&map, &city);
    map
}

/// Rounds a block's four corners where the streets cross: the road sweeps
/// round in an arc and the pavement follows it (a lamp on it stays put).
fn round_corners(b: &mut Builder, ox: u16, oy: u16) {
    const R: f32 = 6.0;
    let r = R as u16;
    let (road, curb, lamp) = (g("road"), g("curb"), super::d("lamp"));
    for (px, py, sx, sy) in [
        (0u16, 0u16, 1i32, 1i32),
        (N, 0, -1, 1),
        (0, N, 1, -1),
        (N, N, -1, -1),
    ] {
        let (fx, fy) = (px as f32 + sx as f32 * R, py as f32 + sy as f32 * R);
        for j in 0..r {
            for i in 0..r {
                let x = if sx > 0 { px + i } else { px - 1 - i };
                let y = if sy > 0 { py + j } else { py - 1 - j };
                let d = ((x as f32 + 0.5 - fx).powi(2) + (y as f32 + 0.5 - fy).powi(2)).sqrt();
                if d <= R - 2.0 {
                    continue;
                }
                let k = b.i(ox + x, oy + y);
                if b.solid[k] {
                    continue;
                }
                if d > R {
                    b.ground[k] = road;
                    b.decor[k] = 0;
                } else {
                    b.ground[k] = curb;
                    if b.decor[k] != lamp {
                        b.decor[k] = 0;
                    }
                }
            }
        }
    }
}

/// Pavement around the block with street lamps along the kerb.
/// Bug and mushroom spots (ADR 0019): `bugs` on open grass, flowers or
/// sand, and `shrooms` on grass beside a tree or a log (anywhere grassy in
/// the Meadow), each a few tiles from the next. A bug spot by the water
/// is the water's edge's, whatever the block.
fn forage(k: &mut Blk, habitat: &str, bugs: usize, shrooms: usize) {
    let lawn = [g("grass"), g("grass_dark"), g("flowers")];
    let woody = [
        "tree",
        "pine",
        "apple_tree",
        "willow",
        "stump",
        "log",
        "mushrooms",
        "bush",
    ]
    .map(super::d);
    let open = |k: &Blk, x: u16, y: u16| {
        let i = k.b.i(k.ox + x, k.oy + y);
        k.b.decor[i] == 0 && !k.b.solid[i]
    };
    let near = |k: &Blk, x: u16, y: u16, r: i32, f: &dyn Fn(usize) -> bool| {
        (-r..=r).any(|dy| {
            (-r..=r).any(|dx| {
                let (a, c) = ((k.ox + x) as i32 + dx, (k.oy + y) as i32 + dy);
                f(k.b.i(a as u16, c as u16))
            })
        })
    };
    let mut picked: Vec<(u16, u16)> = vec![];
    for shroom in [false, true] {
        let mut cands: Vec<(u32, u16, u16)> = vec![];
        for y in 3..N - 3 {
            for x in 3..N - 3 {
                let i = k.b.i(k.ox + x, k.oy + y);
                let ground = k.b.ground[i];
                let ok = open(k, x, y)
                    && if shroom {
                        lawn.contains(&ground)
                            && (habitat == "meadow"
                                || near(k, x, y, 1, &|j| woody.contains(&k.b.decor[j])))
                    } else {
                        lawn.contains(&ground) || ground == g("sand")
                    };
                if ok {
                    cands.push((k.hash(x, y, 0x666f + shroom as u32), x, y));
                }
            }
        }
        cands.sort();
        let want = if shroom { shrooms } else { bugs };
        let mut n = 0;
        for (_, x, y) in cands {
            if n == want {
                break;
            }
            if picked
                .iter()
                .any(|&(px, py)| px.abs_diff(x).max(py.abs_diff(y)) < 4)
            {
                continue;
            }
            picked.push((x, y));
            n += 1;
            let wet = !shroom && near(k, x, y, 2, &|j| k.b.ground[j] == g("water"));
            let label = format!(
                "{}:{}",
                if shroom { "shroom" } else { "bug" },
                if wet { "water" } else { habitat }
            );
            k.marker("forage", x, y, 1, 1, Some(&label));
        }
    }
}

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

/// The Market, where everyone arrives: a round fountain plaza in the middle
/// of a roundabout, with spur roads out to the streets west, east and south,
/// a garden footpath circling it all, and lawn everywhere else: flowerbeds,
/// willows, fairy rings of mushrooms. The Market Hall (the mall and the
/// apartments) stands along the north side; the post office, the tailor,
/// the carts and the stalls sit round the ring.
fn market(k: &mut Blk) {
    const C: f32 = 23.5;
    let dist = |x: u16, y: u16| ((x as f32 - C).powi(2) + (y as f32 - C).powi(2)).sqrt();
    k.lawn();
    // The garden footpath, a wide circle round everything.
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            if (18.6..19.7).contains(&dist(x, y)) {
                k.ground(x, y, "path");
            }
        }
    }
    // Spur roads from the ring out to the streets (west, east, south), with a
    // kerb either side; the block's own pavement opens where they meet it.
    for t in 0..N {
        for w in 21..27u16 {
            let edge = w == 21 || w == 26;
            let g = if edge { "curb" } else { "road" };
            // West and east spurs run along rows 21–26; the south one down columns 21–26.
            for (x, y) in [(t, w), (w, t)] {
                let west_or_east = y == w && !(12..=35).contains(&x);
                let south = x == w && y > 35;
                if (west_or_east || south) && dist(x, y) >= 13.5 {
                    k.decor(x, y, "none");
                    k.ground(x, y, g);
                }
            }
        }
    }
    // The roundabout: kerb, road, kerb; the plaza inside.
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            let d = dist(x, y);
            // Where a spur road meets the ring, the road runs straight on (no
            // kerb across it).
            let spur = ((22..26).contains(&y) && !(12..=35).contains(&x))
                || ((22..26).contains(&x) && y > 35);
            if spur && d >= 13.5 {
                k.ground(x, y, "road");
                continue;
            }
            // Inside: all green, the fountain standing on the lawn.
            let (gx, gy) = ((k.ox + x) as f32, (k.oy + y) as f32);
            let grass = if noise(gx, gy, 7.0, 1) > 0.62 {
                "grass_dark"
            } else {
                "grass"
            };
            let g = if d < 9.5 {
                grass
            } else if d < 10.5 || (13.5..14.5).contains(&d) {
                "curb"
            } else if d < 13.5 {
                "road"
            } else {
                continue;
            };
            k.ground(x, y, g);
        }
    }
    // The fountain right in the middle (4×4, centred on the circle), in a
    // ring of flowerbeds.
    for y in 16..32u16 {
        for x in 16..32u16 {
            let (dx, dy) = (x as f32 - C, y as f32 - C);
            let d = (dx * dx + dy * dy).sqrt();
            if (5.4..6.5).contains(&d) && dx.abs() > 1.0 && dy.abs() > 1.0 {
                k.ground(x, y, "flowers");
            }
        }
    }
    k.object("fountain", 22, 22, 4, 4, "");
    for (x, y) in [(18, 19), (28, 19), (18, 28), (28, 28)] {
        k.bench(x, y, 2);
    }
    k.spot("fountain", 23, 27);
    k.object("story_board", 16, 23, 2, 1, "Story of the Town");
    k.object("notice_board", 30, 23, 2, 1, "Notice Board");
    // Street lamps round the green, and round the ring.
    for i in 0..8 {
        let a = (i as f32 + 0.5) * std::f32::consts::FRAC_PI_4;
        let at = |r: f32| {
            (
                (C + a.cos() * r).round() as u16,
                (C + a.sin() * r).round() as u16,
            )
        };
        let (x, y) = at(8.2);
        k.decor(x, y, "lamp");
    }
    // The Market Hall along the north side: the Commons Mall on the ground
    // floor (ADR 0011) and the apartments above (C4), each with its door
    // facing the ring. A `door:apt:<n>` spot per flat so each tenant steps
    // out of the apartments' door; `door:mall` for leaving the mall.
    for y in 9..12u16 {
        for x in 11..37u16 {
            if dist(x, y) >= 14.5 {
                k.ground(x, y, "plaza");
            }
        }
    }
    k.object("apartments", 11, 2, 9, 7, "Apartments");
    for n in 1..=APARTMENTS {
        k.spot(&format!("door:apt:{n}"), 15, 9);
    }
    k.spot("apartments", 15, 10);
    k.object("mall_entrance", 21, 2, 16, 8, "Commons Mall");
    k.spot("door:mall", 29, 10);
    k.spot("mall", 29, 11);
    // The post office (south-west) and the tailor (north-east), each on a
    // little paved yard.
    k.rect(2, 28, 9, 9, "plaza");
    k.object("post_office", 3, 29, 7, 6, "Post Office");
    k.spot("post_office", 6, 35);
    k.rect(38, 12, 6, 5, "plaza");
    k.object("tailor", 39, 13, 3, 2, "Tailor");
    // Carts on round paved spots between the ring and the footpath.
    for (x, y) in [(12, 13), (34, 13), (12, 34), (34, 34)] {
        for yy in y - 2..y + 3 {
            for xx in x - 2..x + 4 {
                let (dx, dy) = (xx as f32 - (x as f32 + 0.5), yy as f32 - y as f32);
                if dx * dx + dy * dy <= 6.5 {
                    k.ground(xx, yy, "plaza");
                }
            }
        }
        k.object("market_cart", x, y, 2, 1, "Market");
    }
    // Stalls along the south side, either side of the south road, on a
    // paved walk to rent and sell from.
    k.rect(6, 38, 13, 4, "plaza");
    k.rect(29, 38, 13, 4, "plaza");
    for n in 0..STALLS as u16 {
        let x = if n < 3 { 7 + n * 4 } else { 30 + (n - 3) * 4 };
        k.object("stall", x, 39, 3, 2, &format!("stall:{}", n + 1));
        k.spot(&format!("stall:{}", n + 1), x + 1, 38);
    }
    k.object(
        "signpost",
        20,
        37,
        1,
        1,
        "Welcome to Commons! Here: the Commons Mall, north side · All round the Market: the Pond (north), the Arena, the Splat Yard paintball, the Arcade, the Café with pool, Bowling, the Fairground and the Town Hall · Further out: the Park, the Library, the Museum and the Cinema",
    );
    // The corners: willows over round flowerbeds (north), fairy rings of
    // mushrooms (south).
    for (x, y) in [(5u16, 5u16), (42, 5)] {
        for yy in y - 3..y + 4 {
            for xx in x - 3..x + 4 {
                let (dx, dy) = (xx as f32 - x as f32, yy as f32 - y as f32);
                if dx * dx + dy * dy <= 8.0 {
                    k.ground(xx, yy, "flowers");
                }
            }
        }
        k.decor(x, y, "willow");
    }
    for (x, y) in [(5u16, 43u16), (42, 43)] {
        for i in 0..10 {
            let a = i as f32 / 10.0 * std::f32::consts::TAU;
            let (mx, my) = (
                (x as f32 + a.cos() * 2.6).round() as u16,
                (y as f32 + a.sin() * 2.2).round() as u16,
            );
            if my < N - 2 {
                k.decor(mx, my, "mushrooms");
            }
        }
        k.ground(x, y, "flowers");
    }
    // Flowerbeds dotted about the lawn.
    for (x, y) in [
        (4u16, 14u16),
        (43, 21),
        (14, 44),
        (33, 44),
        (44, 31),
        (4, 21),
    ] {
        for yy in y.saturating_sub(1)..(y + 2).min(N - 2) {
            for xx in x.saturating_sub(1)..(x + 2).min(N - 2) {
                if k.free(xx, yy) && dist(xx, yy) > 14.5 {
                    k.ground(xx, yy, "flowers");
                }
            }
        }
    }
    // Round corners where the spur roads meet the streets: the road sweeps
    // round in a wide arc, the pavement following it.
    const R: f32 = 6.0;
    for (px, py, sx, sy) in [
        (0.0f32, 22.0f32, 1.0f32, -1.0f32),
        (0.0, 26.0, 1.0, 1.0),
        (48.0, 22.0, -1.0, -1.0),
        (48.0, 26.0, -1.0, 1.0),
        (22.0, 48.0, -1.0, -1.0),
        (26.0, 48.0, 1.0, -1.0),
    ] {
        let (fx, fy) = (px + sx * R, py + sy * R);
        let (x0, y0) = (px.min(fx) as u16, py.min(fy) as u16);
        for y in y0..y0 + R as u16 {
            for x in x0..x0 + R as u16 {
                let d = ((x as f32 + 0.5 - fx).powi(2) + (y as f32 + 0.5 - fy).powi(2)).sqrt();
                if d > R {
                    k.decor(x, y, "none");
                    k.ground(x, y, "road");
                } else if d > R - 2.0 {
                    k.decor(x, y, "none");
                    k.ground(x, y, "curb");
                }
            }
        }
    }
    // Fisherman Franci's pond, in the lawn west of the Apartments: a little oval of
    // water ringed with flowers, lily pads and reeds, a wooden dock where
    // Franci sits fishing (ambient/francy.ts), a bench facing the water, a lamp.
    let (pcx, pcy, prx, pry) = (6.0f32, 11.0f32, 3.4f32, 2.6f32);
    for y in 7..16u16 {
        for x in 2..12u16 {
            let (dx, dy) = ((x as f32 - pcx) / prx, (y as f32 - pcy) / pry);
            let d = dx * dx + dy * dy;
            if d <= 1.0 {
                k.decor(x, y, "none");
                k.ground(x, y, "water");
            } else if d <= 1.9 {
                k.decor(x, y, "none");
                k.ground(x, y, "flowers");
            }
        }
    }
    for (x, y) in [(4u16, 10u16), (7, 12), (5, 12)] {
        k.decor(x, y, "lilypad");
    }
    for (x, y) in [(2u16, 10u16), (3, 13), (9, 9), (2, 12)] {
        k.decor(x, y, "reeds");
    }
    // The dock, out over the water on the east side, Franci at its end.
    for x in 8..11u16 {
        k.decor(x, 11, "none");
        k.ground(x, 11, "bridge");
    }
    k.object("francy", 8, 11, 1, 1, "Fisherman Franci");
    k.spot("francy", 9, 11);
    k.bench(5, 7, 2);
    k.decor(10, 13, "lamp");
    for (x, y) in [(3u16, 15u16), (9, 14), (1, 9)] {
        if k.free(x, y) {
            k.decor(x, y, "mushrooms");
        }
    }
    // Street lamps round the ring, now everything else is placed: only on
    // open ground (one under a building would glow through its wall).
    for i in 0..8 {
        let a = (i as f32 + 0.5) * std::f32::consts::FRAC_PI_4;
        let (x, y) = (
            (C + a.cos() * 15.6).round() as u16,
            (C + a.sin() * 15.6).round() as u16,
        );
        if k.free(x, y) {
            k.decor(x, y, "lamp");
        }
    }
    // A ring of trees round the outer garden, beyond the footpath (on the
    // lawn only, clear of the roads, the buildings and the paved yards).
    let green = [g("grass"), g("grass_dark"), g("flowers")];
    for i in 0..36 {
        let a = i as f32 / 36.0 * std::f32::consts::TAU;
        let (x, y) = (
            (C + a.cos() * 21.4).round() as u16,
            (C + a.sin() * 21.4).round() as u16,
        );
        if x < 3
            || y < 3
            || x > N - 4
            || y > N - 4
            || (20..28).contains(&x)
            || (20..28).contains(&y)
        {
            continue;
        }
        if k.free(x, y) && green.contains(&k.ground_at(x, y)) {
            k.decor(x, y, if i % 3 == 0 { "apple_tree" } else { "tree" });
        }
    }
    // Bushes, tall grass and mushrooms over the rest of the lawn, and a
    // few flowers and mushrooms on the green in the middle.
    k.scatter(
        2,
        2,
        N - 2,
        N - 2,
        6,
        &["bush", "tallgrass", "tallgrass", "mushrooms"],
    );
    // And the little things that make a lawn feel alive: wildflowers, daisies
    // and clover dotted about, ferns at the feet of the trees, pebbles by the
    // paths and the water. All walk-through.
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            if !k.free(x, y) || !green.contains(&k.ground_at(x, y)) {
                continue;
            }
            let near = |kind: &[u8]| {
                [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)]
                    .iter()
                    .any(|&(dx, dy)| {
                        let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                        nx >= 0 && ny >= 0 && kind.contains(&k.ground_at(nx as u16, ny as u16))
                    })
            };
            let by_tree = [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)]
                .iter()
                .any(|&(dx, dy)| {
                    let (nx, ny) = ((x as i32 + dx) as u16, (y as i32 + dy) as u16);
                    [d("tree"), d("pine"), d("apple_tree"), d("willow")]
                        .contains(&k.decor_at(nx, ny))
                });
            let h = k.hash(x, y, 97) % 1000;
            let kind = if by_tree && h < 450 {
                "fern"
            } else if near(&[g("path"), g("water"), g("plaza")]) && h < 90 {
                "pebbles"
            } else if h < 60 {
                "wildflowers"
            } else if h < 95 {
                "daisies"
            } else if h < 125 {
                "clover"
            } else {
                continue;
            };
            k.decor(x, y, kind);
        }
    }
    for (x, y) in [(18u16, 17u16), (29, 17), (18, 30), (29, 30)] {
        if k.free(x, y) {
            k.decor(x, y, "bush");
        }
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
    // The Old Oak and its swing (south-west).
    k.object("old_oak", 8, 30, 3, 3, "The Old Oak");
    k.decor(10, 34, "swing");
    k.spot("oak", 12, 33);
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
    // The fisherman, at the foot of the pier: he buys your catch.
    k.marker("fisherman", 21, 37, 1, 1, Some("Fisherman"));
    k.spot("fisherman", 22, 38);
    k.bench(5, 22, 3);
    k.bench(40, 22, 3);
    k.scatter(3, 3, N - 3, N - 3, 13, &["tree", "bush", "willow"]);
}

/// The Lake: the Little Island across stepping stones from the pier, the
/// boat hire by the pier, and the campfire circle on the south-west shore.
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
    k.decor(34, 15, "lamp");
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
    // The boat hire: a hut on the bank by the pier, rowboats tied up on the
    // water beside it, where hired boats set out (and people are set down on
    // the pier when the hire's up), and the lake's bounds for the boats.
    k.clear(26, 40, 4, 3, "grass");
    k.object("boat_hire", 26, 40, 3, 2, "Boat hire");
    for x in 19..23 {
        k.decor(x, 36, "none");
        k.decor(x, 37, "none");
    }
    k.marker("boat_moored", 19, 36, 2, 1, None);
    k.spot("boat_launch", 22, 36);
    k.spot("boat_dock", 23, 36);
    k.marker("boat_lake", 4, 5, 41, 35, None);
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
    k.decor(8, 31, "lamp");
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
    k.decor(13, 10, "lamp");
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

/// The gladiator arena: a great walled ring you walk right into, out in the
/// open so anyone passing sees the fight. Sandstone walls with a gate north
/// and south; a paved band round the inside for the crowd to stand on;
/// and the sand in the middle, where the fighters face off along the middle
/// row. The sign by the north gate is where you step up to fight.
fn arena(k: &mut Blk) {
    // The whole block's desert: sand, a paved way to each gate.
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            k.ground(x, y, "sand");
        }
    }
    let (ax, ay, aw, ah) = (11u16, 12u16, 26u16, 17u16);
    k.rect(ax, ay, aw, ah, "plaza");
    k.rect(ax + 2, ay + 2, aw - 4, ah - 4, "sand");
    let gate = ax + aw / 2 - 1;
    for x in ax..ax + aw {
        if x != gate && x != gate + 1 {
            k.decor(x, ay, "arena_wall");
            k.decor(x, ay + ah - 1, "arena_wall");
        }
    }
    for y in ay..ay + ah {
        k.decor(ax, y, "arena_wall");
        k.decor(ax + aw - 1, y, "arena_wall");
    }
    // The ring itself (invisible: it marks where the fight is).
    k.marker("arena", ax, ay, aw, ah, Some("Arena"));
    // Two stone pillars on the sand, to dodge round (or be slammed into),
    // and four spike plates that rise in turn (see commons_sim::arena). The
    // sand inside is 24×15: all of it mirrored, side to side and top to bottom.
    let (sx, sy) = (ax + 1, ay + 1);
    for (px, py) in [(5u16, 7u16), (17, 7)] {
        k.object("arena_pillar", sx + px, sy + py, 2, 2, "Pillar");
    }
    for (px, py) in [(11u16, 1u16), (11, 12), (1, 6), (21, 6)] {
        k.marker("arena_spikes", sx + px, sy + py, 2, 2, None);
    }
    k.object("arena_sign", gate + 3, ay - 2, 2, 1, "Arena");
    k.spot("arena", gate, ay - 1);
    // Flagstone ways in at both gates.
    k.rect(gate, 2, 2, ay - 2, "plaza");
    k.rect(gate, ay + ah, 2, N - 2 - (ay + ah), "plaza");
    // The grand south entrance: an archway over the way in (its two piers
    // solid, the way under it open), a red carpet out from it, and on a dais
    // beside the carpet Caesar with two legionaries: talk to Caesar to fight.
    k.marker("arena_gate", gate - 3, ay + ah + 1, 8, 2, Some("The Arena"));
    for (px, py) in [
        (gate - 3, ay + ah + 1),
        (gate - 2, ay + ah + 1),
        (gate + 3, ay + ah + 1),
        (gate + 4, ay + ah + 1),
    ] {
        for dy in 0..2 {
            let i = k.b.i(k.ox + px, k.oy + py + dy);
            k.b.solid[i] = true;
        }
    }
    k.marker("arena_carpet", gate - 1, ay + ah + 3, 4, 7, None);
    k.object("arena_court", gate + 5, ay + ah + 3, 5, 2, "Caesar");
    k.spot("caesar", gate + 7, ay + ah + 5);
    k.object(
        "signpost",
        gate - 4,
        ay + ah + 4,
        1,
        1,
        "The Arena: talk to Caesar (on his dais by the red carpet) to join the games. Duel, three-way or a four-gladiator brawl; bots if you like",
    );
    // An oasis in the north-west corner: a pool, palms round it, reeds.
    for y in 3..9u16 {
        for x in 3..10u16 {
            let (dx, dy) = ((x as f32 - 6.0) / 3.2, (y as f32 - 5.8) / 2.6);
            let d = dx * dx + dy * dy;
            if d < 1.0 {
                k.ground(x, y, "water");
            } else if d < 1.6 {
                k.ground(x, y, "grass");
            }
        }
    }
    for (x, y) in [(2u16, 4u16), (9, 3), (10, 7), (3, 9), (8, 9)] {
        k.decor(x, y, "palm");
    }
    for (x, y) in [(3u16, 7u16), (9, 5)] {
        k.decor(x, y, "reeds");
    }
    // The desert's bits and pieces, on open sand, clear of the ways through.
    let open = |k: &Blk, x: u16, y: u16| -> bool {
        let i = k.b.i(k.ox + x, k.oy + y);
        k.b.decor[i] == 0 && !k.b.solid[i] && [g("sand"), g("soil")].contains(&k.b.ground[i])
    };
    let clear_of_ways = |x: u16, y: u16| {
        !(gate.saturating_sub(1)..=gate + 2).contains(&x)
            && !(ax.saturating_sub(1)..=ax + aw).contains(&x)
            || y < ay.saturating_sub(3)
            || y > ay + ah + 1
    };
    for y in 3..N - 3 {
        for x in 3..N - 3 {
            if !open(k, x, y) || !clear_of_ways(x, y) {
                continue;
            }
            // Nothing right against the arena's walls.
            if x + 1 >= ax && x <= ax + aw && y + 1 >= ay && y <= ay + ah {
                continue;
            }
            let h = k.hash(x, y, 41) % 1000;
            let kind = match h {
                0..=18 => "cactus",
                19..=42 => "cactus_small",
                43..=80 => "dry_shrub",
                81..=89 => "bones",
                90..=99 => "rock",
                100..=107 => "palm",
                108..=112 => "amphora",
                _ => continue,
            };
            k.decor(x, y, kind);
        }
    }
    // Clay pots and torches by the north gate, either side.
    for (x, y) in [(gate - 2, ay - 2), (gate + 3, ay - 3)] {
        k.decor(x, y, "amphora");
    }
    for (x, y) in [
        (gate - 1, ay - 1),
        (gate + 2, ay - 1),
        (gate - 1, ay + ah),
        (gate + 2, ay + ah),
    ] {
        k.decor(x, y, "lantern");
    }
    // A palm or two by each gate's way, for shade.
    for (x, y) in [
        (gate - 3, 4),
        (gate + 4, 7),
        (gate - 3, ay + ah + 3),
        (gate + 4, ay + ah + 6),
    ] {
        let i = k.b.i(k.ox + x, k.oy + y);
        if k.b.decor[i] == 0 && !k.b.solid[i] {
            k.decor(x, y, "palm");
        }
    }
}

/// The Arcade and the Splat Yard side by side, a promenade in front of
/// both: neon and paint. Outside the arcade, the word games and benches;
/// outside the yard, its crates, hay, drums and tyres (splattered); snack
/// carts and lanterns between; and on the lawn behind, a little obstacle
/// course to run round.
fn fun_corner(k: &mut Blk) {
    k.lawn();
    k.rect(2, 16, 44, 10, "plaza");
    // The way down to the street, flower beds along the promenade's edge.
    k.rect(22, 26, 4, 20, "path");
    for x in [4u16, 9, 14, 30, 35, 40] {
        k.rect(x, 26, 3, 1, "flowers");
    }
    // Paint on the paving, in the teams' colours (the Splat Yard's side), and
    // a glowing pad in the middle.
    for (x, y, team) in [
        (29u16, 20u16, "blue"),
        (33, 22, "red"),
        (38, 20, "blue"),
        (42, 22, "red"),
        (31, 24, "red"),
        (36, 24, "blue"),
    ] {
        k.marker("pb_spawn", x, y, 1, 1, Some(team));
    }
    k.marker("pb_pad", 23, 21, 2, 2, None);
    k.object("arcade_hall", 3, 7, 16, 9, "Arcade");
    k.spot("door:arcade", 11, 16);
    k.spot("arcade_hall", 11, 17);
    k.object("paintball_hall", 25, 6, 20, 10, "Splat Yard");
    k.spot("door:paintball", 35, 16);
    k.spot("paintball", 35, 17);
    // The arcade's side: the word games, benches, signs.
    k.object("arcade", 5, 18, 3, 1, "");
    k.bench(14, 18, 3);
    k.bench(5, 23, 3);
    k.object(
        "signpost",
        3,
        17,
        1,
        1,
        "Arcade: pong, light cycles, racers, a dance-off and more inside; word games out here",
    );
    // The yard's side: its kit piled up, splattered.
    k.object("pb_crate", 40, 18, 1, 1, "");
    k.object("pb_crate", 41, 18, 1, 1, "");
    k.object("pb_crate", 41, 17, 1, 1, "");
    k.object("pb_hay", 43, 19, 2, 1, "");
    k.object("pb_drum", 28, 18, 1, 1, "");
    k.object("pb_tires", 44, 23, 1, 1, "");
    k.object("pb_tires", 43, 23, 1, 1, "");
    k.object(
        "signpost",
        45,
        17,
        1,
        1,
        "Splat Yard: paintball inside, Blue against Red, three a side. First to ten!",
    );
    // Snack carts in the middle, lanterns along the front.
    k.object("market_cart", 20, 18, 2, 1, "Snacks");
    k.object("market_cart", 26, 23, 2, 1, "Snacks");
    for x in (4..45u16).step_by(5) {
        k.decor(x, 25, "lantern");
    }
    // Behind, on the lawn: a little course to run round (bunkers, a hay
    // wall, tyres, a hedge to hide in), and benches to watch from.
    for (kind, x, y, w, h) in [
        ("pb_snake", 6u16, 30u16, 4u16, 1u16),
        ("pb_x", 12, 33, 2, 2),
        ("pb_hay", 7, 36, 2, 1),
        ("pb_tires", 15, 30, 1, 1),
        ("pb_tires", 16, 30, 1, 1),
        ("pb_drum", 10, 39, 1, 1),
        ("pb_hedge", 15, 37, 2, 2),
        ("pb_snake", 32, 31, 1, 4),
        ("pb_crate", 36, 34, 1, 1),
        ("pb_crate", 37, 34, 1, 1),
        ("pb_hay", 39, 38, 2, 1),
        ("pb_x", 34, 39, 2, 2),
    ] {
        k.object(kind, x, y, w, h, "");
    }
    k.bench(18, 42, 3);
    k.bench(28, 42, 3);
    k.scatter(2, 27, N - 2, N - 3, 9, &["tree", "bush", "bush"]);
}

/// Round the Market, so there's always something going on and you can
/// find the fun next door: signposts at each way out naming what's that way
/// (the blocks all round the Market are where the games are), lanterns
/// along the garden path that glow after dark, and picnic blankets on the
/// lawn to sit on.
fn market_extras(k: &mut Blk, name: &dyn Fn(i32, i32) -> String) {
    const C: f32 = 23.5;
    let near_free = |k: &Blk, x: u16, y: u16| -> Option<(u16, u16)> {
        for r in 0..4i32 {
            for dy in -r..=r {
                for dx in -r..=r {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx > 1
                        && ny > 1
                        && nx < N as i32 - 2
                        && ny < N as i32 - 2
                        && k.free(nx as u16, ny as u16)
                    {
                        return Some((nx as u16, ny as u16));
                    }
                }
            }
        }
        None
    };
    let signs: [(u16, u16, String); 4] = [
        (
            23,
            3,
            format!(
                "North: {}  ·  NW: {}  ·  NE: {}",
                name(0, -1),
                name(-1, -1),
                name(1, -1)
            ),
        ),
        (
            4,
            19,
            format!(
                "West: {}  ·  NW: {}  ·  SW: {}",
                name(-1, 0),
                name(-1, -1),
                name(-1, 1)
            ),
        ),
        (
            43,
            19,
            format!(
                "East: {}  ·  NE: {}  ·  SE: {}",
                name(1, 0),
                name(1, -1),
                name(1, 1)
            ),
        ),
        (
            28,
            44,
            format!(
                "South: {}  ·  SW: {}  ·  SE: {}",
                name(0, 1),
                name(-1, 1),
                name(1, 1)
            ),
        ),
    ];
    for (x, y, text) in signs {
        if let Some((sx, sy)) = near_free(k, x, y) {
            k.object("signpost", sx, sy, 1, 1, &text);
        }
    }
    // Lanterns round the garden path (inside it, or else just outside).
    for i in 0..16 {
        let a = i as f32 / 16.0 * std::f32::consts::TAU + 0.2;
        for r in [17.7f32, 20.6] {
            let (x, y) = (
                (C + a.cos() * r).round() as u16,
                (C + a.sin() * r).round() as u16,
            );
            if k.free(x, y) {
                k.decor(x, y, "lantern");
                break;
            }
        }
    }
    // Picnic blankets on the lawn between the roundabout and the path.
    for a in [0.8f32, 2.35, 3.95, 5.5] {
        let (x, y) = (
            (C + a.cos() * 16.4).round() as u16,
            (C + a.sin() * 16.4).round() as u16,
        );
        if let Some((bx, by)) = near_free(k, x, y) {
            k.decor(bx, by, "blanket");
        }
    }
}

/// A fenced lot a club can rent for its clubhouse (ADR 0014, C3). The
/// `club_house` object is the clubhouse's footprint: drawn as a building
/// site while the lot is free, and as the club's house, under its banner,
/// once a club rents it. Its door (`door:lot:<bx>_<by>`) leads into the
/// club's room.
fn club_lot(k: &mut Blk, block: BlockId) {
    k.lawn();
    let lot = commons_sim::city::club_lot_key(block);
    k.object("club_house", 14, 14, 20, 10, &lot);
    k.spot(&format!("door:{lot}"), 24, 24);
    k.spot(&lot, 24, 25);
    k.rect(22, 25, 4, 16, "path");
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
        "Club lot: a club can rent this land for its clubhouse, at the Club Hall's desk",
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
        // The yard stand by the front door: drawn when its owner puts
        // something on it (it's walked past, not into: a marker).
        k.marker("yard_stand", door.0 - 3, door.1, 2, 1, Some(&lot));
    };
    for i in 0..3u16 {
        let x0 = 3 + i * 15;
        k.rect(x0 + 1, 9, 10, 3, "flowers");
        k.rect(x0 + 1, 33, 10, 3, "flowers");
        house(k, i as u8, (x0 + 1, 3, 10, 6));
        // The south row stands back from the pavement, so a front fence
        // (a row in front of the door) stays on the lawn.
        house(k, 3 + i as u8, (x0 + 1, 37, 10, 6));
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
            // The wishing well, on the plaza beside the Town Hall's steps.
            k.object("well", 32, 20, 2, 2, "Wishing Well");
            k.spot("well", 33, 23);
        }
        // The arcade hall, the bar and the library have their own floors behind their
        // doors; `door:<place>` is where you come out again.
        "arcade" => {
            k.object("arcade_hall", 16, 9, 16, 9, "Arcade");
            k.spot("door:arcade", 24, 18);
            k.spot("arcade_hall", 24, 19);
        }
        "club_hall" => {
            k.object("club_hall", 14, 8, 20, 10, "Club Hall");
            k.spot("door:club_hall", 24, 18);
            k.spot("club_hall", 24, 19);
        }
        // The Casino (ADR 0017): coins only, 16 and over.
        "casino" => {
            k.object("casino", 14, 7, 20, 11, "Casino");
            k.spot("door:casino", 24, 18);
            k.spot("casino", 24, 19);
        }
        // The Concert Hall (ADR 0015), on the Theater block.
        "theater" => {
            k.object("concert_hall", 14, 7, 20, 11, "Concert Hall");
            k.spot("door:concert_hall", 24, 18);
            k.spot("concert_hall", 24, 19);
        }
        "paintball" => {
            k.object("paintball_hall", 14, 8, 20, 10, "Splat Yard");
            k.spot("door:paintball", 24, 18);
            k.spot("paintball", 24, 19);
        }
        "bowling" => {
            k.object("bowling_alley", 16, 9, 16, 9, "Bowling");
            k.spot("door:bowling", 24, 18);
            k.spot("bowling", 24, 19);
        }
        "library" => {
            k.object("library", 13, 7, 22, 11, "Library");
            k.spot("door:library", 24, 18);
            k.spot("library", 24, 19);
        }
        // The Museum & Gallery (ADR 0018): one building, a door on each block.
        "museum" => {
            k.object("museum", 12, 7, 24, 11, "Museum & Gallery");
            k.spot("door:museum", 24, 18);
            k.spot("museum", 24, 19);
        }
        "gallery" => {
            k.object("gallery", 13, 8, 22, 10, "Museum & Gallery");
            k.spot("door:gallery", 24, 18);
            k.spot("gallery", 24, 19);
        }
        "cafe" => {
            k.object("bar", 16, 9, 16, 9, "The Mossy Mug");
            k.spot("door:bar", 24, 18);
            k.spot("bar", 24, 19);
        }
        _ => k.object("building", 12, 7, 24, 11, name),
    }
    let sign = match key {
        "town_hall" => "Town Hall: the town's votes and proposals".to_string(),
        "gallery" => {
            "Gallery: paint in the Studio, hang it in the Salon, and see everyone's work. Easels out here for painting together"
                .to_string()
        }
        "museum" => {
            "Museum: the town's natural history, given by its people, and the Hall of Fame".to_string()
        }
        "theater" => {
            "Concert Hall: take the stage and everyone inside hears you".to_string()
        }
        "cinema" => "Cinema: the big screen plays outside; the cinema opens soon".to_string(),
        "arcade" => {
            "Arcade: pong, light cycles, racers, a dance-off and more inside; word games out here"
                .to_string()
        }
        "cafe" => "The Mossy Mug: drinks, the pool table and pinball inside".to_string(),
        "library" => {
            "Library: every book in Project Gutenberg, in every language. Browse the wings, or ask at the desk"
                .to_string()
        }
        "casino" => {
            "Casino: slots and roulette, coins only, never real money. 16 and over".to_string()
        }
        "bowling" => "Bowling: four lanes inside; rent shoes at the counter".to_string(),
        "paintball" => "Splat Yard: paintball inside, Blue against Red, three a side. First to ten!".to_string(),
        "club_hall" => {
            "Club Hall: found a club, rent its room, and meet up with your members".to_string()
        }
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
            // Boats set out on the water, a step from the pier.
            "spot" if o.label.as_deref() == Some("boat_launch") => near(o.x, o.y, 1),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_boat_hire_sits_by_the_pier_with_boats_on_the_lake() {
        let map = city();
        let grid = map.grid();
        let find = |kind: &str, label: Option<&str>| {
            map.objects
                .iter()
                .find(|o| o.kind == kind && (label.is_none() || o.label.as_deref() == label))
                .unwrap_or_else(|| panic!("{kind} {label:?}"))
        };
        let water = map.ground_legend.iter().position(|g| g == "water").unwrap() as u8;
        let wet =
            |x: u16, y: u16| map.ground[y as usize * map.width as usize + x as usize] == water;
        let launch = find("spot", Some("boat_launch"));
        let dock = find("spot", Some("boat_dock"));
        let hut = find("boat_hire", None);
        let moored = find("boat_moored", None);
        let lake = find("boat_lake", None);
        assert!(wet(launch.x, launch.y), "boats set out on the water");
        assert!(wet(moored.x, moored.y) && wet(moored.x + 1, moored.y));
        assert!(grid.walkable(dock.x, dock.y), "the dock's on the pier");
        assert!(launch.x.abs_diff(dock.x) <= 1 && launch.y.abs_diff(dock.y) <= 1);
        assert!(
            (lake.x..lake.x + lake.w).contains(&launch.x)
                && (lake.y..lake.y + lake.h).contains(&launch.y)
        );
        // From the hut's front to the dock, on foot.
        let front = (hut.x + 1, hut.y + hut.h);
        assert!(commons_sim::find_path(&grid, front, (dock.x, dock.y), 100_000).is_some());
        assert!(
            hut.x.abs_diff(dock.x).max(hut.y.abs_diff(dock.y)) <= 8,
            "hired by the pier"
        );
    }
}
