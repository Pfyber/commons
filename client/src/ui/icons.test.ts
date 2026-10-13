import { describe, expect, it } from "vitest";
import { ICONS } from "./icons";

describe("pixel icons", () => {
  it("are all 12×12", () => {
    for (const [name, grid] of Object.entries(ICONS)) {
      expect(grid.length, name).toBe(12);
      grid.forEach((row, y) => expect(row.length, `${name} row ${y}`).toBe(12));
    }
  });
});
