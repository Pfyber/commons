//! Deterministic 8-directional A* without corner cutting.

use crate::TilePos;
use crate::map::Grid;
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
    let n = grid.w as usize * grid.h as usize;
    let mut g = vec![u32::MAX; n];
    let mut parent = vec![u32::MAX; n];
    let mut closed = vec![false; n];
    // Ordered by (f, h, insertion seq) for a total, platform-independent order.
    let mut open: BinaryHeap<Reverse<(u32, u32, u32, u32)>> = BinaryHeap::new();
    let mut seq = 0u32;

    let start = grid.idx(from.0, from.1);
    let goal = grid.idx(to.0, to.1);
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
                out.push(((i % grid.w as usize) as u16, (i / grid.w as usize) as u16));
            }
            out.reverse();
            return Some(out);
        }
        closed[cur] = true;
        expansions += 1;
        if expansions > max_expansions {
            return None;
        }
        let (cx, cy) = (
            (cur % grid.w as usize) as i32,
            (cur / grid.w as usize) as i32,
        );
        for (dx, dy) in DIRS {
            let (nx, ny) = (cx + dx, cy + dy);
            if !grid.walkable_i(nx, ny) {
                continue;
            }
            let diagonal = dx != 0 && dy != 0;
            if diagonal && (!grid.walkable_i(cx + dx, cy) || !grid.walkable_i(cx, cy + dy)) {
                continue;
            }
            let ni = ny as usize * grid.w as usize + nx as usize;
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
}
