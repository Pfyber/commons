// The arena's classes (server: commons_sim::arena::kit), with classes on:
// each gladiator picks one before every round (seven seconds, or till all
// have). The knight as everyone always fought; the archer, a dagger close in
// and the bow far off; the bomber, a dagger and lobbed bombs; the spearman,
// a knight with a long spear; the tank, slow and hard as an anvil. Here:
// their numbers (as the server's: arena.test.ts checks), what they're
// called and how they play, their pixel badges, the picker that comes up at
// the start of a round, and the gallery to look them over in the lobby.

import { el } from "../ui/panels";

/** What a fighter is doing (as `arena::act`). */
export const ACT = { NONE: 0, LIGHT1: 1, LIGHT2: 2, LIGHT3: 3, CHARGE: 4, HEAVY: 5, BLOCK: 6, ROLL: 7, STUN: 8, THROW: 9, SPIN: 10, DOWN: 11, SMASH: 12, STOMP: 13, GRAB: 14, HELD: 15, SHOOT: 16, CAST: 17 };

export const KIT = { KNIGHT: 0, ARCHER: 1, BOMBER: 2, SPEARMAN: 3, TANK: 4, COUNT: 5, PICKED: 0x80 };
/** Each class (by `KIT`): as `arena::KIT_*`. */
export const KIT_HP = [108, 105, 95, 110, 150];
export const KIT_SPEED = [1, 1.176, 1, 1, 0.84];
export const KIT_LIGHT_REACH = [1.35, 1.15, 1.15, 1.95, 1.4];
export const KIT_LIGHT_ARC = [1, 0.85, 0.85, 0.8, 1.05];
export const KIT_LIGHT_TIME = [1, 0.8, 0.8, 1.08, 1.15];
export const KIT_HEAVY_REACH = [1.55, 1.15, 1.15, 2.2, 1.6];
export const KIT_LUNGE = [1.3, 1.3, 1.3, 1.7, 1];
export const KIT_LUNGE_MAX = [4, 4, 4, 5.2, 3];
export const KIT_SPIN_REACH = [1.75, 1.75, 1.75, 2.5, 1.75];
/** The choosing, the bow and the bombs, the ultimates (as `arena::*`). */
export const CHOOSE_MS = 7000;
export const SHOOT: [number, number] = [90, 260];
export const CAST: [number, number] = [320, 260];
export const ARROW_SPEED = 22;
export const ARROW_RANGE = 14;
export const QUICK_SHOT: [number, number] = [60, 690];
export const QUICK_ARROW_COST = 9;
export const BURST_GAP_MS = 110;
export const BURST_COST = 26;
export const LOB_MIN = 2.2;
export const LOB_RANGE = 7;
export const QUICK_LOB: [number, number] = [120, 480];
export const QUICK_LOB_R = 1.5;
export const QUICK_LOB_COST = 20;
export const BIG_BOMB_R: [number, number] = [1.7, 2.7];
/** The big bomb takes four times a heavy blow's charge to fill (as `arena::BIG_BOMB_FULL_MS`). */
export const BIG_BOMB_FULL_MS = 220 + 4 * (1000 - 220);
export const BIG_BOMB_COST: [number, number] = [28, 56];
export const TANK_LEAP_MIN = 1;
export const TANK_LEAP = 3.4;
export const TANK_STOMP_R = 1.6;
/** How tall a body stands, the Goliath's (as `arena::BODY_H`, `GIANT_H`): hits land anywhere on it. */
export const BODY_H = 0.9;
export const GIANT_H = 2.2;
export const BLAST_R = 3.3;
export const QUAKE_R = 2.9;
/** An arrow in flight, the bomber's big bomb (`arena::missile::*`). */
export const ARROW = 5;
export const BIG_BOMB = 6;

/** A fighter's class (its `kit` without the picked bit). */
export const kitOf = (f: { kit: number }) => f.kit & 0x7f;
/** Whether it has picked, this round. */
export const picked = (f: { kit: number }) => (f.kit & KIT.PICKED) !== 0;
/** Whether its charged blow is fired (the bow, a bomb), not a lunge. */
export const shoots = (k: number) => k === KIT.ARCHER || k === KIT.BOMBER;

export interface KitInfo {
  name: string;
  icon: string;
  role: string;
  blurb: string;
  quick: string;
  charged: string;
  ultimate: string;
  /** Out of five: health, pace, punch, reach. */
  stats: [number, number, number, number];
  /** Its colour on the cards. */
  tint: string;
}

