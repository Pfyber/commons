// The park's big screen (spec §7: synced screen, timestamp sync).
//
// The server announces what's showing and when it started on the instance
// clock. Every client renders the same moment: procedural "broadcasts" are
// pure functions of elapsed time, and video sources are seeked to it.

import { Sprite, Texture } from "pixi.js";
import { drawPixelText, pixelWidth } from "../world/pixelfont";
import { disc, polygon } from "../world/pixeldraw";
import type { ServerMsg } from "../net/protocol.gen";
import { SCREEN_FACE_TOP, TILE, hash } from "../world/art";
import type { MapObject } from "../world/map";

export type ScreenStateMsg = Extract<ServerMsg, { t: "ScreenState" }>;

// Drawn at half resolution and scaled up for chunky pixels.
const W = 194;
const H = 32;
const FPS = 15;
const MAX_DRIFT_S = 0.5;

type Scene = (ctx: CanvasRenderingContext2D, t: number, title: string) => void;

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function caption(ctx: CanvasRenderingContext2D, title: string, t: number) {
  if (t > 6) return;
  ctx.globalAlpha = Math.min(1, (6 - t) / 1.5);
  rect(ctx, "rgba(0,0,0,0.55)", 2, 2, pixelWidth(title) + 6, 9);
  drawPixelText(ctx, title, 5, 4, "#fff");
  ctx.globalAlpha = 1;
}

const aquarium: Scene = (ctx, t) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2b7a99");
  g.addColorStop(1, "#123d52");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    const x = ((t * 6 + i * 70) % (W + 40)) - 20;
    polygon(ctx, "rgba(255,255,255,0.06)", [
      [x, 0],
      [x + 14, 0],
      [x - 6, H],
      [x - 20, H],
    ]);
  }
  rect(ctx, "#c9b27c", 0, H - 3, W, 3);
  for (let i = 0; i < 10; i++) {
    const x = 8 + i * 19 + (hash(i, 1) % 7);
    const h = 6 + (hash(i, 2) % 10);
    for (let s = 0; s < h; s++) {
      const sway = Math.sin(t * 1.3 + i + s * 0.35) * (s / h) * 2;
      rect(ctx, s % 3 ? "#3f8f4f" : "#57a663", x + sway, H - 3 - s, 1, 1);
    }
  }
  const colors = ["#f2a541", "#f46b6b", "#ffd84d", "#8fd3f4", "#c79bf2", "#f7f7f7"];
  for (let i = 0; i < 7; i++) {
    const speed = 8 + (hash(i, 3) % 12);
    const dir = i % 2 ? 1 : -1;
    const span = W + 24;
    const raw = (t * speed + (hash(i, 4) % span)) % span;
    const x = dir > 0 ? raw - 12 : W + 12 - raw;
    const y = 6 + (hash(i, 5) % (H - 14)) + Math.sin(t * 0.9 + i) * 2;
    const c = colors[i % colors.length];
    rect(ctx, c, x, y, 5, 3);
    rect(ctx, c, x + (dir > 0 ? -2 : 5), y + (Math.floor(t * 4 + i) % 2 ? 0 : 1), 2, 2);
    rect(ctx, "#1b1b1b", x + (dir > 0 ? 3 : 1), y + 1, 1, 1);
  }
  for (let i = 0; i < 8; i++) {
    const period = 4 + (hash(i, 6) % 4);
    const p = ((t + hash(i, 7) % 10) % period) / period;
    rect(ctx, "rgba(220,245,255,0.7)", 10 + (hash(i, 8) % (W - 20)) + Math.sin(t * 3 + i), H - 4 - p * (H - 4), 1, 1);
  }
};

