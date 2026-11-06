// The little scorpion that steals what's left lying about: a side-on pixel
// rig, its legs and pincers and tail all posed from a few numbers (see
// `ThiefPose`), so that it can creep, snap, tug, bolt and die in the same few
// lines. Drawn facing +x from the sand under it, on a `Graphics` that its show
// turns, tips and flips.

import type { Graphics } from "pixi.js";

const SHELL = 0x8a3c1a;
const SHELL_HI = 0xd0702e;
const DARK = 0x2a120c;
const LEG = 0x5a2412;
const BARB = 0xf2e6c8;
const EYE = 0xffe14f;
const VENOM = 0x8cff4e;

/** Tail joints, curled up over its back, and stretched out behind it (with the hook at the end). */
const CURLED: [number, number][] = [[-8, -7], [-10, -10], [-9, -13], [-6, -15], [-3, -14]];
const TRAILED: [number, number][] = [[-8, -6], [-10, -5], [-12, -5], [-14, -4], [-16, -4]];

export interface ThiefPose {
  /** Its legs' stride. */
  step: number;
  /** 0: tail curled up over its back; 1: stretched out behind, hooked. */
  tail: number;
  /** Its pincers, 0 shut, 1 wide. */
  snap: number;
  /** How far its front end's reared up (px). */
  rear: number;
  /** A tail thrust: how far its joints are flung forward over it (px). */
  lash: number;
}

/** Where the tail's hook is, in the same space as `drawThief`. */
export function hookAt(p: ThiefPose): { x: number; y: number } {
  const [ax, ay] = CURLED[4];
  const [bx, by] = TRAILED[4];
  return { x: ax + (bx - ax) * p.tail + p.lash - 2, y: ay + (by - ay) * p.tail + 2 };
}

/** The whole scorpion, on the sand at (x, y), one way or the other. */
export function drawThief(g: Graphics, x: number, y: number, face: 1 | -1, p: ThiefPose) {
  // (Runs of one colour go down as a single fill.)
  let run = -1;
  const flush = () => {
    if (run >= 0) g.fill({ color: run });
  };
  const px = (rx: number, ry: number, w: number, h: number, c: number) => {
    if (c !== run) {
      flush();
      run = c;
    }
    g.rect(Math.round(face > 0 ? x + rx : x - rx - w), Math.round(y + ry), w, h);
  };
  const legs = (near: boolean) => {
    for (let i = 0; i < 3; i++) {
      const hip = -3 + i * 3 + (near ? 0 : 1);
      const swing = Math.sin(p.step + i * 2.1 + (near ? 0 : Math.PI));
      const foot = hip + swing * 2.5 + (i - 1) * 2;
      const lift = Math.max(0, Math.cos(p.step + i * 2.1 + (near ? 0 : Math.PI))) * 1.5;
      const c = near ? LEG : DARK;
      px(hip, -3, 1, 2, c);
      px(Math.min(hip, foot), -2 - lift, Math.abs(foot - hip) + 1, 1, c);
      px(foot, -2 - lift, 1, 2 + (near ? 0 : 0), c);
    }
  };
  const pincer = (near: boolean, dy: number) => {
    const open = p.snap * 2;
    const c = near ? SHELL : LEG;
    const y0 = -5 - p.rear + dy;
    px(8, y0, 4, 1, c);
    px(12, y0 - 1 - open, 4, 1, near ? SHELL_HI : c);
    px(12, y0 + 1 + open, 3, 1, c);
    px(15, y0 - open, 1, 1, DARK);
    px(14, y0 + open, 1, 1, DARK);
  };
  legs(false);
  pincer(false, -1);
  // The tail, behind all of it when curled, under the rest when trailing.
  const tail = () => {
    let last: [number, number] = [0, 0];
    for (let i = 0; i < 5; i++) {
      const k = p.tail;
      const jx = CURLED[i][0] + (TRAILED[i][0] - CURLED[i][0]) * k + (p.lash * (i + 1)) / 5;
      const jy = CURLED[i][1] + (TRAILED[i][1] - CURLED[i][1]) * k;
      const size = i < 3 ? 3 : 2;
      px(jx - 1, jy - 1, size + 1, size + 1, DARK);
      px(jx, jy, size - 1, size - 1, i % 2 ? SHELL_HI : SHELL);
      last = [jx, jy];
    }
    // The bulb and its barb.
    const [bx, by] = last;
    px(bx - 1, by + 1, 3, 2, VENOM);
    px(bx - 2, by + 2, 2, 2, BARB);
  };
  tail();
  // The body, in three plates, tilted up as it rears.
  for (let i = 0; i < 3; i++) {
    const bx = -7 + i * 5;
    const rise = (p.rear * i) / 2;
    px(bx - 1, -8 - rise, 7, 6, DARK);
    px(bx, -7 - rise, 5, 4, SHELL);
    px(bx, -7 - rise, 5, 1, SHELL_HI);
  }
  // The head, and its eyes: the only bright things on it.
  px(7, -7 - p.rear, 4, 5, DARK);
  px(8, -6 - p.rear, 3, 3, SHELL);
  px(9, -6 - p.rear, 1, 1, EYE);
  px(10, -5 - p.rear, 1, 1, EYE);
  legs(true);
  pincer(true, 0);
  flush();
}
