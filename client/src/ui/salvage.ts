// The Salvage Claw: the magnet's game (the fisherman's magnet, dropped in the
// pond instead of a line). A side view down into the murky water: something
// glints, half-buried in the mud among other junk. Steer the swaying magnet
// down; hold over a thing on the bottom to pulse the magnet and work it free
// of the mud (the glinting one is stuck fast; the junk comes easier). Hold
// anywhere else to reel up, let go to let the magnet sink back. Grab more
// than the one thing if you like: each hangs on the chain under the magnet,
// so it reels up slower and there's more to be hit. And there's plenty to
// hit you: fish swimming straight across, crabs on the
// branches and one on the bottom, jellyfish round the rarer things; one
// touch and the lot's lost. Surface with whatever you've got. The server
// decides what everything is; this says what came up.

import { at, burst, tone } from "../ambient/sfx";
import * as cs from "../ambient/casinosfx";
import { itemIconUrl } from "../world/items";
import { button, el, isTyping } from "./panels";

const W = 180;
const H = 132;
const SCALE = 2;
const SURFACE = 14;
const BED = 112;
/** The whole dive (ms): a hair under the server's `SALVAGE_MS`. */
const LIMIT_MS = 30_000;

interface Junk {
  x: number;
  key: string;
  real: boolean;
  /** Which of the server's junk it is (-1: the glinting one), and how much pulling frees it. */
  index: number;
  need: number;
  grip: number;
  img: HTMLImageElement;
  /** How deep it's sunk (0: on the mud, 1: all but gone). */
  sunk: number;
}

interface Snag {
  x: number;
  y: number;
  w: number;
  left: boolean;
}

/** Something alive down there: a big fish, a crab on a branch, a jellyfish. Touch one hauling and it's lost. */
interface Critter {
  kind: "fish" | "crab" | "jelly";
  x: number;
  y: number;
  vx: number;
  w: number;
  h: number;
  /** Its colours, its wiggle's phase; a crab's branch (its ends). */
  body: string;
  fin: string;
  phase: number;
  from: number;
  to: number;
  y0: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  c: string;
}

type Phase = "play" | "won" | "lost";

/** What came up: the glinting thing or not, and which of the junk (bit by bit). */
export interface Salvaged {
  target: boolean;
  extras: number;
}

/** How a junk item looks (its key) and what it's called. */
export interface JunkInfo {
  key: string;
  name: string;
}

export class SalvageGame {
  private el = el("div", "salvage");
  private canvas = el("canvas", "salvage-view");
  private low = document.createElement("canvas");
  private title = el("div", "salvage-title");
  private hint = el("div", "salvage-hint");
  private hold = button("Hold: grab / reel up", () => {}, "primary salvage-hold");
  private raf = 0;
  private done: ((r: Salvaged) => void) | null = null;
  // The state of the dive.
  private phase: Phase = "play";
  private t0 = 0;
  private last = 0;
  private rarity = 0;
  private x = W / 2;
  private y = SURFACE + 4;
  private vx = 0;
  private aimX = W / 2;
  private keys = { left: false, right: false };
  private holding = false;
  /** On the chain under the magnet, top first. */
  private carried: Junk[] = [];
  /** A grab's just done: holding does nothing till it's let go. */
  private lock = false;
  /** Pulsing at something on the bottom (this frame). */
  private pulsing: Junk | null = null;
  private names = new Map<string, string>();
  private swing = 0;
  private swingV = 0;
  private junk: Junk[] = [];
  private snags: Snag[] = [];
  private motes: Mote[] = [];
  private shake = 0;
  private lastHum = 0;
  private lastCreak = 0;
  private lastBubble = 0;
  private critters: Critter[] = [];
  private nextCritter = 0;

