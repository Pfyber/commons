// The skatepark's rules, with nothing drawn: the park's shape (where the
// concrete is, how high it stands where, the ramps, the rails and ledges),
// and a skater riding it, popping, flipping, grabbing, spinning, grinding
// and manualling, and the combo it all adds up to. `skate.ts` draws it and
// plays it; this is the same every frame for anyone, so it can be tested.
//
// Everything's in world pixels (32 to a tile), at the skater's feet: x east,
// y south (down the screen), and z up off the ground. Heights show the way
// the park's drawn: a thing `z` up is drawn `z` px higher on the screen.

import type { MapObject, ZoneMap } from "../world/map";
import type { Ride } from "./skatekit";

const TILE = 32;

// ---- the park ---------------------------------------------------------------

export type Dir = "n" | "s" | "e" | "w";
/** Which way is up a ramp facing `d` (its tall end's side). */
export const UP: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/** A kicker's height: as its label says ("s:16"), else by its size (a launch ramp's the big one). */
export function kickerHeight(o: MapObject): number {
  const h = Number((o.label ?? "").split(":")[1]);
  return h > 0 ? h : o.w * o.h >= 12 ? LAUNCH_H : KICKER_H;
}

/** A quarter pipe's height at its lip (px). */
export const QUARTER_H = 46;
/** A kicker's height at its top: the funbox's to meet the box, the launch ramp's a bit more. */
export const KICKER_H = 16;
export const LAUNCH_H = 22;
/** What you can roll up or down without leaving the ground (px). */
export const STEP = 7;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Ramp extends Rect {
  kind: "quarter" | "kicker" | "stairs";
  dir: Dir;
  /** Its height at its tall end. */
  h: number;
  id: number;
}

export interface Box extends Rect {
  h: number;
  id: number;
}

/** Something to grind: a rail, or a ledge's edge. From (ax, ay) up `za` to (bx, by) up `zb`. */
export interface Line {
  ax: number;
  ay: number;
  za: number;
  bx: number;
  by: number;
  zb: number;
  kind: "rail" | "ledge";
  id: number;
}

const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

/** How far up ramp `r` the point (x, y) is, 0 at its foot to 1 at its tall end. */
export function upAlong(r: Ramp, x: number, y: number): number {
  switch (r.dir) {
    case "n":
      return (r.y1 - y) / (r.y1 - r.y0);
    case "s":
      return (y - r.y0) / (r.y1 - r.y0);
    case "e":
      return (x - r.x0) / (r.x1 - r.x0);
    case "w":
      return (r.x1 - x) / (r.x1 - r.x0);
  }
}

/** Ramp `r`'s height at fraction `f` of the way up it. */
export function rampHeight(r: Ramp, f: number): number {
  f = Math.max(0, Math.min(1, f));
  if (r.kind === "quarter") return r.h * f * f;
  if (r.kind === "kicker") return r.h * Math.pow(f, 1.35);
  // Stairs: four steps down from the tall end.
  const steps = 4;
  return r.h * (Math.ceil(f * steps) / (steps + 1));
}

export class Park {
  /** The concrete's bounds (px), a tile round them for the gates. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly ramps: Ramp[] = [];
  readonly boxes: Box[] = [];
  readonly lines: Line[] = [];
  /** Concrete or not, by tile, over the bounds. */
  private mask: Uint8Array;
  private tx0: number;
  private ty0: number;
  private tw: number;
  private th: number;

  constructor(objects: MapObject[], concrete: (tx: number, ty: number) => boolean) {
    const park = objects.find((o) => o.kind === "sk_park");
    if (!park) throw new Error("no skatepark here");
    this.tx0 = park.x - 1;
    this.ty0 = park.y - 1;
    this.tw = park.w + 2;
    this.th = park.h + 2;
    this.x0 = this.tx0 * TILE;
    this.y0 = this.ty0 * TILE;
    this.x1 = (this.tx0 + this.tw) * TILE;
    this.y1 = (this.ty0 + this.th) * TILE;
    this.mask = new Uint8Array(this.tw * this.th);
    for (let y = 0; y < this.th; y++) for (let x = 0; x < this.tw; x++) this.mask[y * this.tw + x] = concrete(this.tx0 + x, this.ty0 + y) ? 1 : 0;
    objects.forEach((o, id) => {
      const r = { x0: o.x * TILE, y0: o.y * TILE, x1: (o.x + o.w) * TILE, y1: (o.y + o.h) * TILE };
      const label = o.label ?? "";
      if (o.kind === "sk_quarter") this.ramps.push({ ...r, kind: "quarter", dir: label as Dir, h: QUARTER_H, id });
      else if (o.kind === "sk_kicker") this.ramps.push({ ...r, kind: "kicker", dir: label.split(":")[0] as Dir, h: kickerHeight(o), id });
      else if (o.kind === "sk_stairs") {
        // "s:26": down to the south from 26 px up (so up the stairs is north).
        const [down, h] = label.split(":");
        const back: Record<string, Dir> = { n: "s", s: "n", e: "w", w: "e" };
        this.ramps.push({ ...r, kind: "stairs", dir: back[down] ?? "n", h: Number(h) || 24, id });
      } else if (o.kind === "sk_box") this.boxes.push({ ...r, h: Number(label) || 12, id });
      // (The shop van and the boards: walls, too tall to get up on.)
      else if (o.kind === "sk_shop" || o.kind === "sk_board") this.boxes.push({ ...r, h: 120, id });
      else if (o.kind === "sk_rail") {
        // "h:13:13": along the middle, west to east (or "v", north to south), from one height to the other.
        const [axis, a, b] = label.split(":");
        const za = Number(a) || 14;
        const zb = Number(b) || za;
        if (axis === "v") {
          const x = (r.x0 + r.x1) / 2;
          this.lines.push({ ax: x, ay: r.y0 + 4, za, bx: x, by: r.y1 - 4, zb, kind: "rail", id });
        } else {
          const y = (r.y0 + r.y1) / 2;
          this.lines.push({ ax: r.x0 + 4, ay: y, za, bx: r.x1 - 4, by: y, zb, kind: "rail", id });
        }
      }
    });
    // A box's edges are ledges to grind, those long enough, out in the open
    // (not where a ramp meets it, or the fence).
    for (const b of this.boxes) {
      if (b.h > 40) continue;
      const edges: [number, number, number, number, number, number][] = [
        [b.x0, b.y0, b.x1, b.y0, 0, -1],
        [b.x0, b.y1, b.x1, b.y1, 0, 1],
        [b.x0, b.y0, b.x0, b.y1, -1, 0],
        [b.x1, b.y0, b.x1, b.y1, 1, 0],
      ];
      for (const [ax, ay, bx, by, nx, ny] of edges) {
        if (Math.hypot(bx - ax, by - ay) < 2 * TILE) continue;
        const mx = (ax + bx) / 2 + nx * 8;
        const my = (ay + by) / 2 + ny * 8;
        if (!this.concrete(mx, my)) continue;
        if (this.ramps.some((r) => inRect(r, mx, my))) continue;
        const inset = 3;
        const [sx, sy] = [Math.sign(bx - ax), Math.sign(by - ay)];
        this.lines.push({ ax: ax + sx * inset, ay: ay + sy * inset, za: b.h, bx: bx - sx * inset, by: by - sy * inset, zb: b.h, kind: "ledge", id: b.id });
      }
    }
  }

