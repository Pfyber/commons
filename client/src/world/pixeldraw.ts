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
