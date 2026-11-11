// The city drawn as an old atlas, for the minimap and the city map: muted
// antique colours on paper, roads edged in ink, water with coastline rings
// and little waves, trees as inked crowns, and every building as a proper
// map symbol, its real shape from above (a floor plan of wings, each under a
// hipped roof with its ridge and its four slopes lit from the north-west; a
// drop shadow, an ink outline; houses L- and T-shaped in an assortment of
// roof colours, a horseshoe of a concert hall, a round striped tent), finished with a meridian grid,
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
/** The skatepark's poured concrete. */
const CONCRETE = 9;

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
  skate: CONCRETE,
  skate_road: ROAD,
};
const TREES = new Set(["tree", "pine", "apple_tree", "willow", "willow_curtain", "pine_secret", "bush", "hedge"]);
/** Objects with no symbol of their own (markers, small props). */
// (`boat_lake` only marks the water the rowboats go on, and `forage` where bugs and mushrooms turn up.)
// (The skatepark's own outline, its painted logos and the back of its van: the pieces show it.)
const HIDDEN = new Set(["spot", "nook", "grove_slot", "signpost", "postbox", "dept", "shopfront", "arena", "lamp", "boat_lake", "boat_moored", "yard_stand", "yard", "forage", "sk_park", "sk_paint", "sk_shop_back"]);

/** Ground colours: grass, trees (under their crowns), water, road, kerb, paving, soil, brick, woods. */
const PAPER = ["#cfd3a0", "#bcc48c", "#9cbfc0", "#a3927a", "#e6d9b6", "#ece0c0", "#c8a878", "#b8705a", "#85a05c", "#dcd7c8"];
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

/**
 * A skatepark piece on the map, from above: a quarter pipe or kicker a
 * wedge shaded from its foot (light) to its high end (dark), a quarter
 * pipe's lip inked; a box a raised slab with its shadow; stairs stepped;
 * a rail a steel line; Dusty's van a little yellow van; the board a sign.
 */