  static fromMap(map: ZoneMap): Park | null {
    if (!map.objects.some((o) => o.kind === "sk_park")) return null;
    // The concrete, and the road where it runs through the park (skated too).
    const skate = map.ground_legend.indexOf("skate");
    const road = map.ground_legend.indexOf("skate_road");
    return new Park(map.objects, (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
      const g = map.ground[ty * map.width + tx];
      return g === skate || (road >= 0 && g === road);
    });
  }

  /** Whether (x, y) is on the concrete. */
  concrete(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE) - this.tx0;
    const ty = Math.floor(y / TILE) - this.ty0;
    return tx >= 0 && ty >= 0 && tx < this.tw && ty < this.th && this.mask[ty * this.tw + tx] === 1;
  }

  /** Whether the tile (tx, ty) is on the concrete. */
  concreteTile(tx: number, ty: number): boolean {
    return this.concrete(tx * TILE + 16, ty * TILE + 16);
  }

  /** How high the park stands at (x, y). */
  height(x: number, y: number): number {
    let z = 0;
    for (const b of this.boxes) if (b.h > z && inRect(b, x, y)) z = b.h;
    for (const r of this.ramps) {
      if (!inRect(r, x, y)) continue;
      const h = rampHeight(r, upAlong(r, x, y));
      if (h > z) z = h;
    }
    return z;
  }

  /**
   * Coming from (x, y) to (nx, ny) into a quarter pipe or kicker over its
   * tall end (from the deck behind it): the ramp you drop in on, else null.
   */
  dropInto(x: number, y: number, nx: number, ny: number): Ramp | null {
    const r = this.rampAt(nx, ny);
    if (!r || r.kind === "stairs" || inRect(r, x, y)) return null;
    switch (r.dir) {
      case "n":
        return y < r.y0 ? r : null;
      case "s":
        return y >= r.y1 ? r : null;
      case "e":
        return x >= r.x1 ? r : null;
      case "w":
        return x < r.x0 ? r : null;
    }
  }

  /** The ramp (if any) at (x, y). */
  rampAt(x: number, y: number): Ramp | null {
    for (const r of this.ramps) if (inRect(r, x, y)) return r;
    return null;
  }

  boxAt(x: number, y: number): Box | null {
    for (const b of this.boxes) if (inRect(b, x, y)) return b;
    return null;
  }

  /** How steep it is at (x, y): the rise per px east and per px south. */
  slope(x: number, y: number): [number, number] {
    // (Each way, the gentler side: at an edge, a step down off a box or the
    // deck behind a ramp's lip, isn't the slope you're on.)
    const e = 2;
    const h = this.height(x, y);
    const gentle = (a: number, b: number) => (Math.abs(a) < Math.abs(b) ? a : b) / e;
    return [gentle(this.height(x + e, y) - h, h - this.height(x - e, y)), gentle(this.height(x, y + e) - h, h - this.height(x, y - e))];
  }

  /** Whether you can't be at (x, y) at height z: off the concrete, or inside something. */
  blocked(x: number, y: number, z: number): boolean {
    return !this.concrete(x, y) || this.height(x, y) > z + STEP;
  }

  /** Whether (x, y) is inside the park's bounds (on it or by it). */
  near(x: number, y: number): boolean {
    return x >= this.x0 && x < this.x1 && y >= this.y0 && y < this.y1;
  }
}

// ---- tricks -----------------------------------------------------------------

/** Which way the stick's held, as the trick tables read it. */
export type Stick = "" | "up" | "down" | "left" | "right";

export function stickOf(x: number, y: number): Stick {
  if (Math.hypot(x, y) < 0.45) return "";
  return Math.abs(x) > Math.abs(y) ? (x < 0 ? "left" : "right") : y < 0 ? "up" : "down";
}

export const FLIPS: Record<Stick, { name: string; pts: number; ms: number; kind: number }> = {
  "": { name: "Kickflip", pts: 100, ms: 330, kind: 1 },
  left: { name: "Heelflip", pts: 100, ms: 330, kind: 2 },
  right: { name: "Varial Kickflip", pts: 150, ms: 380, kind: 3 },
  up: { name: "Hardflip", pts: 150, ms: 380, kind: 4 },
  down: { name: "Pop Shove-It", pts: 80, ms: 300, kind: 5 },
};
export const GRABS: Record<Stick, { name: string; pts: number }> = {
  "": { name: "Indy", pts: 120 },
  left: { name: "Melon", pts: 120 },
  right: { name: "Stalefish", pts: 150 },
  up: { name: "Nosegrab", pts: 120 },
  down: { name: "Tailgrab", pts: 120 },
};
/**
 * Space in the air off a ramp: the whole skater goes head over heels, all
 * the way round (`dir` -1 backwards, 1 forwards), by the way the stick's held.
 */
