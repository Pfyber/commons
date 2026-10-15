// The client's pool physics must replay a shot exactly as the server played
// it: the same shots, run through both, must end with every ball in the same
// place (pool.vectors.json is written by sim::pool's client_vectors_match).
import { describe, expect, it } from "vitest";
import { simulate } from "./pool";
import vectors from "./pool.vectors.json";

describe("pool physics", () => {
  for (const v of vectors) {
    it(`replays the shot (${v.vx}, ${v.vy}) exactly as the server does`, () => {
      expect(simulate(v.before, v.vx, v.vy)).toEqual(v.after);
    });
  }
});
