// Vehicles (ADR 0011, M6): how they look under a rider, and on a display.
// Codes are `commons_sim::vehicles`: 1 roller skates, 2 kick scooter, 3 city
// bike, 4 vintage bike, 5 skateboard (under a rider it is drawn with the
// rider, see Avatar; this is how it looks on its own). Drawn facing right on a 32×24 canvas, the ground on
// the bottom row; `RIDE_POSE` says how the rider sits on each.

import type { Texture } from "pixi.js";
import { toTexture } from "./art";
import { rowboatCanvas } from "./boatart";

const O = "#3b3a2e";

/** Set on a test ride (the mall's track). */
export const TEST_RIDE = 0x80;

/** The Lake's rowboats (`commons_protocol::boat`): the captain's vehicle
 * (the boat drawn under them) and the passenger in seat n's (`BOAT_PASSENGER + n`). */
export const BOAT_CAPTAIN = 6;
export const BOAT_PASSENGER = 7;
export const BOAT_SEATS = 3;

/** Whether vehicle `code` is a place in a rowboat (not a thing with wheels: the Vespa's code comes after them). */
export function isBoat(code: number): boolean {
  return code >= BOAT_CAPTAIN && code < BOAT_PASSENGER + BOAT_SEATS;
}
/** Rowing speed, tenths of a tile a second. */
export const BOAT_SPEED_X10 = 64;

/** Riding speeds in tenths of a tile a second (`commons_sim::vehicles`). */
const SPEED_X10: Record<number, number> = { 1: 88, 2: 108, 3: 128, 4: 140, 5: 82, 10: 130 };
/** The Vespa (sim::vehicles::VESPA). */
export const VESPA = 10;
/** Its canvas (bigger than the others'), and how far ahead of it (px) its saddle puts its rider. */
const VESPA_W = 40;
const VESPA_H = 26;
export const VESPA_AHEAD = 8;

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
  // In a rowboat, everyone sits.
  6: { lift: 2, pose: "sit" },
  7: { lift: 2, pose: "sit" },
  8: { lift: 2, pose: "sit" },
  9: { lift: 2, pose: "sit" },
  // On the Vespa: sat on its saddle.
  10: { lift: 10, pose: "sit" },
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

/**
 * The Vespa, side on, facing right, on a 40×26 canvas (about hip high to a
 * rider): a glossy mint body, its round rear cowl with vents and a cream
 * stripe, the step-through floor with a chrome rail, the tall leg shield
 * and the fender over the front wheel, a long two-tone saddle, a round
 * headlamp in the headset, chrome bars and a little mirror, whitewall
 * wheels, a chrome exhaust (a puff from it on the second frame), a rack and
 * a tail light. One dark outline round the lot.
 */
