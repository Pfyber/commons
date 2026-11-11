// Your board, built from parts bought at Dusty's van (items of kind
// `skate_part`, migration 0060): the deck (its colour, and the one that
// glows in the dark), the wheels (small: quicker off the mark; big: a higher
// top speed), the bearings (each level, faster acceleration), the trucks
// (which tricks you can do) and a trail behind you. The stock parts (code 0;
// bearings level 1) everyone has. Which of yours you ride is kept on this
// device, and sent with you onto the board (`SkateOn.kit`) so everyone sees
// your deck, wheels and trail.

import type { Economy } from "../economy";

export type Part = "deck" | "wheels" | "bearings" | "trucks" | "trail";

export interface Kit {
  deck: number;
  wheels: number;
  bearings: number;
  trucks: number;
  trail: number;
}

export const STOCK: Kit = { deck: 0, wheels: 0, bearings: 1, trucks: 0, trail: 0 };

/** One option for a part: its name, what it's like, and (bought) its item key. */
export interface Option {
  code: number;
  name: string;
  about: string;
  key?: string;
}

/** The decks' colours: the deck, the stripe under it, and (the glow deck) its light. */
export const DECKS: { color: number; stripe: number; glow?: number; shine?: boolean }[] = [
  { color: 0x3fa7e8, stripe: 0xffffff },
  { color: 0xe8566b, stripe: 0xffd23f },
  { color: 0xff8a3d, stripe: 0xfff3c4 },
  { color: 0xffd23f, stripe: 0xe8566b },
  { color: 0x7cd36a, stripe: 0x2a2433 },
  { color: 0xff8fc8, stripe: 0xffffff },
  { color: 0xa07ae8, stripe: 0xffd23f },
  { color: 0x2a2a33, stripe: 0xffffff },
  { color: 0xf4f1e8, stripe: 0xe8566b },
  { color: 0xe8b923, stripe: 0xfff3c4, shine: true },
  { color: 0x7dffc4, stripe: 0xd9fff0, glow: 0x5fffb0 },
];

export const OPTIONS: Record<Part, Option[]> = {
  deck: [
    { code: 0, name: "Classic Blue", about: "The one you started with." },
    { code: 1, name: "Cherry", about: "Red as they come.", key: "deck_red" },
    { code: 2, name: "Tangerine", about: "Bright orange.", key: "deck_orange" },
    { code: 3, name: "Sunshine", about: "Sunny yellow.", key: "deck_yellow" },
    { code: 4, name: "Lime", about: "Zesty green.", key: "deck_green" },
    { code: 5, name: "Bubblegum", about: "Pop pink.", key: "deck_pink" },
    { code: 6, name: "Grape", about: "Deep purple.", key: "deck_purple" },
    { code: 7, name: "Midnight", about: "All black, a white stripe.", key: "deck_black" },
    { code: 8, name: "Ivory", about: "Clean white.", key: "deck_white" },
    { code: 9, name: "Gold", about: "It shines.", key: "deck_gold" },
    { code: 10, name: "Glow-in-the-Dark", about: "It glows, for real. Best after dark.", key: "deck_glow" },
  ],
  wheels: [
    { code: 0, name: "Standard", about: "A good all-rounder." },
    { code: 1, name: "Small", about: "Quicker off the mark (a bit lower top speed).", key: "wheels_small" },
    { code: 2, name: "Big", about: "A higher top speed (a bit slower to pick up).", key: "wheels_big" },
  ],
  bearings: [
    { code: 1, name: "Lv 1", about: "Stock bearings." },
    { code: 2, name: "Lv 2", about: "Smoother: faster acceleration.", key: "bearings_2" },
    { code: 3, name: "Lv 3", about: "Faster still.", key: "bearings_3" },
    { code: 4, name: "Lv 4", about: "Ceramic. Zippy.", key: "bearings_4" },
    { code: 5, name: "Lv 5", about: "Swiss. Seriously quick.", key: "bearings_5" },
    { code: 6, name: "Pro", about: "Professional bearings: twice the acceleration of Lv 5. The fastest there is.", key: "bearings_pro" },
  ],
  trucks: [
    { code: 0, name: "Stock", about: "Ollies, an Indy grab, 50-50 grinds and manuals." },
    { code: 1, name: "Flip", about: "Every flip trick, doubles too.", key: "trucks_flip" },
    { code: 2, name: "Grind", about: "Every grind and grab, and steadier on rails.", key: "trucks_grind" },
    { code: 3, name: "Vert", about: "Full body flips off ramps, every grab, bigger air.", key: "trucks_vert" },
    { code: 4, name: "Pro", about: "Everything. The lot. Steady as a rock.", key: "trucks_pro" },
    { code: 5, name: "Surf", about: "Everything Pro does, a tighter carve, and pump: steer side to side, left-right-left-right, to fly along without pushing.", key: "trucks_surf" },
  ],
  trail: [
    { code: 0, name: "None", about: "No trail." },
    { code: 1, name: "Sparks", about: "A spray of sparks behind you.", key: "trail_spark" },
    { code: 2, name: "Neon", about: "A glowing neon line.", key: "trail_neon" },
    { code: 3, name: "Rainbow", about: "A rainbow, of course.", key: "trail_rainbow" },
    { code: 4, name: "Fire", about: "Flames. Hot.", key: "trail_fire" },
    { code: 5, name: "Galaxy", about: "A ribbon of space, with stars in it.", key: "trail_galaxy" },
  ],
};

