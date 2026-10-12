// Avatars: a sprite in the y-sorted layer plus DOM labels (name, chat bubble,
// emote) positioned in screen space so text stays crisp at any zoom.

import { Sprite } from "pixi.js";
import type { EntityInfo } from "../net/protocol.gen";
import { TILE, avatarTexture } from "./art";
import { type Motion, type TileXY, headingAt, posAt } from "./motion";
import type { Scene } from "./scene";
import { moodIcon } from "../activities/together";

export const EMOTES: Record<number, { icon: string; label: string }> = {
  1: { icon: "👋", label: "Wave" },
  2: { icon: "😄", label: "Laugh" },
  3: { icon: "👏", label: "Clap" },
  4: { icon: "💃", label: "Dance" },
  5: { icon: "💤", label: "Sleep" },
  6: { icon: "🎉", label: "Cheer" },
  7: { icon: "❤️", label: "Heart" },
};

const BUBBLE_MS = 6000;
const EMOTE_MS = 2200;
/** How long a position correction (new path starting off our drawn spot) takes to blend out. */
const BLEND_MS = 220;

export class Avatar {
  readonly sprite: Sprite;
  private label: HTMLDivElement;
  private stack: HTMLDivElement;
  private nameEl: HTMLSpanElement;
  private bubble: HTMLDivElement | null = null;
  private bubbleUntil = 0;
  private emoteEl: HTMLDivElement | null = null;
  private emoteUntil = 0;
  private emoteId = 0;
  private motion: Motion | null = null;
  private tile: TileXY;
  private blend = { x: 0, y: 0, until: 0 };
  pos: TileXY;
  private facing = 1;
  showName = true;
  private nameW = 0;
  /** Posture (protocol `state::*`): 0 idle, 1 sitting. */
  state = 0;
  /** Where we stood before sitting down; standing up returns here. */
  standTile: TileXY | null = null;

  constructor(
    public info: EntityInfo,
    private scene: Scene,
    labels: HTMLElement,
    readonly isSelf: boolean,
    now: number,
  ) {
    this.sprite = new Sprite(avatarTexture(info.look, 0));
    this.sprite.anchor.set(0.5, 1);
    this.tile = { x: info.x, y: info.y };
    this.pos = { ...this.tile };
    this.label = document.createElement("div");
    this.label.className = isSelf ? "label self" : "label";
    this.stack = document.createElement("div");
    this.stack.className = "stack";
    this.nameEl = document.createElement("span");
    this.nameEl.className = "name";
    this.nameEl.textContent = info.name;
    this.stack.appendChild(this.nameEl);
    this.label.appendChild(this.stack);
    labels.appendChild(this.label);
    scene.sorted.addChild(this.sprite);
    this.apply(info, now);
  }

  /** Shows the avatar's mood (`mood::*`) as a sign before its name. */
  setMood(mood: number) {
    let sign = this.nameEl.querySelector<HTMLSpanElement>(".mood");
    const icon = moodIcon(mood);
    if (!icon) {
      sign?.remove();
      this.nameW = 0;
      return;
    }
    if (!sign) {
      sign = document.createElement("span");
      sign.className = "mood";
      this.nameEl.prepend(sign);
      this.nameW = 0;
    }
    sign.textContent = icon;
  }

  /** Styles the name tag as a non-player character's. */
  markNpc() {
    this.label.classList.add("npc");
  }

  /** Shows a founder's leaf by the name (title: "Founder #n"). */
  setFounder(no: number | null) {
    let leaf = this.nameEl.querySelector<HTMLSpanElement>(".founder");
    if (no === null) {
      leaf?.remove();
      this.nameW = 0;
      return;
    }
    if (!leaf) {
      leaf = document.createElement("span");
      leaf.className = "founder";
      leaf.textContent = "🌱";
      this.nameEl.appendChild(leaf);
      this.nameW = 0;
    }
    leaf.title = `Founder #${no}`;
  }

  /** Updates from a Spawn/CellEnter snapshot. */
  apply(info: EntityInfo, now: number) {
    this.info = info;
    this.state = info.state;
    this.setMood(info.mood);
    if (info.path.length > 0) this.setMotion({ path: info.path, t0: info.t0, speedX10: info.speedX10 }, now);
    else this.snap({ x: info.x, y: info.y });
  }

  /** StateChange from the server: sit down on / stand up from `at`. */
  setState(state: number, at: TileXY) {
    if (state === 1 && this.state !== 1) this.standTile = this.destination;
    if (state !== 1) this.standTile = null;
    this.state = state;
    this.snap(at);
  }

