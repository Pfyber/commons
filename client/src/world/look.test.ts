import { describe, expect, it } from "vitest";
import { decodeLook, encodeLook } from "./look";

describe("looks", () => {
  it("round-trip every part", () => {
    for (let i = 0; i < 2000; i++) {
      const look = (Math.random() * 0x1_0000_0000) >>> 0;
      expect(encodeLook(decodeLook(look))).toBe(look);
    }
    const l = { hue: 200, skin: 3, hair: 5, hat: 2, hatHue: 17, style: 6, accessory: 7, outfit: 5 };
    expect(decodeLook(encodeLook(l))).toEqual(l);
  });

  it("keeps the old fields where they were", () => {
    // Looks saved before hairstyles existed decode to the same colours and hat.
    const old = 0x00_a3_2c_41;
    const l = decodeLook(old);
    expect(l.hue).toBe(0x41);
    expect(l.skin).toBe(0x2c & 3);
    expect(l.hat).toBe((old >>> 13) & 3);
    expect(l.hatHue).toBe(0xa3);
  });
});
