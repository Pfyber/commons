// The leaderboard signs' top five, written on their parchment (the boards
// themselves are art.ts's `leaderboard`): "1. MANCI 250K$" and so on, the
// first in gold, rewritten whenever the rankings come in fresh.

import { Sprite, type Texture } from "pixi.js";
import { LEADER_SIGN, TILE, leaderKind, toTexture } from "./art";
import type { MapObject } from "./map";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";
import type { Scene } from "./scene";
import type { Boards, BoardKey } from "../ui/leaderboard";

/** The writing's pixels: this many to the sign's one (finer than the board's own). */
const FINE = 2;

/** A number, short: 950, 12K, 3.4M. */
export function short(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") : Math.floor(n / 1000)}K`;
  return `${n < 10_000_000 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") : Math.floor(n / 1e6)}M`;
}

/** How a board's value reads on a sign (coins with a $). */
export function signValue(key: BoardKey, n: number): string {
  return key === "coins" ? `${short(n)}$` : short(n);
}

export class LeaderSigns {
  private signs: { o: MapObject; key: BoardKey; sprite: Sprite; tex: Texture | null }[] = [];
  private shown = "";

  constructor(scene: Scene, objects: MapObject[]) {
    for (const o of objects.filter((o) => o.kind === "leaderboard")) {
      const sprite = new Sprite();
      sprite.position.set(o.x * TILE + LEADER_SIGN.textX, o.y * TILE - LEADER_SIGN.overhang + LEADER_SIGN.textY);
      sprite.zIndex = (o.y + o.h) * TILE - 0.5;
      sprite.scale.set(1 / FINE);
      scene.sorted.addChild(sprite);
      this.signs.push({ o, key: leaderKind(o.label ?? ""), sprite, tex: null });
    }
  }

  get any(): boolean {
    return this.signs.length > 0;
  }

  /** Writes each sign's top five (if the rankings changed since). */
  update(boards: Boards | null) {
    const key = boards ? JSON.stringify(Object.values(boards).map((b) => b.top.slice(0, 5))) : "";
    if (!boards || key === this.shown) return;
    this.shown = key;
    for (const s of this.signs) {
      // Drawn at twice the sign's resolution (finer pixels), shown at half size.
      const c = document.createElement("canvas");
      c.width = LEADER_SIGN.textW * FINE;
      c.height = LEADER_SIGN.textH * FINE;
      const ctx = c.getContext("2d")!;
      const write = (text: string, x: number, y: number, color: string) => {
        drawPixelText(ctx, text, x + 1, y + 1, "#2a1a0e", 1);
        drawPixelText(ctx, text, x, y, color, 1);
      };
      const top = boards[s.key]?.top ?? [];
      if (!top.length) write("NO ONE YET", Math.floor((c.width - pixelWidth("NO ONE YET")) / 2), Math.floor(c.height / 2) - 3, "#fff3d6");
      top.slice(0, 5).forEach((e, i) => {
        const y = 4 + i * LEADER_SIGN.rowH * FINE;
        const color = i === 0 ? "#ffd23f" : "#fff3d6";
        const rank = `${e.rank}.`;
        const value = signValue(s.key, e.value);
        const room = c.width - pixelWidth(rank) - pixelWidth(value) - 10;
        // The name: what the pixel font can write of it, cut to fit.
        let name = [...e.name.toUpperCase()].filter((ch) => canPixel(ch)).join("");
        while (name && pixelWidth(name) > room) name = name.slice(0, -1);
        write(rank, 2, y, color);
        write(name, 2 + pixelWidth(rank) + 3, y, color);
        write(value, c.width - pixelWidth(value) - 3, y, color);
      });
      s.tex?.destroy(true);
      s.tex = toTexture(c);
      s.sprite.texture = s.tex;
    }
  }

  destroy() {
    for (const s of this.signs) {
      s.sprite.destroy();
      s.tex?.destroy(true);
    }
    this.signs = [];
  }
}