function skatePiece(ctx: CanvasRenderingContext2D, kind: string, label: string, x: number, y: number, w: number, h: number, k: number) {
  const outline = (lw = 0.6) => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.5, lw);
    ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
  };
  const shadow = (d: number) => {
    ctx.fillStyle = "rgba(50,35,20,0.28)";
    ctx.fillRect(x + d, y + d, w, h);
  };
  const dir = label.split(":")[0];
  if (kind === "sk_quarter" || kind === "sk_kicker") {
    // Light at its foot, darkening up to its high end.
    const [x0, y0, x1, y1] = dir === "n" ? [x, y + h, x, y] : dir === "s" ? [x, y, x, y + h] : dir === "e" ? [x, y, x + w, y] : [x + w, y, x, y];
    shadow(Math.max(0.6, k * (kind === "sk_quarter" ? 0.45 : 0.25)));
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "#efe9da");
    g.addColorStop(kind === "sk_quarter" ? 0.55 : 0.2, "#d6cfbd");
    g.addColorStop(1, kind === "sk_quarter" ? "#8f8676" : "#b3aa98");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    outline();
    if (kind === "sk_quarter") {
      // Its coping, along the lip.
      ctx.fillStyle = "#4a525a";
      const t = Math.max(0.8, k * 0.3);
      if (dir === "n") ctx.fillRect(x, y, w, t);
      else if (dir === "s") ctx.fillRect(x, y + h - t, w, t);
      else if (dir === "e") ctx.fillRect(x + w - t, y, t, h);
      else ctx.fillRect(x, y, t, h);
    }
    return;
  }
  if (kind === "sk_volcano" || kind === "sk_pyramid") {
    // From above: light round its foot, darkening up to its top (round, or square), the top's edge inked.
    shadow(Math.max(0.6, k * 0.3));
    const cx = x + w / 2;
    const cy = y + h / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
    g.addColorStop(0, "#9a917f");
    g.addColorStop(0.32, "#a99f8c");
    g.addColorStop(1, "#efe9da");
    ctx.fillStyle = g;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    if (kind === "sk_volcano") ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#4a525a";
    ctx.beginPath();
    if (kind === "sk_volcano") ctx.ellipse(cx, cy, w * 0.16, h * 0.16, 0, 0, Math.PI * 2);
    else ctx.rect(cx - w * 0.15, cy - h * 0.15, w * 0.3, h * 0.3);
    ctx.stroke();
    return;
  }
  if (kind === "sk_box") {
    shadow(Math.max(0.6, k * 0.3));
    ctx.fillStyle = "#ebe6d8";
    ctx.fillRect(x, y, w, h);
    outline();
    return;
  }
  if (kind === "sk_stairs") {
    ctx.fillStyle = "#e2dccd";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(60,45,30,0.45)";
    const steps = 4;
    for (let s = 1; s < steps; s++) {
      if (dir === "n" || dir === "s") ctx.fillRect(x, y + (h * s) / steps, w, Math.max(0.5, k * 0.12));
      else ctx.fillRect(x + (w * s) / steps, y, Math.max(0.5, k * 0.12), h);
    }
    outline();
    return;
  }
  if (kind === "sk_rail") {
    ctx.fillStyle = "#5a6470";
    const t = Math.max(0.8, k * 0.22);
    if (dir === "v") ctx.fillRect(x + w / 2 - t / 2, y, t, h);
    else ctx.fillRect(x, y + h / 2 - t / 2, w, t);
    return;
  }
  if (kind === "sk_shop") {
    // Dusty's van: yellow, a white roof, little wheels.
    shadow(Math.max(0.6, k * 0.3));
    ctx.fillStyle = "#e8b923";
    ctx.fillRect(x, y + h * 0.15, w, h * 0.7);
    ctx.fillStyle = "#fff4d6";
    ctx.fillRect(x + w * 0.18, y + h * 0.28, w * 0.64, h * 0.44);
    ctx.fillStyle = INK;
    for (const fx of [0.2, 0.75]) ctx.fillRect(x + w * fx, y + h * 0.82, Math.max(0.8, w * 0.08), Math.max(0.6, h * 0.12));
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.6;
    ctx.strokeRect(x + 0.25, y + h * 0.15, w - 0.5, h * 0.7);
    return;
  }
  if (kind === "sk_board") {
    ctx.fillStyle = "#2b2f45";
    ctx.fillRect(x, y, w, h);
    return;
  }
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

/** One part of a building's plan, as fractions of its plot; `round`: a dome or a drum, not a hipped roof. */
interface Wing {
  x: number;
  y: number;
  w: number;
  h: number;
  round?: boolean;
}

const wing = (x: number, y: number, w: number, h: number, round = false): Wing => ({ x, y, w, h, round });

