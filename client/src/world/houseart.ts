// The houses in the home blocks, drawn with care: a hipped roof of shingle
// rows (lit on one side, shaded on the other) with a trim board along the
// eaves and a brick chimney; clapboard walls with corner boards on a stone
// foundation; four-pane windows with sills (some with shutters, some with
// flower boxes); a panelled front door under a little porch roof, a step, a
// lamp and the house number; shrubs either side. Each house picks its
// details from its place, so a street is never all alike; paint (ADR 0011,
// M7) changes the walls and roof.

import type { MapObject } from "./map";
import { disc, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

const O = "#3b3a2e";
/** How far the roof and chimney reach above the footprint. */
export const HOUSE_OVERHANG = 56;

const WALLS = ["#f1e4cc", "#e8d6c4", "#dfe6e8", "#efe2b8", "#e2dbec", "#f2d6cf"];
const ROOFS = ["#b5544a", "#4f6d8a", "#5d8a4e", "#8a5d8a", "#c27a3c", "#7a6a5a"];
const DOORS = ["#7a3b2e", "#2f5a3c", "#3f5f7a", "#8a6d2e", "#5c2a3e"];

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** The same small hash everywhere: details follow the house's place. */
function mix(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** `hex` lightened (amt > 0) or darkened (amt < 0) by amt (−1…1). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function window4(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, trim: string, shutters: string | null, box: string[] | null) {
  if (shutters) {
    for (const sx of [x - 9, x + w + 1]) {
      px(ctx, O, sx, y - 1, 8, h + 2);
      px(ctx, shutters, sx + 1, y, 6, h);
      for (let ly = y + 3; ly < y + h - 2; ly += 4) px(ctx, shade(shutters, -0.25), sx + 2, ly, 4, 1);
    }
  }
  px(ctx, O, x - 1, y - 1, w + 2, h + 2);
  px(ctx, trim, x, y, w, h);
  px(ctx, "#8fb8cf", x + 2, y + 2, w - 4, h - 4);
  // A reflection across the glass, and the curtains' edge.
  px(ctx, "#b9d8e6", x + 3, y + 3, 4, 2);
  px(ctx, "#b9d8e6", x + 3, y + 5, 2, 2);
  px(ctx, "rgba(255,248,227,0.55)", x + 2, y + 2, 3, h - 4);
  px(ctx, trim, x + w / 2 - 1, y + 2, 2, h - 4);
  px(ctx, trim, x + 2, y + h / 2 - 1, w - 4, 2);
  // The sill.
  px(ctx, O, x - 3, y + h, w + 6, 4);
  px(ctx, shade(trim, -0.08), x - 2, y + h + 1, w + 4, 2);
  if (box) {
    px(ctx, O, x - 1, y + h + 4, w + 2, 6);
    px(ctx, "#8a5a33", x, y + h + 5, w, 4);
    for (let i = 0; i < w; i += 4) {
      px(ctx, "#4f7a3e", x + i, y + h + 1, 3, 4);
      px(ctx, box[(i / 4) % box.length], x + i + 1, y + h, 2, 2);
    }
  }
}

function shrub(ctx: CanvasRenderingContext2D, x: number, y: number, flowers: string) {
  disc(ctx, O, x, y, 9);
  disc(ctx, "#4f7a3e", x, y, 8);
  disc(ctx, "#6a9a4a", x - 2, y - 2, 5);
  px(ctx, flowers, x - 4, y - 3, 2, 2);
  px(ctx, flowers, x + 3, y - 1, 2, 2);
  px(ctx, flowers, x, y + 3, 2, 2);
}

/** A house's art, `w`×`h` its footprint in px; drawn from HOUSE_OVERHANG above it. */
export function drawHouse(ctx: CanvasRenderingContext2D, o: MapObject, w: number, h: number, painted?: [string, string]) {
  // Each detail from its own hash of the place: neighbours share none.
  const pick = (n: number, salt: number) => mix(o.x, o.y, 73 + salt * 101) % n;
  const walls = painted?.[0] ?? WALLS[pick(WALLS.length, 1)];
  const roof = painted?.[1] ?? ROOFS[pick(ROOFS.length, 2)];
  const door = DOORS[pick(DOORS.length, 3)];
  const trim = "#f7f1e3";
  const shutters = pick(2, 4) ? shade(roof, -0.15) : null;
  const flowers = ["#e8566b", "#f6c343", "#ffffff", "#c9a7f4"];
  const boxes = pick(2, 5) ? [flowers[pick(4, 6)], flowers[pick(4, 7)], "#ffffff"] : null;
  const dormer = pick(3, 8) !== 0;
  const chimneyLeft = pick(2, 9) !== 0;
  const look = mix(o.x, o.y, 1373);
  const H = h + HOUSE_OVERHANG;
  const eave = HOUSE_OVERHANG + 70; // where the roof meets the wall
  const foot = H - 12; // top of the foundation

  // The house's shadow on the grass.
  px(ctx, "rgba(0,0,0,0.16)", 10, H - 6, w - 14, 6);

  // ---- walls -----------------------------------------------------------------
  px(ctx, O, 12, eave - 8, w - 24, foot - eave + 10);
  px(ctx, walls, 14, eave - 6, w - 28, foot - eave + 6);
  // Clapboard: a light edge over a shadow line, every 6 px.
  for (let y = eave; y < foot - 2; y += 6) {
    px(ctx, "rgba(0,0,0,0.07)", 14, y, w - 28, 1);
    px(ctx, "rgba(255,255,255,0.18)", 14, y + 1, w - 28, 1);
  }
  // Corner boards and the stone foundation.
  for (const x of [14, w - 22]) {
    px(ctx, trim, x, eave - 6, 8, foot - eave + 6);
    px(ctx, "rgba(0,0,0,0.08)", x + 6, eave - 6, 2, foot - eave + 6);
  }
  px(ctx, O, 10, foot, w - 20, 10);
  px(ctx, "#b9b2a0", 11, foot + 1, w - 22, 8);
  for (let x = 14; x < w - 14; x += 14) px(ctx, "#a29a86", x + ((x / 14) % 2) * 6, foot + 1, 1, 8);
  px(ctx, "#a29a86", 11, foot + 5, w - 22, 1);

  // ---- windows and the door ---------------------------------------------------
  const wy = eave + 14;
  const ww = 30;
  const wh = 30;
  for (const x of [40, 92, w - 92 - ww, w - 40 - ww]) window4(ctx, x, wy, ww, wh, trim, shutters, boxes);
  // The porch roof over the door, on two brackets.
  const dx = w / 2;
  const dw = 30;
  const dTop = foot - 52;
  polygon(ctx, O, [
    [dx - 30, dTop - 4],
    [dx, dTop - 22],
    [dx + 30, dTop - 4],
  ]);
  polygon(ctx, roof, [
    [dx - 26, dTop - 5],
    [dx, dTop - 19],
    [dx + 26, dTop - 5],
  ]);
  px(ctx, O, dx - 31, dTop - 5, 62, 4);
  px(ctx, trim, dx - 30, dTop - 4, 60, 2);
  for (const bx of [dx - 26, dx + 23]) px(ctx, O, bx, dTop - 2, 3, 8);
  // Frame, door, panels, a little window, the knob.
  px(ctx, O, dx - dw / 2 - 4, dTop, dw + 8, foot - dTop + 1);
  px(ctx, trim, dx - dw / 2 - 3, dTop + 1, dw + 6, foot - dTop);
  px(ctx, O, dx - dw / 2, dTop + 4, dw, foot - dTop - 3);
  px(ctx, door, dx - dw / 2 + 1, dTop + 5, dw - 2, foot - dTop - 5);
  px(ctx, "#f6d98a", dx - 8, dTop + 9, 16, 8);
  px(ctx, O, dx - 1, dTop + 9, 2, 8);
  for (const py of [dTop + 22, dTop + 36]) {
    px(ctx, shade(door, -0.22), dx - 10, py, 8, 10);
    px(ctx, shade(door, -0.22), dx + 2, py, 8, 10);
  }
  disc(ctx, "#f6c343", dx + 9, dTop + 30, 2);
  // The lamp by the door, and the house number.
  px(ctx, O, dx - 32, dTop + 6, 8, 12);
  px(ctx, "#ffe9a8", dx - 31, dTop + 7, 6, 9);
  px(ctx, "rgba(255,233,168,0.22)", dx - 38, dTop + 2, 20, 22);
  const no = String(((o.label ?? "").split(":").pop() ?? "0").replace(/\D/g, "") || "1");
  const n = String(Number(no) + 1);
  px(ctx, O, dx + 22, dTop + 6, 14, 11);
  px(ctx, "#fff8e3", dx + 23, dTop + 7, 12, 9);
  if (canPixel(n)) drawPixelText(ctx, n, Math.round(dx + 29 - pixelWidth(n, 1) / 2), dTop + 9, O, 1);
  // The step.
  px(ctx, O, dx - dw / 2 - 8, foot + 2, dw + 16, 8);
  px(ctx, "#cfc5b1", dx - dw / 2 - 7, foot + 3, dw + 14, 6);
  // Shrubs at the corners.
  shrub(ctx, 30, foot + 2, flowers[(look >>> 16) % 4]);
  shrub(ctx, w - 30, foot + 2, flowers[(look >>> 18) % 4]);

  // ---- the roof -------------------------------------------------------------------
  const ridgeY = 18;
  const l = 4;
  const r = w - 4;
  const rl = 64;
  const rr = w - 64;
  // The outline, then the front slope and the two hips (lit and shaded).
  polygon(ctx, O, [
    [l - 2, eave + 2],
    [rl - 2, ridgeY - 2],
    [rr + 2, ridgeY - 2],
    [r + 2, eave + 2],
  ]);
  polygon(ctx, roof, [
    [l + 2, eave - 1],
    [rl, ridgeY],
    [rr, ridgeY],
    [r - 2, eave - 1],
  ]);
  polygon(ctx, shade(roof, 0.14), [
    [l + 2, eave - 1],
    [rl, ridgeY],
    [rl + 14, eave - 1],
  ]);
  polygon(ctx, shade(roof, -0.16), [
    [r - 2, eave - 1],
    [rr, ridgeY],
    [rr - 14, eave - 1],
  ]);
  // Shingle rows: each row's tabs offset half a tab from the one above.
  for (let y = ridgeY + 8, row = 0; y < eave - 4; y += 8, row++) {
    const t = (y - ridgeY) / (eave - ridgeY);
    const x0 = rl - (rl - l) * t + 4;
    const x1 = rr + (r - rr) * t - 4;
    px(ctx, shade(roof, -0.2), x0, y, x1 - x0, 1);
    for (let x = x0 + (row % 2) * 6; x < x1; x += 12) px(ctx, shade(roof, -0.12), x, y + 1, 1, 6);
  }
  // The ridge cap, and the trim board along the eaves with its shadow.
  px(ctx, shade(roof, -0.3), rl, ridgeY, rr - rl, 3);
  px(ctx, O, l - 2, eave - 1, r - l + 4, 6);
  px(ctx, trim, l, eave, r - l, 3);
  px(ctx, "rgba(0,0,0,0.22)", 14, eave + 5, w - 28, 5);
  // A dormer on some: a little gabled window in the roof.
  if (dormer) {
    const cx = chimneyLeft ? w - 120 : 120;
    const dy = 46;
    px(ctx, O, cx - 17, dy, 34, 28);
    px(ctx, walls, cx - 15, dy + 2, 30, 26);
    polygon(ctx, O, [
      [cx - 22, dy + 2],
      [cx, dy - 14],
      [cx + 22, dy + 2],
    ]);
    polygon(ctx, roof, [
      [cx - 18, dy + 1],
      [cx, dy - 11],
      [cx + 18, dy + 1],
    ]);
    window4(ctx, cx - 9, dy + 6, 18, 16, trim, null, null);
  }
  // The chimney: brick courses, a cap, a wisp of smoke.
  const chx = chimneyLeft ? 96 : w - 116;
  px(ctx, O, chx, 0, 22, 40);
  px(ctx, "#a0675a", chx + 2, 6, 18, 33);
  for (let y = 10; y < 38; y += 5) {
    px(ctx, "#8a5248", chx + 2, y, 18, 1);
    for (let x = chx + 2 + ((y / 5) % 2) * 4; x < chx + 20; x += 8) px(ctx, "#8a5248", x, y - 4, 1, 4);
  }
  px(ctx, O, chx - 2, 0, 26, 7);
  px(ctx, "#5f5a52", chx - 1, 1, 24, 5);
}
