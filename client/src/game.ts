// Ties the zone connection, world rendering, avatars, input and HUD together.

import { type Application, type FederatedPointerEvent, Sprite } from "pixi.js";
import { ChessPanel, type GameStateMsg } from "./activities/chess";
import { BigScreen } from "./activities/screen";
import { Ambient } from "./ambient/ambient";
import { DayNight } from "./ambient/daynight";
import type { Economy } from "./economy";
import type { ServerMsg } from "./net/protocol.gen";
import type { Social } from "./social";
import type { FriendsPanel } from "./ui/social";
import { type CloseReason, ZoneSocket } from "./net/socket";
import type { Hud } from "./ui/hud";
import type { ActionMenu, AlbumPanel, BagPanel, MarketPanel, PlaceBanner, PlotMenu, ReelGame } from "./ui/panels";
import { Avatar } from "./world/avatars";
import { Furniture } from "./world/furniture";
import { type ZoneMap, groundAt, nearestWalkable, stepTarget, walkable } from "./world/map";
import { type TileXY, WALK_SPEED_X10, splice } from "./world/motion";
import { compress, findPath } from "./world/path";
import { Props } from "./world/props";
import { giftBoxTexture } from "./world/items";
import { TILE } from "./world/art";
import { Scene } from "./world/scene";

/** Error codes from server/crates/protocol (error_code). */
const ERR = { NO_PATH: 4, RATE_LIMITED: 5, REPLACED: 6, UNAUTHORIZED: 2, VERSION_MISMATCH: 3 };
/** Errors worth showing to the player as-is. */
const TOAST_CODES = new Set([ERR.RATE_LIMITED, 9, 10, 11, 12, 13]);
const FISHING = 2;
const FISH = { CAST: 0, BITE: 1, CAUGHT: 2, ESCAPED: 3 };
/** Casts reach this far from where you stand (server: CAST_RANGE). */
const CAST_RANGE = 2;
/** Matches the server's bite window minus a little latency headroom. */
const REEL_WINDOW_MS = 2300;

/** UI shared across zones (created once in main). */
export interface Ui {
  hud: Hud;
  eco: Economy;
  bag: BagPanel;
  album: AlbumPanel;
  market: MarketPanel;
  plot: PlotMenu;
  reel: ReelGame;
  place: PlaceBanner;
  menu: ActionMenu;
  social: Social;
  friends: FriendsPanel;
}

/** Where this Game is: label for the HUD and, for homes, whose. */
export interface Place {
  label: string;
  owner: string | null;
}

/** Tiles in front of the cottage door where gifts are left (home map). */
const DOORSTEP: TileXY[] = [
  { x: 8, y: 10 },
  { x: 11, y: 10 },
  { x: 7, y: 10 },
  { x: 12, y: 10 },
  { x: 6, y: 10 },
  { x: 13, y: 10 },
];

