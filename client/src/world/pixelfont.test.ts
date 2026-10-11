import { describe, expect, it } from "vitest";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

describe("pixel font", () => {
  it("covers sign text and measures it", () => {
    expect(canPixel("The Pond, Underwater")).toBe(true);
    expect(canPixel("Market")).toBe(true);
    expect(canPixel("🏡")).toBe(false);
    expect(pixelWidth("AB", 2)).toBe(14);
    expect(pixelWidth("MA")).toBe(9);
  });

  it("draws every glyph five pixels tall, within the measured width", () => {
    const cells: [number, number][] = [];
    const ctx = { fillStyle: "", fillRect: (x: number, y: number) => cells.push([x, y]) } as unknown as CanvasRenderingContext2D;
    const all = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,'!?-:·&()/";
    for (const ch of all) {
      cells.length = 0;
      drawPixelText(ctx, ch, 0, 0, "#000");
      expect(cells.length, ch).toBeGreaterThan(0);
      for (const [x, y] of cells) {
        expect(x, ch).toBeLessThan(pixelWidth(ch));
        expect(y, ch).toBeLessThan(5);
      }
      if (/[A-Z0-9]/.test(ch)) expect(Math.max(...cells.map(([, y]) => y)), ch).toBe(4);
    }
  });
});