const stars: Scene = (ctx, t) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0d1530");
  g.addColorStop(1, "#2b3561");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = hash(i, 11) % W;
    const y = hash(i, 12) % (H - 8);
    const tw = 0.5 + 0.5 * Math.sin(t * (1 + (hash(i, 13) % 5) / 3) + i);
    ctx.fillStyle = `rgba(255,255,240,${(0.3 + tw * 0.7).toFixed(2)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const mx = ((t * 1.5) % (W + 20)) - 10;
  disc(ctx, "#f4f1d8", mx, 8, 4);
  disc(ctx, "#0d1530", mx + 2, 7, 3.5);
  // A shooting star every 12 s, the same one for everyone.
  const k = Math.floor(t / 12);
  const phase = t - k * 12;
  if (phase < 0.8) {
    const sx = 30 + (hash(k, 14) % (W - 60)) + phase * 60;
    const sy = 2 + (hash(k, 15) % 8) + phase * 12;
    for (let i = 0; i < 8; i++) rect(ctx, `rgba(255,255,255,${1 - i / 8})`, sx - i * 2, sy - i * 0.4, 1, 1);
  }
  ctx.fillStyle = "#18233f";
  for (let x = 0; x < W; x++) {
    const h = 5 + Math.sin(x / 17) * 2 + Math.sin(x / 7) * 1;
    ctx.fillRect(x, H - h, 1, h);
  }
};

const NOTICES = [
  "Welcome to Commons!",
  "Chess tables by the fountain: sit down to play",
  "Coming soon: the first town vote, what's beyond the bridge?",
  "Evening at the fountain, every day at 19:00",
  "Be kind. This is a shared place.",
];

const notice: Scene = (ctx, t, title) => {
  rect(ctx, "#efe3c8", 0, 0, W, H);
  rect(ctx, "#c9b48a", 0, 0, W, 2);
  rect(ctx, "#c9b48a", 0, H - 2, W, 2);
  ctx.font = "bold 8px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = "#5a3b2b";
  ctx.fillText(title, 4, 10);
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  ctx.font = "7px ui-monospace, monospace";
  ctx.fillText(clock, W - ctx.measureText(clock).width - 4, 9);
  const i = Math.floor(t / 6) % NOTICES.length;
  const p = (t % 6) / 6;
  ctx.globalAlpha = p < 0.1 ? p * 10 : p > 0.9 ? (1 - p) * 10 : 1;
  ctx.font = "8px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = "#3b3a2e";
  ctx.fillText(NOTICES[i], 4, 24, W - 8);
  ctx.globalAlpha = 1;
};

const SCENES: Record<string, Scene> = { aquarium, stars, notice };

export class BigScreen {
  readonly sprite: Sprite;
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private texture: Texture;
  private state: ScreenStateMsg | null = null;
  private video: HTMLVideoElement | null = null;
  private lastDraw = 0;
  /** Screen centre in tiles, for "is it on screen" checks. */
  readonly center: { x: number; y: number };

  constructor(obj: MapObject) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = "nearest";
    this.sprite = new Sprite(this.texture);
    // Matches the inner screen area drawn by objectTexture("big_screen").
    const overhang = 64;
    this.sprite.position.set(obj.x * TILE + 14, obj.y * TILE - overhang + SCREEN_FACE_TOP + 6);
    this.sprite.width = obj.w * TILE - 28;
    this.sprite.height = 64;
    this.sprite.zIndex = (obj.y + obj.h) * TILE - 0.5;
    this.center = { x: obj.x + obj.w / 2, y: obj.y };
    notice(this.ctx, 10, "Big Screen");
    this.texture.source.update();
  }

  setState(s: ScreenStateMsg) {
    this.state = s;
    const isVideo = /^https?:\/\//.test(s.source);
    if (this.video && (!isVideo || this.video.dataset.src !== s.source)) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video = null;
    }
    if (isVideo && !this.video) {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.dataset.src = s.source;
      v.src = s.source;
      v.onerror = () => {
        console.warn("big screen: video failed, showing the noticeboard instead", s.source);
        this.video = null;
      };
      void v.play().catch(() => {});
      this.video = v;
    }
  }

  /** Draws the current frame; skipped when the screen is far off-camera. */
  update(serverNow: number, visible: boolean) {
    const s = this.state;
    if (!s || !visible) return;
    const wall = performance.now();
    if (wall - this.lastDraw < 1000 / FPS) return;
    this.lastDraw = wall;
    const elapsed = Math.max(0, serverNow - s.startedT) / 1000;
    if (this.video) {
      const v = this.video;
      if (v.readyState >= 2) {
        const want = v.duration ? elapsed % v.duration : elapsed;
        if (Math.abs(v.currentTime - want) > MAX_DRIFT_S) v.currentTime = want;
        this.ctx.drawImage(v, 0, 0, W, H);
      } else {
        notice(this.ctx, elapsed, `Loading: ${s.title}`);
      }
    } else {
      const scene = SCENES[s.source.replace(/^scene:/, "")] ?? notice;
      scene(this.ctx, elapsed, s.title);
    }
    caption(this.ctx, s.title, elapsed);
    this.texture.source.update();
  }
}
