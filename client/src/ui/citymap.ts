// The city map (ADR 0010): the whole city drawn from the map, with every
// place named and "you" marked. Tap anywhere to walk there; long walks
// follow the streets.

import cityFile from "../../../assets/city/city.json";
import typesFile from "../../../assets/city/block_types.json";
import { type Geometry, blockOrigin, localAt, ownerAt } from "../world/city";
import { type ZoneMap, nearestWalkable } from "../world/map";
import { mapImage } from "../world/mapimage";
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

export interface CityMapHost {
  /** The city map and the player's tile, or null when not in the city. */
  where(): { map: ZoneMap; here: TileXY } | null;
  walk(t: TileXY): void;
  toCity(): void;
}

/** CSS pixels across the map in the panel. */
const SIZE = 400;

export class CityMapPanel extends Panel {
  private canvas = document.createElement("canvas");
  private label = el("p", "city-here");
  private timer = 0;

  constructor(private host: CityMapHost) {
    super("City map", "citymap");
    this.canvas.className = "city-canvas";
    this.canvas.onclick = (e) => this.tap(e);
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
    this.body.append(this.label, this.canvas, el("p", "hint", "Tap anywhere to walk there. Long walks follow the streets."));
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
    const px = Math.round(SIZE * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const k = px / map.width;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cityImage(map), 0, 0, px, px);
    // Block names, small, on a light backing so they read over anything.
    ctx.font = `${Math.round(10 * dpr)}px "Pixelify Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    cityFile.blocks.forEach((row, by) =>
      row.forEach((key, bx) => {
        if (key === "home") return;
        const o = blockOrigin(geometry, { bx, by });
        const cx = (o.x + geometry.blockTiles / 2) * k;
        const cy = (o.y + geometry.blockTiles / 2) * k;
        const name = blockName(bx, by).replace(" & Greenhouse", "");
        const tw = ctx.measureText(name).width + 6 * dpr;
        ctx.fillStyle = "rgba(255, 248, 227, 0.85)";
        ctx.fillRect(cx - tw / 2, cy - 7 * dpr, tw, 14 * dpr);
        ctx.fillStyle = "#3b3a2e";
        ctx.fillText(name, cx, cy + 0.5 * dpr);
      }),
    );
    drawYou(ctx, (here.x + 0.5) * k, (here.y + 0.5) * k, 4 * dpr, performance.now());
    this.label.textContent = `You're at: ${placeName(here.x, here.y)}`;
  }

  private tap(e: MouseEvent) {
    const w = this.host.where();
    if (!w) return;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * w.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * w.map.height);
    const t = nearestWalkable(w.map, x, y, 8);
    if (!t) return;
    this.hide();
    this.host.walk(t);
  }
}
