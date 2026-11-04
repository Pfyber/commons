// The wheel of classes: with it on, before every round a big pixel-art
// wheel spins for you (ten segments, each class twice, with the picker's
// badges), winds back, whirls, clacks past the pointer peg by peg (every
// peg heard, each class its own note) and eases to a stop on the class the
// server gave you; a flash, confetti, that class's own sting, and everyone
// else's shown beneath. A new class each round.
//
// The disc is drawn a pixel at a time at half size and blown up, so it
// turns in chunky pixels like the rest of the game; the badges ride on it
// upright (as crisp as in the picker).

import * as fx from "../ambient/wheelsfx";
import { KIT, KITS, kitBadge } from "./arenakits";
import { el } from "../ui/panels";

const SEGS = KIT.COUNT * 2;
const TAU = Math.PI * 2;
const SEG = TAU / SEGS;
/** The low-res canvas (its pixels are `SCALE` screen pixels each). */
const L = 150;
const SCALE = 2;
const CX = 75;
const CY = 80;
const R = 58;
const RIM = 66;
const HUB = 10;
/** The wind-back, the spin, and the settle (ms). */
const WIND_MS = 480;
const SPIN_MS = 5200;
const SETTLE_MS = 420;
/** Turns it makes (at least). */
const TURNS = 6;

/** "#rrggbb" → ABGR (as ImageData takes it, little-endian), lightened or darkened by `f`. */
function abgr(hex: string, f = 0): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/** Each class's tones on the wheel: lit, base, shaded (at the rim), and the base a shade darker (alternate segments). */
const TONES = KITS.map((k) => [abgr(k.tint, 0.22), abgr(k.tint), abgr(k.tint, -0.3), abgr(k.tint, -0.12)]);
const OUTLINE = abgr("#2b1a0c");
const GOLD = [abgr("#fff1b0"), abgr("#e8b84a"), abgr("#a8761e"), abgr("#6e4a12")];
const FRET = abgr("#ffe08a");

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: string;
  life: number;
}

export class ClassWheel {
  readonly el = el("div", "ark-wheel");
  private canvas = el("canvas", "ark-wheel-disc");
  private low = document.createElement("canvas");
  private img: ImageData;
  private badges: HTMLImageElement[] = [];
  private title = el("div", "ark-wheel-title", "🎡 THE WHEEL OF CLASSES 🎡");
  private result = el("div", "ark-wheel-result");
  private others = el("div", "ark-wheel-others");
  private card = el("div", "ark-wheel-card");
  /** The spin being shown: where it starts and stops, when it began. */
  private spin: { from: number; to: number; t0: number; dur: number; target: number; landed: boolean; landedAt: number; loose: boolean } | null = null;
  private angle = 0;
  /** Pegs gone by the pointer (counting every one, however fast they pass). */
  private lastPeg = 0;
  private flap = 0;
  private raf = 0;
  private othersKey = "";
  private bits: Bit[] = [];

  constructor() {
    this.low.width = L;
    this.low.height = L;
    this.img = this.low.getContext("2d")!.createImageData(L, L);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = L * SCALE * dpr;
    this.canvas.height = L * SCALE * dpr;
    this.canvas.style.width = `${L * SCALE}px`;
    this.canvas.style.height = `${L * SCALE}px`;
    for (let k = 0; k < KIT.COUNT; k++) {
      const im = new Image();
      im.src = kitBadge(k);
      this.badges.push(im);
    }
    this.card.append(this.title, this.canvas, this.result, this.others);
    this.el.append(this.card);
    this.el.hidden = true;
    document.body.append(this.el);
  }

