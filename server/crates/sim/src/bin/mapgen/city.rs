//! The city map (ADR 0010): the whole grid from `assets/city/` as one zone.
//! Streets run between and around the blocks; every block gets a layout for
//! its type and a sign. Since C2 the founding park's content lives in its
//! blocks: the fountain in the Market, the grove and chess in the Park, the
//! pier at the Pond, the island and campfire at the Lake, and so on.
//!
//! Invisible `spot` objects name places the client walks people to (the
//! Caretaker's rounds, "Show me", gatherings), so no coordinates live in
//! client code.

use super::{Brush, Builder, d, g, hash, maze, noise, nook, spline};
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
    let last = geo.blocks as u8 - 2;
    let mid = geo.blocks as u8 / 2;
    // The Ring Road: a great circle round the town's heart, running into
    // the square's edge street at the middle of each side (just as wide, so
    // there it is that street), everything beyond it out to the square's
    // corners woods.
    let middle = geo.block_origin(BlockId { bx: mid, by: mid }).x as f32 + N as f32 / 2.0;
    let street =
        |b: u8| geo.block_origin(BlockId { bx: b, by: b }).x as f32 - geo.street_tiles as f32 / 2.0;
    let ring = Ring {
        cx: size as f32 / 2.0,
        cy: size as f32 / 2.0,
        r: middle - street(1),
    };
    // And the Inner Ring round the town centre: the Market and its eight
    // neighbours, running into the streets round them at their middles.
    let inner = Ring {
        cx: size as f32 / 2.0,
        cy: size as f32 / 2.0,
        r: middle - street(2),
    };
    let (a, z) = (
        geo.block_origin(BlockId { bx: 1, by: 1 }).x,
        geo.block_origin(BlockId { bx: last, by: last }).x + N,
    );
    let plan = Plan {
        ring: &ring,
        inner: &inner,
        a,
        z,
        pitch: geo.block_tiles + geo.street_tiles,
        street: geo.street_tiles,
    };
    // Where the paths out of the buildings between the rings start.
    let mut fronts = vec![];
    for (id, t) in city.blocks() {
        let o = geo.block_origin(id);
        let mut k = Blk {
            b: &mut b,
            ox: o.x,
            oy: o.y,
            salt: (id.by as u32) << 8 | id.bx as u32,
        };
        sidewalk(&mut k);
        // The eight blocks the Ring Road cuts across (between the middles of
        // the square's sides and its corners): laid out to fit inside it.
        let side = |v: u8| v == 1 || v == last;
        let cut = side(id.bx) != side(id.by)
            && id.bx != mid
            && id.by != mid
            && (1..=last).contains(&id.bx)
            && (1..=last).contains(&id.by);
        if cut {
            fronts.push(fitted_edge(&mut k, &ring, &inner, id, &t.key, &t.name));
            continue;
        }
        // The four town-centre corner blocks the Inner Ring cuts across.
        let near = |v: u8| v == 2 || v == last - 1;
        if near(id.bx) && near(id.by) {
            fitted_inner(&mut k, &inner, id, &t.key, &t.name);
            continue;
        }
        match t.key.as_str() {
            "market" => {
                market(&mut k);
                let (bx, by) = (id.bx as i32, id.by as i32);
                market_extras(&mut k, &|dx, dy| {
                    names.get(&(bx + dx, by + dy)).cloned().unwrap_or_default()
                });
                // Only the kerbs along the roads are stone here: of the paved yards,
                // what touches a road is kerb, and the rest is grass.
                let (plaza, road) = (g("plaza"), g("road"));
                for y in 0..N {
                    for x in 0..N {
                        if k.ground_at(x, y) != plaza {
                            continue;
                        }
                        let by_road = (x.saturating_sub(1)..=(x + 1).min(N - 1)).any(|a| {
                            (y.saturating_sub(1)..=(y + 1).min(N - 1))
                                .any(|b| k.ground_at(a, b) == road)
                        });
                        k.ground(x, y, if by_road { "curb" } else { "grass" });
                    }
                }
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
    }

    for (id, _) in city.blocks() {
        let o = geo.block_origin(id);
        round_corners(&mut b, o.x, o.y);
    }
    // The big square's four outer corners, rounded off in a wide sweep, a
    // little paved corner square in each, where the roads out of town meet.
    for (bx, by, sx, sy) in [
        (1, 1, 1, 1),
        (last, 1, -1, 1),
        (1, last, 1, -1),
        (last, last, -1, -1),
    ] {
        let o = geo.block_origin(BlockId { bx, by });
        corner_square(&mut b, o.x, o.y, sx, sy, 20.0);
    }
    // The rings through it all: the streets between them in the diagonals
    // gone (the plots there run together), the corners where they meet the
    // streets swept round, kerbs and lamps all along.
    shape_town(&mut b, &plan);

    for (id, t) in city.blocks() {
        let o = geo.block_origin(id);
        let mut k = Blk {
            b: &mut b,
            ox: o.x,
            oy: o.y,
            salt: (id.by as u32) << 8 | id.bx as u32,
        };
        // Every block names itself on its south pavement (the Market's a
        // little to the side, clear of its south road's rounded corner), or,
        // where that's gone or a ring road crosses it, its north one, or
        // its east or west one.
        let sign_x = if t.key == "market" { 18 } else { 21 };
        let sides = [
            ((sign_x, N - 2), (25, N - 2), (27, N - 2)),
            ((sign_x, 0), (25, 0), (27, 0)),
            ((N - 2, sign_x), (N - 2, 25), (N - 2, 27)),
            ((0, sign_x), (0, 25), (0, 27)),
        ];
        let fits = |k: &Blk, (sign, metro, spot): ((u16, u16), (u16, u16), (u16, u16))| {
            [
                sign,
                spot,
                metro,
                (metro.0 + 1, metro.1),
                (metro.0, metro.1 + 1),
                (metro.0 + 1, metro.1 + 1),
            ]
            .iter()
            .all(|&(x, y)| {
                let (gx, gy) = (k.ox + x, k.oy + y);
                let i = k.b.i(gx, gy);
                k.b.ground[i] == g("curb")
                    && !k.b.solid[i]
                    && !ring.near(gx, gy)
                    && !inner.near(gx, gy)
            })
        };
        let (sign, metro, spot) = sides
            .iter()
            .copied()
            .find(|&s| fits(&k, s))
            .unwrap_or(sides[0]);
        k.decor(sign.0, sign.1, "none");
        k.object("signpost", sign.0, sign.1, 1, 1, &t.name);
        // A metro station's entrance beside the signpost on some (ADR 0016):
        // stairs down to the underground; you come up at `door:metro_<key>`.
        if let Some((_, _, key, name)) = STATIONS.iter().find(|s| (s.0, s.1) == (id.bx, id.by)) {
            for (x, y) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                k.decor(metro.0 + x, metro.1 + y, "none");
            }
            k.object("metro_entrance", metro.0, metro.1, 2, 2, name);
            k.spot(&format!("door:metro_{key}"), spot.0, spot.1);
            k.spot(&format!("metro_{key}"), spot.0, spot.1);
        }
    }

    // Between the rings, the plots run together: a green in each, paths
    // to it, trees and benches. Beyond the Ring Road, the woods.
    greens(&mut b, &plan, &fronts);
    wildwood(&mut b, &plan, &geo);
    avenue(&mut b, &plan, &ring);
    avenue(&mut b, &plan, &inner);

    // Where bugs and mushrooms turn up in the green blocks (ADR 0019).
    for (id, t) in city.blocks() {
        let o = geo.block_origin(id);
        let mut k = Blk {
            b: &mut b,
            ox: o.x,
            oy: o.y,
            salt: (id.by as u32) << 8 | id.bx as u32,
        };
        match t.key.as_str() {
            "park" => forage(&mut k, "park", 12, 6),
            "pond" => forage(&mut k, "park", 10, 4),
            "lake" => forage(&mut k, "park", 12, 4),
            "orchard" => forage(&mut k, "orchard", 12, 8),
            "woods" => forage(&mut k, "woods", 14, 14),
            "meadow" => forage(&mut k, "meadow", 14, 8),
            _ => {}
        }
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
    for (sx, sy) in [(1, 1), (-1, 1), (1, -1), (-1, -1)] {
        round_corner(b, ox, oy, sx, sy, 6.0);
    }
}

/// Rounds one corner of the block at (ox, oy) with radius `r`: the one
/// toward −x if `sx` is 1 (+x if −1), −y if `sy` is 1 (+y if −1).
fn round_corner(b: &mut Builder, ox: u16, oy: u16, sx: i32, sy: i32, r: f32) {
    let (road, curb, lamp) = (g("road"), g("curb"), super::d("lamp"));
    let (px, py) = (if sx > 0 { 0 } else { N }, if sy > 0 { 0 } else { N });
    let (fx, fy) = (px as f32 + sx as f32 * r, py as f32 + sy as f32 * r);
    let n = r.ceil() as u16;
    for j in 0..n {
        for i in 0..n {
            let x = if sx > 0 { px + i } else { px - 1 - i };
            let y = if sy > 0 { py + j } else { py - 1 - j };
            let d = ((x as f32 + 0.5 - fx).powi(2) + (y as f32 + 0.5 - fy).powi(2)).sqrt();
            // (Only the corner's own quarter: beyond the arc's centre, it's straight.)
            if d <= r - 2.0
                || (x as f32 + 0.5 - fx) * sx as f32 > 0.0
                || (y as f32 + 0.5 - fy) * sy as f32 > 0.0
            {
                continue;
            }
            let k = b.i(ox + x, oy + y);
            if b.solid[k] {
                continue;
            }
            if d > r {
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

/// One of the big square's four outer corners rounded off in a wide sweep
/// (radius `r`): beyond the kerb, where the corner was, a little paved
/// square where the roads out of town meet, with a shady willow in a bed,
/// a bench under it, and a lamp.
fn corner_square(b: &mut Builder, ox: u16, oy: u16, sx: i32, sy: i32, r: f32) {
    round_corner(b, ox, oy, sx, sy, r);
    let (px, py) = (
        if sx > 0 { 0i32 } else { N as i32 },
        if sy > 0 { 0i32 } else { N as i32 },
    );
    let (fx, fy) = (px as f32 + sx as f32 * r, py as f32 + sy as f32 * r);
    let n = r.ceil() as i32;
    let mut paved = vec![];
    for j in 0..n {
        for i in 0..n {
            let x = if sx > 0 { px + i } else { px - 1 - i };
            let y = if sy > 0 { py + j } else { py - 1 - j };
            let d = ((x as f32 + 0.5 - fx).powi(2) + (y as f32 + 0.5 - fy).powi(2)).sqrt();
            if d <= r
                || (x as f32 + 0.5 - fx) * sx as f32 > 0.0
                || (y as f32 + 0.5 - fy) * sy as f32 > 0.0
            {
                continue;
            }
            let k = b.i(ox + x as u16, oy + y as u16);
            if b.solid[k] {
                continue;
            }
            // (The street's own lanes stay road: the square's the swept-off part.)
            if x >= 2 && y >= 2 && x < N as i32 - 2 && y < N as i32 - 2 {
                b.ground[k] = g("plaza");
                paved.push((x, y));
            }
        }
    }
    // Its furniture, along the diagonal from the corner.
    let at = |t: i32| {
        (
            (if sx > 0 { 2 + t } else { N as i32 - 3 - t }),
            (if sy > 0 { 2 + t } else { N as i32 - 3 - t }),
        )
    };
    let (tx, ty) = at(2);
    if paved.contains(&(tx, ty)) {
        let (gx, gy) = ((ox as i32 + tx) as u16, (oy as i32 + ty) as u16);
        b.ground(gx, gy, "grass");
        b.decor(gx, gy, "willow");
        for (dx, dy) in [(1, 0), (0, 1), (1, 1)] {
            let (x, y) = (tx + dx * sx, ty + dy * sy);
            if paved.contains(&(x, y)) {
                b.ground((ox as i32 + x) as u16, (oy as i32 + y) as u16, "flowers");
            }
        }
    }
    let (bx, by) = at(5);
    if paved.contains(&(bx, by)) && paved.contains(&(bx + 1, by)) {
        b.decor((ox as i32 + bx) as u16, (oy as i32 + by) as u16, "bench");
        b.decor(
            (ox as i32 + bx + 1) as u16,
            (oy as i32 + by) as u16,
            "bench",
        );
    }
    let (lx, ly) = at(0);
    if paved.contains(&(lx, ly)) {
        b.decor((ox as i32 + lx) as u16, (oy as i32 + ly) as u16, "lamp");
    }
}

/// The Ring Road: a circle round the town's heart (global tiles).
struct Ring {
    cx: f32,
    cy: f32,
    /// To the road's middle.
    r: f32,
}

impl Ring {
    /// The road's half-width, and its kerbs either side.
    const HALF: f32 = 2.0;
    const KERB: f32 = 2.0;

    /// How far tile (x, y)'s middle is from the circle's centre.
    fn d(&self, x: u16, y: u16) -> f32 {
        ((x as f32 + 0.5 - self.cx).powi(2) + (y as f32 + 0.5 - self.cy).powi(2)).sqrt()
    }
    /// On the road or its kerbs.
    fn near(&self, x: u16, y: u16) -> bool {
        (self.d(x, y) - self.r).abs() <= Self::HALF + Self::KERB
    }
    /// Beyond it (out in the woods).
    fn beyond(&self, x: u16, y: u16) -> bool {
        self.d(x, y) > self.r + Self::HALF + Self::KERB
    }
    /// Safely inside it, `margin` tiles in from its inner kerb.
    fn inside(&self, x: u16, y: u16, margin: f32) -> bool {
        self.d(x, y) < self.r - Self::HALF - Self::KERB - margin
    }
}

/// The town's plan: its two rings, the square inside its edge street (`a`
/// to `z` each way), and the grid's streets, `pitch` apart, `street` wide.
/// Between the rings in the four diagonals (off the cross of streets
/// through the middle) the grid's streets are gone: the plots there run
/// together, and beyond the Ring Road they're the woods'.
struct Plan<'a> {
    ring: &'a Ring,
    inner: &'a Ring,
    a: u16,
    z: u16,
    pitch: u16,
    street: u16,
}

impl Plan<'_> {
    /// How far (x, y) is off the middle, across and down.
    fn off(&self, x: f32, y: f32) -> (f32, f32) {
        ((x - self.ring.cx).abs(), (y - self.ring.cy).abs())
    }
    /// Whether the street stretch (between two crossings, or a crossing)
    /// with its middle at (mx, my) is gone: in the square, off the cross
    /// through the middle, outside the Inner Ring.
    fn gone(&self, mx: f32, my: f32) -> bool {
        let (dx, dy) = self.off(mx, my);
        let (a, z) = (self.a as f32, self.z as f32);
        (a..z).contains(&mx)
            && (a..z).contains(&my)
            && dx > 30.0
            && dy > 30.0
            && dx.hypot(dy) > self.inner.r
    }
    /// The middle of street `i` (counting the outermost as 0).
    fn lane(&self, i: u16) -> f32 {
        (i * self.pitch) as f32 + self.street as f32 / 2.0
    }
    /// The middle of block `b`'s side (counting the outermost as 0).
    fn mid(&self, b: u16) -> f32 {
        (self.street + b * self.pitch) as f32 + N as f32 / 2.0
    }
    /// On one of the streets' middle lines, which long walks follow.
    fn on_lane(&self, x: u16, y: u16) -> bool {
        let l = self.street / 2;
        x % self.pitch == l || y % self.pitch == l
    }
    /// Whether tile (x, y) belongs to a street stretch that's gone: it's on
    /// it, on the pavement along it, or on a block's rounded corner where
    /// it met another.
    fn joined(&self, x: u16, y: u16) -> bool {
        let (p, s) = (self.pitch, self.street);
        let (on_v, on_h) = (x % p < s, y % p < s);
        if on_v || on_h {
            let mx = if on_v {
                self.lane(x / p)
            } else {
                self.mid((x - s) / p)
            };
            let my = if on_h {
                self.lane(y / p)
            } else {
                self.mid((y - s) / p)
            };
            return self.gone(mx, my);
        }
        let (bx, by) = ((x - s) / p, (y - s) / p);
        let (lx, ly) = ((x - s) % p, (y - s) % p);
        let side = |l: u16, b: u16| {
            if l < 6 {
                Some(b)
            } else if l >= N - 6 {
                Some(b + 1)
            } else {
                None
            }
        };
        let (vi, hj) = (side(lx, bx), side(ly, by));
        let edge = |l: u16| !(2..N - 2).contains(&l);
        let v =
            vi.is_some_and(|i| (edge(lx) || hj.is_some()) && self.gone(self.lane(i), self.mid(by)));
        let h =
            hj.is_some_and(|j| (edge(ly) || vi.is_some()) && self.gone(self.mid(bx), self.lane(j)));
        let c = vi
            .zip(hj)
            .is_some_and(|(i, j)| self.gone(self.lane(i), self.lane(j)));
        v || h || c
    }
    /// Between the rings in a diagonal, clear of their kerbs: where the
    /// plots run together. Which diagonal: 0 north-west, 1 north-east, 2
    /// south-west, 3 south-east.
    fn lens(&self, x: u16, y: u16) -> Option<usize> {
        let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
        let (dx, dy) = self.off(fx, fy);
        let clear = Ring::HALF + Ring::KERB;
        ((self.a..self.z).contains(&x)
            && (self.a..self.z).contains(&y)
            && dx > 30.0
            && dy > 30.0
            && self.inner.d(x, y) > self.inner.r + clear
            && self.ring.d(x, y) < self.ring.r - clear)
            .then(|| self.quarter(x, y))
    }
    /// Which diagonal (x, y) is toward.
    fn quarter(&self, x: u16, y: u16) -> usize {
        (x as f32 + 0.5 > self.ring.cx) as usize + 2 * (y as f32 + 0.5 > self.ring.cy) as usize
    }
}

/// Shapes the town round its rings (in the square inside its edge
/// street): the street stretches between the rings in the diagonals, and
/// beyond the Ring Road, gone to lawn (the plots either side joined); both
/// rings laid, each a street as wide as the grid's, so where one runs into
/// a street it is that street; the corners where they meet the streets
/// swept round; and the kerbs redrawn along every road's edge (and taken
/// up where there's no road any more), lamps every so far along them.
fn shape_town(b: &mut Builder, plan: &Plan) {
    let (road, curb, lamp) = (g("road"), g("curb"), d("lamp"));
    let (ring, inner, a, z) = (plan.ring, plan.inner, plan.a, plan.z);
    for y in a..z {
        for x in a..z {
            let i = b.i(x, y);
            if [road, curb].contains(&b.ground[i]) && plan.joined(x, y) {
                b.ground[i] = g("grass");
                if b.decor[i] == lamp {
                    b.decor[i] = 0;
                }
            }
        }
    }
    for r in [ring, inner] {
        for y in a..z {
            for x in a..z {
                if (r.d(x, y) - r.r).abs() <= Ring::HALF {
                    let i = b.i(x, y);
                    assert!(
                        !b.solid[i],
                        "a ring road runs into something built at ({x}, {y})"
                    );
                    b.ground[i] = road;
                    b.decor[i] = 0;
                }
            }
        }
    }
    let (w, h) = (b.w as i32, b.h as i32);
    let is_road = |b: &Builder, x: i32, y: i32| {
        x >= 0 && y >= 0 && x < w && y < h && b.ground[b.i(x as u16, y as u16)] == road
    };
    // The corners where the rings meet the streets swept round: any plot a
    // disc this wide can't sit in goes to the road. (Not out in the woods:
    // their ends tapering in to where the Ring Road meets the edge street
    // stay, kerbed.)
    const SWEEP: i32 = 5;
    let disc: Vec<(i32, i32)> = (-SWEEP..=SWEEP)
        .flat_map(|dy| (-SWEEP..=SWEEP).map(move |dx| (dx, dy)))
        .filter(|&(dx, dy)| dx * dx + dy * dy <= SWEEP * SWEEP)
        .collect();
    let mut sits = vec![false; b.ground.len()];
    for y in a as i32 - SWEEP..z as i32 + SWEEP {
        for x in a as i32 - SWEEP..z as i32 + SWEEP {
            if disc.iter().all(|&(dx, dy)| !is_road(b, x + dx, y + dy)) {
                sits[b.i(x as u16, y as u16)] = true;
            }
        }
    }
    let swept = |x: u16, y: u16| {
        ring.d(x, y) < ring.r
            && ((ring.d(x, y) - ring.r).abs() <= 12.0 || (inner.d(x, y) - inner.r).abs() <= 12.0)
    };
    for y in a..z {
        for x in a..z {
            let i = b.i(x, y);
            if b.ground[i] == road || b.ground[i] == g("water") || b.solid[i] || !swept(x, y) {
                continue;
            }
            let held = disc.iter().any(|&(dx, dy)| {
                let (u, v) = (x as i32 + dx, y as i32 + dy);
                u >= 0 && v >= 0 && u < w && v < h && sits[b.i(u as u16, v as u16)]
            });
            if !held {
                b.ground[i] = road;
                b.decor[i] = 0;
            }
        }
    }
    // (And no lone tile left standing in the road where the curve's edge
    // steps: one with road on three sides goes to the road too.)
    for _ in 0..3 {
        for y in a..z {
            for x in a..z {
                let i = b.i(x, y);
                let edge =
                    (ring.d(x, y) - ring.r).abs() <= 4.0 || (inner.d(x, y) - inner.r).abs() <= 4.0;
                if b.ground[i] == road
                    || b.ground[i] == g("water")
                    || b.solid[i]
                    || !(swept(x, y) || edge)
                {
                    continue;
                }
                let sides = [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)]
                    .iter()
                    .filter(|&&(dx, dy)| is_road(b, x as i32 + dx, y as i32 + dy))
                    .count();
                if sides >= 3 {
                    b.ground[i] = road;
                    b.decor[i] = 0;
                }
            }
        }
    }
    // The kerbs: a pavement two tiles wide along every road's edge round
    // the rings, the joined plots and the woods.
    let redrawn = |x: u16, y: u16| {
        let (dx, dy) = plan.off(x as f32 + 0.5, y as f32 + 0.5);
        (ring.d(x, y) - ring.r).abs() <= 16.0
            || (inner.d(x, y) - inner.r).abs() <= 16.0
            || (dx > 30.0 && dy > 30.0 && inner.d(x, y) > inner.r)
    };
    let mut kerbs = vec![];
    for y in a..z {
        for x in a..z {
            let i = b.i(x, y);
            if !redrawn(x, y)
                || b.solid[i]
                || [road, g("water"), g("bridge")].contains(&b.ground[i])
            {
                continue;
            }
            let near = (-2i32..=2).any(|dy| {
                (-2i32..=2)
                    .any(|dx| dx * dx + dy * dy <= 5 && is_road(b, x as i32 + dx, y as i32 + dy))
            });
            kerbs.push((i, near));
        }
    }
    for (i, near) in kerbs {
        if near {
            b.ground[i] = curb;
            if b.decor[i] != lamp {
                b.decor[i] = 0;
            }
        } else if b.ground[i] == curb {
            b.ground[i] = g("grass");
            if b.decor[i] == lamp {
                b.decor[i] = 0;
            }
        }
    }
    // Lamps along the kerbs' edges, every ten tiles or so.
    let lit = |b: &Builder, x: u16, y: u16| {
        (-10i32..=10).any(|dy| {
            (-10i32..=10).any(|dx| {
                let (u, v) = (x as i32 + dx, y as i32 + dy);
                dx * dx + dy * dy <= 100
                    && u >= 0
                    && v >= 0
                    && u < w
                    && v < h
                    && b.decor[b.i(u as u16, v as u16)] == lamp
            })
        })
    };
    for y in a..z {
        for x in a..z {
            let i = b.i(x, y);
            if !redrawn(x, y)
                || b.ground[i] != curb
                || b.solid[i]
                || b.decor[i] != 0
                || plan.on_lane(x, y)
            {
                continue;
            }
            let edge = [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)]
                .iter()
                .any(|&(dx, dy)| is_road(b, x as i32 + dx, y as i32 + dy));
            if edge && !lit(b, x, y) {
                b.decor[i] = lamp;
            }
        }
    }
}

/// Plants (trees, bushes, the little things underfoot) a footpath clears.
fn soft(decor: u8) -> bool {
    [
        "none",
        "tree",
        "pine",
        "bush",
        "apple_tree",
        "willow",
        "tallgrass",
        "wildflowers",
        "daisies",
        "clover",
        "pebbles",
        "fern",
        "mushrooms",
    ]
    .iter()
    .any(|k| d(k) == decor)
}

/// Within a tile of anything that isn't lawn (paths, kerbs, anything
/// built, other trees): keeps trees from blocking ways through.
fn near_built(b: &Builder, x: u16, y: u16) -> bool {
    (-1i32..=1).any(|dy| {
        (-1i32..=1).any(|dx| {
            let i = b.i((x as i32 + dx) as u16, (y as i32 + dy) as u16);
            let lawn = [g("grass"), g("grass_dark"), g("flowers")].contains(&b.ground[i]);
            !lawn || b.solid[i] || (b.decor[i] != 0 && (dx, dy) != (0, 0))
        })
    })
}

/// The way on foot from any of `from` to the nearest tile `to` says,
/// within `max` steps: over lawn, paths and paving (through plants, which
/// make way), not through anything built, water, a road or its kerb, or a
/// fence or hedge. The tiles there, from a `from` to the one next to the
/// tile found.
fn trail(
    b: &Builder,
    from: &[(u16, u16)],
    to: &dyn Fn(&Builder, u16, u16) -> bool,
    max: u32,
) -> Option<Vec<(u16, u16)>> {
    let over = [
        g("grass"),
        g("grass_dark"),
        g("flowers"),
        g("moss"),
        g("path"),
        g("plaza"),
    ];
    let (w, h) = (b.w as i32, b.h as i32);
    let ok = |x: i32, y: i32| {
        x >= 0 && y >= 0 && x < w && y < h && {
            let i = b.i(x as u16, y as u16);
            !b.solid[i] && over.contains(&b.ground[i]) && soft(b.decor[i])
        }
    };
    let mut came = vec![u32::MAX; b.ground.len()];
    let mut steps = vec![0u32; b.ground.len()];
    let mut q = VecDeque::new();
    for &(x, y) in from {
        let i = b.i(x, y);
        came[i] = i as u32;
        q.push_back((x, y));
    }
    while let Some((x, y)) = q.pop_front() {
        let i = b.i(x, y);
        if steps[i] >= max {
            continue;
        }
        for (dx, dy) in [
            (1i32, 0i32),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx < 0 || ny < 0 || nx >= w || ny >= h {
                continue;
            }
            let j = b.i(nx as u16, ny as u16);
            if came[j] != u32::MAX
                || (dx != 0
                    && dy != 0
                    && !(ok(x as i32 + dx, y as i32) && ok(x as i32, y as i32 + dy)))
            {
                continue;
            }
            if to(b, nx as u16, ny as u16) {
                let mut route = vec![(x, y)];
                let mut c = i;
                while came[c] as usize != c {
                    c = came[c] as usize;
                    route.push(((c % b.w as usize) as u16, (c / b.w as usize) as u16));
                }
                route.reverse();
                return Some(route);
            }
            if !ok(nx, ny) {
                continue;
            }
            came[j] = i as u32;
            steps[j] = steps[i] + 1;
            q.push_back((nx as u16, ny as u16));
        }
    }
    None
}

/// Lays a footpath along `route`, smoothed into a gentle curve, two tiles
/// wide, on the lawn and moss (the plants there making way); marks it in
/// `laid`.
fn lay(b: &mut Builder, route: &[(u16, u16)], laid: &mut [bool]) {
    let at = |&(x, y): &(u16, u16)| (x as f32 + 0.5, y as f32 + 0.5);
    let mut pts: Vec<(f32, f32)> = route.iter().step_by(4).map(at).collect();
    let end = at(route.last().unwrap());
    if pts.last() != Some(&end) {
        pts.push(end);
    }
    if pts.len() < 2 {
        pts.push(end);
    }
    let floor = [g("grass"), g("grass_dark"), g("flowers"), g("moss")];
    let mut put = |b: &mut Builder, x: i32, y: i32| {
        if x < 0 || y < 0 || x >= b.w as i32 || y >= b.h as i32 {
            return;
        }
        let i = b.i(x as u16, y as u16);
        if !b.solid[i] && floor.contains(&b.ground[i]) && soft(b.decor[i]) {
            b.ground[i] = g("path");
            b.decor[i] = 0;
            laid[i] = true;
        }
    };
    for (px, py) in spline(&pts, 0.25) {
        for dy in -1i32..=1 {
            for dx in -1i32..=1 {
                let (x, y) = (px.floor() as i32 + dx, py.floor() as i32 + dy);
                if (x as f32 + 0.5 - px).hypot(y as f32 + 0.5 - py) <= 1.0 {
                    put(b, x, y);
                }
            }
        }
    }
    for &(x, y) in route {
        put(b, x as i32, y as i32);
    }
}

/// Between the rings in each diagonal, where the streets are gone and the
/// plots run together: a little green on the lawn (a ring of paving round
/// a lawn and a flower bed, with benches and lamps, and something in the
/// middle to gather round, each its own), paths from it in to the Inner
/// Ring and out to the Ring Road (and on, a trail into the woods to the
/// paths of the green block out there), paths from the buildings' fronts
/// to it, and trees, flowers and benches over the lawn. The old streets'
/// middle lines stay clear underfoot (long walks follow them).
fn greens(b: &mut Builder, plan: &Plan, fronts: &[(u16, u16)]) {
    let (ring, inner) = (plan.ring, plan.inner);
    let lawn = [g("grass"), g("grass_dark"), g("flowers")];
    let walls = [d("fence"), d("hedge"), d("wall")];
    let mut taken = vec![false; b.ground.len()];
    for o in &b.objects {
        for y in o.y.saturating_sub(1)..(o.y + o.h + 1).min(b.h) {
            for x in o.x.saturating_sub(1)..(o.x + o.w + 1).min(b.w) {
                taken[b.i(x, y)] = true;
            }
        }
    }
    let mut laid = vec![false; b.ground.len()];
    let greens = [
        (
            "Apple Green: a picnic under the old apple tree, by the Orchard",
            "apple_tree",
        ),
        (
            "Lantern Ring: logs to sit on round the lantern, by the Woods",
            "lantern",
        ),
        (
            "Swing Green: swings among the daisies, by the Meadow",
            "swing",
        ),
        (
            "Willow Green: a willow to sit under, and chess, by the Lake",
            "willow",
        ),
    ];
    let mid = (ring.r + inner.r) / 2.0 / std::f32::consts::SQRT_2;
    for (q, &(about, middle)) in greens.iter().enumerate() {
        let (sx, sy) = (
            if q % 2 == 1 { 1.0 } else { -1.0 },
            if q >= 2 { 1.0 } else { -1.0 },
        );
        let ideal = (ring.cx + sx * mid, ring.cy + sy * mid);
        // Where it goes: as near the middle of the lawn as it'll fit, all of
        // it on the lawn with nothing on it, its middle off the old
        // streets' lines.
        let fits = |b: &Builder, gx: u16, gy: u16| {
            (-3i32..=3).all(|t| {
                !plan.on_lane((gx as i32 + t) as u16, gy)
                    && !plan.on_lane(gx, (gy as i32 + t) as u16)
            }) && (-6i32..=6).all(|dy| {
                (-6i32..=6).all(|dx| {
                    let (x, y) = ((gx as i32 + dx) as u16, (gy as i32 + dy) as u16);
                    let i = b.i(x, y);
                    dx * dx + dy * dy > 36
                        || (plan.lens(x, y) == Some(q)
                            && lawn.contains(&b.ground[i])
                            && !b.solid[i]
                            && !taken[i]
                            && !walls.contains(&b.decor[i]))
                })
            })
        };
        let mut best: Option<(f32, u16, u16)> = None;
        for gy in ideal.1 as u16 - 18..=ideal.1 as u16 + 18 {
            for gx in ideal.0 as u16 - 18..=ideal.0 as u16 + 18 {
                let far = (gx as f32 + 0.5 - ideal.0).hypot(gy as f32 + 0.5 - ideal.1);
                if best.is_none_or(|b| far < b.0) && fits(b, gx, gy) {
                    best = Some((far, gx, gy));
                }
            }
        }
        let (_, gx, gy) = best.unwrap_or_else(|| panic!("no room for green {q} between the rings"));
        let at = |dx: i32, dy: i32| ((gx as i32 + dx) as u16, (gy as i32 + dy) as u16);
        let mut paving = vec![];
        for dy in -5i32..=5 {
            for dx in -5i32..=5 {
                let r = ((dx * dx + dy * dy) as f32).sqrt();
                if r > 5.2 {
                    continue;
                }
                let (x, y) = at(dx, dy);
                b.decor(x, y, "none");
                let ground = if r > 3.4 {
                    paving.push((x, y));
                    laid[b.i(x, y)] = true;
                    "plaza"
                } else if r > 2.4 {
                    "flowers"
                } else {
                    "grass"
                };
                b.ground(x, y, ground);
            }
        }
        // Lamps round it, benches north and south, its sign.
        for (dx, dy) in [(-4, -3), (4, -3), (-4, 3), (4, 3)] {
            let (x, y) = at(dx, dy);
            if !plan.on_lane(x, y) {
                b.decor(x, y, "lamp");
            }
        }
        for dy in [-5, 5] {
            let ((x0, y), (x1, _)) = (at(-1, dy), at(0, dy));
            if !plan.on_lane(x0, y) && !plan.on_lane(x1, y) {
                b.decor(x0, y, "bench");
                b.decor(x1, y, "bench");
            }
        }
        if let Some(&(x, y)) = [at(3, -4), at(-3, -4), at(3, 4), at(-3, 4)]
            .iter()
            .find(|&&(x, y)| !plan.on_lane(x, y))
        {
            b.object("signpost", x, y, 1, 1, Some(about), true);
        }
        // What's in the middle.
        match middle {
            "swing" => {
                for dx in [-1, 1] {
                    let (x, y) = at(dx, 0);
                    b.decor(x, y, "swing");
                }
                for (dx, dy) in [(0, -2), (0, 2), (-2, 1), (2, -1), (-1, -2), (1, 2)] {
                    let (x, y) = at(dx, dy);
                    b.decor(x, y, "daisies");
                }
            }
            "lantern" => {
                let (x, y) = at(0, 0);
                b.decor(x, y, "lantern");
                for (dx, dy) in [(-2, 0), (2, 0), (0, -2), (0, 2)] {
                    let (x, y) = at(dx, dy);
                    b.decor(x, y, "log_seat");
                }
                for (dx, dy) in [(-1, -1), (1, 1)] {
                    let (x, y) = at(dx, dy);
                    b.decor(x, y, "mushrooms");
                }
            }
            kind => {
                let (x, y) = at(0, 0);
                b.decor(x, y, kind);
                if kind == "apple_tree" {
                    for (dx, dy) in [(-2, 1), (-1, 1), (1, -2), (2, -2)] {
                        let (x, y) = at(dx, dy);
                        b.decor(x, y, "blanket");
                    }
                } else {
                    for (dx, dy) in [(-2, -1), (2, 1)] {
                        let (x, y) = at(dx, dy);
                        b.decor(x, y, "chess_table");
                    }
                }
            }
        }
        for &(x, y) in &paving {
            taken[b.i(x, y)] = true;
        }
        // In to the Inner Ring, and out to the Ring Road, and on into the
        // woods out there along a trail, to the green block's own paths.
        for (r, out) in [(inner, false), (ring, true)] {
            let Some(route) = trail(
                b,
                &paving,
                &|b, x, y| b.ground[b.i(x, y)] == g("curb") && r.near(x, y),
                70,
            ) else {
                continue;
            };
            lay(b, &route, &mut laid);
            if !out {
                continue;
            }
            let &(ex, ey) = route.last().unwrap();
            let (ux, uy) = (ex as f32 + 0.5 - ring.cx, ey as f32 + 0.5 - ring.cy);
            let len = ux.hypot(uy);
            let mut s = 1.0;
            let start = loop {
                let (x, y) = (
                    (ex as f32 + 0.5 + ux / len * s) as u16,
                    (ey as f32 + 0.5 + uy / len * s) as u16,
                );
                if ring.beyond(x, y) || s > 20.0 {
                    break (x, y);
                }
                s += 0.5;
            };
            let bush = trail(
                b,
                &[start],
                &|b, x, y| b.ground[b.i(x, y)] == g("path") && ring.beyond(x, y),
                45,
            );
            if let Some(route) = bush {
                lay(b, &route, &mut laid);
            }
        }
        // From each building's front between the rings here to the paths.
        for &(fx, fy) in fronts.iter().filter(|&&(x, y)| plan.quarter(x, y) == q) {
            let to = |b: &Builder, x: u16, y: u16| {
                let i = b.i(x, y);
                laid[i] || b.ground[i] == g("curb")
            };
            if let Some(route) = trail(b, &[(fx, fy)], &to, 90) {
                lay(b, &route, &mut laid);
            }
        }
    }
    // Over the lawn: trees (each diagonal its own mix), flowers in the
    // grass, a bench now and then beside a path, facing it.
    let trees = [
        ["apple_tree", "tree", "apple_tree", "bush"],
        ["pine", "tree", "pine", "bush"],
        ["tree", "willow", "bush", "tree"],
        ["willow", "tree", "bush", "apple_tree"],
    ];
    for y in plan.a..plan.z {
        for x in plan.a..plan.z {
            let Some(q) = plan.lens(x, y) else {
                continue;
            };
            let i = b.i(x, y);
            if !b.free(x, y) || taken[i] || plan.on_lane(x, y) {
                continue;
            }
            let h = hash(x, y, 4242);
            if h.is_multiple_of(13) && !near_built(b, x, y) {
                b.decor(x, y, trees[q][(h / 13) as usize % 4]);
            } else if h % 9 == 4 {
                b.decor(
                    x,
                    y,
                    ["wildflowers", "daisies", "clover"][(h / 9) as usize % 3],
                );
            }
        }
    }
    let seat =
        |b: &Builder, x: u16, y: u16| b.free(x, y) && !plan.on_lane(x, y) && !taken[b.i(x, y)];
    let mut benches: Vec<(u16, u16)> = vec![];
    for y in plan.a + 1..plan.z {
        for x in plan.a..plan.z - 1 {
            let i = b.i(x, y);
            if !laid[i]
                || !laid[b.i(x + 1, y)]
                || b.ground[i] != g("path")
                || plan.lens(x, y).is_none()
                || !hash(x, y, 4343).is_multiple_of(7)
                || benches
                    .iter()
                    .any(|&(u, v)| u.abs_diff(x) < 10 && v.abs_diff(y) < 10)
            {
                continue;
            }
            if seat(b, x, y - 1) && seat(b, x + 1, y - 1) {
                b.decor(x, y - 1, "bench");
                b.decor(x + 1, y - 1, "bench");
                benches.push((x, y));
            }
        }
    }
}

/// The woods beyond the Ring Road, out to the square's edge street (and
/// over where the streets out there were): thick in the blocks it cuts
/// across, thinner in the four green corner blocks (round what's already
/// there), the floor moss and fallen leaves.
fn wildwood(b: &mut Builder, plan: &Plan, geo: &commons_sim::city::Geometry) {
    let ring = plan.ring;
    let (a, z) = (plan.a, plan.z);
    let pitch = geo.block_tiles + geo.street_tiles;
    // In a block's interior (inside its pavement), and which block.
    let interior = |x: u16, y: u16| {
        let (lx, ly) = (
            (x - geo.street_tiles) % pitch,
            (y - geo.street_tiles) % pitch,
        );
        ((2..N - 2).contains(&lx) && (2..N - 2).contains(&ly)).then(|| {
            (
                (x - geo.street_tiles) / pitch,
                (y - geo.street_tiles) / pitch,
            )
        })
    };
    let corner =
        |bx: u16, by: u16| (bx == 1 || bx == geo.blocks - 2) && (by == 1 || by == geo.blocks - 2);
    // Anywhere something's been put (a nook, a spot, a building, a seat),
    // and a tile round it: the woods leave it be.
    let mut kept = vec![false; b.ground.len()];
    for o in &b.objects {
        for y in o.y.saturating_sub(1)..(o.y + o.h + 1).min(b.h) {
            for x in o.x.saturating_sub(1)..(o.x + o.w + 1).min(b.w) {
                kept[b.i(x, y)] = true;
            }
        }
    }
    for y in a..z {
        for x in a..z {
            if !ring.beyond(x, y) {
                continue;
            }
            let i = b.i(x, y);
            let block = interior(x, y);
            // (All the lawn out here the deep green of the woods.)
            if b.ground[i] == g("grass") {
                b.ground[i] = g("grass_dark");
            }
            if !b.free(x, y) || kept[i] {
                continue;
            }
            let h = hash(x, y, 909);
            // (The four green corner blocks are orchard and woods, meadow
            // and lake already, with their hidden ways through: they only
            // thicken, well clear of anything there.)
            let thick = !block.is_some_and(|(bx, by)| corner(bx, by));
            let trees = [
                d("tree"),
                d("pine"),
                d("bush"),
                d("willow"),
                d("apple_tree"),
                d("tallgrass"),
            ];
            if !thick
                && (-2i32..=2).any(|dy| {
                    (-2i32..=2).any(|dx| {
                        let j = b.i((x as i32 + dx) as u16, (y as i32 + dy) as u16);
                        let lawn = [g("grass"), g("grass_dark")].contains(&b.ground[j]);
                        !lawn || b.solid[j] || (b.decor[j] != 0 && !trees.contains(&b.decor[j]))
                    })
                })
            {
                continue;
            }
            // (Not hard against anything made: keep the paths and places open.)
            // (Nor in a maze's or a fenced lot's ways.)
            let walls = [d("hedge"), d("fence"), d("wall")];
            let near_made = [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)]
                .iter()
                .any(|&(dx, dy)| {
                    let j = b.i((x as i32 + dx) as u16, (y as i32 + dy) as u16);
                    let lawn = [g("grass"), g("grass_dark"), g("flowers")].contains(&b.ground[j]);
                    !lawn || b.solid[j] || walls.contains(&b.decor[j])
                });
            if near_made {
                continue;
            }
            if !thick {
                if h % 5 < 2 {
                    let kinds = ["tree", "pine", "tree", "bush", "willow"];
                    b.decor(x, y, kinds[(h / 7) as usize % kinds.len()]);
                }
                continue;
            }
            // Walkable woods: tall trees one or two to each three-by-three
            // patch (so there's always a way between them, and you pass
            // behind them), undergrowth you wade through, sunny glades
            // of wildflowers here and there, the odd log or rock.
            let glade = noise(x as f32, y as f32, 9.0, 78) > 0.7;
            let deep = noise(x as f32, y as f32, 6.0, 77) > 0.25;
            b.ground[i] = if glade {
                g("flowers")
            } else if deep {
                g("grass_dark")
            } else {
                g("grass")
            };
            let (cx, cy) = (x / 3, y / 3);
            let cell = hash(cx, cy, 911);
            let pick = |n: u32| ((cx * 3 + (n % 3) as u16), (cy * 3 + ((n / 3) % 3) as u16));
            let first = !cell.is_multiple_of(9) && pick(cell / 7) == (x, y);
            let second = cell % 5 < 3 && pick(cell / 97 + 4) == (x, y);
            if !glade && (first || second) {
                let kinds = [
                    "tree",
                    "pine",
                    "pine",
                    "tree",
                    "willow",
                    "pine",
                    "tree",
                    "apple_tree",
                ];
                b.decor(x, y, kinds[(h / 7) as usize % kinds.len()]);
            } else if h % 61 == 7 && !glade {
                b.decor(x, y, ["log", "stump", "rock"][(h / 61) as usize % 3]);
            } else if h.is_multiple_of(3) {
                let under = if glade {
                    [
                        "wildflowers",
                        "daisies",
                        "wildflowers",
                        "clover",
                        "daisies",
                        "wildflowers",
                    ]
                } else {
                    [
                        "fern",
                        "tallgrass",
                        "clover",
                        "fern",
                        "mushrooms",
                        "pebbles",
                    ]
                };
                b.decor(x, y, under[(h / 3) as usize % under.len()]);
            } else if h % 17 == 5 && !glade {
                b.decor(x, y, "mushrooms");
            }
        }
    }
    // The woods' floor: all the lawn out there moss and fallen leaves.
    for y in a..z {
        for x in a..z {
            let i = b.i(x, y);
            if ring.beyond(x, y) && [g("grass"), g("grass_dark")].contains(&b.ground[i]) {
                b.ground[i] = g("moss");
            }
        }
    }
}

