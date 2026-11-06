// The city map (ADR 0010): the whole city drawn from the map, with every
// place named and "you" marked. Tap anywhere to walk there; long walks
// follow the streets. Filters light up what you're after: where to fish,
// where people live, what's fun, the shops, and what's on today. What
// they don't pick out loses some of its colour.

import cityFile from "../../../assets/city/city.json";
import typesFile from "../../../assets/city/block_types.json";
import { type Geometry, blockOrigin, localAt, ownerAt } from "../world/city";
import { type ZoneMap, nearestWalkable } from "../world/map";
import { mapImage } from "../world/mapimage";
import { atlasMap } from "./atlasmap";
import type { TileXY } from "../world/motion";
import { Panel, button, el } from "./panels";

export const geometry: Geometry = {
  blockTiles: cityFile.block_tiles,
  streetTiles: cityFile.street_tiles,
  blocks: cityFile.blocks.length,
  cellTiles: cityFile.cell_tiles,
};

const TYPES = new Map(typesFile.types.map((t) => [t.key, t]));

function blockName(bx: number, by: number): string {
  const key = cityFile.blocks[by]?.[bx];
  return TYPES.get(key)?.name ?? key ?? "";
}

/** What to call the place at (x, y): the block, or the street beside one. */
export function placeName(x: number, y: number): string {
  const l = localAt(geometry, x, y);
  if (l) return blockName(l.block.bx, l.block.by);
  const o = ownerAt(geometry, x, y);
  return `Street by the ${blockName(o.bx, o.by)}`;
}

const images = new WeakMap<ZoneMap, HTMLCanvasElement>();

/** The map's picture, drawn once per map. */
export function cityImage(map: ZoneMap): HTMLCanvasElement {
  let c = images.get(map);
  if (!c) {
    c = mapImage(map);
    images.set(map, c);
  }
  return c;
}

/**
 * You on a map: an aqua arrow pointing the way you face (`angle`, radians,
 * 0 = east), with a soft pulse round it. `r` is the arrow's half-length.
 */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, now: number) {
  const pulse = 1 + 0.3 * Math.sin(now / 250);
  ctx.fillStyle = "rgba(64, 224, 240, 0.28)";
  ctx.beginPath();
  ctx.arc(x, y, r * 1.6 * pulse, 0, Math.PI * 2);
  ctx.fill();
  const pts: [number, number][] = [
    [r * 1.25, 0],
    [-r * 0.85, r * 0.85],
    [-r * 0.35, 0],
    [-r * 0.85, -r * 0.85],
  ];
  const path = () => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const ax = x + px * Math.cos(angle) - py * Math.sin(angle);
      const ay = y + px * Math.sin(angle) + py * Math.cos(angle);
      if (i) ctx.lineTo(ax, ay);
      else ctx.moveTo(ax, ay);
    });
    ctx.closePath();
  };
  path();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, r * 0.45);
  ctx.strokeStyle = "#1d3a40";
  ctx.stroke();
  ctx.fillStyle = "#40e0f0";
  ctx.fill();
}

/** Someone else on a map (`friend`: one of yours). */
export type Other = TileXY & { friend?: boolean; bot?: boolean };

/** The swarm's bots sign in as players called `Bot 1`, `Bot 2`… (as the leaderboards tell them). */
export const isBotName = (name: string) => /^Bot [0-9]+$/.test(name);