export const KITS: KitInfo[] = [
  {
    name: "Knight",
    icon: "🛡️",
    role: "All-rounder",
    blurb: "Sword and shield: steady, sure, ready for anything. Block and parry well.",
    quick: "Sword slash: click and keep clicking for a three-hit combo",
    charged: "A lunging heavy blow, further the longer you hold",
    ultimate: "Whirlwind: spin, cutting all round you, untouchable",
    stats: [3, 3, 3, 2],
    tint: "#b8862e",
  },
  {
    name: "Archer",
    icon: "🏹",
    role: "Long range",
    blurb: "Light on their feet, deadly from afar. Keep your distance: up close, every arrow counts.",
    quick: "Quick shot: an arrow at your aim, one every 0.75 s, as far as a thrown spear",
    charged: "Triple shot: three fast arrows in a row, flying till they hit something",
    ultimate: "Arrow storm: untouchable, three rings of arrows all round you, half a second apart",
    stats: [2, 4, 2, 5],
    tint: "#4f8a3c",
  },
  {
    name: "Bomber",
    icon: "💣",
    role: "Area damage",
    blurb: "Bombs for everyone. Lob them where they'll stand, but mind your own blast.",
    quick: "Lob a bomb: it lands where you aim",
    charged: "Big bomb: hold (up to ~3 s) for a bigger blast and more damage (and more stamina)",
    ultimate: "Big bang: a huge blast all round you (you're unharmed). Picked-up bombs: thrown three at a time",
    stats: [2, 3, 4, 4],
    tint: "#c8553d",
  },
  {
    name: "Spearman",
    icon: "🔱",
    role: "Reach",
    blurb: "A knight with a long spear: strikes from further off, lunges further, hits a little lighter.",
    quick: "Spear thrust: reaches well past a sword",
    charged: "A long lunging thrust (costs twice the stamina, hits lighter)",
    ultimate: "Whirlwind: the spear swung wide, all round you",
    stats: [3, 3, 2, 4],
    tint: "#3f6fb0",
  },
  {
    name: "Tank",
    icon: "🪨",
    role: "Bruiser",
    blurb: "The most health of anyone, a heavy hammer that hits hard. Slower, tires sooner, hard to knock about, and its armour turns some of every arrow and bomb.",
    quick: "Hammer blow: hits hard, a touch slower",
    charged: "Stomp: leap toward your aim, a shockwave where you land",
    ultimate: "Earthquake: stamp the ground, throwing everyone near away, dazed",
    stats: [5, 1, 4, 2],
    tint: "#6b6f7a",
  },
];

// ---- the badges ------------------------------------------------------------

const badges = new Map<number, string>();

