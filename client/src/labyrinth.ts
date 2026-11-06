// The Glowroot Labyrinth (a new one every day, under the hedge maze's
// heart): an expedition to the Glowroot, in a sealed chamber at the centre.
// Its Great Gate opens for anyone attuned to the three heartstones out in
// the maze (and whoever's with them). On the way: wisps that blow your light
// out (you wake by the last lantern you passed), root gates that open from
// rune stones (a timed one: run; a twin one: a person on each stone), lost
// glimmers, and the sleeping lanterns everyone lights for everyone. The
// server decides all of it; this draws it, moves the wisps by the same sums
// (`labyrinth::wisp_at`) and says what's happening.

import { Sprite } from "pixi.js";
import type { DayNight } from "./ambient/daynight";
import type { ServerMsg } from "./net/protocol.gen";
import { HEARTSTONE_TINTS, gateTexture, glimmerTexture, heartstoneTexture, lanternTexture, stoneTexture, wispTexture } from "./world/labart";
import type { MapObject, ZoneMap } from "./world/map";
import type { TileXY } from "./world/motion";
import type { Scene } from "./world/scene";

const TILE = 32;
/** `LabEvent` kinds (protocol `lab::*`). */
const LIT = 1;
const GLIMMER = 2;
const OUT = 3;
const ATTUNED = 4;
const GATE_OPEN = 5;
const GATE_SHUT = 6;
const CAUGHT = 7;
/** After finding the way up, a moment to enjoy it before you rise. */
const RISE_MS = 3500;
/** Wisps drift this fast (tiles a second): as `labyrinth::WISP_SPEED`. */
const WISP_SPEED = 1.6;
const HEARTSTONE_NAMES = ["rose", "amber", "violet"];

type LabMsg = Extract<ServerMsg, { t: "LabState" } | { t: "LabEvent" }>;

/** Where a wisp is at instance time `now` (tiles): `labyrinth::wisp_at`, the same sums. */
export function wispAt(o: MapObject, now: number): TileXY {
  const phase = Number(o.label) || 0;
  const t = ((now + phase) >>> 0) / 1000;
  const len = Math.max(o.w, o.h) - 1;
  const period = (2 * len) / WISP_SPEED;
  const u = (t % period) * WISP_SPEED;
  const along = u <= len ? u : 2 * len - u;
  const across = (Math.sin(t * 1.3) + 1) / 2;
  return o.w >= o.h ? { x: o.x + along, y: o.y + across } : { x: o.x + across, y: o.y + along };
}

interface Lantern {
  sprite: Sprite;
  glow: Sprite | null;
  x: number;
  y: number;
}

interface Glimmer {
  sprite: Sprite;
  glow: Sprite;
  x: number;
  y: number;
  phase: number;
}

interface Gate {
  kind: "great" | "timed" | "twin";
  tiles: TileXY[];
  sprites: Sprite[];
  stones: { sprite: Sprite; x: number; y: number; glow: Sprite | null }[];
  glow: Sprite | null;
  open: boolean;
}

interface Heartstone {
  sprite: Sprite;
  glow: Sprite;
  x: number;
  y: number;
}

interface Wisp {
  o: MapObject;
  sprite: Sprite;
  glow: Sprite;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const bits = (b: number) => {
  let n = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) n++;
  return n;
};

export class Labyrinth {
  private lanterns: Lantern[] = [];
  private glimmers: Glimmer[] = [];
  private gates: Gate[] = [];
  private heartstones: Heartstone[] = [];
  private wisps: Wisp[] = [];
  private found = 0;
  private attuned = 0;
  private finishers = 0;
  private out = false;
  /** The light each person carries, by avatar id. */
  private carried = new Map<number, Sprite>();
  private chip: HTMLElement;
  private risingAt = 0;
  /** Hints already given (once per standing-there, not every frame). */
  private hinted = new Set<string>();

