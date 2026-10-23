// The metro (ADR 0016): at a station's entrance, a map of the city with the
// lines and every station on it, "you are here" marked; tap a station to
// ride there. The ride itself is a short trip underground: a little train
// rushing through the tunnel, "Next stop: …", and up the stairs you come.

import { cityImage } from "./citymap";
import type { ZoneMap } from "../world/map";
import { Panel, button, el } from "./panels";

export interface Station {
  /** `metro_<key>`: the spot by its stairs (and `door:metro_<key>`). */
  key: string;
  name: string;
  /** Where its entrance stands (tiles). */
  x: number;
  y: number;
}

/** The stations on a map: each entrance, and the spot by its stairs. */
export function stationsOf(map: ZoneMap): Station[] {
  const spots = map.objects.filter((o) => o.kind === "spot" && o.label?.startsWith("metro_"));
  return map.objects
    .filter((o) => o.kind === "metro_entrance")
    .map((o) => {
      const near = spots.reduce((best, s) => (Math.hypot(s.x - o.x, s.y - o.y) < Math.hypot(best.x - o.x, best.y - o.y) ? s : best), spots[0]);
      return { key: near?.label ?? "", name: o.label ?? "Station", x: o.x + 1, y: o.y + 1 };
    })
    .filter((s) => s.key);
}

/** The lines, by station key: a ring round the outside and a cross through the Market. */
export const LINES: { name: string; color: string; stops: string[]; loop?: boolean }[] = [
  { name: "Ring line", color: "#e0a43a", stops: ["metro_north", "metro_woods", "metro_east", "metro_lake", "metro_south", "metro_meadow", "metro_west", "metro_orchard"], loop: true },
  { name: "Cross line N–S", color: "#c8553d", stops: ["metro_north", "metro_market", "metro_south"] },
  { name: "Cross line W–E", color: "#3f7a8a", stops: ["metro_west", "metro_market", "metro_east"] },
];

export interface MetroHost {
  /** The city map as it stands. */
  map(): ZoneMap | null;
  /** Rides to station `key` (with anyone following). */
  ride(to: Station, from: Station | null): void;
}

const SIZE = 420;

export class MetroPanel extends Panel {
  private here: Station | null = null;
  private canvas = el("canvas", "metro-map");
  private stations: Station[] = [];
  private timer = 0;

  constructor(private host: MetroHost) {
    super("🚇 Metro", "metro");
    this.canvas.onclick = (e) => this.tap(e);
  }

  /** Opens the map at `here` (the station you're at). */
  openAt(here: string) {
    const map = this.host.map();
    if (!map) return;
    this.stations = stationsOf(map);
    this.here = this.stations.find((s) => s.key === here) ?? null;
    this.show();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => (this.open ? this.draw() : window.clearInterval(this.timer)), 60);
  }

  hide() {
    super.hide();
    window.clearInterval(this.timer);
  }

  render() {
    this.body.replaceChildren();
    this.titleEl.textContent = this.here ? `🚇 ${this.here.name} station` : "🚇 Metro";
    this.body.append(el("p", "hint", "Tap a station to ride there. Anyone following you comes along."), this.canvas);
    const list = el("div", "metro-list");
    for (const s of this.stations) {
      if (s.key === this.here?.key) continue;
      list.append(button(s.name, () => this.go(s), "small"));
    }
    this.body.append(list);
    this.draw();
  }

  private go(to: Station) {
    this.hide();
    this.host.ride(to, this.here);
  }

  private scale(): number {
    const map = this.host.map();
    return map ? (SIZE * (window.devicePixelRatio || 1)) / map.width : 1;
  }

  private draw() {
    const map = this.host.map();
    if (!map) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(SIZE * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const k = this.scale();
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cityImage(map), 0, 0, px, px);
    ctx.fillStyle = "rgba(40, 36, 30, 0.35)";
    ctx.fillRect(0, 0, px, px);
    const at = (key: string) => this.stations.find((s) => s.key === key);
    // The lines.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const line of LINES) {
      const pts = line.stops.map(at).filter((s): s is Station => !!s);
      if (pts.length < 2) continue;
      ctx.strokeStyle = "#3b3a2e";
      ctx.lineWidth = 9 * dpr;
      ctx.beginPath();
      pts.forEach((s, i) => (i ? ctx.lineTo(s.x * k, s.y * k) : ctx.moveTo(s.x * k, s.y * k)));
      if (line.loop) ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 5 * dpr;
      ctx.stroke();
    }
    // The stations, named; where you are, pulsing.
    const t = performance.now() / 300;
    ctx.font = `${Math.round(11 * dpr)}px "Pixelify Sans", sans-serif`;
    ctx.textAlign = "center";
    for (const s of this.stations) {
      const x = s.x * k;
      const y = s.y * k;
      const here = s.key === this.here?.key;
      if (here) {
        ctx.fillStyle = `rgba(255, 233, 168, ${0.35 + 0.25 * Math.sin(t)})`;
        ctx.beginPath();
        ctx.arc(x, y, (13 + 2 * Math.sin(t)) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#3b3a2e";
      ctx.beginPath();
      ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = here ? "#ffe9a8" : "#fff8e3";
      ctx.beginPath();
      ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      const label = here ? `${s.name} (you)` : s.name;
      const tw = ctx.measureText(label).width + 8 * dpr;
      const ly = y + 18 * dpr;
      ctx.fillStyle = "rgba(255, 248, 227, 0.92)";
      ctx.fillRect(x - tw / 2, ly - 8 * dpr, tw, 15 * dpr);
      ctx.fillStyle = "#3b3a2e";
      ctx.fillText(label, x, ly + 3 * dpr);
    }
  }

  private tap(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.scale() / (window.devicePixelRatio || 1);
    const x = (e.clientX - r.left) * (SIZE / r.width);
    const y = (e.clientY - r.top) * (SIZE / r.height);
    let best: Station | null = null;
    let d = 22;
    for (const s of this.stations) {
      const dd = Math.hypot(s.x * k - x, s.y * k - y);
      if (dd < d) {
        d = dd;
        best = s;
      }
    }
    if (best && best.key !== this.here?.key) this.go(best);
  }
}

