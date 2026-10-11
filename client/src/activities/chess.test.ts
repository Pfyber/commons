import { describe, expect, it } from "vitest";
import { parseFen } from "./chess";

describe("parseFen", () => {
  it("expands the starting position", () => {
    const b = parseFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    expect(b).toHaveLength(8);
    expect(b.every((r) => r.length === 8)).toBe(true);
    expect(b[0].join("")).toBe("rnbqkbnr");
    expect(b[4][4]).toBe("P");
    expect(b[6][4]).toBe("");
  });
});
