import { describe, expect, it } from "vitest";
import type { ZoneMap } from "./map";
import { splice } from "./motion";
import { compress, findPath, route } from "./path";

function open(w: number, h: number, blocked: [number, number][] = []): ZoneMap {
  const collision = new Array(w * h).fill(0);
  for (const [x, y] of blocked) collision[y * w + x] = 1;
  return { name: "t", width: w, height: h, spawn: { x: 0, y: 0 }, ground_legend: [], decor_legend: [], ground: [], decor: [], collision, objects: [] };
}

describe("path mirrors sim::path", () => {
  it("matches the Rust deterministic case", () => {
    const p = findPath(open(40, 40), { x: 1, y: 1 }, { x: 30, y: 17 })!;
    expect(compress(p)).toEqual([{ x: 1, y: 1 }, { x: 17, y: 17 }, { x: 30, y: 17 }]);
  });

  it("routes around walls and rejects unreachable targets", () => {
    const wall: [number, number][] = [[2, 0], [2, 1], [2, 2], [2, 3]];
    const p = findPath(open(5, 5, wall), { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(p.some((t) => t.x === 2 && t.y === 4)).toBe(true);
    const full: [number, number][] = [...wall, [2, 4]];
    expect(findPath(open(5, 5, full), { x: 0, y: 0 }, { x: 4, y: 4 })).toBeNull();
  });
});

describe("splice mirrors sim::Motion::splice", () => {
  const m = { path: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 7, y: 3 }], t0: 1000, speedX10: 40 };
  it("matches the Rust case", () => {
    expect(splice(m, 1000)).toBeNull();
    expect(splice(m, 1600)).toEqual({ prev: { x: 2, y: 0 }, next: { x: 3, y: 0 }, tPrev: 1500 });
    const s = splice(m, 2400)!;
    expect([s.prev, s.next]).toEqual([{ x: 5, y: 1 }, { x: 6, y: 2 }]);
    expect(splice(m, 9999)).toBeNull();
  });

  it("routes long city walks along the streets, exactly like the server", () => {
    // Same walled 3×3 city as sim::path::tests::walled_city.
    const s = { block_tiles: 20, street_tiles: 4, blocks: 3 };
    const size = 3 * 24 + 4;
    const collision = new Array(size * size).fill(0);
    for (let by = 0; by < 3; by++) {
      for (let bx = 0; bx < 3; bx++) {
        const x0 = 4 + bx * 24;
        const y0 = 4 + by * 24;
        for (let i = 0; i < 20; i++) {
          collision[y0 * size + x0 + i] = 1;
          collision[(y0 + i) * size + x0] = 1;
          collision[(y0 + i) * size + x0 + 19] = 1;
          if (i !== 10) collision[(y0 + 19) * size + x0 + i] = 1;
        }
      }
    }
    const m = { ...open(size, size), collision, streets: s };
    const p = route(m, { x: 10, y: 10 }, { x: 66, y: 62 })!;
    const want = [[10, 10], [14, 14], [14, 24], [16, 26], [50, 26], [50, 50], [51, 51], [51, 72], [62, 72], [62, 70], [66, 66], [66, 62]];
    expect(compress(p).map((t) => [t.x, t.y])).toEqual(want);
  });

  it("searches big maps within a window around the walk", () => {
    const m = open(300, 300);
    for (let y = 0; y < 40; y++) m.collision[y * 300 + 150] = 1;
    const p = findPath(m, { x: 140, y: 30 }, { x: 160, y: 30 })!;
    expect(p.every((t) => t.y <= 54)).toBe(true);
    for (let y = 40; y < 299; y++) m.collision[y * 300 + 150] = 1;
    expect(findPath(m, { x: 140, y: 30 }, { x: 160, y: 30 })).toBeNull();
  });
});
