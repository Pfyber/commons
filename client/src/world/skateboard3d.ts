// The skateboard in Dusty's shop window: drawn in fake 3D, a few hundred
// pixels a frame, turning slowly on show (spun round its length, so you see
// the grip on top, then the graphic underneath), with its trucks, wheels and
// bearings as they're built, the glow deck's light, and the trail streaming
// past behind it. Small (a pixel-art canvas), scaled up crisp.

import type { Kit } from "../activities/skatekit";
import { DECKS } from "../activities/skatekit";
import { polygon } from "./pixeldraw";

const O = "#2a2433";
type V3 = [number, number, number];
type P2 = [number, number];

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

function shade(color: string, k: number): string {
  const n = Number.parseInt(color.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** The trucks' metal, by which (stock silver, flip red, grind black, vert gold, pro cyan). */
const TRUCK_METAL = ["#b9c2c9", "#e8566b", "#3a3a44", "#e8b923", "#3fd8e8"];
/** The bearings' glint, by level. */
const BEARING = ["", "#b9c2c9", "#c9874a", "#ffd23f", "#f4f1e8", "#ff8fd8"];
/** The wheels' radius, by size (standard, small, big). */
const WHEEL_R = [5, 4, 6.4];

/**
 * Draws `kit`'s board on `ctx` (its whole canvas), `t` seconds into its
 * turn. The board's 112 units long; it's drawn about canvas-wide.
 */
export function drawBoard3d(ctx: CanvasRenderingContext2D, kit: Kit, t: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  // The window behind it: a dark shop wall, a pool of light on the shelf.
  ctx.fillStyle = "#1f1a2b";
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 6) {
    ctx.fillStyle = y % 12 ? "#231d31" : "#1c1727";
    ctx.fillRect(0, y, W, 3);
  }
  ctx.fillStyle = "rgba(255,240,200,0.07)";
  for (let r = 60; r > 10; r -= 10) {
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.55, r * 1.6, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const deck = DECKS[kit.deck] ?? DECKS[0];
  const cx = W / 2;
  const cy = H * 0.48;
  const s = (W * 0.78) / 112;
  // Turning over now and then (grip up a while, then the graphic), and swaying.
  const phase = (t * 0.3) % 2;
  const half = phase < 1 ? phase : 2 - phase;
  const ease = half < 0.3 ? 0 : half > 0.7 ? 1 : (1 - Math.cos(((half - 0.3) / 0.4) * Math.PI)) / 2;
  const roll = Math.PI * ease + Math.sin(t * 1.3) * 0.12;
  const yaw = Math.sin(t * 0.7) * 0.4;
  const elev = 0.95;
  const project = (p: V3): { at: P2; depth: number } => {
    // Roll round x, then yaw round z, then seen from the front, above.
    const [x, y0, z0] = p;
    const y1 = y0 * Math.cos(roll) - z0 * Math.sin(roll);
    const z1 = y0 * Math.sin(roll) + z0 * Math.cos(roll);
    const x2 = x * Math.cos(yaw) - y1 * Math.sin(yaw);
    const y2 = x * Math.sin(yaw) + y1 * Math.cos(yaw);
    const bob = Math.sin(t * 1.6) * 2;
    return { at: [cx + x2 * s, cy + bob - z1 * s * Math.cos(elev) + y2 * s * Math.sin(elev)], depth: y2 * Math.sin(elev) + z1 * Math.cos(elev) };
  };
  // Which way the deck's top faces: up out of the screen (grip), or down (the graphic).
  const nz = project([0, 0, 1]).depth - project([0, 0, 0]).depth;

  // The trail streaming past behind it.
  trail(ctx, kit.trail, t, W, cy);
  // The glow deck's light behind it.
  if (deck.glow) {
    const g = hex(deck.glow);
    for (let r = 46; r > 6; r -= 8) {
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.07 + 0.03 * Math.sin(t * 3);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.9, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // The deck's outline: a stadium, its nose and tail kicked up.
  const len = 56;
  const wid = 15;
  const kick = (x: number) => {
    const a = Math.abs(x);
    return a > 38 ? ((a - 38) / 18) ** 2 * 7 : 0;
  };
  const outline: [number, number][] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI;
    outline.push([len - wid + Math.cos(a) * wid, Math.sin(a) * wid]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / n) * Math.PI;
    outline.push([-len + wid + Math.cos(a) * wid, Math.sin(a) * wid]);
  }
  const face = (z: number) => outline.map(([x, y]) => project([x, y, z + kick(x)]).at);
  const top = face(1.5);
  const bottom = face(-1.5);

  // The running gear: trucks and wheels under the deck (z below it).
  const gear = () => {
    const metal = TRUCK_METAL[kit.trucks] ?? TRUCK_METAL[0];
    const wr = WHEEL_R[kit.wheels] ?? 5;
    for (const tx of [-34, 34]) {
      // The baseplate and the hanger.
      fill(ctx, [[tx - 5, -6, -1.5], [tx + 5, -6, -1.5], [tx + 5, 6, -1.5], [tx - 5, 6, -1.5]].map((p) => project(p as V3).at), shade(metal, 0.8));
      fill(ctx, [[tx - 2, -14, -7], [tx + 2, -14, -7], [tx + 2, 14, -7], [tx - 2, 14, -7]].map((p) => project(p as V3).at), metal);
      fill(ctx, [[tx - 1.5, -3, -1.5], [tx + 1.5, -3, -1.5], [tx + 1.5, 3, -7], [tx - 1.5, 3, -7]].map((p) => project(p as V3).at), shade(metal, 0.65));
      // The wheels, the near one last: cream urethane, a bearing glinting in the middle.
      const wheels = [-16, 16].map((wy) => project([tx, wy, -7 - wr * 0.2]));
      wheels.sort((a, b) => a.depth - b.depth);
      for (const w of wheels) {
        const r = wr * s * 0.62;
        disc(ctx, O, w.at[0], w.at[1], r + 1);
        disc(ctx, "#f4efe2", w.at[0], w.at[1], r);
        disc(ctx, "#d9d0bb", w.at[0] + r * 0.25, w.at[1] + r * 0.25, r * 0.7);
        disc(ctx, BEARING[kit.bearings] ?? BEARING[1], w.at[0], w.at[1], Math.max(1.2, r * 0.35));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(w.at[0] - r * 0.5), Math.round(w.at[1] - r * 0.55), 1, 1);
      }
    }
  };
  const edge = () => {
    // The plies along its edge, between the two faces.
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      fill(ctx, [top[i], top[j], bottom[j], bottom[i]], i % 2 ? "#c8955a" : "#b9874e", false);
    }
  };
  const gripFace = (pts: P2[]) => {
    fill(ctx, pts, "#26232b");
    // Grip speckle, and the truck bolts.
    for (let k = 0; k < 40; k++) {
      const x = -48 + ((k * 37) % 96);
      const y = -12 + ((k * 13) % 24);
      const p = project([x, y, 1.6 + kick(x)]).at;
      ctx.fillStyle = k % 3 ? "#3a3640" : "#4a4552";
      ctx.fillRect(Math.round(p[0]), Math.round(p[1]), 1, 1);
    }
    for (const tx of [-34, 34]) for (const [bx, by] of [[-3, -4], [3, -4], [-3, 4], [3, 4]]) {
      const p = project([tx + bx, by, 1.6]).at;
      ctx.fillStyle = "#b9c2c9";
      ctx.fillRect(Math.round(p[0]), Math.round(p[1]), 1, 1);
    }
  };
  const graphicFace = (pts: P2[]) => {
    const base = hex(deck.color);
    fill(ctx, pts, base);
    // A band across its middle and stripes either side, an emblem in the band.
    const stripe = hex(deck.stripe);
    const z = -1.6;
    fill(ctx, [[-12, -wid, z], [12, -wid, z], [12, wid, z], [-12, wid, z]].map((p) => project(p as V3).at), stripe, false);
    for (const x of [-30, 26]) fill(ctx, [[x, -wid, z], [x + 4, -wid, z], [x + 4, wid, z], [x, wid, z]].map((p) => project(p as V3).at), shade(base, 0.75), false);
    const ring: P2[] = [];
    for (let i = 0; i < 12; i++) ring.push(project([Math.cos((i / 12) * Math.PI * 2) * 7, Math.sin((i / 12) * Math.PI * 2) * 7, z]).at);
    fill(ctx, ring, base);
    const star: P2[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 2 : 5;
      star.push(project([Math.cos((i / 10) * Math.PI * 2) * r, Math.sin((i / 10) * Math.PI * 2) * r, z]).at);
    }
    fill(ctx, star, stripe, false);
    // The gold deck's shine sweeping along it; the glow deck's light on itself.
    if (deck.shine) {
      const sx = ((t * 40) % 140) - 70;
      fill(ctx, [[sx, -wid, z], [sx + 5, -wid, z], [sx + 9, wid, z], [sx + 4, wid, z]].map((p) => project(p as V3).at), "rgba(255,250,220,0.75)", false);
    }
    if (deck.glow) fill(ctx, pts, `rgba(200,255,230,${0.15 + 0.1 * Math.sin(t * 3)})`, false);
  };
  if (nz > 0) {
    // Grip side toward us: the gear's behind the deck.
    gear();
    fill(ctx, bottom, O);
    edge();
    gripFace(top);
  } else {
    fill(ctx, top, O);
    edge();
    graphicFace(bottom);
    gear();
  }
}

/** A polygon, with a pixel's dark outline round it (`outlined`), crisp. */
function fill(ctx: CanvasRenderingContext2D, pts: P2[], color: string, outlined = true) {
  if (outlined) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) polygon(ctx, O, pts.map(([x, y]) => [x + dx, y + dy] as P2));
  polygon(ctx, color, pts);
}

