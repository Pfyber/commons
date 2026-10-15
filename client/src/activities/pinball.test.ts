import { describe, expect, it } from "vitest";
import { FLIP_BOTTOM, FLIP_TOP, PH, type PinState, carry, unpack } from "./pinball";
import vectors from "./pinball.vectors.json";

const REST = [2.094, -2.094, 1.047, -1.047];

function ball(x: number, y: number, vx: number, vy: number): PinState {
  return { x, y, vx, vy, score: [0, 0], serving: false, ang: REST.slice(), hits: Array(9).fill(0), keys: [0, 0], botHold: [0, 0], botRest: 0 };
}

describe("pinball, carried on between states", () => {
  // States the server sent, and where it had the ball a little later
  // (zone/src/instance/arcade/pinball.rs, client_vectors_match).
  it.each(vectors.map((v, i) => [i, v] as const))("lands where the server does (%i)", (_, v) => {
    const c = carry(unpack(v.data), v.t0, v.now, -1, [], v.bot);
    expect(c.x).toBeCloseTo(v.x, 2);
    expect(c.y).toBeCloseTo(v.y, 2);
  });

  it("lets a ball through between the resting flippers, past the post", () => {
    expect(carry(ball(50, PH / 2, -130, 0), 0, 1000, -1, []).gone).toBe(true);
  });

  it("knocks it away when your flippers come up in time", () => {
    const v = carry(ball(50, PH / 2 + 8, -130, 0), 0, 400, 0, [{ t: 160, keys: FLIP_TOP | FLIP_BOTTOM }]);
    expect(v.gone).toBe(false);
  });

  it("lights the bumper it hits", () => {
    const v = carry(ball(130, 50, 0, 80), 0, 300, -1, []);
    expect(v.hits.map(([i]) => i)).toContain(0);
  });
});