export const BODY_FLIPS: Record<Stick, { name: string; pts: number; dir: number }> = {
  "": { name: "Backflip", pts: 400, dir: -1 },
  down: { name: "Backflip", pts: 400, dir: -1 },
  up: { name: "Frontflip", pts: 400, dir: 1 },
  left: { name: "Rodeo Flip", pts: 500, dir: -1 },
  right: { name: "Misty Flip", pts: 500, dir: 1 },
};
/** How long a body flip takes (s); come down past this much of it and it counts. */
const BODY_S = 0.55;
const BODY_LANDS = 0.8;
export const GRINDS: Record<Stick, string> = {
  "": "50-50",
  left: "Boardslide",
  right: "Smith",
  up: "Nosegrind",
  down: "5-0",
};

/** What a skater's doing, for others to see (`SkateMove.trick`): flips 1–5 (a double +8), a grab 16 + which. */
export const TRICK = { NONE: 0, GRAB: 16, DOUBLE: 8, BACKFLIP: 24, FRONTFLIP: 25 };

// ---- the combo ----------------------------------------------------------------

export interface Trick {
  name: string;
  pts: number;
}

/** Tricks strung together: their points added, times how many (THPS's rule); a trick done again counts for less. */
export class Combo {
  tricks: Trick[] = [];
  base = 0;
  private seen = new Map<string, number>();

  add(name: string, pts: number): number {
    const n = this.seen.get(name) ?? 0;
    this.seen.set(name, n + 1);
    const worth = Math.max(5, Math.round(pts * Math.pow(0.5, n)));
    this.tricks.push({ name, pts: worth });
    this.base += worth;
    return worth;
  }

  /** Points piling up on what's going on now (a grind, a manual): added to its last trick. */
  grow(pts: number) {
    const last = this.tricks[this.tricks.length - 1];
    if (!last) return;
    last.pts += pts;
    this.base += pts;
  }

  get count(): number {
    return this.tricks.length;
  }

  get total(): number {
    return Math.round(this.base) * this.count;
  }

  /** Its name: the tricks in it (the first few, and how many more). */
  get label(): string {
    const names = this.tricks.map((t) => t.name);
    return names.length <= 5 ? names.join(" + ") : `${names.slice(0, 4).join(" + ")} + ${names.length - 4} more`;
  }

  clear() {
    this.tricks = [];
    this.base = 0;
    this.seen.clear();
  }
}

// ---- the skater -----------------------------------------------------------------

export type Mode = "ground" | "air" | "grind" | "manual" | "bail";

export interface Input {
  /** The stick (or arrow keys): -1–1 each way, screen directions. */
  x: number;
  y: number;
  /** Pop (held down to crouch, let go to ollie). */
  pop: boolean;
  /** Pressed this frame: flip, manual. */
  flip: boolean;
  manual: boolean;
  /** Held: grab, spin (-1 anticlockwise, 1 clockwise). */
  grab: boolean;
  spin: number;
}

export const NO_INPUT: Input = { x: 0, y: 0, pop: false, flip: false, manual: false, grab: false, spin: 0 };

export type SkateEvent =
  | { t: "pop"; power: number }
  | { t: "push" }
  | { t: "land"; hard: number; z: number }
  | { t: "trick"; name: string; pts: number }
  | { t: "flip"; kind: number }
  | { t: "grind"; on: boolean; kind: "rail" | "ledge" }
  | { t: "manual"; on: boolean }
  | { t: "wall"; speed: number }
  | { t: "bail"; why: string; lost: number }
  | { t: "bank"; pts: number; label: string; count: number }
  | { t: "special" }
  | { t: "sketchy" }
  /** A trick your trucks can't do (a hint, at most now and then). */
  | { t: "locked"; what: "flip" | "double" | "grab" | "grind" | "body" };

/** One push off and the glide after it (s): the avatars' own stroke (520 ms) and glide (750). */
export const PUSH_S = 1.27;
const GRAVITY = 950;
/** A push's shove (px/s², while the foot's down: from `KICK_FROM` to `KICK_TO` s into the stroke, as the legs show it). */
const KICK_ACC = 300;
const KICK_FROM = 0.07;
const KICK_TO = 0.42;
const PUSH_MAX = 250;
const TOP_SPEED = 520;

/** Everything unlocked, at stock speed (the rules on their own: the tests, and before the shop's been seen). */
export const OPEN_RIDE: Ride = { accel: 1, top: 1, flips: new Set(["", "left", "right", "up", "down"]), doubles: true, grabs: true, grinds: true, body: true, wobble: 1, vert: 1 };
const BRAKE = 560;
const FRICTION = 16;
/** How hard a slope pulls you along it (px/s² per unit of rise per px). */
const SLOPE_PULL = 300;
const OLLIE = 240;
const OLLIE_CHARGED = 160;
/** Popped going up a ramp's face: how much of your speed up it goes into the pop. */
const RAMP_POP_K = 0.85;
const CHARGE_S = 0.45;
/** Up the face of a quarter pipe and out: how much of your speed goes up. */
const VERT_K = 1.3;
/** Off the top of a kicker. */
const KICK_K = 0.75;
/** Spinning, rad/s. */
const SPIN_RATE = 10.5;
/** How far off straight a landing can be and still be ridden away (rad). */
const LAND_SLOP = 0.8;
/** After landing, how long a manual can still be started to keep the combo (s). */
const LINK_S = 0.4;
/** How long a bail keeps you down (s). */
const BAIL_S = 1.3;

/** The angle `a` brought into (-π, π]. */
export function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