/// Trees along a ring road's inside, every so far round, where there's
/// lawn for one (off the old streets' lines).
fn avenue(b: &mut Builder, plan: &Plan, ring: &Ring) {
    let r = ring.r - Ring::HALF - Ring::KERB - 2.0;
    let steps = (std::f32::consts::TAU * ring.r / 13.0) as usize;
    for s in 0..steps {
        let a = std::f32::consts::TAU * (s as f32 + 0.5) / steps as f32;
        let (x, y) = (
            (ring.cx + a.cos() * r).floor() as u16,
            (ring.cy + a.sin() * r).floor() as u16,
        );
        if b.free(x, y) && !near_built(b, x, y) && !plan.on_lane(x, y) {
            b.decor(x, y, "tree");
        }
    }
}

/// What a landmark's info signpost says.
fn about(key: &str, name: &str) -> String {
    match key {
        "town_hall" => "Town Hall: the town's votes and proposals".to_string(),
        "gallery" => {
            "Gallery: paint in the Studio, hang it in the Salon, and see everyone's work. Easels out here for painting together"
                .to_string()
        }
        "museum" => {
            "Museum: the town's natural history, given by its people, and the Hall of Fame".to_string()
        }
        "theater" => "Concert Hall: take the stage and everyone inside hears you".to_string(),
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
        "paintball" => {
            "Splat Yard: paintball inside, Blue against Red, three a side. First to ten!".to_string()
        }
        "club_hall" => {
            "Club Hall: found a club, rent its room, and meet up with your members".to_string()
        }
        _ => format!("{name}: opening soon"),
    }
}

