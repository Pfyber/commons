// The skatepark: get on a board and skate, as many at once as like. Free
// skate (just ride, every combo counts), a 60-second run (score all you can
// before the horn, THPS style), or a line (one combo, as long as you can
// keep it going: manuals between landings). The rules are skatesim.ts; here
// they're played: your keys (or a stick and buttons on a phone), your
// avatar on its board in the park, the sounds, the score on screen, and
// everyone else skating there too, as the server passes their moves on.
//
// Keys: arrows / WASD ride (the board turns your way and you push off; pull
// back to stop), Space: hold to crouch, let go to ollie (longer, higher);
// pressed again in the air, a trick (off a ramp a full flip head over heels, else a kickflip).
// In the air J flips (which flip by the way you're holding: none a kickflip,
// ← heelflip, → varial, ↑ hardflip, ↓ shove-it; J again quick for a
// double), K grabs (held: worth more the longer), Q / E spin. Come down on a
// rail or a ledge, moving along it, and you grind it (← → to balance; Space
// to pop off). L on the ground: a manual (balance it with ← →), which keeps
// a combo going over a landing. Land straight, or bail. Esc gets off.

import { type Container, Graphics } from "pixi.js";
import * as sfx from "../ambient/skatesfx";
import type { ServerMsg } from "../net/protocol.gen";
import { Panel, button, el, isTyping } from "../ui/panels";
import { TILE, legColor, type AvatarFrame } from "../world/art";
import { type Avatar, PUSH_POSES, drawPushLeg, pushPose } from "../world/avatars";
import type { ZoneMap } from "../world/map";
import type { Scene } from "../world/scene";
import { NO_INPUT, PUSH_S, Park, Skater, TRICK, type Input, type SkateEvent } from "./skatesim";
import type { Economy } from "../economy";
import { DECKS, STOCK, loadKit, needs, packKit, ride, saveKit, unpackKit, type Kit } from "./skatekit";

export type SkateSend =
  | { t: "SkateOn"; on: boolean; kit: number }
  | { t: "SkateMove"; x: number; y: number; z: number; dir: number; pose: number; trick: number; spin: number }
  | { t: "SkateScore"; kind: number; points: number; label: string };

/** `SkateMove.pose` / `SkateScore.kind` (commons_protocol::skate). */
const POSE = { ROLL: 0, CROUCH: 1, AIR: 2, GRIND: 3, MANUAL: 4, BAIL: 5 };
const SCORE = { COMBO: 0, BAIL: 1, RUN: 2 };
/** How often your moves go out (ms). */
const SEND_MS = 80;
/** How far behind others are drawn, between their moves (ms). */
const BEHIND_MS = 110;
/** A skater not heard from for this long has gone (ms). */
const GONE_MS = 3000;
const RUN_S = 60;
const COUNT_S = 3;
const STEP_S = 1 / 120;
const STICK_R = 56;
/** How far above the feet a skater's middle is (they turn round it, head over heels). */
const MIDDLE = 15;
/** How far the board lifts you: deck on wheels (as the avatars'). */
const BOARD_RISE = 4;
/** Pushing, as others are told it: in `trick` (rolling, there's no trick), from here up, the stroke's phase in 15ths. */
const PUSH_CODE = 32;

/** Combos worth sending to the board (and telling everyone about). */
const TELL_PTS = 400;

type GameMode = "free" | "run" | "line";

/** How a skater's drawn: where (feet, world px), how high, which way, doing what. */
interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pose: number;
  trick: number;
  spin: number;
  /** Your own: how far into its flip (0–1), the push's phase, the balance; others' are guessed. */
  flipT?: number;
  /** Head over heels: how far round (0–1). */
  bodyT?: number;
  push?: number;
  balance?: number;
  crouch?: number;
  bailT?: number;
}

/** Someone else on a board: their last few moves, to draw them smoothly between. */
interface Other {
  snaps: { t: number; p: Pose }[];
  heard: number;
  /** Their board, as they've built it (`SkateOn.kit`). */
  kit: number;
  rig: Rig;
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// ---- drawing a skater ----------------------------------------------------------

const O = 0x3b3a2e;
/** The wheels, by size (small, standard, big as `Kit.wheels` 1, 0, 2): how wide and tall. */
const WHEEL_SIZE: [number, number][] = [
  [4, 3],
  [3, 2],
  [5, 4],
];
/** How long a trail lasts behind you (ms). */
const TRAIL_MS = 550;

/** A skater's board (as they've built it), its shadow, its glow, its trail and its sparks; the avatar on top is the avatar's own, posed. */
class Rig {
  private g = new Graphics();
  /** What glows and trails, drawn adding light. */
  private glowG = new Graphics();
  private trailG = new Graphics();
  private facing: 1 | -1 = 1;
  private sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  private lastSparks = 0;
  private bailFrom: { x: number; y: number } | null = null;
  private kit: Kit = { ...STOCK };
  /** The trail: where the board's been, and its bits (sparks, flames, stars). */
  private path: { x: number; y: number; t: number }[] = [];
  private bits: { x: number; y: number; vx: number; vy: number; life: number; max: number; c: number }[] = [];

  /** The same glow and trail again on the night's lights (`lit`), so after dark they really glow. */
  private litGlow: Graphics | null = null;
  private litTrail: Graphics | null = null;

  constructor(scene: Scene, kit: Kit, lit: Container | null = null) {
    this.trailG.blendMode = "add";
    this.glowG.blendMode = "add";
    scene.sorted.addChild(this.trailG, this.g, this.glowG);
    if (lit) {
      this.litGlow = new Graphics();
      this.litTrail = new Graphics();
      lit.addChild(this.litTrail, this.litGlow);
    }
    this.setKit(kit);
  }

  setKit(kit: Kit) {
    this.kit = { ...kit };
  }

  private get color(): number {
    return (DECKS[this.kit.deck] ?? DECKS[0]).color;
  }

