//! Deterministic 8-directional A* without corner cutting.

use crate::TilePos;
use crate::map::{Grid, StreetGrid};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

const STRAIGHT: u32 = 10;
const DIAGONAL: u32 = 14;

/// Fixed neighbour order; part of the determinism contract.
const DIRS: [(i32, i32); 8] = [
    (1, 0),
    (0, 1),
    (-1, 0),
    (0, -1),
    (1, 1),
    (-1, 1),
    (-1, -1),
    (1, -1),
];

fn octile(a: TilePos, b: TilePos) -> u32 {
    let dx = (a.0 as i32 - b.0 as i32).unsigned_abs();
    let dy = (a.1 as i32 - b.1 as i32).unsigned_abs();
    STRAIGHT * dx.max(dy) + (DIAGONAL - STRAIGHT) * dx.min(dy)
}

/// Maps up to this many tiles are searched whole; bigger ones (the city) only
/// within the box around both ends plus [`WINDOW_MARGIN`], so a short walk
/// never allocates the whole map.
const WHOLE_MAP_TILES: usize = 128 * 128;
const WINDOW_MARGIN: u16 = 24;
/// On a city map, walks longer than this (Chebyshev, in tiles) follow the streets.
pub const LONG_WALK: u16 = 40;

/// The search box: `(x0, y0, w, h)`.
fn window(grid: &Grid, a: TilePos, b: TilePos) -> (u16, u16, u16, u16) {
    if grid.w as usize * grid.h as usize <= WHOLE_MAP_TILES {
        return (0, 0, grid.w, grid.h);
    }
    let x0 = a.0.min(b.0).saturating_sub(WINDOW_MARGIN);
    let y0 = a.1.min(b.1).saturating_sub(WINDOW_MARGIN);
    let x1 = (a.0.max(b.0) + WINDOW_MARGIN).min(grid.w - 1);
    let y1 = (a.1.max(b.1) + WINDOW_MARGIN).min(grid.h - 1);
    (x0, y0, x1 - x0 + 1, y1 - y0 + 1)
}

/// Finds a tile-by-tile path from `from` to `to` (both inclusive). Gives up
/// after `max_expansions` nodes so a hostile request can't burn the tick.
pub fn find_path(
    grid: &Grid,
    from: TilePos,
    to: TilePos,
    max_expansions: usize,
) -> Option<Vec<TilePos>> {
    if !grid.walkable(from.0, from.1) || !grid.walkable(to.0, to.1) {
        return None;
    }
    if from == to {
        return Some(vec![from]);
    }
    let (wx, wy, ww, wh) = window(grid, from, to);
    let (wx, wy, ww, wh) = (wx as i32, wy as i32, ww as i32, wh as i32);
    let open_at =
        |x: i32, y: i32| x >= wx && y >= wy && x < wx + ww && y < wy + wh && grid.walkable_i(x, y);
    let local = |x: i32, y: i32| ((y - wy) * ww + (x - wx)) as usize;
    let at = |i: usize| (wx + (i % ww as usize) as i32, wy + (i / ww as usize) as i32);
    let n = ww as usize * wh as usize;
    let mut g = vec![u32::MAX; n];
    let mut parent = vec![u32::MAX; n];
    let mut closed = vec![false; n];
    // Ordered by (f, h, insertion seq) for a total, platform-independent order.
    let mut open: BinaryHeap<Reverse<(u32, u32, u32, u32)>> = BinaryHeap::new();
    let mut seq = 0u32;

    let start = local(from.0 as i32, from.1 as i32);
    let goal = local(to.0 as i32, to.1 as i32);
    g[start] = 0;
    open.push(Reverse((
        octile(from, to),
        octile(from, to),
        seq,
        start as u32,
    )));

    let mut expansions = 0;
    while let Some(Reverse((_, _, _, cur))) = open.pop() {
        let cur = cur as usize;
        if closed[cur] {
            continue;
        }
        if cur == goal {
            let mut out = vec![to];
            let mut i = cur;
            while parent[i] != u32::MAX {
                i = parent[i] as usize;
                let (x, y) = at(i);
                out.push((x as u16, y as u16));
            }
            out.reverse();
            return Some(out);
        }
        closed[cur] = true;
        expansions += 1;
        if expansions > max_expansions {
            return None;
        }
        let (cx, cy) = at(cur);
        for (dx, dy) in DIRS {
            let (nx, ny) = (cx + dx, cy + dy);
            if !open_at(nx, ny) {
                continue;
            }
            let diagonal = dx != 0 && dy != 0;
            if diagonal && (!open_at(cx + dx, cy) || !open_at(cx, cy + dy)) {
                continue;
            }
            let ni = local(nx, ny);
            if closed[ni] {
                continue;
            }
            let ng = g[cur] + if diagonal { DIAGONAL } else { STRAIGHT };
            if ng < g[ni] {
                g[ni] = ng;
                parent[ni] = cur as u32;
                let h = octile((nx as u16, ny as u16), to);
                seq += 1;
                open.push(Reverse((ng + h, h, seq, ni as u32)));
            }
        }
    }
    None
}

