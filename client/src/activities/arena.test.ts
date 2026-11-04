import { describe, expect, it } from "vitest";
import arenaRs from "../../../server/crates/sim/src/arena.rs?raw";
import { ARROW, ARROW_RANGE, ARROW_SPEED, BIG_BOMB, BIG_BOMB_COST, BIG_BOMB_FULL_MS, BIG_BOMB_R, BLAST_R, BODY_H, BURST_COST, BURST_GAP_MS, CAST, CHOOSE_MS, GIANT_H, KIT_HEAVY_REACH, KIT_HP, KIT_LIGHT_ARC, KIT_LIGHT_REACH, KIT_LIGHT_TIME, KIT_LUNGE, KIT_LUNGE_MAX, KIT_SPEED, KIT_SPIN_REACH, LOB_MIN, LOB_RANGE, QUAKE_R, QUICK_ARROW_COST, QUICK_LOB, QUICK_LOB_COST, QUICK_LOB_R, QUICK_SHOT, SHOOT, TANK_LEAP, TANK_LEAP_MIN, TANK_STOMP_R } from "./arenakits";
import { GIANT_CHARGE_MS, HEAVY_LUNGE, HEAVY_LUNGE_MAX, HP, HURL_DIST, HURL_MIN, STOMP_LEAP, STOMP_LEAP_MIN, STOMP_R, GIANT_DASH_COST, GIANT_DASH_DIST, GIANT_DASH_MS, GIANT_HP, GIANT_R, GIANT_SPEED, GRAB_SPIN_MS, OVER_MS, PARADE_END, PARADE_FIRST_GAP, PARADE_GAP, LIGHT_COST, SMASH, SMASH_ARC, SMASH_COST, SMASH_REACH, STOMP } from "./arena";

/** A constant's value in the server's arena sim (sim/src/arena.rs). */
function serverConst(name: string): number {
  const m = arenaRs.match(new RegExp(`pub const ${name}: [a-z0-9]+ = ([0-9_.]+);`));
  if (!m) throw new Error(`no ${name} in arena.rs`);
  return Number(m[1].replace(/_/g, ""));
}

describe("the arena (mirrors sim::arena)", () => {
  it("ends the champion's parade where the server stands them after", () => {
    expect(PARADE_END).toBe(serverConst("PARADE_END"));
    expect(PARADE_GAP).toBe(serverConst("PARADE_GAP"));
    expect(PARADE_FIRST_GAP).toBe(serverConst("PARADE_FIRST_GAP"));
    expect(OVER_MS).toBe(serverConst("OVER_MS"));
  });

  it("has the Goliath as the server has it", () => {
    expect(GIANT_HP).toBe(serverConst("GIANT_HP"));
    expect(GIANT_R).toBe(serverConst("GIANT_R"));
    expect(GIANT_SPEED).toBe(serverConst("GIANT_SPEED"));
    expect(GRAB_SPIN_MS).toBe(serverConst("GRAB_SPIN_MS"));
    expect(GIANT_CHARGE_MS).toBe(serverConst("GIANT_CHARGE_MS"));
    expect(HP).toBe(serverConst("HP"));
    expect(HEAVY_LUNGE).toBe(serverConst("HEAVY_LUNGE"));
    expect(HEAVY_LUNGE_MAX).toBe(serverConst("HEAVY_LUNGE_MAX"));
    expect(HURL_MIN).toBe(serverConst("HURL_MIN"));
    expect(HURL_DIST).toBe(serverConst("HURL_DIST"));
    expect(STOMP_LEAP).toBe(serverConst("STOMP_LEAP"));
    expect(STOMP_LEAP_MIN).toBe(serverConst("STOMP_LEAP_MIN"));
    expect(STOMP_R).toBe(serverConst("STOMP_R"));
    expect(GIANT_DASH_MS).toBe(serverConst("GIANT_DASH_MS"));
    expect(GIANT_DASH_DIST).toBe(serverConst("GIANT_DASH_DIST"));
    expect(GIANT_DASH_COST).toBe(serverConst("GIANT_DASH_COST"));
    expect(SMASH_REACH).toBe(serverConst("SMASH_REACH"));
    expect(SMASH_ARC).toBe(serverConst("SMASH_ARC"));
    expect(SMASH_COST).toBe(serverConst("SMASH_COST"));
    expect(LIGHT_COST).toBe(serverConst("LIGHT_COST"));
    const tuple = (name: string) => {
      const m = arenaRs.match(new RegExp(`pub const ${name}: \\(u32, u32, u32\\) = \\(([0-9_, ]+)\\);`));
      if (!m) throw new Error(`no ${name}`);
      return m[1].split(",").map((v) => Number(v.trim().replace(/_/g, "")));
    };
    expect(SMASH).toEqual(tuple("SMASH"));
    expect(STOMP).toEqual(tuple("STOMP"));
  });
});

