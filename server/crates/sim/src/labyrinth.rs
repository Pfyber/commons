//! The Glowroot Labyrinth: a new maze every day under the hedge maze's
//! heart, the same for everyone that day (so the town can talk it over).
//!
//! An expedition, at dusk. You come down a stair at the south edge; the
//! Glowroot, the way back up, grows in a sealed chamber at the very centre.
//! Its Great Gate opens only for someone attuned to all three heartstones,
//! far out in the north-west, the north-east and the southern corners (and
//! for whoever is standing with them). On the way:
//!
//! - wisps drift along the long corridors, weaving from lane to lane: touch
//!   one and it blows your light out, and you wake by the last lantern you
//!   passed;
//! - sleeping lanterns at the crossings: whoever walks past lights one for
//!   everyone that day;
//! - root gates, shortcuts: a timed one opens for a few seconds when you
//!   step on its rune stone (run!), a twin one only while two people stand
//!   on its two stones at once;
//! - lost glimmers in the deepest dead ends, and glades to rest in.
//!
//! Corridors are two tiles wide (room to pass, and to walk together), with
//! loops so a wrong turn isn't a long walk back. Generated from the day alone
//! (integer maths, fixed orders), so the zone server (collision, rewards)
//! and the API (the map players are sent) agree. Wisps move by the instance
//! clock (`wisp_at`), the same function on both sides.

use crate::TilePos;
use crate::map::{MapFile, MapObject, Spawn};
use std::collections::VecDeque;

/// The zone id; its instances are keyed by day (`owner`, see `day_key`).
pub const ZONE: &str = "labyrinth";
/// Cells across and down; each is a 2×2 floor with a wall line between.
const CELLS: u16 = 25;
/// Solid rock round the outside (tiles).
const MARGIN: u16 = 3;
/// The heart chamber: 3×3 cells in the middle, walled but for the Great Gate.
const CHAMBER: (u16, u16) = (11, 13);
pub const GLIMMERS: usize = 8;
pub const LANTERNS: usize = 20;
pub const HEARTSTONES: usize = 3;
const GLADES: usize = 4;
const ROOT_GATES: usize = 6;
const WISPS: usize = 10;
/// Wisps drift this fast along their corridor (tiles a second).
const WISP_SPEED: f64 = 1.6;

const GROUND: [&str; 4] = ["moss", "road", "water", "grass_dark"];
const DECOR: [&str; 8] = [
    "none",
    "lab_wall",
    "mushrooms",
    "fern",
    "pebbles",
    "lilypad",
    "log_seat",
    "lantern",
];
/// Decor you can walk through.
const WALK_DECOR: [&str; 5] = ["none", "mushrooms", "fern", "pebbles", "lilypad"];

/// What opens a gate (`lab_gate` objects are labelled `"<n>:<kind>"`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateKind {
    /// The way into the heart chamber: for the attuned (and whoever's with them).
    Great,
    /// Opens a few seconds after you step on its stone.
    Timed,
    /// Opens while both its stones have someone on them.
    Twin,
}

impl GateKind {
    pub fn parse(s: &str) -> Option<GateKind> {
        match s {
            "great" => Some(GateKind::Great),
            "timed" => Some(GateKind::Timed),
            "twin" => Some(GateKind::Twin),
            _ => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            GateKind::Great => "great",
            GateKind::Timed => "timed",
            GateKind::Twin => "twin",
        }
    }
}

/// Days since 1970-01-01, UTC: which labyrinth is today's.
pub fn today() -> u32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    (secs / 86_400) as u32
}

/// A day as an instance owner (`"20397"`), and back.
pub fn day_key(day: u32) -> String {
    day.to_string()
}
pub fn parse_day(key: &str) -> Option<u32> {
    (key.len() <= 6 && key.bytes().all(|b| b.is_ascii_digit()))
        .then(|| key.parse().ok())
        .flatten()
}

/// Whether `day` may be visited now: today, or yesterday's for anyone still
/// down there after midnight (and tomorrow's, for a clock a little ahead).
pub fn open(day: u32) -> bool {
    let t = today();
    day + 1 >= t && day <= t + 1
}

