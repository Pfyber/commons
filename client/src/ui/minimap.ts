// The minimap: the whole city in a corner (an old atlas in a wooden frame), a pulsing dot where you are, the
// spot you're walking to, and the name of the place you're in. Tap it for
// the big city map.

import { blockOrigin, ownerAt } from "../world/city";
import { type ZoneMap, spot } from "../world/map";
import type { TileXY } from "../world/motion";
import { drawArrow, drawHome, drawOthers, drawRoute, geometry, placeName } from "./citymap";
import { atlasMap } from "./atlasmap";

export class Minimap {
  readonly el = document.createElement("button");
  private canvas = document.createElement("canvas");
  private name = document.createElement("span");
  private map: ZoneMap | null = null;
  private lastName = "";
  private homeLot: string | null = null;
  private home: TileXY | null = null;
  /** When it was last drawn (it's redrawn about 20 times a second, not every frame), and its size on screen. */
  private drawnAt = -Infinity;
  private css = 0;

  constructor(root: HTMLElement, onTap: () => void) {
    this.el.type = "button";
    this.el.className = "minimap";
    this.el.title = "City map (C)";
    this.el.setAttribute("aria-label", "City map");
    this.el.hidden = true;
    // An old atlas in a wood-and-brass frame.
    this.el.classList.add("style-wood");
    this.el.append(this.canvas, this.name);
    this.el.onclick = onTap;
    root.append(this.el);
  }

  /** Shows the minimap for a city map; hides it anywhere else. */
  setMap(map: ZoneMap | null) {
    this.map = map?.streets ? map : null;
    this.el.hidden = !this.map;
    this.lastName = "";
    this.setHome(this.homeLot);
  }

  /** Marks your home's door (null: no home). */
  setHome(lot: string | null) {
    this.homeLot = lot;
    this.home = lot && this.map ? spot(this.map, `door:${lot}`) : null;
  }

  /**
   * Call every frame with where the player is, the rest of their walk (if
   * walking), which way they face (radians) and where others nearby are.
   */
  update(pos: TileXY, route: TileXY[] | null, now: number, heading = Math.PI / 2, others: TileXY[] = []) {
    const map = this.map;
    // (Hidden, nothing to draw; and 20 frames a second is plenty for a map
    // the size of a stamp.)
    if (!map || this.el.hidden || now - this.drawnAt < 50) return;
    this.drawnAt = now;
    // (Its size, read now and then: reading it forces the page to lay out.)
    if (!this.css || now % 1000 < 50) this.css = this.canvas.clientWidth || 160;
    const css = this.css;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(css * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const k = px / map.width;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlasMap(map, px), 0, 0);
    // The way there, along the streets (not for a step or two).
    const end = route?.[route.length - 1];
    if (route && end && Math.hypot(end.x - pos.x, end.y - pos.y) > 2) drawRoute(ctx, route, k, 1.5 * dpr, now);
    // The block you're in, outlined.
    const b = ownerAt(geometry, Math.round(pos.x), Math.round(pos.y));
    const o = blockOrigin(geometry, b);
    ctx.strokeStyle = "#f6c343";
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(o.x * k, o.y * k, geometry.blockTiles * k, geometry.blockTiles * k);
    if (this.home) drawHome(ctx, (this.home.x + 0.5) * k, (this.home.y + 0.5) * k, 4 * dpr);
    drawOthers(ctx, others, k, 1.5 * dpr);
    drawArrow(ctx, (pos.x + 0.5) * k, (pos.y + 0.5) * k, 4.6 * dpr, heading, now);
    const name = placeName(Math.round(pos.x), Math.round(pos.y));
    if (name !== this.lastName) {
      this.lastName = name;
      this.name.textContent = name;
    }
  }

  destroy() {
    this.el.remove();
  }
}
