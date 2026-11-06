// The Wheel of Disasters: a great stone disc let into the sand in the middle
// of the arena, five carved wedges (lava, meteors, lions, the scorpion, acid
// rain) inside a fixed ring of blocks, with a stone pointer at the top. Mid-round
// it grinds round and stops, and the wedge under the pointer lights up: that's
// what's coming. For the scorpion it sinks into its shaft, and comes back up with
// the beast on it.
//
// Everything's drawn once, pixel by pixel, into its own canvases (the ring, the
// disc, each wedge lit); a frame just lays them over each other, turned, so it
// costs next to nothing and only redraws when something moves.

import { Sprite, Texture } from "pixi.js";

/** The picture's size: about a pixel of it to a pixel of the world. */
const L = 184;
const C = L / 2;
/** The fixed ring's outside, the disc's edge, the hub. */
const R_OUT = 90;
const R_DISC = 78;
const R_HUB = 16;
const SEGS = 5;
const SEG = (Math.PI * 2) / SEGS;
const TAU = Math.PI * 2;
/** Where the pointer is, on screen. */
const POINTER = -Math.PI / 2;
/** Each wedge's disaster (as `arena::disaster`). */
const KINDS = [1, 2, 3, 4, 5];
/** Each kind's colour: r, g, b. */
const HUES: Record<number, [number, number, number]> = {
  1: [255, 110, 24],
  2: [255, 70, 60],
  3: [255, 205, 50],
  4: [200, 110, 255],
  5: [150, 240, 70],
};
/** How far down the shaft the disc goes on the screen (it's seen from a little to the south). */
const SINK_DROP = 34;
const GLYPH = 48;
/** How far out along a wedge its picture sits. */
const GLYPH_AT = 50;