export class Skater {
  x: number;
  y: number;
  z: number;
  vz = 0;
  /** Which way the board's rolling (rad: 0 east, π/2 south), and how fast (px/s). */
  heading = 0;
  speed = 0;
  /** In the air: moving across the ground. */
  vx = 0;
  vy = 0;
  mode: Mode = "ground";
  /** Riding backwards. */
  fakie = false;
  /** Holding pop down this long (s): the crouch, to ollie higher. */
  crouch = 0;
  private popWas = false;
  /** Pushing off: the stroke's phase (s), for the legs and the scuffs. */
  push = 0;
  pushing = false;

  // In the air.
  /** In the air: for how long (s), off a quarter pipe's lip (or not), the spin so far (rad), from where, what it's flown over, where its tricks start in the combo. */
  air = { t: 0, vert: null as Ramp | null, spin: 0, from: { x: 0, y: 0, z: 0 }, over: new Set<number>(), first: 0, popped: false, launch: null as Ramp | null, ramp: false };
  /** Head over heels (a Space trick off a ramp): how far round (s of `dur`), which way. */
  body: { name: string; pts: number; t: number; dur: number; dir: number } | null = null;
  flip: { kind: number; name: string; pts: number; t: number; dur: number; double: boolean } | null = null;
  /** A grab: held while K is (or for `auto` s more, a Space trick). */
  grab: { name: string; pts: number; t: number; auto: number } | null = null;
  /** Grinding: what, which way along it, where along it (0–1), its name. */
  grind: { line: Line; dir: number; f: number; speed: number; name: string; t: number } | null = null;
  /** Grinds and manuals: the balance (−1 to 1: off is a bail) and how it's tipping. */
  balance = 0;
  private tip = 0;
  manualT = 0;
  /** Down (a bail): for how long more (s), and which way the board went. */
  bailT = 0;
  bailDir = 0;
  /** Just landed: how long left to start a manual (s). */
  link = 0;
  /** A manual asked for just before landing (s left to count). */
  private manualWanted = 0;
  /** The special meter (0–1); full, every trick's worth more. */
  special = 0;

  combo = new Combo();
  /** Points banked this session. */
  banked = 0;
  bestCombo = 0;

  constructor(
    private park: Park,
    x: number,
    y: number,
    private rand: () => number = Math.random,
  ) {
    this.x = x;
    this.y = y;
    this.z = park.height(x, y);
  }

  get spinning(): number {
    return this.air.spin;
  }

  /** How high above what's under it the board is (px). */
  get clearance(): number {
    return this.z - this.park.height(this.x, this.y);
  }

  /** Off the board now, and back on in a moment. */
  get down(): boolean {
    return this.mode === "bail";
  }

  /** What the trick in progress looks like to others (`TRICK`). */
  get trickCode(): number {
    if (this.body) return this.body.dir < 0 ? TRICK.BACKFLIP : TRICK.FRONTFLIP;
    if (this.flip) return this.flip.kind + (this.flip.double ? TRICK.DOUBLE : 0);
    if (this.grab) return TRICK.GRAB;
    return TRICK.NONE;
  }

  /** What your board's built from lets you do (`skatekit.ts`). */
  kit: Ride = OPEN_RIDE;

  /** A flip of the board, by which way the stick's held (if your trucks can). */
  private startFlip(inp: Input, ev: SkateEvent[]) {
    const s = stickOf(inp.x, inp.y);
    if (!this.kit.flips.has(s)) {
      ev.push({ t: "locked", what: "flip" });
      return;
    }
    const f = FLIPS[s];
    this.flip = { kind: f.kind, name: f.name, pts: f.pts, t: 0, dur: f.ms, double: false };
    ev.push({ t: "flip", kind: f.kind });
  }

  /** One step of `dt` seconds. */
  step(dt: number, inp: Input): SkateEvent[] {
    const ev: SkateEvent[] = [];
    if (inp.manual && this.mode === "air") this.manualWanted = 0.25;
    this.manualWanted = Math.max(0, this.manualWanted - dt);
    switch (this.mode) {
      case "ground":
        this.ground(dt, inp, ev);
        break;
      case "manual":
        this.manualStep(dt, inp, ev);
        break;
      case "air":
        this.airStep(dt, inp, ev);
        break;
      case "grind":
        this.grindStep(dt, inp, ev);
        break;
      case "bail":
        this.bailT -= dt;
        this.speed = Math.max(0, this.speed - 500 * dt);
        this.slide(dt);
        if (this.bailT <= 0) {
          this.mode = "ground";
          this.speed = 0;
          this.z = this.park.height(this.x, this.y);
        }
        break;
    }
    this.popWas = inp.pop;
    // The special meter ebbs away slowly when nothing's going on.
    if (this.combo.count === 0) this.special = Math.max(0, this.special - dt * 0.02);
    return ev;
  }

  // ---- on the ground ----

  private ground(dt: number, inp: Input, ev: SkateEvent[]) {
    const mag = Math.min(1, Math.hypot(inp.x, inp.y));
    this.pushing = false;
    if (mag > 0.2) {
      const want = Math.atan2(inp.y, inp.x);
      const diff = wrap(want - this.heading);
      if (Math.abs(diff) < 2.2 || this.speed < 25) {
        // Carve round toward where you're steering (quick slow, wide fast).
        const rate = 7 - 3.6 * Math.min(1, this.speed / 320);
        this.heading = this.speed < 25 && Math.abs(diff) >= 2.2 ? want : wrap(this.heading + Math.max(-rate * dt, Math.min(rate * dt, diff)));
        // Pushing off, while you're going your way and not flat out.
        const max = PUSH_MAX * this.kit.top;
        if (Math.abs(diff) < 1.2 && this.speed < max && this.crouch === 0) {
          this.pushing = true;
          // The speed comes in kicks: while the back foot's on the ground, a
          // shove (less, the faster you're going already); between, a glide.
          if (this.push >= KICK_FROM && this.push < KICK_TO) {
            this.speed = Math.min(max, this.speed + KICK_ACC * this.kit.accel * mag * (1 - 0.6 * (this.speed / max)) * dt);
          }
        }
      } else {
        // Pulling back: dragging a foot to stop.
        this.speed = Math.max(0, this.speed - BRAKE * dt);
      }
    }
    if (this.pushing) {
      const was = this.push;
      this.push = (this.push + dt) % PUSH_S;
      // (The scuff as the foot hits the ground.)
      if (was < KICK_FROM && this.push >= KICK_FROM) ev.push({ t: "push" });
    } else this.push = 0;
    this.speed = Math.max(0, this.speed - FRICTION * dt);
    this.rollOnSlopes(dt);
    // The combo: just landed, a moment to catch it in a manual, else it's banked.
    if (this.link > 0) {
      this.link -= dt;
      if (this.manualWanted > 0 || inp.manual) {
        this.startManual(ev);
        return;
      }
      if (this.link <= 0) this.bank(ev);
    }
    // Pop: crouch while it's held, ollie on letting go. (Only a manual
    // carries a combo on past a landing: popping again banks it first.)
    if (inp.pop) this.crouch += dt;
    if (!inp.pop && this.popWas) {
      if (this.link > 0) this.bank(ev);
      const power = Math.min(1, this.crouch / CHARGE_S);
      this.crouch = 0;
      this.ollie(OLLIE + OLLIE_CHARGED * power, ev, inp);
      ev.push({ t: "pop", power });
      return;
    }
    if (inp.manual && this.speed > 40) {
      this.startManual(ev);
      return;
    }
    this.roll(dt, ev);
  }

