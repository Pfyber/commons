// The Library's art (ADR 0012): the building on its block, the hall's
// marble and the wings' parquet, panelled walls with tall windows, reading
// tables with green lamps, and bookcases with every book a spine. A spine's
// colour, height and gold bands come from a hash of where it stands, so the
// shelf panel (ui/library.ts) draws the same books as the world.

import { hash } from "./art";
import type { MapObject } from "./map";
import { disc, oval } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

const TILE = 32;
const O = "#3b3a2e";

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

// ---- spines -------------------------------------------------------------------

/** Cloth and leather bindings; the Children's Library's are brighter. */
const BINDINGS = ["#7a2e2e", "#2f5a3c", "#2c3e66", "#6b4a2b", "#8c6d2e", "#5c2a3e", "#2f5f5f", "#d8c9a3", "#2b2723", "#8a3f22", "#4a5a2a", "#3d2f5a"];
const BRIGHT = ["#e0574f", "#f2b33d", "#4fa3d9", "#6cc070", "#b46cd0", "#f08a3c", "#e86fa0", "#48c0b0", "#f4d35e", "#5b7be0"];
const WING_SALT: Record<string, number> = { children: 1, lit: 2, world: 3, history: 4, society: 5, science: 6, arts: 7, reference: 8, new: 9 };

export interface SpineLook {
  color: string;
  /** Of the 10px a shelf has. */
  height: number;
  /** Gold bands near the top and bottom. */
  bands: boolean;
}

/** How the book in `slot` of bookcase `n` of a wing looks. */
export function spineLook(wing: string, n: number, slot: number): SpineLook {
  const h = hash(n, slot, 900 + (WING_SALT[wing] ?? 0));
  const palette = wing === "children" ? BRIGHT : BINDINGS;
  return { color: palette[h % palette.length], height: 7 + ((h >>> 8) % 4), bands: (h >>> 12) % 3 === 0 };
}

/** Bookcase art: where the shelves are inside the canvas. */
const CASE_OVERHANG = 44;
const SHELF_X = 4;
const SHELF_W = 56;
const SHELF_Y = 8;
const SHELF_PITCH = 12;

/** Where slot `slot`'s spine is, in pixels from the bookcase's footprint top-left. */
export function slotRect(slot: number): { x: number; y: number; w: number; h: number } {
  const shelf = Math.floor(slot / 20);
  const i = slot % 20;
  const x0 = SHELF_X + Math.floor((i * SHELF_W) / 20);
  const x1 = SHELF_X + Math.floor(((i + 1) * SHELF_W) / 20);
  return { x: x0, y: SHELF_Y + shelf * SHELF_PITCH - CASE_OVERHANG, w: x1 - x0, h: 10 };
}

function bookcase(o: MapObject, wing: string, books: number, slots = 100): HTMLCanvasElement {
  const w = o.w * TILE;
  const [c, ctx] = canvas(w, o.h * TILE + CASE_OVERHANG);
  const kids = wing === "children";
  const wood = kids ? "#d9b07a" : "#5a3a22";
  const woodLight = kids ? "#e8c896" : "#6e4b30";
  const back = kids ? "#c79a63" : "#2e1d12";
  px(ctx, "rgba(0,0,0,0.2)", 2, c.height - 6, w - 4, 6);
  px(ctx, O, 0, 1, w, c.height - 3);
  px(ctx, wood, 1, 2, w - 2, c.height - 5);
  // The cornice along the top.
  px(ctx, woodLight, 0, 1, w, 3);
  px(ctx, O, 0, 4, w, 1);
  if (kids) {
    // Painted ends, red and blue.
    px(ctx, "#e0574f", 1, 5, 2, c.height - 8);
    px(ctx, "#4fa3d9", w - 3, 5, 2, c.height - 8);
  }
  const n = Number(o.label ?? 0);
  const gaps = new Set(o.gaps ?? []);
  for (let s = 0; s < 5; s++) {
    const y = SHELF_Y + s * SHELF_PITCH;
    px(ctx, back, SHELF_X, y - 1, SHELF_W, 11);
    // Shadow under the shelf above.
    px(ctx, "rgba(0,0,0,0.25)", SHELF_X, y - 1, SHELF_W, 1);
    for (let i = 0; i < 20; i++) {
      const slot = s * 20 + i;
      if (slot >= Math.min(books, slots)) break;
      // Out on loan: a gap, and the next book leaning into it.
      if (gaps.has(slot)) continue;
      const r = slotRect(slot);
      const look = spineLook(wing, n, slot);
      const top = y + 10 - look.height;
      px(ctx, look.color, r.x, top, r.w, look.height);
      px(ctx, "rgba(0,0,0,0.35)", r.x, top, 1, look.height);
      px(ctx, "rgba(255,255,255,0.18)", r.x + r.w - 1, top + 1, 1, look.height - 2);
      if (look.bands) {
        px(ctx, "#d8b45a", r.x + 1, top + 1, r.w - 1, 1);
        px(ctx, "#d8b45a", r.x + 1, y + 8, r.w - 1, 1);
      }
    }
    // The shelf board.
    px(ctx, woodLight, SHELF_X - 1, y + 10, SHELF_W + 2, 2);
  }
  // Plinth.
  px(ctx, O, 1, c.height - 6, w - 2, 1);
  px(ctx, woodLight, 1, c.height - 5, w - 2, 2);
  return c;
}