describe("the arena's classes (mirror sim::arena::kit)", () => {
  /** A `[f64; 5]` table in arena.rs. */
  const table = (name: string): number[] => {
    const m = arenaRs.match(new RegExp(`pub const ${name}: \\[f64; 5\\] = \\[([^\\]]+)\\];`));
    if (!m) throw new Error(`no ${name}`);
    return m[1].split(",").map((v) => Number(v.trim()));
  };
  it("has each class's numbers as the server has them", () => {
    expect(KIT_HP).toEqual(table("KIT_HP"));
    expect(KIT_SPEED).toEqual(table("KIT_SPEED"));
    expect(KIT_LIGHT_REACH).toEqual(table("KIT_LIGHT_REACH"));
    expect(KIT_LIGHT_ARC).toEqual(table("KIT_LIGHT_ARC"));
    expect(KIT_LIGHT_TIME).toEqual(table("KIT_LIGHT_TIME"));
    expect(KIT_HEAVY_REACH).toEqual(table("KIT_HEAVY_REACH"));
    expect(KIT_LUNGE).toEqual(table("KIT_LUNGE"));
    expect(KIT_LUNGE_MAX).toEqual(table("KIT_LUNGE_MAX"));
    expect(KIT_SPIN_REACH).toEqual(table("KIT_SPIN_REACH"));
  });
  it("fires, lobs and casts as the server does", () => {
    for (const [v, name] of [
      [CHOOSE_MS, "CHOOSE_MS"],
      [ARROW_SPEED, "ARROW_SPEED"],
      [ARROW_RANGE, "ARROW_RANGE"],
      [QUICK_ARROW_COST, "QUICK_ARROW_COST"],
      [BURST_GAP_MS, "BURST_GAP_MS"],
      [BURST_COST, "BURST_COST"],
      [LOB_MIN, "LOB_MIN"],
      [LOB_RANGE, "LOB_RANGE"],
      [QUICK_LOB_R, "QUICK_LOB_R"],
      [QUICK_LOB_COST, "QUICK_LOB_COST"],
      [TANK_LEAP_MIN, "TANK_LEAP_MIN"],
      [TANK_LEAP, "TANK_LEAP"],
      [TANK_STOMP_R, "TANK_STOMP_R"],
      [BODY_H, "BODY_H"],
      [GIANT_H, "GIANT_H"],
      [BLAST_R, "BLAST_R"],
      [QUAKE_R, "QUAKE_R"],
    ] as [number, string][]) {
      expect(v, name).toBe(serverConst(name));
    }
    const pair = (name: string, ty = "u32") => {
      const m = arenaRs.match(new RegExp(`pub const ${name}: \\(${ty}, ${ty}\\) = \\(([0-9_., ]+)\\);`));
      if (!m) throw new Error(`no ${name}`);
      return m[1].split(",").map((v) => Number(v.trim()));
    };
    expect(SHOOT).toEqual(pair("SHOOT"));
    expect(CAST).toEqual(pair("CAST"));
    expect(QUICK_SHOT).toEqual(pair("QUICK_SHOT"));
    expect(QUICK_LOB).toEqual(pair("QUICK_LOB"));
    expect(BIG_BOMB_R).toEqual(pair("BIG_BOMB_R", "f64"));
    expect(BIG_BOMB_COST).toEqual(pair("BIG_BOMB_COST", "f64"));
    expect(ARROW).toBe(Number(arenaRs.match(/pub const ARROW: u8 = (\d+);/)![1]));
    expect(BIG_BOMB_FULL_MS).toBe(serverConst("HEAVY_MIN_MS") + 4 * (serverConst("HEAVY_FULL_MS") - serverConst("HEAVY_MIN_MS")));
    expect(BIG_BOMB).toBe(Number(arenaRs.match(/pub const BIG_BOMB: u8 = (\d+);/)![1]));
  });
});
