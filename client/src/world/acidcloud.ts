/**
 * The acid clouds: a small loop of hand-shaded pixel frames, baked once.
 *
 * Each is a bank of soft blobs on a flat, dripping base, lit from above, whose
 * lobes swell and settle from frame to frame so that the cloud boils as it goes.
 * Drawn as sprites, they cost next to nothing, however many are overhead.
 */
import { Texture } from "pixi.js";

/** Frames in the loop, and how long each is held. */
export const CLOUD_FRAMES = 6;
export const CLOUD_FRAME_MS = 170;
/** Size in cloud pixels, each of them `CLOUD_PX` world pixels. */
const W = 84;
const H = 44;
export const CLOUD_PX = 2;
/** Where the underside is, down the frame (0..1): the rain starts here. */
export const CLOUD_BASE = 34 / 44;
export const CLOUD_WIDTH = W * CLOUD_PX;

/** x, y, radius, phase of each lobe. */
const LOBES: [number, number, number, number][] = [
  [17, 26, 9, 0.2],
  [29, 19, 12, 1.5],
  [43, 15, 14, 3.1],
  [57, 20, 12, 4.4],
  [68, 26, 9, 5.5],
  [36, 26, 10, 2.3],
  [51, 27, 10, 0.9],
];
/** From the underside to the crown. */
const TONES = [0x2b3527, 0x3f4c33, 0x586a42, 0x768a54, 0x9db06f, 0xc9d896];
const INK = 0x182012;
/** The sick light of the rain on its underside. */
const GLOW = 0x7fc22e;
const BAYER = [0, 0.5, 0.75, 0.25];

function bake(frame: number): Texture {
  const swell = (frame / CLOUD_FRAMES) * Math.PI * 2;
  const blobs = LOBES.map(([x, y, r, p]) => ({
    x: x + Math.cos(swell + p) * 0.8,
    y: y + Math.sin(swell * 2 + p) * 0.5,
    r: r * (1 + 0.075 * Math.sin(swell + p * 2)),
  }));
  const base = (x: number) => 34 + Math.sin(x * 0.55 + swell) * 0.8 + Math.sin(x * 0.21 - swell) * 0.8;
  /** Which lobe's nearest the eye here, if any. */
  const at = (x: number, y: number) => {
    if (y > base(x)) return null;
    let best = null;
    let top = 0;
    for (const b of blobs) {
      const [nx, ny] = [(x - b.x) / b.r, (y - b.y) / b.r];
      const h = 1 - nx * nx - ny * ny;
      if (h > top) [best, top] = [{ nx, ny }, h];
    }
    return best;
  };
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(W, H);
  const put = (x: number, y: number, col: number) => {
    const i = (y * W + x) * 4;
    img.data.set([col >> 16, (col >> 8) & 255, col & 255, 255], i);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = at(x, y);
      if (!p) {
        // A line of ink around it.
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) put(x, y, INK);
        continue;
      }
      // Lit from above and a little to the left, and darker the lower it is.
      const lit = -(p.nx * 0.35 + p.ny * 0.8);
      const high = 1 - y / base(x);
      const k = 0.08 + 0.42 * lit + 0.52 * high + (BAYER[(x & 1) + (y & 1) * 2] - 0.4) * 0.16;
      put(x, y, TONES[Math.max(0, Math.min(TONES.length - 1, Math.floor(k * TONES.length)))]);
      if (base(x) - y < 1.6 && (x + frame) % 3 !== 0) put(x, y, GLOW);
    }
  }
  c.putImageData(img, 0, 0);
  const t = Texture.from(cv);
  t.source.scaleMode = "nearest";
  return t;
}

let frames: Texture[] | null = null;

/** The loop (baked the first time it's wanted). */
export function cloudFrames(): Texture[] {
  frames ??= Array.from({ length: CLOUD_FRAMES }, (_, i) => bake(i));
  return frames;
}
