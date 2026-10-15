// The minimap: the whole city in a corner, a pulsing dot where you are, the
// spot you're walking to, and the name of the place you're in. Tap it for
// the big city map.

import { blockOrigin, ownerAt } from "../world/city";
import type { ZoneMap } from "../world/map";
import type { TileXY } from "../world/motion";
import { cityImage, drawYou, geometry, placeName } from "./citymap";

export class Minimap {
  readonly el = document.createElement("button");
  private canvas = document.createElement("canvas");
  private name = document.createElement("span");
  private map: ZoneMap | null = null;
  private lastName = "";

  constructor(root: HTMLElement, onTap: () => void) {
    this.el.type = "button";
    this.el.className = "minimap";
    this.el.title = "City map (C)";
    this.el.setAttribute("aria-label", "City map");
    this.el.hidden = true;
    this.el.append(this.canvas, this.name);
    this.el.onclick = onTap;
    root.append(this.el);
  }

  /** Shows the minimap for a city map; hides it anywhere else. */
  setMap(map: ZoneMap | null) {
    this.map = map?.streets ? map : null;
    this.el.hidden = !this.map;
    this.lastName = "";
  }

  /** Call every frame with where the player is and is heading. */
  update(pos: TileXY, dest: TileXY | null, now: number) {
    const map = this.map;
    if (!map) return;
    const css = this.canvas.clientWidth || 160;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(css * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const k = px / map.width;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cityImage(map), 0, 0, px, px);
    if (dest && Math.hypot(dest.x - pos.x, dest.y - pos.y) > 2) {
      ctx.strokeStyle = "rgba(255, 248, 227, 0.9)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo((pos.x + 0.5) * k, (pos.y + 0.5) * k);
      ctx.lineTo((dest.x + 0.5) * k, (dest.y + 0.5) * k);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f6c343";
      ctx.fillRect((dest.x + 0.5) * k - 2.5 * dpr, (dest.y + 0.5) * k - 2.5 * dpr, 5 * dpr, 5 * dpr);
    }
    // The block you're in, outlined.
    const b = ownerAt(geometry, Math.round(pos.x), Math.round(pos.y));
    const o = blockOrigin(geometry, b);
    ctx.strokeStyle = "#f6c343";
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(o.x * k, o.y * k, geometry.blockTiles * k, geometry.blockTiles * k);
    drawYou(ctx, (pos.x + 0.5) * k, (pos.y + 0.5) * k, 4 * dpr, now);
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