  constructor(
    scene: Scene,
    private map: ZoneMap,
    private daynight: DayNight,
    private host: {
      toast: (text: string, ms?: number) => void;
      selfId: () => number;
      nameOf: (id: number) => string;
      /** Where you are (tile). */
      selfTile: () => TileXY | null;
      /** Everyone here and where their feet are (world pixels), and their tile. */
      people: () => Iterable<{ id: number; x: number; y: number; tile: TileXY }>;
      /** Back up to the hedge maze. */
      goUp: () => void;
    },
  ) {
    const numbered = (kind: string) =>
      map.objects
        .filter((o) => o.kind === kind)
        .sort((a, b) => parseInt(a.label ?? "0", 10) - parseInt(b.label ?? "0", 10));
    const stand = (s: Sprite, x: number, y: number) => {
      s.anchor.set(0.5, 1);
      s.position.set(x * TILE + TILE / 2, (y + 1) * TILE - 2);
      s.zIndex = (y + 1) * TILE - 2;
      scene.sorted.addChild(s);
      return s;
    };
    for (const o of numbered("lab_lantern")) {
      this.lanterns.push({ sprite: stand(new Sprite(lanternTexture(false)), o.x, o.y), glow: null, x: o.x, y: o.y });
    }
    for (const o of numbered("lab_glimmer")) {
      const s = new Sprite(glimmerTexture());
      s.anchor.set(0.5);
      s.zIndex = (o.y + 1) * TILE - 3;
      scene.sorted.addChild(s);
      const glow = daynight.addGlow(o.x * TILE + TILE / 2, o.y * TILE + TILE / 2, 1.1, 1.1, 0xffe9a0, 0.85);
      this.glimmers.push({ sprite: s, glow, x: o.x, y: o.y, phase: (o.x * 7 + o.y * 3) % 10 });
    }
    numbered("lab_heartstone").forEach((o, i) => {
      const sprite = stand(new Sprite(heartstoneTexture(i, false)), o.x, o.y);
      // They glow from far off: something to head for in the dark.
      const glow = daynight.addGlow(o.x * TILE + TILE / 2, o.y * TILE, 3.2, 3.2, HEARTSTONE_TINTS[i % 3], 0.55);
      this.heartstones.push({ sprite, glow, x: o.x, y: o.y });
    });
    const stones = map.objects.filter((o) => o.kind === "lab_stone");
    numbered("lab_gate").forEach((o, i) => {
      const kind = (o.label?.split(":")[1] ?? "timed") as Gate["kind"];
      const tiles: TileXY[] = [];
      for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) tiles.push({ x, y });
      const sprites = tiles.map((t) => stand(new Sprite(gateTexture(kind === "great", false)), t.x, t.y));
      const gateStones = stones
        .filter((s) => s.label === String(i))
        .map((s) => {
          const sprite = new Sprite(stoneTexture(kind === "twin", false));
          sprite.position.set(s.x * TILE, s.y * TILE);
          // Flat in the floor: under whoever stands on it.
          sprite.zIndex = s.y * TILE + 1;
          scene.sorted.addChild(sprite);
          return { sprite, x: s.x, y: s.y, glow: null };
        });
      this.gates.push({ kind, tiles, sprites, stones: gateStones, glow: null, open: false });
    });
    for (const o of map.objects.filter((q) => q.kind === "lab_wisp")) {
      const sprite = new Sprite(wispTexture());
      sprite.anchor.set(0.5, 0.7);
      scene.sorted.addChild(sprite);
      const glow = daynight.addGlow(0, 0, 1.8, 1.8, 0xbdf3ff, 0.8);
      this.wisps.push({ o, sprite, glow });
    }
    // The Glowroot glows over the chamber walls: the middle of it all.
    const heart = map.objects.find((o) => o.kind === "lab_heart");
    if (heart) daynight.addGlow((heart.x + heart.w / 2) * TILE, (heart.y + heart.h / 2) * TILE, 6, 5, 0x8ff5e4, 0.9);

