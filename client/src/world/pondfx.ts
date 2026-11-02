// Fisherman Franci's little pond, finished off: a man-made coping of laid
// stones round its edge (rounded at the corners like the water, open where
// his dock runs out), and three tiny frogs who live in it. Mostly they're
// under; now and then one surfaces, swims to the edge with its eyes just out
// of the water, hops up onto the stones or a lily pad, sits a while (blinks,
// puffs its throat, the odd croak), hops along a bit, then plops back in.
// Seldom are two out at once, and all three hardly ever. Just for looks: you
// can't do anything with them.

import { Graphics, Sprite, type Texture } from "pixi.js";
import * as sfx from "../ambient/sfx";
import { PALETTE, TILE, hash, toTexture } from "./art";
import { type MapObject, type ZoneMap, groundAt } from "./map";
import type { Scene } from "./scene";

type XY = { x: number; y: number };

// ---- the frog's pixels -------------------------------------------------------

const INK: Record<string, string> = {
  o: "#22501b",
  g: "#64b04e",
  l: "#94d474",
  d: "#3b9233",
  b: "#f2ec97",
  p: "#fbf8cf",
  w: "#ffffff",
  k: "#121212",
};

/** Sat side on, facing right. */
const SIDE = [
  "......oo...",
  ".....owko..",
  "..oooggggo.",
  ".olllgggggo",
  "oggdgggbbbo",
  "odggggbbbo.",
  ".oddo.odo..",
];
/** Side on, its throat puffed out. */
const SIDE_PUFF = [
  "......oo...",
  ".....owko..",
  "..oooggggo.",
  ".olllgggggo",
  "oggdggppppo",
  "odgggpppppo",
  ".oddoopppo.",
];
/** In the air, side on: legs out behind. */
const LEAP = [
  "........oo..",
  ".......owko.",
  "oo..oooggggo",
  "oddogllggbbo",
  ".ooo.ooooo..",
];
/** Sat facing you. */
const FRONT = [
  ".oo...oo.",
  "owkoookwo",
  "ogggggggo",
  "ogdddddgo",
  "ogbbbbbgo",
  "odbbbbbdo",
  "oddo.oddo",
];
/** Facing you, puffed. */
const FRONT_PUFF = [
  ".oo...oo.",
  "owkoookwo",
  "ogggggggo",
  "ogdddddgo",
  "opppppppo",
  "opppppppo",
  "oddpppddo",
];
/** Sat facing away. */
const BACK = [
  ".oo...oo.",
  "ogloooglo",
  "ollgggggo",
  "oggdgdggo",
  "ogggggggo",
  "odgggggdo",
  "oddo.oddo",
];
/** Just the eyes and the top of the head, out of the water. */
const HEAD = [".oo.oo.", "owkokwo", ".ogggo."];

const blink = (rows: string[]) => rows.map((r) => r.replace("owko", "oddo").replace("okwo", "oddo").replace("owkokwo", "oddoddo"));

function frogTexture(rows: string[]): Texture {
  const c = document.createElement("canvas");
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext("2d")!;
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      const col = INK[ch];
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return toTexture(c);
}

type Pose = "side" | "front" | "back";
type Look = { sit: Texture; blink: Texture; puff: Texture; leap: Texture };
let looks: Record<Pose, Look> | null = null;
let headTex: Texture | null = null;
function frogLooks(): Record<Pose, Look> {
  if (!looks) {
    const make = (rows: string[], puffed: string[], leap: string[]): Look => ({ sit: frogTexture(rows), blink: frogTexture(blink(rows)), puff: frogTexture(puffed), leap: frogTexture(leap) });
    looks = { side: make(SIDE, SIDE_PUFF, LEAP), front: make(FRONT, FRONT_PUFF, FRONT), back: make(BACK, BACK, BACK) };
    headTex = frogTexture(HEAD);
  }
  return looks;
}

// ---- the stone edge ----------------------------------------------------------

/** Somewhere a frog can sit: on the stones (facing the water) or on a lily pad. */
type Perch = { x: number; y: number; n: XY | null; pad: boolean };