const hash = (x: number, y: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

function canvas(w = L, h = L): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

/** Each picture, painted big and clean, then hardened to pixels. */
function paintGlyph(kind: number, c: CanvasRenderingContext2D) {
  const S = GLYPH;
  const k = S / 52;
  c.save();
  c.scale(k, k);
  c.fillStyle = "#fff";
  c.strokeStyle = "#fff";
  c.lineCap = "round";
  c.lineJoin = "round";
  const circle = (x: number, y: number, r: number) => {
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  };
  const cut = (f: () => void) => {
    c.globalCompositeOperation = "destination-out";
    f();
    c.globalCompositeOperation = "source-over";
  };
  const line = (w: number, ...p: number[]) => {
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
    c.stroke();
  };
  const poly = (...p: number[]) => {
    c.beginPath();
    c.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
    c.closePath();
    c.fill();
  };
  if (kind === 1) {
    // A volcano in eruption: the cone, its crater, lava running down, the blast above.
    poly(3, 48, 19, 21, 22, 23, 26, 21, 30, 23, 33, 21, 49, 48);
    for (const [x, y, r] of [[26, 14, 5.5], [19, 10, 3.6], [33, 10, 3.6], [26, 5, 3.2], [14, 4, 2], [38, 4, 2]]) circle(x, y, r);
    cut(() => {
      line(2.2, 25, 24, 22, 32, 24, 38, 19, 47);
      line(2.2, 29, 24, 31, 33, 29, 39, 33, 47);
      line(1.6, 22, 34, 14, 42);
      line(1.6, 31, 34, 39, 42);
    });
  } else if (kind === 2) {
    // A meteor: a pocked rock, its tail streaming back in three flames.
    poly(12, 26, 40, 3, 30, 19, 47, 7, 34, 26, 45, 21, 26, 42);
    circle(19, 34, 14);
    cut(() => {
      circle(14, 30, 3.2);
      circle(23, 38, 2.6);
      circle(23, 28, 1.8);
      circle(13, 40, 1.6);
    });
  } else if (kind === 3) {
    // A lion's head, full on: ears, a great shaggy mane, a long face, a heavy muzzle.
    circle(9, 10, 6.5);
    circle(43, 10, 6.5);
    c.beginPath();
    const N = 13;
    for (let i = 0; i < N * 2; i++) {
      const a = (i / (N * 2)) * TAU - Math.PI / 2;
      const r = i % 2 ? 19.5 : 26;
      const [x, y] = [26 + Math.cos(a) * r, 27 + Math.sin(a) * r * 0.98];
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.closePath();
    c.fill();
    // The face, in the paler tone (painted red here: see `glyphMask`).
    c.fillStyle = "#f00";
    c.beginPath();
    c.ellipse(26, 28, 13.5, 15.5, 0, 0, TAU);
    c.fill();
    c.fillStyle = "#fff";
    cut(() => {
      circle(9, 10, 2.6);
      circle(43, 10, 2.6);
      // Fierce eyes, a broad nose, the mouth.
      poly(15, 21, 24, 25, 22, 28.5, 16, 26);
      poly(37, 21, 28, 25, 30, 28.5, 36, 26);
      poly(20, 32, 32, 32, 26, 38);
      line(2.4, 26, 38, 26, 40);
      line(2.4, 26, 40.5, 20, 41.5);
      line(2.4, 26, 40.5, 32, 41.5);
    });
  } else if (kind === 4) {
    // A scorpion from above, tail curled over, pincers forward.
    c.save();
    c.translate(0, 2);
    // Body and plates.
    c.beginPath();
    c.ellipse(26, 31, 6.4, 12, 0, 0, TAU);
    c.fill();
    circle(26, 20, 6);
    // Tail, over to the right and up to the sting.
    c.lineWidth = 4.2;
    c.beginPath();
    c.moveTo(26, 42);
    c.bezierCurveTo(26, 52, 46, 50, 45, 32);
    c.bezierCurveTo(44, 22, 38, 19, 36, 24);
    c.stroke();
    poly(38, 22, 34, 27, 31, 22);
    // Legs.
    for (const [y, d] of [[25, 11], [29, 13], [33, 13], [37, 11]]) {
      line(1.9, 26, y, 26 - d, y - 3, 26 - d - 3, y + 4);
      line(1.9, 26, y, 26 + d, y - 3, 26 + d + 3, y + 4);
    }
    // Pincers.
    line(2.8, 22, 16, 12, 12, 10, 5);
    line(2.8, 30, 16, 40, 12, 42, 5);
    for (const [x, s] of [[10, -1], [42, 1]]) {
      circle(x, 4, 4.6);
      line(2.2, x, 2, x + s * 4, -3);
      line(2.2, x - s * 3, 2, x - s * 3.5, -3);
    }
    cut(() => {
      for (const y of [25, 29.5, 34, 38]) line(1.1, 20, y, 32, y);
    });
    c.restore();
  } else {
    // A cloud with acid falling out of it.
    for (const [x, y, r] of [[14, 15, 8], [25, 11, 10.5], [37, 15, 8], [20, 18, 8], [32, 18, 8]]) circle(x, y, r);
    const drop = (x: number, y: number, s: number) => {
      c.beginPath();
      c.moveTo(x, y - 6 * s);
      c.bezierCurveTo(x + 4 * s, y - 1 * s, x + 3.4 * s, y + 3.4 * s, x, y + 3.4 * s);
      c.bezierCurveTo(x - 3.4 * s, y + 3.4 * s, x - 4 * s, y - 1 * s, x, y - 6 * s);
      c.fill();
    };
    for (const [x, y, s] of [[12, 34, 1], [25, 37, 1.2], [38, 34, 1], [18, 46, 0.8], [33, 46, 0.8]]) drop(x, y, s);
  }
  c.restore();
}

/** A picture as pixels: 0 nothing, 1 the fill, 2 its edge, 3 a paler fill. */
function glyphMask(kind: number): Uint8Array {
  const [cv, c] = canvas(GLYPH, GLYPH);
  paintGlyph(kind, c);
  const a = c.getImageData(0, 0, GLYPH, GLYPH).data;
  void cv;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < GLYPH && y < GLYPH && a[(y * GLYPH + x) * 4 + 3] > 110;
  const m = new Uint8Array(GLYPH * GLYPH);
  for (let y = 0; y < GLYPH; y++) {
    for (let x = 0; x < GLYPH; x++) {
      if (solid(x, y)) m[y * GLYPH + x] = a[(y * GLYPH + x) * 4 + 1] < 128 ? 3 : 1;
      // (A dark line cut round it, so it stands off the stone.)
      else if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1)) m[y * GLYPH + x] = 2;
    }
  }
  return m;
}

