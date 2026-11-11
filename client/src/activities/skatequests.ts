// Dusty's daily quests: three a day at the skatepark (an easy one, a
// middling one, a hard one: 20, 35 and 50 coins, `skate::QUEST_COINS`),
// picked from a pool by the day (UTC), the same three for everyone. Each
// is something you can do on a stock board: a 60-second run's score, a big
// combo, grinds, air, a manual held, a spin, speed, a 1v1 won… What you've
// done today is kept on this device; a quest done is claimed at Dusty's
// van (the server pays each once a day: `SkateQuest`).

/** What's measured. `best`: the most in one go (a run, a combo, a jump); `sum`: all of today's added up. */
export type Metric =
  | "runScore"
  | "runs"
  | "lineScore"
  | "comboPts"
  | "comboTricks"
  | "banked"
  | "tricks"
  | "grindPts"
  | "grindTime"
  | "manualTime"
  | "airHeight"
  | "airTime"
  | "grabTime"
  | "spin"
  | "distance"
  | "topSpeed"
  | "dropIns"
  | "gaps"
  | "cleanStreak"
  | "duelWins";

interface QuestDef {
  metric: Metric;
  how: "best" | "sum";
  /** The target for each slot (easy, middling, hard); null: not for that slot. */
  targets: [number | null, number | null, number | null];
  /** What it says, for a target. */
  text: (n: number) => string;
  /** How progress is shown (default: a whole number). */
  show?: (n: number) => string;
}

/** Art pixels to metres, px/s to km/h (a tile's a metre). */
const M = 32;
const metres = (px: number) => `${(px / M).toFixed(1)} m`;
const kmh = (v: number) => Math.round((v / M) * 3.6);
const secs = (s: number) => `${s.toFixed(1)} s`;
const num = (n: number) => Math.round(n).toLocaleString("en-US");

export const POOL: QuestDef[] = [
  { metric: "runScore", how: "best", targets: [1500, 4000, 9000], text: (n) => `Score ${num(n)} in a 60-second run` },
  { metric: "runs", how: "sum", targets: [1, 3, null], text: (n) => (n === 1 ? "Finish a 60-second run" : `Finish ${n} 60-second runs`) },
  { metric: "lineScore", how: "best", targets: [600, 2000, 5000], text: (n) => `Score ${num(n)} in Line mode` },
  { metric: "comboPts", how: "best", targets: [400, 1200, 3000], text: (n) => `Land a combo worth ${num(n)}` },
  { metric: "comboTricks", how: "best", targets: [3, 5, 7], text: (n) => `Land a combo of ${n} tricks` },
  { metric: "banked", how: "sum", targets: [1500, 5000, 12000], text: (n) => `Bank ${num(n)} points today` },
  { metric: "tricks", how: "sum", targets: [15, 40, 90], text: (n) => `Land ${n} tricks` },
  { metric: "grindPts", how: "sum", targets: [300, 800, 2000], text: (n) => `Earn ${num(n)} grind points` },
  { metric: "grindTime", how: "best", targets: [1, 2, 3.2], text: (n) => `Grind for ${n} s in one go`, show: secs },
  { metric: "manualTime", how: "best", targets: [1, 2.5, 4], text: (n) => `Hold a manual for ${n} s`, show: secs },
  { metric: "airHeight", how: "best", targets: [48, 80, 112], text: (n) => `Get ${metres(n)} of air`, show: metres },
  { metric: "airTime", how: "best", targets: [0.6, 0.85, 1.1], text: (n) => `Stay in the air for ${n} s`, show: secs },
  { metric: "grabTime", how: "best", targets: [0.4, 0.7, 1], text: (n) => `Hold a grab for ${n} s`, show: secs },
  { metric: "spin", how: "best", targets: [180, 360, 540], text: (n) => `Land a ${n}° spin`, show: (n) => `${n}°` },
  { metric: "distance", how: "sum", targets: [4800, 12800, 32000], text: (n) => `Skate ${Math.round(n / M)} m`, show: (n) => `${Math.round(n / M)} m` },
  { metric: "topSpeed", how: "best", targets: [220, 255, 280], text: (n) => `Hit ${kmh(n)} km/h`, show: (n) => `${kmh(n)} km/h` },
  { metric: "dropIns", how: "sum", targets: [1, 3, 6], text: (n) => (n === 1 ? "Drop in off a ramp" : `Drop in ${n} times`) },
  { metric: "gaps", how: "sum", targets: [null, 1, 3], text: (n) => (n === 1 ? "Clear a gap (kickers, funbox or stairs)" : `Clear ${n} gaps`) },
  { metric: "cleanStreak", how: "best", targets: [4, 8, 15], text: (n) => `Land ${n} combos in a row without bailing` },
  { metric: "duelWins", how: "sum", targets: [null, 1, 2], text: (n) => (n === 1 ? "Win a 1v1 (a skater or the bot)" : `Win ${n} 1v1s`) },
];

