// The bowling alley itself, for everyone there to see: each lane's pins as
// they stand in its game, and the balls. A ball leaves the bowler's hand at
// the foot of the lane, rolls up it and crashes into the pins: those it
// knocked tumble away in a burst of white, and the rest stay standing until
// the next ball (or a fresh rack).

import { Container, Graphics, Sprite } from "pixi.js";
import { TILE, lanePinSpot, toTexture } from "./art";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";
import type { MapObject } from "./map";
import type { Scene } from "./scene";

/**
 * A ball's trip up the lane, and its pins' fall: much quicker the harder it was
 * bowled (`power` 0–1): a crawl when soft, a blur at full power. The
 * lane panel uses the same, so both agree.
 */
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
/** On a curve, so the gap shows all the way up: 3.4 s for the softest roll down to 0.55 s at full power. */
export const rollMs = (power: number) => Math.round(550 * (3400 / 550) ** (1 - clamp01(power)));
export const fallMs = (power: number) => Math.round(280 * (1300 / 280) ** (1 - clamp01(power)));
/** After the ball gets there, how long the lane stays as it was left before the next rack. */
export const SETTLE_MS = 1300;
const TUMBLE_MS = 500;
const ALL = 0x3ff;
/** Pin index → (row, k) on the deck, row 0 the head pin. */
const PIN_ROWS: [number, number][] = [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2], [3, 3]];

interface Ball {
  root: Container;
  ball: Graphics;
  from: { x: number; y: number };
  to: { x: number; y: number };
  start: number;
  /** How long it takes up the lane. */
  ms: number;
}

interface Lane {
  obj: MapObject;
  pins: Graphics;
  /** The pins drawn standing, and those tumbling away (since when). */
  standing: number;
  tumbling: { mask: number; at: number } | null;
  /** A ball on its way: it lands at `at`, knocking `knocked`; the rack to show after (if one came meanwhile). */
  inFlight: { at: number; knocked: number } | null;
  next: number | null;
  /** Until when what's left stays up for all to see (hit or miss), before the next rack. */
  settleUntil: number;
  /** The screen over the lane: who's playing and their scores (and what it last said). */
  board: Sprite;
  boardKey: string;
}

export class LaneBalls {
  private balls: Ball[] = [];
  private lanes = new Map<MapObject, Lane>();

  constructor(private scene: Scene) {}

  private lane(obj: MapObject): Lane {
    let l = this.lanes.get(obj);
    if (!l) {
      const pins = new Graphics();
      // Just above the lane, under anyone standing at its foot.
      pins.zIndex = (obj.y + obj.h) * TILE - 0.5;
      this.scene.sorted.addChild(pins);
      const board = new Sprite();
      // On the lane's screen (drawn on the back wall, above its top tile).
      board.position.set(obj.x * TILE + 8, obj.y * TILE - 38);
      board.zIndex = pins.zIndex + 0.1;
      this.scene.sorted.addChild(board);
      l = { obj, pins, standing: ALL, tumbling: null, inFlight: null, next: null, settleUntil: 0, board, boardKey: "" };
      this.lanes.set(obj, l);
      this.paint(l, performance.now());
    }
    return l;
  }

  /** How `lane`'s pins stand now (from its game). Mid-roll, it waits for the ball to get there. */
  setStanding(obj: MapObject, standing: number) {
    const l = this.lane(obj);
    if (l.inFlight || performance.now() < l.settleUntil) l.next = standing;
    else if (standing !== l.standing) {
      l.standing = standing;
      this.paint(l, performance.now());
    }
  }

  /**
   * What the screen over `lane` shows: a line or two (each in its colour),
   * e.g. each bowler's name and score, the one up in yellow.
   */
  setBoard(obj: MapObject, lines: { text: string; color: string }[]) {
    const l = this.lane(obj);
    const key = lines.map((x) => x.color + x.text).join("|");
    if (key === l.boardKey) return;
    l.boardKey = key;
    const w = obj.w * TILE - 16;
    const h = 26;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    // Cover the painted "LANE n" with the screen's own glass.
    ctx.fillStyle = "#1a1030";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(63,224,255,0.22)";
    ctx.fillRect(2, 2, w - 4, h - 4);
    const top = lines.length === 1 ? 10 : 5;
    lines.slice(0, 2).forEach((line, i) => {
      // Only what the pixel font has; cut to fit.
      let t = [...line.text.toUpperCase()].filter((ch) => canPixel(ch)).join("").trim();
      while (t.length > 1 && pixelWidth(t) > w - 6) t = t.slice(0, -1);
      drawPixelText(ctx, t, Math.round((w - pixelWidth(t)) / 2), top + i * 9, line.color);
    });
    l.board.texture = toTexture(c);
  }