function disc(ctx: CanvasRenderingContext2D, color: string, cx: number, cy: number, r: number) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) {
    const dy = (y + 0.5 - cy) / r;
    if (Math.abs(dy) > 1) continue;
    const hw = r * Math.sqrt(1 - dy * dy);
    const a = Math.round(cx - hw);
    const b = Math.round(cx + hw);
    if (b > a) ctx.fillRect(a, y, b - a, 1);
  }
}

/** The trail, streaming past behind the board in its skin. */
function trail(ctx: CanvasRenderingContext2D, kind: number, t: number, W: number, cy: number) {
  if (!kind) return;
  const y = (x: number) => cy + 10 + Math.sin(x / 18 + t * 4) * 4;
  const xs: number[] = [];
  for (let x = 0; x < W; x += 2) xs.push(x);
  const line = (dy: number, width: number, color: string, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (const x of xs) ctx.fillRect(x, Math.round(y(x) + dy - width / 2), 2, width);
    ctx.globalAlpha = 1;
  };
  if (kind === 2) {
    line(0, 7, "#3fd8e8", 0.25);
    line(0, 3, "#3fd8e8", 0.7);
    line(0, 1, "#ff8fd8", 1);
  } else if (kind === 3) {
    ["#ff4d4d", "#ffa53d", "#ffe14d", "#5fe06a", "#4da6ff", "#a66bff"].forEach((c, k) => line((k - 2.5) * 2, 2, c, 0.9));
  } else if (kind === 5) {
    line(0, 9, "#5a2a9a", 0.5);
    line(0, 4, "#4d6bff", 0.6);
    for (let i = 0; i < 18; i++) {
      const x = (i * 37 + t * 30) % W;
      if ((i + Math.floor(t * 6)) % 3) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(x), Math.round(y(x) + ((i * 7) % 7) - 3), 1, 1);
      }
    }
  } else {
    // Sparks (1) or flames (4): bits flying off, drifting back.
    const fire = kind === 4;
    if (fire) line(0, 3, "#ff6a2a", 0.5);
    for (let i = 0; i < 40; i++) {
      const life = ((t * 1.3 + i / 40) % 1);
      const x = W - life * W;
      const yy = y(x) + (fire ? -life * 14 : life * life * 10) + ((i * 5) % 7) - 3;
      const size = fire ? Math.max(1, Math.round(3 * (1 - life))) : 1;
      ctx.fillStyle = fire ? (life > 0.6 ? "#ff3a1a" : life > 0.3 ? "#ffa53d" : "#ffe14d") : i % 2 ? "#fff3a0" : "#ffd23f";
      ctx.globalAlpha = 1 - life;
      ctx.fillRect(Math.round(x), Math.round(yy), size, size);
    }
    ctx.globalAlpha = 1;
  }
}
