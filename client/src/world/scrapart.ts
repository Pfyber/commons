// What the magnet brings up from the bottom of the pond, at 32×32 like the
// fish: a rusty can, a bike chain, an old key, a hubcap, a pocket watch, a
// little anchor, an old safe and (once in a long while) a meteorite. Each
// with a little silt and rust about it.

import { disc, oval, polygon } from "./pixeldraw";

const O = "#2b2233";

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** A drip of pond water and a fleck of weed, so it looks fished out. */
function wet(ctx: CanvasRenderingContext2D, x: number, y: number) {
  px(ctx, "#8fd3ff", x, y, 1, 2);
  px(ctx, "#5aa04a", x + 3, y - 1, 2, 1);
}

export function drawScrap(ctx: CanvasRenderingContext2D, key: string) {
  switch (key) {
    case "rusty_can": {
      // A dented tin can on its side, rust bleeding through the label.
      px(ctx, O, 6, 9, 20, 16);
      px(ctx, "#b8b8c4", 7, 10, 18, 14);
      px(ctx, "#d84a3a", 7, 13, 18, 8);
      px(ctx, "#f2c94c", 10, 15, 8, 3);
      px(ctx, "#a0522d", 18, 12, 5, 4);
      px(ctx, "#8b3a1a", 9, 20, 6, 3);
      px(ctx, "#a0522d", 21, 18, 3, 5);
      oval(ctx, O, 26, 17, 3, 8);
      oval(ctx, "#d8d8e0", 26, 17, 2, 7);
      oval(ctx, "#9a9aa8", 26, 17, 1, 4);
      px(ctx, "#ffffff", 8, 11, 6, 1);
      px(ctx, "#6e6e7a", 14, 10, 2, 2);
      wet(ctx, 12, 26);
      return;
    }
    case "bike_chain": {
      // A loop of chain links, dark and oily, a few rusted.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = 16 + Math.cos(a) * 9;
        const y = 16 + Math.sin(a) * 7;
        const rust = i % 4 === 1;
        oval(ctx, O, x, y, 3, 2.5);
        oval(ctx, rust ? "#a0522d" : "#7a7a88", x, y, 2, 1.6);
        px(ctx, rust ? "#d27a3a" : "#c8c8d4", Math.round(x) - 1, Math.round(y) - 1);
      }
      wet(ctx, 24, 25);
      return;
    }
    case "old_key": {
      // A big old iron key: a round bow, a long shank, toothy bit.
      disc(ctx, O, 9, 16, 7);
      disc(ctx, "#8a7a5a", 9, 16, 6);
      disc(ctx, O, 9, 16, 3);
      disc(ctx, "#4a3f2e", 9, 16, 2);
      px(ctx, O, 14, 14, 15, 5);
      px(ctx, "#a8946a", 15, 15, 13, 3);
      px(ctx, "#d8c48a", 15, 15, 12, 1);
      px(ctx, O, 23, 18, 7, 6);
      px(ctx, "#a8946a", 24, 19, 2, 4);
      px(ctx, "#a8946a", 27, 19, 2, 3);
      px(ctx, "#6e5a3a", 5, 12, 3, 2);
      px(ctx, "#5aa04a", 11, 21, 3, 1);
      return;
    }
    case "hubcap": {
      // A chrome hubcap, spokes and a dented rim, catching the light.
      disc(ctx, O, 16, 16, 13);
      disc(ctx, "#9aa0ac", 16, 16, 12);
      disc(ctx, "#d4d8e0", 16, 16, 10);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        polygon(ctx, "#8a909c", [
          [16 + Math.cos(a - 0.18) * 4, 16 + Math.sin(a - 0.18) * 4],
          [16 + Math.cos(a - 0.12) * 10, 16 + Math.sin(a - 0.12) * 10],
          [16 + Math.cos(a + 0.12) * 10, 16 + Math.sin(a + 0.12) * 10],
          [16 + Math.cos(a + 0.18) * 4, 16 + Math.sin(a + 0.18) * 4],
        ]);
      }
      disc(ctx, O, 16, 16, 4);
      disc(ctx, "#e8ecf2", 16, 16, 3);
      px(ctx, "#ffffff", 9, 8, 4, 2);
      px(ctx, "#ffffff", 8, 10, 2, 2);
      px(ctx, "#6e5a3a", 24, 23, 4, 2);
      px(ctx, O, 26, 6, 3, 3);
      return;
    }
    case "pocket_watch": {
      // A gold pocket watch on its chain, its glass cracked, still ticking?
      px(ctx, "#c99a2a", 15, 2, 2, 5);
      disc(ctx, O, 16, 8, 3);
      disc(ctx, "#f6c343", 16, 8, 2);
      disc(ctx, O, 16, 19, 11);
      disc(ctx, "#f6c343", 16, 19, 10);
      disc(ctx, "#c99a2a", 16, 19, 8);
      disc(ctx, "#fff8e3", 16, 19, 7);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        px(ctx, "#5a4a3a", Math.round(16 + Math.cos(a) * 6), Math.round(19 + Math.sin(a) * 6));
      }
      px(ctx, O, 16, 15, 1, 5);
      px(ctx, O, 16, 19, 4, 1);
      px(ctx, "#9ad0e8", 12, 15, 1, 6);
      px(ctx, "#9ad0e8", 13, 14, 1, 2);
      px(ctx, "#ffffff", 9, 13, 2, 2);
      wet(ctx, 25, 27);
      return;
    }
    case "ship_anchor": {
      // A little iron anchor, a ring at the top, flukes curling up.
      disc(ctx, O, 16, 5, 4);
      disc(ctx, "#5a6470", 16, 5, 3);
      disc(ctx, O, 16, 5, 1);
      px(ctx, O, 14, 8, 5, 19);
      px(ctx, "#6e7a88", 15, 9, 3, 17);
      px(ctx, O, 8, 11, 17, 4);
      px(ctx, "#6e7a88", 9, 12, 15, 2);
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.15 + (i / 8) * 0.7);
        px(ctx, O, Math.round(16 + Math.cos(a) * 11) - 1, Math.round(17 + Math.sin(a) * 9) - 1, 4, 4);
        px(ctx, "#6e7a88", Math.round(16 + Math.cos(a) * 11), Math.round(17 + Math.sin(a) * 9), 2, 2);
      }
      polygon(ctx, O, [[2, 19], [7, 23], [4, 25]]);
      polygon(ctx, O, [[30, 19], [25, 23], [28, 25]]);
      px(ctx, "#a0522d", 15, 18, 3, 3);
      px(ctx, "#5aa04a", 18, 24, 4, 2);
      px(ctx, "#5aa04a", 20, 22, 1, 2);
      return;
    }
    case "old_safe": {
      // A squat iron safe: a dial, a brass handle, rust and weed.
      px(ctx, O, 4, 5, 24, 23);
      px(ctx, "#4a5260", 5, 6, 22, 21);
      px(ctx, "#5e6878", 5, 6, 22, 3);
      px(ctx, O, 8, 10, 16, 14);
      px(ctx, "#3a404c", 9, 11, 14, 12);
      disc(ctx, O, 14, 17, 4);
      disc(ctx, "#c8c8d4", 14, 17, 3);
      px(ctx, O, 14, 14, 1, 3);
      px(ctx, "#f6c343", 20, 15, 2, 5);
      px(ctx, O, 6, 27, 4, 2);
      px(ctx, O, 22, 27, 4, 2);
      px(ctx, "#a0522d", 23, 7, 3, 3);
      px(ctx, "#8b3a1a", 6, 22, 2, 4);
      px(ctx, "#5aa04a", 4, 4, 5, 2);
      px(ctx, "#5aa04a", 6, 6, 1, 4);
      px(ctx, "#ffe14f", 26, 3, 1, 3);
      px(ctx, "#ffe14f", 25, 4, 3, 1);
      return;
    }
    case "meteorite": {
      // A lump of star-iron: dark, pitted, glowing seams of blue and violet.
      polygon(ctx, O, [[6, 12], [12, 5], [22, 4], [28, 11], [27, 22], [19, 28], [9, 27], [4, 20]]);
      polygon(ctx, "#3a3448", [[7, 12], [12, 6], [22, 5], [27, 11], [26, 21], [19, 27], [9, 26], [5, 20]]);
      polygon(ctx, "#4e4660", [[9, 11], [13, 7], [21, 7], [24, 11], [18, 14], [11, 15]]);
      for (const [x, y, r] of [[12, 19, 2], [21, 18, 2], [17, 11, 1], [10, 13, 1]] as [number, number, number][]) disc(ctx, "#241f30", x, y, r);
      px(ctx, "#7ad8ff", 14, 14, 6, 1);
      px(ctx, "#7ad8ff", 19, 15, 1, 5);
      px(ctx, "#c49bff", 19, 20, 4, 1);
      px(ctx, "#c49bff", 9, 22, 5, 1);
      px(ctx, "#ffffff", 15, 14, 2, 1);
      px(ctx, "#ffffff", 2, 4, 1, 3);
      px(ctx, "#ffffff", 1, 5, 3, 1);
      px(ctx, "#c49bff", 29, 26, 1, 1);
      return;
    }
    default: {
      disc(ctx, O, 16, 16, 9);
      disc(ctx, "#7a7a88", 16, 16, 8);
    }
  }
}
