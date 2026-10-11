// Ties the zone connection, world rendering, avatars, input and HUD together.

import type { Application } from "pixi.js";
import { ChessPanel, type GameStateMsg } from "./activities/chess";
import { BigScreen } from "./activities/screen";
import { Ambient } from "./ambient/ambient";
import { DayNight } from "./ambient/daynight";
import type { ServerMsg } from "./net/protocol.gen";
import { type CloseReason, ZoneSocket } from "./net/socket";
import type { Hud } from "./ui/hud";
import { Avatar } from "./world/avatars";
import { Furniture } from "./world/furniture";
import { type ZoneMap, nearestWalkable, stepTarget } from "./world/map";
import { type TileXY, WALK_SPEED_X10, splice } from "./world/motion";
import { compress, findPath } from "./world/path";
import { Scene } from "./world/scene";

/** Error codes from server/crates/protocol (error_code). */
const ERR = { NO_PATH: 4, RATE_LIMITED: 5, REPLACED: 6, UNAUTHORIZED: 2, VERSION_MISMATCH: 3 };
/** Errors worth showing to the player as-is. */
const TOAST_CODES = new Set([ERR.RATE_LIMITED, 9, 10, 11]);
const SITTING = 1;
const SEAT_GROUND = 0xffffffff;
/** Spectators further than this from a table stop following its game. */
const WATCH_RANGE = 12;
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
  private keys = new Set<string>();
  private lastKeyDir = "";
  private lastKeySend = 0;
  private disposers: (() => void)[] = [];
  private furniture: Furniture;
  private games = new Map<number, GameStateMsg>();
  private chess: ChessPanel;
  private screen: BigScreen | null = null;
  private ambient: Ambient;
  private daynight: DayNight;

  constructor(
    private app: Application,
    map: ZoneMap,
    private hud: Hud,
    private labels: HTMLElement,
    private events: { onWelcome(): void; onDisconnect(reason: CloseReason): void },
  ) {
    this.scene = new Scene(app, map);
    this.furniture = new Furniture(map);
    const screenObj = map.objects.find((o) => o.kind === "big_screen");
    if (screenObj) {
      this.screen = new BigScreen(screenObj);
      this.scene.sorted.addChild(this.screen.sprite);
    }
    this.ambient = new Ambient(this.scene, map);
    this.daynight = new DayNight(app, this.scene, map);
    this.chess = new ChessPanel(document.body, () => this.selfId, {
      move: (table, uci) => this.socket?.send({ t: "GameMove", table, uci }),
      close: () => this.chess.hide(),
      nameOf: (id) => this.avatars.get(id)?.info.name ?? "someone",
    });
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
    // Our own avatar is predicted locally; server snapshots of it (e.g. in a
    // CellEnter after crossing a cell) would only pull it back in time.
    if (existing && info.id === this.selfId) return;
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
      case "MoveStart": {
        const a = this.avatars.get(m.id);
        if (!a) break;
        if (m.id === this.selfId) {
          // The server confirming our predicted walk: keep the local timing.
          const end = m.path[m.path.length - 1];
          const dest = a.destination;
          if (end.x === dest.x && end.y === dest.y) break;
        }
        a.setMotion({ path: m.path, t0: m.t0, speedX10: m.speedX10 }, now);
        break;
      }
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
      case "StateChange": {
        const a = this.avatars.get(m.id);
        if (!a) break;
        a.setState(m.state, { x: m.x, y: m.y });
        if (m.id === this.selfId) this.onSelfState(m.state, { x: m.x, y: m.y });
        break;
      }
      case "GameState":
        this.games.set(m.table, m);
        if (this.chess.open) this.chess.update(m);
        break;
      case "ScreenState":
        this.screen?.setState(m);
        break;
      case "Error":
        if (m.code === ERR.NO_PATH) this.hud.toast("Can't get there from here.");
        else if (TOAST_CODES.has(m.code)) this.hud.toast(m.message.charAt(0).toUpperCase() + m.message.slice(1) + ".");
        else if (m.code !== ERR.REPLACED && m.code !== ERR.UNAUTHORIZED && m.code !== ERR.VERSION_MISMATCH) {
          console.warn("server error", m.code, m.message);
        }
        break;
      case "Pong":
        break;
    }
  }

  // ---- input -------------------------------------------------------------

  /**
   * Starts walking immediately using the same pathfinding and splice rules as
   * the server, then tells the server. Its MoveStart echo is ignored when it
   * agrees with the prediction.
   */
  private moveTo(t: TileXY, marker: boolean) {
    const self = this.self;
    if (!this.socket || !self) return;
    const now = this.socket.clock.now();
    // Walking off stands us up; the server does the same on MoveTo.
    if (self.state === SITTING) {
      self.setState(0, self.standTile ?? self.destination);
      this.hud.setSitting(false);
    }
    const cur = self.currentMotion;
    const sp = cur ? splice(cur, now) : null;
    let start: TileXY;
    let t0 = now;
    if (sp) {
      start = sp.next;
      t0 = sp.tPrev;
    } else {
      start = cur && now <= cur.t0 ? cur.path[0] : self.destination;
    }
    const full = findPath(this.scene.map, start, t);
    if (!full) {
      this.hud.toast("Can't get there from here.");
      return;
    }
    if (sp) full.unshift(sp.prev);
    if (full.length >= 2) self.setMotion({ path: compress(full), t0, speedX10: WALK_SPEED_X10 }, now);
    this.socket.send({ t: "MoveTo", x: t.x, y: t.y });
    if (marker) this.scene.showTarget(t);
  }

  private bindInput() {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    stage.on("pointertap", (e) => {
      const t = this.scene.screenToTile(e.global.x, e.global.y);
      const id = this.furniture.idAt(t);
      const seat = this.furniture.seats.get(id);
      if (seat) return this.sitAt(seat.id);
      const table = this.furniture.tables.get(id);
      if (table) return this.watchTable(table.id);
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

  // ---- sitting & tables ---------------------------------------------------

  /** Walks next to a bench and sits on it (the server applies Sit on arrival). */
  private sitAt(seatId: number) {
    const self = this.self;
    const seat = this.furniture.seats.get(seatId);
    if (!self || !seat || !this.socket) return;
    if (self.state === SITTING && self.destination.x === seat.tile.x && self.destination.y === seat.tile.y) return;
    const from = self.state === SITTING ? (self.standTile ?? self.destination) : self.destination;
    const spot = this.furniture.approach(seat.tile, from);
    if (!spot) return;
    if (spot.x !== from.x || spot.y !== from.y || self.state === SITTING) this.moveTo(spot, true);
    this.socket.send({ t: "Sit", seat: seatId });
    if (seat.table) this.chess.show(seat.table.id, this.games.get(seat.table.id));
  }

  private watchTable(tableId: number) {
    const table = this.furniture.tables.get(tableId)!;
    const self = this.self;
    if (self && Math.hypot(self.pos.x - table.tile.x, self.pos.y - table.tile.y) > WATCH_RANGE) {
      this.hud.toast("Walk closer to watch the game.");
      return;
    }
    this.chess.show(tableId, this.games.get(tableId));
  }

  private onSelfState(state: number, at: TileXY) {
    this.hud.setSitting(state === SITTING);
    const seat = this.furniture.seats.get(this.furniture.idAt(at));
    if (state === SITTING && seat?.table) this.chess.show(seat.table.id, this.games.get(seat.table.id));
  }

  toggleSit() {
    const self = this.self;
    if (!self || !this.socket) return;
    if (self.state === SITTING) this.socket.send({ t: "Stand" });
    else if (!self.moving) this.socket.send({ t: "Sit", seat: SEAT_GROUND });
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
      // Keys released: stop at the tile we're walking into instead of
      // finishing the look-ahead segment.
      if (self && this.lastKeyDir && this.socket) {
        const m = self.currentMotion;
        const sp = m ? splice(m, this.socket.clock.now()) : null;
        if (sp) this.moveTo(sp.next, false);
      }
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
      this.scene.follow(self.pos);
    }
    for (const a of this.avatars.values()) a.update(serverNow, wallNow);

    if (self) {
      const others = [...this.avatars.values()].filter((a) => a !== self);
      others.sort((a, b) => dist2(a.pos, self.pos) - dist2(b.pos, self.pos));
      others.forEach((a, i) => (a.showName = i < MAX_NAMES));
      this.hud.setNearby(this.avatars.size);
    }
    this.scene.update();
    this.ambient.update(this.app.ticker.deltaMS, wallNow);
    this.daynight.update();
    if (this.screen && self) {
      const c = this.screen.center;
      this.screen.update(serverNow, Math.abs(c.x - self.pos.x) < 30 && Math.abs(c.y - self.pos.y) < 20);
    }
    // Stop following a game once we've wandered off.
    if (this.chess.open && self) {
      const t = this.furniture.tables.get(this.chess.table);
      if (t && Math.hypot(self.pos.x - t.tile.x, self.pos.y - t.tile.y) > WATCH_RANGE) this.chess.hide();
    }
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
