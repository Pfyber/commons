// The gladiator arena, out in the park (protocol ArenaState / ArenaEvent;
// the fight's rules on the server in commons_sim::arena). It all happens on
// the map: the two fighters are the players' own avatars (the bot, a
// gladiator of its own), facing off along the middle row of the sand with a
// sword and shield, health and stamina over their heads; anyone walking by
// sees it. The fighter's controls sit at the bottom of the screen while they
// fight: walk with A/D or the arrows; a Short swing (quick, light) or a Big
// swing (slow, double the damage, chips through a block, but a short swing
// cuts it off while it winds up); hold Block to stop short swings. Swings
// cost stamina; it comes back whenever you aren't swinging, slower after
// you've run it right out.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import * as sfx from "../ambient/sfx";
import type { EntityInfo, ServerMsg } from "../net/protocol.gen";
import { ChoiceModal, button, confirmButton, el, isTyping } from "../ui/panels";
import { type AvatarFrame, BOWL_RELEASE, SWORD_GUARD, SWORD_RAISE, TILE, toTexture } from "../world/art";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import type { MapObject } from "../world/map";
import { drawPixelText, pixelWidth } from "../world/pixelfont";
import type { Scene } from "../world/scene";

/** protocol `arena::*`. */
export const EMPTY = 0;
export const PLAYING = 1;
export const A_WON = 2;
export const B_WON = 3;
export const WAITING = 4;
export const DRAW = 5;
export const BOT = 0xfffffffa;
/** sim::arena: the floor, walking speed, and the swings' timings and costs. */
const W = 200;
const SPEED = 60;
const SHORT_WINDUP_MS = 260;
const SHORT_RECOVER_MS = 220;
const BIG_WINDUP_MS = 650;
const BIG_RECOVER_MS = 380;
const SHORT_COST = 15;
const BIG_COST = 32;
/** sim::arena::act (the swing under way), ::input (what we send), ::event. */
const ACT = { NONE: 0, SHORT: 1, BIG: 2 };
const INPUT = { SHORT: 1, BIG: 2, BLOCK: 3, UNBLOCK: 4 };
const EV = { HIT: 1, COUNTER: 2, BLOCK: 3, CHIP: 4, WHIFF: 5, TIRED: 6 };
const windupOf = (act: number) => (act === ACT.BIG ? BIG_WINDUP_MS : SHORT_WINDUP_MS);
const recoverOf = (act: number) => (act === ACT.BIG ? BIG_RECOVER_MS : SHORT_RECOVER_MS);
/**
 * Others are drawn this far behind the server's clock, so there are always
 * two ticks to glide between (the server sends ten a second).
 */
const RENDER_DELAY_MS = 130;
/** After a match, how long the fighters hold their last pose before walking free. */
const AFTER_MS = 2500;

type State = Extract<ServerMsg, { t: "ArenaState" }>;
type ArenaEv = Extract<ServerMsg, { t: "ArenaEvent" }>;

/** The bot: a gladiator in red and gold. */
const BOT_LOOK = encodeLook({ hue: 0, skin: 1, hair: 3, hat: 0, hatHue: 0, style: 0, accessory: 0, outfit: 0 });

/** The swings: their buttons, keys, and how each reads. Block is held (see BLOCK_KEYS). */
const MOVES: { act: number; label: string; key: string; codes: string[]; tip: string }[] = [
  { act: INPUT.SHORT, label: "⚡ Short swing", key: "J", codes: ["KeyJ", "Digit1"], tip: "Quick and light (15 stamina). Cuts off a Big swing while it winds up." },
  { act: INPUT.BIG, label: "💥 Big swing", key: "K", codes: ["KeyK", "Digit2"], tip: "Slow, double damage, chips through a block (32 stamina)." },
];
const BLOCK_KEYS = ["KeyL", "Space", "Digit3"];

/** How a fighter stands this frame (see `ArenaShow.pose`). */
interface Pose {
  frame: AvatarFrame | null;
  height: number;
  lean: number;
  lift: number;
}

interface Float {
  sprite: Sprite;
  x: number;
  y: number;
  at: number;
}

