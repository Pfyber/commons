import { describe, expect, it } from "vitest";
import { lightHour, sunAt } from "./sun";

/** When (unix ms, searching minute by minute from `fromUtc`) the sun crosses `alt` going down (or up, `rising`). */
function crossing(fromUtc: string, alt: number, rising = false): Date {
  let t = Date.parse(fromUtc);
  let prev = sunAt(t).alt;
  for (let i = 0; i < 24 * 60; i++) {
    t += 60_000;
    const a = sunAt(t).alt;
    if (rising ? prev < alt && a >= alt : prev > alt && a <= alt) return new Date(t);
    prev = a;
  }
  throw new Error("no crossing");
}

const utcMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

describe("the sun over Ljubljana", () => {
  // Published times for Ljubljana (UTC): within a few minutes.
  it("sets and rises when it really does", () => {
    // 21 Dec 2026: sunrise 07:42 CET (06:42 UTC), sunset 16:22 CET (15:22 UTC).
    expect(Math.abs(utcMinutes(crossing("2026-12-21T00:00:00Z", -0.833, true)) - (6 * 60 + 42))).toBeLessThanOrEqual(5);
    expect(Math.abs(utcMinutes(crossing("2026-12-21T12:00:00Z", -0.833)) - (15 * 60 + 22))).toBeLessThanOrEqual(5);
    // 21 Jun 2026: sunrise 05:11 CEST (03:11 UTC), sunset 20:58 CEST (18:58 UTC).
    expect(Math.abs(utcMinutes(crossing("2026-06-21T00:00:00Z", -0.833, true)) - (3 * 60 + 11))).toBeLessThanOrEqual(5);
    expect(Math.abs(utcMinutes(crossing("2026-06-21T12:00:00Z", -0.833)) - (18 * 60 + 58))).toBeLessThanOrEqual(5);
  });

  it("is dark at five on a November evening, light at five in June", () => {
    // 12 Nov, 17:30 CET (16:30 UTC): past dusk.
    expect(lightHour(Date.parse("2026-11-12T16:30:00Z"))).toBeGreaterThan(20);
    // 12 Nov, noon: full day.
    const noon = lightHour(Date.parse("2026-11-12T11:00:00Z"));
    expect(noon).toBeGreaterThan(8);
    expect(noon).toBeLessThan(16.5);
    // 21 Jun, 19:00 CEST (17:00 UTC): still full day.
    expect(lightHour(Date.parse("2026-06-21T17:00:00Z"))).toBeLessThanOrEqual(16.5);
    // Sunset itself is the lighting's sunset, whatever the season.
    expect(lightHour(crossing("2026-12-21T12:00:00Z", -0.833).getTime())).toBeCloseTo(18.5, 1);
    expect(lightHour(crossing("2026-06-21T12:00:00Z", -0.833).getTime())).toBeCloseTo(18.5, 1);
  });

  it("goes round the clock smoothly (no jumps)", () => {
    for (const day of ["2026-01-15", "2026-03-20", "2026-06-21", "2026-09-22", "2026-12-21"]) {
      let prev = lightHour(Date.parse(`${day}T00:00:00Z`));
      for (let m = 1; m <= 24 * 60; m++) {
        const h = lightHour(Date.parse(`${day}T00:00:00Z`) + m * 60_000);
        let d = h - prev;
        if (d < -12) d += 24;
        expect(d, `${day} +${m}min`).toBeGreaterThanOrEqual(0);
        expect(d, `${day} +${m}min`).toBeLessThan(0.25);
        prev = h;
      }
    }
  });
});
