import { describe, expect, it } from "vitest";
import { NO_INPUT, Park, Skater } from "./skatesim";
import { STOCK, ride } from "./skatekit";
import { POOL, Quests, pick, questDay } from "./skatequests";

const T = 32;

describe("daily quests", () => {
  it("are three a day, a different thing each, the same for everyone that day, and change day to day", () => {
    const days = new Set<string>();
    for (let d = 20000; d < 20060; d++) {
      const q = pick(d);
      expect(q.map((x) => x.slot)).toEqual([0, 1, 2]);
      expect(new Set(q.map((x) => x.def.metric)).size).toBe(3);
      expect(pick(d).map((x) => x.def.metric)).toEqual(q.map((x) => x.def.metric));
      days.add(q.map((x) => x.def.metric).join());
    }
    // Lots of variety.
    expect(days.size).toBeGreaterThan(40);
    expect(POOL.length).toBeGreaterThanOrEqual(18);
  });

  it("keep the day's best and sum, say when one's done, and start afresh the next day", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    let now = 20000 * 86_400_000 + 1000;
    const done: number[] = [];
    const q = new Quests((x) => done.push(x.slot), store, () => now);
    const first = q.today()[0];
    q.record(first.metric, first.target / 2);
    expect(q.today()[0].done).toBe(false);
    q.record(first.metric, first.target);
    expect(q.today()[0].done).toBe(true);
    expect(done).toContain(0);
    q.claimed(questDay(now), 0);
    // Kept: a new tracker that day sees it all.
    const again = new Quests(() => {}, store, () => now);
    expect(again.today()[0].claimed).toBe(true);
    now += 86_400_000;
    expect(again.today().every((x) => !x.done && !x.claimed)).toBe(true);
  });

  it("asks for speed you can reach on a stock board, pushing hard along the park", () => {
    const p = new Park([{ kind: "sk_park", x: 0, y: 0, w: 60, h: 20 }, { kind: "sk_quarter", x: 50, y: 0, w: 4, h: 20, label: "e" }], (tx, ty) => tx >= 0 && ty >= 0 && tx < 60 && ty < 20);
    const s = new Skater(p, 10 * T, 10 * T);
    s.kit = ride(STOCK);
    let top = 0;
    for (let t = 0; t < 12; t += 1 / 120) {
      s.step(1 / 120, t < 9 ? { ...NO_INPUT, x: 1 } : NO_INPUT);
      if (s.mode === "ground") top = Math.max(top, s.speed);
    }
    const hard = POOL.find((d) => d.metric === "topSpeed")!.targets[2]!;
    console.log("top speed", Math.round(top));
    expect(top).toBeGreaterThan(hard);
  });
});
