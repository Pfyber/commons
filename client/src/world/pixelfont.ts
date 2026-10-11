// A five-pixel-tall pixel font for signs and screen captions. Canvas text drawn a few
// pixels tall and then scaled up with nearest-neighbour filtering turns to
// mush; these glyphs stay crisp at any integer scale.

// Five rows of pixels, "#" = ink; most glyphs are three wide, M and W five.
// Lowercase is drawn as uppercase.
const GLYPHS: Record<string, string> = {
  A: ".#. #.# ### #.# #.#",
  B: "##. #.# ##. #.# ##.",
  C: ".## #.. #.. #.. .##",
  D: "##. #.# #.# #.# ##.",
  E: "### #.. ##. #.. ###",
  F: "### #.. ##. #.. #..",
  G: ".## #.. #.# #.# .##",
  H: "#.# #.# ### #.# #.#",
  I: "### .#. .#. .#. ###",
  J: "..# ..# ..# #.# .#.",
  K: "#.# #.# ##. #.# #.#",
  L: "#.. #.. #.. #.. ###",
  M: "#...# ##.## #.#.# #...# #...#",
  N: "##. #.# #.# #.# #.#",
  O: ".#. #.# #.# #.# .#.",
  P: "##. #.# ##. #.. #..",
  Q: ".#. #.# #.# ##. .##",
  R: "##. #.# ##. #.# #.#",
  S: ".## #.. .#. ..# ##.",
  T: "### .#. .#. .#. .#.",
  U: "#.# #.# #.# #.# ###",
  V: "#.# #.# #.# #.# .#.",
  W: "#...# #...# #.#.# ##.## #...#",
  X: "#.# #.# .#. #.# #.#",
  Y: "#.# #.# .#. .#. .#.",
  Z: "### ..# .#. #.. ###",
  "0": "### #.# #.# #.# ###",
  "1": ".#. ##. .#. .#. ###",
  "2": "##. ..# .#. #.. ###",
  "3": "##. ..# .#. ..# ##.",
  "4": "#.# #.# ### ..# ..#",
  "5": "### #.. ##. ..# ##.",
  "6": ".## #.. ### #.# ###",
  "7": "### ..# .#. .#. .#.",
  "8": "### #.# ### #.# ###",
  "9": "### #.# ### ..# ##.",
  " ": "... ... ... ... ...",
  ".": "... ... ... ... .#.",
  ",": "... ... ... .#. #..",
  "'": ".#. .#. ... ... ...",
  "!": ".#. .#. .#. ... .#.",
  "?": "##. ..# .#. ... .#.",
  "-": "... ... ### ... ...",
  ":": "... .#. ... .#. ...",
  "·": "... ... .#. ... ...",
  "&": ".#. #.# .#. #.# .##",
  "(": "..# .#. .#. .#. ..#",
  ")": "#.. .#. .#. .#. #..",
  "/": "..# ..# .#. #.. #..",
};

interface Glyph {
  w: number;
  ink: boolean[];
}

const BITMAPS = new Map<string, Glyph>(
  Object.entries(GLYPHS).map(([ch, rows]) => [
    ch,
    { w: rows.indexOf(" "), ink: [...rows.replaceAll(" ", "")].map((c) => c === "#") },
  ]),
);

/** True when every character has a glyph (otherwise fall back to canvas text). */
export function canPixel(text: string): boolean {
  return [...text.toUpperCase()].every((c) => BITMAPS.has(c));
}

/** Width in pixels of `text` at `scale` (1-pixel gaps between glyphs). */
export function pixelWidth(text: string, scale = 1): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += (BITMAPS.get(ch)?.w ?? 3) + 1;
  return Math.max(0, w - 1) * scale;
}

/** Draws `text` with its top-left corner at (x, y). */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const top = Math.round(y);
  for (const ch of text.toUpperCase()) {
    const g = BITMAPS.get(ch);
    const w = g?.w ?? 3;
    if (g) {
      g.ink.forEach((on, i) => {
        if (on) ctx.fillRect(cx + (i % w) * scale, top + Math.floor(i / w) * scale, scale, scale);
      });
    }
    cx += (w + 1) * scale;
  }
}