/** Door plaques: the wings by a word or two. */
const SHORT: Record<string, string> = {
  children: "CHILDREN",
  lit: "LITERATURE",
  world: "WORLD",
  history: "HISTORY",
  society: "SOCIETY",
  science: "SCIENCE",
  arts: "ARTS",
  reference: "REFERENCE",
};

// ---- ground ---------------------------------------------------------------------

export const LIBRARY_GROUND: Record<string, string> = { parquet: "#b4844f", marble: "#e8e1d2", rug: "#7e3434" };

/** Draws a library floor tile; false if `kind` isn't one. */
export function drawLibraryGround(
  ctx: CanvasRenderingContext2D,
  kind: string,
  tx: number,
  ty: number,
  ox: number,
  oy: number,
  differs: (dx: number, dy: number) => boolean,
): boolean {
  switch (kind) {
    case "parquet": {
      // Herringbone-ish oak blocks: four per tile, alternating direction.
      for (let q = 0; q < 4; q++) {
        const qx = ox + (q % 2) * 16;
        const qy = oy + Math.floor(q / 2) * 16;
        const across = (q + tx + ty) % 2 === 0;
        const s = hash(tx * 2 + (q % 2), ty * 2 + (q >> 1), 70);
        px(ctx, ["#b4844f", "#a97a47", "#bd8d58"][s % 3], qx, qy, 16, 16);
        for (let k = 1; k < 4; k++) {
          if (across) px(ctx, "#93673a", qx, qy + k * 4, 16, 1);
          else px(ctx, "#93673a", qx + k * 4, qy, 1, 16);
        }
        px(ctx, "#8a5f35", qx, qy, 16, 1);
        px(ctx, "#8a5f35", qx, qy, 1, 16);
      }
      return true;
    }
    case "marble": {
      // Big pale slabs with a darker diamond where four meet, faint veins.
      px(ctx, (tx + ty) % 2 ? "#e8e1d2" : "#ded5c3", ox, oy, TILE, TILE);
      px(ctx, "#cfc5b1", ox, oy, TILE, 1);
      px(ctx, "#cfc5b1", ox, oy, 1, TILE);
      px(ctx, "#9c8f78", ox, oy, 3, 1);
      px(ctx, "#9c8f78", ox, oy, 1, 3);
      const s = hash(tx, ty, 71);
      if (s % 3 === 0) {
        let vx = ox + (s % 20) + 4;
        for (let vy = oy + 4; vy < oy + 26; vy += 2) {
          px(ctx, "rgba(150,138,118,0.35)", vx, vy, 1, 2);
          vx += ((s >>> vy % 7) & 1) * 2 - 1;
        }
      }
      return true;
    }
    case "rug": {
      // A deep red runner, a small gold lozenge pattern, a gold-edged border.
      px(ctx, "#7e3434", ox, oy, TILE, TILE);
      px(ctx, "#9a4a3c", ox + 14, oy + 10, 4, 12);
      px(ctx, "#9a4a3c", ox + 10, oy + 14, 12, 4);
      px(ctx, "#d1a54f", ox + 15, oy + 15, 2, 2);
      const edge = "#d1a54f";
      if (differs(0, -1)) px(ctx, "#5a2222", ox, oy, TILE, 4), px(ctx, edge, ox, oy + 4, TILE, 1);
      if (differs(0, 1)) px(ctx, "#5a2222", ox, oy + TILE - 4, TILE, 4), px(ctx, edge, ox, oy + TILE - 5, TILE, 1);
      if (differs(-1, 0)) px(ctx, "#5a2222", ox, oy, 4, TILE), px(ctx, edge, ox + 4, oy, 1, TILE);
      if (differs(1, 0)) px(ctx, "#5a2222", ox + TILE - 4, oy, 4, TILE), px(ctx, edge, ox + TILE - 5, oy, 1, TILE);
      return true;
    }
  }
  return false;
}

