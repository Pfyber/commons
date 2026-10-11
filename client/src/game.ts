// Ties the zone connection, world rendering, avatars, input and HUD together.

import type { Application } from "pixi.js";
import type { ServerMsg } from "./net/protocol.gen";
import { type CloseReason, ZoneSocket } from "./net/socket";
import type { Hud } from "./ui/hud";
import { Avatar } from "./world/avatars";
import { type ZoneMap, nearestWalkable, stepTarget } from "./world/map";
import type { TileXY } from "./world/motion";
import { Scene } from "./world/scene";

/** Error codes from server/crates/protocol (error_code). */
const ERR = { NO_PATH: 4, RATE_LIMITED: 5, REPLACED: 6, UNAUTHORIZED: 2, VERSION_MISMATCH: 3 };
/** Names are drawn for the nearest few avatars only, to keep crowds readable. */
const MAX_NAMES = 25;
const KEY_STEPS = 3;
const KEY_RESEND_MS = 180;

const KEY_DIRS: Record<string, TileXY> = {
  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 },
};

export class Game {
  readonly scene: Scene;
  private socket: ZoneSocket | null = null;
  private avatars = new Map<number, Avatar>();
  private selfId = 0;
  private cam: TileXY | null = null;
  private keys = new Set<string>();
  private lastKeyDir = "";
  private lastKeySend = 0;
  private disposers: (() => void)[] = [];

  constructor(
    private app: Application,
    map: ZoneMap,
    private hud: Hud,
    private labels: HTMLElement,
    private events: { onWelcome(): void; onDisconnect(reason: CloseReason): void },
  ) {
    this.scene = new Scene(app, map);
    this.bindInput();
    const tick = () => this.update();
    app.ticker.add(tick);
    this.disposers.push(() => app.ticker.remove(tick));
  }

  connect(serverUrl: string, joinToken: string) {
    this.clearAvatars();
    this.socket = new ZoneSocket(serverUrl, joinToken, this.scene.viewTiles(), (m) => this.handle(m), (r) => {
      this.socket = null;
      this.events.onDisconnect(r);
    });
  }

  private get self(): Avatar | undefined {
    return this.avatars.get(this.selfId);
  }

  private clearAvatars() {
    for (const a of this.avatars.values()) a.destroy();
    this.avatars.clear();
    this.selfId = 0;
  }

  private upsert(info: Extract<ServerMsg, { t: "Spawn" }>["entity"], now: number) {
    const existing = this.avatars.get(info.id);
    if (existing) existing.apply(info, now);
    else this.avatars.set(info.id, new Avatar(info, this.scene, this.labels, info.id === this.selfId, now));
  }

  private remove(id: number) {
    if (id === this.selfId) return;
    this.avatars.get(id)?.destroy();
    this.avatars.delete(id);
  }

  private handle(m: ServerMsg) {
    const now = this.socket?.clock.now() ?? 0;
    switch (m.t) {
      case "Welcome":
        this.selfId = m.selfId;
        this.hud.setPlace(this.scene.map.name, m.instance);
        this.events.onWelcome();
        break;
      case "CellEnter":
        for (const e of m.entities) this.upsert(e, now);
        break;
      case "CellLeave":
        for (const id of m.ids) this.remove(id);
        break;
      case "Spawn":
        this.upsert(m.entity, now);
        break;
      case "Despawn":
        this.remove(m.id);
        break;
      case "MoveStart":
        this.avatars.get(m.id)?.setMotion({ path: m.path, t0: m.t0, speedX10: m.speedX10 }, now);
        break;
      case "Snap":
        this.avatars.get(m.id)?.snap({ x: m.x, y: m.y });
        break;
      case "EmoteShown":
        this.avatars.get(m.id)?.emote(m.emote);
        break;
      case "ChatBubble": {
        const a = this.avatars.get(m.id);
        if (!a) break;
        a.say(m.text);
        this.hud.addChat(a.info.name, m.text, m.id === this.selfId);
        break;
      }
      case "Error":
        if (m.code === ERR.NO_PATH) this.hud.toast("Can't get there from here.");
        else if (m.code === ERR.RATE_LIMITED) this.hud.toast(m.message);
        else if (m.code !== ERR.REPLACED && m.code !== ERR.UNAUTHORIZED && m.code !== ERR.VERSION_MISMATCH) {
          console.warn("server error", m.code, m.message);
        }
        break;
      case "Pong":
        break;
    }
  }

