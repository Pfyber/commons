// The arena's feel: everything that makes a blow land. Grit and sand thrown up
// on real arcs, bouncing and settling; cracks that run out through the ground
// from a stomp and heal slowly; scorched sand; stone chipped off a wall; a
// shield's flash, facing the blow; stars of impact; afterimages of a dash.
//
// Hundreds of pieces fly at once, so they go down by colour and brightness,
// each batch one fill, and whatever's on the floor stays on the floor.

import { Sprite, type Container, type Graphics, type Texture } from "pixi.js";

const G = 11;
const MAX_BITS = 800;
/** Sand, in three lights; stone. */
const SAND = [0xe8d3a3, 0xd4b67c, 0xf4e6c4];
const STONE = [0xb8b2a4, 0x8c8678, 0xd8d2c4];

interface Bit {
  x: number;
  y: number;
  /** Off the ground (tiles). */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  size: number;
  color: number;
  /** How much of its fall it keeps when it hits the ground (0: it stops). */
  bounce: number;
  /** How quickly the air slows it. */
  drag: number;
  /** No falling: it hangs and drifts (smoke, a puff). */
  float: boolean;
}

/** One line of a crack: a few jagged steps out from its start. */
interface Crack {
  x: number;
  y: number;
  /** Points, px, from (x, y). */
  pts: number[];
  born: number;
  life: number;
  /** Wide, then narrowing. */
  width: number;
  /** Where the glow in it is (0: none). */
  color: number;
}

interface Scorch {
  x: number;
  y: number;
  r: number;
  born: number;
  life: number;
}

interface Skid {
  x: number;
  y: number;
  a: number;
  born: number;
}

interface Ring {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: number;
  born: number;
  life: number;
  width: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  color: number;
  born: number;
  life: number;
  rays: number;
  turn: number;
}

/** A shield's flash: a bright arc, facing what hit it. */
interface Flash {
  x: number;
  y: number;
  a: number;
  r: number;
  color: number;
  born: number;
  life: number;
}

interface Ghost {
  s: Sprite;
  born: number;
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** How long a crack takes to run its length. */
const CRACK_RUN_MS = 130;

export class Juice {
  private bits: Bit[] = [];
  private cracks: Crack[] = [];
  private scorches: Scorch[] = [];
  private skids: Skid[] = [];
  private rings: Ring[] = [];
  private stars: Star[] = [];
  private flashes: Flash[] = [];
  private ghosts: Ghost[] = [];
  private buckets = new Map<number, number[]>();

  constructor(
    private wx: (x: number) => number,
    private wy: (y: number) => number,
    private tile: number,
    private layer: Container,
  ) {}

  private add(b: Partial<Bit> & { x: number; y: number }, now: number) {
    if (this.bits.length >= MAX_BITS) this.bits.shift();
    this.bits.push({ z: 0, vx: 0, vy: 0, vz: 0, born: now, life: 600, size: 2, color: SAND[0], bounce: 0, drag: 1.5, float: false, ...b });
  }

  /** `n` pieces off (x, y), flung out and up, in the fan `a` ± `spread` (π: all round). */
  private spray(x: number, y: number, n: number, now: number, o: { a?: number; spread?: number; speed: [number, number]; up: [number, number]; colors: number[]; size?: [number, number]; life?: [number, number]; bounce?: number; z?: number; drag?: number }) {
    const [a0, spread] = [o.a ?? 0, o.spread ?? Math.PI];
    for (let i = 0; i < n; i++) {
      const a = a0 + rnd(-spread, spread);
      const v = rnd(...o.speed);
      this.add({ x, y, z: o.z ?? 0.05, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: rnd(...o.up), color: pick(o.colors), size: Math.round(rnd(...(o.size ?? [1, 3]))), life: rnd(...(o.life ?? [450, 900])), bounce: o.bounce ?? 0.3, drag: o.drag ?? 1.5 }, now);
    }
  }