/// Where a fitted building is (x, y, w, h), its door, and the tile in front
/// of its forecourt or gate (global).
type Fitted = ((u16, u16, u16, u16), (u16, u16), (u16, u16));

/// A block a ring road cuts across, its building (or a club's lot) placed
/// as near the block's middle as it'll go where `ok` says it's clear (all
/// of it, and its forecourt or fence, and a margin): with its door, a
/// forecourt or fence round it, its info signpost, benches and lamps, paths
/// out to the streets (only where `walk` says, a ring road's side of it;
/// none past the forecourt or the gate if there's no `walk`: they're
/// laid later). Returns where the building is, its door, and the tile in
/// front of its forecourt or gate (global).
fn fit_building(
    k: &mut Blk,
    ok: &dyn Fn(u16, u16) -> bool,
    walk: Option<&dyn Fn(u16, u16) -> bool>,
    id: BlockId,
    key: &str,
    name: &str,
) -> Fitted {
    k.lawn();
    // A path, on the tiles of it `walk` allows.
    let path = |k: &mut Blk, x0: u16, y0: u16, w: u16, h: u16| {
        let Some(walk) = walk else {
            return;
        };
        for y in y0..y0 + h {
            for x in x0..x0 + w {
                if walk(k.ox + x, k.oy + y) {
                    k.ground(x, y, "path");
                }
            }
        }
    };
    let lot = key == "club_lot";
    // The building: its kind, size, label, and its door's place (if it has one).
    let (kind, w, h, label, door_name): (&str, u16, u16, String, Option<&str>) = match key {
        "club_lot" => ("club_house", 20, 10, String::new(), None),
        "club_hall" => ("club_hall", 20, 10, "Club Hall".into(), Some("club_hall")),
        "casino" => ("casino", 20, 11, "Casino".into(), Some("casino")),
        "museum" => ("museum", 24, 11, "Museum & Gallery".into(), Some("museum")),
        "cafe" => ("bar", 16, 9, "The Mossy Mug".into(), Some("bar")),
        "bowling" => ("bowling_alley", 16, 9, "Bowling".into(), Some("bowling")),
        "town_hall" => ("town_hall", 10, 7, "Town Hall".into(), None),
        "cinema" => ("building", 18, 9, name.to_string(), None),
        _ => ("building", 24, 11, name.to_string(), None),
    };
    let m = if lot { 5 } else { 3 };
    let clear = |x0: u16, y0: u16| {
        if x0 < 2 + m || y0 < 2 + m || x0 + w + m > N - 2 || y0 + h + 2 + m > N - 2 {
            return false;
        }
        (y0 - m..y0 + h + 2 + m).all(|y| (x0 - m..x0 + w + m).all(|x| ok(k.ox + x, k.oy + y)))
    };
    let mut best: Option<(u32, u16, u16)> = None;
    for y0 in 2..N {
        for x0 in 2..N {
            if !clear(x0, y0) {
                continue;
            }
            let (cx, cy) = (x0 as i32 * 2 + w as i32, y0 as i32 * 2 + h as i32 + 6);
            let score = ((cx - 48).pow(2) + (cy - 48).pow(2)) as u32;
            if best.is_none_or(|b| score < b.0) {
                best = Some((score, x0, y0));
            }
        }
    }
    let (_, x0, y0) = best.unwrap_or_else(|| panic!("no room for the {key} inside its ring road"));
    let door = (x0 + w / 2, y0 + h);
    if lot {
        let lot = commons_sim::city::club_lot_key(id);
        k.object("club_house", x0, y0, w, h, &lot);
        k.spot(&format!("door:{lot}"), door.0, door.1);
        k.spot(&lot, door.0, door.1 + 1);
        // The fence round the lot, a gate south.
        let (fx0, fy0, fx1, fy1) = (x0 - 4, y0 - 4, x0 + w + 3, y0 + h + 4);
        for x in fx0..=fx1 {
            k.decor(x, fy0, "fence");
            if !(door.0 - 2..door.0 + 2).contains(&x) {
                k.decor(x, fy1, "fence");
            }
        }
        for y in fy0..=fy1 {
            k.decor(fx0, y, "fence");
            k.decor(fx1, y, "fence");
        }
        k.rect(door.0 - 2, door.1 + 1, 4, fy1 - door.1, "path");
        path(k, door.0 - 2, fy1 + 1, 4, N - 2 - fy1 - 1);
        k.object(
            "signpost",
            door.0 + 3,
            fy1 - 1,
            1,
            1,
            "Club lot: a club can rent this land for its clubhouse, at the Club Hall's desk",
        );
    } else {
        // A forecourt round the front, lamps at its corners, benches, the
        // info sign; the building and its door.
        k.rect(x0 - 2, y0 + h, w + 4, 4, "plaza");
        k.object(kind, x0, y0, w, h, &label);
        if let Some(place) = door_name {
            k.spot(&format!("door:{place}"), door.0, door.1);
            k.spot(place, door.0, door.1 + 1);
        }
        for (x, y) in [
            (x0 - 2, y0 + h),
            (x0 + w + 1, y0 + h),
            (x0 - 2, y0 + h + 3),
            (x0 + w + 1, y0 + h + 3),
        ] {
            k.decor(x, y, "lamp");
        }
        k.bench(x0, y0 + h + 3, 3);
        k.bench(x0 + w - 3, y0 + h + 3, 3);
        k.object("signpost", door.0 - 4, y0 + h + 1, 1, 1, &about(key, name));
        path(k, door.0 - 2, door.1 + 4, 4, N - 2 - door.1 - 4);
    }
    // A path across the block (the streets either side), a row below the
    // forecourt.
    let py = (door.1 + 6).min(N - 6);
    path(k, 2, py, N - 4, 2);
    k.scatter(3, 3, N - 3, N - 3, 9, &["tree", "bush"]);
    let front = (k.ox + door.0, k.oy + door.1 + if lot { 5 } else { 4 });
    ((x0, y0, w, h), door, front)
}

