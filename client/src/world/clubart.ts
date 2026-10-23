// The Club Hall's art (ADR 0014): the building in the city, a red-brick
// clubhouse strung with pennants in club colours; inside, the front desk,
// the directory board of crests, the stairs up to the club rooms, and in a
// club room its banner (the club's crest on its colour) and board.

import type { MapObject } from "./map";
import { disc, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

const TILE = 32;
const O = "#3b3a2e";
const P_WOOD = "#8a5a33";
const PENNANTS = ["#c8553d", "#3f7a8a", "#e0a43a", "#6a9a4a", "#7d5ba6", "#d0679a", "#4a6fb0", "#2f8f6f"];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function text(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string, maxW: number, scale = 1) {
  if (!canPixel(s)) return;
  while (scale > 1 && pixelWidth(s, scale) > maxW) scale--;
  if (pixelWidth(s, scale) > maxW) return;
  drawPixelText(ctx, s, Math.round(cx - pixelWidth(s, scale) / 2), Math.round(cy - (5 * scale) / 2), color, scale);
}

/** An emoji crest (canvas text: emoji aren't in the pixel font). */
function crest(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, size: number) {
  ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, cx, cy);
}

/** A string of little triangle flags between two points. */
function pennants(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, sag: number) {
  const n = Math.floor((x1 - x0) / 14);
  const at = (t: number) => y + Math.round(Math.sin(t * Math.PI) * sag);
  for (let x = x0; x <= x1; x++) px(ctx, O, x, at((x - x0) / (x1 - x0)), 1, 1);
  for (let i = 0; i < n; i++) {
    const fx = x0 + 6 + i * 14;
    const fy = at((fx - x0) / (x1 - x0)) + 1;
    polygon(ctx, O, [
      [fx - 5, fy],
      [fx + 5, fy],
      [fx, fy + 10],
    ]);
    polygon(ctx, PENNANTS[i % PENNANTS.length], [
      [fx - 4, fy + 1],
      [fx + 4, fy + 1],
      [fx, fy + 8],
    ]);
  }
}

