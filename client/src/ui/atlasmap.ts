// The city drawn as an old atlas, for the minimap and the city map: muted
// antique colours on paper, roads edged in ink, water with coastline rings
// and little waves, trees as inked crowns, and every building as a proper
// map symbol (a drop shadow, a hatched roof with its ridge, an ink outline;
// houses in an assortment of roof colours), finished with a meridian grid,
// fold creases, a darkened rim and a compass rose. Drawn at the size it's
// shown, so the detail stays crisp (cached per map and size).

import type { ZoneMap } from "../world/map";

const GRASS = 0;
const TREE = 1;
const WATER = 2;
const ROAD = 3;
const KERB = 4;
const PAVED = 5;
const SOIL = 6;
/** The ring roads' brick, and grass under woods (thick with trees round about). */
const BRICK = 7;
const WOODS = 8;

const GROUND_KIND: Record<string, number> = {
  water: WATER,
  stones: WATER,
  road: ROAD,
  curb: KERB,
  plaza: PAVED,
  path: PAVED,
  sand: PAVED,
  bridge: PAVED,
  floor: PAVED,
  track: PAVED,
  soil: SOIL,
  brick: BRICK,
  moss: WOODS,
};
const TREES = new Set(["tree", "pine", "apple_tree", "willow", "willow_curtain", "pine_secret", "bush", "hedge"]);
/** Objects with no symbol of their own (markers, small props). */
// (`boat_lake` only marks the water the rowboats go on, and `forage` where bugs and mushrooms turn up.)
const HIDDEN = new Set(["spot", "nook", "grove_slot", "signpost", "postbox", "dept", "shopfront", "arena", "lamp", "boat_lake", "boat_moored", "yard_stand", "forage"]);

/** Ground colours: grass, trees (under their crowns), water, road, kerb, paving, soil, brick, woods. */
const PAPER = ["#cfd3a0", "#bcc48c", "#9cbfc0", "#a3927a", "#e6d9b6", "#ece0c0", "#c8a878", "#b8705a", "#85a05c"];
const INK = "#3a2a1a";

function rnd(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hex(h: string): [number, number, number] {
  return [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
}

/** Each tile's ground kind (trees by their decor), once per map. */
const kindsCache = new WeakMap<ZoneMap, Uint8Array>();
function kinds(map: ZoneMap): Uint8Array {
  let k = kindsCache.get(map);
  if (k) return k;
  k = new Uint8Array(map.width * map.height);
  const g = map.ground_legend.map((n) => GROUND_KIND[n] ?? GRASS);
  const d = map.decor_legend.map((n) => TREES.has(n));
  for (let i = 0; i < k.length; i++) k[i] = d[map.decor[i]] ? TREE : g[map.ground[i]];
  // Woods: grass with trees thick about it (a seven-tile square holding eight or more).
  const W = map.width;
  const trees = new Uint16Array((W + 1) * (map.height + 1));
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < W; x++) trees[(y + 1) * (W + 1) + x + 1] = (k[y * W + x] === TREE ? 1 : 0) + trees[y * (W + 1) + x + 1] + trees[(y + 1) * (W + 1) + x] - trees[y * (W + 1) + x];
  const sum = (x0: number, y0: number, x1: number, y1: number) => {
    const [a, b, c, e] = [Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(map.height, y1)];
    return trees[e * (W + 1) + c] - trees[b * (W + 1) + c] - trees[e * (W + 1) + a] + trees[b * (W + 1) + a];
  };
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < W; x++) if (k[y * W + x] === GRASS && sum(x - 3, y - 3, x + 4, y + 4) >= 8) k[y * W + x] = WOODS;
  for (const o of map.objects) {
    if (o.kind !== "fountain") continue;
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) k[y * map.width + x] = WATER;
  }
  kindsCache.set(map, k);
  return k;
}

