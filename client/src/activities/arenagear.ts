// The arena's gladiators' arms, by class (activities/arenakits): drawn
// live each frame in their colour, over their avatar, posed by what they're
// doing. The knight's sword and shield; the spearman's long spear and round
// buckler, thrust out; the tank's tower shield and war hammer, brought down;
// the archer's quiver and dagger, the bow turned to the aim and drawn back as
// it charges; the bomber's belt of bombs and dagger, one lit and raised to
// lob, and a red-hot glow before the big bang.

import type { Graphics } from "pixi.js";
import { ACT, CAST, KIT, SHOOT } from "./arenakits";

/** How they're holding themselves: what they do and how far into it, which way they face and aim. */
export interface Gear {
  kit: number;
  act: number;
  since: number;
  now: number;
  face: 1 | -1;
  aim: number;
  color: number;
  blocking: boolean;
  swinging: boolean;
  charging: boolean;
  /** How far charged (0..1). */
  chargeK: number;
  /** When the swing's blow lands (its wind-up done). */
  windup: number;
}

/** A line of square pixels, `w` wide. */
export function pixelLine(g: Graphics, x1: number, y1: number, x2: number, y2: number, col: number, w = 2) {
  const n = Math.max(1, Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let k = 0; k <= n; k++) g.rect(Math.round(x1 + ((x2 - x1) * k) / n), Math.round(y1 + ((y2 - y1) * k) / n), w, w).fill({ color: col });
}