/** A club object's art: drawn from `overhang` px above its footprint. */
export function clubObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "club_hall": {
      // Two storeys of red brick under a slate roof, white-framed windows
      // lit warm, a green awning over wide doors, pennants along the front.
      const top = 72;
      const [c, ctx] = canvas(w, h + top);
      const ft = top + h;
      const brick = "#b5544a";
      const mortar = "#94443b";
      px(ctx, "rgba(0,0,0,0.18)", 10, ft - 8, w - 20, 8);
      // Roof.
      polygon(ctx, O, [
        [8, 46],
        [40, 4],
        [w - 40, 4],
        [w - 8, 46],
      ]);
      polygon(ctx, "#4f5a68", [
        [12, 44],
        [42, 7],
        [w - 42, 7],
        [w - 12, 44],
      ]);
      for (let y = 14; y < 44; y += 6) px(ctx, "#5f6b7a", 20, y, w - 40, 1);
      // Chimneys.
      for (const x of [70, w - 90]) {
        px(ctx, O, x, 0, 20, 22);
        px(ctx, brick, x + 2, 2, 16, 18);
      }
      // The brick front.
      px(ctx, O, 14, 44, w - 28, ft - 44 - 6);
      px(ctx, brick, 16, 46, w - 32, ft - 48 - 6);
      for (let y = 50; y < ft - 10; y += 6) {
        px(ctx, mortar, 16, y, w - 32, 1);
        for (let x = 16 + ((y / 6) % 2) * 8; x < w - 16; x += 16) px(ctx, mortar, x, y - 5, 1, 5);
      }
      // Windows, two rows, warm light and a curtain edge.
      const win = (x: number, y: number) => {
        px(ctx, O, x - 2, y - 2, 32, 40);
        px(ctx, "#fff8e3", x - 1, y - 1, 30, 38);
        px(ctx, "#f6d98a", x + 2, y + 2, 24, 32);
        px(ctx, "#e6b85c", x + 2, y + 2, 5, 32);
        px(ctx, "#fff8e3", x + 13, y + 2, 2, 32);
        px(ctx, "#fff8e3", x + 2, y + 17, 24, 2);
      };
      const cols = [40, 110, w - 140, w - 70];
      for (const x of cols) win(x, 60);
      for (const x of cols) win(x, top + h - 150);
      // The sign.
      px(ctx, O, w / 2 - 90, 54, 180, 26);
      px(ctx, "#2f5a3c", w / 2 - 88, 56, 176, 22);
      text(ctx, "CLUB HALL", w / 2, 67, "#f2dc98", 170, 2);
      pennants(ctx, 18, w / 2 - 96, 50, 10);
      pennants(ctx, w / 2 + 96, w - 18, 50, 10);
      // Awning and doors.
      const dw = 76;
      const dTop = ft - 92;
      px(ctx, O, w / 2 - dw / 2 - 2, dTop - 2, dw + 4, ft - dTop - 4);
      px(ctx, "#5a3a22", w / 2 - dw / 2, dTop, dw, ft - dTop - 6);
      px(ctx, "#4e3420", w / 2 - 1, dTop, 2, ft - dTop - 6);
      px(ctx, "#f6d98a", w / 2 - dw / 2 + 6, dTop + 8, dw / 2 - 12, 22);
      px(ctx, "#f6d98a", w / 2 + 6, dTop + 8, dw / 2 - 12, 22);
      px(ctx, "#d8b45a", w / 2 - 6, dTop + 44, 2, 6);
      px(ctx, "#d8b45a", w / 2 + 4, dTop + 44, 2, 6);
      const aw = dw + 40;
      px(ctx, O, w / 2 - aw / 2, dTop - 20, aw, 16);
      for (let i = 0; i < aw - 2; i += 10) px(ctx, (i / 10) % 2 ? "#e9e1c8" : "#4a7240", w / 2 - aw / 2 + 1 + i, dTop - 19, 10, 12);
      for (let i = 0; i < aw; i += 10) disc(ctx, (i / 10) % 2 ? "#e9e1c8" : "#4a7240", w / 2 - aw / 2 + 5 + i, dTop - 6, 4);
      // Steps and two lamps.
      px(ctx, O, w / 2 - dw / 2 - 10, ft - 8, dw + 20, 8);
      px(ctx, "#cfc5b1", w / 2 - dw / 2 - 9, ft - 7, dw + 18, 6);
      for (const x of [w / 2 - dw / 2 - 24, w / 2 + dw / 2 + 18]) {
        px(ctx, O, x + 2, dTop + 10, 3, ft - dTop - 16);
        px(ctx, O, x - 2, dTop, 11, 12);
        px(ctx, "#ffe9a8", x - 1, dTop + 1, 9, 10);
      }
      return { c, overhang: top };
    }
    case "club_desk": {
      // A long oak desk with a green top, a guest book, a bell and a
      // little stand of crests.
      const [c, ctx] = canvas(w, h + 22);
      px(ctx, "rgba(0,0,0,0.2)", 4, c.height - 6, w - 8, 6);
      px(ctx, O, 0, 8, w, c.height - 10);
      px(ctx, "#6e4b30", 1, 14, w - 2, c.height - 17);
      for (let x = 8; x < w - 24; x += 30) {
        px(ctx, "#5a3a22", x, 18, 22, c.height - 26);
        px(ctx, "#7d5232", x + 1, 19, 20, c.height - 28);
      }
      px(ctx, "#8a5a33", 0, 8, w, 6);
      px(ctx, "#2f5a3c", 2, 9, w - 4, 3);
      // The guest book, open.
      px(ctx, O, w / 2 - 40, 0, 28, 10);
      px(ctx, "#fff8e3", w / 2 - 39, 1, 12, 8);
      px(ctx, "#fff8e3", w / 2 - 26, 1, 13, 8);
      for (let y = 3; y < 9; y += 2) px(ctx, "#b9b2a0", w / 2 - 37, y, 8, 1);
      // The bell.
      disc(ctx, O, w / 2 + 10, 5, 4);
      disc(ctx, "#d8b45a", w / 2 + 10, 5, 3);
      // Little pennants in a cup.
      px(ctx, O, w - 50, 2, 10, 8);
      for (let i = 0; i < 4; i++) {
        px(ctx, O, w - 48 + i * 2, -6 + i, 1, 8);
        px(ctx, PENNANTS[i], w - 47 + i * 2, -6 + i, 4, 3);
      }
      return { c, overhang: 22 };
    }
    case "club_directory": {
      // A green baize board on the wall: rows of crests in club colours.
      const [c, ctx] = canvas(w, h + 40);
      px(ctx, O, 2, 0, w - 4, c.height - 4);
      px(ctx, "#8a5a33", 3, 1, w - 6, c.height - 6);
      px(ctx, "#2f5a3c", 7, 12, w - 14, c.height - 20);
      px(ctx, O, w / 2 - 50, 2, 100, 10);
      px(ctx, "#d8b45a", w / 2 - 49, 3, 98, 8);
      text(ctx, "CLUBS", w / 2, 7, "#3b2a12", 90);
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k * 22 + 12 < w - 14; k++) {
          const x = 12 + k * 22;
          const y = 16 + r * 16;
          px(ctx, O, x, y, 14, 12);
          px(ctx, PENNANTS[(r * 5 + k * 3) % PENNANTS.length], x + 1, y + 1, 12, 10);
          px(ctx, "#fff8e3", x + 5, y + 3, 4, 4);
        }
      }
      return { c, overhang: 40 };
    }
    case "club_stairs": {
      // A wide stair going up through an arch, a brass rail, a runner.
      const [c, ctx] = canvas(w, h + 56);
      px(ctx, O, 4, 4, w - 8, c.height - 4);
      disc(ctx, O, w / 2, 24, w / 2 - 4);
      px(ctx, "#cfc5b1", 6, 6, w - 12, c.height - 6);
      disc(ctx, "#cfc5b1", w / 2, 24, w / 2 - 6);
      px(ctx, "#2e1d12", 12, 26, w - 24, c.height - 26);
      disc(ctx, "#2e1d12", w / 2, 28, w / 2 - 12);
      const steps = 7;
      for (let s = 0; s < steps; s++) {
        const y = c.height - 6 - s * 8;
        const inset = 12 + s * 2;
        px(ctx, "#7d5232", inset, y - 6, w - inset * 2, 6);
        px(ctx, "#5a3a22", inset, y, w - inset * 2, 2);
        px(ctx, "#8f3a2b", w / 2 - 14 + s, y - 6, 28 - s * 2, 6);
      }
      px(ctx, "#d8b45a", 14, 30, 2, c.height - 34);
      px(ctx, "#d8b45a", w - 16, 30, 2, c.height - 34);
      px(ctx, "rgba(255,236,170,0.15)", 12, 26, w - 24, c.height - 26);
      px(ctx, O, w / 2 - 34, 0, 68, 11);
      px(ctx, "#d8b45a", w / 2 - 33, 1, 66, 9);
      text(ctx, "ROOMS", w / 2, 6, "#3b2a12", 60);
      return { c, overhang: 56 };
    }
    case "clubhall_exit":
    case "clubroom_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 0, 0, w, h + 16);
      px(ctx, o.kind === "clubhall_exit" ? "#cfe8b8" : "#e8e1d2", 3, 3, w - 6, h + 10);
      px(ctx, "#2f5a3c", 6, h + 4, w - 12, 10);
      text(ctx, o.kind === "clubhall_exit" ? "EXIT" : "DOWN", w / 2, h / 2 + 6, O, w - 8);
      return { c, overhang: 16 };
    }
    case "club_banner": {
      // A long banner on a brass rod: the club's colour, its crest, a
      // fringe and its name.
      const color = o.color ?? "#3f7a8a";
      const [c, ctx] = canvas(w, h + 64);
      px(ctx, O, 0, 0, w, 5);
      px(ctx, "#d8b45a", 1, 1, w - 2, 3);
      const bx = 14;
      const bw = w - 28;
      const bh = c.height - 14;
      polygon(ctx, O, [
        [bx - 1, 4],
        [bx + bw + 1, 4],
        [bx + bw + 1, bh],
        [bx + bw / 2, bh + 10],
        [bx - 1, bh],
      ]);
      polygon(ctx, color, [
        [bx + 1, 5],
        [bx + bw - 1, 5],
        [bx + bw - 1, bh - 1],
        [bx + bw / 2, bh + 8],
        [bx + 1, bh - 1],
      ]);
      px(ctx, "rgba(255,255,255,0.18)", bx + 3, 6, 3, bh - 10);
      px(ctx, "#f2dc98", bx + 4, 10, bw - 8, 1);
      if (o.sign) {
        disc(ctx, "#fff8e3", w / 2, 38, 19);
        disc(ctx, color, w / 2, 38, 17);
        crest(ctx, o.sign, w / 2, 39, 24);
      }
      if (o.label) text(ctx, o.label.toUpperCase(), w / 2, 66, "#fff8e3", bw - 6);
      return { c, overhang: 64 };
    }
    case "club_house": {
      // A club lot (C3). Rented: the club's house, timber walls under a roof
      // in the club's colour, its crest on a banner over the door and its
      // name on a board. Free: a building site with a FOR RENT sign.
      const top = 70;
      const [c, ctx] = canvas(w, h + top);
      const ft = top + h;
      if (!o.club) {
        // Dug earth inside stakes and string, planks, and the sign.
        px(ctx, "#8a6a45", 24, top + 40, w - 48, h - 56);
        px(ctx, "#a07a50", 28, top + 44, w - 56, h - 64);
        for (let x = 24; x <= w - 24; x += 48) {
          px(ctx, O, x - 2, top + 30, 4, 20);
          px(ctx, "#c9a46a", x - 1, top + 31, 2, 18);
        }
        px(ctx, "#f2ead8", 24, top + 34, w - 48, 1);
        for (let i = 0; i < 4; i++) {
          px(ctx, O, 60, ft - 40 - i * 7, 90, 6);
          px(ctx, "#c99a62", 61, ft - 39 - i * 7, 88, 4);
        }
        px(ctx, O, w / 2 - 3, top + 6, 6, 60);
        px(ctx, P_WOOD, w / 2 - 2, top + 7, 4, 58);
        px(ctx, O, w / 2 - 70, top - 30, 140, 40);
        px(ctx, "#fff8e3", w / 2 - 68, top - 28, 136, 36);
        text(ctx, "FOR RENT", w / 2, top - 18, "#8f3a2b", 130, 2);
        text(ctx, "CLUB LOT", w / 2, top - 2, O, 130);
        return { c, overhang: top };
      }
      const color = o.color ?? "#3f7a8a";
      px(ctx, "rgba(0,0,0,0.18)", 14, ft - 8, w - 28, 8);
      // Roof in the club's colour, with a darker ridge.
      polygon(ctx, O, [
        [6, 60],
        [40, 10],
        [w - 40, 10],
        [w - 6, 60],
      ]);
      polygon(ctx, color, [
        [11, 58],
        [42, 13],
        [w - 42, 13],
        [w - 11, 58],
      ]);
      for (let y = 22; y < 58; y += 8) px(ctx, "rgba(0,0,0,0.12)", 24, y, w - 48, 2);
      // Timber walls.
      px(ctx, O, 18, 58, w - 36, ft - 58 - 6);
      px(ctx, "#c99a62", 20, 60, w - 40, ft - 62 - 6);
      for (let x = 28; x < w - 20; x += 12) px(ctx, "#b08550", x, 60, 1, ft - 66);
      // Windows, warm.
      for (const x of [44, 120, w - 160, w - 84]) {
        px(ctx, O, x - 2, 88, 40, 36);
        px(ctx, "#f6d98a", x, 90, 36, 32);
        px(ctx, O, x + 17, 90, 2, 32);
        px(ctx, O, x, 105, 36, 2);
      }
      // The door and the banner over it.
      const dw = 64;
      const dTop = ft - 84;
      px(ctx, O, w / 2 - dw / 2 - 2, dTop - 2, dw + 4, ft - dTop - 4);
      px(ctx, "#6e4b30", w / 2 - dw / 2, dTop, dw, ft - dTop - 6);
      px(ctx, "#5a3a22", w / 2 - 1, dTop, 2, ft - dTop - 6);
      px(ctx, "#f6d98a", w / 2 - dw / 2 + 6, dTop + 8, dw / 2 - 12, 18);
      px(ctx, "#f6d98a", w / 2 + 6, dTop + 8, dw / 2 - 12, 18);
      const bw = 52;
      polygon(ctx, O, [
        [w / 2 - bw / 2 - 1, 58],
        [w / 2 + bw / 2 + 1, 58],
        [w / 2 + bw / 2 + 1, dTop - 10],
        [w / 2, dTop + 2],
        [w / 2 - bw / 2 - 1, dTop - 10],
      ]);
      polygon(ctx, color, [
        [w / 2 - bw / 2 + 1, 59],
        [w / 2 + bw / 2 - 1, 59],
        [w / 2 + bw / 2 - 1, dTop - 11],
        [w / 2, dTop],
        [w / 2 - bw / 2 + 1, dTop - 11],
      ]);
      if (o.sign) {
        disc(ctx, "#fff8e3", w / 2, 80, 15);
        disc(ctx, color, w / 2, 80, 13);
        crest(ctx, o.sign, w / 2, 81, 18);
      }
      // The name board under the roof.
      if (o.title) {
        px(ctx, O, w / 2 - 120, 30, 240, 20);
        px(ctx, "#fff8e3", w / 2 - 118, 32, 236, 16);
        text(ctx, o.title.toUpperCase(), w / 2, 40, "#3b3a2e", 228, 2);
      }
      // Steps and lamps.
      px(ctx, O, w / 2 - dw / 2 - 10, ft - 8, dw + 20, 8);
      px(ctx, "#cfc5b1", w / 2 - dw / 2 - 9, ft - 7, dw + 18, 6);
      for (const x of [w / 2 - dw / 2 - 22, w / 2 + dw / 2 + 16]) {
        px(ctx, O, x + 2, dTop + 10, 3, ft - dTop - 16);
        px(ctx, O, x - 2, dTop, 11, 12);
        px(ctx, "#ffe9a8", x - 1, dTop + 1, 9, 10);
      }
      return { c, overhang: top };
    }
    case "club_leaderboard": {
      // A gilt board: three podium steps and a cup over them.
      const [c, ctx] = canvas(w, h + 40);
      px(ctx, O, 2, 0, w - 4, c.height - 4);
      px(ctx, "#2f3d5a", 3, 1, w - 6, c.height - 6);
      px(ctx, O, w / 2 - 40, 2, 80, 10);
      px(ctx, "#d8b45a", w / 2 - 39, 3, 78, 8);
      text(ctx, "THIS WEEK", w / 2, 7, "#3b2a12", 74);
      const steps: [number, number, string][] = [[w / 2 - 30, 22, "#c9c9c9"], [w / 2 - 10, 16, "#e9b949"], [w / 2 + 10, 28, "#c8813d"]];
      for (const [x, y, col] of steps) {
        px(ctx, O, x, y + 8, 20, c.height - y - 14);
        px(ctx, col, x + 1, y + 9, 18, c.height - y - 16);
      }
      disc(ctx, O, w / 2, 18, 6);
      disc(ctx, "#e9b949", w / 2, 18, 5);
      px(ctx, "#e9b949", w / 2 - 2, 22, 4, 4);
      return { c, overhang: 40 };
    }
    case "club_events": {
      // A poster board: WHAT'S ON, and posters in club colours.
      const [c, ctx] = canvas(w, h + 40);
      px(ctx, O, 2, 0, w - 4, c.height - 4);
      px(ctx, "#8a5a33", 3, 1, w - 6, c.height - 6);
      px(ctx, "#f2ead8", 6, 12, w - 12, c.height - 20);
      px(ctx, O, 6, 2, w - 12, 10);
      px(ctx, "#c8553d", 7, 3, w - 14, 8);
      text(ctx, "WHAT'S ON", w / 2, 7, "#fff8e3", w - 16);
      for (let i = 0; i < 3; i++) {
        const x = 10 + i * ((w - 20) / 3);
        px(ctx, O, x, 16, 22, 26);
        px(ctx, PENNANTS[(i * 3 + 1) % PENNANTS.length], x + 1, 17, 20, 24);
        px(ctx, "#fff8e3", x + 4, 21, 14, 2);
        px(ctx, "#fff8e3", x + 4, 25, 10, 2);
        disc(ctx, "#c8553d", x + 11, 17, 2);
      }
      return { c, overhang: 40 };
    }
    case "club_board": {
      // A cork board with pinned notes.
      const [c, ctx] = canvas(w, h + 44);
      px(ctx, O, 2, 0, w - 4, c.height - 6);
      px(ctx, "#8a5a33", 3, 1, w - 6, c.height - 8);
      px(ctx, "#c99a62", 7, 5, w - 14, c.height - 16);
      const notes = [
        [12, 10, "#fff8e3"],
        [38, 8, "#f6e08a"],
        [64, 12, "#cfe8f0"],
        [20, 34, "#f4c7d4"],
        [50, 36, "#fff8e3"],
      ] as const;
      for (const [x, y, col] of notes) {
        if (x + 20 > w - 8) continue;
        px(ctx, O, x - 1, y - 1, 22, 20);
        px(ctx, col, x, y, 20, 18);
        for (let l = y + 5; l < y + 16; l += 3) px(ctx, "#b9b2a0", x + 3, l, 14, 1);
        disc(ctx, "#c8553d", x + 10, y + 1, 2);
      }
      return { c, overhang: 44 };
    }
  }
  return null;
}