/** Other people on a map: light blue dots with a dark edge, bots white; friends a touch bigger, blinking green and dark green. */
export function drawOthers(ctx: CanvasRenderingContext2D, others: Other[], k: number, r: number, now = 0) {
  const blink = Math.floor(now / 400) % 2 === 0;
  for (const o of others) {
    const x = (o.x + 0.5) * k;
    const y = (o.y + 0.5) * k;
    const size = o.friend ? r * 1.35 : r;
    ctx.fillStyle = "#3b3a2e";
    ctx.beginPath();
    ctx.arc(x, y, size + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = o.friend ? (blink ? "#4be36a" : "#1c7a38") : o.bot ? "#ffffff" : "#7fd4ff";
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A pulsing "you are here" marker. */
export function drawYou(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, now: number) {
  const pulse = 1 + 0.35 * Math.sin(now / 250);
  ctx.fillStyle = "rgba(232, 86, 107, 0.35)";
  ctx.beginPath();
  ctx.arc(x, y, r * 1.8 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3b3a2e";
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8566b";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The way you're walking: a dashed line along the streets from you to where
 * you're going (marching forward as you go), with a gold square at its end.
 * `k` is canvas pixels per tile, `w` the line's width.
 */
export function drawRoute(ctx: CanvasRenderingContext2D, route: TileXY[], k: number, w: number, now: number) {
  if (route.length < 2) return;
  const at = (p: TileXY) => [(p.x + 0.5) * k, (p.y + 0.5) * k] as const;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...at(route[0]));
  for (const p of route.slice(1)) ctx.lineTo(...at(p));
  // A dark edge under it, so it reads over pale streets and dark grass alike.
  ctx.strokeStyle = "rgba(59, 58, 46, 0.55)";
  ctx.lineWidth = w + 2;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 248, 227, 0.95)";
  ctx.lineWidth = w;
  ctx.setLineDash([w * 2.2, w * 1.8]);
  ctx.lineDashOffset = -(now / 40) % (w * 4);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  const [ex, ey] = at(route[route.length - 1]);
  const s = w * 3.4;
  ctx.fillStyle = "#3b3a2e";
  ctx.fillRect(ex - s / 2 - 1, ey - s / 2 - 1, s + 2, s + 2);
  ctx.fillStyle = "#f6c343";
  ctx.fillRect(ex - s / 2, ey - s / 2, s, s);
}

/** Your home's door on a map: a little gold house. */
export function drawHome(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = "#3b3a2e";
  ctx.beginPath();
  ctx.moveTo(x - s - 1, y);
  ctx.lineTo(x, y - s - 1.5);
  ctx.lineTo(x + s + 1, y);
  ctx.fill();
  ctx.fillRect(x - s * 0.75 - 1, y - 1, s * 1.5 + 2, s + 2);
  ctx.fillStyle = "#f6c343";
  ctx.beginPath();
  ctx.moveTo(x - s + 0.5, y - 0.5);
  ctx.lineTo(x, y - s);
  ctx.lineTo(x + s - 0.5, y - 0.5);
  ctx.fill();
  ctx.fillRect(x - s * 0.75, y - 0.5, s * 1.5, s);
}

export interface CityMapHost {
  /** The city map, the player's tile and their home's door, or null when not in the city. */
  where(): { map: ZoneMap; here: TileXY; home: TileXY | null; route: TileXY[] | null; heading: number; others: Other[] } | null;
  walk(t: TileXY): void;
  toCity(): void;
  /** What's on today, and where. */
  events(map: ZoneMap): Promise<MapPlace[]>;
}

/** Somewhere a filter lights up, in tiles; `name`: its tag (none for the likes of each house). */
export interface MapPlace {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  /** A little one: its tag's smaller. */
  small?: boolean;
}

/** Under this many tiles, a stretch of water's a little fishing spot (not a Pond or the Lake). */
const SMALL_WATER = 100;

/** Every body of water on the map, big or small: you can fish in any of them. */
function waters(map: ZoneMap): MapPlace[] {
  const water = map.ground_legend.indexOf("water");
  const W = map.width;
  const seen = new Uint8Array(map.ground.length);
  const out: MapPlace[] = [];
  for (let i = 0; i < map.ground.length; i++) {
    if (map.ground[i] !== water || seen[i]) continue;
    // Spread out from here over all the water that joins on to it.
    const todo = [i];
    seen[i] = 1;
    let [n, x0, y0, x1, y1] = [0, Infinity, Infinity, -1, -1];
    while (todo.length) {
      const c = todo.pop()!;
      const x = c % W;
      const y = (c - x) / W;
      n++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
        const j = ny * W + nx;
        if (map.ground[j] === water && !seen[j]) {
          seen[j] = 1;
          todo.push(j);
        }
      }
    }
    const small = n < SMALL_WATER;
    const name = small ? "Fishing spot" : placeName(Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2));
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, name, small });
  }
  return out;
}

/** How much of its colour what a filter isn't picking out keeps. */
const MUTED_COLOUR = 0.6;

