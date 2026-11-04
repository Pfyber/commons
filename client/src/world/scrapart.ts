// What the magnet brings up from the bottom of the pond, at 32×32 like the
// fish: cans, chains and forks, keys and padlocks, compasses and lanterns,
// a diver's helmet and a ship's wheel, an old safe, a golden idol, a sunken
// crown and (once in a long while) a meteorite, the sea-god's trident or the
// kraken's pearl. Each with a little silt and rust about it.

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
    case "bent_fork": {
      // A dull fork, its handle bent, one tine snapped short.
      polygon(ctx, O, [[5, 25], [14, 17], [18, 20], [8, 29]]);
      polygon(ctx, "#a8a8b4", [[6, 25], [14, 18], [17, 20], [8, 28]]);
      px(ctx, O, 12, 14, 12, 7);
      px(ctx, "#b8b8c4", 13, 15, 10, 5);
      px(ctx, "#ffffff", 14, 15, 5, 1);
      for (const [x, top] of [[13, 5], [17, 5], [21, 9]]) {
        px(ctx, O, x - 1, top - 1, 4, 16 - top);
        px(ctx, "#c8c8d4", x, top, 2, 15 - top);
      }
      px(ctx, "#a0522d", 9, 24, 3, 2);
      wet(ctx, 22, 24);
      return;
    }
    case "bottle_cap": {
      // A crimped crown cap, squashed a little, its paint flaking.
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        disc(ctx, O, 16 + Math.cos(a) * 10, 16 + Math.sin(a) * 9, 2);
      }
      oval(ctx, "#c23a34", 16, 16, 10, 9);
      oval(ctx, "#e0584a", 15, 15, 7, 6);
      oval(ctx, "#f4e7c8", 15, 15, 3, 3);
      px(ctx, "#b8b8c4", 21, 19, 3, 2);
      px(ctx, "#a0522d", 9, 19, 3, 2);
      px(ctx, "#ffffff", 10, 10, 3, 1);
      wet(ctx, 24, 25);
      return;
    }
    case "padlock": {
      // A heavy padlock, its shackle rusted shut.
      oval(ctx, O, 16, 11, 8, 8);
      oval(ctx, "#8a8a96", 16, 11, 7, 7);
      oval(ctx, O, 16, 12, 4, 5);
      px(ctx, O, 6, 13, 20, 15);
      px(ctx, "#a0522d", 7, 14, 18, 13);
      px(ctx, "#c97a3a", 7, 14, 18, 3);
      px(ctx, "#8b3a1a", 18, 21, 6, 5);
      disc(ctx, O, 16, 20, 2);
      px(ctx, O, 15, 21, 2, 4);
      wet(ctx, 9, 28);
      return;
    }
    case "horseshoe": {
      // A worn iron horseshoe, nail holes and all, open end up for luck.
      const on = (x: number, y: number) => {
        const dx = x + 0.5 - 16;
        if (y < 15) return y >= 5 && Math.abs(dx) >= 6 && Math.abs(dx) <= 11;
        const dy = y + 0.5 - 15;
        return (dx / 11) ** 2 + (dy / 11.5) ** 2 <= 1 && (dx / 6) ** 2 + (dy / 6.5) ** 2 >= 1;
      };
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          if (!on(x, y)) continue;
          const rim = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
          px(ctx, rim ? O : x < 10 || y > 22 ? "#aab2be" : "#7f8794", x, y);
        }
      for (const [x, y] of [[7, 9], [7, 15], [24, 9], [24, 15], [12, 23], [19, 23]]) px(ctx, O, x, y, 1, 2);
      wet(ctx, 24, 27);
      return;
    }
    case "brass_bell": {
      // A little ship's bell, green about the rim.
      px(ctx, O, 14, 3, 4, 4);
      px(ctx, "#b98a3a", 15, 4, 2, 3);
      polygon(ctx, O, [[11, 7], [21, 7], [24, 22], [27, 25], [5, 25], [8, 22]]);
      polygon(ctx, "#d6a64a", [[12, 8], [20, 8], [23, 22], [25, 24], [7, 24], [9, 22]]);
      polygon(ctx, "#f2d27a", [[13, 9], [16, 9], [14, 22], [11, 22]]);
      px(ctx, "#5f9a7a", 7, 23, 8, 1);
      px(ctx, "#5f9a7a", 20, 23, 5, 1);
      disc(ctx, O, 16, 27, 2);
      disc(ctx, "#b98a3a", 16, 27, 1);
      return;
    }
    case "brass_compass": {
      // A brass compass, glass still whole, the needle still swinging north.
      px(ctx, O, 14, 2, 4, 4);
      px(ctx, "#d6a64a", 15, 3, 2, 3);
      disc(ctx, O, 16, 17, 12);
      disc(ctx, "#d6a64a", 16, 17, 11);
      disc(ctx, O, 16, 17, 9);
      disc(ctx, "#f4ecd4", 16, 17, 8);
      for (const [x, y] of [[16, 10], [16, 24], [9, 17], [23, 17]]) px(ctx, "#6e5a3a", x, y, 1, 1);
      polygon(ctx, "#d83a3a", [[19, 11], [17, 17], [15, 16]]);
      polygon(ctx, "#4a5a78", [[13, 23], [15, 16], [17, 17]]);
      px(ctx, "#ffd76a", 16, 17, 1, 1);
      px(ctx, "#ffffff", 10, 12, 3, 1);
      return;
    }
    case "oil_lantern": {
      // A ship's lantern, its glass clouded, a little oil left in it.
      px(ctx, O, 12, 2, 8, 2);
      px(ctx, O, 10, 4, 12, 4);
      px(ctx, "#7a6a4a", 11, 5, 10, 2);
      px(ctx, O, 9, 8, 14, 15);
      px(ctx, "#bfe2d8", 10, 9, 12, 13);
      px(ctx, "#e8f6ee", 11, 10, 3, 9);
      px(ctx, "#6f9a84", 18, 15, 4, 7);
      px(ctx, O, 15, 9, 2, 13);
      disc(ctx, "#ffb84a", 16, 18, 2);
      px(ctx, "#fff0b0", 16, 17, 1, 2);
      px(ctx, O, 8, 23, 16, 5);
      px(ctx, "#a0522d", 9, 24, 14, 3);
      px(ctx, "#c97a3a", 9, 24, 14, 1);
      wet(ctx, 25, 25);
      return;
    }
    case "diving_helmet": {
      // A copper diver's helmet, its round window dark, bolts round the collar.
      disc(ctx, O, 16, 14, 12);
      disc(ctx, "#c8793a", 16, 14, 11);
      oval(ctx, "#e8a860", 12, 8, 5, 3);
      disc(ctx, O, 16, 15, 7);
      disc(ctx, "#d6a64a", 16, 15, 6);
      disc(ctx, "#1f3a4a", 16, 15, 5);
      px(ctx, "#7ad8ff", 13, 12, 3, 1);
      px(ctx, "#7ad8ff", 13, 13, 1, 2);
      px(ctx, O, 5, 24, 22, 5);
      px(ctx, "#a0622d", 6, 25, 20, 3);
      for (const x of [8, 13, 18, 23]) px(ctx, "#ffe08a", x, 26, 2, 1);
      px(ctx, "#5f9a7a", 22, 7, 3, 2);
      return;
    }
    case "ship_wheel": {
      // A ship's wheel: dark spokes, handles round the rim, brass at the hub.
      disc(ctx, O, 16, 16, 12);
      disc(ctx, "#8a5a32", 16, 16, 11);
      disc(ctx, "#3a2a1a", 16, 16, 8);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        for (let r = 2; r < 9; r++) px(ctx, "#b07a44", Math.round(16 + Math.cos(a) * r), Math.round(16 + Math.sin(a) * r), 2, 2);
        const hx = 16 + Math.cos(a) * 13;
        const hy = 16 + Math.sin(a) * 13;
        disc(ctx, O, hx, hy, 2);
        disc(ctx, "#b07a44", hx, hy, 1);
      }
      disc(ctx, O, 16, 16, 3);
      disc(ctx, "#f2c94c", 16, 16, 2);
      px(ctx, "#fff3a8", 15, 15, 1, 1);
      return;
    }
    case "gold_idol": {
      // A squat golden idol: great round head, ruby eyes, arms folded.
      px(ctx, O, 7, 26, 18, 3);
      px(ctx, "#a8781f", 8, 26, 16, 2);
      polygon(ctx, O, [[10, 15], [22, 15], [25, 26], [7, 26]]);
      polygon(ctx, "#e0ac32", [[11, 16], [21, 16], [24, 25], [8, 25]]);
      px(ctx, "#a8781f", 11, 20, 10, 2);
      disc(ctx, O, 16, 10, 8);
      disc(ctx, "#f2c94c", 16, 10, 7);
      oval(ctx, "#fff3a8", 13, 7, 3, 2);
      px(ctx, "#e8233a", 12, 10, 2, 2);
      px(ctx, "#e8233a", 18, 10, 2, 2);
      px(ctx, "#a8781f", 13, 14, 6, 1);
      px(ctx, "#ffffff", 3, 8, 1, 3);
      px(ctx, "#ffffff", 2, 9, 3, 1);
      return;
    }
    case "sunken_crown": {
      // A king's crown: gold under the weed, its jewels still bright.
      polygon(ctx, O, [[4, 8], [10, 15], [16, 5], [22, 15], [28, 8], [26, 26], [6, 26]]);
      polygon(ctx, "#f2c94c", [[5, 11], [10, 17], [16, 7], [22, 17], [27, 11], [25, 25], [7, 25]]);
      polygon(ctx, "#fff3a8", [[8, 14], [10, 18], [13, 13], [12, 22], [8, 22]]);
      px(ctx, "#a8781f", 7, 21, 18, 4);
      for (const [x, c] of [[10, "#e8233a"], [15, "#3ad0e8"], [20, "#54d17a"]] as [number, string][]) {
        px(ctx, O, x - 1, 21, 4, 4);
        px(ctx, c, x, 22, 2, 2);
      }
      disc(ctx, "#e8233a", 16, 6, 2);
      px(ctx, "#5aa04a", 22, 23, 5, 2);
      px(ctx, "#5aa04a", 25, 25, 2, 3);
      return;
    }
    case "sea_trident": {
      // The sea-god's trident, slanting, sea-glow running along its tines.
      for (let i = 0; i < 20; i++) {
        px(ctx, O, 3 + i, 28 - i, 3, 3);
      }
      for (let i = 0; i < 18; i++) px(ctx, "#2f9a9a", 4 + i, 28 - i, 1, 1);
      polygon(ctx, O, [[16, 10], [20, 16], [28, 2], [22, 12]]);
      polygon(ctx, O, [[14, 3], [13, 13], [20, 16], [18, 11]]);
      polygon(ctx, O, [[29, 14], [20, 11], [22, 17], [27, 15]]);
      polygon(ctx, "#f2c94c", [[27, 3], [21, 12], [20, 15], [19, 13]]);
      polygon(ctx, "#7ae8d8", [[15, 4], [14, 12], [18, 13]]);
      polygon(ctx, "#7ae8d8", [[28, 14], [21, 12], [21, 15]]);
      px(ctx, "#ffffff", 26, 5, 1, 1);
      px(ctx, "#ffffff", 8, 9, 1, 3);
      px(ctx, "#ffffff", 7, 10, 3, 1);
      px(ctx, "#7ae8d8", 25, 25, 1, 1);
      return;
    }
    case "kraken_pearl": {
      // A great black pearl, gripped in a sucker-ringed tentacle, glowing.
      disc(ctx, "#5a2a78", 16, 14, 12);
      disc(ctx, O, 16, 14, 10);
      disc(ctx, "#3a3060", 16, 14, 9);
      oval(ctx, "#7a5ab8", 14, 11, 6, 5);
      oval(ctx, "#c49bff", 12, 9, 3, 2);
      px(ctx, "#ffffff", 11, 8, 2, 1);
      polygon(ctx, O, [[3, 25], [10, 19], [18, 22], [27, 17], [29, 21], [19, 29], [9, 27], [5, 29]]);
      polygon(ctx, "#b0486a", [[5, 25], [10, 20], [18, 23], [27, 18], [28, 20], [19, 28], [9, 26]]);
      for (const [x, y] of [[9, 23], [14, 24], [19, 25], [24, 21]]) {
        px(ctx, "#f2a8bc", x, y, 2, 2);
        px(ctx, "#7a2a4a", x, y + 1, 1, 1);
      }
      px(ctx, "#c49bff", 28, 5, 1, 3);
      px(ctx, "#c49bff", 27, 6, 3, 1);
      return;
    }
    default: {
      disc(ctx, O, 16, 16, 9);
      disc(ctx, "#7a7a88", 16, 16, 8);
    }
  }
}
