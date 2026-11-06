// The little scorpions: what they look like doing what the server says they're
// doing. Each creeps out from behind a gift left too long, comes round, hooks
// it with its tail and tugs it free, then hauls it about the sand on a line,
// the gift bumping along behind and scoring the sand, until somebody swats it
// and it flips on its back, legs waving, and fades.

import { Graphics, Sprite, type Container, type Texture } from "pixi.js";
import * as dfx from "../ambient/disasterfx";
import { drawThief, hookAt, type ThiefPose } from "../world/thiefart";

/** As `arena::lion`. */
const ACT = { PROWL: 1, RECOVER: 4, DEAD: 5, SNEAK: 7, SNATCH: 8, RUSH: 9, BURROW: 10 };
/** As `arena::THIEF_PEEK_MS`, `THIEF_SNATCH_MS`, `THIEF_BURROW_MS`, `LION_GONE_MS`. */
export const THIEF_PEEK_MS = 800;
export const THIEF_SNATCH_MS = 650;
export const THIEF_BURROW_MS = 500;
const GONE_MS = 1800;
/** How long the line it hauls on is (px), and how big it draws. */
const LINE = 20;
const SCALE = 1;
/** Its middle, above the sand (it turns over about that). */
const MID = 5;
const MARK_MS = 2600;

export interface ThiefHost {
  wx(x: number): number;
  wy(y: number): number;
  sorted: Container;
  dust(x: number, y: number, n: number): void;
  near(x: number, y: number): number;
  giftTex(kind: number): Texture;
  light(x: number, y: number, tint: number, sx: number, sy: number, alpha: number): void;
}

export interface ThiefTold {
  id: number;
  x: number;
  y: number;
  aim: number;
  act: number;
  item: number;
  toX: number;
  toY: number;
}

interface View {
  g: Graphics;
  /** Where it is (tiles), and the gift it's after. */
  x: number;
  y: number;
  gift: { x: number; y: number };
  face: 1 | -1;
  turn: number;
  act: number;
  /** When it began what it's doing. */
  at: number;
  pose: ThiefPose;
  /** What it's hauling, and where (px); how far it's been hauled. */
  item: Sprite | null;
  ix: number;
  iy: number;
  hauled: number;
  /** It's just stung someone, and leapt. */
  leapt: number;
  skitter: number;
  goneAt: number;
}

export class ThiefShow {
  private views = new Map<number, View>();
  /** The scores it leaves in the sand. */
  private marks: { x: number; y: number; at: number }[] = [];

  constructor(private host: ThiefHost) {}

  /** A gift's little shiver, with something at it (px). */
  trembles(x: number, y: number, now: number): number {
    for (const v of this.views.values()) {
      if (Math.abs(v.gift.x - x) > 0.01 || Math.abs(v.gift.y - y) > 0.01) continue;
      if (v.act === ACT.SNATCH) return Math.round(Math.sin(now / 22) * 2);
      if (v.act === ACT.SNEAK && now - v.at > 300) return Math.round(Math.sin(now / 40) * 0.7);
    }
    return 0;
  }

  stung(id: number, now: number) {
    const v = this.views.get(id);
    if (v) v.leapt = now;
  }

