import { describe, expect, it } from "vitest";
import cityFile from "../../../assets/city/city.json";
import { type Geometry, blocksNear, citySize, localAt, ownerAt, pitch, toGlobal } from "./city";

const g: Geometry = {
  blockTiles: cityFile.block_tiles,
  streetTiles: cityFile.street_tiles,
  blocks: cityFile.blocks.length,
  cellTiles: cityFile.cell_tiles,
};

describe("city geometry (mirrors sim::city)", () => {
  it("has the planned size and a cell size that divides the pitch", () => {
    expect(g.blockTiles).toBe(48);
    expect(citySize(g)).toBe(368);
    expect(pitch(g) % g.cellTiles).toBe(0);
  });

  it("round-trips global and block-local tiles; streets are null", () => {
    for (let y = 0; y < citySize(g); y += 3) {
      for (let x = 0; x < citySize(g); x += 3) {
        const l = localAt(g, x, y);
        if (l) expect(toGlobal(g, l)).toEqual({ x, y });
      }
    }
    expect(localAt(g, 0, 30)).toBeNull();
    expect(localAt(g, pitch(g), 30)).toBeNull();
  });

  it("splits streets between zones at the centre line, like the server", () => {
    expect(ownerAt(g, 53, 10).bx).toBe(0);
    expect(ownerAt(g, 54, 10).bx).toBe(1);
    expect(ownerAt(g, citySize(g) - 1, 0)).toEqual({ bx: 6, by: 0 });
  });

  it("finds the neighbouring blocks near an edge", () => {
    const corner = toGlobal(g, { block: { bx: 3, by: 3 }, x: 46, y: 1 });
    expect(blocksNear(g, corner.x, corner.y, 12)).toHaveLength(4);
    const mid = toGlobal(g, { block: { bx: 3, by: 3 }, x: 24, y: 24 });
    expect(blocksNear(g, mid.x, mid.y, 12)).toEqual([{ bx: 3, by: 3 }]);
  });

  it("puts the market at the centre, the park north and the pond south", () => {
    expect(cityFile.blocks[3][3]).toBe("market");
    expect(cityFile.blocks[2][3]).toBe("park");
    expect(cityFile.blocks[4][3]).toBe("pond");
    expect(cityFile.blocks[3][5]).toBe("casino");
  });
});