  private onKey = (e: KeyboardEvent, down: boolean) => {
    if (this.el.hidden || isTyping(e)) return;
    const k = e.code;
    if (k === "ArrowLeft" || k === "KeyA") this.keys.left = down;
    else if (k === "ArrowRight" || k === "KeyD") this.keys.right = down;
    else if (k === "Space" || k === "Enter" || k === "ArrowUp" || k === "KeyW") {
      if (down && !this.holding) this.lock = false;
      this.holding = down;
    }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  constructor() {
    this.low.width = W;
    this.low.height = H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * SCALE * dpr;
    this.canvas.height = H * SCALE * dpr;
    this.canvas.style.width = `${W * SCALE}px`;
    this.canvas.style.height = `${H * SCALE}px`;
    const card = el("div", "salvage-card");
    card.append(this.title, this.canvas, this.hint, this.hold);
    this.el.append(card);
    this.el.hidden = true;
    document.body.append(this.el);
    window.addEventListener("keydown", (e) => this.onKey(e, true), true);
    window.addEventListener("keyup", (e) => this.onKey(e, false), true);
    // Steering. A mouse steers by how far it moves (so the magnet starts in
    // the middle whatever the cursor was over, and doesn't jump to it); a
    // finger steers to where it is. Holding down pulses / reels.
    const toX = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.aimX = ((e.clientX - r.left) / r.width) * W;
    };
    window.addEventListener("pointermove", (e) => {
      if (this.el.hidden) return;
      if (e.pointerType !== "mouse") {
        if (e.target === this.canvas) toX(e);
        return;
      }
      const r = this.canvas.getBoundingClientRect();
      this.aimX = Math.max(8, Math.min(W - 8, this.aimX + (e.movementX / r.width) * W));
    });
    // Holding the (left) button down anywhere while it's up (the mouse steers
    // by moving, so the cursor's seldom over the water itself); a finger on
    // the water steers there too. Let go anywhere.
    this.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.hold.contains(e.target as Node)) return;
      e.preventDefault();
      if (e.pointerType !== "mouse" && e.target === this.canvas) toX(e);
      this.holding = true;
      this.lock = false;
    });
    const up = () => {
      this.holding = false;
      this.lock = false;
    };
    window.addEventListener("pointerup", (e) => {
      if (!this.el.hidden && e.button === 0) up();
    });
    window.addEventListener("pointercancel", () => !this.el.hidden && up());
    this.hold.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.holding = true;
    });
    this.hold.addEventListener("pointerup", up);
    this.hold.addEventListener("pointerleave", up);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /**
   * A dive for `key` (an item key, of `rarity`), `name` shown when it's up,
   * among `junk` (the server's other junk down there): calls `done` once with
   * what came up.
   */
  play(key: string, rarity: number, name: string, junk: JunkInfo[], done: (r: Salvaged) => void) {
    this.stop();
    this.done = done;
    this.rarity = Math.max(0, Math.min(5, rarity));
    this.phase = "play";
    this.t0 = performance.now();
    this.last = this.t0;
    this.x = W / 2;
    this.aimX = W / 2;
    this.y = SURFACE + 4;
    this.vx = 0;
    this.swing = 0;
    this.swingV = 0;
    this.motes = [];
    this.shake = 0;
    this.carried = [];
    this.lock = false;
    this.pulsing = null;
    this.names = new Map([[key, name], ...junk.map((j) => [j.key, j.name] as [string, string])]);
    // The junk on the bottom: the real thing glints (and is stuck fast), the rest doesn't.
    const spots = [20, 46, 72, 98, 124, 150].sort(() => Math.random() - 0.5);
    const things = [{ key, index: -1 }, ...junk.slice(0, 5).map((j, i) => ({ key: j.key, index: i }))];
    this.junk = things.map((t, i) => {
      const img = new Image();
      img.src = itemIconUrl(t.key, "scrap");
      const real = t.index < 0;
      return {
        x: spots[i] + (Math.random() - 0.5) * 8,
        key: t.key,
        real,
        index: t.index,
        need: real ? 1300 + this.rarity * 550 : 650,
        grip: 0,
        img,
        sunk: real ? 0.35 + this.rarity * 0.07 : 0.2 + Math.random() * 0.4,
      };
    });
    // Branches out of the banks; crabs on them, one on the bottom; a fish or two about.
    const n = 1 + Math.ceil(this.rarity / 2);
    this.snags = Array.from({ length: n }, (_, i) => {
      const left = i % 2 === 0;
      return { x: left ? 0 : W, y: 34 + ((BED - 50) / n) * i + Math.random() * 10, w: 36 + Math.random() * 26, left };
    });
    this.critters = [];
    for (const sn of this.snags) if (Math.random() < 0.5 + this.rarity * 0.12) this.spawnCrab(sn);
    this.floorCrab();
    this.spawn(true);
    this.nextCritter = this.t0 + 1500;
    this.title.textContent = "🧲 Salvage!";
    this.hint.textContent = "Steer with the mouse or A D / ← → · hold (click, or Space / W / ↑) over a thing on the bottom to grab it · hold anywhere else to reel up · let go to sink";
    this.el.hidden = false;
    burst(at(0), 0.5, 0.06, "lowpass", 900, 200);
    const frame = (now: number) => {
      this.tick(now);
      if (!this.el.hidden) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Closes it (the session ended elsewhere: counts as lost if it was still going). */
  stop() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    const d = this.done;
    this.done = null;
    if (d && this.phase !== "won") d({ target: false, extras: 0 });
  }

  /** Up with what's on the chain (`won`), or lost the lot. */
  private finish(won: boolean) {
    if (this.phase === "won" || this.phase === "lost") return;
    this.phase = won ? "won" : "lost";
    const got: Salvaged = won ? { target: this.carried.some((j) => j.real), extras: this.carried.reduce((m, j) => (j.index >= 0 ? m | (1 << j.index) : m), 0) } : { target: false, extras: 0 };
    const d = this.done;
    this.done = null;
    d?.(got);
    if (won) {
      const names = this.carried.map((j) => this.names.get(j.key) ?? j.key);
      this.title.textContent = got.target ? `✨ Salvaged: ${names.join(" + ")}!` : `🧲 Up: ${names.join(" + ")}`;
      this.hint.textContent = got.target ? (this.carried.length > 1 ? "Greedy, and it paid off!" : "Up it comes!") : "Not the glinting one, but it's something.";
      cs.win(got.target ? 2 + this.rarity * 2 + (this.carried.length - 1) : 1.5, 0.8);
      burst(at(0), 0.4, 0.08, "bandpass", 1400, 400, 0.8);
      for (let i = 0; i < 40; i++) this.mote(this.x, SURFACE, (Math.random() - 0.5) * 3, -Math.random() * 2.5, i % 2 ? "#fff3a8" : "#bfefff", 50);
    }
    window.setTimeout(() => {
      if (this.phase === "won" || this.phase === "lost") {
        this.el.hidden = true;
        cancelAnimationFrame(this.raf);
      }
    }, 1800);
  }

  private fail(why: string) {
    this.title.textContent = why;
    this.hint.textContent = this.carried.length > 1 ? "Too greedy: the lot sinks back into the murk…" : "It sinks back into the murk…";
    tone(at(0), 0.25, 0.08, "sawtooth", 900, 120);
    burst(at(0), 0.08, 0.1, "highpass", 3000);
    cs.lose(0.7);
    this.finish(false);
  }

  private mote(x: number, y: number, vx: number, vy: number, c: string, life = 40) {
    this.motes.push({ x, y, vx, vy, c, life });
  }

  private tick(now: number) {
    const dt = Math.min(50, now - this.last) / 16.7;
    this.last = now;
    const left = LIMIT_MS - (now - this.t0);
    if (this.phase === "play") {
      if (left <= 0) this.fail("⌛ Out of time!");
      else {
        this.steer(now, dt);
        this.play1(now, dt);
      }
    } else {
      this.moveCritters(now, dt);
      if (this.phase === "won") this.y = Math.max(-40, this.y - 1.6 * dt);
      else this.y += 1.2 * dt;
    }
    // Silt and bubbles drift.
    if (Math.random() < 0.25 * dt) this.mote(Math.random() * W, BED - Math.random() * 4, (Math.random() - 0.5) * 0.2, -0.05 - Math.random() * 0.1, "rgba(160,150,110,0.6)", 120);
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.vy += (m.c.startsWith("#") ? 0.04 : 0) * dt;
      m.life -= dt;
    }
    this.motes = this.motes.filter((m) => m.life > 0);
    this.shake *= 0.85;
    this.draw(now, left);
  }

  /** The magnet follows the pointer / keys, swayed by the current (stronger for rarer things). */
  private steer(now: number, dt: number) {
    if (this.keys.left) this.aimX -= 2.2 * dt;
    if (this.keys.right) this.aimX += 2.2 * dt;
    this.aimX = Math.max(8, Math.min(W - 8, this.aimX));
    const current = Math.sin(now / 900) * (0.25 + this.rarity * 0.08) + Math.sin(now / 370) * 0.12;
    this.vx += ((this.aimX - this.x) * 0.012 + current * 0.08) * dt;
    this.vx *= Math.pow(0.9, dt);
    this.x = Math.max(6, Math.min(W - 6, this.x + this.vx * dt));
  }

  /** Where the `k`th thing on the chain hangs (0: right under the magnet). */
  private hang(k: number): { x: number; y: number } {
    const d = 12 + k * 11;
    return { x: this.x + Math.sin(this.swing) * d, y: this.y + Math.cos(this.swing) * d };
  }

  /** How far the chain hangs below the magnet (the lowest thing on it). */
  private get reach(): number {
    return this.carried.length ? 12 + (this.carried.length - 1) * 11 + 8 : 6;
  }

  private play1(now: number, dt: number) {
    const floor = BED - this.reach;
    const bottom = this.y >= floor - 2;
    // Over something on the bottom (what the magnet's tips reach)?
    const under = bottom && !this.carried.length ? (this.junk.find((j) => Math.abs(j.x - this.x) < 11) ?? null) : bottom ? (this.junk.find((j) => Math.abs(j.x - this.hang(this.carried.length - 1).x) < 11) ?? null) : null;
    this.pulsing = this.holding && !this.lock && under ? under : null;
    // Weight: the glinting thing's by its rarity, each bit of junk a good deal more.
    const load = this.carried.reduce((w, j) => w + (j.real ? 0.15 * this.rarity : 0.55), 0);
    if (this.pulsing) {
      const j = this.pulsing;
      j.grip += 16.7 * dt;
      if (now - this.lastHum > 110) {
        this.lastHum = now;
        const k = j.grip / j.need;
        tone(at(0), 0.14, 0.04 + k * 0.03, "sawtooth", 70 + k * 60, 66 + k * 60);
        if (k > 0.3) tone(at(0), 0.05, 0.02, "square", 900 + k * 900);
      }
      if (Math.random() < 0.6 * dt) this.mote(j.x + (Math.random() - 0.5) * 14, BED - 2, (Math.random() - 0.5) * 0.8, -0.3 - Math.random() * 0.6, "rgba(120,100,70,0.8)", 40);
      if (j.grip >= j.need) {
        // Free! Up it flies onto the chain.
        this.junk = this.junk.filter((x) => x !== j);
        this.carried.push(j);
        this.lock = true;
        this.shake = 4;
        tone(at(0), 0.12, 0.1, "square", 220, 880);
        burst(at(0), 0.1, 0.1, "highpass", 2500);
        for (let i = 0; i < 18; i++) this.mote(j.x, BED - 4, (Math.random() - 0.5) * 2, -Math.random() * 1.5, "#8a6a40", 35);
        this.title.textContent = j.real ? "🧲 Got it! Now up, quick!" : this.carried.some((c) => c.real) ? "🧲 Greedy… it's getting heavy!" : "🧲 Junk on the chain: heavier now";
        this.hint.textContent = "Hold (away from the junk) to reel up · let go to sink · don't touch anything alive!";
      }
    } else if (this.holding && !this.lock) {
      // Reeling: up as fast as it'll go, the heavier the slower.
      this.y -= ((0.5 - this.rarity * 0.03) / (1 + load)) * dt;
      if (now - this.lastCreak > 120) {
        this.lastCreak = now;
        burst(at(0), 0.03, 0.05 + load * 0.02, "bandpass", 2400 - load * 500, 2400 - load * 500, 5);
      }
    } else {
      // Let go: it sinks (faster the more it carries), down to the bottom.
      this.y += (0.32 + load * 0.15) * dt;
      for (const j of this.junk) j.grip = Math.max(0, j.grip - 3 * dt);
    }
    this.y = Math.max(SURFACE + 3, Math.min(floor, this.y));
    if (now - this.lastBubble > 600) {
      this.lastBubble = now;
      this.mote(this.x + 2, this.y - 6, 0, -0.4, "rgba(200,240,255,0.8)", 60);
    }
    // The chain swings, pushed by the magnet's sideways motion (slower with more on it).
    this.swingV += (-this.swing * 0.05 - (this.vx * 0.02) / (1 + this.carried.length * 0.3)) * dt;
    this.swingV *= Math.pow(0.97, dt);
    this.swing = Math.max(-1.1, Math.min(1.1, this.swing + this.swingV * dt));
    // The creatures come and go (more, and quicker, for rarer things).
    if (now > this.nextCritter) {
      this.nextCritter = now + Math.max(450, 1150 - this.rarity * 140) * (0.6 + Math.random() * 0.8);
      this.spawn(false);
    }
    this.moveCritters(now, dt);
    // Touch one, magnet or anything on the chain, and it's all lost.
    const parts = [{ x: this.x, y: this.y - 1, r: 4 }, ...this.carried.map((_, k) => ({ ...this.hang(k), r: 6 }))];
    for (const c of this.critters) {
      const hit = parts.find((p) => Math.abs(p.x - c.x) < c.w / 2 + p.r && Math.abs(p.y - c.y) < c.h / 2 + p.r);
      if (!hit) continue;
      this.shake = 6;
      tone(at(0), 0.3, 0.09, "square", 520, 160);
      for (let k = 0; k < 14; k++) this.mote(hit.x, hit.y, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, "#d8d0b0", 30);
      c.vx *= 2.5;
      return this.fail(c.kind === "crab" ? "🦀 A crab snatched at it!" : c.kind === "jelly" ? "🪼 Stung! You let go!" : "🐟 A fish knocked it loose!");
    }
    // At the top with something on the chain: done.
    if (this.y <= SURFACE + 3 && this.carried.length) this.finish(true);
  }

  /** A crab on branch `sn`, pacing along it. */
  private spawnCrab(sn: Snag) {
    const from = sn.left ? 4 : W - sn.w + 4;
    const to = sn.left ? sn.w - 4 : W - 4;
    this.critters.push({ kind: "crab", x: from + Math.random() * (to - from), y: sn.y - 5, vx: (Math.random() < 0.5 ? -1 : 1) * (0.25 + this.rarity * 0.05), w: 9, h: 6, body: "#d8483a", fin: "#ff8a6a", phase: Math.random() * 6, from, to, y0: sn.y - 5 });
  }

  /** A fish swimming across (or, for rarer things, sometimes a jellyfish drifting); `calm`: up high, out of the way. */
  private spawn(calm: boolean) {
    const jelly = !calm && this.rarity >= 2 && Math.random() < 0.25 + this.rarity * 0.05;
    const y = calm ? SURFACE + 10 + Math.random() * 20 : SURFACE + 14 + Math.random() * (BED - SURFACE - 34);
    if (jelly) {
      const x = 20 + Math.random() * (W - 40);
      this.critters.push({ kind: "jelly", x, y, vx: 0, w: 9, h: 10, body: "rgba(255,170,230,0.75)", fin: "#ffd0f0", phase: Math.random() * 6, from: 0, to: 0, y0: y });
      return;
    }
    const big = Math.random() < 0.35 + this.rarity * 0.08;
    const right = Math.random() < 0.5;
    const speed = (0.4 + Math.random() * 0.35 + this.rarity * 0.07) * (big ? 0.85 : 1);
    const looks = [["#5a7a4a", "#8aaa6a"], ["#6a6a8a", "#9a9abf"], ["#8a5a3a", "#c88a5a"], ["#3a5a7a", "#6a9acf"]][(Math.random() * 4) | 0];
    this.critters.push({ kind: "fish", x: right ? -12 : W + 12, y, vx: right ? speed : -speed, w: big ? 20 : 13, h: big ? 8 : 6, body: looks[0], fin: looks[1], phase: Math.random() * 6, from: 0, to: 0, y0: y });
  }

  /** The crab on the bottom, scuttling along the mud from bank to bank. */
  private floorCrab() {
    const v = (0.3 + this.rarity * 0.05) * (Math.random() < 0.5 ? -1 : 1);
    this.critters.push({ kind: "crab", x: 10 + Math.random() * (W - 20), y: BED - 3, vx: v, w: 9, h: 6, body: "#c84a2a", fin: "#ff9a6a", phase: Math.random() * 6, from: 6, to: W - 6, y0: BED - 3 });
  }

  private moveCritters(now: number, dt: number) {
    for (const c of this.critters) {
      c.phase += 0.15 * dt;
      if (c.kind === "crab") {
        c.x += c.vx * dt;
        if (c.x < c.from || c.x > c.to) c.vx = -c.vx;
        // Now and then it turns about for no reason.
        if (Math.random() < 0.005 * dt) c.vx = -c.vx;
      } else if (c.kind === "jelly") {
        // Pulsing up, sinking back.
        c.y = c.y0 + Math.sin(now / 900 + c.phase * 0.1) * 14;
        c.x += Math.sin(now / 1500 + c.phase) * 0.08 * dt;
      } else {
        // Straight across, at its depth.
        c.x += c.vx * dt;
      }
    }
    this.critters = this.critters.filter((c) => c.x > -30 && c.x < W + 30);
  }

  private critter(g: CanvasRenderingContext2D, c: Critter, now: number) {
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    if (c.kind === "fish") {
      const f = c.vx > 0 ? 1 : -1;
      const hw = c.w / 2;
      const hh = c.h / 2;
      // Body, belly, tail flicking, a fin, an eye (and a mouthful of teeth for a big one).
      g.fillStyle = "#1a1a24";
      g.fillRect(x - hw, y - hh, c.w, c.h);
      g.fillStyle = c.body;
      g.fillRect(x - hw + 1, y - hh + 1, c.w - 2, c.h - 2);
      g.fillStyle = c.fin;
      g.fillRect(x - hw + 2, y, c.w - 4, hh - 1);
      const tail = Math.round(Math.sin(c.phase * 2) * 2);
      const tx = f > 0 ? x - hw - 4 : x + hw;
      g.fillStyle = c.body;
      g.fillRect(tx, y - hh - 1 + tail, 4, 2);
      g.fillRect(tx, y + hh - 1 + tail, 4, 2);
      g.fillRect(f > 0 ? tx + 2 : tx, y - 1 + tail, 2, 2);
      g.fillStyle = c.fin;
      g.fillRect(x - 2, y - hh - 2, 5, 2);
      const ex = f > 0 ? x + hw - 4 : x - hw + 2;
      g.fillStyle = "#ffffff";
      g.fillRect(ex, y - hh + 1, 2, 2);
      g.fillStyle = "#000000";
      g.fillRect(ex + (f > 0 ? 1 : 0), y - hh + 1, 1, 1);
      if (c.w > 15) {
        g.fillStyle = "#ffffff";
        g.fillRect(f > 0 ? x + hw - 2 : x - hw + 1, y + 1, 1, 1);
      }
    } else if (c.kind === "crab") {
      // A red crab, legs going, claws up and snapping.
      const step = Math.floor(c.phase) % 2;
      g.fillStyle = "#1a1a24";
      for (let k = 0; k < 3; k++) {
        g.fillRect(x - 5, y + 1 + ((k + step) % 2), 2, 1);
        g.fillRect(x + 3, y + 1 + ((k + step + 1) % 2), 2, 1);
      }
      g.fillStyle = c.body;
      g.fillRect(x - 3, y - 2, 7, 4);
      g.fillStyle = c.fin;
      g.fillRect(x - 2, y - 2, 4, 1);
      const snap = Math.sin(now / 150 + c.phase) > 0 ? 1 : 0;
      g.fillStyle = c.body;
      g.fillRect(x - 5, y - 4 - snap, 2, 2);
      g.fillRect(x + 4, y - 4 - snap, 2, 2);
      g.fillStyle = "#000000";
      g.fillRect(x - 1, y - 3, 1, 1);
      g.fillRect(x + 1, y - 3, 1, 1);
    } else {
      // A jellyfish: a see-through bell, tentacles trailing.
      const pulse = Math.sin(now / 300 + c.phase) > 0 ? 1 : 0;
      g.fillStyle = c.body;
      g.fillRect(x - 4 - pulse, y - 4, 9 + pulse * 2, 4);
      g.fillRect(x - 3, y - 5, 7, 1);
      g.fillStyle = c.fin;
      g.fillRect(x - 2, y - 4, 2, 1);
      g.fillStyle = "rgba(255,190,240,0.6)";
      for (let k = -3; k <= 3; k += 2) {
        for (let t = 0; t < 6; t++) g.fillRect(x + k + Math.round(Math.sin(now / 250 + t + k) * 0.8), y + t, 1, 1);
      }
    }
  }

  private draw(now: number, left: number) {
    const g = this.low.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    // Sky, the surface, then the water darkening down to the murk.
    g.fillStyle = "#9fd8ff";
    g.fillRect(0, 0, W, SURFACE);
    const water = g.createLinearGradient(0, SURFACE, 0, BED);
    water.addColorStop(0, "#2f8fae");
    water.addColorStop(0.5, "#1d5f78");
    water.addColorStop(1, "#103446");
    g.fillStyle = water;
    g.fillRect(0, SURFACE, W, H - SURFACE);
    // Light rays slanting down, slowly shifting.
    g.fillStyle = "rgba(200,240,255,0.07)";
    for (let i = 0; i < 5; i++) {
      const x0 = ((i * 47 + now / 60) % (W + 60)) - 30;
      g.beginPath();
      g.moveTo(x0, SURFACE);
      g.lineTo(x0 + 10, SURFACE);
      g.lineTo(x0 + 34, BED);
      g.lineTo(x0 + 18, BED);
      g.fill();
    }
    // The surface's ripple.
    for (let x = 0; x < W; x += 2) {
      const y = SURFACE + Math.round(Math.sin(x / 9 + now / 300));
      g.fillStyle = "#d8f4ff";
      g.fillRect(x, y - 1, 2, 1);
    }
    // The snags: branches out of the banks.
    for (const s of this.snags) {
      g.fillStyle = "#3a2a1a";
      const x0 = s.left ? 0 : W - s.w;
      g.fillRect(x0, s.y - 2, s.w, 4);
      g.fillStyle = "#5a4028";
      g.fillRect(x0, s.y - 2, s.w, 1);
      for (let k = 6; k < s.w; k += 9) {
        const bx = s.left ? k : W - k;
        g.fillStyle = "#3a2a1a";
        g.fillRect(bx, s.y - 6 + (k % 2) * 8, 2, 4);
        g.fillStyle = "#4f8a3a";
        g.fillRect(bx - 1, s.y + 2 + Math.round(Math.sin(now / 400 + k)), 1, 3);
      }
    }
    // The mud bed: bumpy, with rocks and weed swaying.
    g.fillStyle = "#4a3a24";
    for (let x = 0; x < W; x++) {
      const y = BED + Math.round(Math.sin(x / 11) * 1.5 + Math.sin(x / 4.3) * 0.7);
      g.fillRect(x, y, 1, H - y);
    }
    g.fillStyle = "#5e4a2e";
    for (let x = 0; x < W; x += 3) g.fillRect(x, BED + 1 + ((x * 7) % 3), 2, 1);
    for (const [rx, rw] of [[12, 7], [64, 5], [120, 8], [170, 6]]) {
      g.fillStyle = "#5a5a62";
      g.fillRect(rx, BED - 2, rw, 4);
      g.fillStyle = "#7a7a84";
      g.fillRect(rx + 1, BED - 2, rw - 2, 1);
    }
    for (let k = 0; k < 9; k++) {
      const wx = 8 + k * 21;
      const sway = Math.sin(now / 600 + k) * 2;
      g.fillStyle = "#3f7a2e";
      for (let h = 0; h < 10; h++) g.fillRect(Math.round(wx + (sway * h) / 10), BED - h, 1, 1);
    }
    // The junk half in the mud; the real one glints (gold for the rare).
    for (const j of this.junk) {
      if (!j.img.complete) continue;
      const size = 16;
      const y = BED - size + Math.round(j.sunk * 10);
      const wobble = this.pulsing === j ? Math.round((Math.random() - 0.5) * Math.min(3, 1 + (j.grip / j.need) * 3)) : 0;
      g.globalAlpha = j.real ? 1 : 0.75;
      g.drawImage(j.img, Math.round(j.x - size / 2) + wobble, y, size, size);
      g.globalAlpha = 1;
      // The mud over its lower part.
      g.fillStyle = "#4a3a24";
      g.fillRect(Math.round(j.x - size / 2) - 1, BED + 1, size + 2, H - BED);
      if (j.real) {
        const tw = (now / 1100 + j.x) % 1;
        if (tw < 0.25) {
          const s = Math.sin((tw / 0.25) * Math.PI);
          const c = this.rarity >= 3 ? "#ffe14f" : "#ffffff";
          const gx = Math.round(j.x + 3);
          const gy = y + 3;
          g.fillStyle = c;
          g.fillRect(gx - Math.round(3 * s), gy, Math.round(6 * s) + 1, 1);
          g.fillRect(gx, gy - Math.round(3 * s), 1, Math.round(6 * s) + 1);
        }
      }
    }
    for (const c of this.critters) this.critter(g, c, now);
    // The line, the magnet, and (hauling) the thing swinging under it.
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const mx = Math.round(this.x + sx);
    const my = Math.round(this.y);
    g.strokeStyle = "#e8f4ff";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(W / 2, 0);
    g.quadraticCurveTo(W / 2 + (mx - W / 2) * 0.3, my / 2, mx, my - 7);
    g.stroke();
    // The chain: everything grabbed, hanging one under another.
    let px = mx;
    let py = my + 2;
    this.carried.forEach((j, k) => {
      const at2 = this.hang(k);
      const ix = Math.round(at2.x + sx);
      const iy = Math.round(at2.y);
      g.strokeStyle = "#a0a0b0";
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(ix, iy - 6);
      g.stroke();
      if (j.img.complete) g.drawImage(j.img, ix - 8, iy - 8, 16, 16);
      if (j.real) {
        g.fillStyle = "#ffe14f";
        g.fillRect(ix + 5, iy - 7, 1, 1);
      }
      px = ix;
      py = iy + 6;
    });
    this.magnet(g, mx, my, now);
    // The pulse: field arcs out from the magnet's tips.
    if (this.pulsing) {
      const tip = this.carried.length ? this.hang(this.carried.length - 1) : { x: mx, y: my };
      for (let k = 0; k < 3; k++) {
        const r = ((now / 8 + k * 9) % 27) + 3;
        g.strokeStyle = `rgba(150,220,255,${0.7 * (1 - r / 30)})`;
        g.beginPath();
        g.arc(tip.x, tip.y + 4, r, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
      }
    }
    for (const m of this.motes) {
      g.fillStyle = m.c;
      g.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    // The gauges: time; the grip (diving), the tension (hauling).
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(4, 3, W - 8, 4);
    g.fillStyle = left < 8000 ? "#ff6a5a" : "#9fe07a";
    g.fillRect(5, 4, Math.max(0, ((W - 10) * left) / LIMIT_MS), 2);
    // Pulling something free: how near it is.
    if (this.pulsing) {
      const k = Math.min(1, this.pulsing.grip / this.pulsing.need);
      bar(g, W - 10, 24, 6, 70, k, k > 0.75 ? "#ffe14f" : "#7ad8ff", "#1a2a34");
    }
    // What's on the chain, as little icons in the corner (the glinting one starred).
    this.carried.forEach((j, k) => {
      if (j.img.complete) g.drawImage(j.img, 6 + k * 11, 9, 10, 10);
      if (j.real) {
        g.fillStyle = "#ffe14f";
        g.fillRect(14 + k * 11, 9, 2, 2);
      }
    });
    // Up to size, crisp.
    const out = this.canvas.getContext("2d")!;
    const s = this.canvas.width / W;
    out.setTransform(s, 0, 0, s, 0, 0);
    out.imageSmoothingEnabled = false;
    out.drawImage(this.low, 0, 0);
  }

  /** A red horseshoe magnet, silver tips, glowing when pulsing. */
  private magnet(g: CanvasRenderingContext2D, x: number, y: number, now: number) {
    const glow = !!this.pulsing;
    g.fillStyle = "#2b2233";
    g.fillRect(x - 6, y - 7, 12, 3);
    g.fillRect(x - 6, y - 7, 4, 13);
    g.fillRect(x + 2, y - 7, 4, 13);
    g.fillStyle = "#d83a3a";
    g.fillRect(x - 5, y - 6, 10, 2);
    g.fillRect(x - 5, y - 6, 2, 9);
    g.fillRect(x + 3, y - 6, 2, 9);
    g.fillStyle = "#ff8a7a";
    g.fillRect(x - 5, y - 6, 4, 1);
    g.fillStyle = glow && Math.floor(now / 80) % 2 ? "#bff4ff" : "#d8dce8";
    g.fillRect(x - 5, y + 3, 2, 2);
    g.fillRect(x + 3, y + 3, 2, 2);
  }
}

function bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, fill: string, back: string) {
  g.fillStyle = "#0a1418";
  g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle = back;
  g.fillRect(x, y, w, h);
  g.fillStyle = fill;
  const fh = Math.round(h * k);
  g.fillRect(x, y + h - fh, w, fh);
}
