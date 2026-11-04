import { describe, expect, it } from "vitest";
import { SKATE_SPEED_X10, SPRINT_SPEED_X10, VESPA_SPEED_X10, durationMs, endT, headingAt, posAt, skateRampAt, speedAt, splice, sprintingAt } from "./motion";

describe("motion mirrors sim::motion", () => {
  // Same case as `walks_at_speed` in server/crates/sim/src/motion.rs.
  const m = {
    path: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ],
    t0: 1000,
    speedX10: 40,
  };

  it("walks at speed", () => {
    expect(durationMs(m)).toBe(1750);
    expect(posAt(m, 0)).toEqual({ x: 0, y: 0 });
    expect(posAt(m, 1500)).toEqual({ x: 2, y: 0 });
    expect(posAt(m, 2250)).toEqual({ x: 4, y: 1 });
    expect(posAt(m, 9999)).toEqual({ x: 4, y: 3 });
    expect(endT(m)).toBe(2750);
  });

  it("reports heading", () => {
    expect(headingAt(m, 1500)).toEqual({ x: 1, y: 0 });
    expect(headingAt(m, 2250)).toEqual({ x: 0, y: 1 });
    expect(headingAt(m, 500)).toBeNull();
    expect(headingAt(m, 3000)).toBeNull();
  });

  // Same case as `breaks_into_a_sprint` in server/crates/sim/src/motion.rs.
  it("breaks into a sprint", () => {
    const sp = SPRINT_SPEED_X10 / 10;
    const r = { path: [{ x: 0, y: 0 }, { x: 15, y: 0 }], t0: 1000, speedX10: 40, sprintIn: 500 };
    expect(posAt(r, 1500)).toEqual({ x: 2, y: 0 });
    expect(posAt(r, 2500).x).toBeCloseTo(2 + sp);
    expect(durationMs(r)).toBe(Math.ceil(500 + (13 / sp) * 1000));
    expect(sprintingAt(r, 1400)).toBe(false);
    expect(sprintingAt(r, 1600)).toBe(true);
    const s = splice(r, 2000)!;
    const k = Math.floor(2 + 0.5 * sp);
    expect([s.prev, s.next]).toEqual([{ x: k, y: 0 }, { x: k + 1, y: 0 }]);
    expect(posAt(r, s.tPrev).x).toBeCloseTo(k, 1);
  });
});

describe("the Vespa (in lockstep with sim::motion)", () => {
  it("gives the same numbers as the server", () => {
    for (const [len, ramp0, end, mid, at3000] of [
      [200, 0, 7652, 78.391455, 67.6],
      [10, 3000, 1541, 7.443125, 10],
      [3, 0, 1320, 2.108376, 3],
      [60, 4500, 2740, 36.192, 60],
    ]) {
      const m = { path: [{ x: 0, y: 0 }, { x: len, y: 0 }], t0: 1000, speedX10: VESPA_SPEED_X10, sprintIn: ramp0 };
      expect(endT(m)).toBe(end);
      expect(posAt(m, 1000 + Math.floor((end - 1000) / 2)).x).toBeCloseTo(mid, 5);
      expect(posAt(m, 4000).x).toBeCloseTo(at3000, 5);
    }
  });
});

describe("skating (in lockstep with sim::motion)", () => {
  const skate = (len: number, ramp0: number) => ({ path: [{ x: 0, y: 0 }, { x: len, y: 0 }], t0: 1000, speedX10: SKATE_SPEED_X10, sprintIn: ramp0 });

  it("gives the same numbers as the server", () => {
    for (const [len, ramp0, end, mid, at3000] of [
      [200, 0, 11757, 77.980693, 35.142857],
      [10, 3000, 1823, 6.456822, 10],
      [3, 0, 1455, 1.921763, 3],
      [40, 7000, 2919, 23.5914, 40],
    ]) {
      const m = skate(len, ramp0);
      expect(endT(m)).toBe(end);
      expect(posAt(m, 1000 + Math.floor((end - 1000) / 2)).x).toBeCloseTo(mid, 5);
      expect(posAt(m, 4000).x).toBeCloseTo(at3000, 5);
    }
  });

  it("picks up speed, glides to a stop, and carries its momentum on", () => {
    const m = skate(200, 0);
    expect(speedAt(m, 1100)).toBeCloseTo(8.3, 0);
    expect(speedAt(m, 9000)).toBeCloseTo(24.6, 0);
    expect(speedAt(m, endT(m) - 100)).toBeLessThan(5);
    expect(sprintingAt(m, 9000)).toBe(false);
    expect(skateRampAt(m, 5000)).toBeGreaterThan(3900);
  });
});