  // ---- input -------------------------------------------------------------

  private moveTo(t: TileXY, marker: boolean) {
    if (!this.socket) return;
    this.socket.send({ t: "MoveTo", x: t.x, y: t.y });
    if (marker) this.scene.showTarget(t);
  }

  private bindInput() {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    stage.on("pointertap", (e) => {
      const t = this.scene.screenToTile(e.global.x, e.global.y);
      const target = nearestWalkable(this.scene.map, t.x, t.y, 2);
      if (target) this.moveTo(target, true);
    });

    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Enter") {
        e.preventDefault();
        this.hud.focusChat();
        return;
      }
      if (/^[1-7]$/.test(e.key)) {
        this.emote(Number(e.key));
        return;
      }
      if (KEY_DIRS[e.code]) {
        e.preventDefault();
        this.keys.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    const resize = () => this.scene.resize();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);
    this.disposers.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
    });
  }

  emote(id: number) {
    this.socket?.send({ t: "Emote", emote: id });
  }

  chat(text: string) {
    this.socket?.send({ t: "ChatSay", text });
  }

  /** Keyboard walking: short segments ahead, re-sent while keys are held. */
  private keyboardMove(wallNow: number) {
    const self = this.self;
    if (!self || this.keys.size === 0) {
      this.lastKeyDir = "";
      return;
    }
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      dx += KEY_DIRS[k].x;
      dy += KEY_DIRS[k].y;
    }
    dx = Math.sign(dx);
    dy = Math.sign(dy);
    if (dx === 0 && dy === 0) return;
    const dirKey = `${dx},${dy}`;
    const dest = self.destination;
    const remaining = Math.hypot(dest.x - self.pos.x, dest.y - self.pos.y);
    const due = dirKey !== this.lastKeyDir || remaining < 1.5;
    if (!due || wallNow - this.lastKeySend < KEY_RESEND_MS) return;
    // Plan from the tile we're heading into, so segments chain smoothly.
    const from = { x: Math.round(self.pos.x + dx * 0.49), y: Math.round(self.pos.y + dy * 0.49) };
    const target =
      stepTarget(this.scene.map, from, dx, dy, KEY_STEPS) ??
      (dx && dy ? stepTarget(this.scene.map, from, dx, 0, KEY_STEPS) ?? stepTarget(this.scene.map, from, 0, dy, KEY_STEPS) : null);
    if (!target) return;
    this.lastKeyDir = dirKey;
    this.lastKeySend = wallNow;
    this.moveTo(target, false);
  }

  // ---- frame -------------------------------------------------------------

  private update() {
    const wallNow = performance.now();
    const serverNow = this.socket?.clock.now() ?? 0;
    this.keyboardMove(wallNow);

    // Move the camera first so every label is placed against this frame's view.
    const self = this.self;
    if (self) {
      self.update(serverNow, wallNow);
      const target = self.pos;
      this.cam = this.cam
        ? { x: this.cam.x + (target.x - this.cam.x) * 0.2, y: this.cam.y + (target.y - this.cam.y) * 0.2 }
        : { ...target };
      this.scene.follow(this.cam);
    }
    for (const a of this.avatars.values()) a.update(serverNow, wallNow);

    if (self) {
      const others = [...this.avatars.values()].filter((a) => a !== self);
      others.sort((a, b) => dist2(a.pos, self.pos) - dist2(b.pos, self.pos));
      others.forEach((a, i) => (a.showName = i < MAX_NAMES));
      this.hud.setNearby(this.avatars.size);
    }
    this.scene.update();
  }

  destroy() {
    this.socket?.close();
    this.clearAvatars();
    for (const d of this.disposers) d();
  }
}

function dist2(a: TileXY, b: TileXY) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
