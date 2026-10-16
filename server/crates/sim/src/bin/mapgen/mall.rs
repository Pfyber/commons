//! The Commons Mall's floor (ADR 0011): one big storey behind the Market
//! Hall's front door. A food court fills the middle; a walking loop runs
//! round it; shops from `assets/mall/departments.json` line the outside, each
//! with walls, a doorway onto the loop and a sign. The entrance hall at the
//! bottom has the directory map and the seasonal pop-up stand.

use super::Builder;
use commons_sim::map::MapFile;
use serde::Deserialize;
use std::collections::VecDeque;

type Tile = (u16, u16);

const DEPARTMENTS: &str = include_str!("../../../../../../assets/mall/departments.json");

const W: u16 = 96;
const H: u16 = 80;
/// The loop and the food court inside it.
const LOOP: (u16, u16, u16, u16) = (24, 19, 71, 60);
/// Concourses along the top and bottom rows of shops, joining the loop.
const CONCOURSES: [(u16, u16, u16, u16); 2] = [(2, 19, 93, 22), (2, 57, 93, 60)];
/// The food court (atrium), inside the loop.
const ATRIUM: (u16, u16, u16, u16) = (28, 23, 67, 56);
/// The entrance hall, open to the loop.
const HALL: (u16, u16, u16, u16) = (36, 61, 59, 78);

#[derive(Deserialize)]
struct Departments {
    departments: Vec<Department>,
}

#[derive(Deserialize)]
struct Department {
    key: String,
    name: String,
    unit: [u16; 4],
    door: String,
    open: bool,
}

fn rect(b: &mut Builder, (x0, y0, x1, y1): (u16, u16, u16, u16), ground: &str) {
    for y in y0..=y1 {
        for x in x0..=x1 {
            b.ground(x, y, ground);
            b.decor(x, y, "none");
        }
    }
}

