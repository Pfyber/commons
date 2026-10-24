// The roulette table in the room (ADR 0017), for everyone in the casino to
// see, not only whoever has its window open: the chips on the felt in each
// player's colour, the ball racing round the wheel while it spins, and the
// croupier calling the game ("Place your bets!", "No more bets!", "17, red!").
// Winners get a cheer over their heads.

import { Graphics } from "pixi.js";
import { type Tables, type WheelState, playersOf, pocketColour } from "../ui/casino";
import type { RouletteBet } from "../ui/casino";
import type { MapObject } from "./map";
import type { Scene } from "./scene";

const TILE = 32;
/** The table's art (casinoart `roulette_table`): drawn `OVERHANG` px above its tiles. */
const OVERHANG = 16;

export interface RouletteHooks {
  /** The croupier says something. */
  say(text: string): void;
  /** Someone won: a cheer over their head. */
  cheer(name: string, coins: number): void;
}

/** Where on the table's art (px from its top-left) a bet's chips sit. */
function spotOf(b: RouletteBet): { x: number; y: number } {
  switch (b.on) {
    case "number": {
      if (b.n === 0) return { x: 84, y: 50 };
      const k = Math.floor((b.n - 1) / 3);
      const r = 2 - ((b.n - 1) % 3);
      return { x: 90 + k * 13 + 6, y: 20 + r * 20 + 9 };
    }
    case "dozen":
      return { x: 90 + (b.n - 1) * 52 + 26, y: 87 };
    default: {
      const i = ["low", "even", "red", "black", "odd", "high"].indexOf(b.on);
      return { x: 90 + i * 26 + 13, y: 96 };
    }
  }
}

export class RouletteFx {
  private g = new Graphics();
  private ox: number;
  private oy: number;
  /** What the table last looked like, to call what's changed. */
  private phase: WheelState["phase"] | null = null;
  private lands = 0;
  private lastCall = false;
  private off: () => void;

  constructor(
    scene: Scene,
    private table: MapObject,
    private tables: Tables,
    private hooks: RouletteHooks,
  ) {
    this.ox = table.x * TILE;
    this.oy = table.y * TILE - OVERHANG;
    this.g.zIndex = (table.y + table.h) * TILE + 0.4;
    scene.sorted.addChild(this.g);
    this.off = tables.onChange(() => this.changed());
    this.changed(true);
  }

  /** The croupier calls whatever just happened at the table. */
  private changed(quiet = false) {
    const w = this.tables.floor?.roulette;
    if (!w) return;
    const was = this.phase;
    this.phase = w.phase;
    if (quiet || was === null) {
      this.lands = w.lands ?? 0;
      return;
    }
    if (w.phase === "betting" && was !== "betting") {
      this.lastCall = false;
      this.hooks.say("Place your bets, please!");
    }
    if (w.phase === "spinning" && (was !== "spinning" || w.lands !== this.lands)) {
      this.lands = w.lands ?? 0;
      this.hooks.say("No more bets!");
    }
    if (was === "spinning" && w.phase !== "spinning" && w.last) {
      const n = w.last.number;
      const won = w.last.winners;
      const call = n === 0 ? "Zero, green!" : `${n}, ${pocketColour(n)}!`;
      this.hooks.say(won.length ? `${call} ${won.map((x) => `${x.name} wins ${x.coins}`).join(", ")}!` : `${call} The house thanks you.`);
      for (const x of won) this.hooks.cheer(x.name, x.coins);
    }
  }

  update() {
    const serverNow = this.tables.now();
    const g = this.g.clear();
    const w = this.tables.floor?.roulette;
    if (!w) return;
    if (w.phase === "betting" && w.closes && !this.lastCall && w.closes - serverNow < 5000) {
      this.lastCall = true;
      this.hooks.say("Last bets…");
    }
    // Everyone's chips on the felt, in their colours: a little stack per bet.
    const colour = new Map(playersOf(w).map((p) => [p.id, p.color]));
    const piles = new Map<string, number>();
    for (const c of w.chips) {
      const at = spotOf(c.bet);
      const key = `${at.x},${at.y}`;
      const n = piles.get(key) ?? 0;
      piles.set(key, n + 1);
      const x = this.ox + at.x + (n % 3) * 2 - 2;
      const y = this.oy + at.y - Math.min(n, 5) * 2;
      g.circle(x, y, 4).fill({ color: 0x3b3a2e });
      g.circle(x, y - 1, 3).fill({ color: colour.get(c.player) ?? "#ffffff" });
    }
    // The ball round the wheel: racing while it spins, then settling.
    const cx = this.ox + 48;
    const cy = this.oy + (this.table.h * TILE + OVERHANG) / 2 - 2;
    if (w.phase === "spinning" && w.lands) {
      const left = Math.max(0, w.lands - serverNow);
      const a = (left / 1000) ** 1.6 * 9 + serverNow / 900;
      const r = 20 - Math.min(6, (5000 - Math.min(5000, left)) / 900);
      g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.2).fill({ color: 0xfff8e3 });
      // The wheel's a blur of red and black.
      for (let i = 0; i < 6; i++) {
        const s = -serverNow / 120 + (i * Math.PI) / 3;
        g.moveTo(cx, cy).lineTo(cx + Math.cos(s) * 24, cy + Math.sin(s) * 24).stroke({ color: i % 2 ? 0xc8553d : 0x2b2723, width: 2, alpha: 0.5 });
      }
    } else if (w.last) {
      // The ball resting in the pocket that came up, and its number on a marker.
      g.circle(cx + 14, cy - 12, 2.2).fill({ color: 0xfff8e3 });
      const fill = pocketColour(w.last.number) === "red" ? 0xc8553d : pocketColour(w.last.number) === "green" ? 0x2f8f4f : 0x2b2723;
      g.roundRect(cx - 9, this.oy - 2, 18, 12, 2).fill({ color: 0x3b3a2e });
      g.roundRect(cx - 8, this.oy - 1, 16, 10, 2).fill({ color: fill });
      this.number(g, String(w.last.number), cx, this.oy + 4);
    }
  }

  /** A tiny number in pixels (3×5 digits), centred on (x, y). */
  private number(g: Graphics, s: string, x: number, y: number) {
    const DIGITS: Record<string, string> = {
      "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
      "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
    };
    const w = s.length * 4 - 1;
    let x0 = Math.round(x - w / 2);
    for (const ch of s) {
      const bits = DIGITS[ch] ?? "";
      for (let i = 0; i < 15; i++) if (bits[i] === "1") g.rect(x0 + (i % 3), Math.round(y - 2) + Math.floor(i / 3), 1, 1).fill({ color: 0xfff8e3 });
      x0 += 4;
    }
  }

  destroy() {
    this.off();
    this.g.destroy();
  }
}
