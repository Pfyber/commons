// Zone map file (assets/maps/*.json, produced by `cargo run -p commons-sim --bin mapgen`).

import type { TileXY } from "./motion";

export interface MapObject {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

/** The street grid of a city map (mirror of sim::map::StreetGrid). */
export interface StreetGrid {
  block_tiles: number;
  street_tiles: number;
  /** Blocks per side. */
  blocks: number;
}

export interface ZoneMap {
  name: string;
  width: number;
  height: number;
  spawn: TileXY;
  ground_legend: string[];
  decor_legend: string[];
  ground: number[];
  decor: number[];
  collision: number[];
  objects: MapObject[];
  /** Present on city maps. */
  streets?: StreetGrid;
}

/** A named place on the map (an invisible `spot` object), e.g. "pier". */
export function spot(m: ZoneMap, key: string): TileXY | null {
  const o = m.objects.find((o) => o.kind === "spot" && o.label === key);
  return o ? { x: o.x, y: o.y } : null;
}

export function walkable(m: ZoneMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height && m.collision[y * m.width + x] === 0;
}

export function groundAt(m: ZoneMap, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
  return m.ground_legend[m.ground[y * m.width + x]];
}

/** Closest walkable tile to (x, y) within `radius`, searching outward. */
export function nearestWalkable(m: ZoneMap, x: number, y: number, radius: number): TileXY | null {
  if (walkable(m, x, y)) return { x, y };
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (walkable(m, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/**
 * Farthest tile up to `steps` away in direction (dx, dy) reachable in a straight
 * line, honouring the server's no-corner-cutting rule. Used for keyboard walking.
 */
export function stepTarget(m: ZoneMap, from: TileXY, dx: number, dy: number, steps: number): TileXY | null {
  let cur = from;
  let best: TileXY | null = null;
  for (let i = 0; i < steps; i++) {
    const nx = cur.x + dx;
    const ny = cur.y + dy;
    if (!walkable(m, nx, ny)) break;
    if (dx !== 0 && dy !== 0 && (!walkable(m, cur.x + dx, cur.y) || !walkable(m, cur.x, cur.y + dy))) break;
    cur = { x: nx, y: ny };
    best = cur;
  }
  return best;
}