/// One of the eight blocks the Ring Road cuts across (between the middles
/// of the square's sides and its corners): its building inside the road,
/// and out in the woods it cuts off, a little clearing to find, with a
/// lantern and somewhere to sit (a nook), a trail to it from the road.
fn fitted_edge(
    k: &mut Blk,
    ring: &Ring,
    inner: &Ring,
    id: BlockId,
    key: &str,
    name: &str,
) -> (u16, u16) {
    let clear = Ring::HALF + Ring::KERB + 1.0;
    let (_, _, front) = fit_building(
        k,
        &|x, y| ring.inside(x, y, 1.0) && inner.d(x, y) > inner.r + clear,
        None,
        id,
        key,
        name,
    );
    // The clearing: along the line from the block's furthest corner in
    // toward the town's middle, a few tiles past the road.
    let corners = [(4u16, 4u16), (N - 5, 4), (4, N - 5), (N - 5, N - 5)];
    let (fx, fy) = *corners
        .iter()
        .max_by(|a, b| {
            ring.d(k.ox + a.0, k.oy + a.1)
                .total_cmp(&ring.d(k.ox + b.0, k.oy + b.1))
        })
        .unwrap();
    let d0 = ring.d(k.ox + fx, k.oy + fy);
    let reach = ring.r + Ring::HALF + Ring::KERB + 6.0;
    let fits = |v: f32| (4.0..N as f32 - 5.0).contains(&v);
    let (gx, gy) = (k.ox as f32 + fx as f32 + 0.5, k.oy as f32 + fy as f32 + 0.5);
    let (ux, uy) = ((ring.cx - gx) / d0, (ring.cy - gy) / d0);
    let t = d0 - reach;
    if d0 <= reach + 1.0 || !fits(fx as f32 + ux * t) || !fits(fy as f32 + uy * t) {
        return front;
    }
    let (mx, my) = ((fx as f32 + ux * t) as u16, (fy as f32 + uy * t) as u16);
    let mut inside = vec![];
    for dy in -2i32..=2 {
        for dx in -2i32..=2 {
            if dx * dx + dy * dy > 5 {
                continue;
            }
            let (x, y) = ((mx as i32 + dx) as u16, (my as i32 + dy) as u16);
            k.decor(x, y, "none");
            k.ground(x, y, "flowers");
            inside.push((k.ox + x, k.oy + y));
        }
    }
    // Somewhere to sit, a lantern, toadstools; and each its own little
    // something to find there.
    k.decor(mx - 1, my, "log_seat");
    k.decor(mx + 1, my, "log_seat");
    k.decor(mx, my - 2, "lantern");
    k.decor(mx - 2, my + 1, "mushrooms");
    let order = [
        (2u8, 1u8),
        (4, 1),
        (1, 2),
        (5, 2),
        (1, 4),
        (5, 4),
        (2, 5),
        (4, 5),
    ];
    let n = order.iter().position(|&p| p == (id.bx, id.by)).unwrap_or(0);
    let (place, extra) = [
        ("Fox Den", "stump"),
        ("Badger's Bank", "rock"),
        ("Hedgehog Hollow", "clover"),
        ("Robin's Glade", "daisies"),
        ("Toadstool Ring", "mushrooms"),
        ("Squirrel's Rest", "stump"),
        ("Bluebell Nook", "wildflowers"),
        ("Mossy Stump", "stump"),
    ][n % 8];
    k.decor(mx + 2, my + 1, extra);
    // The trail in to it from the road.
    let mut s = 2.5f32;
    loop {
        let (x, y) = (
            (mx as f32 + 0.5 + ux * s) as u16,
            (my as f32 + 0.5 + uy * s) as u16,
        );
        if !ring.beyond(k.ox + x, k.oy + y) || x < 2 || y < 2 || x >= N - 2 || y >= N - 2 {
            break;
        }
        k.decor(x, y, "none");
        k.ground(x, y, "path");
        s += 0.5;
    }
    nook(k.b, &inside, place);
    k.spot(&format!("woods_{}_{}", id.bx, id.by), mx, my);
    front
}