  draw(avatar: Avatar, p: Pose, ground: number, wallNow: number) {
    const g = this.g.clear();
    const x = Math.round(p.x);
    const gy = Math.round(p.y - ground);
    const air = p.z - ground;
    // Which way they face: by the way they're headed (keeping the last when it's straight up or down the screen).
    const c = Math.cos(p.heading);
    if (Math.abs(c) > 0.3) this.facing = c >= 0 ? 1 : -1;
    // A spin turns them round: the sprite flips as it passes side-on.
    const spinC = Math.cos(p.spin);
    const facing: 1 | -1 = (spinC >= 0 ? this.facing : -this.facing) as 1 | -1;
    const squash = Math.max(0.2, Math.abs(spinC));
    // The shadow on whatever's under them, smaller and fainter the higher they are.
    const sw = Math.max(6, 20 - air * 0.12);
    g.ellipse(x, gy, sw / 2, Math.max(1.5, 3 - air * 0.02)).fill({ color: 0x000000, alpha: Math.max(0.1, 0.3 - air * 0.002) });

    let frame: AvatarFrame = 4;
    let lean = 0;
    let lift = p.z + BOARD_RISE;
    let boardDy = 0;
    let boardFlip = 0;
    let boardTurn = 1;
    let push: (typeof PUSH_POSES)[number] | null = null;
    const flipping = p.trick > 0 && p.trick < TRICK.GRAB;
    const grabbing = p.trick === TRICK.GRAB;
    if (p.pose === POSE.CROUCH) {
      frame = (p.crouch ?? 0) > 0.25 ? 3 : 6;
    } else if (p.pose === POSE.ROLL && p.push !== undefined && p.push > 0) {
      // Pushing: down on the front knee, the back foot reaching out behind to kick along the ground.
      push = pushPose(p.push * 1000);
      if (push) frame = push.frame;
    } else if (p.pose === POSE.AIR) {
      frame = grabbing ? 3 : flipping ? 5 : 4;
      if (flipping) {
        // The feet tuck up off the board as it turns under them.
        lift += 4;
        boardDy = 3;
        const kind = p.trick % TRICK.DOUBLE || 1;
        const t = p.flipT ?? (wallNow / 330) % 1;
        const turns = p.trick >= TRICK.DOUBLE ? 2 : 1;
        if (kind === 5) boardTurn = Math.cos(t * Math.PI * 2 * turns);
        else {
          boardFlip = t * turns;
          if (kind === 3) boardTurn = Math.cos(t * Math.PI * 2);
        }
      }
      if (grabbing) boardDy = -5;
    } else if (p.pose === POSE.MANUAL) {
      lean = -0.18 * facing + (p.balance ?? 0) * 0.12;
    } else if (p.pose === POSE.GRIND) {
      lean = (p.balance ?? 0) * 0.2;
    } else if (p.pose === POSE.BAIL) {
      // Down on the ground, the board skittering off.
      const t = 1.3 - (p.bailT ?? 0.6);
      frame = 2;
      lean = facing * Math.min(1, t * 5) * 1.45;
      lift = ground + 2;
      this.bailFrom ??= { x, y: gy };
    }
    if (p.pose !== POSE.BAIL) this.bailFrom = null;
    // Head over heels: the skater turns right round their middle (the sprite
    // turns round its feet, so the feet are moved to keep the middle still),
    // tucked, the board held to their feet.
    const body = p.pose === POSE.AIR && (p.trick === TRICK.BACKFLIP || p.trick === TRICK.FRONTFLIP);
    let turn = 0;
    let shiftX = 0;
    if (body) {
      const t = p.bodyT ?? (wallNow / 550) % 1;
      // (Backwards, a skater facing right goes round anticlockwise.)
      const way = (p.trick === TRICK.BACKFLIP ? -1 : 1) * facing;
      turn = way * t * Math.PI * 2;
      frame = 3;
      lean = turn;
      shiftX = -MIDDLE * Math.sin(turn);
      lift += MIDDLE - MIDDLE * Math.cos(turn);
    }
    avatar.setArena({ x: (p.x + shiftX - TILE / 2) / TILE, y: (p.y - TILE + 4) / TILE, facing, frame, walking: false, hurt: false, lean, lift, noRide: true });
    // The board.
    const by = Math.round(p.y - p.z) + boardDy;
    if (body) {
      this.turnedBoard(g, p.x, by - BOARD_RISE - MIDDLE, turn);
      this.g.zIndex = avatar.sprite.zIndex + 0.1;
      return;
    }
    if (p.pose === POSE.BAIL && this.bailFrom) {
      const t = 1.3 - (p.bailT ?? 0.6);
      const bx = Math.round(this.bailFrom.x + facing * Math.min(1, t * 1.5) * 26);
      // Upside down, wheels up.
      g.rect(bx - 11, gy - 3, 22, 2).fill(this.color);
      g.rect(bx - 8, gy - 6, 4, 3).fill(0xf1e9d2);
      g.rect(bx + 4, gy - 6, 4, 3).fill(0xf1e9d2);
    } else this.board(g, x, by, facing, squash * boardTurn, boardFlip);
    if (push) drawPushLeg(g, x, by, facing, push, legColor(avatar.info.style));
    // Grinding: sparks off the trucks.
    if (p.pose === POSE.GRIND && wallNow - this.lastSparks > 30) {
      this.lastSparks = wallNow;
      for (let i = 0; i < 2; i++) this.sparks.push({ x: x - facing * (6 + Math.random() * 6), y: by - 1, vx: -facing * (30 + Math.random() * 70), vy: -40 - Math.random() * 60, life: 0.25 + Math.random() * 0.2 });
    }
    for (const s of this.sparks) {
      s.life -= 1 / 60;
      s.x += s.vx / 60;
      s.y += s.vy / 60;
      s.vy += 400 / 60;
      if (s.life > 0) g.rect(Math.round(s.x), Math.round(s.y), 1, 1).fill(s.life > 0.2 ? 0xfff3a0 : 0xff9a3a);
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.g.zIndex = avatar.sprite.zIndex - 0.1;
    this.glowAndTrail(x, by, gy, p.pose === POSE.BAIL, wallNow, avatar.sprite.zIndex);
  }

  /**
   * The glow-in-the-dark deck's light (on the board, and a pool on the
   * ground under it), and the trail behind: where the board's been these
   * last moments, drawn in its skin.
   */
  private glowAndTrail(x: number, by: number, gy: number, down: boolean, now: number, z: number) {
    this.glowG.zIndex = z + 0.05;
    this.trailG.zIndex = z - 0.2;
    const trail = this.kit.trail;
    // Where the board's been (a point each time it's moved a little), and the bits it throws off.
    const last = this.path[this.path.length - 1];
    if (trail && !down && (!last || Math.hypot(x - last.x, by - 4 - last.y) > 1.5)) this.path.push({ x, y: by - 4, t: now });
    this.path = this.path.filter((q) => now - q.t < TRAIL_MS);
    const moving = !!last && now - last.t < 120;
    if ((trail === 1 || trail === 4) && moving && !down) {
      const fire = trail === 4;
      for (let k = 0; k < (fire ? 3 : 2); k++) {
        this.bits.push({
          x: x + (Math.random() - 0.5) * 8,
          y: by - 3 + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 30,
          vy: fire ? -20 - Math.random() * 30 : -30 - Math.random() * 50,
          life: 1,
          max: fire ? 0.45 : 0.35,
          c: fire ? [0xffe14d, 0xffa53d, 0xff5a2a][k % 3] : [0xfff3a0, 0xffd23f][k % 2],
        });
      }
    }
    for (const b of this.bits) {
      b.life -= 1 / 60 / b.max;
      b.x += b.vx / 60;
      b.y += b.vy / 60;
      if (trail !== 4) b.vy += 250 / 60;
    }
    this.bits = this.bits.filter((b) => b.life > 0);
    if (this.bits.length > 120) this.bits.splice(0, this.bits.length - 120);
    // Drawn in the world (seen by day), and again on the night's lights (glowing after dark).
    this.paint(this.glowG.clear(), this.trailG.clear(), x, by, gy, down, now);
    if (this.litGlow && this.litTrail) this.paint(this.litGlow.clear(), this.litTrail.clear(), x, by, gy, down, now);
  }

  private paint(gl: Graphics, t: Graphics, x: number, by: number, gy: number, down: boolean, now: number) {
    const glow = DECKS[this.kit.deck]?.glow;
    if (glow && !down) {
      const pulse = 0.8 + 0.2 * Math.sin(now / 300);
      gl.ellipse(x, by - 5, 15, 5).fill({ color: glow, alpha: 0.3 * pulse });
      gl.ellipse(x, by - 5, 9, 3).fill({ color: glow, alpha: 0.35 * pulse });
      gl.ellipse(x, gy, 22, 6).fill({ color: glow, alpha: 0.16 * pulse });
    }
    const trail = this.kit.trail;
    if (!trail) return;
    const seg = (i: number, width: number, color: number, alpha: number, dy = 0) => {
      const a = this.path[i - 1];
      const b = this.path[i];
      t.moveTo(a.x, a.y + dy).lineTo(b.x, b.y + dy).stroke({ width, color, alpha, cap: "round" });
    };
    const age = (i: number) => 1 - (now - this.path[i].t) / TRAIL_MS;
    if (trail === 2) {
      // Neon: a wide soft cyan line, a hot pink core.
      for (let i = 1; i < this.path.length; i++) {
        seg(i, 6, 0x3fd8e8, 0.25 * age(i));
        seg(i, 3, 0x3fd8e8, 0.6 * age(i));
        seg(i, 1, 0xff8fd8, 0.9 * age(i));
      }
    } else if (trail === 3) {
      // Rainbow: six bands.
      const bands = [0xff4d4d, 0xffa53d, 0xffe14d, 0x5fe06a, 0x4da6ff, 0xa66bff];
      for (let i = 1; i < this.path.length; i++) bands.forEach((c, k) => seg(i, 1.6, c, 0.85 * age(i), (k - 2.5) * 1.5));
    } else if (trail === 5) {
      // Galaxy: a deep purple ribbon, blue at its heart, stars twinkling in it.
      for (let i = 1; i < this.path.length; i++) {
        seg(i, 7, 0x5a2a9a, 0.35 * age(i));
        seg(i, 3, 0x4d6bff, 0.5 * age(i));
      }
      this.path.forEach((q, i) => {
        if ((i * 7 + Math.floor(now / 90)) % 5 === 0) t.rect(Math.round(q.x + ((i * 13) % 7) - 3), Math.round(q.y + ((i * 5) % 5) - 2), 1, 1).fill({ color: 0xffffff, alpha: age(i) });
      });
    } else if (trail === 4) for (let i = 1; i < this.path.length; i++) seg(i, 3, 0xff6a2a, 0.45 * age(i));
    for (const b of this.bits) {
      const s = trail === 4 ? Math.max(1, Math.round(3 * b.life)) : 1;
      t.rect(Math.round(b.x), Math.round(b.y), s, s).fill({ color: b.life < 0.4 && trail === 4 ? 0xff3a1a : b.c, alpha: Math.min(1, b.life * 1.5) });
    }
  }

  /** The board turned `turn` round the skater's middle at (cx, cy), under their feet. */
  private turnedBoard(g: Graphics, cx: number, cy: number, turn: number) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const at = (x: number, y: number) => [cx + x * c - y * s, cy + x * s + y * c];
    const rect = (x0: number, y0: number, x1: number, y1: number, color: number) =>
      g.poly([...at(x0, y0), ...at(x1, y0), ...at(x1, y1), ...at(x0, y1)]).fill(color);
    // (In the skater's own frame: their middle at 0, their feet MIDDLE below it, the deck just under.)
    const d = MIDDLE + BOARD_RISE;
    rect(-7, d - 1, -3, d + 2, 0xf1e9d2);
    rect(3, d - 1, 7, d + 2, 0xf1e9d2);
    rect(-11, d - 3, 11, d - 1, 0x161616);
    rect(-11, d - 1, 11, d, this.color);
  }

