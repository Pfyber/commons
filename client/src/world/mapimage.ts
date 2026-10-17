// A picture of a whole map at one pixel per tile, for the minimap and the
// city map: ground colours, trees and hedges darker, buildings as roofs.

import type { ZoneMap } from "./map";

const GROUND: Record<string, string> = {
  grass: "#8cc46a",
  grass_dark: "#7bb55c",
  flowers: "#a5d27a",
  path: "#e6d3a3",
  plaza: "#ddd3be",
  water: "#5fa8d8",
  sand: "#ead9a6",
  soil: "#9a6b45",
  bridge: "#b0804d",
  floor: "#b0804d",
  pitch: "#78b85f",
  stones: "#7fb5d8",
  road: "#8a857b",
  curb: "#cfc6b2",
  carpet: "#c48d7a",
  fog: "#e3e9e6",
};

/** Decor drawn on the map (anything else is too small to show). */
const DECOR: Record<string, string> = {
  tree: "#5d9447",
  pine: "#4f8040",
  apple_tree: "#5d9447",
  willow: "#5d9447",
  willow_curtain: "#5d9447",
  pine_secret: "#4f8040",
  bush: "#6aa152",
  hedge: "#4e7d3c",
  wall: "#8a7a68",
  cafe_table: "#a0703f",
  fence: "#a0703f",
};

const OBJECTS: Record<string, string> = {
  building: "#a8735a",
  house: "#c98d5e",
  town_hall: "#b5544a",
  fountain: "#7fc3e8",
  big_screen: "#3d4a57",
  bandstand: "#c27a3c",
  tailor: "#c8553d",
  post_office: "#c8553d",
  apartments: "#a8735a",
  mall_entrance: "#4f6d8a",
  counter: "#a0703f",
  display: "#c98d5e",
  shelf: "#a0703f",
  mannequin: "#c9c2b0",
  fitting_room: "#8a5d8a",
  mirror: "#cfe8f5",
  popup: "#e8566b",
  mall_directory: "#3f7a8a",
  mall_exit: "#3f7a8a",
  stall: "#c27a3c",
};

/** Kinds that aren't drawn at all: markers and tiny props. */
const HIDDEN = new Set(["spot", "nook", "grove_slot", "signpost", "postbox", "dept", "shopfront"]);

export function mapImage(map: ZoneMap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = map.width;
  c.height = map.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(map.width, map.height);
  const rgb = (hex: string) => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
  const groundRgb = map.ground_legend.map((k) => rgb(GROUND[k] ?? "#8cc46a"));
  const decorRgb = map.decor_legend.map((k) => (DECOR[k] ? rgb(DECOR[k]) : null));
  for (let i = 0; i < map.width * map.height; i++) {
    const [r, g, b] = decorRgb[map.decor[i]] ?? groundRgb[map.ground[i]];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (const o of map.objects) {
    if (HIDDEN.has(o.kind)) continue;
    ctx.fillStyle = OBJECTS[o.kind] ?? "#8a6a50";
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }
  return c;
}