function pxl(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

const STONE = [
  { body: "#bdb7ac", face: "#8f897e", light: "#e4dfd5" },
  { body: "#c9c1b1", face: "#9a9282", light: "#ece6da" },
  { body: "#aeaaa3", face: "#827e77", light: "#d8d5cf" },
  { body: "#c6b597", face: "#98886c", light: "#e9dcc3" },
];

// ---- the show ------------------------------------------------------------------

type State = "under" | "peek" | "swim" | "hop" | "sit";

interface Frog {
  sprite: Sprite;
  state: State;
  until: number;
  /** When it has to go back in (while out). */
  outUntil: number;
  pose: Pose;
  flip: boolean;
  pos: XY;
  // A swim or a hop: from, to, when.
  from: XY;
  to: XY;
  t0: number;
  dur: number;
  /** Where it lands from a hop: a perch, or the water. */
  dest: Perch | null;
  perch: Perch | null;
  nextBlink: number;
  blinkTill: number;
  nextPuff: number;
  puffTill: number;
  nextWake: number;
}

interface Ring {
  x: number;
  y: number;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  a: number;
}
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  life: number;
}

export class PondFx {
  private water = new Set<number>();
  private rim: Sprite | null = null;
  /** Ripples and wakes, on the water (under the stones). */
  private ripples = new Graphics();
  /** Splash drops, over the water. */
  private spray = new Graphics();
  private frogs: Frog[] = [];
  private perches: Perch[] = [];
  private rings: Ring[] = [];
  private drops: Drop[] = [];
  private francy: XY;
  // The rounded pond: where its picture sits, its size, the blurred field and what's inside it.
  private ox = 0;
  private oy = 0;
  private sw = 0;
  private sh = 0;
  private field = new Float32Array(0);
  private inside = new Uint8Array(0);
  /** The stones round it: their middles, and which way is out. */
  private stones: { x: number; y: number; n: XY }[] = [];
  readonly active: boolean;

  constructor(
    scene: Scene,
    private map: ZoneMap,
    franci: MapObject,
    /** Where you are (tiles), for how loud the frogs sound. */
    private ear: () => XY | null,
    /** Where everyone is (tiles): come too close and a frog jumps in. */
    private people: () => XY[],
  ) {
    this.francy = { x: (franci.x + 0.5) * TILE, y: (franci.y + 0.5) * TILE };
    this.findWater(franci.x - 2, franci.y);
    this.active = this.water.size > 0;
    if (!this.active) return;
    // Ripples first, so the stones (added over the ground after them) cover their edges.
    scene.onGround(this.ripples);
    this.smooth();
    this.rim = this.bakeRim();
    scene.onGround(this.rim);
    this.findPerches();
    let maxY = 0;
    for (const k of this.water) maxY = Math.max(maxY, Math.floor(k / this.map.width));
    this.spray.zIndex = (maxY + 1) * TILE;
    scene.sorted.addChild(this.spray);
    const L = frogLooks();
    const now = performance.now();
    for (let i = 0; i < 3; i++) {
      const s = new Sprite(L.front.sit);
      s.anchor.set(0.5, 1);
      s.visible = false;
      scene.sorted.addChild(s);
      const f: Frog = {
        sprite: s,
        state: "under",
        // Staggered, so they don't all come up together.
        until: now + 3000 + i * 14_000 + Math.random() * 20_000,
        outUntil: 0,
        pose: "front",
        flip: false,
        pos: { x: 0, y: 0 },
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        t0: 0,
        dur: 0,
        dest: null,
        perch: null,
        nextBlink: 0,
        blinkTill: 0,
        nextPuff: 0,
        puffTill: 0,
        nextWake: 0,
      };
      this.frogs.push(f);
    }
    // Sometimes there's one already sat out when you arrive.
    if (Math.random() < 0.35) {
      const p = this.freePerch(null, null, 0, 1e9);
      if (p) this.sitOn(this.frogs[0], p, now);
    }
  }

  private key(x: number, y: number) {
    return y * this.map.width + x;
  }

  private isWater(x: number, y: number) {
    return this.water.has(this.key(x, y));
  }

  /** Is this world pixel over the pond's water? */
  private wet(x: number, y: number) {
    const ix = Math.floor(x - this.ox);
    const iy = Math.floor(y - this.oy);
    if (ix < 0 || iy < 0 || ix >= this.sw || iy >= this.sh || !this.inside[iy * this.sw + ix]) return false;
    return groundAt(this.map, Math.floor(x / TILE), Math.floor(y / TILE)) !== "bridge";
  }

