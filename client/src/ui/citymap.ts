// The city map (ADR 0010): the grid of blocks at a glance. Tap a block to
// walk there; long walks follow the streets.

import cityFile from "../../../assets/city/city.json";
import typesFile from "../../../assets/city/block_types.json";
import { type Geometry, blockOrigin, ownerAt } from "../world/city";
import type { TileXY } from "../world/motion";
import { Panel, button, el } from "./panels";

const geometry: Geometry = {
  blockTiles: cityFile.block_tiles,
  streetTiles: cityFile.street_tiles,
  blocks: cityFile.blocks.length,
  cellTiles: cityFile.cell_tiles,
};

const TYPES = new Map(typesFile.types.map((t) => [t.key, t]));

/** Where a walk to a block ends: in front of its sign on the south sidewalk. */
export function blockEntrance(bx: number, by: number): TileXY {
  const o = blockOrigin(geometry, { bx, by });
  return { x: o.x + 23, y: o.y + geometry.blockTiles - 2 };
}

export interface CityMapHost {
  /** The player's tile, or null when not in the city. */
  here(): TileXY | null;
  walk(t: TileXY): void;
  toCity(): void;
}

export class CityMapPanel extends Panel {
  constructor(private host: CityMapHost) {
    super("City map", "citymap");
  }

  render() {
    this.body.replaceChildren();
    const here = this.host.here();
    if (!here) {
      this.body.append(el("p", "hint", "The map is for the city streets. You're somewhere else right now."));
      this.body.append(button("Back to the city", () => (this.hide(), this.host.toCity()), "primary"));
      return;
    }
    const mine = ownerAt(geometry, here.x, here.y);
    this.body.append(el("p", "hint", "Tap a place to walk there. Long walks follow the streets."));
    const grid = el("div", "city-grid");
    cityFile.blocks.forEach((row, by) =>
      row.forEach((key, bx) => {
        const t = TYPES.get(key);
        const name = t?.name ?? key;
        const cell = el("button", `city-cell cat-${t?.category ?? "other"}`);
        cell.type = "button";
        cell.title = name;
        cell.append(el("span", "", key === "home" ? "" : name.replace(" & Greenhouse", "")));
        if (bx === mine.bx && by === mine.by) {
          cell.classList.add("here");
          cell.append(el("span", "you", "you"));
        }
        cell.onclick = () => {
          this.hide();
          this.host.walk(blockEntrance(bx, by));
        };
        grid.append(cell);
      }),
    );
    this.body.append(grid);
    const legend = el("div", "city-legend");
    for (const [cat, label] of [["market", "Market"], ["nature", "Nature"], ["landmark", "Places"], ["club", "Clubs"], ["home", "Homes"]]) {
      const item = el("span", `cat-${cat}`, label);
      legend.append(item);
    }
    this.body.append(legend);
  }
}