/** The ground at one pixel a tile: paper colours, roads edged in ink. */
function groundImage(map: ZoneMap): HTMLCanvasElement {
  const W = map.width;
  const H = map.height;
  const k = kinds(map);
  const rgb = PAPER.map(hex);
  const ink = hex("#6a5236");
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const kind = k[i];
      let col = rgb[kind === TREE ? WOODS : kind];
      // The road's edge (cobbles or the rings' brick), inked where it meets the kerb.
      if (kind === ROAD || kind === BRICK) {
        const n = (dx: number, dy: number) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < W && ny < H && k[ny * W + nx] !== ROAD && k[ny * W + nx] !== BRICK;
        };
        if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) col = ink;
      }
      const v = (rnd(x, y, 3) - 0.5) * 12;
      img.data[i * 4] = Math.max(0, Math.min(255, col[0] + v));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, col[1] + v));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, col[2] + v));
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Roof colours for houses (picked per house) and for each kind of building. */
const HOUSE_ROOFS = ["#a8503f", "#5a6a78", "#6a7a4a", "#8a5a3a", "#9a6a5a", "#7a4a5a"];
const ROOFS: Record<string, string> = {
  town_hall: "#b5544a",
  library: "#8a7a62",
  club_hall: "#8a3a33",
  bar: "#6a4a32",
  arcade_hall: "#4a3a62",
  bowling_alley: "#2f7a76",
  paintball_hall: "#a8423d",
  casino: "#7a2a4a",
  museum: "#b8ad94",
  gallery: "#c98a5a",
  concert_hall: "#5a3a6a",
  boat_hire: "#4f86b0",
  metro_entrance: "#c8342e",
  mall_entrance: "#8a5236",
  apartments: "#a8503f",
  post_office: "#4a5a78",
  stall: "#b56a3a",
  bandstand: "#a8704a",
  big_screen: "#3d4a57",
  tailor: "#b5443a",
};

const cache = new Map<string, HTMLCanvasElement>();
let cacheMap: ZoneMap | null = null;