/** Pixel-font words as textures (outlined), cached. */
const words = new Map<string, Texture>();
function word(text: string, color: string): Texture {
  const key = `${color}|${text}`;
  let t = words.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = pixelWidth(text) + 2;
    c.height = 7;
    const ctx = c.getContext("2d")!;
    for (const [ox, oy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) drawPixelText(ctx, text, ox, oy, "#1a1020");
    drawPixelText(ctx, text, 1, 1, color);
    t = toTexture(c);
    words.set(key, t);
  }
  return t;
}

export class ArenaShow {
  private state: State | null = null;
  /** Recent ticks of the match (server time, each fighter's floor x), to glide between. */
  private snaps: { t: number; xs: number[] }[] = [];
  private endedAt = 0;
  /** Our own fighter, run ahead with our own walking, eased back to the server. */
  private ownX: number | null = null;
  private lastFrame = performance.now();
  private held = new Set<string>();
  private sentDir = 0;
  /** The bot's gladiator, while it fights. */
  private bot: Avatar | null = null;
  /** Who we've posed (to let them go after). */
  private posed = new Set<number>();
  /** Drawn over the fighters: their gear (by the sorted layer), and bars, words and floats on top. */
  private gear = [new Graphics(), new Graphics()];
  private top = new Container();
  private bars = new Graphics();
  private calls = [new Sprite(), new Sprite()];
  private floats: Float[] = [];
  /** The fighter's controls, at the bottom of the screen. */
  private hud = el("div", "arena-hud-bar");
  private hudInfo = el("div", "arena-hud");
  private moveBtns = new Map<number, HTMLButtonElement>();
  private choice = new ChoiceModal();

  /** Whether we're holding Block (keys or the button), and what we last told the server. */
  private blockHeld = new Set<string>();
  private sentBlock = false;