/** Each class's badge: its arms, in pixel art (a data URL, drawn once). */
export function kitBadge(k: number): string {
  const have = badges.get(k);
  if (have) return have;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const px = (col: string, x: number, y: number, w = 1, h = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const O = "#2b2233";
  const STEEL = "#d8dce8";
  const STEEL_D = "#8a929c";
  const WOOD = "#8f6236";
  const WOOD_D = "#5e3e22";
  const GOLD = "#e0b040";
  // A diagonal line of pixels, w wide.
  const line = (x0: number, y0: number, x1: number, y1: number, col: string, w = 1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) px(col, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), w, w);
  };
  switch (k) {
    case KIT.KNIGHT: {
      // A sword behind a kite shield.
      line(6, 26, 25, 7, O, 3);
      line(7, 25, 25, 7, STEEL);
      line(8, 25, 26, 7, STEEL_D);
      line(8, 20, 13, 25, O, 3);
      line(9, 21, 12, 24, GOLD);
      px(O, 12, 9, 14, 3);
      px(O, 13, 9, 12, 15);
      px(O, 14, 23, 10, 2);
      px(O, 16, 25, 6, 2);
      px("#b8322c", 14, 10, 10, 12);
      px("#b8322c", 15, 22, 8, 2);
      px("#b8322c", 17, 24, 4, 1);
      px(GOLD, 18, 11, 2, 12);
      px(GOLD, 15, 15, 8, 2);
      px("#d6584e", 14, 10, 2, 6);
      break;
    }
    case KIT.ARCHER: {
      // A drawn bow, an arrow nocked.
      for (let i = 0; i <= 22; i++) {
        const t = (i / 22) * Math.PI;
        const x = Math.round(9 + Math.sin(t) * 8);
        const y = 5 + i;
        px(O, x - 1, y, 3, 1);
        px(i % 5 === 2 ? GOLD : WOOD, x, y, 1, 1);
      }
      line(9, 5, 20, 16, "#efe6d2");
      line(20, 16, 9, 27, "#efe6d2");
      line(6, 16, 28, 16, O, 2);
      line(7, 16, 27, 16, WOOD);
      px(O, 26, 14, 4, 5);
      px(STEEL, 27, 15, 2, 3);
      px("#e0e0e0", 5, 14, 3, 1);
      px("#d94a4a", 5, 18, 3, 1);
      break;
    }
    case KIT.BOMBER: {
      // A round black bomb, its fuse fizzing.
      g.fillStyle = O;
      g.beginPath();
      g.arc(14, 19, 10, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#3b3846";
      g.beginPath();
      g.arc(14, 19, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#5c5868";
      g.beginPath();
      g.arc(11, 16, 4, 0, Math.PI * 2);
      g.fill();
      px("#8a8696", 9, 14, 2, 2);
      px(O, 19, 8, 5, 4);
      px("#7a7686", 20, 9, 3, 2);
      line(22, 8, 25, 4, WOOD_D, 2);
      px("#ffd23f", 25, 1, 3, 3);
      px("#ff6a3f", 27, 3, 2, 2);
      px("#fff6c0", 26, 2, 1, 1);
      px("#ffd23f", 29, 1, 1, 1);
      break;
    }
    case KIT.SPEARMAN: {
      // A long spear across a round buckler.
      g.fillStyle = O;
      g.beginPath();
      g.arc(11, 21, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#3f6fb0";
      g.beginPath();
      g.arc(11, 21, 7, 0, Math.PI * 2);
      g.fill();
      px(GOLD, 10, 20, 3, 3);
      px("#6b98d6", 7, 17, 3, 2);
      line(3, 30, 25, 8, O, 3);
      line(4, 29, 25, 8, WOOD);
      px(O, 23, 2, 7, 9);
      px(STEEL, 24, 3, 5, 3);
      px(STEEL, 25, 6, 3, 2);
      px(STEEL_D, 27, 3, 2, 5);
      break;
    }
    case KIT.TANK: {
      // A tower shield and a war hammer.
      line(18, 28, 26, 6, O, 3);
      line(19, 27, 26, 6, WOOD);
      px(O, 21, 2, 10, 8);
      px("#9aa0aa", 22, 3, 8, 6);
      px("#c4c8d0", 22, 3, 8, 2);
      px(O, 4, 6, 14, 22);
      px("#6b6f7a", 5, 7, 12, 20);
      px("#8a8f9a", 5, 7, 12, 2);
      px(GOLD, 10, 9, 2, 16);
      px(GOLD, 6, 15, 10, 2);
      for (const [x, y] of [[6, 9], [15, 9], [6, 24], [15, 24]]) px("#d8dce8", x, y, 1, 1);
      break;
    }
  }
  const url = c.toDataURL();
  badges.set(k, url);
  return url;
}

/** A class's badge as an image, `size` CSS px. */
function badgeImg(k: number, size: number): HTMLImageElement {
  const img = el("img", "ark-badge");
  img.src = kitBadge(k);
  img.width = img.height = size;
  img.alt = KITS[k].name;
  return img;
}

/** A card for class `k`: its badge, name and role, its four numbers, what each move does. */
export function kitCard(k: number, opts: { pick?: () => void; on?: boolean; key?: string } = {}): HTMLElement {
  const info = KITS[k];
  const card = el(opts.pick ? "button" : "div", `ark-card${opts.on ? " on" : ""}`);
  if (card instanceof HTMLButtonElement) {
    card.type = "button";
    card.onclick = opts.pick!;
  }
  card.style.setProperty("--t", info.tint);
  const top = el("div", "ark-top");
  top.append(badgeImg(k, 48));
  const name = el("div", "ark-name");
  name.append(el("strong", "", info.name), el("span", "ark-role", info.role));
  top.append(name);
  if (opts.key) top.append(el("kbd", "ark-key", opts.key));
  const stats = el("div", "ark-stats");
  ["Health", "Pace", "Punch", "Reach"].forEach((label, i) => {
    const row = el("div", "ark-stat");
    row.append(el("span", "", label));
    const pips = el("span", "ark-pips");
    for (let p = 0; p < 5; p++) pips.append(el("i", p < info.stats[i] ? "on" : ""));
    row.append(pips);
    stats.append(row);
  });
  const moves = el("ul", "ark-moves");
  for (const [icon, text] of [
    ["🖱", info.quick],
    ["⏳", info.charged],
    ["⚡", info.ultimate],
  ]) {
    const li = el("li");
    li.append(el("b", "", icon), document.createTextNode(` ${text}`));
    moves.append(li);
  }
  card.append(top, el("p", "ark-blurb", info.blurb), stats, moves);
  return card;
}

/**
 * The class picker at the start of a round (classes on): the five cards,
 * the seconds left, who's picked; keys 1–5 pick too. Shows nothing for the
 * Goliath but who's still choosing.
 */
export class KitPicker {
  readonly el = el("div", "ark-pick");
  private key = "";
  private onKey = (e: KeyboardEvent) => {
    if (this.el.hidden || !this.canPick) return;
    const n = Number(e.key);
    if (n >= 1 && n <= KIT.COUNT) {
      e.preventDefault();
      e.stopPropagation();
      this.pick(n - 1);
    }
  };
  private canPick = false;
  private barEl: HTMLElement | null = null;

  constructor(private pick: (k: number) => void) {
    this.el.hidden = true;
    document.body.append(this.el);
    window.addEventListener("keydown", this.onKey, true);
  }

  /**
   * Shown while classes are being picked: `leftMs` of `CHOOSE_MS`; `mine`
   * our pick (-1 none yet; null if we're not picking: the Goliath, or
   * watching); who else is in it, and whether each has picked.
   */
  update(leftMs: number, mine: number | null, giant: boolean, others: { name: string; color: string; picked: boolean; kit: number }[]) {
    const show = leftMs > 0;
    this.el.hidden = !show;
    if (!show) {
      this.key = "";
      return;
    }
    this.canPick = mine !== null && !giant;
    const key = `${mine}|${giant}|${others.map((o) => `${o.name}${o.picked}${o.kit}`).join(",")}`;
    if (key !== this.key) {
      this.key = key;
      this.el.replaceChildren();
      const card = el("div", "ark-pick-card");
      const head = el("div", "ark-pick-head");
      head.append(el("h2", "", giant ? "👹 The gladiators are arming" : mine !== null && mine >= 0 ? `${KITS[mine].icon} ${KITS[mine].name}, it is` : "⚔️ Choose your class"));
      const bar = el("div", "ark-timer");
      this.barEl = el("i");
      bar.append(this.barEl);
      card.append(head, bar);
      if (this.canPick) {
        const grid = el("div", "ark-grid");
        for (let k = 0; k < KIT.COUNT; k++) grid.append(kitCard(k, { pick: () => this.pick(k), on: mine === k, key: String(k + 1) }));
        card.append(grid);
      } else if (giant) {
        card.append(el("p", "ark-wait", "They're picking their classes. You're the Goliath: no choosing needed."));
      }
      const who = el("div", "ark-who");
      for (const o of others) {
        const chip = el("span", `ark-chip${o.picked ? " in" : ""}`);
        chip.style.setProperty("--c", o.color);
        chip.append(el("b", "", o.name));
        if (o.picked) chip.append(badgeImg(o.kit, 16));
        else chip.append(el("em", "", "choosing…"));
        who.append(chip);
      }
      card.append(who);
      card.append(el("p", "ark-foot", this.canPick ? "Click a class (or press 1–5). The round starts when everyone's picked." : "The round starts when everyone's picked."));
      this.el.append(card);
    }
    if (this.barEl) this.barEl.style.width = `${Math.max(0, Math.min(1, leftMs / CHOOSE_MS)) * 100}%`;
    this.barEl?.parentElement?.setAttribute("data-s", String(Math.ceil(leftMs / 1000)));
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey, true);
    this.el.remove();
  }
}

/** The gallery of classes (from the lobby): all five cards, to look over. */
export function kitGallery(): void {
  const back = el("div", "ark-pick ark-gallery");
  const card = el("div", "ark-pick-card");
  const head = el("div", "ark-pick-head");
  const close = el("button", "subtle ar-close", "✕");
  close.type = "button";
  const shut = () => {
    back.remove();
    window.removeEventListener("keydown", esc, true);
  };
  const esc = (e: KeyboardEvent) => e.key === "Escape" && shut();
  close.onclick = shut;
  back.onclick = (e) => e.target === back && shut();
  head.append(el("h2", "", "🎭 The classes"), close);
  const grid = el("div", "ark-grid");
  for (let k = 0; k < KIT.COUNT; k++) grid.append(kitCard(k));
  card.append(head, el("p", "ark-foot", "With classes on, everyone picks one before each round (7 seconds). The Goliath stays the Goliath."), grid);
  back.append(card);
  document.body.append(back);
  window.addEventListener("keydown", esc, true);
}
