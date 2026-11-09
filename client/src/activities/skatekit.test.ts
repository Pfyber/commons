import { describe, expect, it } from "vitest";
import { STOCK, packKit, ride, unpackKit } from "./skatekit";
import { NO_INPUT, Park, Skater, type SkateEvent } from "./skatesim";

describe("a board's build", () => {
  it("packs and unpacks for others to see", () => {
    const k = { deck: 10, wheels: 2, bearings: 5, trucks: 4, trail: 5 };
    expect(unpackKit(packKit(k))).toEqual(k);
    expect(unpackKit(packKit(STOCK))).toEqual(STOCK);
  });

  it("rides as its parts say: small wheels quicker, big wheels faster, bearings quicker each level", () => {
    const stock = ride(STOCK);
    expect(ride({ ...STOCK, wheels: 1 }).accel).toBeGreaterThan(stock.accel);
    expect(ride({ ...STOCK, wheels: 1 }).top).toBeLessThan(stock.top);
    expect(ride({ ...STOCK, wheels: 2 }).top).toBeGreaterThan(stock.top);
    expect(ride({ ...STOCK, bearings: 3 }).accel).toBeGreaterThan(ride({ ...STOCK, bearings: 2 }).accel);
  });

  it("does the tricks its trucks can", () => {
    expect(ride(STOCK).flips.size).toBe(0);
    expect(ride({ ...STOCK, trucks: 1 }).flips.has("")).toBe(true);
    expect(ride({ ...STOCK, trucks: 3 }).body).toBe(true);
    expect(ride({ ...STOCK, trucks: 2 }).grinds).toBe(true);
    const pro = ride({ ...STOCK, trucks: 4 });
    expect(pro.flips.size && pro.doubles && pro.grabs && pro.grinds && pro.body).toBeTruthy();
  });

  it("on stock trucks a kickflip won't go: it says so instead", () => {
    const T = 32;
    const park = new Park([{ kind: "sk_park", x: 0, y: 0, w: 20, h: 14 }], (tx, ty) => tx >= 0 && ty >= 0 && tx < 20 && ty < 14);
    const s = new Skater(park, 3 * T, 6 * T, () => 0.5);
    s.kit = ride(STOCK);
    s.speed = 100;
    const ev: SkateEvent[] = [];
    for (let i = 0; i < 40; i++) ev.push(...s.step(1 / 120, { ...NO_INPUT, pop: true }));
    ev.push(...s.step(1 / 120, NO_INPUT));
    ev.push(...s.step(1 / 120, { ...NO_INPUT, flip: true }));
    for (let i = 0; i < 120; i++) ev.push(...s.step(1 / 120, NO_INPUT));
    expect(ev.some((e) => e.t === "locked" && e.what === "flip")).toBe(true);
    expect(ev.some((e) => e.t === "trick" && e.name === "Kickflip")).toBe(false);
  });
});
