import { describe, expect, it } from "vitest";
import type { ZoneMap } from "./map";
import { splice } from "./motion";
import { compress, findPath } from "./path";

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
});