  /** The board, `y` its wheels' bottom: `turn` squashes it as it turns side-on, `flip` (turns) rolls it over. */
  private board(g: Graphics, x: number, y: number, facing: number, turn: number, flip: number) {
    const half = Math.max(2, Math.round(11 * Math.abs(turn)));
    const roll = flip ? Math.cos(flip * Math.PI * 2) : 1;
    if (flip && Math.abs(roll) < 0.35) {
      // Edge on, mid-flip: a thin sliver.
      g.rect(x - half, y - 7, half * 2, 1).fill(O);
      g.rect(x - half, y - 6, half * 2, 1).fill(this.color);
      return;
    }
    const upside = roll < 0;
    // Wheels (on top, when it's over).
    const [ww, wh] = WHEEL_SIZE[this.kit.wheels] ?? WHEEL_SIZE[0];
    const wy = upside ? y - 6 - wh : y - wh - 1;
    for (const wx of [x - Math.round(half * 0.73), x + Math.round(half * 0.36)]) {
      g.rect(wx, wy, ww, wh).fill(O);
      g.rect(wx + 1, wy + 1, ww - 2, wh - 1).fill(0xf1e9d2);
    }
    // The deck: grip tape on top, the graphic underneath, kicked up at both ends.
    const top = upside ? this.color : 0x161616;
    g.rect(x - half, y - 6, half * 2, 2).fill(top);
    if (!upside) g.rect(x - half + 1, y - 6, half * 2 - 2, 1).fill(0x2c2c2c);
    if (half > 4) {
      g.rect(x - half - 1, y - 7, 2, 2).fill(top);
      g.rect(x + half - 1, y - 7, 2, 2).fill(top);
    }
    // A sliver of the graphic along the edge (the board's colour).
    if (!upside) {
      g.rect(x - half, y - 4, half * 2, 1).fill(this.color);
      // (The gold deck shines: a glint running along it.)
      if (DECKS[this.kit.deck]?.shine) g.rect(x - half + Math.floor((performance.now() / 40) % (half * 2 + 12)) - 6, y - 4, 2, 1).fill(0xfff8d8);
    }
    void facing;
  }