  /** Every frame, for each that's about. */
  show(l: ThiefTold, now: number, dt: number) {
    const { wx, wy } = this.host;
    let v = this.views.get(l.id);
    if (!v) {
      const g = new Graphics();
      this.host.sorted.addChild(g);
      v = {
        g,
        x: l.x,
        y: l.y,
        gift: { x: l.toX, y: l.toY },
        face: Math.cos(l.aim) >= 0 ? 1 : -1,
        turn: 0,
        act: l.act,
        at: now,
        pose: { step: 0, tail: 0, snap: 0, rear: 0, lash: 0 },
        item: null,
        ix: 0,
        iy: 0,
        hauled: 0,
        leapt: 0,
        skitter: 0,
        goneAt: 0,
      };
      this.views.set(l.id, v);
    }
    v.goneAt = 0;
    if (l.act !== v.act) {
      if (l.act === ACT.BURROW) this.host.dust(l.x, l.y, 8);
      v.act = l.act;
      v.at = now;
    }
    const since = now - v.at;
    const px = v.x;
    const py = v.y;
    const ease = 1 - Math.exp(-dt * 13);
    v.x += (l.x - v.x) * ease;
    v.y += (l.y - v.y) * ease;
    const moved = Math.hypot(v.x - px, v.y - py);
    const bolting = l.act === ACT.RUSH;
    // Which way it's facing: where it's going, with a moment's pause on the turn.
    const want = Math.abs(v.x - px) > 0.002 ? Math.sign(v.x - px) : v.face;
    if (want !== v.face && l.act !== ACT.SNATCH) {
      v.turn += dt;
      if (v.turn > (bolting ? 0.03 : 0.1)) {
        v.face = want as 1 | -1;
        v.turn = 0;
      }
    } else v.turn = 0;
    v.pose.step += moved * (bolting ? 9 : 6.5) * 6;
    const p = v.pose;
    const blend = (cur: number, to: number, rate: number) => cur + (to - cur) * (1 - Math.exp(-dt * rate));
    let [tail, snap, rear, lash, dx, sink, alpha] = [0, 0, 0, 0, 0, 0, 1];
    switch (l.act) {
      case ACT.SNEAK:
        if (since < THIEF_PEEK_MS) {
          // Out from behind it: a look one way, the other, pincers clicking.
          const u = since / THIEF_PEEK_MS;
          dx = Math.sin(u * Math.PI * 2.5) * 6;
          rear = 1 + 2 * Math.sin(u * Math.PI);
          snap = Math.sin(now / 45) > 0.3 ? 0.8 : 0.1;
          sink = 5 * (1 - Math.min(1, u * 3));
        } else {
          snap = 0.4;
          p.step += dt * 14;
        }
        break;
      case ACT.SNATCH: {
        // Rears, whips its tail over, hooks it, and turns to haul.
        const u = since / THIEF_SNATCH_MS;
        if (u < 0.3) {
          rear = 4 * (u / 0.3);
          snap = 1;
        } else if (u < 0.5) {
          lash = 8 * Math.sin(((u - 0.3) / 0.2) * Math.PI);
          tail = (u - 0.3) / 0.2;
          snap = 0.2;
        } else {
          tail = 1;
          dx = Math.sin(u * 24) * (1 - u) * 3;
          rear = 1;
        }
        break;
      }
      case ACT.RECOVER:
        // Stops for a look about, tail twitching.
        tail = l.item ? 1 : 0;
        snap = Math.sin(now / 90) > 0.5 ? 0.9 : 0.2;
        rear = 2;
        v.pose.step += 0;
        dx = Math.sin(now / 130);
        break;
      case ACT.DEAD:
        tail = 0.35;
        break;
      case ACT.BURROW: {
        const u = Math.min(1, since / THIEF_BURROW_MS);
        p.step += dt * 40;
        sink = u * 10;
        alpha = 1 - u * u;
        if (Math.random() < 0.3) this.host.dust(l.x, l.y, 1);
        break;
      }
      default:
        tail = l.item ? 1 : 0;
        snap = bolting ? 1 : 0.25 + 0.2 * Math.sin(now / 150);
        rear = bolting ? 1.5 : 0;
    }
    p.tail = blend(p.tail, tail, l.act === ACT.SNATCH ? 40 : 12);
    p.snap = blend(p.snap, snap, 22);
    p.rear = blend(p.rear, rear, 18);
    p.lash = blend(p.lash, lash, 40);
    const fx0 = wx.call(this.host, v.x);
    const feet = wy.call(this.host, v.y);
    // Its leap when it's trodden on.
    const jump = v.leapt ? Math.max(0, 1 - (now - v.leapt) / 320) : 0;
    const hop = Math.sin(jump * Math.PI) * 11;
    const g = v.g.clear();
    let flip = 1;
    let lift = hop;
    if (l.act === ACT.DEAD) {
      // Over onto its back, with a little hop; its legs go on a while, slower and slower.
      const u = Math.min(1, since / 260);
      flip = Math.cos(u * Math.PI);
      lift = Math.sin(u * Math.PI) * 13;
      const kick = Math.max(0, 1 - since / 1300);
      p.step += dt * 34 * kick * kick;
      p.snap = kick * (0.5 + 0.5 * Math.sin(now / 70));
      alpha = Math.max(0, 1 - Math.max(0, since - 1100) / (GONE_MS - 1100));
    }
    g.alpha = alpha;
    g.pivot.set(0, -MID);
    g.position.set(fx0 + dx, feet - MID * SCALE - lift + sink);
    g.scale.set(SCALE, (Math.abs(flip) < 0.15 ? 0.15 : flip) * SCALE);
    g.zIndex = feet;
    drawThief(g, 0, 0, v.face, p);
    // "!": that's when it noticed you.
    if (bolting && since < 420) {
      g.rect(-1, -19, 2, 5).fill({ color: 0xffffff });
      g.rect(-1, -13, 2, 2).fill({ color: 0xffffff });
    }
    this.host.light(fx0, feet - 6, 0xffa040, 0.5, 0.4, 0.34 * alpha);
    this.haul(v, l, fx0, feet, now, moved, bolting, dt);
    // Its feet, if you're close enough to hear.
    if (moved > 0.002 && now >= v.skitter) {
      v.skitter = now + (bolting ? 130 : 220);
      const near = this.host.near(v.x, v.y);
      if (near > 0.3) dfx.thiefSkitter(near);
    }
    if (bolting && Math.random() < 0.3) this.host.dust(v.x, v.y, 1);
  }

