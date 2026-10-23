//! Generates the zone maps: `city.json`, the city of blocks (see `city.rs`,
//! ADR 0010), `mall.json`, the Commons Mall (`mall.rs`, ADR 0011),
//! `home.json`, the cottage interior, and the Library's hall and wings
//! (`library.rs`, ADR 0012).
//!
//! Deterministic: rerunning produces the same file. Hand-authored maps will
//! replace this once `tools/mapedit` exists.

mod city;
mod clubs;
mod concert;
mod leisure;
mod library;
mod mall;

use commons_sim::map::{MapFile, MapObject, Spawn, StreetGrid};
use std::path::PathBuf;

const GROUND: &[&str] = &[
    "grass",
    "grass_dark",
    "path",
    "plaza",
    "water",
    "sand",
    "soil",
    "flowers",
    "bridge",
    "fog",
    "floor",
    "pitch",
    "stones",
    "road",
    "curb",
    "carpet",
    "straw",
    "track",
    // The arcade's dark carpet, with neon squiggles.
    "arcade_carpet",
    // The bar's worn plank floor: grain, knots, staggered joints.
    "tavern_floor",
    // The library: warm parquet in the wings, marble in the hall, and rugs.
    "parquet",
    "marble",
    "rug",
];
const DECOR: &[&str] = &[
    "none",
    "tree",
    "pine",
    "bush",
    "bench",
    "lamp",
    "chess_table",
    "rock",
    "reeds",
    "fence",
    "sign",
    "wall",
    "hedge",
    "swing",
    "stump",
    "log",
    "mushrooms",
    "tallgrass",
    "lilypad",
    "apple_tree",
    "blanket",
    "willow",
    "willow_curtain",
    "pine_secret",
    "log_seat",
    "lantern",
    "cafe_table",
    // The bar: stools to sit on, little round tables, barrels, log walls.
    "stool",
    "bar_table",
    "barrel",
    "wood_wall",
    // The arcade's walls, striped with neon.
    "neon_wall",
    // The library: panelled walls with tall windows, chairs (seats), long
    // reading tables with green lamps, study carrels, a globe, plants, and
    // the Children's Library's story cushions (seats).
    "library_wall",
    "chair",
    "reading_table",
    "carrel",
    "globe",
    "potted_plant",
    "cushion",
    // A library chair seen from behind (sitting facing north, at a table).
    "chair_n",
    // The gladiator arena's sandstone walls.
    "arena_wall",
];

fn g(name: &str) -> u8 {
    GROUND.iter().position(|n| *n == name).unwrap() as u8
}
fn d(name: &str) -> u8 {
    DECOR.iter().position(|n| *n == name).unwrap() as u8
}

/// Small integer hash for deterministic scatter.
fn hash(x: u16, y: u16, salt: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x9E37_79B1)
        ^ (y as u32).wrapping_mul(0x85EB_CA77)
        ^ salt.wrapping_mul(0xC2B2_AE3D);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h
}

struct Builder {
    w: u16,
    h: u16,
    ground: Vec<u8>,
    decor: Vec<u8>,
    solid: Vec<bool>,
    objects: Vec<MapObject>,
    streets: Option<StreetGrid>,
}