  /** Gravity along the slope you're on: up it slows you, down it speeds you. Too slow up a ramp: you roll back down it (fakie). */
  private rollOnSlopes(dt: number) {
    const [gx, gy] = this.park.slope(this.x, this.y);
    const along = gx * Math.cos(this.heading) + gy * Math.sin(this.heading);
    this.speed -= SLOPE_PULL * along * dt;
    if (this.speed < 0) {
      this.speed = -this.speed;
      this.heading = wrap(this.heading + Math.PI);
      this.fakie = !this.fakie;
    }
    this.speed = Math.min(TOP_SPEED * this.kit.top, this.speed);
  }

  /** Rolls along the ground: up ramps, out over their lips, off edges, into walls. */
  private roll(dt: number, ev: SkateEvent[]) {
    const cx = Math.cos(this.heading);
    const cy = Math.sin(this.heading);
    const nx = this.x + cx * this.speed * dt;
    const ny = this.y + cy * this.speed * dt;
    // Up a ramp and over its lip: a quarter pipe sends you straight up (you
    // come down on it again), a kicker out into the air.
    const r = this.park.rampAt(this.x, this.y);
    if (r && r.kind !== "stairs") {
      const [ux, uy] = UP[r.dir];
      const up = cx * ux + cy * uy;
      if (up > 0.25 && upAlong(r, nx, ny) >= 0.985) {
        if (r.kind === "quarter") return this.vertAir(r, up, ev);
        return this.launch(r, up, ev);
      }
    }
    const h = this.park.height(nx, ny);
    // Into a ramp over its tall end, from behind: dropping in, over the
    // coping and down its face (it's no wall from the deck side).
    if (h > this.z + STEP && this.park.concrete(nx, ny) && this.park.dropInto(this.x, this.y, nx, ny)) {
      this.x = nx;
      this.y = ny;
      this.z = h;
      this.trick("Drop In", 75, ev);
      this.link = LINK_S;
      return;
    }
    if (!this.park.concrete(nx, ny) || h > this.z + STEP) {
      this.hitWall(nx, ny, ev);
      return;
    }
    this.x = nx;
    this.y = ny;
    if (h < this.z - STEP) {
      // Rolled off an edge: falling.
      this.toAir(0, null, false);
      return;
    }
    this.z = h;
  }

  private hitWall(nx: number, ny: number, ev: SkateEvent[]) {
    const bx = this.park.blocked(nx, this.y, this.z);
    const by = this.park.blocked(this.x, ny, this.z);
    const cx = Math.cos(this.heading);
    const cy = Math.sin(this.heading);
    const speed = this.speed;
    if (bx && !by) this.heading = Math.atan2(cy, -cx);
    else if (by && !bx) this.heading = Math.atan2(-cy, cx);
    else this.heading = wrap(this.heading + Math.PI);
    this.speed *= 0.35;
    if (speed > 40) ev.push({ t: "wall", speed });
  }

  private ollie(vz: number, ev: SkateEvent[], inp: Input = NO_INPUT) {
    // Popped going up a kicker or a quarter pipe: out the way you're going,
    // higher the faster you're going up it (off one ramp and onto another,
    // or right over it).
    const r = this.park.rampAt(this.x, this.y);
    let up = 0;
    if (r && r.kind !== "stairs") {
      const [ux, uy] = UP[r.dir];
      up = Math.max(0, Math.cos(this.heading) * ux + Math.sin(this.heading) * uy) * Math.max(0.35, upAlong(r, this.x, this.y));
    }
    this.toAir(vz + up * this.speed * (r?.kind === "kicker" ? KICK_K : RAMP_POP_K), null, true);
    if (r && up > 0.05) {
      this.air.launch = r;
      this.air.ramp = true;
      // Space and a direction: out off the ramp that way (ramp to ramp).
      if (Math.hypot(inp.x, inp.y) > 0.5) {
        const a = Math.atan2(inp.y, inp.x);
        const sp = Math.max(Math.hypot(this.vx, this.vy), 180);
        this.vx = Math.cos(a) * sp;
        this.vy = Math.sin(a) * sp;
        this.heading = a;
      }
    }
    void ev;
  }

  private toAir(vz: number, vert: Ramp | null, popped: boolean) {
    const was = this.mode;
    this.mode = "air";
    this.vz = vz;
    if (!vert) {
      this.vx = Math.cos(this.heading) * this.speed;
      this.vy = Math.sin(this.heading) * this.speed;
    }
    // A trick from a grind or a manual carries on into the air: the combo goes on.
    this.air = { t: 0, vert, spin: 0, from: { x: this.x, y: this.y, z: this.z }, over: new Set(), first: this.combo.count, popped, launch: null, ramp: !!vert };
    void was;
  }