export class StoneWheel {
  readonly sprite: Sprite;
  private cv: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  private tex: Texture;
  private ring: HTMLCanvasElement;
  private shaft: HTMLCanvasElement;
  private disc: HTMLCanvasElement;
  private pointer: HTMLCanvasElement;
  /** Each wedge, lit up. */
  private lit: HTMLCanvasElement[] = [];
  private rot = 0.3;
  private from = 0;
  private to = 0;
  private t0 = 0;
  private dur = 0;
  private spinning = false;
  /** The wedge lit up (-1: none), and when. */
  private on = -1;
  private onAt = 0;
  private dirty = true;
  private paintedAt = 0;
  private lastPeg = 0;
  /** How far down its shaft it's sunk (0..1). */
  private sink = 0;
  /** Each time a wedge's edge goes by the pointer: how fast, which kind, how many wedges to go. */
  onPeg: (speed: number, kind: number, left: number) => void = () => {};

  constructor(size: number) {
    [this.cv, this.c] = canvas();
    this.c.imageSmoothingEnabled = false;
    this.ring = this.bakeRing();
    this.shaft = this.bakeShaft();
    const masks = KINDS.map(glyphMask);
    this.disc = this.bakeDisc(masks, -1);
    this.lit = KINDS.map((_, i) => this.bakeDisc(masks, i));
    this.pointer = this.bakePointer();
    this.tex = Texture.from(this.cv);
    this.tex.source.scaleMode = "nearest";
    this.sprite = new Sprite(this.tex);
    this.sprite.anchor.set(0.5);
    const k = size / L;
    // (Lying on the ground: foreshortened, as the rest of the sand is.)
    this.sprite.scale.set(k, k * 0.82);
  }

  /** World px down the shaft the disc is, at depth `s`, for what's riding on it. */
  static dropAt(s: number, size: number): number {
    return (SINK_DROP * s * size * 0.82) / L;
  }