/** The whole picture washed out a bit (for what a filter isn't picking out), once per size. */
const muteds = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function muted(atlas: HTMLCanvasElement): HTMLCanvasElement {
  let c = muteds.get(atlas);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = atlas.width;
  c.height = atlas.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(atlas, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    for (let j = 0; j < 3; j++) d[i + j] = v + (d[i + j] - v) * MUTED_COLOUR;
  }
  ctx.putImageData(img, 0, 0);
  muteds.set(atlas, c);
  return c;
}

const FILTERS = [
  { key: "fish", label: "🎣 Fishing", color: "#3fb6e8" },
  { key: "homes", label: "🏠 Homes", color: "#7fe06a" },
  { key: "fun", label: "🎉 Fun", color: "#ff6ac0" },
  { key: "shops", label: "🛒 Shops", color: "#ffd23f" },
  { key: "events", label: "📣 What's on", color: "#ff7a3f" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/** Which buildings count as what (object kinds, and what to call them). */
const FUN: Record<string, string> = { arena_bowl: "Arena", arcade_hall: "Arcade", paintball_hall: "Splat Yard", bowling_alley: "Bowling", casino: "Casino", concert_hall: "Concert Hall", bar: "The Mossy Mug", bandstand: "Bandstand" };
const SHOPS: Record<string, string> = { mall_entrance: "Commons Mall", tailor: "Tailor", post_office: "Post Office", fisherman: "Fisherman" };
const FILTER_KEY = "commons.mapfilters";

/** What filter `key` lights up on `map` (what's on comes from `CityMapHost.events`). */
function placesFor(map: ZoneMap, key: FilterKey): MapPlace[] {
  const of = (o: { x: number; y: number; w: number; h: number }, name?: string): MapPlace => ({ x: o.x, y: o.y, w: o.w, h: o.h, name });
  const out: MapPlace[] = [];
  for (const o of map.objects) {
    if (key === "fish" && o.kind === "boat_hire") out.push(of(o, "Boat hire"));
    if (key === "homes" && o.kind === "apartments") out.push(of(o, "Apartments"));
    if (key === "homes" && o.kind === "house") out.push(of(o));
    if (key === "fun" && FUN[o.kind]) out.push(of(o, FUN[o.kind]));
    if (key === "fun" && o.kind === "building" && o.label === "Cinema") out.push(of(o, "Cinema"));
    if (key === "shops" && SHOPS[o.kind]) out.push(of(o, SHOPS[o.kind]));
    if (key === "shops" && o.kind === "stall") out.push(of(o));
  }
  if (key === "fish") out.push(...waters(map));
  return out;
}

/** The most pixels across it's drawn at (past that the picture's only scaled up). */
const MAX_PX = 1800;

export class CityMapPanel extends Panel {
  private canvas = document.createElement("canvas");
  private label = el("p", "city-here");
  private timer = 0;
  private chips = el("div", "city-filters");
  private note = el("p", "hint city-note");
  /** The filters on (kept for next time), and what's on, as last heard. */
  private on = new Set<FilterKey>();
  private events: MapPlace[] = [];

  constructor(private host: CityMapHost) {
    super("City map", "citymap");
    this.sticky = true;
    this.canvas.className = "city-canvas";
    this.canvas.onclick = (e) => this.tap(e);
    // The ⛶ button: the whole screen, remembered for next time.
    this.enlargeable(this.canvas);
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "[]") as FilterKey[];
      this.on = new Set(saved.filter((k) => FILTERS.some((f) => f.key === k)));
    } catch {
      // storage unavailable, or junk in it
    }
  }

  /** The filter chips, each lit in its colour while it's on. */
  private renderChips() {
    this.chips.replaceChildren(
      ...FILTERS.map((f) => {
        const b = button(f.label, () => this.toggle_(f.key), this.on.has(f.key) ? "small city-chip on" : "small city-chip");
        b.style.setProperty("--chip", f.color);
        return b;
      }),
    );
  }

  private toggle_(key: FilterKey) {
    if (this.on.has(key)) this.on.delete(key);
    else this.on.add(key);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify([...this.on]));
    } catch {
      // storage unavailable
    }
    this.renderChips();
    if (key === "events" && this.on.has(key)) void this.loadEvents();
    this.showNote();
  }

  /** What's on now, freshly heard. */
  private async loadEvents() {
    const w = this.host.where();
    if (!w) return;
    this.note.textContent = "Asking around town…";
    try {
      this.events = await this.host.events(w.map);
    } catch {
      this.events = [];
    }
    this.showNote();
  }

  private showNote() {
    const onNow = this.on.has("events");
    this.note.hidden = !onNow;
    if (onNow) this.note.textContent = this.events.length ? `On today: ${this.events.map((e) => e.name).join(" · ")}` : "Nothing special on today.";
  }

  render() {
    this.body.replaceChildren();
    const w = this.host.where();
    if (!w) {
      this.body.append(el("p", "hint", "The map is for the city streets. You're somewhere else right now."));
      this.body.append(button("Back to the city", () => (this.hide(), this.host.toCity()), "primary"));
      return;
    }
    this.label.textContent = `You're at: ${placeName(w.here.x, w.here.y)}`;
    this.renderChips();
    this.showNote();
    if (this.on.has("events")) void this.loadEvents();
    this.body.append(this.label, this.chips, this.canvas, this.note, el("p", "hint", "Tap anywhere to walk there: your route shows on the map. Long walks follow the streets."));
    this.draw();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => (this.open ? this.draw() : window.clearInterval(this.timer)), 50);
  }

  hide() {
    super.hide();
    window.clearInterval(this.timer);
  }

  private draw() {
    const w = this.host.where();
    if (!w) return;
    const { map, here } = w;
    const dpr = window.devicePixelRatio || 1;
    // As big as it's shown, however big that is (a step at a time, so
    // dragging the window doesn't redraw the atlas at every size on the way).
    const px = Math.min(MAX_PX, Math.ceil((this.canvas.clientWidth * dpr) / 50) * 50) || 400;
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const k = px / map.width;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    // With a filter on: all washed out a bit, and only what it picks out in full colour.
    const filtered = this.on.size > 0;
    const lit = filtered ? this.lit(map, w.home) : [];
    const atlas = atlasMap(map, px);
    ctx.drawImage(filtered ? muted(atlas) : atlas, 0, 0);
    for (const { p } of lit) {
      const [x, y, pw, ph] = [(p.x - 1) * k, (p.y - 1) * k, (p.w + 2) * k, (p.h + 2) * k];
      ctx.drawImage(atlas, x, y, pw, ph, x, y, pw, ph);
    }
    // Block names in serif ink on little parchment labels, as on an old atlas.
    ctx.font = `italic ${Math.round(10 * dpr)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const names: [number, number, number, number][] = [];
    cityFile.blocks.forEach((row, by) =>
      row.forEach((key, bx) => {
        if (key === "home") return;
        const o = blockOrigin(geometry, { bx, by });
        const cx = (o.x + geometry.blockTiles / 2) * k;
        const cy = (o.y + geometry.blockTiles / 2) * k;
        const name = blockName(bx, by).replace(" & Greenhouse", "");
        const tw = ctx.measureText(name).width + 6 * dpr;
        names.push([cx - tw / 2, cy - 7 * dpr, cx + tw / 2, cy + 7 * dpr]);
        ctx.fillStyle = "rgba(240, 228, 196, 0.9)";
        ctx.fillRect(cx - tw / 2, cy - 7 * dpr, tw, 14 * dpr);
        ctx.strokeStyle = "rgba(58, 42, 26, 0.7)";
        ctx.lineWidth = Math.max(1, dpr * 0.75);
        ctx.strokeRect(cx - tw / 2 + 0.5, cy - 7 * dpr + 0.5, tw - 1, 14 * dpr - 1);
        ctx.fillStyle = "#3a2a1a";
        ctx.fillText(name, cx, cy + 0.5 * dpr);
      }),
    );
    this.drawFilters(ctx, lit, k, dpr, px, names);
    // Metro stations (ADR 0016): a little red M (washed out too, under a filter).
    for (const o of map.objects) {
      if (o.kind !== "metro_entrance") continue;
      const x = (o.x + 1) * k;
      const y = (o.y + 1) * k;
      ctx.fillStyle = "#3b3a2e";
      ctx.beginPath();
      ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = filtered ? "#b0705f" : "#c8553d";
      ctx.beginPath();
      ctx.arc(x, y, 5.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff8e3";
      ctx.font = `bold ${Math.round(8 * dpr)}px "Pixelify Sans", sans-serif`;
      ctx.fillText("M", x, y + 0.5 * dpr);
    }
    if (w.home) drawHome(ctx, (w.home.x + 0.5) * k, (w.home.y + 0.5) * k, 6 * dpr);
    const now = performance.now();
    if (w.route) drawRoute(ctx, w.route, k, 2.6 * dpr, now);
    drawOthers(ctx, w.others, k, 2.5 * dpr, now);
    const you = w.route?.[0] ?? here;
    drawArrow(ctx, (you.x + 0.5) * k, (you.y + 0.5) * k, 6.5 * dpr, w.heading, now);
    this.label.textContent = `You're at: ${placeName(here.x, here.y)}`;
  }

  /** All the filters on pick out. */
  private lit(map: ZoneMap, home: TileXY | null): { p: MapPlace; color: string }[] {
    const lit: { p: MapPlace; color: string }[] = [];
    for (const f of FILTERS) {
      if (!this.on.has(f.key)) continue;
      const places = f.key === "events" ? this.events : placesFor(map, f.key);
      for (const p of places) lit.push({ p, color: f.color });
      if (f.key === "homes" && home) lit.push({ p: { x: home.x - 1, y: home.y - 1, w: 3, h: 3, name: "Your home" }, color: f.color });
    }
    return lit;
  }

  /** What the filters pick out: each outlined in its colour, breathing, its name on a tag where it has one. */
  private drawFilters(ctx: CanvasRenderingContext2D, lit: { p: MapPlace; color: string }[], k: number, dpr: number, px: number, names: [number, number, number, number][]) {
    if (!lit.length) return;
    const pad = 1;
    const breath = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    for (const { p, color } of lit) {
      ctx.strokeStyle = color;
      ctx.lineWidth = (1 + breath * (p.name ? 1.2 : 0.4)) * dpr;
      ctx.strokeRect((p.x - pad) * k, (p.y - pad) * k, (p.w + pad * 2) * k, (p.h + pad * 2) * k);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // The tags: over each place, or under it if that's taken (or a block's name
    // is there); what's on goes first, and one with no room waits for a bigger
    // view (its outline still shows).
    const placed = [...names];
    const clear = (x0: number, y0: number, x1: number, y1: number) => x0 >= 0 && y0 >= 0 && x1 <= px && y1 <= px && !placed.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b);
    for (let i = lit.length - 1; i >= 0; i--) {
      const { p, color } = lit[i];
      if (!p.name) continue;
      ctx.font = `bold ${Math.round((p.small ? 7.5 : 10) * dpr)}px Georgia, "Times New Roman", serif`;
      const tw = ctx.measureText(p.name).width + (p.small ? 5 : 8) * dpr;
      const th = (p.small ? 10 : 14) * dpr;
      const cx = Math.max(tw / 2 + dpr, Math.min(px - tw / 2 - dpr, (p.x + p.w / 2) * k));
      const above = (p.y - pad) * k - th / 2 - 3 * dpr;
      const below = (p.y + p.h + pad) * k + th / 2 + 3 * dpr;
      const fits = (y: number) => clear(cx - tw / 2 - dpr, y - th / 2 - dpr, cx + tw / 2 + dpr, y + th / 2 + dpr);
      const cy = fits(above) ? above : fits(below) ? below : null;
      if (cy === null) continue;
      placed.push([cx - tw / 2 - dpr, cy - th / 2 - dpr, cx + tw / 2 + dpr, cy + th / 2 + dpr]);
      ctx.fillStyle = "#2b1a0e";
      ctx.fillRect(cx - tw / 2 - dpr, cy - th / 2 - dpr, tw + 2 * dpr, th + 2 * dpr);
      ctx.fillStyle = color;
      ctx.fillRect(cx - tw / 2, cy - th / 2, tw, th);
      ctx.fillStyle = "#1e140a";
      ctx.fillText(p.name, cx, cy + 0.5 * dpr);
    }
  }

  private tap(e: MouseEvent) {
    const w = this.host.where();
    if (!w) return;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * w.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * w.map.height);
    const t = nearestWalkable(w.map, x, y, 8);
    if (!t) return;
    // The map stays open, showing the way there (close it whenever you like).
    this.host.walk(t);
  }
}