  /** The gift on the end of its line. */
  private haul(v: View, l: ThiefTold, fx0: number, feet: number, now: number, moved: number, bolting: boolean, dt: number) {
    const { wx, wy } = this.host;
    const hooking = l.act === ACT.SNATCH && now - v.at > 0.42 * THIEF_SNATCH_MS;
    const hook = hookAt(v.pose);
    const [hx, hy] = [fx0 + v.face * hook.x * SCALE, feet + hook.y * SCALE];
    if (l.act === ACT.DEAD || l.act === ACT.BURROW || !l.item) {
      if (v.item) {
        v.item.destroy();
        v.item = null;
      }
      // Its line, out to the gift it's working loose.
      if (hooking) {
        const [tx, ty] = [wx.call(this.host, v.gift.x), wy.call(this.host, v.gift.y) - 8];
        v.g.moveTo(this.lx(hx, fx0), this.ly(hy, feet)).lineTo(this.lx(tx, fx0), this.ly(ty, feet)).stroke({ width: 1, color: 0x2a120c, alpha: 0.9 });
      }
      return;
    }
    if (!v.item) {
      const sp = new Sprite(this.host.giftTex(l.item));
      sp.anchor.set(0.5, 1);
      sp.scale.set(1.25);
      this.host.sorted.addChild(sp);
      v.item = sp;
      v.ix = wx.call(this.host, v.gift.x);
      v.iy = wy.call(this.host, v.gift.y);
    }
    // Pulled along on a line: it only moves when that's taut.
    const [ax, ay] = [fx0 + v.face * -18, feet - 1];
    const d = Math.hypot(ax - v.ix, ay - v.iy);
    if (d > LINE) {
      const k = (d - LINE) / d;
      v.ix += (ax - v.ix) * k;
      v.iy += (ay - v.iy) * k;
    }
    v.hauled += moved;
    const bump = Math.abs(Math.sin(v.hauled * (bolting ? 7 : 5))) * (bolting ? 4 : 2);
    const sway = Math.sin(v.hauled * 3.3) * (bolting ? 0.32 : 0.16);
    const sp = v.item;
    sp.position.set(Math.round(v.ix), Math.round(v.iy - bump));
    sp.rotation += (sway - sp.rotation) * (1 - Math.exp(-dt * 12));
    sp.zIndex = v.iy;
    v.g.moveTo(this.lx(hx, fx0), this.ly(hy, feet)).lineTo(this.lx(v.ix, fx0), this.ly(v.iy - 8 - bump, feet)).stroke({ width: 1, color: 0x2a120c, alpha: 0.9 });
    // It scores the sand as it goes.
    const last = this.marks[this.marks.length - 1];
    if (!last || Math.hypot(last.x - v.ix, last.y - v.iy) > 7) {
      this.marks.push({ x: Math.round(v.ix), y: Math.round(v.iy), at: now });
      if (this.marks.length > 70) this.marks.shift();
    }
  }

  /** World px, in its own turned, scaled space. */
  private lx(x: number, fx0: number): number {
    return (x - fx0) / SCALE;
  }

  private ly(y: number, feet: number): number {
    return (y - feet) / SCALE;
  }

  /** Under everything: the scores in the sand, and their shadows. */
  drawFloor(g: Graphics, now: number) {
    const { wx, wy } = this.host;
    this.marks = this.marks.filter((m) => now - m.at < MARK_MS);
    for (const m of this.marks) g.rect(m.x - 2, m.y, 4, 1).fill({ color: 0x5a3c1c, alpha: 0.5 * (1 - (now - m.at) / MARK_MS) });
    for (const v of this.views.values()) {
      const dead = v.act === ACT.DEAD ? Math.max(0, 1 - Math.max(0, now - v.at - 1100) / (GONE_MS - 1100)) : 1;
      const [x, y] = [wx.call(this.host, v.x), wy.call(this.host, v.y)];
      g.ellipse(x, y + 1, 11, 3).fill({ color: 0x000000, alpha: 0.28 * dead * (v.goneAt ? 0 : 1) });
      if (v.item) g.ellipse(v.ix, v.iy + 1, 9, 3).fill({ color: 0x000000, alpha: 0.25 });
    }
  }

  /** Any no longer about fade out (`seen`: those that are). */
  retire(seen: Set<number>, now: number) {
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.goneAt ||= now;
      const left = 1 - (now - v.goneAt) / 300;
      if (left > 0) {
        v.g.alpha = Math.min(v.g.alpha, left);
        if (v.item) v.item.alpha = left;
        continue;
      }
      this.drop(v);
      this.views.delete(id);
    }
    if (!this.views.size) this.marks = this.marks.filter((m) => now - m.at < MARK_MS);
  }

  private drop(v: View) {
    v.g.destroy();
    v.item?.destroy();
  }

  destroy() {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
    this.marks = [];
  }
}