impl Builder {
    fn i(&self, x: u16, y: u16) -> usize {
        y as usize * self.w as usize + x as usize
    }
    fn ground(&mut self, x: u16, y: u16, t: &str) {
        if x < self.w && y < self.h {
            let i = self.i(x, y);
            self.ground[i] = g(t);
        }
    }
    fn decor(&mut self, x: u16, y: u16, t: &str) {
        if x < self.w && y < self.h {
            let i = self.i(x, y);
            self.decor[i] = d(t);
        }
    }
    fn rect(&mut self, x0: u16, y0: u16, w: u16, h: u16, t: &str) {
        for y in y0..y0 + h {
            for x in x0..x0 + w {
                self.ground(x, y, t);
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn object(
        &mut self,
        kind: &str,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
        label: Option<&str>,
        solid: bool,
    ) {
        if solid {
            for yy in y..y + h {
                for xx in x..x + w {
                    let i = self.i(xx, yy);
                    self.solid[i] = true;
                }
            }
        }
        self.objects.push(MapObject {
            kind: kind.into(),
            x,
            y,
            w,
            h,
            label: label.map(Into::into),
        });
    }
    /// True if nothing has been placed on this tile yet.
    fn free(&self, x: u16, y: u16) -> bool {
        let i = self.i(x, y);
        self.decor[i] == 0
            && !self.solid[i]
            && [g("grass"), g("grass_dark")].contains(&self.ground[i])
    }
}

impl Builder {
    fn new(w: u16, h: u16) -> Self {
        let n = w as usize * h as usize;
        Builder {
            w,
            h,
            ground: vec![0; n],
            decor: vec![0; n],
            solid: vec![false; n],
            objects: vec![],
            streets: None,
        }
    }

    /// Derives collision (water, fog, solid decor and objects) and packs the map.
    fn finish(self, name: &str, spawn: (u16, u16)) -> MapFile {
        let walk_decor = [
            d("none"),
            d("reeds"),
            d("tallgrass"),
            d("mushrooms"),
            d("blanket"),
            // Secret passages look like the trees around them.
            d("willow_curtain"),
            d("pine_secret"),
        ];
        let blocked_ground = [g("water"), g("fog")];
        let collision: Vec<u8> = (0..self.ground.len())
            .map(|i| {
                let blocked = self.solid[i]
                    || blocked_ground.contains(&self.ground[i])
                    || !walk_decor.contains(&self.decor[i]);
                blocked as u8
            })
            .collect();
        MapFile {
            name: name.into(),
            width: self.w,
            height: self.h,
            spawn: Spawn {
                x: spawn.0,
                y: spawn.1,
            },
            ground_legend: GROUND.iter().map(|s| s.to_string()).collect(),
            decor_legend: DECOR.iter().map(|s| s.to_string()).collect(),
            ground: self.ground,
            decor: self.decor,
            collision,
            objects: self.objects,
            streets: self.streets,
        }
    }
}

/// A nook (a secret place where chat stays private) over `tiles`.
fn nook(b: &mut Builder, tiles: &[(u16, u16)], name: &str) {
    let x0 = tiles.iter().map(|t| t.0).min().unwrap();
    let x1 = tiles.iter().map(|t| t.0).max().unwrap();
    let y0 = tiles.iter().map(|t| t.1).min().unwrap();
    let y1 = tiles.iter().map(|t| t.1).max().unwrap();
    b.object("nook", x0, y0, x1 - x0 + 1, y1 - y0 + 1, Some(name), false);
}

/// A hedge maze of `cw`×`ch` cells at (x0, y0), carved by a seeded
/// depth-first search; entrance in the middle of the bottom edge. Returns its
/// size in tiles.
fn maze(b: &mut Builder, x0: u16, y0: u16, cw: u16, ch: u16, seed: u32) -> (u16, u16) {
    let (tw, th) = (cw * 2 + 1, ch * 2 + 1);
    for y in 0..th {
        for x in 0..tw {
            b.ground(x0 + x, y0 + y, "grass");
            b.decor(x0 + x, y0 + y, "hedge");
        }
    }
    let mut seen = vec![false; (cw * ch) as usize];
    let mut stack = vec![(0u16, 0u16)];
    seen[0] = true;
    let mut rng = seed;
    let open = |b: &mut Builder, x: u16, y: u16| b.decor(x0 + x, y0 + y, "none");
    open(b, 1, 1);
    while let Some(&(x, y)) = stack.last() {
        let mut next = vec![];
        for (dx, dy) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx >= 0
                && ny >= 0
                && nx < cw as i32
                && ny < ch as i32
                && !seen[(ny as u16 * cw + nx as u16) as usize]
            {
                next.push((nx as u16, ny as u16));
            }
        }
        if next.is_empty() {
            stack.pop();
            continue;
        }
        rng = rng.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        let (nx, ny) = next[(rng >> 16) as usize % next.len()];
        seen[(ny * cw + nx) as usize] = true;
        open(b, x + nx + 1, y + ny + 1); // the wall between
        open(b, nx * 2 + 1, ny * 2 + 1);
        stack.push((nx, ny));
    }
    // Entrance at the bottom middle, and a clear square at the heart.
    let mid = cw / 2 * 2 + 1;
    open(b, mid, th - 1);
    let (hx, hy) = (tw / 2, th / 2);
    for (dx, dy) in [
        (-1i32, -1i32),
        (0, -1),
        (1, -1),
        (-1, 0),
        (1, 0),
        (-1, 1),
        (0, 1),
        (1, 1),
        (0, 0),
    ] {
        open(b, (hx as i32 + dx) as u16, (hy as i32 + dy) as u16);
    }
    (tw, th)
}

/// Smooth value noise in [0, 1): bilinear between hashed lattice points
/// `scale` tiles apart.
fn noise(x: f32, y: f32, scale: f32, salt: u32) -> f32 {
    let (fx, fy) = (x / scale, y / scale);
    let (ix, iy) = (fx.floor(), fy.floor());
    let (tx, ty) = (fx - ix, fy - iy);
    let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
    let v =
        |dx: f32, dy: f32| (hash((ix + dx) as u16, (iy + dy) as u16, salt) % 1000) as f32 / 1000.0;
    let top = v(0.0, 0.0) + (v(1.0, 0.0) - v(0.0, 0.0)) * sx;
    let bottom = v(0.0, 1.0) + (v(1.0, 1.0) - v(0.0, 1.0)) * sx;
    top + (bottom - top) * sy
}

/// Catmull-Rom spline through `pts`, sampled every `step` tiles (roughly).
fn spline(pts: &[(f32, f32)], step: f32) -> Vec<(f32, f32)> {
    let mut out = vec![];
    for i in 0..pts.len() - 1 {
        let p0 = pts[i.saturating_sub(1)];
        let (p1, p2) = (pts[i], pts[i + 1]);
        let p3 = pts[(i + 2).min(pts.len() - 1)];
        let len = ((p2.0 - p1.0).powi(2) + (p2.1 - p1.1).powi(2)).sqrt();
        let n = (len / step).ceil().max(1.0) as usize;
        for k in 0..n {
            let t = k as f32 / n as f32;
            let (t2, t3) = (t * t, t * t * t);
            let f = |a: f32, b: f32, c: f32, d: f32| {
                0.5 * (2.0 * b
                    + (-a + c) * t
                    + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2
                    + (-a + 3.0 * b - 3.0 * c + d) * t3)
            };
            out.push((f(p0.0, p1.0, p2.0, p3.0), f(p0.1, p1.1, p2.1, p3.1)));
        }
    }
    out.push(*pts.last().unwrap());
    out
}

#[derive(Clone, Copy, PartialEq)]
enum Brush {
    Path,
    Water,
}

impl Builder {
    /// Paints a smooth band of `radius` tiles along a spline through `pts`.
    /// Paths become bridges over water and leave built ground alone; water
    /// only replaces grass and flowers.
    fn stroke(&mut self, pts: &[(f32, f32)], radius: f32, brush: Brush) {
        let keep = [
            g("plaza"),
            g("pitch"),
            g("soil"),
            g("floor"),
            g("bridge"),
            g("fog"),
        ];
        for (px, py) in spline(pts, 0.25) {
            let r = radius.ceil() as i32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let (x, y) = (px.floor() as i32 + dx, py.floor() as i32 + dy);
                    if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 {
                        continue;
                    }
                    let (cx, cy) = (x as f32 + 0.5 - px, y as f32 + 0.5 - py);
                    if cx * cx + cy * cy > radius * radius {
                        continue;
                    }
                    let (x, y) = (x as u16, y as u16);
                    let i = self.i(x, y);
                    let cur = self.ground[i];
                    match brush {
                        Brush::Water => {
                            if [g("grass"), g("grass_dark"), g("flowers"), g("sand")].contains(&cur)
                            {
                                self.ground(x, y, "water");
                            }
                        }
                        Brush::Path => {
                            if cur == g("water") {
                                self.ground(x, y, "bridge");
                            } else if !keep.contains(&cur) {
                                self.ground(x, y, "path");
                            }
                            if [
                                d("tree"),
                                d("pine"),
                                d("bush"),
                                d("rock"),
                                d("reeds"),
                                d("tallgrass"),
                            ]
                            .contains(&self.decor[i])
                            {
                                self.decor(x, y, "none");
                            }
                        }
                    }
                }
            }
        }
    }
}