  /**
   * Called every frame: shown while the wheel's on (`leftMs` > 0), landing
   * on `mine` (our class); `others`, who else got what (shown once it stops).
   */
  update(leftMs: number, mine: number, others: { name: string; color: string; kit: number }[]) {
    const show = leftMs > 0 && mine >= 0;
    if (!show) {
      if (!this.el.hidden) this.stop();
      return;
    }
    if (this.el.hidden || !this.spin || this.spin.target !== mine) this.start(mine, leftMs);
    const key = others.map((o) => `${o.name}${o.kit}`).join(",") + (this.spin?.landed ? "!" : "");
    if (key !== this.othersKey) {
      this.othersKey = key;
      this.others.replaceChildren();
      if (this.spin?.landed) {
        for (const o of others) {
          const row = el("span", "ark-wheel-other");
          const dot = el("i");
          dot.style.background = o.color;
          const badge = document.createElement("img");
          badge.src = kitBadge(o.kit);
          badge.alt = "";
          row.append(dot, `${o.name}: `, badge, KITS[o.kit].name);
          this.others.append(row);
        }
      }
    }
  }

  destroy() {
    this.stop();
    this.el.remove();
  }

  private start(target: number, leftMs: number) {
    this.el.hidden = false;
    this.result.replaceChildren();
    this.result.className = "ark-wheel-result";
    this.card.classList.remove("landed");
    this.card.style.transform = "";
    this.othersKey = "";
    this.bits = [];
    // Stop with one of its two segments under the pointer (at the top),
    // somewhere inside it; after six turns or so.
    const seg = target + KIT.COUNT * (Math.random() < 0.5 ? 0 : 1);
    const inside = (Math.random() - 0.5) * SEG * 0.6;
    const from = this.angle % TAU;
    let to = -(seg * SEG + SEG / 2) + inside;
    while (to < from + TAU * TURNS) to += TAU;
    // (Joined late, it spins shorter.)
    const dur = Math.max(800, Math.min(WIND_MS + SPIN_MS + SETTLE_MS, leftMs - 1400));
    this.spin = { from, to, t0: performance.now(), dur, target, landed: false, landedAt: 0, loose: false };
    this.lastPeg = Math.floor(from / SEG);
    fx.windup();
    cancelAnimationFrame(this.raf);
    const frame = (now: number) => {
      this.tick(now);
      if (!this.el.hidden) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private stop() {
    this.el.hidden = true;
    this.spin = null;
    cancelAnimationFrame(this.raf);
  }

  /** Which segment's under the pointer at wheel angle `a`. */
  private segAt(a: number): number {
    const t = ((-a % TAU) + TAU) % TAU;
    return Math.floor(t / SEG) % SEGS;
  }

  /**
   * Where the wheel is `ms` into a spin of `dur` from `from` to `to`: a
   * little wind back, a whirl easing out (quartic: fast enough to thrill,
   * every peg still heard, and it creeps the last few), a hair past the
   * stop and back.
   */
  private at(ms: number, dur: number, from: number, to: number): number {
    const k = dur / (WIND_MS + SPIN_MS + SETTLE_MS);
    const wind = WIND_MS * k;
    const spin = SPIN_MS * k;
    const back = 0.18;
    const over = SEG * 0.12;
    if (ms < wind) {
      const u = ms / wind;
      return from - back * Math.sin((u * Math.PI) / 2);
    }
    if (ms < wind + spin) {
      const u = (ms - wind) / spin;
      const e = 1 - (1 - u) ** 4;
      return from - back + (to + over - (from - back)) * e;
    }
    const u = Math.min(1, (ms - wind - spin) / (dur - wind - spin));
    return to + over * (1 - (1 - (1 - u) ** 3));
  }

  private tick(now: number) {
    const sp = this.spin;
    if (!sp) return;
    const ms = now - sp.t0;
    this.angle = this.at(Math.min(ms, sp.dur), sp.dur, sp.from, sp.to);
    // Let go: the spring, the rush of air.
    const k = sp.dur / (WIND_MS + SPIN_MS + SETTLE_MS);
    if (!sp.loose && ms >= WIND_MS * k) {
      sp.loose = true;
      fx.release((SPIN_MS * k) / 1000);
    }
    // Every peg past the pointer (a few in a frame at full tilt): one
    // flapper's clack each, a little apart. Rattling at speed, slowing to
    // deep clacks with each class's note, the last few with a heartbeat.
    const pegNow = Math.floor(this.angle / SEG);
    const passed = pegNow - this.lastPeg;
    if (passed !== 0) {
      this.lastPeg = pegNow;
      const left = (sp.to - this.angle) / SEG;
      const speed = Math.max(0, Math.min(1, left / 18));
      if (passed > 0) {
        this.flap = 1;
        for (let i = 0; i < Math.min(passed, 3); i++) fx.peg(speed, this.segAt(this.angle) % KIT.COUNT, left, i * 7);
        // Sparks off the pointer while it whirls.
        if (speed > 0.25) {
          for (let i = 0; i < 2; i++) this.bits.push({ x: CX + (Math.random() - 0.5) * 4, y: CY - R - 3, vx: (Math.random() - 0.5) * 1.8, vy: -0.6 - Math.random() * 1.2, c: i ? "#ffe08a" : "#fff8e3", life: 10 + Math.random() * 10 });
        }
      }
    }
    // The last few pegs: the whole card leaning in.
    if (!sp.landed && sp.loose) {
      const left = Math.max(0, (sp.to - this.angle) / SEG);
      this.card.style.transform = left < 5 ? `scale(${(1 + 0.05 * (1 - left / 5)).toFixed(3)})` : "";
    }
    this.flap *= 0.8;
    if (ms >= sp.dur && !sp.landed) {
      sp.landed = true;
      sp.landedAt = now;
      this.land(sp.target);
    }
    // The confetti falls.
    for (const b of this.bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.vy += 0.09;
      b.vx *= 0.98;
      b.life -= 1;
    }
    this.bits = this.bits.filter((b) => b.life > 0 && b.y < L);
    this.draw(now);
  }

  /** It's stopped on `k`: a flash, a burst of confetti, the fanfare, the name. */
  private land(k: number) {
    const info = KITS[k];
    const badge = document.createElement("img");
    badge.src = kitBadge(k);
    badge.alt = "";
    this.result.replaceChildren(badge, `${info.name.toUpperCase()}!`);
    this.result.className = "ark-wheel-result landed";
    this.result.style.color = info.tint;
    this.card.classList.remove("landed");
    void this.card.offsetWidth;
    this.card.classList.add("landed");
    this.card.style.transform = "";
    this.card.style.setProperty("--win", info.tint);
    const cols = [info.tint, "#ffe08a", "#fff8e3", "#ff8a3f", info.tint];
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const v = 1.2 + Math.random() * 2.6;
      this.bits.push({ x: CX, y: CY - R - 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: cols[i % cols.length], life: 60 + Math.random() * 50 });
    }
    fx.landed(k);
  }

  private draw(now: number) {
    const sp = this.spin;
    const landed = sp?.landed ? sp.target : -1;
    const flash = sp?.landed ? Math.max(0, 1 - (now - sp.landedAt) / 500) : 0;
    const blink = landed >= 0 && Math.floor(now / 160) % 2 === 0;
    // The disc, a pixel at a time.
    const d = new Uint32Array(this.img.data.buffer);
    d.fill(0);
    const a = this.angle;
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const dx = x + 0.5 - CX;
        const dy = y + 0.5 - CY;
        const r = Math.hypot(dx, dy);
        if (r > RIM + 1.5) continue;
        let c: number;
        if (r > RIM + 0.5) c = OUTLINE;
        else if (r > R + 0.5) {
          // The gold rim: lit at the top left, shaded at the bottom right.
          const lit = (-dx - dy) / r;
          const band = r > RIM - 1.5 ? 2 : r < R + 2 ? 3 : 1;
          c = GOLD[Math.max(0, Math.min(3, band - (lit > 0.45 ? 1 : 0) + (lit < -0.45 ? 1 : 0)))];
        } else if (r > R - 0.5) c = OUTLINE;
        else if (r < HUB + 0.5) {
          if (r > HUB - 0.5) c = OUTLINE;
          else c = r < 3 && dx < 0 && dy < 0 ? GOLD[0] : (dx + dy) / Math.max(r, 1) < -0.3 ? GOLD[1] : GOLD[2];
        } else {
          // (Measured from the top, where the pointer is.)
          const phi = (((Math.atan2(dy, dx) - a + Math.PI / 2) % TAU) + TAU) % TAU;
          const seg = Math.floor(phi / SEG) % SEGS;
          const k = seg % KIT.COUNT;
          const off = phi - seg * SEG;
          // A gold fret between segments (a pixel wide all the way out).
          if (Math.min(off, SEG - off) * r < 0.75) c = FRET;
          else {
            const t = TONES[k];
            // Lit near the hub's top left, shaded at the rim, alternate
            // segments a shade apart; the winner flashes (white, then blinking).
            c = r > R - 4 ? t[2] : (dx + dy) / r < -0.5 && r < R * 0.6 ? t[0] : seg % 2 ? t[3] : t[1];
            if (landed === k) c = flash > 0.4 ? GOLD[0] : blink ? t[0] : c;
          }
        }
        d[y * L + x] = c;
      }
    }
    const g = this.low.getContext("2d")!;
    g.putImageData(this.img, 0, 0);
    // The pegs at the frets' ends, and the bulbs round the rim.
    for (let i = 0; i < SEGS; i++) {
      const b = a + i * SEG - Math.PI / 2;
      pix(g, "#fff8e3", CX + Math.cos(b) * (R - 3) - 1, CY + Math.sin(b) * (R - 3) - 1, 2, 2);
    }
    for (let i = 0; i < 20; i++) {
      const b = (i / 20) * TAU;
      // (They chase round with the wheel, as fast as it's going.)
      const lit = landed >= 0 ? blink : (i + Math.floor(a / (SEG / 2))) % 5 === 0;
      const bx = CX + Math.cos(b) * (R + 4);
      const by = CY + Math.sin(b) * (R + 4);
      pix(g, lit ? "#fffbe0" : "#8a5e14", bx - 1, by - 1, 2, 2);
      if (lit) pix(g, "rgba(255,240,170,0.5)", bx - 2, by - 2, 4, 4);
    }
    // The pointer: a red pixel arrowhead at the top, flicked by the pegs.
    const tip = Math.round(this.flap * 5);
    for (let row = 0; row < 9; row++) {
      const w = 9 - row;
      const px0 = CX - Math.ceil(w / 2) + Math.round((tip * (8 - row)) / 8);
      pix(g, "#2b1a0c", px0 - 1, CY - R - 12 + row, w + 2, 1);
      pix(g, row < 2 ? "#ff7a6a" : "#d0303a", px0, CY - R - 12 + row, w, 1);
    }
    pix(g, "#2b1a0c", CX - 6, CY - R - 13, 12, 1);
    // The confetti.
    for (const b of this.bits) pix(g, b.c, b.x, b.y, b.life % 8 < 4 ? 2 : 1, 2);
    // Up to size, crisp; the badges on top, upright, as sharp as in the picker.
    const out = this.canvas.getContext("2d")!;
    const s = this.canvas.width / (L * SCALE);
    out.setTransform(s, 0, 0, s, 0, 0);
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, L * SCALE, L * SCALE);
    out.drawImage(this.low, 0, 0, L * SCALE, L * SCALE);
    for (let i = 0; i < SEGS; i++) {
      const k = i % KIT.COUNT;
      const b = a + i * SEG + SEG / 2 - Math.PI / 2;
      const win = landed === k;
      const size = win ? 38 + Math.round(4 * Math.abs(Math.sin(now / 140))) : 34;
      const bx = Math.round((CX + Math.cos(b) * R * 0.66) * SCALE - size / 2);
      const by = Math.round((CY + Math.sin(b) * R * 0.66) * SCALE - size / 2);
      const im = this.badges[k];
      if (im.complete) out.drawImage(im, bx, by, size, size);
    }
    // The hub's emblem.
    const hub = this.badges[KIT.KNIGHT];
    if (hub.complete) {
      out.globalAlpha = 0.9;
      out.drawImage(hub, CX * SCALE - 12, CY * SCALE - 12, 24, 24);
      out.globalAlpha = 1;
    }
  }
}

function pix(g: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number) {
  g.fillStyle = col;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}