// ---- the ride ---------------------------------------------------------------------

let trainUrl = "";

/** A little two-car train, drawn once: rounded nose, round windows with faces. */
function train(): string {
  if (trainUrl) return trainUrl;
  const c = document.createElement("canvas");
  c.width = 220;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const px = (col: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  const disc = (col: string, x: number, y: number, r: number) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const faces = ["#f5d0b0", "#e0ac84", "#b97c55", "#7d5136"];
  const car = (x: number, w: number, nose: boolean) => {
    px("#3b3a2e", x, 8, w, 46);
    px("#e0a43a", x + 2, 10, w - 4, 42);
    px("#c8553d", x + 2, 38, w - 4, 6);
    px("#fff2c2", x + 2, 12, w - 4, 3);
    if (nose) {
      disc("#3b3a2e", x + w, 31, 23);
      disc("#e0a43a", x + w, 31, 21);
      px("#c8553d", x + w - 2, 38, 18, 6);
      disc("#fff8e3", x + w + 14, 24, 5);
      disc("#ffe9a8", x + w + 14, 24, 3);
    }
    for (let i = 0; i < Math.floor((w - 12) / 22); i++) {
      const wx = x + 14 + i * 22;
      disc("#3b3a2e", wx, 24, 8);
      disc("#cfe8f0", wx, 24, 7);
      disc(faces[i % faces.length], wx, 26, 4);
      px("#3b3a2e", wx - 2, 25, 1, 1);
      px("#3b3a2e", wx + 1, 25, 1, 1);
    }
    for (const wx of [x + 14, x + w - 14]) {
      disc("#3b3a2e", wx, 56, 6);
      disc("#5f5a52", wx, 56, 4);
    }
  };
  car(4, 90, false);
  px("#3b3a2e", 94, 30, 8, 4);
  car(102, 92, true);
  trainUrl = c.toDataURL();
  return trainUrl;
}

/**
 * The ride: the screen goes underground, the train rushes through the
 * tunnel past the lights, "Next stop: …"; resolves once it's ready for you
 * to come up (after at least `minMs`), then `done()` lifts the tunnel away.
 */
export function playRide(to: string): { arrived: Promise<void>; done: () => void } {
  const o = el("div", "metro-ride");
  const tunnel = el("div", "tunnel");
  const lights = el("div", "lights");
  const t = el("img", "train");
  t.src = train();
  t.alt = "";
  const sign = el("div", "next-stop");
  sign.append(el("span", "m", "M"), el("span", "", `Next stop: ${to}`));
  tunnel.append(lights, t);
  o.append(tunnel, sign);
  document.body.append(o);
  requestAnimationFrame(() => o.classList.add("on"));
  const arrived = new Promise<void>((r) => window.setTimeout(r, 1500));
  return {
    arrived,
    done: () => {
      o.classList.remove("on");
      o.classList.add("off");
      window.setTimeout(() => o.remove(), 400);
    },
  };
}