/** What a build can do: how it rides, and which tricks it can do. */
export interface Ride {
  /** Times the stock push (acceleration) and top speed. */
  accel: number;
  top: number;
  /** Which flips (by stick, as `FLIPS`), doubles, every grab, every grind, body flips. */
  flips: Set<string>;
  doubles: boolean;
  grabs: boolean;
  grinds: boolean;
  body: boolean;
  /** Times the stock wobble on rails and manuals (less: steadier). */
  wobble: number;
  /** Times the stock air off a quarter pipe. */
  vert: number;
  /** Times the stock carve (how quick you turn; more, a tighter turn at speed). */
  turn: number;
  /** Surf trucks: steering side to side pumps you along (0: it doesn't). */
  pump: number;
}

const ALL_FLIPS = ["", "left", "right", "up", "down"];

export function ride(k: Kit): Ride {
  const wheel = [
    { accel: 1, top: 1 },
    { accel: 1.1, top: 0.92 },
    { accel: 0.93, top: 1.15 },
  ][k.wheels] ?? { accel: 1, top: 1 };
  const t = k.trucks;
  // (Surf trucks do all Pro trucks do, and pump.)
  const pro = t === 4 || t === 5;
  return {
    accel: wheel.accel * bearingAccel(k.bearings),
    top: wheel.top,
    flips: new Set(t === 1 || pro ? ALL_FLIPS : t === 3 ? ["", "left"] : []),
    doubles: t === 1 || pro,
    grabs: t >= 2,
    grinds: t === 2 || pro,
    body: t === 3 || pro,
    wobble: t === 2 ? 0.7 : pro ? 0.6 : 1,
    vert: t === 3 || pro ? 1.12 : 1,
    turn: t === 5 ? 1.25 : 1,
    pump: t === 5 ? 1 : 0,
  };
}

/** Times the stock acceleration, by bearings level: 12% more a level up to Lv 5; the Pro ones (6), twice Lv 5. */
export function bearingAccel(level: number): number {
  const lv = Math.max(1, Math.min(6, level));
  return lv === 6 ? 2 * bearingAccel(5) : 1 + 0.12 * (lv - 1);
}

/** The trucks a locked trick needs, to say so. */
export function needs(trick: "flip" | "double" | "grab" | "grind" | "body"): string {
  return { flip: "Flip trucks", double: "Flip trucks", grab: "Grind or Vert trucks", grind: "Grind trucks", body: "Vert trucks" }[trick];
}

// ---- packing it for others (`SkateOn.kit`) ----

export function packKit(k: Kit): number {
  return ((k.deck & 31) | ((k.wheels & 3) << 5) | ((k.bearings & 7) << 7) | ((k.trucks & 7) << 10) | ((k.trail & 15) << 13)) >>> 0;
}

export function unpackKit(n: number): Kit {
  return { deck: n & 31, wheels: (n >> 5) & 3, bearings: (n >> 7) & 7 || 1, trucks: (n >> 10) & 7, trail: (n >> 13) & 15 };
}

// ---- what you own, and what you ride ----

/** Whether you have option `code` of `part` (the stock ones, everyone does). */
export function owns(eco: Economy, part: Part, code: number): boolean {
  const o = OPTIONS[part].find((x) => x.code === code);
  if (!o) return false;
  if (!o.key) return true;
  const it = [...eco.items.values()].find((i) => i.key === o.key);
  return !!it && eco.qty(it.id) > 0;
}

/** The item for option `code` of `part` (none for a stock part). */
export function itemOf(eco: Economy, part: Part, code: number) {
  const key = OPTIONS[part].find((x) => x.code === code)?.key;
  return key ? [...eco.items.values()].find((i) => i.key === key) : undefined;
}

const STORE = "commons.skatekit";

/** The build you last picked on this device, each part one you (still) have. */
export function loadKit(eco: Economy): Kit {
  let k: Kit = { ...STOCK };
  try {
    k = { ...STOCK, ...(JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Kit>) };
  } catch {
    /* (Nothing kept: the stock build.) */
  }
  for (const part of Object.keys(STOCK) as Part[]) if (!owns(eco, part, k[part])) k[part] = STOCK[part];
  return k;
}

export function saveKit(k: Kit) {
  try {
    localStorage.setItem(STORE, JSON.stringify(k));
  } catch {
    /* (A private window: not kept.) */
  }
}
