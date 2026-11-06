// Caesar's disasters, on the client: the strip saying what's coming and
// when, the spectators' vote, the stone wheel in the middle of the sand, and
// the disaster itself: meteors marked on the sand and falling, and the lions.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import * as dfx from "../ambient/disasterfx";
import * as fx from "../ambient/wheelsfx";
import { el } from "../ui/panels";
import { CLOUD_BASE, CLOUD_FRAME_MS, CLOUD_FRAMES, CLOUD_PX, cloudFrames } from "../world/acidcloud";
import { drawLion, easeRig, LION_HEIGHT, lionRig, type LionAct, type LionRig } from "../world/lionart";
import { drawScorpion, SCORPION_HEIGHT, scorpionRig, type ScorpionAct, type ScorpionRig } from "../world/scorpionart";
import { StoneWheel } from "../world/stonewheel";
import { ThiefShow } from "./arenathief";

/** As `arena::disaster`. */
export const DISASTER = { NONE: 0, LAVA: 1, METEORS: 2, LIONS: 3, SCORPION: 4, ACID: 5 };
const STAGE = { VOTING: 0, SPIN: 1, DECIDED: 2, ON: 3 };
/** As `arena::lion`. */
const LION = { EMERGE: 0, PROWL: 1, CROUCH: 2, LEAP: 3, RECOVER: 4, DEAD: 5, SPIT: 6, RUSH: 9 };
/** The little scorpions' ids start here (as `arena::THIEF_ID`). */
export const THIEF_ID = 200;

/** As `arena::LION_HP`, `LION_CROUCH_MS`, `LION_LEAP_MS`, `LION_EMERGE_MS`, `METEOR_WARN_MS`, `METEOR_RAIN_MS`. */
export const LION_HP = 24;
export const LION_CROUCH_MS = 480;
export const LION_LEAP_MS = 260;
export const LION_EMERGE_MS = 1200;
export const METEOR_WARN_MS = 1500;
export const METEOR_RAIN_MS = 26_000;
/** As `arena::SCORPION_HP`, `SCORPION_SINK_MS`, `_WAIT_MS`, `_RISE_MS`, `_ROAR_MS`, `STING_WIND_MS`, `DART_WIND_MS`, `ACID_RX`, `ACID_RY`, `ACID_OFF`. */
export const SCORPION_HP = 100;
export const SCORPION_SINK_MS = 1700;
export const SCORPION_WAIT_MS = 700;
export const SCORPION_RISE_MS = 2300;
export const SCORPION_ROAR_MS = 1000;
export const STING_WIND_MS = 460;
export const STING_QUICK_WIND_MS = 300;
export const DART_WIND_MS = 440;
export const ACID_RX = 2.5;
export const ACID_RY = 1.5;
export const ACID_OFF = 6;
/** How high they ride (px), and how many drops each lets fall at a time. */
const CLOUD_RIDE = 78;
const RAIN_DROPS = 22;

export const KINDS: Record<number, { icon: string; name: string; hint: string; color: string; hue: number; caesar: string }> = {
  [DISASTER.LAVA]: { icon: "🌋", name: "LAVA", hint: "it's flowing in: get to the middle!", color: "#ff7a1a", hue: 0xff7a1a, caesar: "LET THE EARTH BURN!" },
  [DISASTER.METEORS]: { icon: "☄️", name: "METEORS", hint: "watch the red marks on the sand!", color: "#ff5a3a", hue: 0xff5a3a, caesar: "THE GODS ARE ANGRY!" },
  [DISASTER.LIONS]: { icon: "🦁", name: "LIONS", hint: "one for each of you: watch for the spring!", color: "#ffd23f", hue: 0xffd23f, caesar: "RELEASE THE LIONS!" },
  [DISASTER.SCORPION]: { icon: "🦂", name: "SCORPION", hint: "get off the wheel!", color: "#c86eff", hue: 0xc86eff, caesar: "AWAKEN THE BEAST!" },
  [DISASTER.ACID]: { icon: "🌧️", name: "ACID RAIN", hint: "keep out from under the clouds: there's more coming!", color: "#96f046", hue: 0x96f046, caesar: "LET IT RAIN!" },
};

interface LionState {
  id: number;
  kind: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  act: number;
  actMs: number;
  toX: number;
  toY: number;
  item: number;
}

interface DisasterState {
  status: number;
  disasters: boolean;
  now: number;
  disaster: number;
  disasterStage: number;
  disasterMs: number;
  disasterVotes: number[];
  disasterPool: number;
  lava: number;
  lions: LionState[];
  clouds: { id: number; x: number; y: number }[];
}

/** The scorpion, as shown. */
interface Beast {
  g: Graphics;
  /** Its eyes in the dark of the shaft. */
  eyes: Graphics;
  /** So it's no less there after dark: it's a dark thing on dark stone. */
  light: Sprite | null;
  /** It came at them on the run: a shorter wind-up. */
  rushed: boolean;
  /** What hides it behind the shaft's near lip as it comes up. */
  mask: Graphics;
  x: number;
  y: number;
  step: number;
  hurtUntil: number;
  face: 1 | -1;
  turn: number;
  rig: ScorpionRig;
  fade: number;
  rose: boolean;
  roared: boolean;
  goneAt: number;
}

/** An acid cloud, as shown. */
interface Puff {
  x: number;
  y: number;
  id: number;
  seed: number;
  seen: number;
  sprite: Sprite;
  /** How much of it there is: coming in over the wall, going out with the round. */
  show: number;
}