/// Where a wisp is at instance time `now` (tile units): back and forth along
/// its corridor (`o`, one lane of it: `w`×1 or 1×`h`), weaving across to the
/// other lane and back. Its label is its phase (ms). The client draws it with
/// the same sums.
pub fn wisp_at(o: &MapObject, now: u32) -> (f64, f64) {
    let phase: u32 = o.label.as_deref().and_then(|l| l.parse().ok()).unwrap_or(0);
    let t = now.wrapping_add(phase) as f64 / 1000.0;
    let len = (o.w.max(o.h) - 1) as f64;
    let period = 2.0 * len / WISP_SPEED;
    let u = (t % period) * WISP_SPEED;
    let along = if u <= len { u } else { 2.0 * len - u };
    let across = ((t * 1.3).sin() + 1.0) / 2.0;
    if o.w >= o.h {
        (o.x as f64 + along, o.y as f64 + across)
    } else {
        (o.x as f64 + across, o.y as f64 + along)
    }
}

/// xorshift32: small, fast and the same everywhere.
struct Rng(u32);
impl Rng {
    fn new(day: u32) -> Self {
        let s = day.wrapping_mul(0x9E37_79B1) ^ 0x5EED_1AB7;
        Rng(if s == 0 { 1 } else { s })
    }
    fn next(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u32) as usize
    }
}

type Cell = (u16, u16);

fn in_chamber(c: Cell) -> bool {
    (CHAMBER.0..=CHAMBER.1).contains(&c.0) && (CHAMBER.0..=CHAMBER.1).contains(&c.1)
}

/// The maze as cells: which walls are open (east and south of each cell).
struct Cells {
    east: Vec<bool>,
    south: Vec<bool>,
}

impl Cells {
    fn i(x: u16, y: u16) -> usize {
        y as usize * CELLS as usize + x as usize
    }
    fn neighbours(x: u16, y: u16) -> Vec<Cell> {
        let mut out = Vec::with_capacity(4);
        for (dx, dy) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx >= 0 && ny >= 0 && nx < CELLS as i32 && ny < CELLS as i32 {
                out.push((nx as u16, ny as u16));
            }
        }
        out
    }
    fn linked(&self, a: Cell, b: Cell) -> bool {
        let (lo, hi) = if (a.1, a.0) < (b.1, b.0) {
            (a, b)
        } else {
            (b, a)
        };
        if lo.1 == hi.1 {
            self.east[Self::i(lo.0, lo.1)]
        } else {
            self.south[Self::i(lo.0, lo.1)]
        }
    }
    /// Open neighbours of a cell, in a fixed order (east, west, south, north).
    fn links(&self, x: u16, y: u16) -> Vec<Cell> {
        Self::neighbours(x, y)
            .into_iter()
            .filter(|&n| self.linked((x, y), n))
            .collect()
    }
    fn open_between(&mut self, a: Cell, b: Cell) {
        let (lo, hi) = if (a.1, a.0) < (b.1, b.0) {
            (a, b)
        } else {
            (b, a)
        };
        if lo.1 == hi.1 {
            self.east[Self::i(lo.0, lo.1)] = true;
        } else {
            self.south[Self::i(lo.0, lo.1)] = true;
        }
    }
    /// Steps from `from` to every cell (gates shut: they're not links).
    fn distances(&self, from: Cell) -> Vec<u32> {
        let mut d = vec![u32::MAX; CELLS as usize * CELLS as usize];
        d[Self::i(from.0, from.1)] = 0;
        let mut q = VecDeque::from([from]);
        while let Some((x, y)) = q.pop_front() {
            let here = d[Self::i(x, y)];
            for (nx, ny) in self.links(x, y) {
                let j = Self::i(nx, ny);
                if d[j] == u32::MAX {
                    d[j] = here + 1;
                    q.push_back((nx, ny));
                }
            }
        }
        d
    }
}

/// The top-left floor tile of a cell.
fn cell_tile(x: u16, y: u16) -> TilePos {
    (MARGIN + 1 + x * 3, MARGIN + 1 + y * 3)
}

/// The two wall tiles between neighbouring cells.
fn wall_between(a: Cell, b: Cell) -> [TilePos; 2] {
    let (lo, hi) = if (a.1, a.0) < (b.1, b.0) {
        (a, b)
    } else {
        (b, a)
    };
    let (tx, ty) = cell_tile(lo.0, lo.1);
    if lo.1 == hi.1 {
        [(tx + 2, ty), (tx + 2, ty + 1)]
    } else {
        [(tx, ty + 2), (tx + 1, ty + 2)]
    }
}