  /** Whether someone is standing close to (x, y) (world pixels). */
  private crowded(x: number, y: number, r = 1.7) {
    return this.people().some((p) => Math.hypot((p.x + 0.5) * TILE - x, (p.y + 0.7) * TILE - y) < r * TILE);
  }

  /** The pond: every water tile joined to the one in front of Franci. */
  private findWater(sx: number, sy: number) {
    if (groundAt(this.map, sx, sy) !== "water") return;
    const todo: [number, number][] = [[sx, sy]];
    this.water.add(this.key(sx, sy));
    while (todo.length && this.water.size < 400) {
      const [x, y] = todo.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (this.isWater(nx, ny) || groundAt(this.map, nx, ny) !== "water") continue;
        this.water.add(this.key(nx, ny));
        todo.push([nx, ny]);
      }
    }
  }

  /** Franci's dock: bridge with the pond either side of it. */
  private isDock(x: number, y: number) {
    return groundAt(this.map, x, y) === "bridge" && ((this.isWater(x, y - 1) && this.isWater(x, y + 1)) || (this.isWater(x - 1, y) && this.isWater(x + 1, y)));
  }

  /**
   * The pond rounded off: its tiles (and the dock over it), blurred and cut
   * at half, so the stepped tile edge becomes a smooth, roundish curve.
   */
  private smooth() {
    const W = this.map.width;
    let tx0 = Infinity;
    let ty0 = Infinity;
    let tx1 = -Infinity;
    let ty1 = -Infinity;
    for (const k of this.water) {
      tx0 = Math.min(tx0, k % W);
      tx1 = Math.max(tx1, k % W);
      ty0 = Math.min(ty0, Math.floor(k / W));
      ty1 = Math.max(ty1, Math.floor(k / W));
    }
    const M = 16;
    this.ox = tx0 * TILE - M;
    this.oy = ty0 * TILE - M;
    this.sw = (tx1 - tx0 + 1) * TILE + 2 * M;
    this.sh = (ty1 - ty0 + 1) * TILE + 2 * M;
    const { sw, sh } = this;
    let f = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const tx = Math.floor((x + this.ox) / TILE);
        const ty = Math.floor((y + this.oy) / TILE);
        if (this.isWater(tx, ty) || this.isDock(tx, ty)) f[y * sw + x] = 1;
      }
    // Two box blurs each way: near enough a gaussian.
    const R = 18;
    const blur = (src: Float32Array, horizontal: boolean) => {
      const out = new Float32Array(src.length);
      const n = horizontal ? sw : sh;
      const lines = horizontal ? sh : sw;
      for (let l = 0; l < lines; l++) {
        const at = (i: number) => (horizontal ? l * sw + i : i * sw + l);
        let sum = 0;
        for (let i = -R; i <= R; i++) if (i >= 0 && i < n) sum += src[at(i)];
        for (let i = 0; i < n; i++) {
          out[at(i)] = sum / (2 * R + 1);
          if (i + R + 1 < n) sum += src[at(i + R + 1)];
          if (i - R >= 0) sum -= src[at(i - R)];
        }
      }
      return out;
    };
    for (let p = 0; p < 2; p++) f = blur(blur(f, true), false);
    this.field = f;
    this.inside = new Uint8Array(sw * sh);
    for (let i = 0; i < f.length; i++) this.inside[i] = f[i] >= 0.5 ? 1 : 0;
  }

  private fieldAt(x: number, y: number) {
    const ix = Math.round(x - this.ox);
    const iy = Math.round(y - this.oy);
    if (ix < 0 || iy < 0 || ix >= this.sw || iy >= this.sh) return 0;
    return this.field[iy * this.sw + ix];
  }

  /**
   * Whether world pixel (x, y) is this pond's water, at least `clear` px in
   * from its edge (clear of the stones); null if it's nowhere near this pond.
   */
  /** Its painted edge (the water it rounds into, the stones): what a lure's shimmer goes just above. */
  get edgeLayer(): Sprite | null {
    return this.rim;
  }

  wetAt(x: number, y: number, clear = 5): boolean | null {
    if (!this.active) return null;
    const ix = Math.round(x - this.ox);
    const iy = Math.round(y - this.oy);
    if (ix < 0 || iy < 0 || ix >= this.sw || iy >= this.sh) return null;
    const at = (a: number, b: number) => a >= 0 && b >= 0 && a < this.sw && b < this.sh && this.inside[b * this.sw + a] === 1;
    return at(ix, iy) && at(ix - clear, iy) && at(ix + clear, iy) && at(ix, iy - clear) && at(ix, iy + clear);
  }

  /** The new edge, painted over the baked one: water into the corners it fills, grass over the ones it rounds off, and stones all round (not along the dock). */
  private bakeRim(): Sprite {
    const { sw, sh, ox, oy, inside } = this;
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(sw, sh);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const water = rgb(PALETTE.water);
    const land: Record<string, number[]> = { grass: rgb(PALETTE.grass), grass_dark: rgb(PALETTE.grassDark), flowers: rgb(PALETTE.grass), sand: rgb(PALETTE.sand) };
    const dots: [number, number, string][] = [];
    const FLOWERS = ["#f4a7b9", "#f6d36b", "#ffffff", "#c7a6f0"];
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const wx = x + ox;
        const wy = y + oy;
        const tx = Math.floor(wx / TILE);
        const ty = Math.floor(wy / TILE);
        const kind = groundAt(this.map, tx, ty);
        if (kind === "bridge") continue;
        const isIn = inside[y * sw + x] === 1;
        const wasWater = this.isWater(tx, ty);
        let col: number[] | null = null;
        if (isIn && !wasWater) col = water;
        else if (isIn && wasWater) {
          // The old edge's foam, now out in open water: wash it away.
          const lx = wx - tx * TILE;
          const ly = wy - ty * TILE;
          const dry = (dx: number, dy: number) => !this.isWater(tx + dx, ty + dy) && !this.isDock(tx + dx, ty + dy);
          if ((lx < 4 && dry(-1, 0)) || (lx > TILE - 5 && dry(1, 0)) || (ly < 4 && dry(0, -1)) || (ly > TILE - 5 && dry(0, 1)) || (lx + ly < 12 && dry(-1, -1)) || (TILE - lx + ly < 12 && dry(1, -1)) || (lx + TILE - ly < 12 && dry(-1, 1)) || (2 * TILE - lx - ly < 12 && dry(1, 1))) col = water;
        }
        else if (!isIn && wasWater) {
          // The grass of whichever bank this corner belongs to.
          let bank = "grass";
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const k = groundAt(this.map, tx + dx, ty + dy);
            if (k && land[k]) {
              bank = k;
              break;
            }
          }
          col = land[bank];
          const h = hash(wx, wy, 33);
          if (bank === "flowers" && h % 70 === 0) dots.push([x, y, FLOWERS[(h >>> 8) % FLOWERS.length]]);
          else if (h % 9 === 0) col = land.grass_dark;
        }
        if (!col) continue;
        const i = (y * sw + x) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    for (const [x, y, col] of dots) pxl(ctx, col, x, y, 2, 2);
    // The edge: inside pixels with outside next to them, round the middle in order.
    const edge: { x: number; y: number; a: number }[] = [];
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (let y = 1; y < sh - 1; y++)
      for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x;
        if (!inside[i]) continue;
        cx += x;
        cy += y;
        n++;
        if (inside[i - 1] && inside[i + 1] && inside[i - sw] && inside[i + sw]) continue;
        edge.push({ x: x + ox + 0.5, y: y + oy + 0.5, a: 0 });
      }
    cx = cx / n + ox;
    cy = cy / n + oy;
    for (const p of edge) p.a = Math.atan2(p.y - cy, p.x - cx);
    edge.sort((p, q) => p.a - q.a);
    const nearDock = (x: number, y: number) => {
      for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4]]) if (groundAt(this.map, Math.floor((x + dx) / TILE), Math.floor((y + dy) / TILE)) === "bridge") return true;
      return false;
    };
    const picked: XY[] = [];
    for (const p of edge) {
      const last = picked[picked.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 7) continue;
      picked.push(p);
    }
    if (picked.length > 2 && Math.hypot(picked[0].x - picked[picked.length - 1].x, picked[0].y - picked[picked.length - 1].y) < 5) picked.pop();
    type Stone = { x: number; y: number; w: number; h: number; n: XY; tone: number; seed: number };
    const stones: Stone[] = [];
    for (const p of picked) {
      if (nearDock(p.x, p.y)) continue;
      // Outward: down the field's slope.
      const gx = this.fieldAt(p.x + 2, p.y) - this.fieldAt(p.x - 2, p.y);
      const gy = this.fieldAt(p.x, p.y + 2) - this.fieldAt(p.x, p.y - 2);
      const gl = Math.hypot(gx, gy) || 1;
      const nv = { x: -gx / gl, y: -gy / gl };
      const seed = hash(Math.round(p.x), Math.round(p.y), 71);
      // Long along the edge, shorter across it: laid coping.
      const along = 8 + (seed % 2);
      const across = 5 + ((seed >>> 4) % 2);
      const w = Math.abs(nv.y) > 0.75 ? along : Math.abs(nv.x) > 0.75 ? across : 7;
      const h = Math.abs(nv.y) > 0.75 ? across : Math.abs(nv.x) > 0.75 ? along - 1 : 6;
      stones.push({ x: p.x + nv.x * 1.5 - w / 2, y: p.y + nv.y * 1.5 - h / 2, w, h, n: nv, tone: (seed >>> 8) % STONE.length, seed });
    }
    this.stones = stones.map((s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2, n: s.n }));
    // The water darkens under the stones' lip, and stays wet against them.
    for (const s of stones) {
      const wx = s.x - s.n.x * 4;
      const wy = s.y - s.n.y * 4;
      pxl(ctx, "rgba(14,52,72,0.28)", wx - ox, wy - oy + 1, s.w, s.h);
      if (s.seed % 3 === 0) pxl(ctx, "rgba(255,255,255,0.55)", wx - ox + s.w / 2 - s.n.x * 2 - 1, wy - oy + s.h / 2 - s.n.y * 2 + 1, 2, 1);
    }
    stones.sort((p, q) => p.y + p.h - (q.y + q.h));
    for (const s of stones) {
      const X = Math.round(s.x - ox);
      const Y = Math.round(s.y - oy);
      const { w, h } = s;
      const P = STONE[s.tone];
      // A soft shadow down and to the right, then the stone: an outline with
      // its corners knocked off, its top lit, its front face in shade.
      pxl(ctx, "rgba(20,30,20,0.22)", X + 1, Y + 2, w, h);
      pxl(ctx, "#5b5650", X, Y + 1, w, h - 2);
      pxl(ctx, "#5b5650", X + 1, Y, w - 2, h);
      pxl(ctx, P.body, X + 1, Y + 1, w - 2, h - 2);
      pxl(ctx, P.face, X + 1, Y + h - 3, w - 2, 2);
      pxl(ctx, P.light, X + 1, Y + 1, Math.max(1, w - 3), 1);
      pxl(ctx, "#f6f2ea", X + 1, Y + 1, 1, 1);
      if ((s.seed >>> 12) % 4 === 0) pxl(ctx, P.face, X + 2 + ((s.seed >>> 14) % Math.max(1, w - 4)), Y + 2, 1, 1);
      // Moss, here and there, on the joints and the shady side.
      if ((s.seed >>> 16) % 10 < 3) {
        pxl(ctx, "#6aa94a", X + (s.seed % 2 ? 1 : w - 3), Y + h - 3, 2, 1);
        pxl(ctx, "#88c65c", X + (s.seed % 2 ? 1 : w - 2), Y + h - 4, 1, 1);
      }
      if ((s.seed >>> 20) % 10 < 2) pxl(ctx, "#4f8f3a", X, Y + h - 2, 1, 1);
    }
    const sp = new Sprite(toTexture(c));
    sp.position.set(ox, oy);
    return sp;
  }

  /** Where frogs can sit: on the stones (not by Franci), and on the lily pads. */
  private findPerches() {
    this.stones.forEach((s, i) => {
      if (i % 2) return;
      const x = s.x;
      const y = s.y + 2;
      if (Math.hypot(x - this.francy.x, y - this.francy.y) < 30) return;
      // Somewhere to jump in to, just off the stones.
      if (!this.wet(x - s.n.x * 12, y - s.n.y * 12)) return;
      this.perches.push({ x, y, n: s.n, pad: false });
    });
    const W = this.map.width;
    for (const k of this.water) {
      const x = k % W;
      const y = Math.floor(k / W);
      if (this.map.decor_legend[this.map.decor[k]] === "lilypad") this.perches.push({ x: x * TILE + 15, y: y * TILE + 21, n: null, pad: true });
    }
  }

  /** A perch nobody's on, between `near` and `far` pixels from `from` (if given). */
  private freePerch(from: XY | null, not: Perch | null, near: number, far: number, pads = true): Perch | null {
    const ok = this.perches.filter((p) => {
      if (p === not || (!pads && p.pad)) return false;
      if (this.crowded(p.x, p.y, 2.4)) return false;
      if (this.frogs.some((f) => (f.perch === p || f.dest === p) && f.state !== "under")) return false;
      if (this.frogs.some((f) => f.state === "sit" && Math.hypot(f.pos.x - p.x, f.pos.y - p.y) < 12)) return false;
      if (!from) return true;
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      return d >= near && d <= far;
    });
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
  }

  /** Somewhere in open water, clear of the edges. */
  private openWater(): XY | null {
    const tiles = [...this.water];
    for (let i = 0; i < 30; i++) {
      const k = tiles[Math.floor(Math.random() * tiles.length)];
      const x = (k % this.map.width) * TILE + 6 + Math.random() * (TILE - 12);
      const y = Math.floor(k / this.map.width) * TILE + 6 + Math.random() * (TILE - 12);
      if ([[-9, 0], [9, 0], [0, -9], [0, 9]].every(([dx, dy]) => this.wet(x + dx, y + dy)) && Math.hypot(x - this.francy.x, y - this.francy.y) > 24) return { x, y };
    }
    return null;
  }

  /** Just off a perch, in the water: where a frog comes out from, and jumps in to. */
  private offPerch(p: Perch): XY {
    if (!p.n) {
      const a = Math.random() * Math.PI * 2;
      for (let r = 14; r < 30; r += 4) {
        const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r * 0.7 };
        if (this.wet(q.x, q.y)) return q;
      }
      return { x: p.x + 12, y: p.y + 4 };
    }
    return { x: p.x - p.n.x * 12, y: p.y - p.n.y * 12 };
  }

  private out(not: Frog) {
    return this.frogs.filter((f) => f !== not && f.state !== "under").length;
  }

  private volume(at: XY) {
    const e = this.ear();
    if (!e) return 0;
    const d = Math.hypot(at.x / TILE - e.x, at.y / TILE - e.y);
    return Math.max(0, 1 - d / 9);
  }

  private ring(x: number, y: number, now: number, r1 = 9, dur = 900, a = 0.7, r0 = 1.5) {
    this.rings.push({ x, y, t0: now, dur, r0, r1, a });
  }

  private splash(at: XY, now: number, big: boolean) {
    this.ring(at.x, at.y, now, big ? 11 : 8, 1000);
    this.ring(at.x, at.y, now + 180, big ? 7 : 5, 800, 0.5);
    for (let i = 0; i < (big ? 7 : 4); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = 22 + Math.random() * 26;
      this.drops.push({ x: at.x, y: at.y, vx: Math.cos(a) * v * 0.7, vy: Math.sin(a) * v, t0: now, life: 380 + Math.random() * 220 });
    }
    const vol = this.volume(at);
    if (vol > 0) sfx.splash(0.22 * vol);
  }

  private croak(at: XY) {
    const vol = this.volume(at);
    if (vol <= 0) return;
    const t = sfx.at(0);
    // Two quick, throaty, falling rasps: rib-bit.
    sfx.tone(t, 0.07, 0.07 * vol, "square", 210, 150);
    sfx.burst(t, 0.07, 0.05 * vol, "bandpass", 700, 500, 3);
    sfx.tone(t + 0.12, 0.09, 0.06 * vol, "square", 240, 140);
    sfx.burst(t + 0.12, 0.09, 0.04 * vol, "bandpass", 760, 480, 3);
  }

  // ---- the frogs' lives --------------------------------------------------------

  private sitOn(f: Frog, p: Perch, now: number) {
    f.state = "sit";
    f.perch = p;
    f.dest = null;
    f.pos = { x: p.x, y: p.y };
    if (!f.outUntil || f.outUntil < now) f.outUntil = now + 9000 + Math.random() * 14_000;
    f.until = now + 2500 + Math.random() * 5500;
    // Face the water, so it's ready to jump in.
    if (p.n && Math.abs(p.n.y) > 0.6) f.pose = p.n.y < 0 ? "front" : "back";
    else if (p.n) {
      f.pose = "side";
      f.flip = p.n.x > 0;
    } else {
      f.pose = Math.random() < 0.5 ? "front" : "side";
      f.flip = Math.random() < 0.5;
    }
    f.nextBlink = now + 800 + Math.random() * 2500;
    f.nextPuff = now + 1200 + Math.random() * 3000;
  }

  private hop(f: Frog, to: XY, dest: Perch | null, now: number) {
    f.state = "hop";
    f.from = { ...f.pos };
    f.to = to;
    f.dest = dest;
    f.perch = null;
    f.t0 = now;
    const d = Math.hypot(to.x - f.from.x, to.y - f.from.y);
    f.dur = 300 + d * 7;
    const dx = to.x - f.from.x;
    const dy = to.y - f.from.y;
    if (Math.abs(dx) >= Math.abs(dy) * 0.7) {
      f.pose = "side";
      f.flip = dx < 0;
    } else f.pose = dy > 0 ? "front" : "back";
  }

  private dive(f: Frog, now: number) {
    const to = f.perch ? this.offPerch(f.perch) : this.openWater() ?? f.pos;
    this.hop(f, to, null, now);
  }

  private underFor(f: Frog, now: number) {
    f.state = "under";
    f.perch = null;
    f.dest = null;
    f.outUntil = 0;
    f.until = now + 25_000 + Math.random() * 45_000;
  }

  private surface(f: Frog, now: number) {
    // Two out already? Then nearly always stay down a while longer.
    if (this.out(f) >= 2 && Math.random() < 0.85) {
      f.until = now + 10_000 + Math.random() * 20_000;
      return;
    }
    const at = this.openWater();
    if (!at) {
      f.until = now + 5000;
      return;
    }
    if (Math.random() < 0.22) {
      // Just a peek: eyes up, a look round, and down again.
      f.state = "peek";
      f.pos = at;
      f.until = now + 1400 + Math.random() * 1400;
      this.ring(at.x, at.y, now, 6, 800, 0.55);
      return;
    }
    const p = this.freePerch(at, null, 0, 110) ?? this.freePerch(null, null, 0, 1e9);
    if (!p) {
      f.until = now + 8000;
      return;
    }
    f.state = "swim";
    f.pos = at;
    f.from = at;
    f.to = this.offPerch(p);
    f.dest = p;
    f.t0 = now;
    f.dur = Math.max(1600, (Math.hypot(f.to.x - at.x, f.to.y - at.y) / 13) * 1000);
    f.nextWake = now;
    this.ring(at.x, at.y, now, 7, 900, 0.6);
  }

  private step(f: Frog, now: number) {
    switch (f.state) {
      case "under":
        if (now > f.until) this.surface(f, now);
        break;
      case "peek":
        if (now > f.until) {
          this.ring(f.pos.x, f.pos.y, now, 5, 700, 0.5);
          f.state = "under";
          f.until = now + 8000 + Math.random() * 16_000;
        }
        break;
      case "swim": {
        const t = Math.min(1, (now - f.t0) / f.dur);
        const e = t * t * (3 - 2 * t);
        f.pos = { x: f.from.x + (f.to.x - f.from.x) * e, y: f.from.y + (f.to.y - f.from.y) * e };
        if (now > f.nextWake && t < 0.95) {
          f.nextWake = now + 260;
          this.ring(f.pos.x, f.pos.y + 1, now, 6, 700, 0.35, 2);
        }
        if (t >= 1) {
          const p = f.dest && !this.frogs.some((o) => o !== f && o.perch === f.dest) && !this.crowded(f.dest.x, f.dest.y, 2.4) ? f.dest : null;
          if (p) {
            this.splash(f.pos, now, false);
            this.hop(f, { x: p.x, y: p.y }, p, now);
          } else this.underFor(f, now);
        }
        break;
      }
      case "hop":
        if (now - f.t0 >= f.dur) {
          f.pos = { ...f.to };
          const p = f.dest;
          if (p) {
            this.sitOn(f, p, now);
            if (Math.random() < 0.15) this.croak(f.pos);
          } else {
            this.splash(f.pos, now, true);
            this.underFor(f, now);
          }
        } else {
          const t = (now - f.t0) / f.dur;
          f.pos = { x: f.from.x + (f.to.x - f.from.x) * t, y: f.from.y + (f.to.y - f.from.y) * t };
        }
        break;
      case "sit":
        // Someone coming close: plop, straight in.
        if (this.crowded(f.pos.x, f.pos.y)) {
          f.outUntil = 0;
          this.dive(f, now);
          break;
        }
        if (now > f.nextBlink) {
          f.blinkTill = now + 140;
          f.nextBlink = now + 1800 + Math.random() * 4200;
        }
        if (now > f.nextPuff) {
          f.puffTill = now + 500 + Math.random() * 300;
          f.nextPuff = now + 2600 + Math.random() * 5000;
          if (Math.random() < 0.3) this.croak(f.pos);
        }
        if (now > f.until) {
          if (now > f.outUntil) {
            this.dive(f, now);
            break;
          }
          const r = Math.random();
          const here = f.perch;
          const along = r < 0.55 ? this.freePerch(f.pos, here, 10, 40, false) : null;
          const pad = !along && r < 0.8 ? this.freePerch(f.pos, here, 16, 70) : null;
          const next = along ?? (pad?.pad ? pad : null);
          if (next) this.hop(f, { x: next.x, y: next.y }, next, now);
          else if (r > 0.85) this.dive(f, now);
          else f.until = now + 1500 + Math.random() * 3000;
        }
        break;
    }
  }

  update(now: number) {
    if (!this.active) return;
    const L = frogLooks();
    for (const f of this.frogs) {
      this.step(f, now);
      const s = f.sprite;
      if (f.state === "under") {
        s.visible = false;
        continue;
      }
      s.visible = true;
      let lift = 0;
      if (f.state === "swim" || f.state === "peek") {
        s.texture = headTex!;
        s.scale.set(1, 1);
        // Bobbing gently, eyes just out.
        lift = Math.round(Math.sin(now / 260 + f.from.x) * 0.6);
      } else if (f.state === "hop") {
        const t = (now - f.t0) / f.dur;
        lift = Math.sin(Math.PI * Math.min(1, t)) * (5 + f.dur / 90);
        const look = L[f.pose];
        s.texture = t > 0.12 && t < 0.88 ? look.leap : look.sit;
        s.scale.set(f.flip ? -1 : 1, f.pose !== "side" && t > 0.12 && t < 0.88 ? 1.2 : 1);
      } else {
        const look = L[f.pose];
        s.texture = now < f.blinkTill ? look.blink : now < f.puffTill ? look.puff : look.sit;
        s.scale.set(f.flip ? -1 : 1, 1);
      }
      s.position.set(Math.round(f.pos.x), Math.round(f.pos.y - lift));
      s.zIndex = f.pos.y + (f.perch?.pad || f.dest?.pad ? 2 : 0);
    }
    this.draw(now);
  }

  private draw(now: number) {
    const g = this.ripples.clear();
    this.rings = this.rings.filter((r) => now - r.t0 < r.dur);
    for (const r of this.rings) {
      if (now < r.t0) continue;
      const t = (now - r.t0) / r.dur;
      const rx = r.r0 + (r.r1 - r.r0) * Math.sqrt(t);
      const ry = rx * 0.55;
      const alpha = r.a * (1 - t);
      const n = Math.max(8, Math.round(rx * 3));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.round(r.x + Math.cos(a) * rx);
        const y = Math.round(r.y + Math.sin(a) * ry);
        if (this.wet(x, y)) g.rect(x, y, 1, 1).fill({ color: 0xe6fbff, alpha });
      }
    }
    // The water just under a swimming frog, darker, and its shadow under a hopping one.
    for (const f of this.frogs) {
      if (f.state === "swim" || f.state === "peek") g.rect(Math.round(f.pos.x) - 4, Math.round(f.pos.y), 8, 1).fill({ color: 0x0e4a5e, alpha: 0.35 });
      if (f.state === "hop") g.ellipse(f.pos.x, f.pos.y - 1, 4, 1.5).fill({ color: 0x000000, alpha: 0.18 });
    }
    const d = this.spray.clear();
    this.drops = this.drops.filter((p) => now - p.t0 < p.life);
    for (const p of this.drops) {
      const t = (now - p.t0) / 1000;
      const x = p.x + p.vx * t;
      const y = p.y + p.vy * t + 160 * t * t;
      d.rect(Math.round(x), Math.round(y), 1, 1).fill({ color: 0xeafcff, alpha: 1 - (now - p.t0) / p.life });
    }
  }

  destroy() {
    for (const f of this.frogs) f.sprite.destroy();
    this.rim?.destroy({ texture: true, textureSource: true });
    this.ripples.destroy();
    this.spray.destroy();
  }
}