  destroy() {
    this.g.destroy();
    this.glowG.destroy();
    this.trailG.destroy();
    this.litGlow?.destroy();
    this.litTrail?.destroy();
  }
}

// ---- the board by the gate: modes and today's best -------------------------------

class SkateBoardPanel extends Panel {
  runs: { name: string; points: number }[] = [];
  combos: { name: string; points: number }[] = [];

  constructor(
    private start: (mode: GameMode) => void,
    private mine: () => { run: number; combo: number },
    private skating: () => boolean,
    private stop: () => void,
  ) {
    super("🛹 Skatepark", "skate-board");
  }

  render() {
    this.body.replaceChildren();
    const modes = el("div", "skate-modes");
    const mode = (icon: string, name: string, what: string, m: GameMode) => {
      const b = button("", () => (this.hide(), this.start(m)), "skate-mode");
      b.append(el("span", "skate-mode-icon", icon), el("strong", "", name), el("span", "hint", what));
      modes.append(b);
    };
    mode("🛹", "Free skate", "Just ride. Every combo you land counts.", "free");
    mode("⏱️", "60-second run", "Score all you can before the horn.", "run");
    mode("🔗", "Line", "One combo, as long as you can keep it going.", "line");
    this.body.append(modes);
    if (this.skating()) this.body.append(button("Get off the board", () => (this.hide(), this.stop()), "small"));
    const me = this.mine();
    const list = (title: string, rows: { name: string; points: number }[], best: number) => {
      const box = el("div", "skate-list");
      box.append(el("h3", "", title));
      if (!rows.length) box.append(el("p", "empty", "Nobody yet today. Be the first!"));
      rows.forEach((r, i) => {
        const row = el("div", "skate-row");
        row.append(el("span", "skate-rank", `${i + 1}`), el("span", "skate-name", r.name), el("span", "skate-pts", fmt(r.points)));
        box.append(row);
      });
      if (best) box.append(el("p", "hint", `Your best ever: ${fmt(best)}`));
      return box;
    };
    const lists = el("div", "skate-lists");
    lists.append(list("⏱️ Today's best runs", this.runs, me.run), list("🔗 Today's best combos", this.combos, me.combo));
    this.body.append(lists);
    const keys = el("details", "skate-keys");
    keys.append(el("summary", "", "How to skate"));
    for (const [k, what] of [
      ["Arrows / WASD", "Ride: turn your way and push off. Pull back to stop."],
      ["Space", "Hold to crouch, let go to ollie (the longer, the higher)."],
      ["Space (on a ramp)", "Going up a ramp: pop out off it, forward (with a direction held, that way: ramp to ramp, or right over one)."],
      ["Out of a quarter", "Up out of a quarter pipe, hold the way out over its lip: you fly on out of it instead of back in."],
      ["Drop in", "Ride into a ramp from behind its tall end: over the coping and down."],
      ["Space (in the air)", "A trick! Off a ramp, a full flip head over heels (Backflip, ↑ Frontflip, ← Rodeo, → Misty): get round before you land! Anywhere else, a kickflip."],
      ["J", "In the air: flip. Which by the arrow held: none Kickflip, ← Heelflip, → Varial, ↑ Hardflip, ↓ Shove-it. J again quick: a double."],
      ["K", "In the air: grab (hold it for more). Let go before you land!"],
      ["Q / E", "Spin. Land straight (or backwards) or you bail."],
      ["Rails, ledges", "Come down on them moving along them: a grind. ← → to balance, Space to pop off."],
      ["L", "Manual: balance with ← →. Land into one to keep your combo going."],
      ["Trucks", "Which tricks you can do: stock trucks ollie, grab, 50-50 and manual. Flips, every grind and the big flips need better trucks from Dusty's van."],
      ["Esc", "Get off your board."],
    ]) {
      const row = el("div", "skate-key");
      row.append(el("kbd", "", k), el("span", "", what));
      keys.append(row);
    }
    this.body.append(keys);
  }
}

// ---- the show ------------------------------------------------------------------

export class SkatePark {
  readonly park: Park;
  private me: Skater | null = null;
  private myRig: Rig | null = null;
  private mode: GameMode = "free";
  private run = { phase: "" as "" | "count" | "go" | "over", left: 0, score: 0, overAt: 0 };
  private lineDone = false;
  /** Your board, as you've built it (skatekit.ts). */
  private kit: Kit = { ...STOCK };
  private lockedAt = 0;
  private others = new Map<number, Other>();
  private acc = 0;
  private last = 0;
  private sentAt = 0;
  private lastSent = "";
  private travelled = 0;
  private wasGrinding: "" | "rail" | "ledge" = "";
  /** Held keys, and presses waiting for the next step. */
  private keys = new Set<string>();
  private flipPressed = false;
  private manualPressed = false;
  private stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private held = { pop: false, grab: false, spinL: false, spinR: false };
  readonly boardPanel: SkateBoardPanel;

  // The HUD.
  private hud = el("div", "skate-hud");
  private scoreEl = el("div", "skate-score");
  private comboEl = el("div", "skate-combo");
  private popEl = el("div", "skate-pops");
  private balanceEl = el("div", "skate-balance");
  private specialEl = el("div", "skate-special");
  private feedEl = el("div", "skate-feed");
  private bigEl = el("div", "skate-big");
  private touchEl = el("div", "skate-touch");
  private stickEl = el("div", "pb-stick move");
  private enterBtn: HTMLButtonElement;
  private offBtn: HTMLButtonElement;
  private floats: { el: HTMLElement; id: number; until: number; y: number }[] = [];