/** The big buildings' plans (their fronts face south, as they stand in the world). */
const PLANS: Record<string, Wing[]> = {
  // A long hall, its grand gable reaching out to the street.
  mall_entrance: [wing(0, 0.1, 1, 0.62), wing(0.38, 0, 0.24, 1)],
  apartments: [wing(0, 0.06, 1, 0.56), wing(0.06, 0.4, 0.36, 0.6), wing(0.58, 0.4, 0.36, 0.6)],
  // Two end pavilions, the clock tower in the middle.
  town_hall: [wing(0.1, 0.16, 0.8, 0.56), wing(0, 0, 0.28, 1), wing(0.72, 0, 0.28, 1), wing(0.39, 0.3, 0.22, 0.32, true)],
  // Reading rooms behind a pillared porch.
  library: [wing(0, 0, 1, 0.72), wing(0.26, 0.62, 0.48, 0.38)],
  // Round a courtyard, a dome over the great hall.
  museum: [wing(0, 0, 0.2, 1), wing(0.8, 0, 0.2, 1), wing(0, 0, 1, 0.42), wing(0.4, 0.05, 0.2, 0.34, true)],
  gallery: [wing(0, 0.12, 1, 0.64), wing(0.3, 0.5, 0.4, 0.5)],
  // A fan of seats, rounded at the back, the stage house square on the front.
  concert_hall: [wing(0.1, 0, 0.8, 0.84, true), wing(0.24, 0.62, 0.52, 0.38)],
  club_hall: [wing(0, 0.1, 1, 0.6), wing(0, 0, 0.3, 1), wing(0.7, 0, 0.3, 1)],
  club_house: [wing(0, 0.14, 1, 0.62), wing(0.34, 0, 0.32, 1)],
  bar: [wing(0, 0, 1, 0.66), wing(0.08, 0.5, 0.5, 0.5)],
  arcade_hall: [wing(0, 0.08, 1, 0.68), wing(0.3, 0.5, 0.4, 0.5)],
  bowling_alley: [wing(0, 0, 1, 0.74), wing(0, 0.5, 0.36, 0.5)],
  paintball_hall: [wing(0, 0.1, 1, 0.62), wing(0.62, 0.4, 0.38, 0.6)],
  // Its great drum domed over, turrets at the front corners.
  casino: [wing(0, 0.1, 1, 0.66), wing(0.34, 0.02, 0.32, 0.7, true), wing(0, 0.5, 0.2, 0.5, true), wing(0.8, 0.5, 0.2, 0.5, true)],
  post_office: [wing(0, 0, 1, 0.66), wing(0.34, 0.5, 0.32, 0.5)],
  building: [wing(0, 0.1, 1, 0.66), wing(0.1, 0.4, 0.34, 0.6)],
  boat_hire: [wing(0, 0, 1, 0.7), wing(0.3, 0.5, 0.4, 0.5)],
  well: [wing(0, 0, 1, 1, true)],
  bandstand: [wing(0.14, 0, 0.72, 1, true)],
};

/** A house's plan: an L one way or the other, or a T (they vary from house to house). */
function housePlan(x: number, y: number, w: number, h: number): Wing[] {
  const v = Math.floor(rnd(x, y, 21) * 3);
  const flip = rnd(x, y, 23) < 0.5;
  const mirror = (p: Wing) => (flip ? wing(1 - p.x - p.w, p.y, p.w, p.h) : p);
  const tall = h > w;
  const plan = tall
    ? [wing(0, 0, 0.66, 1), v === 2 ? wing(0.4, 0.3, 0.6, 0.4) : wing(0.4, v ? 0.56 : 0.06, 0.6, 0.38)]
    : [wing(0, 0.04, 1, 0.6), v === 2 ? wing(0.34, 0.3, 0.32, 0.7) : wing(v ? 0.06 : 0.6, 0.3, 0.34, 0.7)];
  return plan.map(mirror);
}

/** A hipped roof over a wing: four slopes up to its ridge, lit from the top left. */
function hipRoof(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, roof: string, k: number) {
  ctx.fillStyle = roof;
  ctx.fillRect(x, y, w, h);
  const along = w >= h;
  const inset = Math.min(w, h) / 2;
  const [ax, ay, bx, by] = along ? [x + inset, y + h / 2, x + w - inset, y + h / 2] : [x + w / 2, y + inset, x + w / 2, y + h - inset];
  const slope = (pts: [number, number][], col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
  };
  const [x1, y1] = [x + w, y + h];
  slope([[x, y], [x1, y], [bx, by], [ax, ay]], "rgba(255,240,205,0.3)");
  slope([[x, y1], [x1, y1], [bx, by], [ax, ay]], "rgba(30,15,5,0.26)");
  slope([[x, y], [x, y1], [ax, ay]], "rgba(255,240,205,0.12)");
  slope([[x1, y], [x1, y1], [bx, by]], "rgba(30,15,5,0.14)");
  // Courses of tiles, once there's room to see them.
  if (Math.min(w, h) > 9) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = "rgba(40,25,10,0.16)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const step = Math.max(1.6, k * 0.7);
    for (let d = step; d < h; d += step) {
      ctx.moveTo(x, y + d);
      ctx.lineTo(x1, y + d);
    }
    ctx.stroke();
    ctx.restore();
  }
  // The hips and the ridge.
  if (Math.min(w, h) > 3) {
    ctx.strokeStyle = "rgba(40,25,10,0.5)";
    ctx.lineWidth = Math.max(0.5, k * 0.16);
    ctx.beginPath();
    for (const [cx, cy, rx, ry] of [[x, y, ax, ay], [x, y1, ax, ay], [x1, y, bx, by], [x1, y1, bx, by]]) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(rx, ry);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(40,25,10,0.75)";
  ctx.lineWidth = Math.max(0.6, k * 0.26);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

/** A dome or a drum seen from above: round, shining up towards the top left. */
function dome(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, roof: string) {
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.35, 0, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, "rgba(255,245,220,0.6)");
  g.addColorStop(0.55, "rgba(255,245,220,0)");
  g.addColorStop(1, "rgba(30,15,5,0.34)");
  ctx.fillStyle = g;
  ctx.fill();
}