pub fn mall() -> MapFile {
    let deps: Departments = serde_json::from_str(DEPARTMENTS).expect("departments.json");
    let mut b = Builder::new(W, H);
    // Solid to start with; then the open spaces are carved out.
    for y in 0..H {
        for x in 0..W {
            b.ground(x, y, "floor");
            b.decor(x, y, "wall");
        }
    }
    rect(&mut b, LOOP, "plaza");
    for c in CONCOURSES {
        rect(&mut b, c, "plaza");
    }
    rect(&mut b, HALL, "plaza");

    for d in &deps.departments {
        let [x0, y0, x1, y1] = d.unit;
        assert!(x1 < W - 1 && y1 < H - 1, "{} is off the floor", d.key);
        rect(&mut b, (x0 + 1, y0 + 1, x1 - 1, y1 - 1), "floor");
        // A four-tile doorway in the middle of the wall facing the loop, and
        // the shop's sign just outside it.
        let (cx, cy) = ((x0 + x1) / 2, (y0 + y1) / 2);
        let (door, sign, front): (Vec<Tile>, Tile, Tile) = match d.door.as_str() {
            "s" => (
                (cx - 1..cx + 3).map(|x| (x, y1)).collect(),
                (cx + 3, y1 + 1),
                (cx, y1 + 2),
            ),
            "n" => (
                (cx - 1..cx + 3).map(|x| (x, y0)).collect(),
                (cx + 3, y0 - 1),
                (cx, y0 - 2),
            ),
            "e" => (
                (cy - 1..cy + 3).map(|y| (x1, y)).collect(),
                (x1 + 1, cy + 3),
                (x1 + 2, cy),
            ),
            "w" => (
                (cy - 1..cy + 3).map(|y| (x0, y)).collect(),
                (x0 - 1, cy + 3),
                (x0 - 2, cy),
            ),
            other => panic!("{}: door must be n, s, e or w, not {other}", d.key),
        };
        for (x, y) in door {
            b.ground(x, y, "plaza");
            b.decor(x, y, "none");
        }
        b.object("shopfront", sign.0, sign.1, 1, 1, Some(&d.name), true);
        b.object(
            "dept",
            x0,
            y0,
            x1 - x0 + 1,
            y1 - y0 + 1,
            Some(&d.key),
            false,
        );
        b.object(
            "spot",
            front.0,
            front.1,
            1,
            1,
            Some(&format!("dept:{}", d.key)),
            false,
        );
        // Until a shop opens, its counter says so.
        let label = if d.open {
            d.name.clone()
        } else {
            format!("{}: opening soon", d.name)
        };
        b.object("counter", cx - 1, cy, 3, 1, Some(&label), true);
    }

    // The food court: planters round the edge with gaps to walk through,
    // and café tables with a bench either side.
    let (ax0, ay0, ax1, ay1) = ATRIUM;
    for x in ax0..=ax1 {
        for y in [ay0, ay1] {
            if (x - ax0) % 6 < 2 {
                b.ground(x, y, "flowers");
                b.decor(x, y, "bush");
            }
        }
    }
    for y in ay0..=ay1 {
        for x in [ax0, ax1] {
            if (y - ay0) % 6 < 2 {
                b.ground(x, y, "flowers");
                b.decor(x, y, "bush");
            }
        }
    }
    for (i, y) in (ay0 + 4..ay1 - 2).step_by(5).enumerate() {
        let shift = if i % 2 == 0 { 0 } else { 3 };
        for x in (ax0 + 4 + shift..ax1 - 3).step_by(7) {
            b.decor(x - 1, y, "bench");
            b.decor(x, y, "cafe_table");
            b.decor(x + 1, y, "bench");
        }
    }
    // A big tree in the middle, under the skylight.
    let (mx, my) = ((ax0 + ax1) / 2, (ay0 + ay1) / 2);
    for y in my - 1..=my + 1 {
        for x in mx - 1..=mx + 1 {
            b.ground(x, y, "flowers");
            b.decor(x, y, "none");
        }
    }
    b.decor(mx, my, "tree");
    b.object("spot", mx, my + 3, 1, 1, Some("food_court"), false);

    // The entrance hall: the way out, the directory and the pop-up stand.
    let (hx0, _, hx1, hy1) = HALL;
    let door_x = (hx0 + hx1) / 2 - 1;
    b.object("mall_exit", door_x, hy1, 4, 1, Some("To the Market"), true);
    b.object("spot", door_x + 1, hy1 - 2, 1, 1, Some("entrance"), false);
    b.object("mall_directory", hx0 + 3, 70, 2, 1, Some("Directory"), true);
    b.object(
        "popup",
        hx1 - 8,
        64,
        6,
        3,
        Some("Seasonal pop-up: coming soon"),
        true,
    );
    for (x, y) in [(hx0 + 1, 63), (hx1 - 1, 74), (hx0 + 1, 74)] {
        b.ground(x, y, "flowers");
        b.decor(x, y, "tree");
    }

    let map = b.finish("Commons Mall", (door_x + 1, hy1 - 3));
    check(&map);
    map
}

/// Every spot can be walked to from the entrance, and so can each shop.
fn check(map: &MapFile) {
    let grid = map.grid();
    let w = map.width as usize;
    let mut seen = vec![false; w * map.height as usize];
    let start = (map.spawn.x, map.spawn.y);
    seen[start.1 as usize * w + start.0 as usize] = true;
    let mut q = VecDeque::from([start]);
    while let Some((x, y)) = q.pop_front() {
        for (dx, dy) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if grid.walkable_i(nx, ny) && !seen[ny as usize * w + nx as usize] {
                seen[ny as usize * w + nx as usize] = true;
                q.push_back((nx as u16, ny as u16));
            }
        }
    }
    for o in &map.objects {
        let ok = match o.kind.as_str() {
            "spot" => seen[o.y as usize * w + o.x as usize],
            "dept" => (o.y..o.y + o.h)
                .any(|y| (o.x..o.x + o.w).any(|x| seen[y as usize * w + x as usize])),
            _ => continue,
        };
        assert!(ok, "mall: {} {:?} can't be reached", o.kind, o.label);
    }
}