/** The atlas, `size` pixels square. */
export function atlasMap(map: ZoneMap, size: number): HTMLCanvasElement {
  if (cacheMap !== map) {
    cache.clear();
    cacheMap = map;
  }
  const hit = cache.get(String(size));
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const W = map.width;
  const k = size / W;
  const kinds_ = kinds(map);
  const kindAt = (x: number, y: number) => kinds_[Math.min(map.height - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)))];
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(groundImage(map), 0, 0, size, size);

  // Fields stippled; water with coastline rings and wave ticks.
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const tx = px / k;
      const ty = py / k;
      const kind = kindAt(tx, ty);
      if (kind === GRASS && rnd(px, py, 5) < 0.06) {
        ctx.fillStyle = "rgba(80,90,40,0.35)";
        ctx.fillRect(px, py, 1, 1);
      } else if (kind === WATER) {
        const r = 1.6 / k;
        const near = [kindAt(tx + r, ty), kindAt(tx - r, ty), kindAt(tx, ty + r), kindAt(tx, ty - r)].some((n) => n !== WATER);
        if (near) {
          ctx.fillStyle = "rgba(40,80,95,0.55)";
          ctx.fillRect(px, py, 1, 1);
        } else if (py % 5 === 0 && (px + Math.floor(py / 5) * 3) % 7 < 3) {
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(px, py, 1, 1);
        }
      } else if (kind !== WATER) {
        const r = 2.4 / k;
        if ([kindAt(tx + r, ty), kindAt(tx - r, ty), kindAt(tx, ty + r), kindAt(tx, ty - r)].includes(WATER) && (px + py) % 2 === 0) {
          ctx.fillStyle = "rgba(40,80,95,0.3)";
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }

  // Trees: inked crowns, a lighter side to each, thinned out at small sizes.
  const every = Math.max(1, Math.round(1.6 / k));
  const tr = Math.max(0.9, k * 0.75);
  for (let y = 0; y < map.height; y += every) {
    for (let x = (y / every) % 2 ? Math.floor(every / 2) : 0; x < W; x += every) {
      if (kinds_[y * W + x] !== TREE) continue;
      const cx = (x + 0.5) * k + (rnd(x, y, 7) - 0.5) * k;
      const cy = (y + 0.5) * k + (rnd(x, y, 9) - 0.5) * k;
      ctx.fillStyle = "rgba(40,30,15,0.35)";
      ctx.beginPath();
      ctx.arc(cx + tr * 0.4, cy + tr * 0.4, tr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rnd(x, y, 11) < 0.5 ? "#6a7f44" : "#5d7440";
      ctx.beginPath();
      ctx.arc(cx, cy, tr, 0, Math.PI * 2);
      ctx.fill();
      if (tr > 1.4) {
        ctx.strokeStyle = "rgba(40,50,20,0.8)";
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.fillStyle = "rgba(200,210,140,0.6)";
        ctx.beginPath();
        ctx.arc(cx - tr * 0.35, cy - tr * 0.35, tr * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Buildings: a symbol each.
  for (const o of map.objects) {
    if (HIDDEN.has(o.kind)) continue;
    const x = o.x * k;
    const y = o.y * k;
    const w = o.w * k;
    const h = o.h * k;
    if (o.kind === "fountain") {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(0.8, k * 0.4);
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    // The amphitheatre: its stands, an oval ring round the sand.
    if (o.kind === "arena_bowl") {
      ctx.strokeStyle = "rgba(50,35,20,0.35)";
      ctx.lineWidth = Math.max(1.5, w * 0.12);
      ctx.beginPath();
      ctx.ellipse(x + w / 2 + 1, y + h / 2 + 1, w * 0.44, h * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#c9a46a";
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.44, h * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (w < 1.2 || h < 1.2) continue;
    const house = o.kind === "house";
    const roof = house ? HOUSE_ROOFS[Math.floor(rnd(o.x, o.y, 13) * HOUSE_ROOFS.length)] : ROOFS[o.kind] ?? "#8a5a3a";
    const sh = Math.max(1, k * 0.7);
    // Shadow, falling down and to the right.
    ctx.fillStyle = "rgba(50,35,20,0.35)";
    ctx.fillRect(x + sh, y + sh, w, h);
    // Roof.
    ctx.fillStyle = roof;
    ctx.fillRect(x, y, w, h);
    // The lit slope: the half nearer the top (or left, on a tall building).
    const along = w >= h;
    ctx.fillStyle = "rgba(255,240,210,0.22)";
    if (along) ctx.fillRect(x, y, w, h / 2);
    else ctx.fillRect(x, y, w / 2, h);
    // Hatching across the roof, where there's room.
    if (Math.min(w, h) > 5) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = "rgba(40,25,10,0.28)";
      ctx.lineWidth = 0.6;
      const step = Math.max(2, k * 0.9);
      ctx.beginPath();
      for (let d = -h; d < w; d += step) {
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Ridge.
    ctx.strokeStyle = "rgba(40,25,10,0.65)";
    ctx.lineWidth = Math.max(0.6, k * 0.3);
    ctx.beginPath();
    if (along) {
      ctx.moveTo(x + Math.min(h / 2, w / 4), y + h / 2);
      ctx.lineTo(x + w - Math.min(h / 2, w / 4), y + h / 2);
    } else {
      ctx.moveTo(x + w / 2, y + Math.min(w / 2, h / 4));
      ctx.lineTo(x + w / 2, y + h - Math.min(w / 2, h / 4));
    }
    ctx.stroke();
    // Chimney on the bigger ones.
    if (!house && w > 8 && h > 5) {
      ctx.fillStyle = "#5a3a2a";
      ctx.fillRect(x + w * 0.75, y + h * 0.18, Math.max(1, k * 0.8), Math.max(1, k * 0.8));
    }
    // Ink outline.
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.6, k * 0.35);
    ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
  }

  // Paper: grain, meridians, folds, a darkened rim and the compass.
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const v = rnd(px, py, 17);
      if (v < 0.04) {
        ctx.fillStyle = "rgba(60,40,20,0.12)";
        ctx.fillRect(px, py, 1, 1);
      } else if (v > 0.965) {
        ctx.fillStyle = "rgba(255,250,235,0.16)";
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
  ctx.strokeStyle = "rgba(90,60,30,0.16)";
  ctx.lineWidth = 1;
  for (let i = size / 8; i < size - 1; i += size / 8) {
    ctx.beginPath();
    ctx.moveTo(Math.round(i) + 0.5, 0);
    ctx.lineTo(Math.round(i) + 0.5, size);
    ctx.moveTo(0, Math.round(i) + 0.5);
    ctx.lineTo(size, Math.round(i) + 0.5);
    ctx.stroke();
  }
  const mid = Math.round(size / 2);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(mid, 0, 1, size);
  ctx.fillRect(0, mid, size, 1);
  ctx.fillStyle = "rgba(60,40,20,0.18)";
  ctx.fillRect(mid + 1, 0, 1, size);
  ctx.fillRect(0, mid + 1, size, 1);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(90,60,20,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  compass(ctx, size);
  cache.set(String(size), c);
  return c;
}

/** A compass rose in the bottom-left corner. */
function compass(ctx: CanvasRenderingContext2D, size: number) {
  const r = Math.max(8, Math.round(size * 0.065));
  const cx = r + 6;
  const cy = size - r - 6;
  ctx.fillStyle = "rgba(240,228,196,0.75)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  const point = (a: number, len: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.lineTo(cx + Math.cos(a + Math.PI / 2) * len * 0.22, cy + Math.sin(a + Math.PI / 2) * len * 0.22);
    ctx.lineTo(cx + Math.cos(a - Math.PI / 2) * len * 0.22, cy + Math.sin(a - Math.PI / 2) * len * 0.22);
    ctx.fill();
  };
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, r * 0.55, "#8a7a5a");
  point(-Math.PI / 2, r, "#b5544a");
  point(Math.PI / 2, r, INK);
  point(0, r * 0.8, INK);
  point(Math.PI, r * 0.8, INK);
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.max(7, Math.round(r * 0.7))}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", cx, cy - r - 1);
}