    this.chip = document.createElement("div");
    this.chip.className = "pill lab-chip";
    document.body.append(this.chip);
    this.render();
    host.toast(
      "🕯️ The Glowroot Labyrinth, new every day. The Glowroot, the way back up, is sealed at its heart: be attuned to the three heartstones far out in the maze and its Great Gate opens for you. Mind the wisps; light the lanterns.",
      11000,
    );
  }

  handle(m: LabMsg) {
    const me = this.host.selfId();
    if (m.t === "LabState") {
      for (const i of m.lit) this.light(i);
      for (const g of m.gates) this.setGate(g, true);
      this.found = m.found;
      this.attuned = m.attuned;
      this.finishers = m.finishers;
      this.out = m.out;
      this.glimmers.forEach((g, i) => (g.sprite.visible = g.glow.visible = !(this.found & (1 << i))));
      this.heartstones.forEach((_, i) => this.showAttuned(i));
      this.render();
      return;
    }
    switch (m.kind) {
      case LIT:
        this.light(m.n);
        if (m.id === me) {
          const lit = this.lanterns.filter((l) => l.glow).length;
          this.host.toast(
            lit === this.lanterns.length
              ? "🕯️✨ That was the last one: every lantern in the labyrinth is lit today."
              : "🕯️ You lit a lantern, for everyone who comes after. If a wisp gets you, you'll wake here.",
            4000,
          );
        }
        break;
      case GLIMMER: {
        const g = this.glimmers[m.n];
        if (g) g.sprite.visible = g.glow.visible = false;
        this.found |= 1 << m.n;
        this.host.toast(`✨ A lost glimmer! (${bits(this.found)}/${this.glimmers.length} today)`, 3500);
        break;
      }
      case ATTUNED: {
        this.attuned |= 1 << m.n;
        this.showAttuned(m.n);
        const n = bits(this.attuned);
        this.host.toast(
          n === this.heartstones.length
            ? "💎 Attuned to all three heartstones! The Great Gate at the heart of the labyrinth will open for you, and for anyone beside you."
            : `💎 You're attuned to the ${HEARTSTONE_NAMES[m.n % 3]} heartstone (${n}/${this.heartstones.length}).`,
          5000,
        );
        break;
      }
      case GATE_OPEN:
      case GATE_SHUT: {
        const open = m.kind === GATE_OPEN;
        this.setGate(m.n, open);
        const g = this.gates[m.n];
        const t = this.host.selfTile();
        const near = g && t && g.tiles.some((q) => Math.max(Math.abs(q.x - t.x), Math.abs(q.y - t.y)) <= 6);
        if (open && near && g) {
          this.host.toast(
            g.kind === "great"
              ? "🌟 The Great Gate grinds open. The Glowroot is inside!"
              : g.kind === "timed"
                ? "🌿 The roots draw back… quick, before they close!"
                : "🌿 Both stones together: the roots draw back.",
            3000,
          );
        }
        break;
      }
      case CAUGHT:
        if (m.id === me) this.host.toast("💨 A wisp blew your light out… You wake by the last lantern you passed.", 4000);
        break;
      case OUT:
        this.finishers = Math.max(this.finishers, m.n);
        if (m.id === me) {
          this.out = true;
          this.host.toast(`🌟 You found the Glowroot, the way back up: ${ordinal(m.n)} today! Up you go…`, RISE_MS + 1500);
          this.risingAt = performance.now() + RISE_MS;
        } else {
          this.host.toast(`🌟 ${this.host.nameOf(m.id)} reached the Glowroot (${ordinal(m.n)} today)`, 4000);
        }
        break;
    }
    this.render();
  }

  private light(i: number) {
    const l = this.lanterns[i];
    if (!l || l.glow) return;
    l.sprite.texture = lanternTexture(true);
    l.glow = this.daynight.addGlow(l.x * TILE + TILE / 2, l.y * TILE + 4, 3.4, 2.6, 0xffc56b, 0.9);
  }

  private showAttuned(i: number) {
    const h = this.heartstones[i];
    if (!h) return;
    const on = !!(this.attuned & (1 << i));
    h.sprite.texture = heartstoneTexture(i, on);
    h.glow.alpha = on ? 1 : 0.55;
    h.glow.scale.set(on ? 4.2 : 3.2);
  }

  /** Opens or shuts gate `g`: its look, and its tiles for walking (the server holds the truth). */
  private setGate(g: number, open: boolean) {
    const gate = this.gates[g];
    if (!gate || gate.open === open) return;
    gate.open = open;
    for (const s of gate.sprites) s.texture = gateTexture(gate.kind === "great", open);
    for (const t of gate.tiles) this.map.collision[t.y * this.map.width + t.x] = open ? 0 : 1;
    for (const st of gate.stones) {
      st.sprite.texture = stoneTexture(gate.kind === "twin", open);
      if (open && !st.glow) st.glow = this.daynight.addGlow(st.x * TILE + TILE / 2, st.y * TILE + TILE / 2, 1.4, 1, 0x8ff5e4, 0.8);
      if (!open && st.glow) {
        st.glow.destroy();
        st.glow = null;
      }
    }
    if (open && !gate.glow) {
      const t = gate.tiles[0];
      gate.glow = this.daynight.addGlow((t.x + 1) * TILE, t.y * TILE + TILE / 2, 2.4, 1.6, gate.kind === "great" ? 0x8ff5e4 : 0xb8e08a, 0.7);
    } else if (!open && gate.glow) {
      gate.glow.destroy();
      gate.glow = null;
    }
  }

  private render() {
    const lit = this.lanterns.filter((l) => l.glow).length;
    const parts = [
      `💎 ${bits(this.attuned)}/${this.heartstones.length}`,
      `✨ ${bits(this.found)}/${this.glimmers.length}`,
      `🕯️ ${lit}/${this.lanterns.length}`,
    ];
    if (this.out) parts.push("🌟 found the way up");
    else if (this.finishers) parts.push(`🌟 ${this.finishers} out today`);
    this.chip.textContent = parts.join(" · ");
  }

  /** A hint, once each time you come to stand somewhere. */
  private hint(key: string, text: string) {
    if (this.hinted.has(key)) return;
    this.hinted.add(key);
    this.host.toast(text, 4000);
  }

  update(wallNow: number, serverNow: number) {
    const t = wallNow / 1000;
    for (const g of this.glimmers) {
      if (!g.sprite.visible) continue;
      g.sprite.position.set(g.x * TILE + TILE / 2, g.y * TILE + 10 + Math.sin(t * 2 + g.phase) * 3);
      g.sprite.alpha = 0.8 + Math.sin(t * 5 + g.phase) * 0.2;
    }
    this.heartstones.forEach((h, i) => (h.glow.alpha = (this.attuned & (1 << i) ? 0.9 : 0.45) + Math.sin(t * 1.5 + h.x) * 0.1));
    // Wisps, where the server has them.
    for (const w of this.wisps) {
      const p = wispAt(w.o, serverNow);
      const x = p.x * TILE + TILE / 2;
      const y = p.y * TILE + TILE / 2;
      w.sprite.position.set(x, y - 8 + Math.sin(t * 3 + w.o.x) * 2);
      w.sprite.zIndex = (p.y + 1) * TILE;
      w.sprite.alpha = 0.85 + Math.sin(t * 7 + w.o.y) * 0.15;
      w.glow.position.set(x, y - 6);
    }
    // Everyone carries a little light.
    const here = new Set<number>();
    const occupied = new Set<string>();
    for (const p of this.host.people()) {
      here.add(p.id);
      occupied.add(`${p.tile.x},${p.tile.y}`);
      let s = this.carried.get(p.id);
      if (!s) {
        s = this.daynight.addGlow(p.x, p.y, 2.6, 2, 0xffd9a0, 0.75);
        this.carried.set(p.id, s);
      }
      s.position.set(p.x, p.y - 10);
    }
    for (const [id, s] of this.carried) {
      if (!here.has(id)) {
        s.destroy();
        this.carried.delete(id);
      }
    }
    // Hints, from where you stand.
    const me = this.host.selfTile();
    if (me) {
      const standing = new Set<string>();
      this.gates.forEach((g, i) => {
        if (g.open) return;
        if (g.kind === "twin" && g.stones.some((s) => s.x === me.x && s.y === me.y)) {
          const other = g.stones.find((s) => s.x !== me.x || s.y !== me.y);
          if (other && !occupied.has(`${other.x},${other.y}`)) {
            standing.add(`twin${i}`);
            this.hint(`twin${i}`, "🪨 A twin rune stone: it needs someone on the other stone too. Call a friend down!");
          }
        }
        if (g.kind === "great" && g.tiles.some((q) => Math.max(Math.abs(q.x - me.x), Math.abs(q.y - me.y)) <= 2)) {
          standing.add(`great${i}`);
          const n = bits(this.attuned);
          if (n < this.heartstones.length)
            this.hint(`great${i}`, `🚪 The Great Gate stays shut. It opens for someone attuned to all three heartstones (you: ${n}/${this.heartstones.length}), and for whoever's with them.`);
        }
      });
      // Hints come again once you've stepped away and back.
      for (const k of this.hinted) if (!standing.has(k)) this.hinted.delete(k);
    }
    if (this.risingAt && wallNow >= this.risingAt) {
      this.risingAt = 0;
      this.host.goUp();
    }
  }

  destroy() {
    this.chip.remove();
    const all: (Sprite | null)[] = [
      ...this.lanterns.flatMap((l) => [l.sprite, l.glow]),
      ...this.glimmers.flatMap((g) => [g.sprite, g.glow]),
      ...this.heartstones.flatMap((h) => [h.sprite, h.glow]),
      ...this.wisps.flatMap((w) => [w.sprite, w.glow]),
      ...this.gates.flatMap((g) => [...g.sprites, g.glow, ...g.stones.flatMap((s) => [s.sprite, s.glow])]),
      ...this.carried.values(),
    ];
    for (const s of all) s?.destroy();
    this.carried.clear();
  }
}