function vespa(ctx: CanvasRenderingContext2D, frame: 0 | 1) {
  const MINT = "#6fd0b4";
  const MINT_D = "#3f9c86";
  const MINT_DD = "#2f7a6c";
  const MINT_L = "#b4f0dc";
  const CREAM = "#f6ecd2";
  const CHROME = "#e2e6ef";
  const CHROME_D = "#8a909c";
  const paint = (inside: (x: number, y: number) => boolean, color: (x: number, y: number) => string) => {
    for (let y = 0; y < VESPA_H; y++) for (let x = 0; x < VESPA_W; x++) if (inside(x, y)) px(ctx, color(x, y), x, y);
  };
  const ball = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  // The exhaust, low at the back.
  px(ctx, CHROME_D, 2, 20, 11, 2);
  px(ctx, CHROME, 2, 20, 11, 1);
  // Whitewall wheels (small, as a Vespa's are), the hub turning.
  for (const wx of [9, 31]) {
    paint(ball(wx, 21.5, 4.5, 4.5), () => "#23232b");
    paint(ball(wx, 21.5, 3, 3), () => CREAM);
    paint(ball(wx, 21.5, 2, 2), () => CHROME_D);
    px(ctx, CHROME, wx + (frame ? 0 : -1), frame ? 20 : 22, 2, 1);
    px(ctx, "#23232b", wx, 21, 1, 1);
  }
  // The body, in one piece: the cowl, the floor, the shield, the fender, the headset.
  const cowl = ball(10, 15, 9, 5.5);
  const inCowl = (x: number, y: number) => cowl(x, y) && y <= 18;
  const shieldL = (y: number) => 26 - Math.round(((y - 6) * 2) / 13);
  const shieldR = (y: number) => 30 + Math.round(((y - 6) * 3) / 13);
  const inShield = (x: number, y: number) => y >= 6 && y <= 19 && x >= shieldL(y) && x <= shieldR(y);
  const fender = ball(31, 19, 6.5, 4.5);
  const inFender = (x: number, y: number) => fender(x, y) && y <= 18;
  const headset = ball(28.5, 5, 5, 2.8);
  paint(inCowl, (x, y) => (y < 12 && x < 12 ? MINT_L : y > 16 || x > 16 ? MINT_D : MINT));
  paint((x, y) => x >= 15 && x <= 27 && y >= 16 && y <= 18, (_x, y) => (y === 16 ? MINT : MINT_D));
  paint(inShield, (x, y) => (x <= shieldL(y) + 1 ? MINT_L : x >= shieldR(y) - 1 ? MINT_D : MINT));
  paint(inFender, (x, y) => (y < 17 && x < 32 ? MINT_L : y > 17 ? MINT_D : MINT));
  paint(headset, (_x, y) => (y < 4 ? MINT_L : y > 6 ? MINT_D : MINT));
  // The long saddle: tan on top, dark below.
  paint((x, y) => (y === 8 && x >= 5 && x <= 18) || (y >= 9 && y <= 10 && x >= 3 && x <= 19), (_x, y) => (y === 8 ? "#e0ae7c" : y === 9 ? "#b07a4a" : "#5e3f2a"));
  // One dark line round all of it (over the wheels' tops as well).
  const img = ctx.getImageData(0, 0, VESPA_W, VESPA_H);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < VESPA_W && y < VESPA_H && img.data[(y * VESPA_W + x) * 4 + 3] > 0;
  for (let y = 0; y < VESPA_H; y++)
    for (let x = 0; x < VESPA_W; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) px(ctx, O, x, y);
    }
  // The cowl's cream stripe, its vents and badge; a tail light; the rack.
  paint((x, y) => y === 15 && inCowl(x, y), () => CREAM);
  for (const x of [12, 14, 16]) px(ctx, MINT_DD, x, 12, 1, 2);
  px(ctx, CHROME, 4, 13, 3, 1);
  px(ctx, "#e8233a", 1, 13, 2, 2);
  px(ctx, "#ff9a9a", 1, 13, 1, 1);
  px(ctx, CHROME, 0, 9, 4, 1);
  px(ctx, CHROME_D, 1, 10, 1, 3);
  // The saddle's seam.
  px(ctx, "#5e3f2a", 11, 8, 1, 3);
  px(ctx, CREAM, 4, 10, 15, 1);
  // The floor: a dark mat, a chrome rail along its edge.
  px(ctx, "#4a4a5a", 18, 16, 8, 1);
  px(ctx, CHROME, 16, 18, 10, 1);
  // The shield's gold crest; the fender's chrome crest.
  px(ctx, "#f2c94c", 28, 10, 2, 3);
  px(ctx, "#fff3a8", 28, 10, 1, 1);
  px(ctx, CHROME, 27, 14, 8, 1);
  // The headlamp, its chrome ring, a glint; a beam's sparkle as it goes.
  paint(ball(33.5, 5, 2.6, 2.6), () => CHROME);
  paint(ball(33.5, 5, 1.7, 1.7), () => "#fff3a8");
  px(ctx, "#ffffff", 33, 4, 1, 1);
  if (frame) px(ctx, "#fff3a8", 37, 5, 2, 1);
  // The bars: a dark grip, chrome back to the headset; the mirror on its stalk.
  px(ctx, O, 20, 2, 6, 3);
  px(ctx, "#23232b", 21, 3, 3, 1);
  px(ctx, CHROME, 24, 3, 2, 1);
  px(ctx, CHROME_D, 23, 1, 1, 2);
  px(ctx, O, 21, 0, 4, 2);
  px(ctx, CHROME, 22, 0, 2, 1);
  // A puff of smoke out of the exhaust.
  if (frame) {
    px(ctx, "rgba(225,225,235,0.75)", 0, 19, 2, 2);
    px(ctx, "rgba(225,225,235,0.5)", 1, 17, 1, 1);
  }
}

/** The vehicle on its own (frame 0/1: the wheels turning). */
export function vehicleCanvas(code: number, frame: 0 | 1 = 0): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const big = (code & ~TEST_RIDE) === VESPA;
  c.width = big ? VESPA_W : 32;
  c.height = big ? VESPA_H : 24;
  const ctx = c.getContext("2d", { willReadFrequently: big })!;
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
    case 10: {
      vespa(ctx, frame);
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
    t = toTexture(code === BOAT_CAPTAIN ? rowboatCanvas(frame) : vehicleCanvas(code, frame));
    textures.set(key, t);
  }
  return t;
}