interface Rock {
  x: number;
  y: number;
  r: number;
  /** When it lands (wall ms), when it was marked, a bit of each's own wobble. */
  at: number;
  from: number;
  seed: number;
}

/** What it needs of the arena. */
export interface DisasterHost {
  /** Arena tiles to world px. */
  wx(x: number): number;
  wy(y: number): number;
  tile: number;
  /** The middle of the sand (tiles), and the sand's depth in the scene. */
  mid: { x: number; y: number };
  floorZ: number;
  /** Where the lions go in the scene (sorted by feet). */
  sorted: Container;
  /** Whether the vote's open to us: not fighting (or fallen), and by the ring. */
  canVote(): boolean;
  /** Whether we're anywhere near the arena (nothing of this shows from across town). */
  inSight(): boolean;
  /** Whether the lava (come in this far) is nearly at our feet. */
  lavaClose(lava: number): boolean;
  vote(kind: number): void;
  /** How close we are to (x, y), 0..1 (for sound). */
  near(x: number, y: number): number;
  /** Puffs of dust at (x, y). */
  dust(x: number, y: number, n: number): void;
  /** Rocks the camera. */
  shake(k: number): void;
  /** A ring out from (x, y). */
  ring(x: number, y: number, color: number, r: number): void;
  /** A light of its own after dark, at world (x, y). */
  glow(x: number, y: number): Sprite | null;
  /** A light for this one frame, after dark, at world (x, y) (`sx`, `sy`: 1 is 64 px across). */
  light(x: number, y: number, tint: number, sx: number, sy: number, alpha: number): void;
  /** A gift's little picture. */
  giftTex(kind: number): Texture;
}

export class DisasterShow {
  /** The strip across the top: what's coming, and when. */
  private strip = el("div", "ar-dis");
  private title = el("div", "ar-dis-title");
  private tally = el("div", "ar-dis-tally");
  /** The spectators' vote. */
  private vote = el("div", "ar-vote");
  private buttons = new Map<number, { b: HTMLButtonElement; n: HTMLElement }>();
  private wheel: StoneWheel;
  private mine = 0;
  private round = -1;
  private stage = -1;
  private rocks: Rock[] = [];
  private craters: { x: number; y: number; r: number; until: number; seed: number }[] = [];
  private lions = new Map<number, { g: Graphics; x: number; y: number; step: number; hurtUntil: number; face: 1 | -1; turn: number; deadFade: number; rig: LionRig; act: number; landAt: number; goneAt: number }>();
  /** The lava's roar, while it's going. */
  private stopChurn: (() => void) | null = null;
  /** Anything coming out of the gates: they stand open. */
  gatesOpen = false;
  /** When the shower ends (wall ms). */
  private rainUntil = 0;
  private beast: Beast | null = null;
  private puffs: Puff[] = [];
  /** The acid's hiss, while it's going. */
  private stopAcid: (() => void) | null = null;
  /** The clouds themselves, over the rain. */
  private sky = new Container();
  /** There's been rain: its hiss can stop when it's over. */
  private rained = false;
  private thieves: ThiefShow;
  /** The last crater to be heard. */
  private thudAt = 0;

  constructor(private host: DisasterHost) {
    this.thieves = new ThiefShow(host);
    this.strip.append(this.title, this.tally);
    this.strip.hidden = true;
    const head = el("div", "ar-vote-head", "🏛️ Vote for the disaster!");
    const row = el("div", "ar-vote-row");
    for (const k of [DISASTER.LAVA, DISASTER.METEORS, DISASTER.LIONS, DISASTER.SCORPION, DISASTER.ACID]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ar-vote-btn";
      const n = el("span", "ar-vote-n", "0");
      b.append(el("span", "ar-vote-icon", KINDS[k].icon), el("span", "ar-vote-name", KINDS[k].name), n);
      b.onclick = () => {
        if (!this.host.canVote()) return;
        this.mine = k;
        this.host.vote(k);
        dfx.voteClack();
        this.paintVotes();
      };
      this.buttons.set(k, { b, n });
      row.append(b);
    }
    this.vote.append(head, row);
    this.vote.hidden = true;
    document.body.append(this.strip, this.vote);
    // The wheel, set in the sand: as wide as the clear ground between the pillars.
    this.wheel = new StoneWheel(host.tile * 5.6);
    this.wheel.sprite.position.set(host.wx(host.mid.x), host.wy(host.mid.y));
    this.wheel.sprite.zIndex = host.floorZ + 0.2;
    this.wheel.sprite.visible = false;
    host.sorted.addChild(this.wheel.sprite);
    this.wheel.onPeg = (speed, kind, left) => fx.peg(speed, kind - 1, left);
  }

  /** Whether the great scorpion's about. */
  get beastUp(): boolean {
    return !!this.beast;
  }

  private paintVotes() {
    for (const [k, { b }] of this.buttons) b.classList.toggle("on", k === this.mine);
  }