fn manhattan(a: Cell, b: Cell) -> i32 {
    (a.0 as i32 - b.0 as i32).abs() + (a.1 as i32 - b.1 as i32).abs()
}

fn carve(rng: &mut Rng, start: Cell) -> Cells {
    let n = CELLS as usize * CELLS as usize;
    let mut c = Cells {
        east: vec![false; n],
        south: vec![false; n],
    };
    // A depth-first walk round the chamber: long winding corridors.
    let mut seen = vec![false; n];
    seen[Cells::i(start.0, start.1)] = true;
    let mut stack = vec![start];
    while let Some(&(x, y)) = stack.last() {
        let next: Vec<Cell> = Cells::neighbours(x, y)
            .into_iter()
            .filter(|&q| !in_chamber(q) && !seen[Cells::i(q.0, q.1)])
            .collect();
        if next.is_empty() {
            stack.pop();
            continue;
        }
        let to = next[rng.below(next.len())];
        seen[Cells::i(to.0, to.1)] = true;
        c.open_between((x, y), to);
        stack.push(to);
    }
    // Loops: about a quarter of the dead ends open on through.
    for y in 0..CELLS {
        for x in 0..CELLS {
            if (x, y) == start
                || in_chamber((x, y))
                || c.links(x, y).len() != 1
                || rng.below(4) != 0
            {
                continue;
            }
            let shut: Vec<Cell> = Cells::neighbours(x, y)
                .into_iter()
                .filter(|&o| !in_chamber(o) && !c.linked((x, y), o))
                .collect();
            if !shut.is_empty() {
                let o = shut[rng.below(shut.len())];
                c.open_between((x, y), o);
            }
        }
    }
    // The chamber: one room inside.
    for y in CHAMBER.0..=CHAMBER.1 {
        for x in CHAMBER.0..=CHAMBER.1 {
            if x < CHAMBER.1 {
                c.open_between((x, y), (x + 1, y));
            }
            if y < CHAMBER.1 {
                c.open_between((x, y), (x, y + 1));
            }
        }
    }
    c
}

/// The best cell (furthest from the stair) among `cells` that `ok` allows.
fn furthest(cells: &[Cell], dist: &[u32], ok: impl Fn(Cell) -> bool) -> Option<Cell> {
    cells
        .iter()
        .copied()
        .filter(|&c| ok(c) && dist[Cells::i(c.0, c.1)] != u32::MAX)
        .max_by(|a, b| {
            dist[Cells::i(a.0, a.1)]
                .cmp(&dist[Cells::i(b.0, b.1)])
                .then((b.1, b.0).cmp(&(a.1, a.0)))
        })
}

struct Gate {
    kind: GateKind,
    tiles: [TilePos; 2],
    stones: Vec<TilePos>,
}