/// One of the four blocks the Inner Ring cuts across (the town centre's
/// corners): its building inside the ring, and the part of it beyond the
/// ring a garden: flower beds, shrubs and a few trees, benches looking
/// onto the ring. The Cinema's big screen plays out on its garden lawn;
/// the Town Hall's wishing well stands on its forecourt.
fn fitted_inner(k: &mut Blk, inner: &Ring, id: BlockId, key: &str, name: &str) {
    let ((x0, y0, w, h), door, _) = fit_building(
        k,
        &|x, y| inner.inside(x, y, 1.0),
        Some(&|x, y| inner.d(x, y) < inner.r),
        id,
        key,
        name,
    );
    if key == "town_hall" {
        // (On its own paving beside the forecourt.)
        k.clear(x0 + w + 2, y0 + h - 1, 3, 5, "plaza");
        k.object("well", x0 + w + 2, y0 + h, 2, 2, "Wishing Well");
        k.spot("well", x0 + w + 2, y0 + h + 2);
    }
    // The garden beyond the ring.
    let past = |k: &Blk, x: u16, y: u16| {
        inner.d(k.ox + x, k.oy + y) > inner.r + Ring::HALF + Ring::KERB + 1.0
    };
    if key == "cinema" {
        // The outdoor big screen on a lawn, blankets in front of it: the
        // most room there is out there for it.
        let (sw, sh) = (17u16, 8u16);
        let mut spot = None;
        'find: for yy in 2..N - 2 - sh {
            for xx in 2..N - 2 - sw {
                if (yy..yy + sh).all(|y| {
                    (xx..xx + sw).all(|x| past(k, x, y) && !k.b.solid[k.b.i(k.ox + x, k.oy + y)])
                }) {
                    spot = Some((xx, yy));
                    break 'find;
                }
            }
        }
        let (sx, sy) = spot.unwrap_or_else(|| panic!("no room for the big screen"));
        k.clear(sx, sy, sw, sh, "grass");
        k.object("big_screen", sx + 2, sy + 1, 13, 3, "Big Screen");
        for (x, y) in [(sx + 2, sy + 6), (sx + 8, sy + 6), (sx + 13, sy + 6)] {
            k.decor(x, y, "blanket");
            k.decor(x + 1, y, "blanket");
        }
        k.spot("screen", sx + 8, sy + 5);
    }
    for y in 3..N - 3 {
        for x in 3..N - 3 {
            if !past(k, x, y) || !k.free(x, y) {
                continue;
            }
            let (gx, gy) = ((k.ox + x) as f32, (k.oy + y) as f32);
            let bed = noise(gx, gy, 4.0, 41) > 0.62;
            let hh = k.hash(x, y, 43);
            if bed {
                k.ground(x, y, "flowers");
                if hh.is_multiple_of(3) {
                    k.decor(x, y, ["wildflowers", "daisies"][(hh / 3) as usize % 2]);
                }
            } else if hh.is_multiple_of(19) && !k.near_built(x, y) {
                k.decor(
                    x,
                    y,
                    ["tree", "willow", "apple_tree"][(hh / 19) as usize % 3],
                );
            } else if hh % 13 == 2 && !k.near_built(x, y) {
                k.decor(x, y, "bush");
            } else if hh % 9 == 4 {
                k.decor(x, y, "clover");
            }
        }
    }
    let _ = door;
}