  /** Every frame. */
  update(s: DisasterState | null, round: number, serverNow: number, wallNow: number, dt: number) {
    const live = !!s && s.status === 2 && this.host.inSight();
    if (round !== this.round) {
      this.round = round;
      this.mine = 0;
      this.paintVotes();
      this.wheel.reset();
    }
    // (Set in the sand for the whole of a match, turning or not.)
    this.wheel.sprite.visible = !!s && s.status !== 0 && s.disasters;
    this.wheel.tick(wallNow);
    if (!live) {
      this.strip.hidden = true;
      this.vote.hidden = true;
      this.stage = -1;
      this.rocks = [];
      this.rainUntil = 0;
      this.stopRoar();
      // (Lions don't blink out with the round: they fade.)
      if (this.host.inSight()) this.retireLions(new Set(), wallNow);
      else this.clearLions();
      this.retireBeast(wallNow);
      this.thieves.retire(new Set(), wallNow);
      this.wheel.setSink(0);
      this.gatesOpen = false;
      return;
    }
    const st = s!;
    const left = Math.ceil(st.disasterMs / 1000);
    // The wheel: it turns when told; turned up late, it's already there.
    if (st.disasterStage === STAGE.VOTING && this.stage !== STAGE.VOTING) this.wheel.reset();
    if (st.disasterStage === STAGE.SPIN && this.stage !== STAGE.SPIN) {
      this.wheel.spin(st.disaster, st.disasterMs, wallNow);
      dfx.stoneGrind();
    }
    if (st.disasterStage > STAGE.SPIN && this.stage < STAGE.SPIN && st.disaster) this.wheel.settle(st.disaster, wallNow);
    this.stage = st.disasterStage;
    const kind = KINDS[st.disaster];
    // Spectators: the vote; everyone: where it's up to.
    this.vote.hidden = st.disasterStage !== STAGE.VOTING || !this.host.canVote();
    st.disasterVotes.forEach((n, i) => {
      const v = this.buttons.get(i + 1);
      if (v) v.n.textContent = String(n);
    });
    if (st.disasterStage === STAGE.VOTING) {
      this.strip.hidden = left > 20;
      this.title.textContent = `🏛️ The crowd is choosing a disaster · ${left}s`;
      this.tally.textContent = st.disasterVotes.some((n) => n > 0) ? st.disasterVotes.map((n, i) => `${KINDS[i + 1].icon} ${n}`).join("   ") : "";
    } else if (st.disasterStage === STAGE.SPIN) {
      this.strip.hidden = false;
      this.title.textContent = "🗿 The wheel is turning…";
      this.tally.textContent = "";
    } else if (st.disasterStage === STAGE.DECIDED && kind) {
      this.strip.hidden = false;
      this.title.textContent = `${kind.icon} ${kind.name} in ${left}s`;
      this.title.style.color = kind.color;
      this.tally.textContent = "";
      this.strip.classList.add("urgent");
    } else {
      this.strip.classList.remove("urgent");
      this.title.style.color = "";
      this.tally.textContent = "";
      this.showGoingOn(st, wallNow);
    }
    this.drawLions(st, serverNow, wallNow, dt);
  }

  /** While it's going on: the strip keeps you posted, then gets out of the way. */
  private showGoingOn(st: DisasterState, wallNow: number) {
    const k = KINDS[st.disaster];
    const up = st.lions.filter((l) => l.act !== LION.DEAD && l.kind !== 2).length;
    const rain = Math.ceil((this.rainUntil - wallNow) / 1000);
    let text = "";
    if (st.disaster === DISASTER.METEORS && rain > 0) text = `${k.icon} Meteors · ${rain}s`;
    else if (st.disaster === DISASTER.LIONS && up > 0) text = `${k.icon} ${up} ${up === 1 ? "lion" : "lions"} left`;
    else if (st.disaster === DISASTER.SCORPION && up > 0) text = `${k.icon} Slay the scorpion!`;
    else if (st.disaster === DISASTER.ACID && st.clouds.length > 0) text = `${k.icon} Keep clear of the clouds`;
    else if (st.disaster === DISASTER.LAVA && st.lava < 1140) {
      const close = this.host.lavaClose(st.lava / 1000);
      text = close ? "🌋 LAVA! Get to the middle!" : "🌋 The lava's rising";
      this.strip.classList.toggle("urgent", close);
    }
    this.strip.hidden = !text;
    if (text) {
      this.title.textContent = text;
      if (k) this.title.style.color = k.color;
    }
  }

  private stopRoar() {
    this.stopChurn?.();
    this.stopChurn = null;
    this.stopAcid?.();
    this.stopAcid = null;
  }

  private clearLions() {
    for (const l of this.lions.values()) l.g.destroy();
    this.lions.clear();
  }