/** Their arms, their feet at (ox, oy) (lifted, if they are). */
export function drawArms(g: Graphics, ox: number, oy: number, p: Gear) {
  const { kit, since, now, face, color, blocking, swinging, charging, chargeK, windup } = p;
  const f = { act: p.act };
  const pos = { aim: p.aim };
  const line = (x1: number, y1: number, x2: number, y2: number, col: number, w = 2) => pixelLine(g, x1, y1, x2, y2, col, w);
  const blade = (hx: number, hy: number, tx: number, ty: number, glow = false) => {
    if (glow) line(ox + hx - 1, oy + hy - 1, ox + tx - 1, oy + ty - 1, 0xffe14f, 5);
    line(ox + hx, oy + hy, ox + tx, oy + ty, 0x1a1020, 4);
    line(ox + hx + 1, oy + hy + 1, ox + tx + 1, oy + ty + 1, 0xd8dce8, 2);
    g.rect(ox + hx - 1, oy + hy - 1, 4, 4).fill({ color: 0xc99a2a });
  };
  // A shield, in their colour: up in front when blocking (w × h; round for a buckler).
  const shield = (w: number, h: number, round = false) => {
    if (f.act === ACT.ROLL) return;
    const sh = blocking ? { x: face * 7, y: -30 } : { x: -face * 11, y: -22 };
    if (round) {
      g.circle(ox + sh.x, oy + sh.y + 5, w / 2 + 1).fill({ color: 0x1a1020 });
      g.circle(ox + sh.x, oy + sh.y + 5, w / 2).fill({ color });
      g.rect(ox + sh.x - 1, oy + sh.y + 4, 3, 3).fill({ color: 0xe0b040 });
    } else {
      g.rect(ox + sh.x - w / 2 - 1, oy + sh.y - 1, w + 2, h + 2).fill({ color: 0x1a1020 });
      g.rect(ox + sh.x - w / 2, oy + sh.y, w, h).fill({ color });
      g.rect(ox + sh.x - 1, oy + sh.y + 3, 2, h - 6).fill({ color: 0xfff6d8 });
      if (h > 14) g.rect(ox + sh.x - w / 2 + 2, oy + sh.y + Math.round(h / 2) - 1, w - 4, 2).fill({ color: 0xfff6d8 });
    }
    if (blocking) g.rect(ox + sh.x - w / 2 - 2, oy + sh.y - 3, w + 4, h + 6).stroke({ color: 0x9fe8ff, width: 1, alpha: 0.6 + 0.3 * Math.sin(now / 90) });
  };
  // A dagger: short and quick.
  const dagger = (hx: number, hy: number, tx: number, ty: number) => {
    line(ox + hx, oy + hy, ox + tx, oy + ty, 0x1a1020, 3);
    line(ox + hx + 1, oy + hy + 1, ox + tx, oy + ty, 0xe8ecf4, 1);
    g.rect(ox + hx - 1, oy + hy - 1, 3, 3).fill({ color: 0x6b4a2b });
  };
  // A long spear: the shaft, a steel head at its tip.
  const spear = (hx: number, hy: number, tx: number, ty: number, glow = false) => {
    if (glow) line(ox + hx - 1, oy + hy - 1, ox + tx - 1, oy + ty - 1, 0xffe14f, 4);
    line(ox + hx, oy + hy, ox + tx, oy + ty, 0x1a1020, 3);
    line(ox + hx, oy + hy, ox + tx, oy + ty, 0x9a6a3a, 1);
    const a = Math.atan2(ty - hy, tx - hx);
    for (let k = 0; k < 6; k++) {
      const w = k < 2 ? 3 : k < 4 ? 2 : 1;
      g.rect(Math.round(ox + tx + Math.cos(a) * k) - 1, Math.round(oy + ty + Math.sin(a) * k) - 1, w + 1, w + 1).fill({ color: 0x1a1020 });
      g.rect(Math.round(ox + tx + Math.cos(a) * k), Math.round(oy + ty + Math.sin(a) * k), w, w).fill({ color: 0xd8dce8 });
    }
  };
  // A war hammer: a short haft, a heavy steel head across its end.
  const hammer = (hx: number, hy: number, tx: number, ty: number, glow = false) => {
    line(ox + hx, oy + hy, ox + tx, oy + ty, 0x1a1020, 4);
    line(ox + hx, oy + hy, ox + tx, oy + ty, 0x8a5a32, 2);
    const a = Math.atan2(ty - hy, tx - hx) + Math.PI / 2;
    const [cx, cy] = [ox + tx, oy + ty];
    for (let k = -5; k <= 5; k++) {
      const x = Math.round(cx + Math.cos(a) * k);
      const y = Math.round(cy + Math.sin(a) * k);
      g.rect(x - 3, y - 3, 7, 7).fill({ color: 0x1a1020 });
    }
    for (let k = -4; k <= 4; k++) {
      const x = Math.round(cx + Math.cos(a) * k);
      const y = Math.round(cy + Math.sin(a) * k);
      g.rect(x - 2, y - 2, 5, 5).fill({ color: glow ? 0xffe14f : k < -1 ? 0xc4c8d0 : 0x9aa0aa });
    }
  };
  // A bow: an arc across the aim (`at` its middle), the string drawn back by `pull`, an arrow on it if drawn.
  const bow = (bx: number, by: number, aim: number, pull: number, nocked: boolean, size = 26) => {
    const nx = -Math.sin(aim);
    const ny = Math.cos(aim) * 0.8;
    const fx2 = Math.cos(aim);
    const fy2 = Math.sin(aim) * 0.7;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10 - 0.5;
      const bend = (1 - 4 * t * t) * 6;
      pts.push([bx + nx * t * size + fx2 * bend * (size / 26), by + ny * t * size + fy2 * bend * (size / 26)]);
    }
    for (const [x, y] of pts) g.rect(Math.round(x) - 2, Math.round(y) - 2, 4, 4).fill({ color: 0x1a1020 });
    for (const [x, y] of pts) g.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2).fill({ color: 0x8f6236 });
    const [ax, ay] = pts[0];
    const [zx, zy] = pts[10];
    const sx = bx - fx2 * (2 + pull * 9);
    const sy = by - fy2 * (2 + pull * 9);
    line(ax, ay, sx, sy, 0xefe6d2, 1);
    line(zx, zy, sx, sy, 0xefe6d2, 1);
    if (nocked) {
      line(sx, sy, bx + fx2 * 7, by + fy2 * 7, 0xb08a52, 1);
      g.rect(Math.round(bx + fx2 * 7) - 1, Math.round(by + fy2 * 7) - 1, 3, 3).fill({ color: 0xd8dce8 });
      g.rect(Math.round(sx) - 1, Math.round(sy) - 1, 2, 2).fill({ color: 0xd94a4a });
    }
  };
  // A bomb (its fuse fizzing if lit).
  const bomb = (bx: number, by: number, r: number, lit: boolean) => {
    g.circle(bx, by, r + 1).fill({ color: 0x1a1020 });
    g.circle(bx, by, r).fill({ color: 0x3b3846 });
    g.rect(Math.round(bx - r / 2), Math.round(by - r / 2), 2, 2).fill({ color: 0x8a8696 });
    if (lit) {
      const sp = Math.floor(now / 60) % 2;
      g.rect(Math.round(bx + r * 0.6), Math.round(by - r - 3), 2, 3).fill({ color: 0x5e3e22 });
      g.rect(Math.round(bx + r * 0.6) - 1 + sp, Math.round(by - r - 6), 3, 3).fill({ color: sp ? 0xffd23f : 0xff6a3f });
    }
  };
  switch (kit) {
    case KIT.SPEARMAN: {
      shield(11, 11, true);
      if (f.act === ACT.CHARGE || charging) {
        // Drawn back, level, to lunge.
        const k = chargeK;
        spear(-face * (24 + 6 * k), -22, face * (14 - 4 * k), -22, k >= 1);
      } else if (f.act === ACT.SPIN) {
        const a = (now / 60) % (Math.PI * 2);
        spear(-Math.cos(a) * 26, -18 - Math.sin(a) * 9, Math.cos(a) * 26, -18 + Math.sin(a) * 9, true);
      } else if (swinging) {
        if (since < windup) spear(-face * 24, -22, face * 12, -22, f.act === ACT.HEAVY);
        else spear(-face * 6, -21, face * (f.act === ACT.HEAVY ? 50 : 40), -19 + (f.act === ACT.LIGHT2 ? 4 : 0));
      } else if (blocking) spear(face * 9, -4, face * 9, -46);
      else if (f.act !== ACT.ROLL) spear(-face * 2, -4, face * 16, -46);
      break;
    }
    case KIT.TANK: {
      shield(14, 19);
      if (f.act === ACT.CHARGE || charging) {
        const k = chargeK;
        hammer(face * 4, -30, -face * (8 + 6 * k), -48 - 2 * k, k >= 1);
      } else if (f.act === ACT.SPIN) {
        const a = (now / 60) % (Math.PI * 2);
        hammer(0, -18, Math.cos(a) * 20, -18 + Math.sin(a) * 9, true);
      } else if (f.act === ACT.CAST) {
        // Up overhead, then down: the earthquake.
        if (since < CAST[0]) hammer(face * 2, -34, face * 2, -54, true);
        else hammer(face * 4, -26, face * 16, -2);
      } else if (swinging) {
        if (since < windup) hammer(face * 4, -28, -face * 8, -46, f.act === ACT.HEAVY);
        else hammer(face * 6, -24, face * (f.act === ACT.HEAVY ? 28 : 22), -6);
      } else if (blocking) hammer(face * 10, -12, face * 12, -30);
      else if (f.act !== ACT.ROLL) hammer(face * 6, -14, -face * 2, -34);
      break;
    }
    case KIT.ARCHER: {
      // The quiver on their back, feathers showing.
      const qx = ox - face * 9;
      g.rect(qx - 3, oy - 34, 6, 13).fill({ color: 0x1a1020 });
      g.rect(qx - 2, oy - 33, 4, 11).fill({ color: 0x6b4a2b });
      g.rect(qx - 2, oy - 37, 1, 3).fill({ color: 0xffffff });
      g.rect(qx + 1, oy - 36, 1, 2).fill({ color: 0xd94a4a });
      const aim = pos.aim;
      const hx = ox + Math.cos(aim) * 11;
      const hy = oy - 22 + Math.sin(aim) * 8;
      if (charging || f.act === ACT.SHOOT) {
        // The bow up, at the aim, drawn back as it charges; loosed.
        const pull = f.act === ACT.SHOOT ? (since < SHOOT[0] ? 1 : 0) : chargeK;
        bow(hx, hy, aim, pull, f.act !== ACT.SHOOT || since < SHOOT[0]);
        if (pull >= 1 && Math.floor(now / 120) % 2) g.circle(hx, hy, 15).stroke({ width: 1, color: 0xffe14f, alpha: 0.8 });
      } else if (f.act === ACT.CAST) {
        // The bow raised high, glowing, for the storm.
        bow(ox, oy - 44, -Math.PI / 2, since < CAST[0] ? since / CAST[0] : 0, since < CAST[0]);
        g.circle(ox, oy - 44, 12 + 4 * Math.sin(now / 50)).stroke({ width: 1.5, color: 0x9fe07a, alpha: 0.8 });
      } else {
        // Slung on their back, and the dagger in hand.
        bow(ox - face * 7, oy - 18, -Math.PI / 2 + face * 0.6, 0, false, 18);
        if (swinging) {
          if (since < windup) dagger(face * 5, -24, -face * 3, -30);
          else dagger(face * 7, -18, face * 18, -18 + (f.act === ACT.LIGHT2 ? 4 : 0));
        } else if (f.act !== ACT.ROLL) dagger(face * 7, -13, face * 12, -20);
      }
      break;
    }
    case KIT.BOMBER: {
      // The bomb belt.
      for (const dx of [-6, 0, 6]) bomb(ox + dx * face - face * 2, oy - 12, 2.5, false);
      if (charging) {
        // A bomb up in hand, its fuse lit, ready to lob.
        const k = chargeK;
        bomb(ox - face * (4 + 4 * k), oy - 38 - 3 * k, 4, true);
        if (k >= 1 && Math.floor(now / 120) % 2) g.circle(ox - face * 8, oy - 41, 9).stroke({ width: 1, color: 0xffe14f, alpha: 0.8 });
      } else if (f.act === ACT.SHOOT) {
        if (since < SHOOT[0]) bomb(ox - face * 8, oy - 40, 4, true);
        dagger(face * 7, -13, face * 12, -20);
      } else if (f.act === ACT.CAST) {
        // The big bang, about to go: they glow, hotter and hotter.
        const k = Math.min(1, since / CAST[0]);
        const p = 0.5 + 0.5 * Math.sin(now / (40 - 25 * k));
        g.circle(ox, oy - 18, 14 + 10 * k).fill({ color: 0xff4f1a, alpha: (0.3 + 0.35 * k) * (0.4 + 0.6 * p) });
        g.circle(ox, oy - 18, 8 + 6 * k).fill({ color: 0xffd23f, alpha: (0.35 + 0.4 * k) * (0.4 + 0.6 * p) });
        // (Sparks flying off it.)
        for (let i = 0; i < 4; i++) {
          const a = now / 90 + i * 1.6;
          g.rect(Math.round(ox + Math.cos(a) * (12 + 6 * k)), Math.round(oy - 18 + Math.sin(a) * (8 + 4 * k)), 2, 2).fill({ color: 0xfff1a8 });
        }
      } else if (swinging) {
        if (since < windup) dagger(face * 5, -24, -face * 3, -30);
        else dagger(face * 7, -18, face * 18, -18 + (f.act === ACT.LIGHT2 ? 4 : 0));
      } else if (f.act !== ACT.ROLL) dagger(face * 7, -13, face * 12, -20);
      break;
    }
    default: {
      // The knight: sword and shield.
      shield(10, 11);
      if (f.act === ACT.CHARGE) {
        const k = chargeK;
        blade(face * 4, -32, -face * (6 + 8 * k), -46 - 4 * k, true);
      } else if (f.act === ACT.SPIN) {
        const a = (now / 60) % (Math.PI * 2);
        blade(0, -18, Math.cos(a) * 22, -18 + Math.sin(a) * 10, true);
      } else if (swinging) {
        if (since < windup) blade(face * 6, -26, -face * 10, -32, f.act === ACT.HEAVY);
        else if (f.act === ACT.HEAVY) blade(face * 8, -24, face * 30, -6);
        else blade(face * 8, -17, face * 26, -17 + (f.act === ACT.LIGHT2 ? 6 : 0));
      } else if (blocking) blade(face * 9, -10, face * 9, -34);
      else if (f.act !== ACT.ROLL) blade(face * 7, -13, face * 15, -23);
    }
  }
}