  setMotion(m: Motion, now: number) {
    const before = this.pos;
    this.motion = m;
    const target = posAt(m, now);
    this.blend = { x: before.x - target.x, y: before.y - target.y, until: performance.now() + BLEND_MS };
  }

  snap(t: TileXY) {
    this.motion = null;
    this.tile = t;
    this.pos = { ...t };
    this.blend.until = 0;
  }

  get currentMotion(): Motion | null {
    return this.motion;
  }

  get moving(): boolean {
    return this.motion !== null;
  }

  /** Where the avatar will stand when its current walk ends. */
  get destination(): TileXY {
    return this.motion ? this.motion.path[this.motion.path.length - 1] : this.tile;
  }

  say(text: string) {
    if (!this.bubble) {
      this.bubble = document.createElement("div");
      this.bubble.className = "bubble";
      this.stack.appendChild(this.bubble);
    }
    this.bubble.textContent = text;
    this.bubble.classList.remove("fade");
    this.bubbleUntil = performance.now() + BUBBLE_MS + text.length * 40;
  }

  emote(id: number) {
    const e = EMOTES[id];
    if (!e) return;
    this.flash(e.icon);
    this.emoteId = id;
  }

  /** Pops `icon` above the head for a moment (emotes, jam notes). */
  flash(icon: string) {
    if (!this.emoteEl) {
      this.emoteEl = document.createElement("div");
      this.emoteEl.className = "emote";
      this.stack.appendChild(this.emoteEl);
    }
    this.emoteEl.textContent = icon;
    this.emoteEl.classList.remove("pop");
    void this.emoteEl.offsetWidth; // restart the animation
    this.emoteEl.classList.add("pop");
    this.emoteId = 0;
    this.emoteUntil = performance.now() + EMOTE_MS;
  }

  update(serverNow: number, wallNow: number) {
    let heading: TileXY | null = null;
    if (this.motion) {
      this.pos = posAt(this.motion, serverNow);
      heading = headingAt(this.motion, serverNow);
      if (!heading && serverNow > this.motion.t0) {
        const end = this.destination;
        this.snap({ x: end.x, y: end.y });
      }
    }
    let { x, y } = this.pos;
    if (wallNow < this.blend.until) {
      const f = (this.blend.until - wallNow) / BLEND_MS;
      x += this.blend.x * f;
      y += this.blend.y * f;
    }
    if (heading && Math.abs(heading.x) > 0.1) this.facing = heading.x > 0 ? 1 : -1;

    const walking = heading !== null;
    const sitting = this.state === 1 && !walking;
    const dancing = this.emoteId === 4 && wallNow < this.emoteUntil;
    const frame: 0 | 1 | 2 = sitting ? 2 : walking || dancing ? ((Math.floor(wallNow / 160) % 2) as 0 | 1) : 0;
    this.sprite.texture = avatarTexture(this.info.look, frame);
    const bob = walking ? Math.abs(Math.sin(wallNow / 90)) * -1.5 : dancing && !sitting ? Math.sin(wallNow / 70) * 2 : 0;
    const feetX = x * TILE + TILE / 2;
    // Seated avatars sit on the bench's slats, drawn just in front of it.
    const feetY = y * TILE + TILE - (sitting ? 6 : 4);
    this.sprite.position.set(Math.round(feetX), Math.round(feetY + bob));
    this.sprite.scale.x = this.facing;
    this.sprite.zIndex = sitting ? y * TILE + TILE : feetY + 0.5;

    // DOM label above the head.
    const s = this.scene.tileToScreen(x + 0.5, y + 1 - 4 / TILE - 34 / TILE);
    this.label.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
    this.nameEl.hidden = !this.showName;
    if (this.bubble && wallNow > this.bubbleUntil) {
      if (!this.bubble.classList.contains("fade")) this.bubble.classList.add("fade");
      if (wallNow > this.bubbleUntil + 400) {
        this.bubble.remove();
        this.bubble = null;
      }
    }
    if (this.emoteEl && wallNow > this.emoteUntil) {
      this.emoteEl.remove();
      this.emoteEl = null;
      this.emoteId = 0;
    }
  }

  /** Screen box of the name tag (measured once), for decluttering overlapping names. */
  nameBox(): { x0: number; x1: number; y: number } {
    if (!this.nameW && !this.nameEl.hidden) this.nameW = this.nameEl.offsetWidth;
    const w = this.nameW || this.info.name.length * 7;
    const s = this.scene.tileToScreen(this.pos.x + 0.5, this.pos.y);
    return { x0: s.x - w / 2, x1: s.x + w / 2, y: s.y };
  }

  destroy() {
    this.sprite.destroy();
    this.label.remove();
  }
}