/// Today's labyrinth.
pub fn generate(day: u32) -> MapFile {
    let mut rng = Rng::new(day);
    let size = MARGIN * 2 + CELLS * 3 + 1;
    let n = size as usize * size as usize;
    let g = |name: &str| GROUND.iter().position(|s| *s == name).unwrap() as u8;
    let d = |name: &str| DECOR.iter().position(|s| *s == name).unwrap() as u8;
    let idx = |x: u16, y: u16| y as usize * size as usize + x as usize;
    let mut ground = vec![g("road"); n];
    let mut decor = vec![d("lab_wall"); n];
    let mut solid = vec![false; n];
    let mut objects: Vec<MapObject> = Vec::new();
    let object = |kind: &str, x: u16, y: u16, w: u16, h: u16, label: String| MapObject {
        kind: kind.into(),
        x,
        y,
        w,
        h,
        label: Some(label),
    };

    let start = (CELLS / 2, CELLS - 1);
    let mut cells = carve(&mut rng, start);
    let mid = (CELLS / 2, CELLS / 2);

    // Glades: 2×2 cells opened into one room, away from the stair and the chamber.
    let mut glades: Vec<Cell> = Vec::new();
    for _ in 0..200 {
        if glades.len() == GLADES {
            break;
        }
        let gx = rng.below(CELLS as usize - 1) as u16;
        let gy = rng.below(CELLS as usize - 2) as u16;
        let quad = [(gx, gy), (gx + 1, gy), (gx, gy + 1), (gx + 1, gy + 1)];
        if quad.iter().any(|&c| in_chamber(c) || manhattan(c, mid) < 4)
            || manhattan((gx, gy), start) < 6
            || glades.iter().any(|&q| manhattan(q, (gx, gy)) < 7)
        {
            continue;
        }
        glades.push((gx, gy));
    }
    for &(gx, gy) in &glades {
        cells.open_between((gx, gy), (gx + 1, gy));
        cells.open_between((gx, gy + 1), (gx + 1, gy + 1));
        cells.open_between((gx, gy), (gx, gy + 1));
        cells.open_between((gx + 1, gy), (gx + 1, gy + 1));
    }
    let in_glade = |c: Cell| {
        glades
            .iter()
            .any(|&(gx, gy)| (gx..=gx + 1).contains(&c.0) && (gy..=gy + 1).contains(&c.1))
    };

    // Floors, and the walls between linked cells.
    let floor = |ground: &mut Vec<u8>, decor: &mut Vec<u8>, x: u16, y: u16| {
        decor[idx(x, y)] = d("none");
        ground[idx(x, y)] = g("moss");
    };
    for y in 0..CELLS {
        for x in 0..CELLS {
            let (tx, ty) = cell_tile(x, y);
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                floor(&mut ground, &mut decor, tx + dx, ty + dy);
            }
            if x + 1 < CELLS && cells.east[Cells::i(x, y)] {
                for dy in 0..2 {
                    floor(&mut ground, &mut decor, tx + 2, ty + dy);
                }
            }
            if y + 1 < CELLS && cells.south[Cells::i(x, y)] {
                for dx in 0..2 {
                    floor(&mut ground, &mut decor, tx + dx, ty + 2);
                }
            }
            // Inside a room (a glade, the chamber), the posts between its cells go too.
            let room = |c: Cell| in_glade(c) || in_chamber(c);
            if x + 1 < CELLS
                && y + 1 < CELLS
                && [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)]
                    .iter()
                    .all(|&c| room(c))
                && (in_chamber((x, y)) == in_chamber((x + 1, y + 1)))
                && cells.linked((x, y), (x + 1, y))
                && cells.linked((x, y), (x, y + 1))
                && cells.linked((x + 1, y), (x + 1, y + 1))
                && cells.linked((x, y + 1), (x + 1, y + 1))
            {
                floor(&mut ground, &mut decor, tx + 2, ty + 2);
            }
        }
    }
    // A glade: a little pool where its four cells meet; seats and mushrooms round it.
    for &(gx, gy) in &glades {
        let (tx, ty) = cell_tile(gx, gy);
        let (cx, cy) = (tx + 2, ty + 2);
        ground[idx(cx, cy)] = g("water");
        decor[idx(cx, cy)] = d("lilypad");
        for (sx, sy) in [(tx, ty), (tx + 4, ty + 4)] {
            decor[idx(sx, sy)] = d("log_seat");
        }
        for (mx, my) in [(tx + 4, ty), (tx, ty + 4), (tx + 2, ty), (tx + 2, ty + 4)] {
            decor[idx(mx, my)] = d("mushrooms");
        }
        for (fx, fy) in [(tx + 1, ty + 2), (tx + 3, ty + 2)] {
            ground[idx(fx, fy)] = g("grass_dark");
        }
    }
    // The chamber floor is old cobbles, round the Glowroot.
    let (chx, chy) = cell_tile(CHAMBER.0, CHAMBER.0);
    for y in chy..chy + 8 {
        for x in chx..chx + 8 {
            if decor[idx(x, y)] == d("none") {
                ground[idx(x, y)] = g("road");
            }
        }
    }

    let mut gates: Vec<Gate> = Vec::new();
    // The Great Gate: in the chamber's south wall, between its middle cell and the one below.
    let below = (mid.0, CHAMBER.1 + 1);
    gates.push(Gate {
        kind: GateKind::Great,
        tiles: wall_between((mid.0, CHAMBER.1), below),
        stones: vec![],
    });

    // Where things go, by steps from the stair.
    let dist = cells.distances(start);
    let all: Vec<Cell> = (0..CELLS)
        .flat_map(|y| (0..CELLS).map(move |x| (x, y)))
        .filter(|&c| !in_chamber(c))
        .collect();
    let mut taken: Vec<Cell> = vec![start, below];

    // Heartstones: the furthest cells in the north-west, the north-east and the southern corners.
    let regions: [&dyn Fn(Cell) -> bool; HEARTSTONES] = [
        &|c: Cell| c.0 <= 7 && c.1 <= 11,
        &|c: Cell| c.0 >= CELLS - 8 && c.1 <= 11,
        &|c: Cell| c.1 >= 15 && (c.0 <= 6 || c.0 >= CELLS - 7),
    ];
    let mut heartstones: Vec<Cell> = Vec::new();
    for ok in regions {
        let pick = furthest(&all, &dist, |c| {
            ok(c) && !in_glade(c) && !taken.contains(&c)
        })
        .unwrap_or((0, 0));
        heartstones.push(pick);
        taken.push(pick);
    }

    // Lost glimmers in the deepest dead ends, spread out.
    let mut by_depth = all.clone();
    by_depth.sort_by(|a, b| {
        dist[Cells::i(b.0, b.1)]
            .cmp(&dist[Cells::i(a.0, a.1)])
            .then((a.1, a.0).cmp(&(b.1, b.0)))
    });
    let mut glimmers: Vec<Cell> = Vec::new();
    for pass in 0..2 {
        for &c in &by_depth {
            if glimmers.len() == GLIMMERS {
                break;
            }
            let dead_end = cells.links(c.0, c.1).len() == 1;
            if (pass == 1 || dead_end)
                && !in_glade(c)
                && !taken.contains(&c)
                && glimmers.iter().all(|&q| manhattan(c, q) >= 5)
                && heartstones.iter().all(|&q| manhattan(c, q) >= 3)
            {
                glimmers.push(c);
            }
        }
    }
    taken.extend(&glimmers);

    // Root gates: walls between cells that are close as the crow flies but
    // far apart on foot, spread out. Timed and twin, turn about.
    let mut walls: Vec<(Cell, Cell)> = Vec::new();
    for &a in &all {
        for b in [(a.0 + 1, a.1), (a.0, a.1 + 1)] {
            if b.0 < CELLS && b.1 < CELLS && !in_chamber(b) && !cells.linked(a, b) {
                walls.push((a, b));
            }
        }
    }
    let saving = |w: &(Cell, Cell)| {
        let (da, db) = (dist[Cells::i(w.0.0, w.0.1)], dist[Cells::i(w.1.0, w.1.1)]);
        da.abs_diff(db)
    };
    walls.sort_by(|p, q| {
        saving(q)
            .cmp(&saving(p))
            .then((p.0.1, p.0.0).cmp(&(q.0.1, q.0.0)))
    });
    let mut roots: Vec<(Cell, Cell)> = Vec::new();
    for w in walls {
        if roots.len() == ROOT_GATES || saving(&w) < 20 {
            break;
        }
        let near = |c: Cell| manhattan(c, w.0) < 6 || manhattan(c, w.1) < 6;
        if roots.iter().any(|r| near(r.0)) || heartstones.iter().any(|&h| manhattan(h, w.0) < 3) {
            continue;
        }
        // The stone side is the one nearer the stair.
        let (a, b) = if dist[Cells::i(w.0.0, w.0.1)] <= dist[Cells::i(w.1.0, w.1.1)] {
            w
        } else {
            (w.1, w.0)
        };
        roots.push((a, b));
    }
    for (i, &(a, b)) in roots.iter().enumerate() {
        let (tx, ty) = cell_tile(a.0, a.1);
        if i % 2 == 0 {
            // Timed: the stone one cell back along the way you came, so it's a dash.
            let back = cells
                .links(a.0, a.1)
                .into_iter()
                .min_by_key(|c| dist[Cells::i(c.0, c.1)])
                .unwrap_or(a);
            let (sx, sy) = cell_tile(back.0, back.1);
            taken.push(back);
            gates.push(Gate {
                kind: GateKind::Timed,
                tiles: wall_between(a, b),
                stones: vec![(sx + (rng.below(2) as u16), sy + (rng.below(2) as u16))],
            });
        } else {
            // Twin: two stones side by side in front of it, a person on each.
            gates.push(Gate {
                kind: GateKind::Twin,
                tiles: wall_between(a, b),
                stones: vec![(tx, ty), (tx + 1, ty + 1)],
            });
        }
        taken.push(a);
    }

    // Sleeping lanterns at crossings, spread out (shuffled, so not all far off).
    let mut crossings: Vec<Cell> = all
        .iter()
        .copied()
        .filter(|&c| cells.links(c.0, c.1).len() >= 3 && !in_glade(c) && !taken.contains(&c))
        .collect();
    for i in (1..crossings.len()).rev() {
        let j = rng.below(i + 1);
        crossings.swap(i, j);
    }
    let mut lanterns: Vec<Cell> = Vec::new();
    for &c in &crossings {
        if lanterns.len() == LANTERNS {
            break;
        }
        if lanterns.iter().all(|&q| manhattan(c, q) >= 4) {
            lanterns.push(c);
        }
    }

    // Wisps: on the longest straight runs, away from the stair and each other.
    let mut runs: Vec<(Cell, Cell)> = Vec::new();
    for y in 0..CELLS {
        let mut x = 0;
        while x < CELLS {
            let x0 = x;
            while x + 1 < CELLS
                && cells.linked((x, y), (x + 1, y))
                && !in_chamber((x, y))
                && !in_chamber((x + 1, y))
            {
                x += 1;
            }
            if x - x0 >= 3 {
                runs.push(((x0, y), (x, y)));
            }
            x += 1;
        }
    }
    for x in 0..CELLS {
        let mut y = 0;
        while y < CELLS {
            let y0 = y;
            while y + 1 < CELLS
                && cells.linked((x, y), (x, y + 1))
                && !in_chamber((x, y))
                && !in_chamber((x, y + 1))
            {
                y += 1;
            }
            if y - y0 >= 3 {
                runs.push(((x, y0), (x, y)));
            }
            y += 1;
        }
    }
    let run_len = |r: &(Cell, Cell)| manhattan(r.0, r.1);
    runs.sort_by(|p, q| {
        run_len(q)
            .cmp(&run_len(p))
            .then((p.0.1, p.0.0).cmp(&(q.0.1, q.0.0)))
    });
    let mut wisps: Vec<(Cell, Cell)> = Vec::new();
    for r in runs {
        if wisps.len() == WISPS {
            break;
        }
        let mid_of = |r: &(Cell, Cell)| ((r.0.0 + r.1.0) / 2, (r.0.1 + r.1.1) / 2);
        let m = mid_of(&r);
        let near_start = manhattan(r.0, start).min(manhattan(r.1, start)) < 5;
        // (Not over quest spots or rune stones: nobody wants blowing away while they hold a gate.)
        let cells_of = |r: &(Cell, Cell)| -> Vec<Cell> {
            if r.0.1 == r.1.1 {
                (r.0.0..=r.1.0).map(|x| (x, r.0.1)).collect()
            } else {
                (r.0.1..=r.1.1).map(|y| (r.0.0, y)).collect()
            }
        };
        if near_start
            || cells_of(&r).iter().any(|c| taken.contains(c))
            || wisps.iter().any(|w| manhattan(mid_of(w), m) < 6)
            || heartstones.iter().any(|&h| manhattan(h, m) < 2)
        {
            continue;
        }
        wisps.push(r);
    }

    // ---- objects ----
    // The stair down (you arrive at its foot), lanterns either side.
    let (sx, sy) = cell_tile(start.0, start.1);
    for dx in 0..2 {
        floor(&mut ground, &mut decor, sx + dx, sy + 2);
        ground[idx(sx + dx, sy + 2)] = g("road");
        solid[idx(sx + dx, sy + 2)] = true;
    }
    objects.push(object(
        "lab_exit",
        sx,
        sy + 2,
        2,
        1,
        "The stair up to the hedge maze".into(),
    ));
    decor[idx(sx - 1, sy + 1)] = d("lantern");
    decor[idx(sx + 2, sy + 1)] = d("lantern");
    // The Glowroot, in the middle of the chamber.
    let (hx, hy) = cell_tile(mid.0, mid.1);
    objects.push(object("lab_heart", hx, hy, 2, 2, "The Glowroot".into()));
    for (i, &c) in heartstones.iter().enumerate() {
        let (tx, ty) = cell_tile(c.0, c.1);
        let (x, y) = (tx + (rng.below(2) as u16), ty);
        solid[idx(x, y)] = true;
        objects.push(object("lab_heartstone", x, y, 1, 1, i.to_string()));
    }
    for (i, &c) in glimmers.iter().enumerate() {
        let (tx, ty) = cell_tile(c.0, c.1);
        objects.push(object(
            "lab_glimmer",
            tx + (rng.below(2) as u16),
            ty + (rng.below(2) as u16),
            1,
            1,
            i.to_string(),
        ));
    }
    for (i, &c) in lanterns.iter().enumerate() {
        // In a corner of the crossing, so the way through stays wide.
        let (tx, ty) = cell_tile(c.0, c.1);
        let (x, y) = (tx + (rng.below(2) as u16), ty);
        solid[idx(x, y)] = true;
        objects.push(object("lab_lantern", x, y, 1, 1, i.to_string()));
    }
    for (i, gate) in gates.iter().enumerate() {
        let [(ax, ay), (bx, by)] = gate.tiles;
        for (x, y) in gate.tiles {
            floor(&mut ground, &mut decor, x, y);
            ground[idx(x, y)] = g("road");
            solid[idx(x, y)] = true;
        }
        let (x0, y0) = (ax.min(bx), ay.min(by));
        let (w, h) = (ax.abs_diff(bx) + 1, ay.abs_diff(by) + 1);
        objects.push(object(
            "lab_gate",
            x0,
            y0,
            w,
            h,
            format!("{i}:{}", gate.kind.name()),
        ));
        for &(x, y) in &gate.stones {
            // On open floor (a lantern or heartstone may have the corner it wanted).
            let (x, y) = [(x, y), (x ^ 1, y), (x, y ^ 1), (x ^ 1, y ^ 1)]
                .into_iter()
                .find(|&(x, y)| !solid[idx(x, y)] && decor[idx(x, y)] != d("lab_wall"))
                .unwrap_or((x, y));
            objects.push(object("lab_stone", x, y, 1, 1, i.to_string()));
        }
    }
    for &(a, b) in &wisps {
        // One lane of the corridor (the wisp weaves into the other).
        let (ax, ay) = cell_tile(a.0, a.1);
        let (bx, by) = cell_tile(b.0, b.1);
        let (w, h) = if ay == by {
            (bx - ax + 2, 1)
        } else {
            (1, by - ay + 2)
        };
        let phase = rng.below(60_000);
        objects.push(object("lab_wisp", ax, ay, w, h, phase.to_string()));
    }

    // Dressing on open floor: cobble patches, ferns, pebbles, mushrooms by the walls.
    let busy: Vec<TilePos> = objects
        .iter()
        .flat_map(|o| (o.y..o.y + o.h).flat_map(move |y| (o.x..o.x + o.w).map(move |x| (x, y))))
        .collect();
    let spawn = (sx, sy + 1);
    for y in 0..size {
        for x in 0..size {
            let i = idx(x, y);
            if decor[i] != d("none")
                || ground[i] != g("moss")
                || busy.contains(&(x, y))
                || (x, y) == spawn
            {
                continue;
            }
            let by_wall = [(0i32, -1i32), (0, 1), (-1, 0), (1, 0)]
                .iter()
                .any(|&(dx, dy)| {
                    decor[idx((x as i32 + dx) as u16, (y as i32 + dy) as u16)] == d("lab_wall")
                });
            match rng.below(100) {
                0..=9 => ground[i] = g("road"),
                10..=12 if by_wall => decor[i] = d("mushrooms"),
                13..=14 => decor[i] = d("fern"),
                15..=17 => decor[i] = d("pebbles"),
                18 => ground[i] = g("grass_dark"),
                _ => {}
            }
        }
    }

    let walk: Vec<u8> = WALK_DECOR.iter().map(|k| d(k)).collect();
    let collision = (0..n)
        .map(|i| (solid[i] || ground[i] == g("water") || !walk.contains(&decor[i])) as u8)
        .collect();
    MapFile {
        name: "The Glowroot Labyrinth".into(),
        width: size,
        height: size,
        spawn: Spawn {
            x: spawn.0,
            y: spawn.1,
        },
        ground_legend: GROUND.iter().map(|s| s.to_string()).collect(),
        decor_legend: DECOR.iter().map(|s| s.to_string()).collect(),
        ground,
        decor,
        collision,
        objects,
        streets: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::find_path;

    #[test]
    fn same_day_same_maze_and_days_differ() {
        let a = generate(20_400);
        let b = generate(20_400);
        let c = generate(20_401);
        assert_eq!(a.collision, b.collision);
        assert_ne!(a.collision, c.collision);
    }

    #[test]
    fn everything_is_reachable_and_the_heart_only_through_the_great_gate() {
        for day in 20_390..20_420 {
            let m = generate(day);
            let json = serde_json::to_string(&m).unwrap();
            let m = MapFile::from_json(&json).expect("valid map");
            let mut grid = m.grid();
            let from = (m.spawn.x, m.spawn.y);
            let count = |k: &str| m.objects.iter().filter(|o| o.kind == k).count();
            assert_eq!(count("lab_glimmer"), GLIMMERS, "day {day}");
            assert_eq!(count("lab_heartstone"), HEARTSTONES, "day {day}");
            assert!(count("lab_lantern") >= 12, "day {day}: lanterns");
            assert!(count("lab_wisp") >= 6, "day {day}: wisps");
            assert!(count("lab_gate") >= 4, "day {day}: gates");
            let reach = |grid: &crate::Grid, t: TilePos| {
                let to = grid.nearest_walkable(t, 1).unwrap();
                find_path(grid, from, to, 200_000).is_some()
            };
            // With every gate shut, everything but the Glowroot is reachable.
            for o in m.objects.iter().filter(|o| {
                matches!(
                    o.kind.as_str(),
                    "lab_glimmer" | "lab_heartstone" | "lab_lantern" | "lab_stone"
                )
            }) {
                assert!(
                    reach(&grid, (o.x, o.y)),
                    "day {day}: {} at {},{}",
                    o.kind,
                    o.x,
                    o.y
                );
            }
            let heart = m.objects.iter().find(|o| o.kind == "lab_heart").unwrap();
            assert!(
                !reach(&grid, (heart.x, heart.y)),
                "day {day}: the heart without the gate"
            );
            // The Great Gate open, it is.
            let great = m
                .objects
                .iter()
                .find(|o| {
                    o.kind == "lab_gate"
                        && o.label.as_deref().is_some_and(|l| l.ends_with(":great"))
                })
                .unwrap();
            for y in great.y..great.y + great.h {
                for x in great.x..great.x + great.w {
                    grid.set_blocked(x, y, false);
                }
            }
            assert!(
                reach(&grid, (heart.x, heart.y)),
                "day {day}: the heart through the gate"
            );
            // Wisps keep to their corridor: both its lanes are floor, all along.
            for o in m.objects.iter().filter(|o| o.kind == "lab_wisp") {
                let (w, h) = if o.w >= o.h { (o.w, 2) } else { (2, o.h) };
                for y in o.y..o.y + h {
                    for x in o.x..o.x + w {
                        let wall = m.decor_legend
                            [m.decor[y as usize * m.width as usize + x as usize] as usize]
                            == "lab_wall";
                        assert!(!wall, "day {day}: wisp over a wall at {x},{y}");
                    }
                }
            }
        }
    }

    /// The client moves wisps with the same sums (`client/src/labyrinth.ts`, `wispAt`, whose test has these numbers too).
    #[test]
    fn wisps_are_where_the_client_draws_them() {
        let o = |x, y, w, h, l: &str| MapObject {
            kind: "lab_wisp".into(),
            x,
            y,
            w,
            h,
            label: Some(l.into()),
        };
        for ((wx, wy), (ex, ey)) in [
            (
                wisp_at(&o(10, 20, 11, 1, "1234"), 5000),
                (19.974400000000003, 20.98442918699556),
            ),
            (
                wisp_at(&o(4, 7, 1, 14, "59999"), 123_456_789),
                (4.024060406216181, 7.860800000000745),
            ),
        ] {
            assert!(
                (wx - ex).abs() < 1e-9 && (wy - ey).abs() < 1e-9,
                "{wx},{wy}"
            );
        }
    }

    #[test]
    fn wisps_stay_on_their_corridor() {
        let o = MapObject {
            kind: "lab_wisp".into(),
            x: 10,
            y: 20,
            w: 11,
            h: 1,
            label: Some("1234".into()),
        };
        for t in (0..120_000).step_by(250) {
            let (x, y) = wisp_at(&o, t);
            assert!(
                (10.0..=20.0).contains(&x) && (20.0..=21.0).contains(&y),
                "{t}: {x},{y}"
            );
        }
    }
}