  /** Straight up off a quarter pipe's lip: across its lip you keep going, out from it you don't. */
  private vertAir(r: Ramp, up: number, ev: SkateEvent[]) {
    const [ux, uy] = UP[r.dir];
    const vx = Math.cos(this.heading) * this.speed;
    const vy = Math.sin(this.heading) * this.speed;
    const along = vx * ux + vy * uy;
    this.toAir(Math.max(160, along * VERT_K * this.kit.vert + 40), r, false);
    // Across the lip only.
    this.vx = vx - along * ux;
    this.vy = vy - along * uy;
    // Just inside the lip, so it's the ramp you come down on.
    if (r.dir === "n") this.y = r.y0 + 5;
    if (r.dir === "s") this.y = r.y1 - 5;
    if (r.dir === "e") this.x = r.x1 - 5;
    if (r.dir === "w") this.x = r.x0 + 5;
    this.z = this.park.height(this.x, this.y);
    this.air.from.z = this.z;
    void up;
    void ev;
  }

  /** Off the top of a kicker: out into the air, as fast as you came. */
  private launch(r: Ramp, up: number, ev: SkateEvent[]) {
    this.toAir(this.speed * up * KICK_K + 60, null, false);
    this.air.launch = r;
    this.air.ramp = true;
    void ev;
  }

  // ---- in the air ----

  private airStep(dt: number, inp: Input, ev: SkateEvent[]) {
    const a = this.air;
    a.t += dt;
    this.vz -= GRAVITY * dt;
    // A little steering in the air (none out from a quarter pipe's face).
    const ctl = a.vert ? 60 : 110;
    this.vx += inp.x * ctl * dt;
    this.vy += inp.y * ctl * dt;
    if (a.vert) {
      const [ux, uy] = UP[a.vert.dir];
      // Held out over the lip: you carry on out of the ramp, over its deck
      // (onto the next one), instead of straight back down into it.
      if (a.t > 0.1 && inp.x * ux + inp.y * uy > 0.6) {
        a.vert = null;
        this.vx += ux * 170;
        this.vy += uy * 170;
      } else {
        const out = this.vx * ux + this.vy * uy;
        this.vx -= out * ux;
        this.vy -= out * uy;
      }
    }
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const nz = this.z + this.vz * dt;
    // Into a ramp over its tall end: come down onto it, not off it like a wall.
    if (this.park.blocked(nx, ny, nz) && this.park.concrete(nx, ny) && this.park.dropInto(this.x, this.y, nx, ny)) {
      this.x = nx;
      this.y = ny;
      this.z = Math.max(nz, this.park.height(nx, ny));
      this.land(this.park.height(nx, ny), ev);
      return;
    }
    // Into a wall (or off the concrete): bounce back off it.
    if (this.park.blocked(nx, ny, nz)) {
      const bx = this.park.blocked(nx, this.y, nz);
      const by = this.park.blocked(this.x, ny, nz);
      if (bx || !by) this.vx *= -0.3;
      if (by || !bx) this.vy *= -0.3;
      if (!bx && by) this.x = nx;
      if (!by && bx) this.y = ny;
    } else {
      this.x = nx;
      this.y = ny;
    }
    this.z = nz;
    for (const b of this.park.boxes) if (inRect(b, this.x, this.y)) a.over.add(b.id);
    for (const r of this.park.ramps) if (r.kind === "stairs" && inRect(r, this.x, this.y)) a.over.add(r.id);
    // Spinning.
    if (inp.spin) a.spin += inp.spin * SPIN_RATE * dt;
    // A flip: by which way the stick's held; pressed again early, a double.
    if (this.flip) {
      this.flip.t += dt * 1000;
      if (this.flip.t >= this.flip.dur) {
        this.trick(this.flip.double ? `Double ${this.flip.name}` : this.flip.name, this.flip.double ? this.flip.pts * 2.4 : this.flip.pts, ev);
        this.flip = null;
      }
    }
    if (inp.flip) {
      if (this.flip && !this.flip.double && this.flip.t < this.flip.dur * 0.7) {
        if (this.kit.doubles) {
          this.flip.double = true;
          this.flip.dur += this.flip.dur * 0.75;
          ev.push({ t: "flip", kind: this.flip.kind });
        } else ev.push({ t: "locked", what: "double" });
      } else if (!this.flip && !this.grab) this.startFlip(inp, ev);
    }
    // Head over heels, going round.
    if (this.body) {
      this.body.t += dt;
      if (this.body.t >= this.body.dur) {
        this.trick(this.body.name, this.body.pts, ev);
        this.body = null;
      }
    }
    // Space in the air: a trick. Off a ramp, the whole skater flips right
    // round (which way by the stick); anywhere else, a flip of the board (as J).
    if (inp.pop && !this.popWas && !this.flip && !this.grab && !this.body) {
      if (a.ramp && this.kit.body) {
        const f = BODY_FLIPS[stickOf(inp.x, inp.y)];
        this.body = { name: f.name, pts: f.pts, t: 0, dur: BODY_S, dir: f.dir };
        ev.push({ t: "flip", kind: 0 });
      } else if (a.ramp && this.kit.flips.size === 0) ev.push({ t: "locked", what: "body" });
      else this.startFlip(inp, ev);
    }
    // A grab, held (worth more the longer).
    if ((inp.grab || (this.grab && this.grab.auto > 0)) && !this.flip && !this.body) {
      if (!this.grab) {
        // (Stock trucks: the Indy, whichever way the stick's held.)
        const g = GRABS[this.kit.grabs ? stickOf(inp.x, inp.y) : ""];
        if (!this.kit.grabs && stickOf(inp.x, inp.y)) ev.push({ t: "locked", what: "grab" });
        this.grab = { name: g.name, pts: g.pts, t: 0, auto: 0 };
      }
      this.grab.t += dt;
      this.grab.auto = Math.max(0, this.grab.auto - dt);
    } else if (this.grab) {
      this.endGrab(ev, false);
    }
    // Onto a rail or a ledge (not mid-flip, head over heels).
    if (this.vz < 80 && !this.body && this.tryGrind(inp, ev)) return;
    // Down.
    const ground = this.park.height(this.x, this.y);
    if (this.z <= ground) this.land(ground, ev);
  }