/// The path a walk takes. On a city map a long walk heads to a street
/// crossing near the start, follows street centre lines (along x, then y)
/// to a crossing near the goal, and walks in from there; anything else, or
/// a street route that fails, is a plain [`find_path`].
pub fn route(
    grid: &Grid,
    from: TilePos,
    to: TilePos,
    max_expansions: usize,
) -> Option<Vec<TilePos>> {
    let cheb = from.0.abs_diff(to.0).max(from.1.abs_diff(to.1));
    if let Some(streets) = grid.streets.filter(|_| cheb > LONG_WALK)
        && let Some(p) = street_route(grid, &streets, from, to, max_expansions)
    {
        return Some(p);
    }
    find_path(grid, from, to, max_expansions)
}

/// Street crossings at the corners of the street cell around `p`.
fn crossings(s: &StreetGrid, p: TilePos) -> Vec<TilePos> {
    let mut out = Vec::with_capacity(4);
    for ky in s.lanes_around(p.1) {
        for kx in s.lanes_around(p.0) {
            let c = (s.lane(kx), s.lane(ky));
            if !out.contains(&c) {
                out.push(c);
            }
        }
    }
    out
}

fn street_route(
    grid: &Grid,
    s: &StreetGrid,
    from: TilePos,
    to: TilePos,
    max_expansions: usize,
) -> Option<Vec<TilePos>> {
    let manhattan =
        |a: TilePos, b: TilePos| STRAIGHT * (a.0.abs_diff(b.0) as u32 + a.1.abs_diff(b.1) as u32);
    let mut best: Option<(u32, TilePos, TilePos)> = None;
    for e in crossings(s, from) {
        for x in crossings(s, to) {
            let cost = octile(from, e) + manhattan(e, x) + octile(x, to);
            if best.is_none_or(|(c, _, _)| cost < c) {
                best = Some((cost, e, x));
            }
        }
    }
    let (_, e, x) = best?;
    let mut out = find_path(grid, from, e, max_expansions)?;
    let mut cur = e;
    while cur != x {
        cur = if cur.0 != x.0 {
            (if cur.0 < x.0 { cur.0 + 1 } else { cur.0 - 1 }, cur.1)
        } else {
            (cur.0, if cur.1 < x.1 { cur.1 + 1 } else { cur.1 - 1 })
        };
        if !grid.walkable(cur.0, cur.1) {
            return None;
        }
        out.push(cur);
    }
    let tail = find_path(grid, x, to, max_expansions)?;
    out.extend_from_slice(&tail[1..]);
    Some(out)
}