  /** Puffs of soft dust, hanging and spreading. */
  private puffs(x: number, y: number, n: number, now: number, o: { r: number; color?: number[]; life?: [number, number]; rise?: number; size?: [number, number]; a?: number; push?: number }) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(0, o.r);
      const out = rnd(0.2, 1) * (o.push ?? 1);
      this.add({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, z: rnd(0, 0.3), vx: Math.cos(a) * out + Math.cos(o.a ?? 0) * (o.a === undefined ? 0 : 1.5), vy: Math.sin(a) * out * 0.7 + Math.sin(o.a ?? 0) * (o.a === undefined ? 0 : 1), vz: rnd(0.1, o.rise ?? 0.6), color: pick(o.color ?? SAND), size: Math.round(rnd(...(o.size ?? [3, 7]))), life: rnd(...(o.life ?? [500, 1100])), drag: 2.2, float: true }, now);
    }
  }

  private ring(x: number, y: number, r: number, color: number, now: number, life = 480, width = 3) {
    this.rings.push({ x: this.wx(x), y: this.wy(y), rx: r * this.tile, ry: r * this.tile * 0.62, color, born: now, life, width });
  }

  /** A jagged line out from (x, y) (tiles), `len` px, forking now and then. */
  private crack(x: number, y: number, a: number, len: number, now: number, life: number, width: number, color = 0, depth = 0) {
    const steps = Math.max(3, Math.round(len / 7));
    const pts = [0, 0];
    let [px, py, dir] = [0, 0, a];
    for (let i = 1; i <= steps; i++) {
      // (A zig and a zag about its line, never a smooth curve.)
      const swing = (i % 2 ? 1 : -1) * rnd(0.35, 1);
      dir += rnd(-0.18, 0.18);
      const d = (len / steps) * rnd(0.8, 1.2);
      px += Math.cos(dir + swing) * d;
      py += Math.sin(dir + swing) * d * 0.62;
      pts.push(Math.round(px), Math.round(py));
      if (depth < 1 && Math.random() < 0.18) {
        const [bx, by] = [x + px / this.tile, y + py / this.tile];
        // (Forking off once the crack's got that far.)
        this.crack(bx, by, dir + rnd(0.5, 1.1) * (Math.random() < 0.5 ? -1 : 1), len * 0.4, now + (CRACK_RUN_MS * i) / steps, life, Math.max(1, width - 1), color, depth + 1);
      }
    }
    this.cracks.push({ x, y, pts, born: now, life, width, color });
  }

  // ---- what happened ------------------------------------------------------------

  /** A blow lands: sparks away from it, and a star of impact. */
  hit(x: number, y: number, a: number, big: boolean, color: number) {
    const now = performance.now();
    this.stars.push({ x: this.wx(x), y: this.wy(y) - 18, r: big ? 22 : 13, color, born: now, life: big ? 200 : 130, rays: big ? 8 : 6, turn: Math.random() * 6 });
    this.spray(x, y, big ? 16 : 7, now, { a, spread: 0.8, speed: [2, big ? 8 : 5], up: [1, 3.5], colors: [color, 0xffffff], z: 0.6, size: [1, 2], life: [200, 420], bounce: 0 });
    if (big) this.puffs(x, y, 3, now, { r: 0.3, a, size: [2, 4], life: [250, 500] });
  }

  /** A guard takes it: the shield flashes, facing the blow. */
  guard(x: number, y: number, a: number, heavy: boolean) {
    const now = performance.now();
    this.flashes.push({ x: this.wx(x), y: this.wy(y) - 18, a, r: heavy ? 26 : 20, color: 0x9fe8ff, born: now, life: heavy ? 280 : 200 });
    this.spray(x + Math.cos(a) * 0.45, y + Math.sin(a) * 0.3, heavy ? 12 : 7, now, { a, spread: 1, speed: [2, 6], up: [0.8, 3], colors: [0x9fe8ff, 0xffffff, 0xd8f6ff], z: 0.6, size: [1, 2], life: [180, 380], bounce: 0 });
  }

  /** A perfect parry: a bright burst, and lines racing out of it. */
  parry(x: number, y: number, heavy: boolean) {
    const now = performance.now();
    this.ring(x, y, heavy ? 2.4 : 1.8, 0xffffff, now, 360, 4);
    this.ring(x, y, heavy ? 1.5 : 1.1, 0xffe14f, now, 300, 3);
    this.stars.push({ x: this.wx(x), y: this.wy(y) - 18, r: heavy ? 46 : 34, color: 0xffffff, born: now, life: 240, rays: 12, turn: Math.random() * 6 });
    this.spray(x, y, heavy ? 30 : 20, now, { speed: [3, 9], up: [1, 4], colors: [0xffffff, 0xffe14f, 0xfff6c8], z: 0.6, size: [1, 3], life: [240, 520], bounce: 0 });
  }

  /** A guard smashed through: bits of it everywhere. */
  guardBreak(x: number, y: number) {
    const now = performance.now();
    this.ring(x, y, 1.3, 0xff9a3f, now, 320, 3);
    this.spray(x, y, 18, now, { speed: [2, 7], up: [2, 5], colors: [0x9fe8ff, 0xc8d4dc, 0x6a7a88, 0xff9a3f], z: 0.7, size: [2, 4], life: [350, 700], bounce: 0.35 });
  }

  /** Slammed into a wall: stone off it, a crack in it, sand down it. `a`: the way into the wall. */
  wallSlam(x: number, y: number, a: number) {
    const now = performance.now();
    const [wx, wy] = [x + Math.cos(a) * 0.35, y + Math.sin(a) * 0.3];
    this.stars.push({ x: this.wx(wx), y: this.wy(wy) - 16, r: 40, color: 0xffffff, born: now, life: 220, rays: 10, turn: Math.random() * 6 });
    this.ring(wx, wy, 1.7, 0xffc88a, now, 420, 4);
    for (let i = 0; i < 6; i++) this.crack(wx, wy - 0.5, a + Math.PI + rnd(-1.5, 1.5), rnd(18, 34), now, 2600, 2);
    const back = a + Math.PI;
    this.spray(wx, wy, 26, now, { a: back, spread: 1.2, speed: [2.5, 8], up: [2, 6], colors: STONE, z: 0.7, size: [2, 5], life: [550, 1000], bounce: 0.4 });
    this.spray(wx, wy, 18, now, { a: back, spread: 1.4, speed: [1, 5], up: [1, 3], colors: SAND, z: 0.5, size: [1, 2], life: [350, 700], bounce: 0.2 });
    this.puffs(wx, wy, 12, now, { r: 0.7, a: back, color: [0xd8cbb0, 0xc8b898, 0xe8dcc4], size: [5, 10], life: [700, 1300] });
  }

  /** A great foot coming down: the ground splits, a ring of sand goes up. */
  stomp(x: number, y: number, r: number, giant: boolean) {
    const now = performance.now();
    const [n, scale] = giant ? [9, 1] : [6, 0.7];
    for (let i = 0; i < n; i++) this.crack(x, y, (i / n) * Math.PI * 2 + rnd(-0.25, 0.25), r * this.tile * rnd(0.55, 1) * scale, now, 3200, giant ? 3 : 2, 0);
    this.ring(x, y, r * 0.55, 0xfff1c8, now, 300, 5);
    this.ring(x, y, r, 0xffb04a, now, 480, 4);
    window.setTimeout(() => this.ring(x, y, r * 1.3, 0xe8d3a3, performance.now(), 620, 2), 90);
    // A crown of sand, thrown straight up all round the rim.
    const rim = giant ? 72 : 36;
    for (let i = 0; i < rim; i++) {
      const a = (i / rim) * Math.PI * 2;
      const d = r * rnd(0.32, 0.55);
      this.add({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, z: 0.05, vx: Math.cos(a) * rnd(1, 3), vy: Math.sin(a) * rnd(0.7, 2), vz: rnd(3.5, giant ? 10 : 6.5), color: pick(SAND), size: Math.round(rnd(2, 5)), life: rnd(700, 1200), bounce: 0.2, drag: 0.5 }, now);
    }
    // And the fine stuff, running outward along the ground.
    this.spray(x, y, giant ? 70 : 34, now, { speed: [2.5, 9], up: [0.5, 3], colors: SAND, size: [1, 2], life: [350, 800], bounce: 0.25 });
    this.spray(x, y, giant ? 12 : 5, now, { speed: [2, 6], up: [3, 7], colors: STONE, size: [3, 5], life: [600, 1000], bounce: 0.45, drag: 0.8 });
    this.puffs(x, y, giant ? 22 : 12, now, { r: r * 0.6, size: [6, 13], life: [800, 1600], push: 2.6, rise: 0.8 });
  }

  /** A bomb going off: a scorch on the sand, smoke climbing out of it. */
  blast(x: number, y: number, r: number) {
    const now = performance.now();
    this.scorches.push({ x: this.wx(x), y: this.wy(y), r: r * this.tile * 0.7, born: now, life: 7000 });
    this.stars.push({ x: this.wx(x), y: this.wy(y) - 8, r: r * this.tile * 0.8, color: 0xfff1c8, born: now, life: 170, rays: 12, turn: Math.random() * 6 });
    this.ring(x, y, r * 1.15, 0xfff1c8, now, 300, 5);
    this.spray(x, y, 26, now, { speed: [2, 8], up: [2, 7], colors: [...SAND, 0x5a3c2a], size: [1, 4], life: [450, 950], bounce: 0.3 });
    this.puffs(x, y, 14, now, { r: r * 0.55, color: [0x3a3238, 0x4e4648, 0x2a2428], size: [6, 12], life: [900, 1700], rise: 1.6, push: 1.4 });
  }

  /** Someone's down. */
  ko(x: number, y: number, color: number) {
    const now = performance.now();
    this.stars.push({ x: this.wx(x), y: this.wy(y) - 16, r: 36, color: 0xffffff, born: now, life: 260, rays: 10, turn: Math.random() * 6 });
    this.ring(x, y, 1.7, color, now, 520, 4);
    this.spray(x, y, 22, now, { speed: [2, 6], up: [2, 5], colors: [color, 0xffffff], z: 0.5, size: [2, 3], life: [450, 900], bounce: 0.3 });
    this.puffs(x, y, 10, now, { r: 0.5, push: 1.6 });
  }

  /** A foot on the sand. */
  step(x: number, y: number, big: boolean) {
    const now = performance.now();
    this.puffs(x, y, big ? 4 : 1, now, { r: big ? 0.35 : 0.1, size: big ? [4, 8] : [2, 4], life: big ? [450, 800] : [260, 480], rise: 0.25 });
    if (big) this.spray(x, y, 6, now, { speed: [0.5, 2], up: [0.5, 1.8], colors: SAND, size: [1, 2], life: [250, 450], bounce: 0 });
  }

  /** Dragged across the sand by a blow: a score in it, grit kicked up. */
  skid(x: number, y: number, a: number) {
    const now = performance.now();
    this.skids.push({ x: this.wx(x), y: this.wy(y), a, born: now });
    if (this.skids.length > 90) this.skids.shift();
    this.spray(x, y, 2, now, { a: a + Math.PI, spread: 0.6, speed: [0.8, 2.4], up: [0.4, 1.4], colors: SAND, size: [1, 2], life: [220, 400], bounce: 0 });
  }

  /** Motes drawn in to someone charging (`k`: how full). */
  charge(x: number, y: number, k: number, color: number) {
    const now = performance.now();
    const a = rnd(0, Math.PI * 2);
    const d = rnd(0.7, 1.2);
    this.add({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, z: rnd(0.2, 1), vx: -Math.cos(a) * d * 3, vy: -Math.sin(a) * d * 2.1, vz: 0.4, color: k >= 1 ? 0xffffff : color, size: k >= 1 ? 2 : 1, life: 300, drag: 0, float: true }, now);
  }

  /** Coins, thrown up in the air. */
  coins(x: number, y: number, n: number) {
    const now = performance.now();
    this.spray(x, y, n, now, { speed: [1, 4], up: [5, 9], colors: [0xffd23f, 0xffe98a, 0xe0a820], z: 1, size: [2, 4], life: [700, 1200], bounce: 0.4, drag: 0.6 });
  }

  /** A fading afterimage of a dash. */
  ghost(tex: Texture, x: number, y: number, sx: number, sy: number, ax: number, ay: number, tint: number, z: number) {
    if (this.ghosts.length > 16) return;
    const s = new Sprite(tex);
    s.anchor.set(ax, ay);
    s.scale.set(sx, sy);
    s.position.set(x, y);
    s.tint = tint;
    s.alpha = 0.5;
    s.zIndex = z;
    this.layer.addChild(s);
    this.ghosts.push({ s, born: performance.now() });
  }

  // ---- each frame ---------------------------------------------------------------

  /** What's on the ground, under the fighters. */
  drawFloor(g: Graphics, now: number) {
    this.scorches = this.scorches.filter((c) => now - c.born < c.life);
    for (const c of this.scorches) {
      const fade = Math.min(1, (c.life - (now - c.born)) / 2000);
      // Soft-edged, in steps, charred at the heart.
      for (let k = 0; k < 5; k++) {
        const r = c.r * (1.15 - k * 0.2);
        g.ellipse(c.x, c.y, r, r * 0.62).fill({ color: 0x1a1210, alpha: 0.13 * fade });
      }
    }
    this.skids = this.skids.filter((k) => now - k.born < 2400);
    for (const k of this.skids) {
      const fade = 1 - (now - k.born) / 2400;
      const [cx, cy] = [Math.cos(k.a) * 5, Math.sin(k.a) * 3];
      g.moveTo(k.x - cx, k.y - cy).lineTo(k.x + cx, k.y + cy).stroke({ width: 2, color: 0x7a5c34, alpha: 0.5 * fade });
    }
    this.cracks = this.cracks.filter((c) => now - c.born < c.life);
    for (const c of this.cracks) {
      const age = now - c.born;
      if (age <= 0) continue;
      // It runs out quickly, then heals over from the far end.
      const grow = Math.min(1, age / CRACK_RUN_MS);
      const fade = Math.min(1, (c.life - age) / 900);
      const n = Math.max(2, Math.floor((c.pts.length / 2) * grow));
      const [x, y] = [this.wx(c.x), this.wy(c.y)];
      g.moveTo(x, y);
      for (let i = 1; i < n; i++) g.lineTo(x + c.pts[i * 2], y + c.pts[i * 2 + 1]);
      g.stroke({ width: c.width, color: 0x2a1c12, alpha: 0.7 * fade });
      // (The lit lip of it.)
      g.moveTo(x, y + 1);
      for (let i = 1; i < n; i++) g.lineTo(x + c.pts[i * 2], y + c.pts[i * 2 + 1] + 1);
      g.stroke({ width: 1, color: 0xfff4d8, alpha: 0.3 * fade });
    }
  }

  /** What's in the air, over the fighters. */
  drawAir(g: Graphics, now: number, dt: number) {
    const { wx, wy, buckets } = this;
    for (const a of buckets.values()) a.length = 0;
    this.bits = this.bits.filter((b) => {
      const age = now - b.born;
      if (age >= b.life) return false;
      const k = Math.exp(-b.drag * dt);
      b.vx *= k;
      b.vy *= k;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.float) b.z += b.vz * dt;
      else {
        b.vz -= G * dt;
        b.z += b.vz * dt;
        if (b.z <= 0) {
          b.z = 0;
          if (b.bounce > 0 && b.vz < -1.5) {
            b.vz *= -b.bounce;
            b.vx *= 0.6;
            b.vy *= 0.6;
          } else {
            b.vz = 0;
            b.vx *= 0.5;
            b.vy *= 0.5;
          }
        }
      }
      const u = age / b.life;
      // Soft things swell as they thin; hard ones go out at the end.
      const size = b.float ? b.size * (1 + u * 0.8) : b.size;
      const alpha = b.float ? (1 - u) ** 1.5 * Math.min(1, u * 8) * 0.7 : Math.min(1, (1 - u) * 3.5);
      const step = Math.min(7, Math.round(alpha * 8));
      if (step <= 0) return true;
      const key = b.color * 8 + step;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(Math.round(wx(b.x) - size / 2), Math.round(wy(b.y) - b.z * this.tile - size / 2), Math.round(size));
      return true;
    });
    for (const [key, list] of buckets) {
      if (!list.length) continue;
      for (let i = 0; i < list.length; i += 3) g.rect(list[i], list[i + 1], list[i + 2], list[i + 2]);
      g.fill({ color: Math.floor(key / 8), alpha: (key % 8) / 8 });
    }
    this.rings = this.rings.filter((r) => {
      const t = (now - r.born) / r.life;
      if (t >= 1) return false;
      const e = 0.2 + 0.8 * easeOut(t);
      g.ellipse(r.x, r.y, r.rx * e, r.ry * e).stroke({ width: Math.max(1, r.width * (1 - t)), color: r.color, alpha: (1 - t) ** 1.4 });
      return true;
    });
    this.stars = this.stars.filter((s) => {
      const t = (now - s.born) / s.life;
      if (t >= 1) return false;
      const r = s.r * (0.45 + 0.55 * easeOut(t));
      const w = Math.max(1, 3.5 * (1 - t));
      for (let i = 0; i < s.rays; i++) {
        const a = s.turn + (i / s.rays) * Math.PI * 2;
        const long = i % 2 ? 1 : 0.6;
        const [c, n] = [Math.cos(a), Math.sin(a) * 0.72];
        g.moveTo(s.x + c * r * 0.3 * t, s.y + n * r * 0.3 * t).lineTo(s.x + c * r * long, s.y + n * r * long);
      }
      g.stroke({ width: w, color: s.color, alpha: 1 - t });
      if (t < 0.45) g.circle(s.x, s.y, s.r * 0.32 * (1 - t * 2)).fill({ color: 0xffffff, alpha: 0.9 * (1 - t * 2) });
      return true;
    });
    this.flashes = this.flashes.filter((f) => {
      const t = (now - f.born) / f.life;
      if (t >= 1) return false;
      const r = f.r * (0.85 + 0.3 * easeOut(t));
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const a = f.a + ((i / n) * 2 - 1) * 1.05;
        const [px, py] = [f.x + Math.cos(a) * r, f.y + Math.sin(a) * r * 0.75];
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke({ width: 4 * (1 - t) + 1, color: f.color, alpha: 1 - t });
      return true;
    });
    this.ghosts = this.ghosts.filter((h) => {
      const t = (now - h.born) / 260;
      if (t >= 1) {
        h.s.destroy();
        return false;
      }
      h.s.alpha = 0.5 * (1 - t);
      return true;
    });
  }

  destroy() {
    for (const h of this.ghosts) h.s.destroy();
    this.ghosts = [];
  }
}