  private onKey = (e: KeyboardEvent) => {
    if (isTyping(e) || this.side() < 0) return;
    const move = MOVES.find((m) => m.codes.includes(e.code));
    const walk = ["ArrowLeft", "KeyA", "ArrowRight", "KeyD"].includes(e.code);
    const block = BLOCK_KEYS.includes(e.code);
    if (!move && !walk && !block) return;
    // The fight's keys, not the world's.
    e.preventDefault();
    e.stopPropagation();
    if (walk) {
      this.held.add(e.code);
      this.sendDir();
    } else if (block) {
      this.blockHeld.add(e.code);
      this.sendBlock();
    } else if (move && !e.repeat) this.act(move.act);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.held.delete(e.code)) this.sendDir();
    if (this.blockHeld.delete(e.code)) this.sendBlock();
  };

  /** The window lost focus (alt-tab…): the keys held go up with it, or we'd walk or block on forever. */
  private onBlur = () => {
    this.held.clear();
    this.blockHeld.clear();
    if (this.side() < 0) return;
    this.sendDir();
    this.sendBlock();
  };

  /** Block while it's held (and we're not mid-swing: then as soon as it ends). */
  private sendBlock() {
    const want = this.blockHeld.size > 0;
    if (want !== this.sentBlock) {
      this.sentBlock = want;
      this.send({ t: "ArenaAct", act: want ? INPUT.BLOCK : INPUT.UNBLOCK });
    }
  }

  constructor(
    private scene: Scene,
    private ring: MapObject,
    private labels: HTMLElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private nameOf: (id: number) => string,
    private serverNow: () => number,
    private send: (m: { t: "ArenaJoin"; vsBot: boolean } | { t: "ArenaLeave" } | { t: "ArenaMove"; dir: number } | { t: "ArenaAct"; act: number }) => void,
  ) {
    for (const g of this.gear) this.scene.sorted.addChild(g);
    this.top.zIndex = 1e9;
    for (const c of this.calls) {
      c.anchor.set(0.5, 1);
      this.top.addChild(c);
    }
    this.top.addChild(this.bars);
    this.scene.world.addChild(this.top);
    // The controls.
    const moves = el("div", "arena-moves");
    const walkBtn = (label: string, code: string) => {
      const b = button(label, () => {}, "subtle");
      b.classList.add("arena-walk");
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.held.add(code);
        this.sendDir();
      });
      for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
        b.addEventListener(ev, () => {
          if (this.held.delete(code)) this.sendDir();
        });
      }
      return b;
    };
    moves.append(walkBtn("◀", "TouchLeft"));
    for (const m of MOVES) {
      // Swung the moment it's pressed (a click only comes on release, a beat late).
      const b = button(`${m.label} (${m.key})`, () => {}, "primary");
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.act(m.act);
      });
      b.title = m.tip;
      this.moveBtns.set(m.act, b);
      moves.append(b);
    }
    // Block: held down.
    const blockBtn = button("🛡 Block (hold L / Space)", () => {});
    blockBtn.title = "Short swings glance off; Big swings only chip. Stamina comes back while you block.";
    blockBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.blockHeld.add("Button");
      this.sendBlock();
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
      blockBtn.addEventListener(ev, () => {
        if (this.blockHeld.delete("Button")) this.sendBlock();
      });
    }
    moves.append(blockBtn);
    moves.append(walkBtn("▶", "TouchRight"));
    const yieldBtn = confirmButton("arena-yield", "Yield", "Tap again to yield", () => this.send({ t: "ArenaLeave" }));
    this.hud.append(this.hudInfo, moves, el("p", "hint arena-chart", "⚡ Short cuts off 💥 Big while it winds up · 💥 Big chips through 🛡 Block · swings cost stamina: block or hold back to get it back"), yieldBtn);
    this.hud.hidden = true;
    document.body.append(this.hud);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
  }

  /** Who's fighting now (they don't walk off). */
  get players(): number[] {
    return this.state?.status === PLAYING ? [this.state.a, this.state.b] : [];
  }

  /** Our side in the fight (0 or 1), or -1. */
  private side(): number {
    const s = this.state;
    if (!s || s.status !== PLAYING) return -1;
    return s.a === this.selfId() ? 0 : s.b === this.selfId() ? 1 : -1;
  }

  private who(id: number) {
    return id === this.selfId() ? "You" : id === BOT ? "Gladiator bot" : this.nameOf(id);
  }

  /** The sign by the gate: fight the bot, fight a player, or just watch. */
  openSign() {
    const s = this.state;
    const me = this.selfId();
    const join = (vsBot: boolean) => () => this.send({ t: "ArenaJoin", vsBot });
    const watch = { icon: "👀", label: "Spectate", sub: "Find a spot in the stands", pick: () => {} };
    if (s?.status === PLAYING) {
      this.choice.show("The Arena", `${this.who(s.a)} and ${this.who(s.b)} are fighting! One match at a time: watch from the stands.`, [watch], () => {}, "⚔️ Gladiators");
    } else if (s?.status === WAITING && s.a === me) {
      this.choice.show("The Arena", "You're waiting on the sand for a challenger.", [{ icon: "🤖", label: "Fight the bot instead", sub: "Start now", primary: true, pick: join(true) }, { icon: "🚪", label: "Step out", sub: "Stop waiting", pick: () => this.send({ t: "ArenaLeave" }) }], () => {}, "⚔️ Gladiators");
    } else if (s?.status === WAITING) {
      this.choice.show("The Arena", `${this.who(s.a)} waits for a challenger.`, [{ icon: "⚔️", label: `Fight ${this.who(s.a)}`, sub: "One on one, on the sand", primary: true, pick: join(false) }, watch], () => {}, "⚔️ Gladiators");
    } else {
      this.choice.show(
        "The Arena",
        "Fight on the sand for all to see. Short swings are quick; Big swings hit twice as hard and chip through a block, but a Short cuts them off. Hold Block to rest. Watch your stamina!",
        [
          { icon: "🤖", label: "Fight the bot", sub: "A worthy foe", primary: true, pick: join(true) },
          { icon: "🧍", label: "Fight a player", sub: "Wait for a challenger", pick: join(false) },
          watch,
        ],
        () => {},
        "⚔️ Gladiators",
      );
    }
  }

  private sendDir() {
    const left = ["ArrowLeft", "KeyA", "TouchLeft"].some((c) => this.held.has(c));
    const right = ["ArrowRight", "KeyD", "TouchRight"].some((c) => this.held.has(c));
    const dir = left === right ? 0 : left ? 1 : 2;
    if (dir !== this.sentDir) {
      this.sentDir = dir;
      this.send({ t: "ArenaMove", dir });
    }
  }

  private act(a: number) {
    const p = this.side();
    const s = this.state;
    if (p < 0 || !s) return;
    const f = s.fighters[p];
    const now = this.serverNow();
    const cost = a === INPUT.BIG ? BIG_COST : SHORT_COST;
    if (f.act !== ACT.NONE || now < f.flinchUntil || f.stamina < cost) return;
    this.send({ t: "ArenaAct", act: a });
  }

  onState(s: State) {
    const before = this.state;
    if (before?.status === PLAYING && s.status !== PLAYING) {
      this.endedAt = performance.now();
      this.announceEnd(s);
    }
    if (s.status === PLAYING && before?.status !== PLAYING) {
      this.ownX = null;
      this.endedAt = 0;
    }
    if (s.status !== PLAYING || before?.status !== PLAYING) this.snaps = [];
    this.snaps.push({ t: s.now, xs: s.fighters.map((f) => f.x / 10) });
    if (this.snaps.length > 12) this.snaps.shift();
    this.state = s;
    const p = this.side();
    if (p >= 0) {
      if (this.ownX === null) this.ownX = s.fighters[p].x / 10;
    } else if (this.sentDir || this.held.size) {
      this.held.clear();
      this.sentDir = 0;
    }
    // Strikes starting: their swish.
    if (before?.status === PLAYING) {
      s.fighters.forEach((f, i) => {
        const was = before.fighters[i];
        if (was && f.actAt !== was.actAt && f.act !== ACT.NONE) sfx.swordSwing(f.act === ACT.BIG ? 1 : 0.3, f.act === ACT.BIG ? 0.7 : 0.45);
      });
    }
  }

  onEvent(e: ArenaEv) {
    const at = this.worldAt(e.x / 10);
    const now = performance.now();
    const add = (text: string, color: string, lift = 0) => {
      const sprite = new Sprite(word(text, color));
      sprite.anchor.set(0.5, 1);
      this.top.addChild(sprite);
      this.floats.push({ sprite, x: at.x, y: at.y - 46 - lift, at: now });
    };
    switch (e.kind) {
      case EV.HIT:
        add(`-${e.dmg}`, e.dmg >= 16 ? "#ff3f3f" : "#ff7f7f");
        sfx.swordHit(e.dmg >= 16 ? 1 : 0.6);
        break;
      case EV.COUNTER:
        add("CUT OFF!", "#ffe14f", 9);
        add(`-${e.dmg}`, "#ff7f7f");
        sfx.swordClang(0.6);
        sfx.swordHit(0.5);
        break;
      case EV.BLOCK:
        add("BLOCKED", "#7fd7ff");
        sfx.swordParry();
        break;
      case EV.CHIP:
        add("CHIP", "#ff9a4f", 9);
        add(`-${e.dmg}`, "#ff7f7f");
        sfx.swordClang(0.8);
        break;
      case EV.WHIFF:
        add("MISS", "#a9a59b");
        break;
      case EV.TIRED:
        add("TIRED!", "#b07bff");
        sfx.dizzy(0.6);
        break;
    }
  }

  private announceEnd(s: State) {
    const me = this.selfId();
    const winner = s.status === A_WON ? s.a : s.status === B_WON ? s.b : 0;
    const text = s.status === DRAW ? "A DRAW!" : winner === me ? "VICTORY!" : `${this.who(winner).toUpperCase()} WINS!`;
    const i = s.status === B_WON ? 1 : 0;
    const at = this.worldAt((s.fighters[i]?.x ?? 1000) / 10);
    const sprite = new Sprite(word(text, "#ffe14f"));
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(2);
    this.top.addChild(sprite);
    this.floats.push({ sprite, x: at.x, y: at.y - 60, at: performance.now() + 600 });
    sfx.crowdRoar();
  }

  /** World pixels for floor position `x`: on the middle row of the sand (feet). */
  private worldAt(x: number): { x: number; y: number } {
    const t = this.tileAt(x);
    return { x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE - 4 };
  }

  /** Tile coordinates (fractional) for floor position `x` (as the server's `tile_at`, unrounded). */
  private tileAt(x: number): { x: number; y: number } {
    const left = this.ring.x + 3;
    const right = this.ring.x + this.ring.w - 4;
    return { x: left + (x / W) * (right - left), y: this.ring.y + Math.floor(this.ring.h / 2) };
  }

  /** Each frame: the fighters placed and posed, their gear, bars and calls drawn, the controls. */
  update(serverNow: number, wallNow: number) {
    const dt = Math.min(0.1, (wallNow - this.lastFrame) / 1000);
    this.lastFrame = wallNow;
    const s = this.state;
    const live = !!s && s.fighters.length === 2 && (s.status === PLAYING || (this.endedAt > 0 && wallNow - this.endedAt < AFTER_MS));
    // Our own walking, at once, eased toward where the server has us (no snaps).
    const p = this.side();
    if (p >= 0 && s && this.ownX !== null) {
      const f = s.fighters[p];
      const dir = this.sentDir === 1 ? -1 : this.sentDir === 2 ? 1 : 0;
      const slow = f.blocking || f.act !== ACT.NONE;
      if (serverNow < f.flinchUntil) {
        // Knocked back: follow the server's glide.
        this.ownX = this.glide(p, serverNow - RENDER_DELAY_MS / 2);
      } else {
        this.ownX = Math.min(W - 10, Math.max(10, this.ownX + dir * SPEED * (slow ? 0.5 : 1) * dt));
        // Where the server will have us by now: its last word, plus our walking since.
        const ahead = f.x / 10 + dir * SPEED * (slow ? 0.5 : 1) * Math.min(0.25, Math.max(0, (serverNow - s.now) / 1000));
        this.ownX += (ahead - this.ownX) * Math.min(1, dt * 5);
      }
    }
    // The bot's gladiator comes and goes with its matches.
    const botIn = live && s && s.b === BOT;
    if (botIn && !this.bot) {
      const t = this.tileAt((s.fighters[1]?.x ?? 1400) / 10);
      const info: EntityInfo = { id: BOT, name: "Gladiator 🤖", look: BOT_LOOK, x: Math.round(t.x), y: t.y, state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false };
      this.bot = new Avatar(info, this.scene, this.labels, false, Date.now());
      this.bot.markNpc();
    } else if (!botIn && this.bot) {
      this.bot.destroy();
      this.bot = null;
    }
    for (const g of this.gear) g.clear();
    this.bars.clear();
    for (const c of this.calls) c.visible = false;
    if (live && s) {
      const ids = [s.a, s.b];
      for (let i = 0; i < 2; i++) {
        const f = s.fighters[i];
        const at = serverNow - RENDER_DELAY_MS;
        const x = i === p && this.ownX !== null ? this.ownX : this.glide(i, at);
        const walking = s.status === PLAYING && (i === p ? this.sentDir !== 0 : Math.abs(this.glide(i, at) - this.glide(i, at - 100)) > 0.6);
        const avatar = ids[i] === BOT ? this.bot : this.avatarOf(ids[i]);
        const t = this.tileAt(x);
        const pose = this.pose(f, serverNow, s);
        if (avatar) {
          avatar.setArena({ x: t.x, y: t.y, facing: f.facing ? 1 : -1, frame: pose.frame, walking: walking && pose.frame === null, hurt: serverNow < f.flinchUntil, lean: pose.lean, lift: pose.lift });
          this.posed.add(ids[i]);
        }
        this.drawGear(i, f, t, serverNow, s, pose);
      }
    }
    this.bot?.update(serverNow, wallNow);
    // Let them go once it's over.
    if (!live && this.posed.size) {
      for (const id of this.posed) this.avatarOf(id)?.setArena(null);
      this.posed.clear();
    }
    // Floating words rise and fade.
    this.floats = this.floats.filter((fl) => {
      const k = (wallNow - fl.at) / 1100;
      if (k >= 1) {
        fl.sprite.destroy();
        return false;
      }
      fl.sprite.visible = k >= 0;
      fl.sprite.alpha = 1 - Math.max(0, k) ** 2;
      fl.sprite.position.set(Math.round(fl.x), Math.round(fl.y - Math.max(0, k) * 16));
      return true;
    });
    this.renderHud(serverNow);
  }

  /** Floor x of fighter `i` at server time `t`, glided between the ticks either side. */
  private glide(i: number, t: number): number {
    const sn = this.snaps;
    if (!sn.length) return (this.state?.fighters[i]?.x ?? 0) / 10;
    if (t <= sn[0].t) return sn[0].xs[i];
    for (let k = 1; k < sn.length; k++) {
      if (t <= sn[k].t) {
        const a = sn[k - 1];
        const b = sn[k];
        const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return a.xs[i] + (b.xs[i] - a.xs[i]) * u;
      }
    }
    return sn[sn.length - 1].xs[i];
  }

  /**
   * A fighter's pose: their avatar frame (null: standing or walking), the
   * strike's height (0 high, 1 mid, 2 low), and for a leap how far they tip
   * (radians, round their feet) and rise off the sand (px).
   */
  private pose(f: State["fighters"][number], now: number, s: State): Pose {
    const face = f.facing ? 1 : -1;
    const big = f.act === ACT.BIG;
    if (s.status !== PLAYING && f.hp === 0) return { frame: 2, height: 1, lean: 0, lift: 0 };
    const since = now - f.actAt;
    if (f.act !== ACT.NONE) {
      const windup = windupOf(f.act);
      // Winding up: the sword back (a big one high overhead, leaning back into it)…
      if (since < windup) return { frame: SWORD_RAISE, height: big ? 0 : 1, lean: -face * (big ? 0.18 * Math.min(1, since / windup) : 0.06), lift: 0 };
      // …and swung through, leaning in.
      if (since < windup + recoverOf(f.act)) return { frame: BOWL_RELEASE, height: big ? 0 : 1, lean: face * (big ? 0.22 : 0.1), lift: 0 };
    }
    if (f.blocking) return { frame: SWORD_GUARD, height: 1, lean: -face * 0.05, lift: 0 };
    return { frame: null, height: 1, lean: 0, lift: 0 };
  }

  /** Sword and shield (turned and lifted with the body), the call over a big swing, health and stamina. */
  private drawGear(i: number, f: State["fighters"][number], t: { x: number; y: number }, now: number, s: State, pose: Pose) {
    const g = this.gear[i];
    const wx = t.x * TILE + TILE / 2;
    const wy = t.y * TILE + TILE - 4;
    g.position.set(Math.round(wx), Math.round(wy - pose.lift));
    g.rotation = pose.lean;
    g.zIndex = wy + 0.6;
    const face = f.facing ? 1 : -1;
    const since = now - f.actAt;
    const big = f.act === ACT.BIG;
    const swinging = f.act !== ACT.NONE;
    const windup = swinging && since < windupOf(f.act);
    const swung = swinging && !windup && since < windupOf(f.act) + recoverOf(f.act);
    const ko = s.status !== PLAYING && f.hp === 0;
    const line = (x1: number, y1: number, x2: number, y2: number, color: number, w = 2) => {
      const n = Math.max(1, Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let k = 0; k <= n; k++) g.rect(Math.round(x1 + ((x2 - x1) * k) / n), Math.round(y1 + ((y2 - y1) * k) / n), w, w).fill({ color });
    };
    const blade = (hx: number, hy: number, tx: number, ty: number, glow = false) => {
      if (glow) line(hx - 1, hy - 1, tx - 1, ty - 1, 0xffe14f, 6);
      line(hx, hy, tx, ty, 0x1a1020, 4);
      line(hx + 1, hy + 1, tx + 1, ty + 1, 0xd8dce8, 2);
      g.rect(hx - 1, hy - 1, 4, 4).fill({ color: 0xc99a2a });
    };
    // The shield: on the far arm, held up in front when blocking.
    const shield = f.blocking && !swinging ? { x: face * 6, y: -30 } : { x: -face * 11, y: -22 };
    if (!ko) {
      g.rect(shield.x - 5, shield.y - 1, 10, 12).fill({ color: 0x1a1020 });
      g.rect(shield.x - 4, shield.y, 8, 10).fill({ color: f.blocking ? 0xe0b040 : 0xc99a2a });
      g.rect(shield.x - 1, shield.y + 3, 2, 3).fill({ color: 0xf6c343 });
      if (f.blocking && !swinging) g.rect(shield.x - 6, shield.y - 2, 12, 14).stroke({ color: 0x7fd7ff, width: 1, alpha: 0.6 + 0.3 * Math.sin(performance.now() / 120) });
    }
    // The sword.
    if (ko) blade(6, -1, 22, -1);
    else if (windup && big) {
      // Hauled back high over the head, glowing: here it comes.
      const k = Math.min(1, since / windupOf(f.act));
      blade(face * 4, -32, -face * (6 + 8 * k), -46 - 4 * k, true);
    } else if (windup) blade(face * 6, -26, -face * 10, -30);
    else if (swung && big) {
      // A great downward cleave, a wide arc behind it.
      blade(face * 8, -24, face * 30, -6);
      for (let k = 0; k < 5; k++) g.rect(face * (10 + k * 5) - 1, -36 + k * 6, 3, 2).fill({ color: 0xffffff, alpha: 0.65 });
    } else if (swung) {
      // A quick level slash.
      blade(face * 8, -17, face * 26, -17);
      g.rect(Math.min(face * 10, face * 24), -22, 14, 1).fill({ color: 0xffffff, alpha: 0.6 });
    } else if (f.blocking) blade(face * 9, -10, face * 9, -34);
    else blade(face * 7, -13, face * 15, -23);
    // Health and stamina, over the head.
    const bx = Math.round(wx) - 14;
    const by = Math.round(wy - pose.lift) - 50;
    this.bars.rect(bx - 1, by - 1, 30, 5).fill({ color: 0x1a1020 });
    this.bars.rect(bx, by, 28, 3).fill({ color: 0x2a2046 });
    this.bars.rect(bx, by, Math.round((28 * f.hp) / 100), 3).fill({ color: i === 0 ? 0xe8566b : 0x3f8fe8 });
    if (s.status === PLAYING) {
      this.bars.rect(bx, by + 4, 28, 2).fill({ color: 0x1a1020 });
      this.bars.rect(bx, by + 4, Math.round((28 * f.stamina) / 100), 2).fill({ color: f.stamina < SHORT_COST ? 0xb07bff : 0x5fd07a });
    }
    // The call over a big swing as it winds up, so it can be answered.
    const call = this.calls[i];
    if (windup && big) {
      call.texture = word("BIG!", "#ff9a4f");
      call.position.set(Math.round(wx), by - 3);
      call.visible = true;
    }
  }

  /** The fighter's bar at the bottom: both healths and staminas, the clock, the swings. */
  private renderHud(now: number) {
    const s = this.state;
    const p = this.side();
    this.hud.hidden = p < 0;
    if (p < 0 || !s) {
      this.blockHeld.clear();
      this.sentBlock = false;
      return;
    }
    const left = Math.max(0, Math.ceil((s.ends - now) / 1000));
    const side = (i: number) => {
      const f = s.fighters[i];
      return `<div class="arena-side s${i}"><b>${escape(this.who(i === 0 ? s.a : s.b))}</b><div class="arena-hp"><i style="width:${f.hp}%"></i></div><div class="arena-stamina${f.stamina < SHORT_COST ? " low" : ""}"><i style="width:${f.stamina}%"></i></div></div>`;
    };
    this.hudInfo.innerHTML = `${side(0)}<div class="arena-clock">${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</div>${side(1)}`;
    const f = s.fighters[p];
    const free = f.act === ACT.NONE && now >= f.flinchUntil;
    this.moveBtns.get(INPUT.SHORT)!.disabled = !free || f.stamina < SHORT_COST;
    this.moveBtns.get(INPUT.BIG)!.disabled = !free || f.stamina < BIG_COST;
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    for (const id of this.posed) this.avatarOf(id)?.setArena(null);
    this.bot?.destroy();
    for (const g of this.gear) g.destroy();
    this.top.destroy({ children: true });
    this.hud.remove();
    this.choice.destroy();
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