  constructor(
    private scene: Scene,
    map: ZoneMap,
    private labels: HTMLElement,
    private canvas: HTMLCanvasElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private nameOf: (id: number) => string,
    private send: (m: SkateSend) => void,
    private toast: (text: string, ms?: number) => void,
    private eco: Economy,
    /** The night's lights (DayNight), for glows and trails that shine after dark. */
    private lit: Container | null = null,
  ) {
    this.park = Park.fromMap(map)!;
    this.boardPanel = new SkateBoardPanel(
      (m) => this.start(m),
      () => this.bests(),
      () => !!this.me,
      () => this.stop(),
    );
    // The HUD: the score up top, the combo building below the middle, the balance, popups.
    const top = el("div", "skate-top");
    top.append(this.scoreEl, this.specialEl);
    this.balanceEl.append(el("div", "skate-needle"));
    this.offBtn = button("Get off ✕", () => this.stop(), "skate-off");
    this.hud.append(top, this.comboEl, this.balanceEl, this.popEl, this.bigEl, this.feedEl, this.touchEl, this.stickEl, this.offBtn);
    this.stickEl.append(el("div", "pb-stick-knob"));
    this.stickEl.hidden = true;
    this.hud.hidden = true;
    document.body.append(this.hud);
    this.enterBtn = button("🛹 Skate!", () => this.boardPanel.show(), "skate-enter");
    this.enterBtn.hidden = true;
    document.body.append(this.enterBtn);
    this.buildTouch();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  /** On a board: the keys and the screen are the board's. */
  get capturing(): boolean {
    return !!this.me;
  }

  /** Whether `id` is skating (their avatar's the park's to draw). */
  skating(id: number): boolean {
    return id === this.selfId() ? !!this.me : this.others.has(id);
  }

  /** Whether the tile (tx, ty) is in the park (where you can get on a board). */
  inPark(tx: number, ty: number): boolean {
    return this.park.concreteTile(Math.floor(tx + 0.5), Math.floor(ty + 0.5));
  }

  // ---- getting on and off ----

  start(mode: GameMode) {
    const self = this.avatarOf(this.selfId());
    if (!self) return;
    const at = self.pos;
    if (!this.me) {
      if (!this.inPark(at.x, at.y)) {
        this.toast("🛹 Walk into the skatepark first, then hop on a board.", 3500);
        return;
      }
      const fx = at.x * TILE + TILE / 2;
      const fy = at.y * TILE + TILE - 4;
      this.me = new Skater(this.park, fx, fy);
      this.kit = loadKit(this.eco);
      this.me.kit = ride(this.kit);
      this.myRig = new Rig(this.scene, this.kit, this.lit);
      this.send({ t: "SkateOn", on: true, kit: packKit(this.kit) });
      document.body.classList.add("skate-playing");
      this.hud.hidden = false;
    }
    const me = this.me;
    me.combo.clear();
    me.link = 0;
    this.mode = mode;
    this.lineDone = false;
    this.run = { phase: "", left: 0, score: 0, overAt: 0 };
    me.banked = 0;
    me.bestCombo = 0;
    if (mode === "run") {
      this.run.phase = "count";
      this.run.left = COUNT_S;
      me.speed = 0;
    }
    if (mode === "line") this.bigText("🔗 Your line starts with your first trick. Keep it going!", "info", 2600);
    if (mode === "free") this.bigText("🛹 Free skate", "info", 1200);
    this.last = 0;
  }

  /** Your board, rebuilt at Dusty's van: kept, and (on it now) ridden and shown at once. */
  setKit(kit: Kit) {
    this.kit = { ...kit };
    saveKit(this.kit);
    if (!this.me) return;
    this.me.kit = ride(this.kit);
    this.myRig?.setKit(this.kit);
    this.send({ t: "SkateOn", on: true, kit: packKit(this.kit) });
  }

  /** Your board as it's built now (for the shop's window). */
  get board(): Kit {
    return this.me ? { ...this.kit } : loadKit(this.eco);
  }

  stop() {
    if (!this.me) return;
    this.me = null;
    this.myRig?.destroy();
    this.myRig = null;
    this.avatarOf(this.selfId())?.setArena(null);
    this.send({ t: "SkateOn", on: false, kit: 0 });
    sfx.quiet();
    document.body.classList.remove("skate-playing");
    this.hud.hidden = true;
    this.keys.clear();
    this.held = { pop: false, grab: false, spinL: false, spinR: false };
    this.stick = null;
  }

  // ---- what the server says ----

  onMsg(m: ServerMsg) {
    switch (m.t) {
      case "Skating":
        if (m.id === this.selfId()) return;
        if (!m.on) this.forget(m.id);
        break;
      case "Skater": {
        if (m.id === this.selfId()) return;
        const avatar = this.avatarOf(m.id);
        if (!avatar) return;
        let o = this.others.get(m.id);
        if (!o) {
          o = { snaps: [], heard: 0, kit: m.kit, rig: new Rig(this.scene, unpackKit(m.kit), this.lit) };
          this.others.set(m.id, o);
        }
        // (They've changed their board.)
        if (o.kit !== m.kit) {
          o.kit = m.kit;
          o.rig.setKit(unpackKit(m.kit));
        }
        const now = performance.now();
        o.heard = now;
        o.snaps.push({
          t: now,
          p: { x: m.x * 0.32, y: m.y * 0.32, z: m.z, heading: (m.dir / 65536) * Math.PI * 2, pose: m.pose, trick: m.trick, spin: (m.spin / 65536) * Math.PI * 2 },
        });
        if (o.snaps.length > 8) o.snaps.shift();
        break;
      }
      case "SkateEvent":
        this.onEvent(m.id, m.kind, m.points, m.label);
        break;
      case "SkateBoard":
        this.boardPanel.runs = m.runs;
        this.boardPanel.combos = m.combos;
        if (this.boardPanel.open) this.boardPanel.show();
        break;
    }
  }

  /** Someone else's combo landed (or bail, or run): over their head, and (a big one) in the feed. */
  private onEvent(id: number, kind: number, points: number, label: string) {
    const avatar = this.avatarOf(id);
    const name = this.nameOf(id);
    if (kind === SCORE.BAIL) {
      if (avatar) this.float(id, "💥 Bail!", "bail");
      return;
    }
    if (avatar) this.float(id, `+${fmt(points)}`, kind === SCORE.RUN ? "run" : "combo");
    if (kind === SCORE.RUN) this.feed(`⏱️ ${name} finished a run: ${fmt(points)}`);
    else if (points >= 2000) this.feed(`🔥 ${name}: ${label} — ${fmt(points)}`);
  }

  /** Off the board (they've stepped off, or gone). */
  forget(id: number) {
    const o = this.others.get(id);
    if (!o) return;
    o.rig.destroy();
    this.others.delete(id);
    this.avatarOf(id)?.setArena(null);
  }

  // ---- every frame ----

  update(wallNow: number) {
    const self = this.avatarOf(this.selfId());
    // The "Skate!" button while you're in the park on foot.
    const inPark = !!self && !this.me && this.inPark(self.pos.x, self.pos.y);
    if (this.enterBtn.hidden === inPark) this.enterBtn.hidden = !inPark;
    if (this.me && self) this.play(wallNow, self);
    this.drawOthers(wallNow);
    this.placeFloats(wallNow);
  }

  private play(wallNow: number, self: Avatar) {
    const me = this.me!;
    const dt = this.last ? Math.min(0.1, (wallNow - this.last) / 1000) : 0;
    this.last = wallNow;
    // The run's clock.
    if (this.mode === "run") this.runClock(dt, me);
    const frozen = this.mode === "run" && (this.run.phase === "count" || this.run.phase === "over");
    this.acc += dt;
    const inp = frozen ? NO_INPUT : this.input();
    let first = true;
    const before = { x: me.x, y: me.y };
    while (this.acc >= STEP_S) {
      this.acc -= STEP_S;
      // (A press counts once.)
      const step = first ? inp : { ...inp, flip: false, manual: false };
      first = false;
      for (const e of me.step(STEP_S, step)) this.onSkate(e);
    }
    if (!first) {
      this.flipPressed = false;
      this.manualPressed = false;
    }
    this.travelled += Math.hypot(me.x - before.x, me.y - before.y);
    // Sounds of the wheels and grinds.
    const grinding = me.mode === "grind" && me.grind ? me.grind.line.kind : "";
    if (grinding !== this.wasGrinding) this.wasGrinding = grinding;
    sfx.rolling(me.mode === "ground" || me.mode === "manual" ? me.speed : 0, grinding, this.travelled);
    // Drawn.
    const pose = this.myPose(me);
    this.myRig?.draw(self, pose, this.park.height(me.x, me.y), wallNow);
    // Told.
    if (wallNow - this.sentAt >= SEND_MS) this.sendMove(wallNow, pose);
    this.drawHud(me);
  }

  private myPose(me: Skater): Pose {
    const pose =
      me.mode === "bail"
        ? POSE.BAIL
        : me.mode === "air"
          ? POSE.AIR
          : me.mode === "grind"
            ? POSE.GRIND
            : me.mode === "manual"
              ? POSE.MANUAL
              : me.crouch > 0
                ? POSE.CROUCH
                : POSE.ROLL;
    return {
      x: me.x,
      y: me.y,
      z: me.z,
      heading: me.heading,
      pose,
      trick: me.trickCode,
      spin: me.mode === "air" ? me.air.spin : 0,
      flipT: me.flip ? (me.flip.t / me.flip.dur) % 1 : undefined,
      bodyT: me.body ? Math.min(1, me.body.t / me.body.dur) : undefined,
      push: me.pushing ? me.push : 0,
      balance: me.balance,
      crouch: me.crouch,
      bailT: me.bailT,
    };
  }

  private sendMove(wallNow: number, p: Pose) {
    const x = Math.max(0, Math.min(65535, Math.round((p.x / TILE) * 100)));
    const y = Math.max(0, Math.min(65535, Math.round((p.y / TILE) * 100)));
    const z = Math.max(0, Math.min(255, Math.round(p.z)));
    const turn = (a: number) => ((Math.round((a / (Math.PI * 2)) * 65536) % 65536) + 65536) % 65536;
    const trick = p.pose === POSE.ROLL && p.push ? PUSH_CODE + Math.min(15, Math.floor((p.push / PUSH_S) * 15)) : p.trick;
    const m = { t: "SkateMove" as const, x, y, z, dir: turn(p.heading), pose: p.pose, trick, spin: turn(p.spin) };
    const key = `${x},${y},${z},${m.dir},${m.pose},${m.trick},${m.spin}`;
    // (Standing still, now and then: the server knows you're still there.)
    if (key === this.lastSent && wallNow - this.sentAt < 1000) return;
    this.lastSent = key;
    this.sentAt = wallNow;
    this.send(m);
  }

  private drawOthers(wallNow: number) {
    for (const [id, o] of this.others) {
      const avatar = this.avatarOf(id);
      if (!avatar || wallNow - o.heard > GONE_MS) {
        this.forget(id);
        continue;
      }
      // Between the two moves either side of a beat ago.
      const t = wallNow - BEHIND_MS;
      const s = o.snaps;
      let a = s[0];
      let b = s[0];
      for (let i = 0; i < s.length; i++) {
        if (s[i].t <= t) a = s[i];
        if (s[i].t >= t) {
          b = s[i];
          break;
        }
        b = s[i];
      }
      const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
      const p: Pose = {
        x: a.p.x + (b.p.x - a.p.x) * f,
        y: a.p.y + (b.p.y - a.p.y) * f,
        z: a.p.z + (b.p.z - a.p.z) * f,
        heading: lerpAngle(a.p.heading, b.p.heading, f),
        pose: b.p.pose,
        trick: b.p.trick,
        spin: lerpAngle(a.p.spin, b.p.spin, f),
        bailT: b.p.pose === POSE.BAIL ? 0.3 : undefined,
      };
      // Pushing off (its stroke's phase sent in place of a trick).
      if (p.pose === POSE.ROLL && p.trick >= PUSH_CODE) {
        p.push = ((p.trick - PUSH_CODE) / 15) * PUSH_S;
        p.trick = 0;
      }
      o.rig.draw(avatar, p, this.park.height(p.x, p.y), wallNow);
    }
  }


  // ---- what happened on your board ----

  private onSkate(e: SkateEvent) {
    const me = this.me!;
    switch (e.t) {
      case "push":
        sfx.push();
        break;
      case "pop":
        sfx.pop(e.power);
        break;
      case "flip":
        sfx.flip(e.kind);
        break;
      case "land":
        sfx.land(e.hard);
        break;
      case "wall":
        sfx.wall(e.speed);
        break;
      case "grind":
        if (e.on) sfx.grindOn(e.kind);
        break;
      case "trick":
        sfx.counted(me.combo.count);
        this.pop(`${e.name}`, me.combo.count);
        if (this.mode === "line" && this.lineDone) this.lineDone = false;
        break;
      case "special":
        sfx.special();
        this.bigText("✨ SPECIAL! Tricks worth 1.5×", "special", 1800);
        break;
      case "locked": {
        // (Now and then: not every time you try.)
        const now = performance.now();
        if (now - this.lockedAt > 4000) {
          this.lockedAt = now;
          const what = { flip: "That flip", double: "A double", grab: "That grab", grind: "That grind", body: "A full flip" }[e.what];
          this.toast(`🔒 ${what} needs ${needs(e.what)}. Dusty's van has them.`, 3500);
        }
        break;
      }
      case "sketchy":
        this.bigText("Sketchy!", "warn", 800);
        break;
      case "bail":
        sfx.bail();
        if (e.lost > 0) sfx.lost();
        this.bigText(`💥 BAIL! ${e.why}${e.lost ? `  (lost ${fmt(e.lost)})` : ""}`, "bail", 1800);
        this.send({ t: "SkateScore", kind: SCORE.BAIL, points: e.lost, label: e.why });
        if (this.mode === "line" && e.lost > 0) this.lineOver(0, "");
        break;
      case "bank": {
        sfx.banked(e.pts, e.count);
        this.bigText(`+${fmt(e.pts)}`, e.pts >= 5000 ? "huge" : e.pts >= 1500 ? "big" : "ok", 1600, e.label);
        if (this.mode === "run" && this.run.phase === "go") this.run.score += e.pts;
        if (e.pts >= TELL_PTS) this.send({ t: "SkateScore", kind: SCORE.COMBO, points: e.pts, label: e.label });
        this.saveBest("combo", e.pts);
        if (this.mode === "line") this.lineOver(e.pts, e.label);
        break;
      }
    }
  }

  private lineOver(pts: number, label: string) {
    this.lineDone = true;
    const best = this.bests().combo;
    window.setTimeout(() => {
      if (!this.me || this.mode !== "line") return;
      this.bigText(pts ? `🔗 Line: ${fmt(pts)}${pts >= best ? "  🏆 Your best!" : ""}` : "🔗 Line lost. Go again!", pts ? "big" : "bail", 2600, label);
    }, 900);
  }

  private runClock(dt: number, me: Skater) {
    const r = this.run;
    if (r.phase === "count") {
      const was = Math.ceil(r.left);
      r.left -= dt;
      const now = Math.ceil(r.left);
      if (now !== was) {
        sfx.countdown(Math.max(0, now));
        this.bigText(now > 0 ? `${now}` : "GO!", "count", 700);
      }
      if (r.left <= 0) {
        r.phase = "go";
        r.left = RUN_S;
      }
    } else if (r.phase === "go") {
      r.left -= dt;
      if (r.left <= 0) {
        r.left = 0;
        // A trick still going: it's let finish (a few seconds at most).
        if (me.mode === "ground" || me.mode === "bail" || r.overAt > 3) {
          const ev: SkateEvent[] = [];
          me.finish(ev);
          for (const e of ev) this.onSkate(e);
          r.phase = "over";
          // (Stood still till you pick what next: nothing more counts.)
          me.speed = 0;
          sfx.horn();
          const best = this.bests().run;
          this.saveBest("run", r.score);
          this.send({ t: "SkateScore", kind: SCORE.RUN, points: r.score, label: "" });
          this.bigText(`⏱️ Time! ${fmt(r.score)}${r.score > best ? "  🏆 Your best!" : ""}`, "huge", 4000);
          window.setTimeout(() => {
            if (this.me && this.mode === "run" && this.run.phase === "over") this.boardPanel.show();
          }, 2600);
        } else r.overAt += dt;
      }
    }
  }

  // ---- the HUD ----

  private drawHud(me: Skater) {
    const r = this.run;
    const head =
      this.mode === "run"
        ? `<span class="skate-mode-name">⏱️ ${r.phase === "count" ? "Get ready…" : r.phase === "over" ? "Time!" : `${Math.ceil(r.left)}s`}</span><b>${fmt(r.score)}</b>`
        : this.mode === "line"
          ? `<span class="skate-mode-name">🔗 Line</span><b>${fmt(me.combo.total)}</b>`
          : `<span class="skate-mode-name">🛹 Free skate</span><b>${fmt(me.banked)}</b><span class="skate-best">best combo ${fmt(me.bestCombo)}</span>`;
    if (this.scoreEl.innerHTML !== head) this.scoreEl.innerHTML = head;
    this.specialEl.style.setProperty("--fill", `${Math.round(me.special * 100)}%`);
    this.specialEl.classList.toggle("full", me.special >= 1);
    // The combo building: its tricks, its points × how many.
    const c = me.combo;
    if (c.count) {
      const names = c.tricks.slice(-4).map((t) => t.name);
      const text = `${c.count > 4 ? "… + " : ""}${names.join(" + ")}`;
      const pts = `${fmt(c.base)} × ${c.count}`;
      if (this.comboEl.dataset.k !== text + pts) {
        this.comboEl.dataset.k = text + pts;
        this.comboEl.replaceChildren(el("div", "skate-combo-names", text), el("div", "skate-combo-pts", pts));
      }
      this.comboEl.hidden = false;
    } else this.comboEl.hidden = true;
    // The balance (grinding or on a manual).
    const balancing = me.mode === "grind" || me.mode === "manual";
    this.balanceEl.hidden = !balancing;
    if (balancing) {
      (this.balanceEl.firstElementChild as HTMLElement).style.left = `${50 + Math.max(-1, Math.min(1, me.balance)) * 48}%`;
      this.balanceEl.classList.toggle("tipping", Math.abs(me.balance) > 0.65);
    }
    // The stick under your thumb.
    this.stickEl.hidden = !this.stick;
    if (this.stick) {
      this.stickEl.style.transform = `translate(${this.stick.x0}px, ${this.stick.y0}px)`;
      const dx = this.stick.x - this.stick.x0;
      const dy = this.stick.y - this.stick.y0;
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      (this.stickEl.firstElementChild as HTMLElement).style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  }

  /** A trick's name popping up as it's counted. */
  private pop(text: string, n: number) {
    const p = el("div", "skate-pop", text);
    p.style.setProperty("--n", String(Math.min(10, n)));
    this.popEl.append(p);
    while (this.popEl.children.length > 4) this.popEl.firstElementChild?.remove();
    window.setTimeout(() => p.remove(), 1100);
  }

  /** Big text in the middle: a banked combo, a bail, the countdown. */
  private bigText(text: string, kind: string, ms: number, sub = "") {
    this.bigEl.replaceChildren(el("div", `skate-big-main ${kind}`, text));
    if (sub) this.bigEl.append(el("div", "skate-big-sub", sub));
    this.bigEl.classList.remove("show");
    void this.bigEl.offsetWidth;
    this.bigEl.classList.add("show");
    const mine = this.bigEl.firstElementChild;
    window.setTimeout(() => {
      if (this.bigEl.firstElementChild === mine) this.bigEl.classList.remove("show");
    }, ms);
  }

  private feed(text: string) {
    const line = el("div", "skate-feed-line", text);
    this.feedEl.append(line);
    while (this.feedEl.children.length > 4) this.feedEl.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 6000);
  }

  /** Over someone's head for a moment (their points, a bail). */
  private float(id: number, text: string, kind: string) {
    const f = el("div", `skate-float ${kind}`, text);
    this.labels.append(f);
    this.floats.push({ el: f, id, until: performance.now() + 1600, y: 0 });
  }

  private placeFloats(wallNow: number) {
    this.floats = this.floats.filter((f) => {
      const a = this.avatarOf(f.id);
      if (!a || wallNow > f.until) {
        f.el.remove();
        return false;
      }
      const left = (f.until - wallNow) / 1600;
      const s = this.scene.tileToScreen(a.shown.x + 0.5, a.shown.y - 1.2 - (1 - left) * 0.8);
      f.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
      f.el.style.opacity = String(Math.min(1, left * 2));
      return true;
    });
  }

  private bests(): { run: number; combo: number } {
    try {
      return JSON.parse(localStorage.getItem("commons.skate") ?? "") ?? { run: 0, combo: 0 };
    } catch {
      return { run: 0, combo: 0 };
    }
  }

  private saveBest(kind: "run" | "combo", pts: number) {
    const b = this.bests();
    if (pts <= (b[kind] ?? 0)) return;
    b[kind] = pts;
    try {
      localStorage.setItem("commons.skate", JSON.stringify(b));
    } catch {
      /* (A private window: no bests kept.) */
    }
  }

  // ---- input ----

  private input(): Input {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has("ArrowLeft") || k.has("KeyA")) x -= 1;
    if (k.has("ArrowRight") || k.has("KeyD")) x += 1;
    if (k.has("ArrowUp") || k.has("KeyW")) y -= 1;
    if (k.has("ArrowDown") || k.has("KeyS")) y += 1;
    if (this.stick) {
      const dx = this.stick.x - this.stick.x0;
      const dy = this.stick.y - this.stick.y0;
      const d = Math.hypot(dx, dy);
      if (d > 8) {
        const m = Math.min(1, d / STICK_R);
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }
    const d = Math.hypot(x, y);
    if (d > 1) {
      x /= d;
      y /= d;
    }
    const spin = (k.has("KeyQ") || this.held.spinL ? -1 : 0) + (k.has("KeyE") || this.held.spinR ? 1 : 0);
    return {
      x,
      y,
      pop: k.has("Space") || this.held.pop,
      flip: this.flipPressed,
      manual: this.manualPressed,
      grab: k.has("KeyK") || this.held.grab,
      spin,
    };
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.me || isTyping(e)) return;
    const code = e.code;
    const used = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyJ", "KeyK", "KeyL", "KeyQ", "KeyE", "Escape"];
    if (!used.includes(code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (code === "Escape") {
      if (!e.repeat) this.stop();
      return;
    }
    this.keys.add(code);
    if (e.repeat) return;
    if (code === "KeyJ") this.flipPressed = true;
    if (code === "KeyL") this.manualPressed = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const had = this.keys.delete(e.code);
    if (had && this.me) e.stopPropagation();
  };

  private onBlur = () => {
    this.keys.clear();
    this.stick = null;
    this.held = { pop: false, grab: false, spinL: false, spinR: false };
  };

  private onDown = (e: PointerEvent) => {
    if (!this.me || e.pointerType !== "touch") return;
    e.preventDefault();
    document.body.classList.add("skate-touch-mode");
    if (e.clientX < window.innerWidth / 2 && !this.stick) this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.stick || this.stick.id !== e.pointerId) return;
    this.stick.x = e.clientX;
    this.stick.y = e.clientY;
    const dx = this.stick.x - this.stick.x0;
    const dy = this.stick.y - this.stick.y0;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R * 1.35) {
      const k = (d - STICK_R * 1.35) / d;
      this.stick.x0 += dx * k;
      this.stick.y0 += dy * k;
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.stick && this.stick.id === e.pointerId) this.stick = null;
  };

