import { describe, expect, it } from "vitest";
import { durationMs, endT, headingAt, posAt } from "./motion";

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
});