  /** On the sand, under the fighters: each meteor's mark, closing in; old craters. */
  drawFloor(g: Graphics, wallNow: number) {
    const { wx, wy, tile } = this.bound();
    this.craters = this.craters.filter((c) => c.until > wallNow);
    this.thieves.drawFloor(g, wallNow);
    for (const c of this.craters) {
      const fade = Math.min(1, (c.until - wallNow) / 1500);
      const [x, y, r] = [wx(c.x), wy(c.y), c.r * tile * 0.62];
      g.ellipse(x, y, r, r * 0.7).fill({ color: 0x2a1c14, alpha: 0.6 * fade });
      g.ellipse(x, y, r * 0.66, r * 0.46).fill({ color: 0x120a08, alpha: 0.7 * fade });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + c.seed;
        g.rect(Math.round(x + Math.cos(a) * r * 1.1) - 2, Math.round(y + Math.sin(a) * r * 0.8) - 2, 4, 3);
      }
      g.fill({ color: 0x4a3626, alpha: fade });
      // Still glowing, a moment.
      const heat = Math.max(0, (c.until - wallNow - 2500) / 1500);
      if (heat > 0) {
        g.ellipse(x, y, r * 0.5, r * 0.34).fill({ color: 0xff6a1a, alpha: heat * 0.8 });
        this.host.light(x, y, 0xff6a1a, (r * 3) / 64, (r * 2) / 64, heat * 0.7);
      }
    }
    // Under each acid cloud, exactly where it burns: its shadow, a sick green.
    for (const p of this.puffs) {
      const [x, y] = [wx(p.x), wy(p.y)];
      const [rx, ry] = [ACID_RX * tile, ACID_RY * tile];
      g.ellipse(x, y, rx, ry).fill({ color: 0x16300c, alpha: 0.36 * p.show });
      g.ellipse(x, y, rx * 0.72, ry * 0.72).fill({ color: 0x0c2006, alpha: 0.2 * p.show });
      const breath = 0.85 + 0.15 * Math.sin(wallNow / 260 + p.seed * 6);
      this.host.light(x, y, 0x7dff3a, (rx * 2.6) / 64, (ry * 2.8) / 64, 0.5 * p.show * breath);
      this.host.light(x, y - CLOUD_RIDE, 0x9dff5a, (rx * 2) / 64, 0.8, 0.32 * p.show * breath);
      g.ellipse(x, y, rx, ry).stroke({ width: 3, color: 0xa8ff4a, alpha: (0.72 + 0.22 * Math.sin(wallNow / 200 + p.seed * 6)) * p.show });
    }
    for (const m of this.rocks) {
      const k = Math.max(0, Math.min(1, (wallNow - m.from) / (m.at - m.from)));
      const [x, y, r] = [wx(m.x), wy(m.y), m.r * tile];
      // (Each mark comes up, not on: there are a lot of them.)
      const on = Math.min(1, (wallNow - m.from) / 160);
      // The shadow of it, darkening and tightening as it comes.
      g.ellipse(x, y, r * (0.35 + 0.5 * k), r * (0.35 + 0.5 * k) * 0.7).fill({ color: 0x140808, alpha: (0.2 + 0.4 * k) * on });
      // How far the blast reaches: a hard red line, and a ring closing on it.
      const pulse = 0.55 + 0.45 * Math.sin(wallNow / (k > 0.6 ? 45 : 90));
      g.ellipse(x, y, r, r * 0.7).fill({ color: 0xff2a1a, alpha: (0.1 + 0.16 * k) * on });
      g.ellipse(x, y, r, r * 0.7).stroke({ width: 2, color: 0xff3a2a, alpha: (0.5 + 0.5 * pulse) * on });
      const ring = r * (1.5 - 0.5 * k);
      g.ellipse(x, y, ring, ring * 0.7).stroke({ width: 1, color: 0xffb03a, alpha: 0.65 * (1 - k * 0.4) * on });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4 + wallNow / 900;
        const [cx, cy] = [Math.cos(a), Math.sin(a) * 0.7];
        g.moveTo(x + cx * (r - 7), y + cy * (r - 7)).lineTo(x + cx * (r + 3), y + cy * (r + 3)).stroke({ width: 2, color: 0xffe14f, alpha: 0.9 * on });
      }
    }
  }

  /** The acid clouds over everything, and what's falling out of them. */
  private drawClouds(g: Graphics, wallNow: number) {
    const { wx, wy, tile } = this.bound();
    const [rx, ry] = [ACID_RX * tile, ACID_RY * tile];
    if (!this.sky.parent && this.puffs.length) g.parent?.addChild(this.sky);
    const frames = this.puffs.length ? cloudFrames() : [];
    const across = this.host.mid.x * 2;
    this.puffs = this.puffs.filter((p) => {
      // Out over the wall it thins away, and when it's told no more, it's going.
      const past = Math.max(-p.x, p.x - across);
      const left = 1 - (wallNow - p.seen) / 400;
      p.show = Math.max(0, Math.min(1, (ACID_OFF - past) / (ACID_OFF - ACID_RX), left));
      if (left <= 0) p.sprite.destroy();
      return left > 0;
    });
    for (const p of this.puffs) {
      if (p.show <= 0.01) {
        p.sprite.visible = false;
        continue;
      }
      const [x, y] = [wx(p.x), wy(p.y)];
      const under = y - CLOUD_RIDE;
      // The rain: drops falling all through its shadow, splashing where they land.
      for (let i = 0; i < RAIN_DROPS; i++) {
        const h = ((i * 7.31 + p.seed * 13) % 1) * 2 - 1;
        const v = ((i * 3.77 + p.seed * 7) % 1) * 2 - 1;
        const gx = Math.round(x + h * rx * 0.94);
        const gy = y + v * Math.sqrt(1 - h * h) * ry * 0.94;
        const fall = (wallNow / 430 + i * 0.137 + p.seed) % 1;
        if (fall < 0.86) g.rect(gx, Math.round(under + (gy - under) * (fall / 0.86)), 2, 7);
        else {
          const k = (fall - 0.86) / 0.14;
          const [out, up] = [Math.round(1 + k * 6), Math.round(k * (1 - k) * 8)];
          g.rect(gx - out, Math.round(gy - up), 2, 2).rect(gx + out, Math.round(gy - up), 2, 2);
        }
      }
      g.fill({ color: 0xb6ff5a, alpha: 0.8 * p.show });
      // The sprite's own bob and boil.
      const s = p.sprite;
      s.visible = true;
      s.texture = frames[(Math.floor(wallNow / CLOUD_FRAME_MS + p.seed * CLOUD_FRAMES) % CLOUD_FRAMES + CLOUD_FRAMES) % CLOUD_FRAMES];
      s.position.set(Math.round(x), Math.round(under + Math.sin(wallNow / 800 + p.seed * 6) * 2));
      // (See-through enough that nobody's lost underneath one.)
      s.alpha = 0.5 * p.show;
    }
  }

  /** In the air, over everything: the rocks themselves, streaking in on fire. */
  drawSky(g: Graphics, wallNow: number) {
    const { wx, wy } = this.bound();
    this.drawClouds(g, wallNow);
    for (const m of this.rocks) {
      const left = (m.at - wallNow) / 700;
      if (left > 1 || left < 0) continue;
      const fall = left * left;
      // Down out of the sky, from up and off to one side.
      const side = Math.cos(m.seed * 9) > 0 ? 1 : -1;
      const [x, y] = [wx(m.x) + side * fall * 150, wy(m.y) - fall * 340];
      const size = 11 + m.seed * 3;
      this.host.light(x, y, 0xff7a2a, 1.2, 1.2, 0.85);
      this.host.light(wx(m.x), wy(m.y), 0xff5a1a, 0.9 * (1 - left), 0.6 * (1 - left), 0.6);
      for (let i = 9; i >= 1; i--) {
        const t = i * 0.09;
        const [tx, ty] = [x + side * t * 70, y - t * 150];
        const w = Math.round(size * (1.3 - t));
        const col = i < 3 ? 0xfff4c4 : i < 6 ? 0xffb03a : 0xff5a1a;
        g.rect(Math.round(tx - w / 2 + Math.sin(wallNow / 30 + i) * 2), Math.round(ty - w / 2), w, w).fill({ color: col, alpha: 0.85 - i * 0.07 });
      }
      g.rect(Math.round(x - size / 2) - 2, Math.round(y - size / 2) - 2, size + 4, size + 4).fill({ color: 0x1a0e0a });
      g.rect(Math.round(x - size / 2), Math.round(y - size / 2), size, size).fill({ color: 0x5a3a2a });
      g.rect(Math.round(x - size / 2), Math.round(y - size / 2), size - 4, 3).fill({ color: 0xff8a2a });
      g.rect(Math.round(x), Math.round(y), 3, 3).fill({ color: 0x2a1a14 });
    }
  }

  private bound() {
    return { wx: (x: number) => this.host.wx(x), wy: (y: number) => this.host.wy(y), tile: this.host.tile };
  }

  private drawLions(s: DisasterState, serverNow: number, wallNow: number, dt: number) {
    const { wx, wy, tile } = this.bound();
    const seen = new Set<number>();
    this.gatesOpen = s.lions.some((l) => l.act === LION.EMERGE && l.kind === 0);
    const thieves = new Set<number>();
    // The clouds: gliding between what we're told.
    const ease0 = 1 - Math.exp(-dt * 9);
    for (const c of s.clouds) {
      const [x, y] = [c.x / 100 - ACID_OFF, c.y / 100];
      const p = this.puffs.find((q) => q.id === c.id);
      if (p) {
        p.x += (x - p.x) * ease0;
        p.seen = wallNow;
      } else {
        const sprite = new Sprite(cloudFrames()[0]);
        sprite.anchor.set(0.5, CLOUD_BASE);
        const seed = (c.id * 0.618 + y * 0.31) % 1;
        sprite.scale.set(seed > 0.5 ? CLOUD_PX : -CLOUD_PX, CLOUD_PX);
        this.sky.addChild(sprite);
        this.puffs.push({ x, y, id: c.id, seed, seen: wallNow, sprite, show: 0 });
        this.rained = true;
      }
    }
    // (They've all crossed: the hiss goes with them.)
    if (s.clouds.length === 0 && this.stopAcid && this.rained && !this.puffs.length) {
      this.stopAcid();
      this.stopAcid = null;
      this.rained = false;
    }
    let beastSeen = false;
    for (const told of s.lions) {
      // (Told in tiles ×100, its heading as a u16.)
      const l = { ...told, x: told.x / 100, y: told.y / 100, toX: told.toX / 100, toY: told.toY / 100, aim: (told.aim / 65536) * Math.PI * 2 };
      if (l.kind === 1) {
        beastSeen = true;
        this.drawBeast(l, s, serverNow, wallNow, dt);
        continue;
      }
      if (l.kind === 2) {
        thieves.add(l.id);
        this.thieves.show(l, wallNow, dt);
        continue;
      }
      seen.add(l.id);
      let v = this.lions.get(l.id);
      if (!v) {
        const g = new Graphics();
        this.host.sorted.addChild(g);
        v = { g, x: l.x, y: l.y, step: 0, hurtUntil: 0, face: Math.cos(l.aim) >= 0 ? 1 : -1, turn: 0, deadFade: 1, rig: lionRig("roar", 0, 0, wallNow), act: l.act, landAt: 0, goneAt: 0 };
        this.lions.set(l.id, v);
      }
      // Gliding to where it was last heard of, whatever the frame rate.
      const ease = 1 - Math.exp(-dt * (l.act === LION.LEAP ? 26 : 13));
      v.x += (l.x - v.x) * ease;
      v.y += (l.y - v.y) * ease;
      // (Facing: it doesn't flip for a step sideways.)
      const want = Math.cos(l.aim);
      if (Math.abs(want) > 0.3 && Math.sign(want) !== v.face) {
        v.turn += dt;
        if (v.turn > 0.08) {
          v.face = want >= 0 ? 1 : -1;
          v.turn = 0;
        }
      } else v.turn = 0;
      if (l.act === LION.RECOVER && v.act === LION.LEAP) v.landAt = wallNow;
      v.act = l.act;
      const since = l.actMs + Math.max(0, serverNow - s.now);
      const g = v.g.clear();
      const fx0 = wx(v.x);
      const feet = wy(v.y);
      g.zIndex = feet;
      let act: LionAct = "idle";
      let k = 0;
      let lift = 0;
      switch (l.act) {
        case LION.EMERGE:
          [act, k] = ["roar", since / LION_EMERGE_MS];
          break;
        case LION.PROWL:
          act = "run";
          v.step += dt * 15;
          break;
        case LION.CROUCH:
          [act, k] = ["crouch", since / LION_CROUCH_MS];
          break;
        case LION.LEAP: {
          k = Math.min(1, since / LION_LEAP_MS);
          act = "leap";
          lift = Math.sin(k * Math.PI) * 24;
          break;
        }
        case LION.RECOVER:
          if (since < 360) [act, k] = ["land", since / 360];
          break;
        default:
          [act, k] = ["dead", 1];
          v.deadFade = Math.max(0, 1 - Math.max(0, since - 900) / 900);
          break;
      }
      // Each pose eased into the next (snappier in the strike).
      easeRig(v.rig, lionRig(act, k, v.step, wallNow), 1 - Math.exp(-dt * (act === "leap" || act === "land" ? 34 : act === "run" ? 26 : 15)));
      // Its shadow on the sand, smaller the higher it is.
      const shadow = 1 - (lift / 24) * 0.45;
      g.ellipse(fx0, feet + 1, 16 * shadow, 5 * shadow).fill({ color: 0x000000, alpha: 0.28 });
      // Where it's going to land: a red ring, claw marks across it.
      if (l.act === LION.CROUCH || l.act === LION.LEAP) {
        const [tx, ty] = [wx(l.toX), wy(l.toY)];
        const p = 0.5 + 0.5 * Math.sin(wallNow / 45);
        const r = 0.75 * tile;
        g.ellipse(tx, ty, r, r * 0.65).fill({ color: 0xff2a1a, alpha: 0.14 + 0.14 * p });
        g.ellipse(tx, ty, r, r * 0.65).stroke({ width: 2, color: 0xff5a2a, alpha: 0.6 + 0.4 * p });
        for (const dx of [-6, 0, 6]) g.moveTo(tx + dx - 3, ty - 6).lineTo(tx + dx + 3, ty + 6).stroke({ width: 2, color: 0xffe14f, alpha: 0.8 });
      }
      g.alpha = v.deadFade;
      this.host.light(fx0, feet - lift - 13, 0xffb648, 1, 0.8, 0.34 * v.deadFade);
      drawLion(g, fx0, feet - lift, v.rig, v.face, wallNow, wallNow < v.hurtUntil);
      // Streaks behind it in the air, and three claw-rakes as it lands.
      if (l.act === LION.LEAP) {
        for (let i = 0; i < 4; i++) {
          const y = feet - lift - 5 - i * 4;
          const len = 10 + ((i * 7) % 8);
          g.rect(Math.round(fx0 - v.face * (20 + (v.face > 0 ? len : 0))), Math.round(y), len, 1).fill({ color: 0xfff1c8, alpha: 0.5 });
        }
      }
      const rake = (wallNow - v.landAt) / 170;
      if (v.landAt && rake < 1) {
        for (let i = 0; i < 3; i++) {
          const cx = fx0 + v.face * (17 + i * 3);
          const y0 = feet - 15 + i * 2;
          g.moveTo(cx - v.face * 2, y0).lineTo(cx + v.face * 5, y0 + 15).stroke({ width: 2, color: 0xffffff, alpha: 1 - rake });
        }
      }
      // Its health (once it's been hurt: until then, it's one more thing on screen).
      if (l.act !== LION.DEAD && l.hp < LION_HP) {
        const w = 26;
        const by = Math.round(feet - lift - LION_HEIGHT - 7);
        g.rect(fx0 - w / 2 - 1, by - 1, w + 2, 5).fill({ color: 0x1a1020 });
        g.rect(fx0 - w / 2, by, w, 3).fill({ color: 0x4a2020 });
        g.rect(fx0 - w / 2, by, Math.round((w * l.hp) / LION_HP), 3).fill({ color: l.hp < LION_HP * 0.35 ? 0xff5a3a : 0xffb03a });
      }
      if (act === "run" && Math.random() < 0.18) this.host.dust(v.x, v.y, 1);
    }
    this.retireLions(seen, wallNow);
    this.thieves.retire(thieves, wallNow);
    if (!beastSeen) this.retireBeast(wallNow);
  }

  /** The great scorpion: coming up with the wheel, then loose. */
  private drawBeast(l: LionState, s: DisasterState, serverNow: number, wallNow: number, dt: number) {
    const { wx, wy, tile } = this.bound();
    const since = l.actMs + Math.max(0, serverNow - s.now);
    const size = tile * 5.6;
    let v = this.beast;
    if (!v) {
      const g = new Graphics();
      const eyes = new Graphics();
      const mask = new Graphics();
      this.host.sorted.addChild(g, eyes, mask);
      const light = this.host.glow(wx(l.x), wy(l.y));
      if (light) {
        light.tint = 0x9a4dff;
        light.scale.set(0.9, 0.75);
      }
      v = { g, eyes, mask, light, rushed: false, x: l.x, y: l.y, step: 0, hurtUntil: 0, face: Math.cos(l.aim) >= 0 ? 1 : -1, turn: 0, rig: scorpionRig("rise", 0, wallNow), fade: 1, rose: false, roared: false, goneAt: 0 };
      this.beast = v;
      this.wheel.settle(DISASTER.SCORPION, wallNow);
    }
    v.goneAt = 0;
    const ease = 1 - Math.exp(-dt * 12);
    v.x += (l.x - v.x) * ease;
    v.y += (l.y - v.y) * ease;
    const want = Math.cos(l.aim);
    if (Math.abs(want) > 0.35 && Math.sign(want) !== v.face) {
      v.turn += dt;
      if (v.turn > 0.14) {
        v.face = want >= 0 ? 1 : -1;
        v.turn = 0;
      }
    } else v.turn = 0;
    let act: ScorpionAct = "idle";
    let k = 0;
    /** How far down the shaft it and the wheel are (0..1). */
    let sink = 0;
    const smooth = (u: number) => u * u * (3 - 2 * u);
    const [up, wait, rise] = [SCORPION_SINK_MS, SCORPION_SINK_MS + SCORPION_WAIT_MS, SCORPION_SINK_MS + SCORPION_WAIT_MS + SCORPION_RISE_MS];
    switch (l.act) {
      case LION.EMERGE:
        if (since < up) sink = smooth(since / up);
        else if (since < wait) sink = 1;
        else if (since < rise) sink = 1 - smooth((since - wait) / SCORPION_RISE_MS);
        if (since < rise) act = "rise";
        else [act, k] = ["rear", (since - rise) / SCORPION_ROAR_MS];
        break;
      case LION.PROWL:
        act = "walk";
        v.step += dt * 9.5;
        v.rushed = false;
        break;
      case LION.RUSH:
        act = "walk";
        v.step += dt * 21;
        v.rushed = true;
        if (Math.random() < 0.6) this.host.dust(v.x + (Math.random() - 0.5) * 1.8, v.y + (Math.random() - 0.5) * 0.6, 1);
        break;
      case LION.CROUCH:
        [act, k] = ["wind", since / (v.rushed ? STING_QUICK_WIND_MS : STING_WIND_MS)];
        break;
      case LION.LEAP:
        act = "strike";
        break;
      case LION.RECOVER:
        if (since < 240) act = "strike";
        break;
      case LION.SPIT:
        [act, k] = ["spit", since / DART_WIND_MS];
        break;
      default:
        act = "dead";
        v.fade = Math.max(0, 1 - Math.max(0, since - 1100) / 700);
        break;
    }
    this.wheel.setSink(l.act === LION.EMERGE ? sink : 0);
    // The rumble and dust of the great stone moving, and its entrance.
    if (l.act === LION.EMERGE && since < rise) {
      this.host.shake(0.05);
      if (Math.random() < 0.25) {
        const a = Math.random() * Math.PI * 2;
        this.host.dust(this.host.mid.x + Math.cos(a) * 2.9, this.host.mid.y + Math.sin(a) * 2.4, 1);
      }
    }
    if (l.act === LION.EMERGE && since >= wait && !v.rose) {
      v.rose = true;
      dfx.stoneRise();
    }
    if (l.act !== LION.DEAD && since >= rise && !v.roared && l.act === LION.EMERGE) {
      v.roared = true;
      dfx.scorpionRoar();
      this.host.shake(0.5);
      this.host.ring(this.host.mid.x, this.host.mid.y, 0xc86eff, 3.6);
      this.host.dust(this.host.mid.x, this.host.mid.y, 18);
    }
    easeRig(v.rig, scorpionRig(act, k, wallNow), 1 - Math.exp(-dt * (act === "strike" ? 30 : act === "wind" ? 12 : act === "walk" ? 14 : 9)));
    const inShaft = l.act === LION.EMERGE && since < rise;
    const fx0 = wx(v.x);
    const feet = wy(v.y);
    const drop = StoneWheel.dropAt(sink, size);
    const scale = 1 - 0.07 * sink;
    const g = v.g.clear();
    g.position.set(fx0, feet + drop);
    g.scale.set(scale);
    g.zIndex = inShaft ? this.host.floorZ + 0.3 : feet;
    g.alpha = v.fade;
    // Hidden till the wheel's at the bottom; then in the dark, then in the light.
    g.visible = !(l.act === LION.EMERGE && since < up + 200);
    const light = 0.1 + 0.9 * (1 - sink) ** 1.3;
    const shade = Math.round(255 * light);
    g.tint = (shade << 16) | (shade << 8) | shade;
    // (The near lip of the shaft hides whatever's still below it.)
    if (inShaft) {
      const [cx, cy] = [wx(this.host.mid.x), wy(this.host.mid.y)];
      const [rx, ry] = [size * 0.425, size * 0.35];
      v.mask.clear().rect(cx - 400, cy - 400, 800, 400).fill({ color: 0xffffff }).ellipse(cx, cy, rx, ry).fill({ color: 0xffffff });
      g.mask = v.mask;
      v.mask.visible = true;
    } else {
      g.mask = null;
      v.mask.visible = false;
    }
    if (!inShaft) g.ellipse(0, 3, 46, 11).fill({ color: 0x000000, alpha: 0.3 });
    if (v.light) {
      v.light.position.set(fx0, feet + drop - 24);
      v.light.alpha = 0.5 * v.fade * (1 - sink) ** 2;
    }
    if (g.visible) drawScorpion(g, 0, 0, v.rig, v.face, v.step, wallNow, wallNow < v.hurtUntil);
    // Eyes opening down in the dark, before anything else of it can be seen.
    const eyes = v.eyes.clear();
    eyes.zIndex = this.host.floorZ + 0.4;
    if (inShaft && sink > 0.45 && g.visible) {
      const blink = Math.sin(wallNow / 240) > -0.8 ? 1 : 0;
      const alpha = Math.min(1, (sink - 0.45) * 3) * blink;
      const [ex, ey] = [fx0 + v.face * 21 * scale, feet + drop - 21 * scale];
      eyes.rect(Math.round(ex) - 3, Math.round(ey), 3, 3).fill({ color: 0xff3a1a, alpha });
      eyes.rect(Math.round(ex) + 3, Math.round(ey) - 1, 3, 3).fill({ color: 0xff3a1a, alpha });
    }
    // Where the sting's coming down, and the line of a dart.
    if (l.act === LION.CROUCH || l.act === LION.LEAP) {
      const p = 0.5 + 0.5 * Math.sin(wallNow / 45);
      const r = tile * 1.05;
      const [tx, ty] = [wx(l.toX) - fx0, wy(l.toY) - feet - drop];
      g.ellipse(tx, ty, r, r * 0.65).fill({ color: 0xa040ff, alpha: 0.14 + 0.14 * p });
      g.ellipse(tx, ty, r, r * 0.65).stroke({ width: 2, color: 0xc86eff, alpha: 0.6 + 0.4 * p });
    }
    // Its health, a great bar over it.
    if (l.act !== LION.DEAD && l.act !== LION.EMERGE) {
      const w = 76;
      const by = -SCORPION_HEIGHT - 14;
      g.rect(-w / 2 - 1, by - 1, w + 2, 7).fill({ color: 0x1a1020 });
      g.rect(-w / 2, by, w, 5).fill({ color: 0x3a2030 });
      g.rect(-w / 2, by, Math.round((w * l.hp) / SCORPION_HP), 5).fill({ color: l.hp < SCORPION_HP * 0.3 ? 0xff5a3a : 0xb060ff });
      g.rect(-w / 2, by, Math.round((w * l.hp) / SCORPION_HP), 1).fill({ color: 0xe8c8ff });
    }
    if (act === "walk" && Math.random() < 0.3) this.host.dust(v.x + (Math.random() - 0.5) * 2.4, v.y, 1);
  }

  private retireBeast(wallNow: number) {
    const v = this.beast;
    if (!v) return;
    v.goneAt ||= wallNow;
    const left = 1 - (wallNow - v.goneAt) / 320;
    v.g.alpha = Math.min(v.fade, Math.max(0, left));
    if (v.light) v.light.alpha = Math.min(v.light.alpha, 0.5 * Math.max(0, left));
    if (left > 0) return;
    this.dropBeast();
  }

  private dropBeast() {
    const v = this.beast;
    if (!v) return;
    v.g.mask = null;
    v.g.destroy();
    v.eyes.destroy();
    v.mask.destroy();
    v.light?.destroy();
    this.beast = null;
  }

  /** Any lion no longer about fades away. */
  private retireLions(seen: Set<number>, wallNow: number) {
    for (const [id, v] of this.lions) {
      if (seen.has(id)) continue;
      v.goneAt ||= wallNow;
      const left = 1 - (wallNow - v.goneAt) / 320;
      if (left <= 0) {
        v.g.destroy();
        this.lions.delete(id);
      } else v.g.alpha = Math.min(v.deadFade, left);
    }
  }

  /** How far a gift's shivering, with a thief at it (px). */
  giftTrembles(x: number, y: number, wallNow: number): number {
    return this.thieves.trembles(x, y, wallNow);
  }

  /** Little scorpion `id` stung someone: it leaps. */
  thiefStung(id: number, wallNow: number) {
    this.thieves.stung(id, wallNow);
  }

  /** A blow landed on lion `id`. */
  hurt(id: number, wallNow: number) {
    const v = this.beast ?? this.lions.get(id);
    if (v) v.hurtUntil = wallNow + 110;
  }

  /** The wheel's stopped: `kind`'s wedge lights up. */
  wheelLanded(kind: number, wallNow: number) {
    this.wheel.settle(kind, wallNow);
  }

  /** Its arena events. */
  meteorMarked(x: number, y: number, r: number, ms: number, wallNow: number) {
    const rock: Rock = { x, y, r, at: wallNow + ms, from: wallNow, seed: Math.random() };
    this.rocks.push(rock);
    // (Heard falling only if it's coming down near us: there are dozens.)
    window.setTimeout(() => {
      const near = this.host.near(x, y);
      if (this.rocks.includes(rock) && (near > 0.65 || (near > 0.5 && Math.random() < 0.35))) dfx.meteorFall(near);
    }, Math.max(0, ms - 700));
  }

  meteorLanded(x: number, y: number, r: number, wallNow: number) {
    let best = -1;
    let bd = Infinity;
    this.rocks.forEach((m, i) => {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) [best, bd] = [i, d];
    });
    if (best >= 0) this.rocks.splice(best, 1);
    this.craters.push({ x, y, r, until: wallNow + 4000, seed: Math.random() * 6 });
    // (At the height of it, only those close by are heard one by one: a dozen a second.)
    const near = this.host.near(x, y);
    if (near > 0.7 || wallNow - this.thudAt > 140) {
      this.thudAt = wallNow;
      dfx.meteorImpact(Math.max(0.14, near * near));
    }
  }

  /** The disaster's begun. */
  struck(kind: number, wallNow: number) {
    if (kind === DISASTER.LAVA) {
      this.stopRoar();
      this.stopChurn = dfx.lava();
    } else if (kind === DISASTER.METEORS) this.rainUntil = wallNow + METEOR_RAIN_MS;
    else if (kind === DISASTER.ACID) {
      this.stopRoar();
      this.stopAcid = dfx.acidRain();
    } else if (kind === DISASTER.SCORPION) dfx.stoneSink();
  }

  destroy() {
    this.stopRoar();
    this.clearLions();
    this.dropBeast();
    this.thieves.destroy();
    this.puffs = [];
    this.sky.destroy({ children: true });
    this.strip.remove();
    this.vote.remove();
    this.wheel.destroy();
  }
}
