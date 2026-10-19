import { describe, expect, it } from "vitest";
import { SPRINT_SPEED_X10, durationMs, endT, headingAt, posAt, splice, sprintingAt } from "./motion";

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
