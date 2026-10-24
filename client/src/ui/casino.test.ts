import { describe, expect, it } from "vitest";
import type { Auth } from "../net/api";
import type { Social } from "../social";
import { type Floor, Tables, playersOf } from "./casino";

function floor(seq: number, phase: "open" | "betting" | "spinning"): Floor {
  return {
    instance: 1,
    seq,
    now: Date.now(),
    blackjack: [],
    roulette: {
      phase,
      closes: null,
      number: null,
      lands: null,
      ready: [],
      last: phase === "open" ? { number: 17, red: false, winners: [{ name: "Ada", coins: 360 }] } : null,
      history: [],
      chips:
        phase === "open"
          ? []
          : [
              { player: "ada", name: "Ada", bet: { on: "number", n: 17 }, amount: 10 },
              { player: "bo", name: "Bo", bet: { on: "red" }, amount: 5 },
              { player: "ada", name: "Ada", bet: { on: "odd" }, amount: 5 },
            ],
    },
  };
}

describe("the shared tables", () => {
  it("ignores a slow reply that left before news it already has, so a landing still pays", async () => {
    let push: (m: { t: string; [k: string]: unknown }) => void = () => {};
    const social = { onPush: (f: typeof push) => ((push = f), () => {}) } as unknown as Social;
    // The reply to our "Spin!" left the server (seq 5) before Bo's spin did (seq 6).
    const auth = { send: async () => floor(5, "betting") } as unknown as Auth;
    const tables = new Tables(auth, "ada", social);
    let paid = 0;
    tables.onCoins = () => paid++;
    push({ t: "casino_tables", ...floor(6, "spinning") });
    await tables.rouletteSpin();
    expect(tables.floor?.roulette.phase).toBe("spinning");
    push({ t: "casino_tables", ...floor(7, "open") });
    expect(paid).toBe(1);
    expect(tables.floor?.roulette.last?.number).toBe(17);
  });

  it("gives each player at the wheel one colour and their total", () => {
    const ps = playersOf(floor(1, "betting").roulette);
    expect(ps.map((p) => [p.name, p.total])).toEqual([
      ["Ada", 15],
      ["Bo", 5],
    ]);
    expect(ps[0].color).not.toBe(ps[1].color);
    expect(ps[0].last).toEqual({ on: "odd" });
  });
});
