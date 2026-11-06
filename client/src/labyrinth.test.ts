import { describe, expect, it } from "vitest";
import { wispAt } from "./labyrinth";

describe("wispAt", () => {
  // The same numbers as `commons_sim::labyrinth`'s test: the server catches
  // you where the client draws the wisp.
  it("matches the server", () => {
    const a = wispAt({ kind: "lab_wisp", x: 10, y: 20, w: 11, h: 1, label: "1234" }, 5000);
    expect(a.x).toBeCloseTo(19.974400000000003, 9);
    expect(a.y).toBeCloseTo(20.98442918699556, 9);
    const b = wispAt({ kind: "lab_wisp", x: 4, y: 7, w: 1, h: 14, label: "59999" }, 123456789);
    expect(b.x).toBeCloseTo(4.024060406216181, 9);
    expect(b.y).toBeCloseTo(7.860800000000745, 9);
  });
});