  private endGrab(ev: SkateEvent[], sketchy: boolean) {
    const g = this.grab!;
    const held = Math.min(1.5, g.t);
    this.trick(g.name, (g.pts + Math.floor(held * 10) * 30) * (sketchy ? 0.6 : 1), ev);
    this.grab = null;
  }

  private land(ground: number, ev: SkateEvent[]) {
    const a = this.air;
    const fall = -this.vz;
    this.z = ground;
    // Mid-flip, or come down sideways: down you go.
    const turned = Math.abs(a.spin);
    const off = turned % Math.PI;
    const crooked = Math.min(off, Math.PI - off);
    if (this.body) {
      // Nearly round: it's landed (and it counts). Short of that, on your head.
      if (this.body.t / this.body.dur < BODY_LANDS) return this.bail("Didn't make it round!", ev);
      this.trick(this.body.name, this.body.pts, ev);
      this.body = null;
    }
    if (this.flip) return this.bail("Didn't finish the flip!", ev);
    if (crooked > LAND_SLOP) return this.bail("Landed sideways!", ev);
    if (this.grab) {
      this.endGrab(ev, true);
      ev.push({ t: "sketchy" });
    }
    const halves = Math.round(turned / Math.PI);
    // Back on the ground: off a quarter pipe, rolling back down it; else on the way you were going.
    if (a.vert) {
      const [ux, uy] = UP[a.vert.dir];
      const down = Math.max(60, fall / VERT_K);
      this.heading = Math.atan2(this.vy - uy * down, this.vx - ux * down);
      this.speed = Math.hypot(this.vx - ux * down, this.vy - uy * down) * 0.97;
    } else {
      const s = Math.hypot(this.vx, this.vy);
      if (s > 5) this.heading = Math.atan2(this.vy, this.vx);
      this.speed = s * 0.96;
    }
    // A half turn (or three) and you ride away backwards.
    if (halves % 2 === 1) this.fakie = !this.fakie;
    this.mode = "ground";
    this.vx = 0;
    this.vy = 0;
    // What the air was worth: the spin on the first trick ("360 Kickflip"), or on its own.
    const spin = halves * 180;
    const first = this.combo.tricks[a.first];
    const tricked = this.combo.count > a.first;
    if (spin >= 180) {
      if (first) {
        first.name = `${spin} ${first.name}`;
        first.pts += halves * 60;
        this.combo.base += halves * 60;
      } else this.trick(`${spin} ${a.vert ? "Air" : "Ollie"}`, halves * 70, ev);
    } else if (!tricked) {
      if (a.vert && a.t > 0.25) this.trick("Air", 50, ev);
      else if (a.popped && a.t > 0.2) this.trick("Ollie", 25, ev);
    }
    if (a.t > 0.95) this.trick("Big Air", 120, ev);
    // Off one kicker and down another, over the flat between.
    const onto = this.park.rampAt(this.x, this.y);
    if (a.launch && onto && onto.kind === "kicker" && onto.id !== a.launch.id) this.trick("Kicker Gap", 300, ev);
    // Gaps: right over the funbox, down the stair set.
    for (const id of a.over) {
      const b = this.park.boxes.find((x) => x.id === id);
      const r = this.park.ramps.find((x) => x.id === id);
      if (b && b.h <= 16 && b.x1 - b.x0 >= 4 * TILE && a.from.z > 0 && !this.park.boxAt(this.x, this.y) && !this.park.boxAt(a.from.x, a.from.y)) this.trick("Funbox Gap", 250, ev);
      if (r && r.kind === "stairs" && a.from.z >= r.h - 2 && ground < 4) this.trick("Stair Set", 300, ev);
    }
    ev.push({ t: "land", hard: fall, z: ground });
    if (this.combo.count > 0) this.link = LINK_S;
    if (this.manualWanted > 0 && this.combo.count > 0) this.startManual(ev);
  }

  // ---- grinds ----

  private tryGrind(inp: Input, ev: SkateEvent[]): boolean {
    const speed = Math.hypot(this.vx, this.vy);
    if (speed < 50 || this.air.t < 0.08) return false;
    for (const l of this.park.lines) {
      const dx = l.bx - l.ax;
      const dy = l.by - l.ay;
      const len = Math.hypot(dx, dy);
      const f = ((this.x - l.ax) * dx + (this.y - l.ay) * dy) / (len * len);
      if (f < 0 || f > 1) continue;
      const px = l.ax + dx * f;
      const py = l.ay + dy * f;
      if (Math.hypot(this.x - px, this.y - py) > 11) continue;
      const lz = l.za + (l.zb - l.za) * f;
      if (this.z < lz - 8 || this.z > lz + 16) continue;
      // Along it, not across it.
      const along = (this.vx * dx + this.vy * dy) / len;
      if (Math.abs(along) < speed * 0.5) continue;
      const style = this.kit.grinds ? stickOf(inp.x, inp.y) : "";
      if (!this.kit.grinds && stickOf(inp.x, inp.y)) ev.push({ t: "locked", what: "grind" });
      const name = `${GRINDS[style]}${l.kind === "ledge" ? "" : " Grind"}`;
      this.mode = "grind";
      this.grind = { line: l, dir: Math.sign(along), f, speed: Math.max(140, Math.abs(along)), name, t: 0 };
      this.x = px;
      this.y = py;
      this.z = lz;
      this.flip = null;
      if (this.grab) this.endGrab(ev, false);
      this.balance = (this.rand() - 0.5) * 0.2;
      this.tip = (this.rand() - 0.5) * 0.6;
      this.trick(name, 100, ev);
      ev.push({ t: "grind", on: true, kind: l.kind });
      return true;
    }
    return false;
  }

