// The roulette wheel, drawn as if seen from a seat at the table: tilted
// away (a flat wheel squashed into an ellipse), a wooden bowl with depth, the
// sloped ball track, the ring of pockets with gold frets, the cone and the
// turret in the middle standing up off it. The ball runs round the track
// against the wheel, slows, drops, bounces over the frets and settles in its
// pocket, with the sounds of it.

import * as cs from "../ambient/casinosfx";

export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const TAU = Math.PI * 2;
const STEP = TAU / WHEEL.length;

/** How squashed (the tilt), the canvas size (css px), and the radii (flat). */
const K = 0.46;
const W = 260;
const H = 172;
const CX = W / 2;
const CY = 74;
const R_BOWL = 124;
const R_TRACK = 108;
const R_NUM = 92;
const R_POCKET_OUT = 82;
const R_POCKET_IN = 60;
const R_CONE = 44;

export class Wheel3D {
  readonly canvas = document.createElement("canvas");
  /** The wheel's turn, the ball's angle (both flat, absolute), its radius and lift. */
  private angle = 0;
  private ball = { a: -Math.PI / 2, r: R_TRACK, lift: 0, shown: false };
  private landed: number | null = null;

  constructor() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.canvas.className = "wheel wheel3d";
  }

  /** Spins to land on `n` in `dur` ms (resolves when it's settled). */
  spin(n: number, dur: number): Promise<void> {
    this.landed = null;
    const i = WHEEL.indexOf(n);
    const a0 = this.angle;
    // The wheel turns a couple of times one way, easing out.
    const a1 = a0 + TAU * 2 + Math.random() * TAU;
    // The ball, against it: where it ends (its pocket, wherever the wheel ends).
    const pocket = i * STEP - Math.PI / 2;
    const rel1 = pocket;
    const rel0 = pocket + TAU * (5 + Math.random());
    const drop = 0.58;
    const t0 = performance.now();
    cs.ballRoll((dur * drop) / 1000);
    let lastSlot = Math.floor(rel0 / STEP);
    let lastClick = 0;
    return new Promise((done) => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const wheel = 1 - (1 - t) ** 2.2;
        this.angle = a0 + (a1 - a0) * wheel;
        const ball = 1 - (1 - t) ** 3;
        const rel = rel0 + (rel1 - rel0) * ball;
        this.ball.a = this.angle + rel;
        this.ball.shown = true;
        if (t < drop) {
          this.ball.r = R_TRACK;
          this.ball.lift = 0;
        } else {
          // Off the track, down the slope, bouncing over the frets.
          const k = (t - drop) / (1 - drop);
          const fall = Math.min(1, k / 0.35);
          this.ball.r = R_TRACK - (R_TRACK - (R_POCKET_OUT + R_POCKET_IN) / 2) * fall;
          this.ball.lift = Math.abs(Math.sin(k * Math.PI * 7)) * 10 * (1 - k) ** 2;
          // A click each fret it crosses (not too many a second).
          const slot = Math.floor(rel / STEP);
          if (slot !== lastSlot && now - lastClick > 45 && fall > 0.6) {
            lastClick = now;
            cs.fret(Math.max(0.1, 1 - k), 0.9);
          }
          lastSlot = slot;
        }
        this.draw();
        if (t < 1) requestAnimationFrame(frame);
        else {
          this.ball.lift = 0;
          this.landed = n;
          cs.pocket();
          this.draw();
          done();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  /** Shows `n` as landed (the ball in its pocket) without spinning. */
  rest(n: number | null) {
    this.landed = n;
    if (n !== null) {
      this.ball = { a: this.angle + WHEEL.indexOf(n) * STEP - Math.PI / 2, r: (R_POCKET_OUT + R_POCKET_IN) / 2, lift: 0, shown: true };
    }
    this.draw();
  }

  draw() {
    const c = this.canvas;
    const ctx = c.getContext("2d")!;
    const s = c.width / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // The shadow it casts, the bowl's side (wood, its depth), then its top.
    flat(ctx, () => disc(ctx, 0, 30 / K, R_BOWL + 6, "rgba(0,0,0,0.28)"));
    const side = ctx.createLinearGradient(0, CY, 0, CY + 30);
    side.addColorStop(0, "#5a3418");
    side.addColorStop(1, "#2c1709");
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.ellipse(CX, CY + 18, R_BOWL, R_BOWL * K, 0, 0, Math.PI);
    ctx.lineTo(CX - R_BOWL, CY);
    ctx.ellipse(CX, CY, R_BOWL, R_BOWL * K, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    flat(ctx, () => {
      const wood = ctx.createRadialGradient(-30, -40, 10, 0, 0, R_BOWL);
      wood.addColorStop(0, "#a8673a");
      wood.addColorStop(1, "#6b3a1c");
      disc(ctx, 0, 0, R_BOWL, wood);
      ring(ctx, R_BOWL - 1.5, "#d8b45a", 1.5);
      // The ball track: a sloped band, polished.
      const track = ctx.createRadialGradient(0, 0, R_NUM, 0, 0, R_TRACK + 8);
      track.addColorStop(0, "#3a2414");
      track.addColorStop(0.7, "#7b4a26");
      track.addColorStop(1, "#4a2a14");
      disc(ctx, 0, 0, R_TRACK + 8, track);
      ring(ctx, R_TRACK + 8, "#2a160a", 1);
      // The wheel itself (turned): numbers, pockets, frets.
      ctx.save();
      ctx.rotate(this.angle);
      WHEEL.forEach((n, i) => {
        const a = i * STEP - Math.PI / 2;
        const col = n === 0 ? "#1f8a4c" : RED.has(n) ? "#b8322a" : "#1b1816";
        sector(ctx, R_POCKET_IN, R_NUM + 6, a - STEP / 2, a + STEP / 2, col);
        // Each pocket's floor, a shade darker.
        sector(ctx, R_POCKET_IN, R_POCKET_OUT, a - STEP / 2, a + STEP / 2, "rgba(0,0,0,0.32)");
        ctx.save();
        ctx.rotate(a + Math.PI / 2);
        ctx.fillStyle = n === this.landed ? "#ffe14f" : "#fff8e3";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(n), 0, -R_POCKET_OUT - 3);
        ctx.restore();
        // The fret between it and the next.
        const b = a + STEP / 2;
        ctx.strokeStyle = "#e3c26a";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(b) * R_POCKET_IN, Math.sin(b) * R_POCKET_IN);
        ctx.lineTo(Math.cos(b) * R_POCKET_OUT, Math.sin(b) * R_POCKET_OUT);
        ctx.stroke();
      });
      ring(ctx, R_POCKET_OUT, "#e3c26a", 1.2);
      ring(ctx, R_POCKET_IN, "#e3c26a", 1.5);
      // The cone, rising to the middle.
      const cone = ctx.createRadialGradient(-12, -14, 4, 0, 0, R_POCKET_IN);
      cone.addColorStop(0, "#d79a5a");
      cone.addColorStop(0.55, "#8a4f26");
      cone.addColorStop(1, "#4a2812");
      disc(ctx, 0, 0, R_POCKET_IN - 1, cone);
      ring(ctx, R_CONE, "rgba(255,230,170,0.35)", 1);
      ctx.restore();
    });
    // The turret, standing up off the cone: a post and four arms with knobs.
    const top = CY - 16;
    const post = ctx.createLinearGradient(CX - 4, 0, CX + 4, 0);
    post.addColorStop(0, "#9a7a2a");
    post.addColorStop(0.5, "#fff0b0");
    post.addColorStop(1, "#8a6a20");
    ctx.fillStyle = post;
    ctx.fillRect(CX - 3, top, 6, CY - top);
    for (let k = 0; k < 4; k++) {
      const a = this.angle + (k * Math.PI) / 2;
      const ex = CX + Math.cos(a) * 24;
      const ey = top + Math.sin(a) * 24 * K;
      ctx.strokeStyle = "#e3c26a";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(CX, top);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ball(ctx, ex, ey, 3.2, "#f3d983");
    }
    ball(ctx, CX, top - 2, 5, "#f3d983");
    // The ball, its shadow beneath it.
    if (this.ball.shown) {
      const bx = CX + Math.cos(this.ball.a) * this.ball.r;
      const by = CY + Math.sin(this.ball.a) * this.ball.r * K;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(bx + 1, by + 1.5, 4, 2, 0, 0, TAU);
      ctx.fill();
      ball(ctx, bx, by - 3 - this.ball.lift, 4, "#ffffff");
    }
    // A sheen across the rim.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(CX, CY, R_BOWL - 6, (R_BOWL - 6) * K, 0, Math.PI * 1.1, Math.PI * 1.45);
    ctx.stroke();
    // What it landed on, in a badge.
    if (this.landed !== null) {
      const n = this.landed;
      const col = n === 0 ? "#1f8a4c" : RED.has(n) ? "#b8322a" : "#1b1816";
      ctx.fillStyle = col;
      ctx.strokeStyle = "#e3c26a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W - 22, H - 22, 17, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff8e3";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), W - 22, H - 21);
      ctx.textBaseline = "alphabetic";
    }
  }
}

/** Draws `f` in the wheel's plane (its middle at 0, 0; squashed by the tilt). */
function flat(ctx: CanvasRenderingContext2D, f: () => void) {
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(1, K);
  f();
  ctx.restore();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, r: number, color: string, w: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
}

function sector(ctx: CanvasRenderingContext2D, r0: number, r1: number, a0: number, a1: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, r1, a0, a1);
  ctx.arc(0, 0, r0, a1, a0, true);
  ctx.closePath();
  ctx.fill();
}

/** A shiny little sphere. */
function ball(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.35, color);
  g.addColorStop(1, "#6b5a3a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
