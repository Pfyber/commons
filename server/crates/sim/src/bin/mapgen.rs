//! Generates `assets/maps/founders_park.json`, the ≈96×96 founding map (spec §11):
//! central plaza with fountain, pond, chess tables, benches, garden plots,
//! big screen, town hall, homes gate, one fogged bridge to the east, a
//! notice board and four topic corners (sports, art, music, games), set in an
//! organic landscape: winding paths, a brook with footbridges, groves and the
//! Whispering Wood, a wildflower meadow, an orchard, a hedge maze, the Old Oak
//! with its swing, a wishing well, a pier and a picnic lawn.
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
    "stones",
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

/// The Founders' Grove: (x0, y0, x1, y1), inclusive.
const GROVE_AREAS: [(u16, u16, u16, u16); 2] = [(64, 33, 82, 44), (73, 18, 82, 31)];

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
    let (cx, cy) = (48i32, 48i32);

    // Grass: soft patches of darker grass from smooth noise, not a grid.
    for y in 0..H {
        for x in 0..W {
            if noise(x as f32, y as f32, 7.0, 1) > 0.62 {
                b.ground(x, y, "grass_dark");
            }
        }
    }

    // River along the east edge, fog beyond it.
    b.rect(84, 0, 4, H, "water");
    b.rect(88, 0, W - 88, H, "fog");

    // Wildflower meadow in the south-west, in drifts.
    for y in 72..94u16 {
        for x in 2..42u16 {
            if noise(x as f32, y as f32, 5.0, 11) > 0.5 {
                b.ground(x, y, "flowers");
            }
        }
    }

    // The pond: a lopsided, natural shore with a sand rim.
    for y in 0..H {
        for x in 0..W {
            let (dx, dy) = ((x as f32 - 28.0) / 9.5, (y as f32 - 64.0) / 6.5);
            let e = dx * dx + dy * dy + (noise(x as f32, y as f32, 3.0, 5) - 0.5) * 0.45;
            if e <= 1.0 {
                b.ground(x, y, "water");
            } else if e <= 1.4 {
                b.ground(x, y, "sand");
            }
        }
    }

    // The brook: from a spring in the Whispering Wood down to the pond, and
    // on from the pond to the south edge.
    b.stroke(
        &[
            (7.0, 9.0),
            (9.0, 18.0),
            (14.0, 27.0),
            (13.0, 36.0),
            (17.0, 44.0),
            (16.0, 52.0),
            (21.0, 58.0),
        ],
        0.9,
        Brush::Water,
    );
    b.stroke(
        &[
            (30.0, 69.0),
            (31.0, 76.0),
            (27.0, 84.0),
            (30.0, 90.0),
            (28.0, 96.0),
        ],
        0.9,
        Brush::Water,
    );

    // Central plaza: stone circle with a fountain and flowerbeds.
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

    // The market cart and the notice board by the plaza.
    b.object("market_cart", 54, 51, 2, 1, Some("Market"), true);
    b.object("notice_board", 38, 44, 2, 1, Some("Notice Board"), true);
    // The Story of the Town, the first thing you see (spec §10.1).
    b.object("story_board", 44, 55, 2, 1, Some("Story of the Town"), true);

    // Topic corners (spec §9): a landmark to do things at and a board.
    b.rect(59, 24, 14, 9, "pitch");
    b.object("goal", 59, 27, 1, 3, None, true);
    b.object("goal", 72, 27, 1, 3, None, true);
    b.object("board_sports", 55, 27, 2, 1, Some("Sports Corner"), true);
    b.object("easels", 39, 61, 3, 1, None, true);
    b.object("board_art", 40, 58, 2, 1, Some("Art Corner"), true);
    b.rect(52, 68, 7, 6, "plaza");
    b.object("bandstand", 53, 69, 5, 3, None, true);
    b.object("board_music", 54, 74, 2, 1, Some("Music Corner"), true);
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

    // ---- landmarks ----------------------------------------------------------

    // The Old Oak on the meadow's edge, with a rope swing under it.
    b.object("old_oak", 10, 62, 3, 3, Some("The Old Oak"), true);
    b.decor(12, 66, "swing");
    // The wishing well, a stone's throw from the plaza.
    b.object("well", 38, 53, 2, 2, Some("Wishing Well"), true);
    // A little pier into the pond for fishing.
    b.rect(34, 66, 4, 1, "bridge");
    // Picnic lawn at the south end of the main path.
    b.rect(42, 86, 13, 6, "grass");
    for (x, y) in [(43u16, 87u16), (47, 89), (51, 87)] {
        b.decor(x, y, "blanket");
        b.decor(x + 1, y, "blanket");
    }
    // The hedge maze in the north-east, with something at its heart.
    let (mx, my) = (64u16, 6u16);
    let (mw, mh) = maze(&mut b, mx, my, 7, 5, 4242);
    b.object(
        "maze_heart",
        mx + mw / 2,
        my + mh / 2,
        1,
        1,
        Some("The heart of the maze"),
        true,
    );
    // The Whispering Wood: a fairy ring in a clearing, and a tiny door.
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
        b.decor((9 + dx) as u16, (14 + dy) as u16, "mushrooms");
    }
    b.object("tiny_door", 5, 17, 1, 1, Some("A tiny door"), true);
    // The orchard in the south-east.
    for y in (72..92u16).step_by(4) {
        for x in (60..82u16).step_by(4) {
            b.decor(x + (y / 4) % 2 * 2, y, "apple_tree");
        }
    }

    // ---- paths ------------------------------------------------------------------

    let roads: [&[(f32, f32)]; 4] = [
        // West road: the homes gate to the plaza, past the brook bridge.
        &[
            (1.0, 48.0),
            (10.0, 47.5),
            (20.0, 49.5),
            (31.0, 47.5),
            (41.0, 48.0),
        ],
        // East road: the plaza to the river bridge.
        &[(55.0, 48.0), (64.0, 50.0), (74.0, 47.0), (84.0, 48.0)],
        // North road: the plaza to the big screen's lawn.
        &[(48.0, 40.0), (46.5, 32.0), (49.5, 22.0), (48.0, 12.0)],
        // South road: the plaza to the picnic lawn.
        &[(48.0, 56.0), (45.5, 64.0), (49.0, 76.0), (48.0, 86.0)],
    ];
    let trails: [&[(f32, f32)]; 11] = [
        &[(46.8, 30.0), (38.0, 22.5), (28.0, 21.5), (27.5, 24.0)], // to the garden gate
        &[(48.5, 21.0), (58.0, 20.0), (71.0, 19.0)],               // to the maze
        &[(47.5, 30.0), (53.0, 28.5), (58.0, 28.5)],               // to the pitch
        &[(54.0, 44.0), (57.0, 40.0)],                             // to the chess tables
        &[(64.0, 50.0), (68.5, 55.0)],                             // to the town hall
        &[(47.0, 70.0), (51.5, 71.0)],                             // to the bandstand
        &[(27.0, 48.5), (27.0, 45.0)],                             // to the arcade
        &[
            (31.0, 48.0),
            (36.0, 55.0),
            (40.0, 60.0),
            (44.0, 65.0),
            (46.0, 66.0),
        ], // pond walk
        &[(36.0, 63.0), (37.5, 66.0)],                             // to the pier
        &[
            (20.0, 49.0),
            (16.0, 58.0),
            (13.0, 66.5),
            (18.0, 74.0),
            (26.0, 80.0),
            (40.0, 86.0),
            (43.0, 88.0),
        ], // meadow loop
        &[(10.0, 47.5), (8.0, 36.0), (10.0, 24.0), (9.0, 17.0)],   // into the wood
    ];
    for r in roads {
        b.stroke(r, 1.4, Brush::Path);
    }
    for t in trails {
        b.stroke(t, 0.8, Brush::Path);
    }

    // Signposts at the main junctions: tap to read.
    b.object("signpost", 21, 46, 1, 1, Some("North: Garden & the Whispering Wood · South: the Old Oak & the meadow · East: the fountain"), true);
    b.object(
        "signpost",
        51,
        31,
        1,
        1,
        Some("East: Sports Corner · North: the Big Screen & the hedge maze · South: the fountain"),
        true,
    );
    b.object(
        "signpost",
        44,
        61,
        1,
        1,
        Some("West: the pond, the pier & Art Corner · South: Music Corner & the picnic lawn"),
        true,
    );
    b.object(
        "signpost",
        60,
        52,
        1,
        1,
        Some(
            "South: the Town Hall · East: the bridge (closed for now) · North-east: the Founders' Grove · Further south: the orchard",
        ),
        true,
    );

    // ---- benches and lamps along the roads ----------------------------------------

    for r in roads {
        let samples = spline(r, 0.25);
        for (k, w) in samples.windows(2).enumerate() {
            let ((x0, y0), (x1, y1)) = (w[0], w[1]);
            let (tx, ty) = (x1 - x0, y1 - y0);
            let len = (tx * tx + ty * ty).sqrt().max(1e-3);
            let (nx, ny) = (-ty / len, tx / len);
            if k % 36 == 18 {
                let (bx, by) = (
                    (x0 + nx * 2.6).round() as u16,
                    (y0 + ny * 2.6).round() as u16,
                );
                if b.free(bx, by)
                    && b.free(bx + 1, by)
                    && (bx as i32 - cx).pow(2) + (by as i32 - cy).pow(2) > 120
                {
                    b.decor(bx, by, "bench");
                    b.decor(bx + 1, by, "bench");
                }
            }
            if k % 40 == 0 && k > 0 {
                let (lx, ly) = (
                    (x0 - nx * 2.4).round() as u16,
                    (y0 - ny * 2.4).round() as u16,
                );
                if b.free(lx, ly) {
                    b.decor(lx, ly, "lamp");
                }
            }
        }
    }
    // Plaza benches facing the fountain.
    for (x, y) in [(43, 44), (52, 44), (43, 52), (52, 52)] {
        b.decor(x, y, "bench");
        b.decor(x + 1, y, "bench");
    }

    // The Founders' Grove (spec §11), east of the chess tables: a stone with
    // every founder's name and a seedling for each, filling out from the stone.
    let stone = (72u16, 38u16);
    b.stroke(
        &[(68.0, 47.0), (70.0, 43.0), (72.5, 39.5)],
        0.8,
        Brush::Path,
    );
    b.object(
        "founders_stone",
        stone.0,
        stone.1,
        2,
        1,
        Some("Founders' Stone"),
        true,
    );
    let mut slots = vec![];
    for (x0, y0, x1, y1) in GROVE_AREAS {
        for (r, y) in (y0 + 1..=y1).step_by(2).enumerate() {
            for x in (x0 + 1 + (r % 2) as u16..=x1).step_by(2) {
                let near_stone = (x as i32 - stone.0 as i32 - 1).abs() <= 2
                    && (y as i32 - stone.1 as i32).abs() <= 1;
                if b.free(x, y) && !near_stone {
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
        b.object("grove_slot", x, y, 1, 1, None, false);
    }

    // ---- secret places and cosy corners ------------------------------------------------
    //
    // Nooks (spec: "more intimate conversations"): chat inside one is heard
    // only inside it. Each is reached through a passage that looks like the
    // trees around it, or across stepping stones.

    // The Willow Hideaway: a ring of weeping willows in the meadow; one
    // curtain of branches on the east side parts as you walk through.
    let (hx, hy, hrx, hry) = (9.0f32, 82.0f32, 4.6f32, 3.4f32);
    let mut inside = vec![];
    for y in 76..90u16 {
        for x in 2..18u16 {
            let (dx, dy) = ((x as f32 - hx) / hrx, (y as f32 - hy) / hry);
            let e = dx * dx + dy * dy;
            if e < 1.0 {
                b.ground(x, y, "flowers");
                b.decor(x, y, "none");
                inside.push((x, y));
            } else if e < 1.9 {
                b.ground(x, y, "grass_dark");
                b.decor(x, y, "willow");
            }
        }
    }
    let gap_x = (hx + hrx).ceil() as u16;
    for x in gap_x..gap_x + 2 {
        b.decor(x, hy as u16, "willow_curtain");
    }
    b.decor(8, 80, "bench");
    b.decor(9, 80, "bench");
    b.decor(11, 80, "lantern");
    nook(&mut b, &inside, "The Willow Hideaway");

    // The Moss Grotto, deep in the Whispering Wood, east of the fairy ring:
    // the third pine from the top on its west side isn't quite a pine.
    let mut inside = vec![];
    for y in 9..=15u16 {
        for x in 13..=17u16 {
            if (14..=16).contains(&x) && (10..=14).contains(&y) {
                b.ground(x, y, "grass_dark");
                b.decor(x, y, "none");
                inside.push((x, y));
            } else {
                b.decor(x, y, "pine");
            }
        }
    }
    b.decor(13, 12, "pine_secret");
    b.decor(12, 12, "none");
    b.decor(15, 10, "log_seat");
    b.decor(16, 10, "log_seat");
    b.decor(14, 10, "lantern");
    for (x, y) in [(14u16, 13u16), (16, 14), (14, 14), (16, 12)] {
        b.decor(x, y, "mushrooms");
    }
    nook(&mut b, &inside, "The Moss Grotto");

    // The Little Island in the pond, across stepping stones from the pier.
    let mut inside = vec![];
    for y in 61..68u16 {
        for x in 21..31u16 {
            let (dx, dy) = ((x as f32 - 25.5) / 2.9, (y as f32 - 64.0) / 1.9);
            let e = dx * dx + dy * dy;
            if e <= 1.0 {
                b.ground(x, y, if e < 0.55 { "grass" } else { "sand" });
                b.decor(x, y, "none");
                inside.push((x, y));
            }
        }
    }
    for x in 24..34u16 {
        if b.ground[b.i(x, 66)] == g("water") {
            b.ground(x, 66, "stones");
            b.decor(x, 66, "none");
        }
    }
    b.decor(25, 63, "bench");
    b.decor(26, 63, "bench");
    b.decor(23, 64, "lantern");
    nook(&mut b, &inside, "The Little Island");

    // The heart of the maze is a nook too.
    let (hcx, hcy) = (mx + mw / 2, my + mh / 2);
    b.object(
        "nook",
        hcx - 1,
        hcy - 1,
        3,
        3,
        Some("The Heart of the Maze"),
        false,
    );

    // The campfire circle on the west field: logs to sit on, and a question
    // to talk about (client side).
    let (fx, fy) = (7u16, 40u16);
    for y in fy - 2..=fy + 2 {
        for x in fx - 2..=fx + 2 {
            b.ground(x, y, "sand");
            b.decor(x, y, "none");
        }
    }
    b.object("campfire", fx, fy, 1, 1, Some("Campfire"), true);
    for (x, y) in [
        (fx - 2, fy - 1),
        (fx - 2, fy + 1),
        (fx + 2, fy - 1),
        (fx + 2, fy + 1),
        (fx, fy - 2),
        (fx, fy + 2),
    ] {
        b.decor(x, y, "log_seat");
    }
    b.stroke(&[(10.0, 47.5), (9.0, 45.0), (8.0, 43.0)], 0.8, Brush::Path);

    // The tailor's tent by the plaza: the changing room. It goes on the
    // nearest free grass to the south-east of the fountain.
    let tent = (0..12u16)
        .flat_map(|r| (0..=r).flat_map(move |dx| [(56 + dx, 54 + r - dx), (56 + r - dx, 54 + dx)]))
        .find(|&(x, y)| (0..3).all(|dx| (0..3).all(|dy| b.free(x + dx, y + dy))))
        .expect("room for the tailor's tent");
    b.object("tailor", tent.0, tent.1, 3, 2, Some("Tailor"), true);

    // The clothes shop on the lawn between the Story board and the Town Hall,
    // its door facing the bandstand, with a little path down to the plaza.
    // Walking in takes you to the "shop" zone.
    let (sx, sy, sw, sh) = (52u16, 57u16, 7u16, 4u16);
    assert!(
        (sx..sx + sw).all(|x| (sy..sy + sh).all(|y| b.free(x, y))),
        "room for the clothes shop"
    );
    b.object("clothes_shop", sx, sy, sw, sh, Some("Clothes Shop"), true);
    b.rect(sx + sw / 2, sy + sh, 1, 68 - (sy + sh), "path");

    // Messages in bottles, at the land end of the pier.
    b.object("bottles", 38, 64, 1, 1, Some("Messages in bottles"), true);

    // Wish lanterns on the picnic lawn, for sending a wish up into the sky.
    b.object("lantern_stand", 49, 86, 1, 1, Some("Wish lanterns"), true);

    // Reeds and lily pads around the water.
    for y in 1..H - 1 {
        for x in 1..84 {
            let gi = b.ground[b.i(x, y)];
            let h = hash(x, y, 7) % 100;
            let shore = [
                b.ground[b.i(x - 1, y)],
                b.ground[b.i(x + 1, y)],
                b.ground[b.i(x, y - 1)],
                b.ground[b.i(x, y + 1)],
            ]
            .contains(&g("water"));
            if gi == g("water") && b.decor[b.i(x, y)] == 0 && !shore_is_edge(&b, x, y) && h < 6 {
                b.decor(x, y, "lilypad");
            } else if shore && b.free_any(x, y) && h < 22 {
                b.decor(x, y, "reeds");
            }
        }
    }

    // Trees in groves (noise), a dense wood in the north-west, a tree line at
    // the edges; undergrowth, stumps, logs and tall grass between.
    for y in 0..H {
        for x in 0..84 {
            if !b.free(x, y) && !(b.ground[b.i(x, y)] == g("flowers") && b.decor[b.i(x, y)] == 0) {
                continue;
            }
            let ground = b.ground[b.i(x, y)];
            let near_plaza = (x as i32 - cx).pow(2) + (y as i32 - cy).pow(2) < 14 * 14;
            let edge = x < 2 || !(2..H - 2).contains(&y);
            let wood = x < 18
                && (3..22).contains(&y)
                && !((6..=12).contains(&x) && (11..=17).contains(&y));
            let grove = noise(x as f32, y as f32, 9.0, 21);
            let h = hash(x, y, 3) % 1000;
            let screen_lawn = (36..62).contains(&x) && (11..16).contains(&y);
            if edge && !(46..=50).contains(&y) {
                b.decor(x, y, if h.is_multiple_of(2) { "tree" } else { "pine" });
                continue;
            }
            let in_maze = (mx..mx + mw).contains(&x) && (my..my + mh).contains(&y);
            let in_garden = (19..37).contains(&x) && (24..38).contains(&y);
            let in_dream = [
                (2u16, 76u16, 17u16, 89u16),
                (12, 12, 12, 12),
                (14, 10, 16, 14),
                (21, 61, 30, 67),
                (3, 36, 11, 44),
            ]
            .iter()
            .any(|&(x0, y0, x1, y1)| (x0..=x1).contains(&x) && (y0..=y1).contains(&y));
            let in_grove = GROVE_AREAS
                .iter()
                .any(|&(x0, y0, x1, y1)| (x0..=x1).contains(&x) && (y0..=y1).contains(&y));
            if near_plaza
                || screen_lawn
                || in_maze
                || in_garden
                || in_grove
                || in_dream
                || near_path(&b, x, y)
            {
                continue;
            }
            let meadow = ground == g("flowers");
            let density = if wood {
                0.62
            } else if grove > 0.66 {
                0.16
            } else {
                0.012
            };
            let r = h as f32 / 1000.0;
            if r < density && !meadow {
                b.decor(
                    x,
                    y,
                    if (wood && h.is_multiple_of(3)) || h.is_multiple_of(5) {
                        "pine"
                    } else {
                        "tree"
                    },
                );
            } else if r < density + 0.02 && !meadow {
                b.decor(x, y, "bush");
            } else if (0.5..0.506).contains(&r) {
                b.decor(x, y, if h.is_multiple_of(2) { "stump" } else { "log" });
            } else if (0.6..0.604).contains(&r) {
                b.decor(x, y, "rock");
            } else if (meadow || grove > 0.55) && (0.7..0.78).contains(&r) {
                b.decor(x, y, "tallgrass");
            } else if wood && (0.8..0.83).contains(&r) {
                b.decor(x, y, "mushrooms");
            }
        }
    }

    b.finish("Founders' Park", (48, 53))
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

    /// Free grass, sand or flowers (for shore planting).
    fn free_any(&self, x: u16, y: u16) -> bool {
        let i = self.i(x, y);
        self.decor[i] == 0
            && !self.solid[i]
            && [g("grass"), g("grass_dark"), g("sand"), g("flowers")].contains(&self.ground[i])
    }
}

/// Water tiles right at the edge stay clear of lily pads (they'd hide the shore).
fn shore_is_edge(b: &Builder, x: u16, y: u16) -> bool {
    [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
        .iter()
        .any(|&(a, c)| b.ground[b.i(a, c)] != g("water"))
}

/// Within a tile of a path or bridge (keeps paths clear of trees).
fn near_path(b: &Builder, x: u16, y: u16) -> bool {
    for dy in -1i32..=1 {
        for dx in -1i32..=1 {
            let (a, c) = (x as i32 + dx, y as i32 + dy);
            if a < 0 || c < 0 || a >= b.w as i32 || c >= b.h as i32 {
                continue;
            }
            let gi = b.ground[b.i(a as u16, c as u16)];
            if gi == g("path") || gi == g("bridge") {
                return true;
            }
        }
    }
    false
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
    // A wardrobe against the back wall: change clothes at home.
    b.object("wardrobe", 15, 2, 2, 1, Some("Wardrobe"), true);
    b.finish("Home", (10, 11))
}

/// Inside the clothes shop: racks of outfits, hats and accessories, the
/// counter (the clerk stands behind it) and a changing room; the door leads
/// back out to the park.
fn shop() -> MapFile {
    let (w, h) = (18u16, 11u16);
    let mut b = Builder::new(w, h);
    b.rect(0, 0, w, h, "floor");
    for x in 0..w {
        b.decor(x, 0, "wall");
        if !(8..=9).contains(&x) {
            b.decor(x, h - 1, "wall");
        }
    }
    for y in 0..h {
        b.decor(0, y, "wall");
        b.decor(w - 1, y, "wall");
    }
    // A rug from the door to the middle of the shop.
    b.rect(7, 4, 4, 6, "plaza");
    b.object("clothes_rack", 2, 2, 3, 1, Some("Outfits"), true);
    b.object("clothes_rack", 2, 5, 3, 1, Some("Hats"), true);
    b.object("clothes_rack", 2, 8, 3, 1, Some("Accessories"), true);
    b.object("shop_counter", 11, 3, 5, 1, Some("Counter"), true);
    b.object("fitting_room", 13, 6, 3, 2, Some("Changing room"), true);
    b.object("shop_exit", 8, h - 1, 2, 1, Some("To the park"), true);
    b.finish("Clothes Shop", (9, 8))
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
    write("home", &home())?;
    write("shop", &shop())
}