// ---- decor ----------------------------------------------------------------------

/** A library decor sprite (anchored bottom-centre on its tile), or null. */
export function libraryDecor(kind: string, v: number): HTMLCanvasElement | null {
  switch (kind) {
    case "library_wall": {
      // Dark oak wainscot below, deep green plaster above, a tall arched
      // window now and then.
      const [c, ctx] = canvas(32, 52);
      px(ctx, O, 0, 2, 32, 50);
      px(ctx, "#3f5a46", 0, 4, 32, 30);
      px(ctx, "#4a6a52", 0, 4, 32, 2);
      if (v === 0) {
        px(ctx, O, 8, 8, 16, 24);
        disc(ctx, O, 16, 12, 8);
        px(ctx, "#bcdbe6", 10, 12, 12, 19);
        disc(ctx, "#bcdbe6", 16, 12, 6);
        px(ctx, "#e6f3f6", 11, 9, 3, 10);
        px(ctx, O, 15, 7, 2, 25);
        px(ctx, O, 9, 20, 14, 1);
      }
      px(ctx, "#4e3420", 0, 34, 32, 18);
      px(ctx, "#6e4b30", 0, 34, 32, 2);
      px(ctx, "#3a2616", 2, 38, 12, 10);
      px(ctx, "#3a2616", 18, 38, 12, 10);
      px(ctx, "#5a3a22", 3, 39, 10, 8);
      px(ctx, "#5a3a22", 19, 39, 10, 8);
      return c;
    }
    case "chair": {
      // A wooden library chair with a green leather seat.
      const [c, ctx] = canvas(32, 34);
      px(ctx, "rgba(0,0,0,0.18)", 8, 30, 16, 3);
      px(ctx, O, 9, 4, 14, 16);
      px(ctx, "#6e4b30", 10, 5, 12, 14);
      px(ctx, "#5a3a22", 12, 8, 8, 1);
      px(ctx, "#5a3a22", 12, 12, 8, 1);
      px(ctx, O, 8, 18, 16, 5);
      px(ctx, "#3f6b4a", 9, 19, 14, 3);
      px(ctx, "#5a8a64", 10, 19, 8, 1);
      px(ctx, O, 9, 23, 2, 8);
      px(ctx, O, 21, 23, 2, 8);
      return c;
    }
    case "chair_n": {
      // The same chair from behind: the seat, and the back nearer us.
      const [c, ctx] = canvas(32, 34);
      px(ctx, "rgba(0,0,0,0.18)", 8, 30, 16, 3);
      px(ctx, O, 8, 10, 16, 5);
      px(ctx, "#3f6b4a", 9, 11, 14, 3);
      px(ctx, O, 9, 15, 2, 16);
      px(ctx, O, 21, 15, 2, 16);
      px(ctx, O, 9, 14, 14, 14);
      px(ctx, "#6e4b30", 10, 15, 12, 12);
      px(ctx, "#5a3a22", 12, 18, 8, 1);
      px(ctx, "#5a3a22", 12, 22, 8, 1);
      return c;
    }
    case "reading_table": {
      // A long oak table with a green baize top; a banker's lamp on some.
      const [c, ctx] = canvas(32, 40);
      px(ctx, "rgba(0,0,0,0.18)", 0, 34, 32, 4);
      px(ctx, O, 0, 18, 32, 14);
      px(ctx, "#6e4b30", 0, 19, 32, 4);
      px(ctx, "#2f5a3c", 0, 20, 32, 2);
      px(ctx, "#5a3a22", 0, 23, 32, 8);
      px(ctx, "#4e3420", 0, 26, 32, 1);
      if (v !== 1) {
        px(ctx, O, 3, 31, 3, 7);
        px(ctx, O, 26, 31, 3, 7);
      }
      if (v === 0) {
        // The lamp: brass stand, green glass shade, a pool of light.
        px(ctx, "rgba(255,236,170,0.35)", 8, 19, 16, 3);
        px(ctx, "#b8913a", 15, 10, 2, 9);
        px(ctx, "#b8913a", 12, 18, 8, 2);
        px(ctx, O, 9, 6, 14, 6);
        px(ctx, "#2f8a4a", 10, 7, 12, 4);
        px(ctx, "#6fd08a", 11, 7, 6, 1);
        px(ctx, "#fff2b8", 11, 11, 10, 1);
      } else if (v === 2) {
        // An open book.
        px(ctx, O, 10, 17, 12, 4);
        px(ctx, "#f4ecd8", 11, 17, 5, 3);
        px(ctx, "#f4ecd8", 16, 17, 5, 3);
        px(ctx, "#c8bb9a", 12, 18, 3, 1);
        px(ctx, "#c8bb9a", 17, 18, 3, 1);
      }
      return c;
    }
    case "carrel": {
      // A study carrel: a desk with high side panels and a little lamp.
      const [c, ctx] = canvas(32, 46);
      px(ctx, "rgba(0,0,0,0.18)", 3, 42, 26, 3);
      px(ctx, O, 2, 4, 28, 36);
      px(ctx, "#6e4b30", 3, 5, 26, 34);
      px(ctx, "#4e3420", 6, 8, 20, 18);
      px(ctx, "#fff2b8", 8, 10, 6, 2);
      px(ctx, "#2f8a4a", 8, 8, 6, 2);
      px(ctx, O, 2, 26, 28, 3);
      px(ctx, "#8a5a33", 3, 26, 26, 2);
      px(ctx, "#f4ecd8", 16, 23, 7, 3);
      px(ctx, O, 4, 29, 2, 11);
      px(ctx, O, 26, 29, 2, 11);
      return c;
    }
    case "globe": {
      const [c, ctx] = canvas(32, 44);
      px(ctx, "rgba(0,0,0,0.18)", 8, 40, 16, 3);
      px(ctx, O, 14, 26, 4, 14);
      px(ctx, "#6e4b30", 10, 37, 12, 3);
      disc(ctx, O, 16, 16, 11);
      disc(ctx, "#4f8fc4", 16, 16, 10);
      px(ctx, "#6cae5a", 10, 9, 6, 5);
      px(ctx, "#6cae5a", 18, 15, 5, 8);
      px(ctx, "#6cae5a", 9, 18, 4, 4);
      px(ctx, "rgba(255,255,255,0.4)", 11, 8, 2, 3);
      px(ctx, "#b8913a", 4, 15, 2, 3);
      px(ctx, "#b8913a", 26, 15, 2, 3);
      return c;
    }
    case "potted_plant": {
      const [c, ctx] = canvas(32, 48);
      px(ctx, "rgba(0,0,0,0.18)", 8, 44, 16, 3);
      px(ctx, O, 9, 32, 14, 12);
      px(ctx, "#b8913a", 10, 33, 12, 10);
      px(ctx, "#d8b45a", 11, 33, 3, 9);
      const leaf = ["#3f7a4a", "#4f9a5a", "#2f6a3c"];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + v;
        oval(ctx, leaf[i % 3], Math.round(16 + Math.cos(a) * 8), Math.round(20 + Math.sin(a) * 9), 4, 6);
      }
      oval(ctx, "#5fb06a", 16, 16, 4, 7);
      return c;
    }
    case "cushion": {
      // A big round floor cushion for the story circle.
      const [c, ctx] = canvas(32, 22);
      const col = ["#e0574f", "#f2b33d", "#4fa3d9"][v];
      oval(ctx, "rgba(0,0,0,0.18)", 16, 17, 12, 4);
      oval(ctx, O, 16, 12, 13, 8);
      oval(ctx, col, 16, 12, 12, 7);
      oval(ctx, "rgba(255,255,255,0.25)", 13, 9, 6, 3);
      px(ctx, "rgba(0,0,0,0.3)", 15, 11, 2, 2);
      return c;
    }
  }
  return null;
}