  private bakeRing(): HTMLCanvasElement {
    const [cv, c] = canvas();
    const img = c.createImageData(L, L);
    const d = img.data;
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const [dx, dy] = [x + 0.5 - C, y + 0.5 - C];
        const r = Math.hypot(dx, dy);
        const i = (y * L + x) * 4;
        if (r > R_OUT || r < R_DISC) continue;
        let rgb: [number, number, number];
        if (r < R_DISC + 3) rgb = [32, 25, 23];
        else {
          const a = ((Math.atan2(dy, dx) + Math.PI) / TAU) * 22;
          const seam = Math.abs(a - Math.round(a)) * (TAU / 22) * r < 1;
          const n = hash(Math.floor(a), 3);
          const tone = 124 + n * 30 + (hash(x, y) - 0.5) * 11 + (r > R_OUT - 2 ? -40 : r < R_DISC + 5 ? -24 : 8) + (dy < 0 ? 7 : -6);
          rgb = seam ? [60, 50, 44] : [tone * 1.02, tone * 0.95, tone * 0.84];
        }
        d[i] = rgb[0];
        d[i + 1] = rgb[1];
        d[i + 2] = rgb[2];
        d[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  /** The shaft's walls: courses of dressed stone going down into the dark. */
  private bakeShaft(): HTMLCanvasElement {
    const [cv, c] = canvas();
    const img = c.createImageData(L, L);
    const d = img.data;
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const [dx, dy] = [x + 0.5 - C, y + 0.5 - C];
        const r = Math.hypot(dx, dy);
        if (r > R_DISC) continue;
        const i = (y * L + x) * 4;
        // Rows of blocks, staggered; darker the further down the wall.
        const row = Math.floor((dy + R_DISC) / 11);
        const col = Math.floor((dx + (row % 2) * 9) / 18);
        const seam = (dy + R_DISC) % 11 < 1.2 || (dx + (row % 2) * 9 + 400) % 18 < 1.2;
        const depth = Math.max(0.12, 1 - (dy + R_DISC) / (R_DISC * 1.1));
        const tone = seam ? 26 : (70 + hash(row, col) * 36) * depth + 12;
        d[i] = tone;
        d[i + 1] = tone * 0.9;
        d[i + 2] = tone * 0.84;
        d[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  /** The disc itself (carved, stone throughout), with wedge `lit` lit up if any. */
  private bakeDisc(masks: Uint8Array[], lit: number): HTMLCanvasElement {
    const [cv, c] = canvas();
    const img = c.createImageData(L, L);
    const d = img.data;
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const [u, v] = [x + 0.5 - C, y + 0.5 - C];
        const r = Math.hypot(u, v);
        if (r > R_DISC) continue;
        const i = (y * L + x) * 4;
        const local = (Math.atan2(v, u) + TAU) % TAU;
        const wedge = Math.floor(local / SEG) % SEGS;
        const mid = (wedge + 0.5) * SEG;
        const edge = (SEG / 2 - Math.abs(local - mid)) * r;
        const isLit = wedge === lit;
        if (lit >= 0 && !isLit) continue;
        const n = hash(Math.round(u * 0.34), Math.round(v * 0.34));
        let tone = 138 + (n - 0.5) * 24 + (hash(x, y) - 0.5) * 9;
        if (r > R_DISC - 3) tone -= 26;
        else if (r > R_DISC - 5) tone += 16;
        const [hr, hg, hb] = HUES[KINDS[wedge]];
        let [cr, cg, cb] = isLit ? [hr * 0.92, hg * 0.92, hb * 0.92] : [tone, tone * 0.93, tone * 0.82];
        // The carving: stood up facing the pointer when its wedge is under it.
        const [ca, sa] = [Math.cos(mid), Math.sin(mid)];
        const out = u * ca + v * sa;
        const across = -u * sa + v * ca;
        const gx = Math.floor(across + GLYPH / 2);
        const gy = Math.floor(GLYPH_AT - out + GLYPH / 2);
        const m = gx >= 0 && gy >= 0 && gx < GLYPH && gy < GLYPH ? masks[wedge][gy * GLYPH + gx] : 0;
        if (m === 1 || m === 3) {
          // Filled with its colour, a little shaded across the stone's grain.
          // (The lion's mane goes darker, for its pale face to show.)
          const f = (KINDS[wedge] === 3 && m === 1 ? 0.72 : 1) * (0.92 + (hash(gx >> 1, gy >> 1) - 0.5) * 0.14);
          const pale = m === 3 ? 0.55 : 0;
          [cr, cg, cb] = isLit ? [255, 250, 225] : [hr * f + (255 - hr) * pale, hg * f + (255 - hg) * pale, hb * f + (255 - hb) * pale];
        } else if (m === 2) [cr, cg, cb] = isLit ? [120, 60, 20] : [34, 26, 24];
        // The grooves between the wedges, and the hub.
        if (edge < 1.6 && r > R_HUB) [cr, cg, cb] = [46, 38, 34];
        if (r < R_HUB + 3 && r > R_HUB) [cr, cg, cb] = [44, 36, 32];
        if (r <= R_HUB) {
          const t = 170 - r * 3.4 + (u + v) * -0.5 + (hash(Math.round(u), Math.round(v)) - 0.5) * 10;
          [cr, cg, cb] = [t, t * 0.9, t * 0.74];
        }
        d[i] = Math.max(0, Math.min(255, cr));
        d[i + 1] = Math.max(0, Math.min(255, cg));
        d[i + 2] = Math.max(0, Math.min(255, cb));
        d[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  /** The stone pointer: a wedge on the fixed ring, reaching in over the disc. */
  private bakePointer(): HTMLCanvasElement {
    const [cv, c] = canvas();
    const img = c.createImageData(L, L);
    const d = img.data;
    for (let py = 0; py < 26; py++) {
      const half = 14 - py * 0.54;
      for (let dx = -14; dx <= 14; dx++) {
        if (Math.abs(dx) > half) continue;
        const i = ((py + 1) * L + (C + dx)) * 4;
        const rim = Math.abs(dx) > half - 1.6 || py < 2;
        const t = rim ? 46 : 200 - py * 2.8 - dx * 1.6;
        d[i] = rim ? t : t * 1.05;
        d[i + 1] = rim ? t * 0.8 : t * 0.92;
        d[i + 2] = rim ? t * 0.6 : t * 0.6;
        d[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  /** Which wedge is under the pointer. */
  private under(rot: number): number {
    const t = (((POINTER - rot) % TAU) + TAU) % TAU;
    return Math.floor(t / SEG) % SEGS;
  }

  /** Which kind of disaster's under the pointer. */
  get pointing(): number {
    return KINDS[this.under(this.rot)];
  }

  /** Grinds round for `ms`, to stop on `kind`'s wedge. */
  spin(kind: number, ms: number, now: number) {
    const i = KINDS.indexOf(kind);
    const inside = (Math.random() - 0.5) * SEG * 0.5;
    this.from = this.rot;
    let to = POINTER - (i + 0.5) * SEG + inside;
    while (to < this.from + TAU * 4) to += TAU;
    this.to = to;
    this.t0 = now;
    this.dur = Math.max(600, ms - 120);
    this.spinning = true;
    this.on = -1;
    this.lastPeg = Math.floor(this.rot / SEG);
    this.dirty = true;
  }

  /** Already stopped on `kind` (seen late), or its wedge to light. */
  settle(kind: number, now: number) {
    this.spinning = false;
    if (KINDS[this.under(this.rot)] !== kind) this.rot = POINTER - (KINDS.indexOf(kind) + 0.5) * SEG;
    if (this.on >= 0) return;
    this.on = this.under(this.rot);
    this.onAt = now;
    this.dirty = true;
  }

  /** Back to plain stone for a new round. */
  reset() {
    if (this.on < 0 && !this.spinning && !this.sink) return;
    this.on = -1;
    this.spinning = false;
    this.sink = 0;
    this.dirty = true;
  }

  /** How far down its shaft it is (0..1). */
  setSink(s: number) {
    if (s === this.sink) return;
    this.sink = s;
    this.dirty = true;
  }

  tick(now: number) {
    if (this.spinning) {
      const u = Math.min(1, (now - this.t0) / this.dur);
      // A heavy thing: it takes a moment to get going, and grinds to a stop.
      const e = u < 0.16 ? (u / 0.16) ** 2 * 0.09 : 0.09 + 0.91 * (1 - (1 - (u - 0.16) / 0.84) ** 3.2);
      const before = this.rot;
      this.rot = this.from + (this.to - this.from) * e;
      const peg = Math.floor(this.rot / SEG);
      if (peg !== this.lastPeg) {
        this.lastPeg = peg;
        this.onPeg(Math.min(1, (this.rot - before) / 0.22), this.pointing, (this.to - this.rot) / SEG);
      }
      this.dirty = true;
      if (u >= 1) this.spinning = false;
    }
    // (A lit wedge throbs: a dozen redraws a second is plenty.)
    if (this.on >= 0 && now - this.paintedAt > 80) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.paintedAt = now;
    this.paint(now);
  }

  private paint(now: number) {
    const c = this.c;
    const s = this.sink;
    c.clearRect(0, 0, L, L);
    c.drawImage(this.ring, 0, 0);
    // The disc, in its shaft: the far wall showing above it as it goes down.
    c.save();
    c.beginPath();
    c.arc(C, C, R_DISC, 0, TAU);
    c.clip();
    if (s > 0) c.drawImage(this.shaft, 0, 0);
    c.translate(C, C + SINK_DROP * s);
    c.rotate(this.rot);
    const scale = 1 - 0.07 * s;
    c.scale(scale, scale);
    c.drawImage(this.disc, -C, -C);
    if (this.on >= 0) {
      const since = now - this.onAt;
      c.globalAlpha = Math.min(1, 0.72 + 0.16 * Math.sin(now / 170) + Math.max(0, 1 - since / 500) * 0.4);
      c.drawImage(this.lit[this.on], -C, -C);
      c.globalAlpha = 1;
    }
    c.restore();
    if (s > 0) {
      // Going down into the dark.
      c.save();
      c.beginPath();
      c.arc(C, C, R_DISC, 0, TAU);
      c.clip();
      c.fillStyle = `rgba(6, 3, 4, ${s * s * 0.86})`;
      c.fillRect(0, 0, L, L);
      c.restore();
    }
    c.drawImage(this.pointer, 0, 0);
    this.tex.source.update();
  }

  destroy() {
    this.sprite.destroy();
    this.tex.destroy(true);
  }
}