/// Pavement around the block with street lamps along the kerb.
/// Bug and mushroom spots (ADR 0019): `bugs` on open grass, flowers or
/// sand, and `shrooms` on grass beside a tree or a log (anywhere grassy in
/// the Meadow), each a few tiles from the next. A bug spot by the water
/// is the water's edge's, whatever the block.
fn forage(k: &mut Blk, habitat: &str, bugs: usize, shrooms: usize) {
    let lawn = [g("grass"), g("grass_dark"), g("flowers"), g("moss")];
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
    // How far out on the roundabout: an octagon, its corners straight 45° runs
    // that step evenly, tile by tile (a circle snapped to tiles steps unevenly).
    let ring = |x: u16, y: u16| {
        let (a, b) = ((x as f32 - C).abs(), (y as f32 - C).abs());
        a.max(b).max((a + b) / 1.45)
    };
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
            let d = ring(x, y);
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
            // (The lawn in the middle is a true circle, inside the octagon.)
            let c = dist(x, y);
            let g = if c < 9.5 {
                grass
            } else if c < 10.5 || (13.5..14.5).contains(&d) {
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
    // The Leaderboard, up on the green between the north lamps.
    k.object("leaderboard", 23, 17, 2, 1, "Leaderboard");
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
            if ring(x, y) >= 14.5 {
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
    // (Clear of the Inner Ring, sweeping past the block's north side.)
    for (x0, y0, x1, y1) in [(27u16, 7u16, 45u16, 17u16), (27, 27, 45, 44)] {
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
    // The way in, straight from the east street to the pier.
    k.rect(42, 21, 4, 4, "path");
    reeds(k);
    // The pier reaches into the pond from the east path.
    k.clear(29, 22, 11, 2, "bridge");
    k.spot("pier", 31, 22);
    // The fisherman, at the foot of the pier on a bit of trodden ground
    // just south of it: he buys your catch. The bottles beside him.
    k.clear(38, 24, 4, 3, "path");
    k.marker("fisherman", 39, 25, 1, 1, Some("Fisherman"));
    k.spot("fisherman", 40, 26);
    // The anglers' leaderboard (fish caught), on the bank by the fisherman.
    k.object("leaderboard", 43, 21, 2, 1, "Anglers Leaderboard");
    k.object("bottles", 42, 25, 1, 1, "Messages in bottles");
    k.bench(5, 22, 3);
    // A bench up the east path, side on, looking out over the water.
    for y in 16..19 {
        k.decor(41, y, "bench_v");
    }
    k.scatter(3, 3, N - 3, N - 3, 13, &["tree", "bush", "willow"]);
}

/// The Lake: the Little Island across stepping stones from the pier, the
/// boat hire by the pier, and the campfire circle on the south-west shore.
fn lake(k: &mut Blk) {
    k.lawn();
    // (Drawn toward the south-east, clear of the Ring Road across the
    // block's north-west corner.)
    water(k, 28.0, 27.0, 16.0, 14.0);
    reeds(k);
    k.scatter(3, 3, N - 3, N - 3, 11, &["pine", "tree", "bush"]);
    // The Little Island: chat there stays there.
    let mut inside = vec![];
    for y in 19..29u16 {
        for x in 28..40u16 {
            let (dx, dy) = ((x as f32 + 0.5 - 33.5) / 4.0, (y as f32 + 0.5 - 23.5) / 2.8);
            let e = dx * dx + dy * dy;
            if e <= 1.0 {
                k.ground(x, y, if e < 0.55 { "grass" } else { "sand" });
                k.decor(x, y, "none");
                inside.push((k.ox + x, k.oy + y));
            }
        }
    }
    k.bench(31, 22, 2);
    k.decor(35, 23, "lamp");
    k.decor(33, 25, "willow");
    nook(k.b, &inside, "The Little Island");
    k.spot("island", 34, 24);
    // The pier from the south shore, and stepping stones on from its end to
    // the island.
    k.clear(27, 33, 2, 11, "bridge");
    k.rect(26, 44, 4, 2, "path");
    let mut y = 32;
    while k.ground_at(28, y) == g("water") && y > 24 {
        k.clear(28, y, 1, 1, "stones");
        y -= 1;
    }
    let mut x = 28;
    while k.ground_at(x, 24) != g("grass") && k.ground_at(x, 24) != g("sand") && x < 33 {
        k.clear(x, 24, 1, 1, "stones");
        x += 1;
    }
    // The boat hire: a hut on the bank by the pier, rowboats tied up on the
    // water beside it, where hired boats set out (and people are set down on
    // the pier when the hire's up), and the lake's bounds for the boats.
    k.clear(29, 42, 5, 4, "grass");
    k.object("boat_hire", 30, 43, 3, 2, "Boat hire");
    for x in 23..27 {
        k.decor(x, 37, "none");
        k.decor(x, 38, "none");
    }
    k.marker("boat_moored", 24, 38, 2, 1, None);
    k.spot("boat_launch", 26, 38);
    k.spot("boat_dock", 27, 38);
    k.marker("boat_lake", 12, 13, 33, 29, None);
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
    k.clear(fx + 3, fy, 15, 1, "path");
    k.spot("campfire", fx + 3, fy + 1);
}

/// The Orchard & Greenhouse, with the Community Garden's soil rows.
fn orchard(k: &mut Blk) {
    k.lawn();
    k.rect(22, 2, 4, N - 4, "path");
    // The apple trees (north-west), the Greenhouse (north-east), and the
    // Community Garden's rows (south-west); the Ring Road cuts across the
    // block's south-east corner.
    for y in 4..27u16 {
        for x in 4..20u16 {
            if x % 5 == 4 && y % 5 == 3 {
                k.decor(x, y, "apple_tree");
            }
        }
    }
    k.object("building", 31, 8, 13, 8, "Greenhouse");
    k.rect(31, 16, 13, 3, "plaza");
    k.rect(26, 17, 5, 2, "path");
    for y in 31..44u16 {
        for x in 4..20u16 {
            if y % 3 == 0 {
                k.ground(x, y, "soil");
            }
        }
    }
    k.rect(20, 33, 2, 2, "path");
    k.object("garden_sign", 20, 30, 1, 1, "Community Garden");
    k.spot("garden", 12, 30);
    k.bench(6, 29, 3);
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
    // Paths across (in off the Ring Road, south-west).
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
    // The Moss Grotto (north-west): a ring of pines; the middle one on its
    // west side lets you through.
    let mut inside = vec![];
    for y in 3..=11u16 {
        for x in 6..=12u16 {
            if (7..=11).contains(&x) && (4..=10).contains(&y) {
                k.ground(x, y, "grass_dark");
                k.decor(x, y, "none");
                inside.push((k.ox + x, k.oy + y));
            } else {
                k.decor(x, y, "pine");
            }
        }
    }
    k.decor(6, 7, "pine_secret");
    k.clear(4, 7, 2, 1, "grass_dark");
    k.path(&[(4.5, 7.5), (3.5, 12.0), (3.5, 20.0), (2.5, 24.0)], 0.6);
    k.decor(9, 5, "log_seat");
    k.decor(10, 5, "log_seat");
    k.decor(8, 5, "lamp");
    for (x, y) in [(8u16, 8u16), (10, 9), (8, 9), (11, 7)] {
        k.decor(x, y, "mushrooms");
    }
    nook(k.b, &inside, "The Moss Grotto");
    // A fairy ring in a little clearing where the paths cross, found by
    // walking into it.
    let (rx, ry) = (24u16, 28u16);
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

/// The gladiator arena: an amphitheatre in the desert, a rounded square of
/// stands round the sand, its grand arch facing south. Down from the
/// arch the red carpet, and Caesar on his dais beside it: talk to him to
/// fight. An oasis off to the south-west, cacti and palms about.
fn arena(k: &mut Blk) {
    // The whole block's desert: sand everywhere.
    for y in 2..N - 2 {
        for x in 2..N - 2 {
            k.ground(x, y, "sand");
        }
    }
    // The amphitheatre, 38×28 tiles: an oval bowl (a little squared: a
    // superellipse) of stands round the sand, painted client side
    // (world/amphitheatre.ts); here, what each tile is, by its middle, as
    // the art has it. Out from the sand, ring by ring: the podium wall; a
    // row of seats (the emperor's box in it, north); a walkway all the way
    // round; a second row of seats; the outer wall. The sand's closed to
    // anyone not fighting. Into the stands: the grand arch in the middle of
    // the south wall, and a little arch through each side. The south seats
    // (red cushions) are for watching from; the rest are the crowd's.
    let (fx, fy, fw, fh) = (5u16, 4u16, 38u16, 28u16);
    const RIM: u16 = 5;
    k.marker("arena_bowl", fx, fy, fw, fh, Some("The Arena"));
    let gate = fx + fw / 2 - 1;
    let (cx, cy) = (fw as f64 / 2.0, fh as f64 / 2.0);
    let (a, b) = ((fw / 2 - RIM) as f64, (fh / 2 - RIM) as f64);
    // How far out from the sand's edge a point is (tiles; below 0, on the sand).
    let ring_u = |dx: f64, dy: f64| -> f64 {
        let n = commons_sim::arena::ROUNDNESS;
        let f = |u: f64| (dx.abs() / (a + u)).powf(n) + (dy.abs() / (b + u)).powf(n);
        if f(0.0) <= 1.0 {
            return -1.0;
        }
        let (mut lo, mut hi) = (0.0, 20.0);
        for _ in 0..30 {
            let mid = (lo + hi) / 2.0;
            if f(mid) > 1.0 {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        lo
    };
    let solid = |k: &mut Blk, x: u16, y: u16| {
        let i = k.b.i(k.ox + x, k.oy + y);
        k.b.solid[i] = true;
    };
    // Each tile's ring, by its middle; then wherever the walkway only
    // meets itself corner to corner (round the curves), the tile between
    // that's nearest the walkway joins it, so it runs unbroken right round
    // (nobody steps across corners).
    let (w, h) = (fw as usize, fh as usize);
    let mut ring = vec![0i32; w * h];
    let mut out_u = vec![0f64; w * h];
    for j in 0..h {
        for i in 0..w {
            let u = ring_u(i as f64 + 0.5 - cx, j as f64 + 0.5 - cy);
            out_u[j * w + i] = u;
            ring[j * w + i] = if u < 0.0 { -1 } else { u.floor() as i32 };
        }
    }
    for j in 0..h - 1 {
        for i in 0..w {
            for di in [-1i32, 1] {
                let i2 = i as i32 + di;
                if i2 < 0 || i2 >= w as i32 {
                    continue;
                }
                let i2 = i2 as usize;
                let (p, q) = (j * w + i, (j + 1) * w + i2);
                let (side_a, side_b) = (j * w + i2, (j + 1) * w + i);
                if ring[p] == 2 && ring[q] == 2 && ring[side_a] != 2 && ring[side_b] != 2 {
                    let near = |k: usize| (out_u[k] - 2.5).abs();
                    let pick = if near(side_a) <= near(side_b) {
                        side_a
                    } else {
                        side_b
                    };
                    ring[pick] = 2;
                }
            }
        }
    }
    for y in fy..fy + fh {
        for x in fx..fx + fw {
            let dx = (x - fx) as f64 + 0.5 - cx;
            let dy = (y - fy) as f64 + 0.5 - cy;
            let r = ring[(y - fy) as usize * w + (x - fx) as usize];
            // The way in from the south (to the portcullis), the side arches (to the walkway).
            let way = dy > 0.0 && dx.abs() < 1.0;
            let side = dy.abs() < 1.0 && (3..=4).contains(&r);
            let public = dy > b * 0.45;
            match r {
                -1 => {
                    // The sand: only for those fighting.
                    k.ground(x, y, "sand");
                    solid(k, x, y);
                }
                0 if way => {
                    // The gate onto the sand (its portcullis drawn live).
                    k.ground(x, y, "plaza");
                    solid(k, x, y);
                }
                1..=4 if way || side => k.ground(x, y, "plaza"),
                // The podium wall, the emperor's box, the outer wall: solid.
                0 | 4 => solid(k, x, y),
                1 if dy < 0.0 && dx.abs() < 2.5 => solid(k, x, y),
                1 => k.decor(x, y, if public { "amph_seat_pub" } else { "amph_seat" }),
                3 => k.decor(
                    x,
                    y,
                    if public {
                        "amph_seat_pub_hi"
                    } else {
                        "amph_seat_hi"
                    },
                ),
                2 => k.ground(x, y, "plaza"),
                _ => {}
            }
        }
    }
    // The ring itself (invisible: it marks where the fight is), its podium
    // wall round the sand's rectangle; the sand inside, 28×18, rounded.
    let (ax, ay, aw, ah) = (
        fx + RIM - 1,
        fy + RIM - 1,
        fw - 2 * (RIM - 1),
        fh - 2 * (RIM - 1),
    );
    k.marker("arena", ax, ay, aw, ah, Some("Arena"));
    // The gladiators' gates, in the podium wall either side, halfway down,
    // facing the middle: great iron doors, opened each round for the
    // fighters to march out of to their places.
    let gy = fy + fh / 2 - 1;
    k.marker(
        "arena_gate_w",
        ax - 1,
        gy - 1,
        2,
        3,
        Some("The gladiators' gate"),
    );
    k.marker(
        "arena_gate_e",
        ax + aw - 1,
        gy - 1,
        2,
        3,
        Some("The gladiators' gate"),
    );
    // (The gatehouses stand on the front-row seats there: solid stone now.)
    for (x, y) in [
        (ax - 1, gy - 1),
        (ax - 1, gy),
        (ax - 1, gy + 1),
        (ax + aw, gy - 1),
        (ax + aw, gy),
        (ax + aw, gy + 1),
    ] {
        k.decor(x, y, "none");
        solid(k, x, y);
    }
    // Two stone pillars on the sand (above and below its middle), to dodge
    // round (or be slammed into),
    // and four spike plates that rise in turn (see commons_sim::arena): all
    // mirrored, side to side and top to bottom.
    let (sx, sy) = (ax + 1, ay + 1);
    // (A tile thick each, in a place two wide so they stand square on the
    // middle line: above and below the middle.)
    for (px, py) in [(13u16, 5u16), (13, 12)] {
        k.object("arena_pillar", sx + px, sy + py, 2, 1, "Pillar");
    }
    for (px, py) in [(13u16, 1u16), (13, 15), (2, 8), (24, 8)] {
        k.marker("arena_spikes", sx + px, sy + py, 2, 2, None);
    }
    // The grand arch in the south wall (its piers solid, the way under it
    // open); down from it the red carpet, and on a dais beside the carpet
    // Caesar with two legionaries: talk to Caesar to fight. Bystanders are
    // shown out to the carpet's side.
    let wall_row = fy + fh - 1;
    for x in gate - 3..=gate + 4 {
        k.decor(x, wall_row, "none");
    }
    k.marker("arena_gate", gate - 3, wall_row, 8, 2, Some("The Arena"));
    for px in [gate - 3, gate - 2, gate + 3, gate + 4] {
        for py in [wall_row, wall_row + 1] {
            solid(k, px, py);
        }
    }
    let below = fy + fh;
    k.rect(gate, below, 2, N - 2 - below, "plaza");
    k.marker("arena_carpet", gate - 1, below + 1, 4, 7, None);
    k.spot("arena", gate - 2, below + 2);
    k.object("arena_court", gate + 5, below + 1, 5, 2, "Caesar");
    k.spot("caesar", gate + 7, below + 3);
    // The arena's leaderboard (gladiator wins), just right of Caesar.
    k.object(
        "leaderboard",
        gate + 11,
        below + 2,
        2,
        1,
        "Arena Leaderboard",
    );
    k.object(
        "signpost",
        gate - 4,
        below + 2,
        1,
        1,
        "The Arena: talk to Caesar (on his dais by the red carpet) to fight: a duel, a three-way or a four-gladiator brawl, bots if you like. To watch, go in under the arches and sit on a red-cushioned seat",
    );
    for (x, y) in [
        (gate - 2, below + 4),
        (gate + 3, below + 4),
        (gate - 2, below + 7),
        (gate + 3, below + 7),
    ] {
        k.decor(x, y, "lantern");
    }
    // An oasis in the south-west corner: a pool, palms round it, reeds.
    for y in below + 2..N - 2 {
        for x in 2..13u16 {
            let (dx, dy) = ((x as f32 - 7.5) / 3.4, (y as f32 - 39.5) / 2.8);
            let d = dx * dx + dy * dy;
            if d < 1.0 {
                k.ground(x, y, "water");
            } else if d < 1.6 {
                k.ground(x, y, "grass");
            }
        }
    }
    for (x, y) in [(3u16, 37u16), (11, 36), (12, 41), (4, 43), (10, 44)] {
        k.decor(x, y, "palm");
    }
    for (x, y) in [(4u16, 40u16), (11, 39)] {
        k.decor(x, y, "reeds");
    }
    // The desert's bits and pieces, on open sand, clear of the ways through
    // and the bowl.
    let open = |k: &Blk, x: u16, y: u16| -> bool {
        let i = k.b.i(k.ox + x, k.oy + y);
        k.b.decor[i] == 0 && !k.b.solid[i] && [g("sand"), g("soil")].contains(&k.b.ground[i])
    };
    for y in 3..N - 3 {
        for x in 3..N - 3 {
            if !open(k, x, y) {
                continue;
            }
            // Nothing against the bowl, on the way in, by the side arches or by Caesar.
            if x + 1 >= fx && x <= fx + fw && y + 1 >= fy && y <= fy + fh {
                continue;
            }
            if (gate.saturating_sub(3)..=gate + 10).contains(&x) && y < below + 9 {
                continue;
            }
            let h = k.hash(x, y, 41) % 1000;
            let kind = match h {
                0..=22 => "cactus",
                23..=50 => "cactus_small",
                51..=95 => "dry_shrub",
                96..=105 => "bones",
                106..=116 => "rock",
                117..=126 => "palm",
                127..=133 => "amphora",
                _ => continue,
            };
            k.decor(x, y, kind);
        }
    }
    // A palm or two along the way in, for shade.
    for (x, y) in [
        (gate - 4, below + 6),
        (gate + 5, below + 7),
        (gate - 3, N - 4),
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
    // The Splat Yard's leaderboard (paintball wins), by its door.
    k.object("leaderboard", 31, 18, 2, 1, "Paintball Leaderboard");
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
    let sign = about(key, name);
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