  /** A ball down `lane` towards `aim` (-1 to 1 across it), from `start` (wall clock), knocking `knocked` pins. */
  roll(obj: MapObject, aim: number, knocked: number, start: number, power: number) {
    const l = this.lane(obj);
    const ms = rollMs(power);
    l.inFlight = { at: start + ms, knocked };
    const root = new Container();
    root.zIndex = 1e9;
    const ball = new Graphics().circle(0, 0, 4).fill({ color: 0x3f5fd0 }).circle(-1, -1, 1).fill({ color: 0x8fa8ff });
    ball.visible = false;
    root.addChild(ball);
    this.scene.world.addChild(root);
    const mid = (obj.x + obj.w / 2) * TILE;
    const half = (obj.w * TILE) / 2 - 18;
    // From the middle of the foul line, on a diagonal out to where it meets the pins.
    this.balls.push({ root, ball, from: { x: mid, y: (obj.y + obj.h) * TILE - 8 }, to: { x: mid + aim * half, y: obj.y * TILE + 34 }, start, ms });
  }

  update(wallNow: number) {
    this.balls = this.balls.filter((b) => {
      const t = wallNow - b.start;
      if (t < 0) return true;
      if (t > b.ms) {
        b.root.destroy({ children: true });
        return false;
      }
      const k = t / b.ms;
      b.ball.visible = true;
      b.ball.position.set(b.from.x + (b.to.x - b.from.x) * k, b.from.y + (b.to.y - b.from.y) * k);
      return true;
    });
    for (const l of this.lanes.values()) {
      // The ball's there: down go the pins it hit.
      if (l.inFlight && wallNow >= l.inFlight.at) {
        const hit = l.inFlight.knocked & l.standing;
        l.standing &= ~hit;
        l.tumbling = hit ? { mask: hit, at: wallNow } : null;
        l.inFlight = null;
        // Hit or miss, what's left stays up a while for everyone to see.
        l.settleUntil = wallNow + TUMBLE_MS + SETTLE_MS;
      }
      if (l.tumbling && wallNow - l.tumbling.at > TUMBLE_MS) l.tumbling = null;
      // Then the rack as the game has it now.
      if (!l.inFlight && wallNow >= l.settleUntil && l.next !== null) {
        l.standing = l.next;
        l.next = null;
      }
      this.paint(l, wallNow);
    }
  }

  /** The pins from above: white with a red head; tumbling ones fly off and fade. */
  private paint(l: Lane, now: number) {
    const g = l.pins.clear();
    const ox = l.obj.x * TILE;
    const oy = l.obj.y * TILE;
    const w = l.obj.w * TILE;
    for (let i = 0; i < 10; i++) {
      const [row, k] = PIN_ROWS[i];
      const p = lanePinSpot(w, row, k);
      let x = ox + p.x;
      let y = oy + p.y;
      let a = 1;
      if (l.tumbling && l.tumbling.mask & (1 << i)) {
        // Knocked: thrown back and out, spinning off the deck.
        const f = Math.min(1, (now - l.tumbling.at) / TUMBLE_MS);
        if (f >= 1) continue;
        const side = k - row / 2 || (i % 2 ? 0.5 : -0.5);
        x += side * 10 * f;
        y -= 10 * f;
        a = 1 - f;
      } else if (!(l.standing & (1 << i))) continue;
      g.rect(Math.round(x) - 4, Math.round(y) - 4, 8, 8).fill({ color: 0x1a1020, alpha: a });
      g.rect(Math.round(x) - 3, Math.round(y) - 3, 6, 6).fill({ color: 0xf4f1e8, alpha: a });
      g.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2).fill({ color: 0xe8566b, alpha: a });
    }
    // Sparks where they went.
    if (l.tumbling) {
      const f = Math.min(1, (now - l.tumbling.at) / TUMBLE_MS);
      const cx = ox + w / 2;
      const cy = oy + 28;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + 0.3;
        const r = 4 + f * 16;
        g.rect(Math.round(cx + Math.cos(ang) * r) - 1, Math.round(cy + Math.sin(ang) * r * 0.7) - 1, 3, 3).fill({ color: 0xffffff, alpha: 1 - f });
      }
    }
  }

  destroy() {
    for (const b of this.balls) b.root.destroy({ children: true });
    for (const l of this.lanes.values()) {
      l.pins.destroy();
      l.board.destroy();
    }
    this.balls = [];
    this.lanes.clear();
  }
}
