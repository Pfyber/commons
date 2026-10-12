import { describe, expect, it } from "vitest";
import { QUESTIONS, questionAt } from "./activities/campfire";
import { starAt } from "./ambient/sky";

describe("the campfire question", () => {
  it("is the same for everyone at the same moment and changes every few minutes", () => {
    const t = Date.UTC(2026, 9, 12, 20, 1);
    expect(questionAt(t)).toBe(questionAt(t + 30_000));
    const seen = new Set<string>();
    for (let i = 0; i < QUESTIONS.length; i++) seen.add(questionAt(t + i * 4 * 60_000));
    expect(seen.size).toBe(QUESTIONS.length);
  });
});

describe("shooting stars", () => {
  it("fall now and then, the same for everyone", () => {
    const start = Date.UTC(2026, 9, 12, 21, 0);
    let stars = 0;
    let last = -1;
    for (let t = start; t < start + 3600_000; t += 100) {
      const s = starAt(t);
      if (s && s.k !== last) {
        stars++;
        last = s.k;
        expect(s.p).toBeGreaterThanOrEqual(0);
        expect(s.p).toBeLessThanOrEqual(1);
      }
    }
    // One slot in three over an hour of 45 s slots: about 27.
    expect(stars).toBeGreaterThan(12);
    expect(stars).toBeLessThan(45);
  });
});