/** A building, as its plan: the shadow of it all, the one ink outline, then each wing's roof. */
function building(ctx: CanvasRenderingContext2D, kind: string, tx: number, ty: number, x: number, y: number, w: number, h: number, k: number, roof: string) {
  const lw = Math.max(0.6, k * 0.3);
  // The tailor's: a round tent, striped red and white, a flag at its peak.
  if (kind === "tailor") {
    const [cx, cy, rx, ry] = [x + w / 2, y + h / 2, w / 2, h * 0.62];
    ctx.fillStyle = "rgba(50,35,20,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.fillStyle = i % 2 ? "#f4ecd8" : "#c8423a";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, a, a + Math.PI / 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  const plan = kind === "house" ? housePlan(tx, ty, w, h) : PLANS[kind] ?? [wing(0, 0, 1, 1)];
  const rect = (p: Wing) => [x + p.x * w, y + p.y * h, p.w * w, p.h * h] as const;
  const outline = (p: Wing, grow: number) => {
    const [rx, ry, rw, rh] = rect(p);
    ctx.beginPath();
    if (p.round) ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2 + grow, rh / 2 + grow, 0, 0, Math.PI * 2);
    else ctx.rect(rx - grow, ry - grow, rw + grow * 2, rh + grow * 2);
  };
  // The shadow, falling down and to the right, of the whole plan at once.
  const sh = Math.max(1, k * 0.7);
  ctx.save();
  ctx.translate(sh, sh);
  ctx.fillStyle = "rgba(50,35,20,0.35)";
  ctx.beginPath();
  for (const p of plan) {
    const [rx, ry, rw, rh] = rect(p);
    if (p.round) {
      ctx.moveTo(rx + rw, ry + rh / 2);
      ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
    } else ctx.rect(rx, ry, rw, rh);
  }
  ctx.fill("nonzero");
  ctx.restore();
  // The ink round the outside of the plan: each wing's, the roofs then cover what's inside.
  ctx.fillStyle = INK;
  for (const p of plan) {
    outline(p, lw);
    ctx.fill();
  }
  for (const p of plan) {
    const [rx, ry, rw, rh] = rect(p);
    if (p.round) dome(ctx, rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, roof);
    else hipRoof(ctx, rx, ry, rw, rh, roof, k);
  }
  // A line where the wings meet, and each building's touches.
  if (plan.length > 1 && Math.min(w, h) > 6) {
    ctx.strokeStyle = "rgba(30,18,8,0.55)";
    ctx.lineWidth = Math.max(0.5, k * 0.2);
    for (const p of plan.slice(1)) {
      if (p.round) continue;
      const [rx, ry, rw, rh] = rect(p);
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }
  touches(ctx, kind, x, y, w, h, k);
}

/** What makes each one itself, where there's room to show it. */
function touches(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, h: number, k: number) {
  if (Math.min(w, h) < 6) {
    // Too small for more than a stripe (a stall's awning).
    if (kind === "stall") {
      ctx.fillStyle = "rgba(255,245,225,0.8)";
      for (let i = 0; i < 3; i++) ctx.fillRect(x + (w * (i * 2 + 0.5)) / 6, y, w / 6, h);
    }
    return;
  }
  if (kind === "stall") {
    ctx.fillStyle = "rgba(255,245,225,0.75)";
    for (let i = 0; i < 3; i++) ctx.fillRect(x + (w * (i * 2 + 0.5)) / 6, y, w / 6, h);
  } else if (kind === "library" || kind === "museum") {
    // The pillars along the front.
    const py = y + h * (kind === "library" ? 0.97 : 0.46);
    const [x0, x1] = kind === "library" ? [0.28, 0.72] : [0.24, 0.76];
    const n = 6;
    ctx.fillStyle = "#f0e6cc";
    for (let i = 0; i < n; i++) {
      const px = x + w * (x0 + ((x1 - x0) * i) / (n - 1));
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.6, k * 0.32), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "gallery") {
    // Long skylights down the roof.
    ctx.fillStyle = "rgba(190,225,240,0.8)";
    for (let i = 0; i < 4; i++) ctx.fillRect(x + w * (0.08 + i * 0.23), y + h * 0.2, w * 0.15, Math.max(1, h * 0.08));
  } else if (kind === "arcade_hall") {
    // Neon along its eaves.
    ctx.strokeStyle = "#ff5fc0";
    ctx.lineWidth = Math.max(0.6, k * 0.2);
    ctx.strokeRect(x + k * 0.6, y + h * 0.08 + k * 0.6, w - k * 1.2, h * 0.68 - k * 1.2);
  } else if (kind === "bowling_alley") {
    // Its lanes, side by side.
    ctx.strokeStyle = "rgba(235,250,245,0.55)";
    ctx.lineWidth = Math.max(0.5, k * 0.16);
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      ctx.moveTo(x + w * 0.42, y + h * (0.1 + i * 0.11));
      ctx.lineTo(x + w * 0.94, y + h * (0.1 + i * 0.11));
    }
    ctx.stroke();
  } else if (kind === "town_hall") {
    // The clock on its tower.
    ctx.fillStyle = "#f6dc8a";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.46, Math.max(1, Math.min(w, h) * 0.07), 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "bandstand") {
    // Its spokes.
    ctx.strokeStyle = "rgba(40,25,10,0.5)";
    ctx.lineWidth = Math.max(0.5, k * 0.16);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.moveTo(x + w / 2, y + h / 2);
      ctx.lineTo(x + w / 2 + Math.cos(a) * w * 0.36, y + h / 2 + Math.sin(a) * h * 0.5);
    }
    ctx.stroke();
  }
  // A chimney or two on the bigger roofs that'd have them.
  if (["house", "apartments", "mall_entrance", "bar", "post_office", "club_hall", "club_house", "paintball_hall", "building"].includes(kind) && w > 8) {
    const c = Math.max(1, k * 0.9);
    ctx.fillStyle = INK;
    ctx.fillRect(x + w * 0.76 - 0.4, y + h * 0.2 - 0.4, c + 0.8, c + 0.8);
    ctx.fillStyle = "#6a4432";
    ctx.fillRect(x + w * 0.76, y + h * 0.2, c, c);
  }
}

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
    // The skatepark's pieces, as what they are (not buildings).
    if (o.kind.startsWith("sk_")) {
      skatePiece(ctx, o.kind, o.label ?? "", x, y, w, h, k);
      continue;
    }
    if (w < 1.2 || h < 1.2) continue;
    const house = o.kind === "house";
    const roof = house ? HOUSE_ROOFS[Math.floor(rnd(o.x, o.y, 13) * HOUSE_ROOFS.length)] : ROOFS[o.kind] ?? "#8a5a3a";
    building(ctx, o.kind, o.x, o.y, x, y, w, h, k, roof);
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
  const r = Math.max(8, Math.min(30, Math.round(size * 0.065)));
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
