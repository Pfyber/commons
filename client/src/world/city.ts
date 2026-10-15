// The city grid: blocks separated by streets (ADR 0010). Mirror of
// server/crates/sim/src/city.rs; the tests check both agree.

export interface Geometry {
  blockTiles: number;
  streetTiles: number;
  /** Blocks per side. */
  blocks: number;
  cellTiles: number;
}

export interface BlockId {
  bx: number;
  by: number;
}

export interface LocalTile {
  block: BlockId;
  x: number;
  y: number;
}

export const pitch = (g: Geometry) => g.blockTiles + g.streetTiles;

/** Tiles per side of the whole city, outer streets included. */
export const citySize = (g: Geometry) => g.blocks * pitch(g) + g.streetTiles;

export const blockKey = (b: BlockId) => `b${b.bx}_${b.by}`;

export function blockOrigin(g: Geometry, b: BlockId): { x: number; y: number } {
  return { x: g.streetTiles + b.bx * pitch(g), y: g.streetTiles + b.by * pitch(g) };
}

export function toGlobal(g: Geometry, l: LocalTile): { x: number; y: number } {
  const o = blockOrigin(g, l.block);
  return { x: o.x + l.x, y: o.y + l.y };
}

function axis(g: Geometry, v: number): [number, number] | null {
  const p = pitch(g);
  const off = v % p;
  const b = Math.floor(v / p);
  return off >= g.streetTiles && b < g.blocks ? [b, off - g.streetTiles] : null;
}

/** The block-local tile at global (x, y), or null on a street. */
export function localAt(g: Geometry, x: number, y: number): LocalTile | null {
  const ax = axis(g, x);
  const ay = axis(g, y);
  if (!ax || !ay) return null;
  return { block: { bx: ax[0], by: ay[0] }, x: ax[1], y: ay[1] };
}

/** The block whose zone has authority over (x, y): streets split down the middle. */
export function ownerAt(g: Geometry, x: number, y: number): BlockId {
  const half = g.streetTiles / 2;
  const p = pitch(g);
  const a = (v: number) => Math.min(g.blocks - 1, Math.floor(Math.max(0, v - half) / p));
  return { bx: a(x), by: a(y) };
}

/** Blocks within `radius` tiles of (x, y): what to have loaded around a player. */
export function blocksNear(g: Geometry, x: number, y: number, radius: number): BlockId[] {
  const size = citySize(g);
  const out = new Map<string, BlockId>();
  for (const yy of [Math.max(0, y - radius), y, Math.min(size - 1, y + radius)]) {
    for (const xx of [Math.max(0, x - radius), x, Math.min(size - 1, x + radius)]) {
      const b = ownerAt(g, xx, yy);
      out.set(blockKey(b), b);
    }
  }
  return [...out.values()];
}
