// The Commons Mall (ADR 0011): the directory map at the entrance. The floor
// drawn from the map, every shop named, "you are here", tap to walk there.

import departments from "../../../assets/mall/departments.json";
import { type ZoneMap, nearestWalkable, spot } from "../world/map";
import type { TileXY } from "../world/motion";
import { cityImage, drawYou } from "./citymap";
import { Panel, el } from "./panels";

const NAMES = new Map(departments.departments.map((d) => [d.key, d.name]));

export interface DirectoryHost {
  where(): { map: ZoneMap; here: TileXY } | null;
  walk(t: TileXY): void;
}

/** CSS pixels across the map in the panel. */
const SIZE = 400;

export class DirectoryPanel extends Panel {
  private canvas = document.createElement("canvas");
  private timer = 0;

  constructor(private host: DirectoryHost) {
    super("Directory", "citymap directory");
    this.canvas.className = "city-canvas";
    this.canvas.onclick = (e) => this.tap(e);
  }

  render() {
    this.body.replaceChildren();
    this.body.append(el("p", "hint", "Tap a shop to walk there. The food court is in the middle."), this.canvas);
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
    const pw = Math.round(SIZE * dpr);
    const ph = Math.round((pw * map.height) / map.width);
    if (this.canvas.width !== pw) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this.canvas.style.aspectRatio = `${map.width} / ${map.height}`;
    }
    const k = pw / map.width;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cityImage(map), 0, 0, pw, ph);
    ctx.font = `${Math.round(10 * dpr)}px "Pixelify Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tag = (text: string, x: number, y: number) => {
      const tw = ctx.measureText(text).width + 6 * dpr;
      ctx.fillStyle = "rgba(255, 248, 227, 0.9)";
      ctx.fillRect(x - tw / 2, y - 7 * dpr, tw, 14 * dpr);
      ctx.fillStyle = "#3b3a2e";
      ctx.fillText(text, x, y + 0.5 * dpr);
    };
    for (const o of map.objects) {
      if (o.kind === "dept" && o.label) tag(NAMES.get(o.label) ?? o.label, (o.x + o.w / 2) * k, (o.y + o.h / 2) * k);
    }
    const fc = spot(map, "food_court");
    if (fc) tag("Food court", (fc.x + 0.5) * k, (fc.y - 6) * k);
    const ent = spot(map, "entrance");
    if (ent) tag("Entrance · Pop-up", (ent.x + 0.5) * k, (ent.y - 6) * k);
    drawYou(ctx, (here.x + 0.5) * k, (here.y + 0.5) * k, 4 * dpr, performance.now());
  }

  private tap(e: MouseEvent) {
    const w = this.host.where();
    if (!w) return;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * w.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * w.map.height);
    // Tapping a shop walks to its doorway; anywhere else, to the nearest floor.
    const dept = w.map.objects.find((o) => o.kind === "dept" && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
    const t = (dept?.label && spot(w.map, `dept:${dept.label}`)) || nearestWalkable(w.map, x, y, 8);
    if (!t) return;
    this.hide();
    this.host.walk(t);
  }
}
