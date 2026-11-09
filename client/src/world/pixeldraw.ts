// Hard-edged shape fills for pixel art. Canvas paths (arc, ellipse, lineTo)
// are always anti-aliased, which leaves half-blended pixels around every
// shape; these fill whole pixels row by row, sampling at pixel centres, so
// edges stay crisp once the texture is scaled up.

/** Fills `[x0, x1)` on row `y`. */
function span(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number) {
  const a = Math.round(x0);
  const b = Math.round(x1);
  if (b > a) ctx.fillRect(a, y, b - a, 1);
}

/** A filled ellipse centred on (cx, cy). */
export function oval(ctx: CanvasRenderingContext2D, color: string, cx: number, cy: number, rx: number, ry: number) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const hw = rx * Math.sqrt(1 - dy * dy);
    span(ctx, cx - hw, cx + hw, y);
  }
}

/** A filled circle centred on (cx, cy). */
export function disc(ctx: CanvasRenderingContext2D, color: string, cx: number, cy: number, r: number) {
  oval(ctx, color, cx, cy, r, r);
}

/** A filled polygon (even-odd), given its corners in order. */
export function polygon(ctx: CanvasRenderingContext2D, color: string, pts: [number, number][]) {
  ctx.fillStyle = color;
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    pts.forEach(([x0, y0], i) => {
      const [x1, y1] = pts[(i + 1) % pts.length];
      if (y0 <= yc !== y1 <= yc) xs.push(x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0));
    });
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) span(ctx, xs[i], xs[i + 1], y);
  }
}

/**
 * Outlines every pixel of `color` that touches empty space (side by side,
 * not corners) with `outline`, but not inside `skip` (x, y, w, h): bare
 * hands and arms in any pose, without drawing round each one.
 */
export function outlineColor(ctx: CanvasRenderingContext2D, color: string, outline: string, skip?: [number, number, number, number]) {
  const { width: w, height: h } = ctx.canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // (Any CSS colour: the canvas hands it back as #rrggbb.)
  ctx.fillStyle = color;
  const n = Number.parseInt(String(ctx.fillStyle).slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  const o = Number.parseInt(outline.slice(1), 16);
  const [or, og, ob] = [o >> 16, (o >> 8) & 255, o & 255];
  const at = (x: number, y: number) => (y * w + x) * 4;
  const is = (x: number, y: number) => {
    const i = at(x, y);
    return d[i + 3] === 255 && d[i] === r && d[i + 1] === g && d[i + 2] === b;
  };
  // (A see-through pixel, the ground shadow under the feet, counts as empty.)
  const empty = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[at(x, y) + 3] < 128;
  const mark: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!is(x, y)) continue;
      if (skip && x >= skip[0] && y >= skip[1] && x < skip[0] + skip[2] && y < skip[1] + skip[3]) continue;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (empty(nx, ny)) mark.push(at(nx, ny));
    }
  }
  if (!mark.length) return;
  for (const i of mark) {
    d[i] = or;
    d[i + 1] = og;
    d[i + 2] = ob;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