  private grindStep(dt: number, inp: Input, ev: SkateEvent[]) {
    const g = this.grind!;
    const l = g.line;
    const len = Math.hypot(l.bx - l.ax, l.by - l.ay);
    g.t += dt;
    // Downhill (a handrail) it speeds you up; along the flat it slows you a little.
    const drop = ((l.zb - l.za) / len) * g.dir;
    g.speed = Math.min(TOP_SPEED * this.kit.top, Math.max(80, g.speed - (30 + drop * 500) * dt));
    g.f += (g.dir * g.speed * dt) / len;
    this.balanceStep(dt, inp.x, g.t);
    this.combo.grow(dt * 90);
    const ux = ((l.bx - l.ax) / len) * g.dir;
    const uy = ((l.by - l.ay) / len) * g.dir;
    this.heading = Math.atan2(uy, ux);
    if (Math.abs(this.balance) > 1) {
      this.leaveGrind(ev);
      return this.bail("Lost your balance!", ev);
    }
    if (g.f < 0 || g.f > 1) {
      // Off the end.
      g.f = Math.max(0, Math.min(1, g.f));
      this.leaveGrind(ev);
      this.speed = g.speed;
      this.toAir(40, null, false);
      this.vx = ux * g.speed;
      this.vy = uy * g.speed;
      return;
    }
    this.x = l.ax + (l.bx - l.ax) * g.f;
    this.y = l.ay + (l.by - l.ay) * g.f;
    this.z = l.za + (l.zb - l.za) * g.f;
    // Pop off it.
    if (!inp.pop && this.popWas) {
      this.leaveGrind(ev);
      this.speed = g.speed;
      this.toAir(OLLIE + 20, null, true);
      ev.push({ t: "pop", power: 0.5 });
    }
  }

  private leaveGrind(ev: SkateEvent[]) {
    const g = this.grind;
    this.grind = null;
    this.mode = "air";
    if (g) ev.push({ t: "grind", on: false, kind: g.line.kind });
  }

  /** Grinds and manuals: it tips one way or the other, more the longer you're on; the stick sideways rights it. */
  private balanceStep(dt: number, push: number, t: number) {
    const wobble = (1 + t * 0.3) * this.kit.wobble;
    this.tip += (Math.sign(this.balance || 1) * 0.9 + (this.rand() - 0.5) * 3) * dt * wobble;
    this.tip -= push * 6 * dt;
    this.tip *= 1 - 1.2 * dt;
    this.balance += this.tip * dt;
  }

  // ---- manuals ----

  private startManual(ev: SkateEvent[]) {
    this.mode = "manual";
    this.link = 0;
    this.manualWanted = 0;
    this.manualT = 0;
    this.balance = (this.rand() - 0.5) * 0.2;
    this.tip = (this.rand() - 0.5) * 0.5;
    this.trick(this.fakie ? "Nose Manual" : "Manual", 50, ev);
    ev.push({ t: "manual", on: true });
  }

  private manualStep(dt: number, inp: Input, ev: SkateEvent[]) {
    this.manualT += dt;
    this.balanceStep(dt, inp.x, this.manualT);
    this.combo.grow(dt * 70);
    this.speed = Math.max(0, this.speed - FRICTION * 2 * dt);
    this.rollOnSlopes(dt);
    if (Math.abs(this.balance) > 1) {
      ev.push({ t: "manual", on: false });
      return this.bail("Lost your balance!", ev);
    }
    // Pop out of it: the combo goes on in the air.
    if (!inp.pop && this.popWas) {
      ev.push({ t: "manual", on: false });
      this.toAir(OLLIE, null, true);
      ev.push({ t: "pop", power: 0.4 });
      return;
    }
    // Off it (pressed again, or stopped): back on four wheels, the combo banked.
    if (inp.manual || this.speed < 20) {
      ev.push({ t: "manual", on: false });
      this.mode = "ground";
      this.bank(ev);
      return;
    }
    this.roll(dt, ev);
    if (this.mode === "air") ev.push({ t: "manual", on: false });
  }

  // ---- points ----

  private trick(name: string, pts: number, ev: SkateEvent[]) {
    const boosted = this.special >= 1 ? pts * 1.5 : pts;
    const worth = this.combo.add(name, boosted);
    const was = this.special;
    this.special = Math.min(1, this.special + worth / 2500);
    if (was < 1 && this.special >= 1) ev.push({ t: "special" });
    ev.push({ t: "trick", name, pts: worth });
  }

  /** The combo's over and it stands: its points banked. */
  bank(ev: SkateEvent[]) {
    this.link = 0;
    if (this.combo.count === 0) return;
    const pts = this.combo.total;
    this.banked += pts;
    this.bestCombo = Math.max(this.bestCombo, pts);
    ev.push({ t: "bank", pts, label: this.combo.label, count: this.combo.count });
    this.combo.clear();
  }

  private bail(why: string, ev: SkateEvent[]) {
    const lost = this.combo.total;
    this.combo.clear();
    this.special = 0;
    this.flip = null;
    this.grab = null;
    this.body = null;
    this.grind = null;
    this.link = 0;
    this.mode = "bail";
    this.bailT = BAIL_S;
    this.bailDir = this.rand() < 0.5 ? -1 : 1;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.z = this.park.height(this.x, this.y);
    this.speed = Math.min(this.speed, 160);
    ev.push({ t: "bail", why, lost });
  }

  /** Sliding along the ground, down (a bail): stopped by walls. */
  private slide(dt: number) {
    const nx = this.x + Math.cos(this.heading) * this.speed * dt;
    const ny = this.y + Math.sin(this.heading) * this.speed * dt;
    if (!this.park.blocked(nx, ny, this.z)) {
      this.x = nx;
      this.y = ny;
      this.z = Math.min(this.z, this.park.height(nx, ny));
      this.z = this.park.height(nx, ny);
    } else this.speed = 0;
  }

  /** Ends whatever's going on (stepping off, the run's over): a combo in hand is banked if it's on four wheels. */
  finish(ev: SkateEvent[]) {
    if (this.mode === "ground" || this.mode === "manual") this.bank(ev);
  }
}