/// A player's home (spec §8.2): a cottage to furnish, a small garden and a
/// gate back to the park.
fn home() -> MapFile {
    let (w, h) = (20u16, 15u16);
    let mut b = Builder::new(w, h);
    for y in 0..h {
        for x in 0..w {
            if hash(x / 2, y / 2, 9).is_multiple_of(4) {
                b.ground(x, y, "grass_dark");
            }
        }
    }
    // Cottage: wooden floor inside walls, door at the bottom middle.
    b.rect(3, 2, 14, 7, "floor");
    for x in 2..18 {
        b.decor(x, 1, "wall");
        if !(9..=10).contains(&x) {
            b.decor(x, 9, "wall");
        }
    }
    for y in 1..10 {
        b.decor(2, y, "wall");
        b.decor(17, y, "wall");
    }
    b.rect(9, 9, 2, 6, "path");
    // Garden plots west of the path.
    b.rect(3, 11, 5, 2, "soil");
    // Fence around the yard, with the gate in the middle of the bottom edge.
    for x in 0..w {
        if !(9..=10).contains(&x) {
            b.decor(x, h - 1, "fence");
        }
    }
    for y in 10..h {
        b.decor(0, y, "fence");
        b.decor(w - 1, y, "fence");
    }
    b.decor(14, 11, "tree");
    b.decor(16, 12, "bush");
    b.decor(1, 0, "pine");
    b.decor(18, 0, "pine");
    b.object("city_gate", 9, h - 1, 2, 1, Some("To the city"), true);
    // A wardrobe against the back wall: change clothes at home.
    b.object("wardrobe", 15, 2, 2, 1, Some("Wardrobe"), true);
    b.finish("Home", (10, 11))
}

fn write(name: &str, map: &MapFile) -> std::io::Result<()> {
    let json = serde_json::to_string(map).unwrap();
    // Validate before writing.
    MapFile::from_json(&json).expect("generated map is invalid");
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../../assets/maps/{name}.json"));
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, json)?;
    println!("wrote {}", path.display());
    Ok(())
}

fn main() -> std::io::Result<()> {
    write("city", &city::city())?;
    write("mall", &mall::mall())?;
    write("bar", &leisure::bar())?;
    write("arcade", &leisure::arcade())?;
    write("bowling", &leisure::bowling())?;
    write("library", &library::hall())?;
    write("club_hall", &clubs::lobby())?;
    write("clubroom", &clubs::room())?;
    write("concert_hall", &concert::hall())?;
    for wing in commons_sim::library::WINGS {
        write(&wing.zone(), &library::wing(&wing))?;
    }
    write("home", &home())
}