/** Coins by slot (as `skate::QUEST_COINS`). */
export const QUEST_COINS = [20, 35, 50];

export interface DailyQuest {
  slot: number;
  metric: Metric;
  target: number;
  text: string;
  coins: number;
  progress: number;
  /** Progress, as shown ("2.1 s / 3 s"). */
  shown: string;
  done: boolean;
  claimed: boolean;
}

/** Today (days since 1970, UTC): as the server counts it. */
export function questDay(now = Date.now()): number {
  return Math.floor(now / 86_400_000);
}

/** The day's three: one for each slot, each a different thing, by a shuffle seeded with the day. */
export function pick(day: number): { slot: number; def: QuestDef; target: number }[] {
  let s = (day * 2654435761) >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const used = new Set<Metric>();
  const out: { slot: number; def: QuestDef; target: number }[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const can = POOL.filter((d) => d.targets[slot] !== null && !used.has(d.metric));
    const def = can[Math.floor(rand() * can.length)];
    used.add(def.metric);
    out.push({ slot, def, target: def.targets[slot]! });
  }
  return out;
}

interface Saved {
  day: number;
  best: Partial<Record<Metric, number>>;
  sum: Partial<Record<Metric, number>>;
  claimed: boolean[];
}

const STORE = "commons.skatequests";

/** Today's quests and how far you've got: fed what you do, kept on this device. */
export class Quests {
  private s: Saved;
  /** Done already (not to say it twice). */
  private told = new Set<number>();

  constructor(
    /** A quest's just been done. */
    private onDone: (q: DailyQuest) => void = () => {},
    private store: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
    private now: () => number = Date.now,
  ) {
    this.s = this.load();
    for (const q of this.today()) if (q.done) this.told.add(q.slot);
  }

  private load(): Saved {
    const day = questDay(this.now());
    try {
      const s = JSON.parse(this.store?.getItem(STORE) ?? "null") as Saved | null;
      if (s && s.day === day) return s;
    } catch {
      /* (Nothing kept.) */
    }
    return { day, best: {}, sum: {}, claimed: [false, false, false] };
  }

  private save() {
    try {
      this.store?.setItem(STORE, JSON.stringify(this.s));
    } catch {
      /* (A private window: not kept.) */
    }
  }

  /** A new day since: a fresh three. */
  private fresh() {
    if (this.s.day !== questDay(this.now())) {
      this.s = this.load();
      this.told.clear();
    }
  }

  get day(): number {
    this.fresh();
    return this.s.day;
  }

  today(): DailyQuest[] {
    this.fresh();
    return pick(this.s.day).map(({ slot, def, target }) => {
      const progress = (def.how === "best" ? this.s.best[def.metric] : this.s.sum[def.metric]) ?? 0;
      const show = def.show ?? num;
      return {
        slot,
        metric: def.metric,
        target,
        text: def.text(target),
        coins: QUEST_COINS[slot],
        progress,
        shown: `${show(Math.min(progress, target))} / ${show(target)}`,
        done: progress >= target,
        claimed: !!this.s.claimed[slot],
      };
    });
  }

  /** Something done: the most of it in one go (`best` quests), and added to today's (`sum` ones). */
  record(metric: Metric, value: number) {
    if (!(value > 0)) return;
    this.fresh();
    this.s.best[metric] = Math.max(this.s.best[metric] ?? 0, value);
    this.s.sum[metric] = (this.s.sum[metric] ?? 0) + value;
    this.save();
    for (const q of this.today()) {
      if (q.metric === metric && q.done && !this.told.has(q.slot)) {
        this.told.add(q.slot);
        this.onDone(q);
      }
    }
  }

  /** A quest's coins paid (or paid before). */
  claimed(day: number, slot: number) {
    this.fresh();
    if (day !== this.s.day) return;
    this.s.claimed[slot] = true;
    this.save();
  }

  /** How many are done and waiting to be claimed. */
  get waiting(): number {
    return this.today().filter((q) => q.done && !q.claimed).length;
  }
}
