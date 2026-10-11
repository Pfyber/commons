//! Generates `assets/maps/founders_park.json`, the ≈96×96 founding map (spec §11):
//! central plaza with fountain, pond, chess tables, benches, garden plots,
//! big screen, town hall, homes gate and one fogged bridge to the east.
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
    ground: Vec<u8>,
    decor: Vec<u8>,
    solid: Vec<bool>,
    objects: Vec<MapObject>,
}

impl Builder {
    fn i(x: u16, y: u16) -> usize {
        y as usize * W as usize + x as usize
    }
    fn ground(&mut self, x: u16, y: u16, t: &str) {
        if x < W && y < H {
            self.ground[Self::i(x, y)] = g(t);
        }
    }
    fn decor(&mut self, x: u16, y: u16, t: &str) {
        if x < W && y < H {
            self.decor[Self::i(x, y)] = d(t);
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
                    self.solid[Self::i(xx, yy)] = true;
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
        let i = Self::i(x, y);
        self.decor[i] == 0
            && !self.solid[i]
            && [g("grass"), g("grass_dark")].contains(&self.ground[i])
    }
}

fn main() -> std::io::Result<()> {
    let n = W as usize * H as usize;
    let mut b = Builder {
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
    b.rect(47, 4, 3, 88, "path");
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

    // Benches along the main paths, lamps at intervals.
    for x in (6..82).step_by(8) {
        if (x as i32 - cx).abs() > 10 {
            b.decor(x, 46, "bench");
            b.decor(x + 4, 50, "lamp");
        }
    }
    for y in (8..90).step_by(8) {
        if (y as i32 - cy).abs() > 10 {
            b.decor(46, y, "bench");
            b.decor(50, y + 4, "lamp");
        }
    }
    // Plaza benches facing the fountain.
    for (x, y) in [(44, 44), (52, 44), (44, 52), (52, 52)] {
        b.decor(x, y, "bench");
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

    // Collision: water, fog, solid decor and solid objects.
    let walk_decor = [d("none"), d("reeds")];
    let blocked_ground = [g("water"), g("fog")];
    let collision: Vec<u8> = (0..n)
        .map(|i| {
            let gr = b.ground[i];
            let blocked =
                b.solid[i] || blocked_ground.contains(&gr) || !walk_decor.contains(&b.decor[i]);
            blocked as u8
        })
        .collect();

    let map = MapFile {
        name: "Founders' Park".into(),
        width: W,
        height: H,
        spawn: Spawn { x: 48, y: 53 },
        ground_legend: GROUND.iter().map(|s| s.to_string()).collect(),
        decor_legend: DECOR.iter().map(|s| s.to_string()).collect(),
        ground: b.ground,
        decor: b.decor,
        collision,
        objects: b.objects,
    };

    let json = serde_json::to_string(&map).unwrap();
    // Validate before writing.
    MapFile::from_json(&json).expect("generated map is invalid");
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../assets/maps/founders_park.json");
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, json)?;
    println!("wrote {}", path.display());
    Ok(())
}
