//! Generates `assets/maps/founders_park.json`, the ≈96×96 founding map (spec §11):
//! central plaza with fountain, pond, chess tables, benches, garden plots,
//! big screen, town hall, homes gate, one fogged bridge to the east, a
//! notice board and four topic corners (sports, art, music, games).
//!
//! Deterministic: rerunning produces the same file. Hand-authored maps will
//! replace this once `tools/mapedit` exists.

use commons_sim::map::{MapFile, MapObject, Spawn};
use std::path::PathBuf;

const W: u16 = 96;
const H: u16 = 96;

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
        }
    }

    /// Derives collision (water, fog, solid decor and objects) and packs the map.
    fn finish(self, name: &str, spawn: (u16, u16)) -> MapFile {
        let walk_decor = [d("none"), d("reeds")];
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
        }
    }
}

fn park() -> MapFile {
    let n = W as usize * H as usize;
    let mut b = Builder {
        w: W,
        h: H,
        ground: vec![0; n],
        decor: vec![0; n],
        solid: vec![false; n],
        objects: vec![],
    };

    // Grass variation.
    for y in 0..H {
        for x in 0..W {
            if hash(x / 3, y / 3, 1).is_multiple_of(5) {
                b.ground(x, y, "grass_dark");
            }
        }
    }

    // River along the east edge, fog beyond it.
    b.rect(84, 0, 4, H, "water");
    b.rect(88, 0, W - 88, H, "fog");

    // Main paths: cross through the plaza, plus a loop.
    b.rect(2, 47, 82, 3, "path");
    b.rect(47, 11, 3, 81, "path"); // from the big screen's lawn to the south edge
    for (x0, y0, w, h) in [
        (14, 20, 2, 60),
        (14, 20, 66, 2),
        (14, 78, 66, 2),
        (78, 20, 2, 60),
    ] {
        b.rect(x0, y0, w, h, "path");
    }

    // Central plaza: stone circle with a fountain and flowerbeds.
    let (cx, cy) = (48i32, 48i32);
    for y in 0..H {
        for x in 0..W {
            let (dx, dy) = (x as i32 - cx, y as i32 - cy);
            let r2 = dx * dx + dy * dy;
            if r2 <= 64 {
                b.ground(x, y, "plaza");
            } else if r2 <= 81 && (dx.abs() > 2 && dy.abs() > 2) {
                b.ground(x, y, "flowers");
            }
        }
    }
    b.object("fountain", 47, 47, 3, 3, None, true);

    // Pond (south-west) with sand rim and reeds.
    for y in 0..H {
        for x in 0..W {
            let (dx, dy) = ((x as f32 - 28.0) / 9.0, (y as f32 - 64.0) / 6.0);
            let e = dx * dx + dy * dy;
            if e <= 1.0 {
                b.ground(x, y, "water");
            } else if e <= 1.45 {
                b.ground(x, y, "sand");
                if hash(x, y, 7).is_multiple_of(9) {
                    b.decor(x, y, "reeds");
                }
            }
        }
    }

    // Garden plots (north-west): rows of soil with fences around.
    for row in 0..3u16 {
        b.rect(20, 26 + row * 4, 16, 2, "soil");
    }
    for x in 19..37 {
        b.decor(x, 24, "fence");
        b.decor(x, 37, "fence");
    }
    b.decor(27, 24, "none"); // gate gap
    b.decor(28, 24, "none");
    b.object("garden_sign", 26, 23, 1, 1, Some("Community Garden"), true);

    // Chess tables (north-east of plaza) with benches either side.
    for (tx, ty) in [(58u16, 38u16), (62, 38), (58, 42), (62, 42)] {
        b.rect(tx - 1, ty - 1, 3, 3, "plaza");
        b.decor(tx, ty, "chess_table");
        b.decor(tx - 1, ty, "bench");
        b.decor(tx + 1, ty, "bench");
    }

    // Big screen to the north with a lawn in front of it.
    b.object("big_screen", 42, 8, 13, 3, Some("Big Screen"), true);

    // Town hall (south-east).
    b.rect(62, 56, 14, 11, "plaza");
    b.object("town_hall", 64, 57, 10, 7, Some("Town Hall"), true);
    b.ground(68, 64, "floor");
    b.ground(69, 64, "floor");

    // Homes gate on the west edge.
    b.object("homes_gate", 0, 46, 2, 5, Some("Homes"), true);

    // The market cart: sell your catches and harvest, buy seeds and furniture.
    b.object("market_cart", 54, 51, 2, 1, Some("Market"), true);

    // The notice board: neighbours' small requests, new every day.
    b.object("notice_board", 38, 44, 2, 1, Some("Notice Board"), true);

    // Topic corners: the seeds of future quarters (spec §9). Each has a
    // landmark to do things at and a board to talk on.
    // Sports: a small pitch with goals, north-east.
    b.rect(59, 24, 14, 9, "pitch");
    b.object("goal", 59, 27, 1, 3, None, true);
    b.object("goal", 72, 27, 1, 3, None, true);
    b.object("board_sports", 55, 27, 2, 1, Some("Sports Corner"), true);
    // Art: easels on the pond's east shore.
    b.object("easels", 39, 61, 3, 1, None, true);
    b.object("board_art", 40, 58, 2, 1, Some("Art Corner"), true);
    // Music: a bandstand south of the plaza.
    b.rect(52, 68, 7, 6, "plaza");
    b.object("bandstand", 53, 69, 5, 3, None, true);
    b.object("board_music", 54, 74, 2, 1, Some("Music Corner"), true);
    // Games: arcade cabinets west of the plaza.
    b.rect(22, 39, 10, 6, "plaza");
    b.object("arcade", 24, 41, 3, 1, None, true);
    b.object("board_games", 28, 41, 2, 1, Some("Games Corner"), true);

    // The fogged bridge across the river: built but closed until the first vote.
    b.rect(84, 47, 4, 3, "bridge");
    b.object(
        "fog_gate",
        87,
        46,
        1,
        5,
        Some("Beyond the bridge: decided by vote"),
        true,
    );

    // Two-seat benches along the main paths (one seat per tile), lamps at intervals.
    for x in (6..82).step_by(8) {
        if (x as i32 - cx).abs() > 10 {
            b.decor(x, 46, "bench");
            b.decor(x + 1, 46, "bench");
            b.decor(x + 4, 50, "lamp");
        }
    }
    for y in (16..90).step_by(8) {
        if (y as i32 - cy).abs() > 10 {
            b.decor(45, y, "bench");
            b.decor(46, y, "bench");
            b.decor(50, y + 4, "lamp");
        }
    }
    // Plaza benches facing the fountain.
    for (x, y) in [(43, 44), (52, 44), (43, 52), (52, 52)] {
        b.decor(x, y, "bench");
        b.decor(x + 1, y, "bench");
    }

    // Border tree line and scattered trees, bushes, rocks.
    for y in 0..H {
        for x in 0..84 {
            let edge = x < 2 || !(2..H - 2).contains(&y);
            if !b.free(x, y) {
                continue;
            }
            let near_plaza = (x as i32 - cx).pow(2) + (y as i32 - cy).pow(2) < 14 * 14;
            let h = hash(x, y, 3) % 100;
            if edge && !(46..=50).contains(&y) {
                b.decor(x, y, if h.is_multiple_of(2) { "tree" } else { "pine" });
            } else if !near_plaza && !(5..=12).contains(&y) {
                match h {
                    0..=3 => b.decor(x, y, "tree"),
                    4..=5 => b.decor(x, y, "pine"),
                    6..=7 => b.decor(x, y, "bush"),
                    8 => b.decor(x, y, "rock"),
                    _ => {}
                }
            }
        }
    }

    b.finish("Founders' Park", (48, 53))
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
    b.object("park_gate", 9, h - 1, 2, 1, Some("To the park"), true);
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
    write("founders_park", &park())?;
    write("home", &home())
}
