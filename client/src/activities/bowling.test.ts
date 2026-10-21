import { describe, expect, it } from "vitest";
import { frameMarks, frameScores, pinPos } from "./bowling";

// The same cases as `scores_like_ten_pin` in server/crates/sim/src/bowling.rs.
describe("bowling scores mirror sim::bowling", () => {
  it("scores like ten-pin", () => {
    expect(frameScores([10, 7, 3, 5, 2, 10, 10, 10, 10])).toEqual([20, 35, 42, 72, 102]);
    expect(frameScores([10, 10, 10, 10, 10, 10, 10])[4]).toBe(150);
    expect(frameScores([1, 2, 3, 4, 5, 4, 0, 0, 9, 0])[4]).toBe(28);
    expect(frameScores([10, 3])).toEqual([null, null, null, null, null]);
    expect(frameScores([3, 4, 10])).toEqual([7, null, null, null, null]);
  });

  it("marks strikes, spares and misses", () => {
    expect(frameMarks([10, 7, 3, 5, 0, 0, 10, 10, 10, 10])).toEqual([["X"], ["7", "/"], ["5", "-"], ["-", "/"], ["X", "X", "X"]]);
    expect(frameMarks([1, 2, 3, 4, 5, 4, 0, 0, 9, 1, 6])).toEqual([["1", "2"], ["3", "4"], ["5", "4"], ["-", "-"], ["9", "/", "6"]]);
  });

  it("racks the pins like the server", () => {
    expect(pinPos(0)).toEqual([0, 0]);
    expect(pinPos(9)[0]).toBe(1.5);
    expect(pinPos(6)[1]).toBeCloseTo(2.598);
  });
});

describe("running scores", () => {
  it("count a strike at once and settle when its bonus is in", async () => {
    const { runningScores, scoreSoFar, frameScores } = await import("./bowling");
    expect(scoreSoFar([10])).toBe(10);
    expect(runningScores([10])[0]).toEqual({ total: 10, final: false });
    expect(scoreSoFar([10, 3])).toBe(16);
    expect(runningScores([10, 3, 4]).slice(0, 2)).toEqual([{ total: 17, final: true }, { total: 24, final: true }]);
    expect(scoreSoFar([7, 3])).toBe(10);
    // Whole games: the same final totals as frameScores.
    for (const g of [[10, 7, 3, 5, 2, 10, 10, 10, 10], [10, 10, 10, 10, 10, 10, 10], [1, 2, 3, 4, 5, 4, 0, 0, 9, 0]]) {
      expect(scoreSoFar(g)).toBe(frameScores(g)[4]);
    }
  });
});
