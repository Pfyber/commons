// Vehicles (ADR 0011, M6): how they look under a rider, and on a display.
// Codes are `commons_sim::vehicles`: 1 roller skates, 2 kick scooter, 3 city
// bike, 4 vintage bike, 5 skateboard (under a rider it is drawn with the
// rider, see Avatar; this is how it looks on its own). Drawn facing right on a 32×24 canvas, the ground on
// the bottom row; `RIDE_POSE` says how the rider sits on each.

import type { Texture } from "pixi.js";
import { toTexture } from "./art";

const O = "#3b3a2e";

/** Set on a test ride (the mall's track). */
export const TEST_RIDE = 0x80;

/** Riding speeds in tenths of a tile a second (`commons_sim::vehicles`). */
const SPEED_X10: Record<number, number> = { 1: 88, 2: 108, 3: 128, 4: 140, 5: 96 };

/** How many times walking speed vehicle `code` goes, for the shop ("3.2×"). */
export function rideTimes(code: number): number {
  return rideSpeed(code) / 40;
}

/** How fast vehicle `code` goes (0: not a vehicle). */
export function rideSpeed(code: number): number {
  return SPEED_X10[code & ~TEST_RIDE] ?? 0;
}

/** How a rider sits on each vehicle: lifted by `lift` px, in which pose. */
export const RIDE_POSE: Record<number, { lift: number; pose: "walk" | "stand" | "sit" }> = {
  1: { lift: 3, pose: "walk" },
  2: { lift: 4, pose: "stand" },
  3: { lift: 7, pose: "sit" },
  4: { lift: 7, pose: "sit" },
};

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function wheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spin: number) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d <= r + 0.3) px(ctx, d > r - 1.3 ? O : "#d9d4c6", cx + x, cy + y);
    }
  }
  // A spoke that turns.
  const a = spin * Math.PI;
  for (let t = -r + 1; t < r; t++) px(ctx, "#8a857b", Math.round(cx + Math.cos(a) * t), Math.round(cy + Math.sin(a) * t));
  px(ctx, O, cx, cy);
}

/** The vehicle on its own (frame 0/1: the wheels turning). */
export function vehicleCanvas(code: number, frame: 0 | 1 = 0): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 24;
  const ctx = c.getContext("2d")!;
  const spin = frame * 0.5;
  switch (code & ~TEST_RIDE) {
    case 1: {
      // Two skates side by side: a boot, a plate, four little wheels.
      for (const [x, color] of [
        [9, "#e8566b"],
        [17, "#d9475b"],
      ] as [number, string][]) {
        px(ctx, O, x - 1, 15, 8, 6);
        px(ctx, color, x, 16, 6, 4);
        px(ctx, "#fff9ec", x + 4, 16, 2, 1);
        px(ctx, O, x - 1, 20, 9, 1);
        for (const wx of [x, x + 5]) {
          px(ctx, O, wx, 21, 3, 3);
          px(ctx, "#f2d24a", wx + 1, 22, 1, 1);
        }
      }
      break;
    }
    case 2: {
      // Kick scooter: a low deck, a tall stem and a T bar in front.
      wheel(ctx, 7, 20, 3, spin);
      wheel(ctx, 25, 20, 3, spin);
      px(ctx, O, 6, 17, 20, 3);
      px(ctx, "#3f7a8a", 7, 18, 18, 1);
      px(ctx, O, 24, 2, 2, 17);
      px(ctx, "#7fb5d8", 24, 3, 1, 15);
      px(ctx, O, 21, 1, 8, 2);
      break;
    }
    case 5: {
      // Skateboard, as it looks under a rider: a black deck kicked up at
      // both ends, red trucks, cream wheels whose hub turns as they roll.
      const hub = frame ? 1 : 0;
      for (const wx of [7, 21]) {
        px(ctx, O, wx + 1, 17, 2, 1);
        px(ctx, O, wx, 18, 4, 3);
        px(ctx, "#f1e9d2", wx + 1, 18, 2, 2);
        px(ctx, "#9c8f73", wx + 1 + hub, 18 + hub, 1, 1);
        px(ctx, O, wx + 1, 21, 2, 1);
        px(ctx, "#c8553d", wx, 16, 4, 1);
      }
      px(ctx, "#141414", 4, 14, 24, 2);
      px(ctx, "#2a2a2a", 5, 14, 22, 1);
      px(ctx, "#141414", 2, 12, 3, 2);
      px(ctx, "#141414", 27, 12, 3, 2);
      // A flash of colour on the deck's edge.
      px(ctx, "#f6c343", 12, 15, 8, 1);
      break;
    }
    default: {
      // A bike: two big wheels, a frame, a saddle and handlebars. The
      // vintage one is cream with a basket.
      const vintage = (code & ~TEST_RIDE) === 4;
      const frame = vintage ? "#e9dcc0" : "#3f7a8a";
      wheel(ctx, 6, 18, 5, spin);
      wheel(ctx, 26, 18, 5, spin);
      // Frame: seat tube, top tube, down tube, chain stay.
      for (let i = 0; i <= 10; i++) {
        px(ctx, O, 13 + Math.round(i * 0.1), 8 + i, 2, 1);
        px(ctx, O, 15 + i, 9 + Math.round(i * 0.8), 1, 2);
      }
      for (let x = 6; x <= 26; x++) {
        const y = x < 14 ? 18 - Math.round((x - 6) * 0.1) : 0;
        if (x < 14) px(ctx, O, x, y - 1, 1, 2);
      }
      px(ctx, O, 13, 8, 12, 2);
      px(ctx, frame, 14, 8, 10, 1);
      for (let i = 0; i <= 9; i++) px(ctx, O, 24 + Math.round(i * 0.2), 9 + i, 1, 1);
      // Saddle and bars.
      px(ctx, O, 10, 5, 7, 3);
      px(ctx, "#6e543d", 11, 6, 5, 1);
      px(ctx, O, 23, 4, 2, 5);
      px(ctx, O, 22, 3, 6, 2);
      px(ctx, O, 15, 16, 4, 4);
      px(ctx, "#8a857b", 16, 17, 2, 2);
      if (vintage) {
        px(ctx, O, 26, 5, 6, 5);
        px(ctx, "#c9a95a", 27, 6, 4, 3);
        px(ctx, "#e8566b", 28, 4, 2, 2);
      }
      break;
    }
  }
  return c;
}

const textures = new Map<string, Texture>();

export function vehicleTexture(code: number, frame: 0 | 1 = 0): Texture {
  const key = `${code & ~TEST_RIDE}:${frame}`;
  let t = textures.get(key);
  if (!t) {
    t = toTexture(vehicleCanvas(code, frame));
    textures.set(key, t);
  }
  return t;
}