/// Keeps only the endpoints and the tiles where direction changes, so straight
/// runs collapse into a single segment.
pub fn compress(path: &[TilePos]) -> Vec<TilePos> {
    if path.len() <= 2 {
        return path.to_vec();
    }
    let dir = |a: TilePos, b: TilePos| {
        (
            (b.0 as i32 - a.0 as i32).signum(),
            (b.1 as i32 - a.1 as i32).signum(),
        )
    };
    let mut out = vec![path[0]];
    for w in path.windows(3) {
        if dir(w[0], w[1]) != dir(w[1], w[2]) {
            out.push(w[1]);
        }
    }
    out.push(*path.last().unwrap());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn straight_line_compresses_to_two_nodes() {
        let g = Grid::open(10, 10);
        let p = find_path(&g, (0, 0), (9, 0), 1000).unwrap();
        assert_eq!(p.len(), 10);
        assert_eq!(compress(&p), vec![(0, 0), (9, 0)]);
    }

    #[test]
    fn routes_around_walls_without_cutting_corners() {
        let mut g = Grid::open(5, 5);
        for y in 0..4 {
            g.set_blocked(2, y, true);
        }
        let p = find_path(&g, (0, 0), (4, 0), 1000).unwrap();
        assert!(p.iter().all(|&(x, y)| g.walkable(x, y)));
        for w in p.windows(2) {
            let (dx, dy) = (w[1].0 as i32 - w[0].0 as i32, w[1].1 as i32 - w[0].1 as i32);
            assert!(dx.abs() <= 1 && dy.abs() <= 1);
            if dx != 0 && dy != 0 {
                assert!(g.walkable_i(w[0].0 as i32 + dx, w[0].1 as i32));
                assert!(g.walkable_i(w[0].0 as i32, w[0].1 as i32 + dy));
            }
        }
        assert!(p.contains(&(2, 4)));
    }

    #[test]
    fn unreachable_and_blocked_targets() {
        let mut g = Grid::open(5, 5);
        for y in 0..5 {
            g.set_blocked(2, y, true);
        }
        assert_eq!(find_path(&g, (0, 0), (4, 4), 1000), None);
        assert_eq!(find_path(&g, (0, 0), (2, 2), 1000), None);
    }

    #[test]
    fn deterministic() {
        let g = Grid::open(40, 40);
        let a = find_path(&g, (1, 1), (30, 17), 10_000);
        assert_eq!(a, find_path(&g, (1, 1), (30, 17), 10_000));
        assert_eq!(compress(&a.unwrap()), vec![(1, 1), (17, 17), (30, 17)]);
    }

    /// A 3 × 3 city of 20-tile blocks with 4-tile streets; each block is
    /// walled except for a gap in the middle of its south side. The client's
    /// path.test.ts builds the same city and expects the same route.
    fn walled_city() -> Grid {
        let s = StreetGrid {
            block_tiles: 20,
            street_tiles: 4,
            blocks: 3,
        };
        let size = s.blocks * s.pitch() + s.street_tiles;
        let mut g = Grid::open(size, size);
        g.streets = Some(s);
        for by in 0..3 {
            for bx in 0..3 {
                let (x0, y0) = (4 + bx * s.pitch(), 4 + by * s.pitch());
                for i in 0..20 {
                    g.set_blocked(x0 + i, y0, true);
                    g.set_blocked(x0, y0 + i, true);
                    g.set_blocked(x0 + 19, y0 + i, true);
                    if i != 10 {
                        g.set_blocked(x0 + i, y0 + 19, true);
                    }
                }
            }
        }
        g
    }

    #[test]
    fn long_city_walks_follow_the_streets() {
        let g = walled_city();
        let p = route(&g, (10, 10), (66, 62), 12_000).unwrap();
        assert_eq!(p[0], (10, 10));
        assert_eq!(*p.last().unwrap(), (66, 62));
        assert!(p.iter().all(|&(x, y)| g.walkable(x, y)));
        for w in p.windows(2) {
            assert!(w[0].0.abs_diff(w[1].0) <= 1 && w[0].1.abs_diff(w[1].1) <= 1);
            assert_ne!(w[0], w[1]);
        }
        // Out through the south gap, along street centre lines, in through a gap.
        assert!(p.contains(&(14, 23)));
        assert!(p.contains(&(26, 26)));
        assert_eq!(
            compress(&p),
            [
                (10, 10),
                (14, 14),
                (14, 24),
                (16, 26),
                (50, 26),
                (50, 50),
                (51, 51),
                (51, 72),
                (62, 72),
                (62, 70),
                (66, 66),
                (66, 62)
            ]
        );
        // Short walks are plain A*.
        assert_eq!(
            route(&g, (2, 2), (30, 2), 12_000),
            find_path(&g, (2, 2), (30, 2), 12_000)
        );
    }

    #[test]
    fn big_maps_search_a_window_around_the_walk() {
        let mut g = Grid::open(300, 300);
        for y in 0..40 {
            g.set_blocked(150, y, true);
        }
        let p = find_path(&g, (140, 30), (160, 30), 12_000).unwrap();
        assert!(p.iter().all(|&(x, y)| y <= 54 && (116..=184).contains(&x)));
        assert!(p.contains(&(150, 40)));
        // A wall longer than the window can't be walked around.
        for y in 40..300 {
            g.set_blocked(150, y, true);
        }
        g.set_blocked(150, 299, false);
        assert_eq!(find_path(&g, (140, 30), (160, 30), 12_000), None);
    }
}
