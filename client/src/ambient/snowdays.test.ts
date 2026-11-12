import { describe, expect, it } from "vitest";
import { SNOW_RECORD, snowDay } from "./snowdays";
import { weatherAt } from "./weather";

describe("snow days", () => {
  it("snows on 9 December every year (all day, Ljubljana time), not the day before", () => {
    for (const y of [2025, 2026, 2031]) {
      expect(snowDay(Date.parse(`${y}-12-09T12:00:00Z`))).toBe(true);
      // 00:00 and 23:59 CET.
      expect(snowDay(Date.parse(`${y}-12-08T23:00:00Z`))).toBe(true);
      expect(snowDay(Date.parse(`${y}-12-09T22:59:00Z`))).toBe(true);
      expect(snowDay(Date.parse(`${y}-12-08T12:00:00Z`))).toBe(false);
      expect(weatherAt(Date.parse(`${y}-12-09T08:00:00Z`), 9).kind).toBe("snow");
    }
    expect(snowDay(Date.parse("2026-07-14T12:00:00Z"))).toBe(false);
  });

  it("keeps the same record as the server (sim::nature::SNOW_RECORD)", async () => {
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(p: URL, enc: string): string };
    const rs = fs.readFileSync(new URL("../../../server/crates/sim/src/nature.rs", import.meta.url), "utf8");
    const body = /SNOW_RECORD: \[\(u32, u32, u32\); \d+\] = \[([^\]]*)\]/.exec(rs)?.[1] ?? "";
    const theirs = [...body.matchAll(/\((\d+), (\d+), (\d+)\)/g)].map(([, m, d, n]) => [`${m.padStart(2, "0")}-${d.padStart(2, "0")}`, Number(n)]);
    expect(theirs).toEqual(SNOW_RECORD);
  });
});