const cheb = (a: TileXY, b: TileXY) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
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
  readonly props: Props;
  private hud: Hud;
  private ambient: Ambient;
  private daynight: DayNight;

  constructor(
    private app: Application,
    map: ZoneMap,
    readonly zoneId: string,
    readonly place: Place,
    private ui: Ui,
    private labels: HTMLElement,
    private events: { onWelcome(): void; onDisconnect(reason: CloseReason): void; onTravel(zone: string): void },
  ) {
    this.hud = ui.hud;
    this.scene = new Scene(app, map);
    this.props = new Props(this.scene, map, ui.eco);
    ui.bag.placeable = zoneId === "home" && place.owner === ui.social.selfId;
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
        this.hud.setPlace(this.place.label || this.scene.map.name, m.instance);
        if (this.isOwnHome) void this.loadGifts();
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
        if (!a || this.ui.social.isBlockedName(a.info.name)) break;
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
      case "FishEvent":
        this.onFish(m);
        break;
      case "PlotState": {
        const info = { plant: m.plant, stage: m.stage, watered: m.watered, owner: m.owner, stageLeftMs: m.stageLeftMs };
        this.props.setPlot(m.x, m.y, info);
        this.ui.plot.update(m.x, m.y, info);
        break;
      }
      case "ObjectUpdate":
        this.props.setObject(m.x, m.y, m.item);
        break;
      case "Granted":
        this.ui.eco.setTotal(m.item, m.total, m.first);
        if (m.added > 0) {
          const name = this.ui.eco.name(m.item);
          this.hud.toast(`+${m.added} ${name}${m.first ? " · new in your album!" : ""}`, 3500);
        }
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
    const tap = (e: FederatedPointerEvent) => {
      const t = this.scene.screenToTile(e.global.x, e.global.y);
      if (this.tapAvatar(e.global.x, e.global.y)) return;
      if (this.tapGift(t)) return;
      if (this.tapCollect(t)) return;
      const id = this.furniture.idAt(t);
      const seat = this.furniture.seats.get(id);
      if (seat) return this.sitAt(seat.id);
      const table = this.furniture.tables.get(id);
      if (table) return this.watchTable(table.id);
      const target = nearestWalkable(this.scene.map, t.x, t.y, 2);
      if (target) this.moveTo(target, true);
    };
    stage.on("pointertap", tap);
    this.disposers.push(() => stage.off("pointertap", tap));

    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") {
        this.ui.place.hide();
        return;
      }
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

  // ---- people & gifts ---------------------------------------------------------

  private get isOwnHome(): boolean {
    return this.zoneId === "home" && this.place.owner === this.ui.social.selfId;
  }

  /** Tapping another avatar: befriend, message or block them. */
  private tapAvatar(sx: number, sy: number): boolean {
    for (const a of this.avatars.values()) {
      if (a.info.id === this.selfId) continue;
      const b = a.sprite.getBounds();
      if (sx < b.minX || sx > b.maxX || sy < b.minY || sy > b.maxY) continue;
      const social = this.ui.social;
      const name = a.info.name;
      const friend = social.friendByName(name);
      const say = (p: Promise<string | void>) => p.then((t) => t && this.hud.toast(t)).catch((e) => this.hud.toast(e?.message ?? "That didn't work."));
      const actions: [string, () => void][] = friend
        ? [["Message", () => this.ui.friends.chatWith(friend)]]
        : [["Add friend", () => void say(social.request(name))]];
      actions.push(["Block", () => confirm(`Block ${name}? You won't see their chat, and they can't contact you.`) && void say(social.block(name).then(() => `Blocked ${name}.`))]);
      this.ui.menu.showWith(name, friend ? (friend.level >= 2 ? "Close friend" : "Friend") : "", actions);
      return true;
    }
    return false;
  }

  private gifts = new Map<string, { sprite: Sprite; tile: TileXY; id: string }>();

  /** Gifts waiting on your doorstep (spec §8.1). */
  private async loadGifts() {
    const gifts = await this.ui.social.gifts().catch(() => []);
    for (const g of this.gifts.values()) g.sprite.destroy();
    this.gifts.clear();
    gifts.slice(0, DOORSTEP.length).forEach((g, i) => {
      const tile = DOORSTEP[i];
      const sprite = new Sprite(giftBoxTexture());
      sprite.anchor.set(0.5, 1);
      sprite.position.set(tile.x * TILE + TILE / 2, tile.y * TILE + TILE - 2);
      sprite.zIndex = tile.y * TILE + TILE - 2;
      this.scene.sorted.addChild(sprite);
      this.gifts.set(`${tile.x},${tile.y}`, { sprite, tile, id: g.id });
    });
    if (gifts.length) this.hud.toast(`${gifts.length === 1 ? "A gift is" : `${gifts.length} gifts are`} waiting on your doorstep 🎁`, 4000);
  }

  private tapGift(t: TileXY): boolean {
    const g = this.gifts.get(`${t.x},${t.y}`);
    if (!g) return false;
    this.ui.social
      .openGift(g.id)
      .then((r) => {
        const [item, qty] = r.applied.added[0] ?? [0, 0];
        this.hud.toast(`🎁 ${qty} ${this.ui.eco.name(item)} from ${r.from_name}`, 4000);
        return this.ui.eco.load();
      })
      .catch((e) => this.hud.toast(e?.message ?? "That didn't work."))
      .finally(() => void this.loadGifts());
    return true;
  }

  // ---- collecting: fishing, gardens, market, homes ---------------------------

  /** Handles taps on M3 things; returns true if the tap was used. */
  private tapCollect(t: TileXY): boolean {
    const map = this.scene.map;
    const self = this.self;
    if (!self) return false;
    const ui = this.ui;
    if (ui.place.item) {
      this.socket?.send({ t: "Place", item: ui.place.item.id, x: t.x, y: t.y });
      ui.place.hide();
      return true;
    }
    const placed = this.props.objectAt(t.x, t.y);
    if (placed && this.zoneId === "home") {
      ui.menu.showWith(ui.eco.name(placed), "", [["Pick up", () => this.socket?.send({ t: "Pickup", x: t.x, y: t.y })]]);
      return true;
    }
    // Map objects: the drawn art reaches a couple of tiles above the footprint.
    const obj = map.objects.find((o) => t.x >= o.x && t.x < o.x + o.w && t.y >= o.y - 2 && t.y < o.y + o.h);
    if (obj?.kind === "market_cart") {
      const spot = this.furniture.approach({ x: obj.x, y: obj.y + 1 }, self.destination) ?? { x: obj.x, y: obj.y + 1 };
      if (cheb(self.destination, { x: obj.x, y: obj.y }) > 3) this.moveTo(spot, true);
      ui.market.show();
      return true;
    }
    if (obj?.kind === "homes_gate") {
      this.events.onTravel("home");
      return true;
    }
    if (obj?.kind === "park_gate") {
      this.events.onTravel("founders_park");
      return true;
    }
    const ground = groundAt(map, t.x, t.y);
    if (ground === "water") {
      this.fish(t);
      return true;
    }
    if (ground === "soil") {
      ui.plot.showFor(t.x, t.y, this.props.plotAt(t.x, t.y));
      return true;
    }
    return false;
  }

  /** Walks within reach of the water if needed, then casts. */
  private fish(target: TileXY) {
    const self = this.self;
    if (!self || !this.socket) return;
    if (self.state === FISHING) return;
    if (cheb(self.destination, target) > CAST_RANGE || !walkable(this.scene.map, self.destination.x, self.destination.y)) {
      const spot = this.castSpot(target, self.destination);
      if (!spot) return this.hud.toast("Find a spot on the shore.");
      this.moveTo(spot, true);
    }
    this.socket.send({ t: "FishCast", x: target.x, y: target.y });
  }

  /** The walkable tile within casting range of `target` nearest to `from`. */
  private castSpot(target: TileXY, from: TileXY): TileXY | null {
    let best: TileXY | null = null;
    let bestD = Infinity;
    for (let dy = -CAST_RANGE; dy <= CAST_RANGE; dy++) {
      for (let dx = -CAST_RANGE; dx <= CAST_RANGE; dx++) {
        const c = { x: target.x + dx, y: target.y + dy };
        if (!walkable(this.scene.map, c.x, c.y)) continue;
        const d = Math.hypot(c.x - from.x, c.y - from.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  private onFish(m: Extract<ServerMsg, { t: "FishEvent" }>) {
    const isSelf = m.id === this.selfId;
    switch (m.kind) {
      case FISH.CAST:
        this.props.cast(m.id, { x: m.x, y: m.y });
        break;
      case FISH.BITE:
        this.props.bite(m.id);
        if (isSelf) this.ui.reel.play(REEL_WINDOW_MS, (quality) => this.socket?.send({ t: "FishReel", quality }));
        break;
      case FISH.CAUGHT: {
        this.props.reelIn(m.id);
        if (isSelf) this.ui.reel.stop();
        this.avatars.get(m.id)?.say(`🎣 ${this.ui.eco.name(m.item)}!`);
        break;
      }
      case FISH.ESCAPED:
        this.props.reelIn(m.id);
        if (isSelf) {
          this.ui.reel.stop();
          this.hud.toast("It got away…");
        }
        break;
    }
  }

  /** Garden action from the plot menu: walk next to the plot, then act. */
  plotAction(x: number, y: number, action: number, item: number) {
    const self = this.self;
    if (!self || !this.socket) return;
    if (cheb(self.destination, { x, y }) > 1) {
      const spot = this.furniture.approach({ x, y }, self.destination) ?? { x, y };
      this.moveTo(spot, true);
    }
    this.socket.send({ t: "PlotAction", x, y, action, item });
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
    this.props.update(wallNow);
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
    this.chess.el.remove();
    this.daynight.destroy();
    for (const p of [this.ui.plot, this.ui.menu, this.ui.market]) p.hide();
    this.ui.reel.stop();
    this.ui.place.hide();
    this.app.stage.removeChild(this.scene.world);
    this.scene.world.destroy({ children: true });
  }
}

function dist2(a: TileXY, b: TileXY) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