  /** On a phone: Ollie (hold to crouch), Flip, Grab (hold), Manual, and the two spins. */
  private buildTouch() {
    const hold = (label: string, cls: string, key: keyof typeof this.held) => {
      const b = button(label, () => {}, `skate-btn ${cls}`);
      const on = (v: boolean) => (ev: PointerEvent) => {
        ev.preventDefault();
        this.held[key] = v;
        b.classList.toggle("down", v);
      };
      b.addEventListener("pointerdown", on(true));
      b.addEventListener("pointerup", on(false));
      b.addEventListener("pointercancel", on(false));
      b.addEventListener("pointerleave", on(false));
      return b;
    };
    const tap = (label: string, cls: string, run: () => void) => {
      const b = button(label, () => {}, `skate-btn ${cls}`);
      b.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        run();
      });
      return b;
    };
    const row1 = el("div", "skate-touch-row");
    row1.append(hold("↺", "spin", "spinL"), hold("↻", "spin", "spinR"));
    const row2 = el("div", "skate-touch-row");
    row2.append(
      tap("Flip", "flip", () => (this.flipPressed = true)),
      hold("Grab", "grab", "grab"),
    );
    const row3 = el("div", "skate-touch-row");
    row3.append(
      tap("Manual", "manual", () => (this.manualPressed = true)),
      hold("Ollie", "ollie", "pop"),
    );
    this.touchEl.append(row1, row2, row3);
  }

  destroy() {
    this.stop();
    for (const id of [...this.others.keys()]) this.forget(id);
    for (const f of this.floats) f.el.remove();
    this.hud.remove();
    this.enterBtn.remove();
    this.boardPanel.hide();
    this.boardPanel.el.remove();
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
  }
}