// ---- objects --------------------------------------------------------------------

/** A library object's art: drawn from `overhang` px above its footprint. */
export function libraryObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "bookcase":
      return { c: bookcase(o, o.wing ?? "lit", o.books ?? 0), overhang: CASE_OVERHANG };
    case "new_arrivals": {
      // A slanted display of new books, covers out, under a NEW ARRIVALS board.
      const [c, ctx] = canvas(w, h + 48);
      px(ctx, "rgba(0,0,0,0.2)", 4, c.height - 6, w - 8, 6);
      px(ctx, O, 2, 2, w - 4, 12);
      px(ctx, "#2f5a3c", 3, 3, w - 6, 10);
      text(ctx, "NEW ARRIVALS", w / 2, 8, "#f2dc98", w - 10);
      px(ctx, O, 4, 14, w - 8, c.height - 18);
      px(ctx, "#6e4b30", 5, 15, w - 10, c.height - 20);
      for (const [row, y] of [[0, 18], [1, 38]] as const) {
        px(ctx, "#4e3420", 6, y + 16, w - 12, 3);
        for (let i = 0; i * 14 + 10 < w - 8; i++) {
          if (i >= (o.books ?? 0) - row * 8) break;
          const look = spineLook("new", row, i);
          px(ctx, O, 8 + i * 14, y, 12, 16);
          px(ctx, look.color, 9 + i * 14, y + 1, 10, 14);
          px(ctx, "#f2dc98", 10 + i * 14, y + 4, 8, 1);
          px(ctx, "rgba(255,255,255,0.2)", 9 + i * 14, y + 1, 2, 14);
        }
      }
      return { c, overhang: 48 };
    }
    case "stack_sign": {
      // The range-end panel: a card in a brass frame saying what's on the row.
      const [c, ctx] = canvas(w, h + 32);
      px(ctx, "rgba(0,0,0,0.2)", 6, c.height - 5, w - 12, 5);
      px(ctx, O, 10, 2, 12, c.height - 5);
      px(ctx, "#5a3a22", 11, 3, 10, c.height - 7);
      px(ctx, O, 4, 10, 24, 20);
      px(ctx, "#b8913a", 5, 11, 22, 18);
      px(ctx, "#f4ecd8", 7, 13, 18, 14);
      if (o.sign) text(ctx, o.sign, 16, 20, "#3b3a2e", 17);
      return { c, overhang: 32 };
    }
    case "wing_door": {
      // A tall arched doorway in the panelling, a glimpse of shelves beyond,
      // and a brass plaque naming the wing.
      const [c, ctx] = canvas(w, h + 60);
      const key = (o.label ?? "").replace("library_", "");
      px(ctx, O, 6, 6, w - 12, c.height - 6);
      disc(ctx, O, w / 2, 22, w / 2 - 6);
      px(ctx, "#cfc5b1", 8, 8, w - 16, c.height - 8);
      disc(ctx, "#cfc5b1", w / 2, 22, w / 2 - 8);
      px(ctx, "#2e1d12", 14, 24, w - 28, c.height - 24);
      disc(ctx, "#2e1d12", w / 2, 26, w / 2 - 14);
      // Shelves glimpsed through the door.
      for (let s = 0; s < 4; s++) {
        const y = 30 + s * 12;
        for (let x = 16; x < w - 16; x += 3) px(ctx, spineLook(key, s, x).color, x, y, 2, 8);
        px(ctx, "#6e4b30", 14, y + 8, w - 28, 2);
      }
      px(ctx, "rgba(255,236,170,0.12)", 14, 24, w - 28, c.height - 24);
      px(ctx, O, 10, 0, w - 20, 11);
      px(ctx, "#b8913a", 11, 1, w - 22, 9);
      text(ctx, SHORT[key] ?? "", w / 2, 6, "#3b2a12", w - 26);
      return { c, overhang: 60 };
    }
    case "circulation_desk": {
      // The long front desk: panelled oak, a green leather top, a brass
      // bell, the date stamp and piles of returned books.
      const [c, ctx] = canvas(w, h + 22);
      px(ctx, "rgba(0,0,0,0.2)", 4, c.height - 6, w - 8, 6);
      px(ctx, O, 0, 8, w, c.height - 10);
      px(ctx, "#5a3a22", 1, 14, w - 2, c.height - 17);
      for (let x = 8; x < w - 24; x += 28) {
        px(ctx, "#4e3420", x, 18, 20, c.height - 26);
        px(ctx, "#6e4b30", x + 1, 19, 18, c.height - 28);
      }
      px(ctx, "#6e4b30", 0, 8, w, 6);
      px(ctx, "#2f5a3c", 2, 9, w - 4, 3);
      // Piles of books.
      for (const [x, n] of [[22, 4], [w - 60, 3], [w / 2 + 30, 2]] as const) {
        for (let i = 0; i < n; i++) {
          const look = spineLook("new", x, i);
          px(ctx, O, x - 1, 6 - i * 4, 18, 5);
          px(ctx, look.color, x, 7 - i * 4, 16, 3);
        }
      }
      // The bell and the stamp.
      disc(ctx, O, w / 2, 5, 4);
      disc(ctx, "#d8b45a", w / 2, 5, 3);
      px(ctx, O, w / 2 - 6, 8, 12, 1);
      px(ctx, O, w / 2 - 50, 0, 4, 8);
      px(ctx, "#8a3f22", w / 2 - 53, 6, 10, 3);
      return { c, overhang: 22 };
    }
    case "card_catalogue": {
      // A cabinet of little drawers with brass pulls.
      const [c, ctx] = canvas(w, h + 30);
      px(ctx, "rgba(0,0,0,0.2)", 4, c.height - 5, w - 8, 5);
      px(ctx, O, 2, 2, w - 4, c.height - 6);
      px(ctx, "#6e4b30", 3, 3, w - 6, c.height - 8);
      px(ctx, "#8a5a33", 2, 2, w - 4, 3);
      for (let r = 0; r < 5; r++) {
        for (let k = 0; k < 6; k++) {
          const x = 5 + k * 9;
          const y = 7 + r * 10;
          px(ctx, "#4e3420", x, y, 8, 8);
          px(ctx, "#7d5232", x + 1, y + 1, 6, 6);
          px(ctx, "#f4ecd8", x + 2, y + 2, 4, 2);
          px(ctx, "#d8b45a", x + 3, y + 5, 2, 1);
        }
      }
      return { c, overhang: 30 };
    }
    case "library_exit":
    case "wing_exit": {
      // The way out: double doors, the hall's marble or the street beyond.
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 0, 0, w, h + 16);
      px(ctx, o.kind === "library_exit" ? "#cfe8b8" : "#e8e1d2", 3, 3, w - 6, h + 10);
      px(ctx, "#7e3434", 6, h + 4, w - 12, 10);
      text(ctx, "EXIT", w / 2, h / 2 + 6, "#3b3a2e", w - 8);
      return { c, overhang: 16 };
    }
    case "library": {
      // The Library: a pale stone temple of books. Broad steps, six tall
      // columns, a pediment with LIBRARY across the frieze, tall windows
      // between the columns and big doors in the middle.
      const top = 84;
      const [c, ctx] = canvas(w, h + top);
      const stone = "#e6dcc6";
      const shade = "#c9bc9f";
      const ft = top + h; // footprint bottom
      px(ctx, "rgba(0,0,0,0.18)", 10, ft - 8, w - 20, 8);
      // The body behind the columns.
      px(ctx, O, 24, 52, w - 48, ft - 52 - 22);
      px(ctx, stone, 26, 54, w - 52, ft - 56 - 22);
      // Pediment: a shallow triangle over the entablature.
      const peakY = 6;
      const baseY = 40;
      for (let y = peakY; y <= baseY; y++) {
        const half = ((y - peakY) / (baseY - peakY)) * (w / 2 - 12);
        px(ctx, O, Math.round(w / 2 - half - 1), y, Math.round(half * 2 + 2), 1);
        if (y > peakY + 2) px(ctx, stone, Math.round(w / 2 - half + 2), y, Math.round(half * 2 - 4), 1);
      }
      disc(ctx, O, w / 2, 30, 7);
      disc(ctx, "#d8b45a", w / 2, 30, 6);
      px(ctx, "#8a6d2e", w / 2 - 4, 30, 8, 1);
      px(ctx, "#8a6d2e", w / 2, 26, 1, 8);
      // Entablature with the name.
      px(ctx, O, 8, 40, w - 16, 18);
      px(ctx, stone, 10, 42, w - 20, 14);
      px(ctx, shade, 10, 54, w - 20, 2);
      text(ctx, "LIBRARY", w / 2, 49, "#5a4a32", w - 40, 2);
      // Columns and windows between them.
      const cols = 6;
      const colTop = 58;
      const colBot = ft - 24;
      for (let i = 0; i < cols; i++) {
        const cx = Math.round(40 + (i * (w - 80)) / (cols - 1));
        px(ctx, O, cx - 9, colTop, 18, colBot - colTop);
        px(ctx, stone, cx - 8, colTop + 4, 16, colBot - colTop - 8);
        for (let f = -5; f <= 5; f += 3) px(ctx, shade, cx + f, colTop + 6, 1, colBot - colTop - 12);
        px(ctx, stone, cx - 10, colTop, 20, 4);
        px(ctx, stone, cx - 10, colBot - 4, 20, 4);
        px(ctx, O, cx - 10, colTop + 4, 20, 1);
        px(ctx, O, cx - 10, colBot - 5, 20, 1);
        if (i < cols - 1) {
          const nx = Math.round(40 + ((i + 1) * (w - 80)) / (cols - 1));
          const mx = Math.round((cx + nx) / 2);
          if (i === Math.floor((cols - 1) / 2)) {
            // The doors.
            px(ctx, O, mx - 22, colBot - 64, 44, 64);
            px(ctx, "#5a3a22", mx - 20, colBot - 62, 40, 62);
            px(ctx, "#4e3420", mx - 1, colBot - 62, 2, 62);
            px(ctx, "#fff2b8", mx - 16, colBot - 58, 12, 18);
            px(ctx, "#fff2b8", mx + 4, colBot - 58, 12, 18);
            px(ctx, "#d8b45a", mx - 5, colBot - 30, 2, 4);
            px(ctx, "#d8b45a", mx + 3, colBot - 30, 2, 4);
          } else {
            // A tall window with its lamp-lit shelves inside.
            px(ctx, O, mx - 14, colTop + 18, 28, colBot - colTop - 36);
            px(ctx, "#f6e2a8", mx - 12, colTop + 20, 24, colBot - colTop - 40);
            for (let y = colTop + 28; y < colBot - 24; y += 12) {
              for (let x = mx - 11; x < mx + 11; x += 3) px(ctx, spineLook("lit", x, y).color, x, y, 2, 8);
              px(ctx, "#6e4b30", mx - 12, y + 8, 24, 2);
            }
            px(ctx, O, mx - 1, colTop + 20, 2, colBot - colTop - 40);
          }
        }
      }
      // The steps.
      for (let s = 0; s < 3; s++) {
        const y = colBot + s * 8;
        px(ctx, O, 14 - s * 4, y, w - 28 + s * 8, 8);
        px(ctx, s % 2 ? shade : stone, 15 - s * 4, y + 1, w - 30 + s * 8, 6);
      }
      return { c, overhang: top };
    }
  }
  return null;
}
