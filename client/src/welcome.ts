// The founding experience (server: crates/api/src/welcome.rs): the
// Caretaker's three first tasks, founders and the Founders' Grove, plus the
// town's gathering hours.

import type { Auth } from "./net/api";

export interface Founder {
  no: number;
  slot: number;
  name: string;
  planted_at: number;
  /** 0 seedling, 1 sapling, 2 young tree, 3 grown. */
  stage: number;
}

export interface Season {
  open: boolean;
  left: number;
  slots: number;
}

export interface WelcomeStatus {
  tasks: { fish: boolean; plant: boolean; sit: boolean };
  founder: Founder | null;
  season: Season;
}

export class Welcome {
  status: WelcomeStatus | null = null;
  founders: Founder[] = [];
  season: Season | null = null;
  private byName = new Map<string, Founder>();
  private listeners: (() => void)[] = [];

  constructor(private auth: Auth) {}

  /** Calls `fn` on every change; returns a function that stops it. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  async load(): Promise<WelcomeStatus> {
    this.status = await this.auth.get<WelcomeStatus>("/api/welcome");
    this.season = this.status.season;
    this.changed();
    return this.status;
  }

  async loadFounders(): Promise<Founder[]> {
    const r = await fetch("/api/founders").then((r) => r.json() as Promise<{ founders: Founder[]; season: Season }>);
    this.founders = r.founders;
    this.season = r.season;
    this.byName = new Map(r.founders.map((f) => [f.name, f]));
    this.changed();
    return this.founders;
  }

  /** Plants your seedling (the three tasks must be done). */
  async plant(): Promise<Founder> {
    const r = await this.auth.send<{ founder: Founder }>("/api/welcome/plant", {});
    await Promise.all([this.load(), this.loadFounders()]);
    return r.founder;
  }

  founderNamed(name: string): Founder | undefined {
    return this.byName.get(name);
  }

  /** Tasks done, 0–3. */
  get done(): number {
    const t = this.status?.tasks;
    return t ? Number(t.fish) + Number(t.plant) + Number(t.sit) : 0;
  }
}

// ---- gathering hours (spec §11) -------------------------------------------------

export interface Gathering {
  key: string;
  title: string;
  where: string;
  /** Map tile to gather at. */
  at: { x: number; y: number };
  /** UTC day of the week (0 = Sunday), or null for every day. */
  weekday: number | null;
  /** Start, UTC. */
  hour: number;
  minute: number;
  minutes: number;
}

export const GATHERINGS: Gathering[] = [
  { key: "evening", title: "Evening at the fountain", where: "the fountain", at: { x: 48, y: 51 }, weekday: null, hour: 18, minute: 0, minutes: 60 },
  { key: "chess", title: "Chess night", where: "the chess tables", at: { x: 60, y: 44 }, weekday: 4, hour: 18, minute: 30, minutes: 90 },
];

const DAY = 86_400_000;

/** The occurrence of `g` that's on now or comes next. */
export function nextOccurrence(g: Gathering, now: number): { start: number; end: number } {
  const midnight = Math.floor(now / DAY) * DAY;
  for (let d = -1; d <= 8; d++) {
    const day = midnight + d * DAY;
    if (g.weekday !== null && new Date(day).getUTCDay() !== g.weekday) continue;
    const start = day + (g.hour * 60 + g.minute) * 60_000;
    const end = start + g.minutes * 60_000;
    if (end > now) return { start, end };
  }
  throw new Error("unreachable: every gathering happens at least weekly");
}

/** The gathering happening right now, if any. */
export function happeningNow(now: number): Gathering | null {
  return GATHERINGS.find((g) => nextOccurrence(g, now).start <= now) ?? null;
}

/** "Today 20:00", "Thu 20:30" in the viewer's own time zone. */
export function whenText(start: number, now: number): string {
  const d = new Date(start);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now).toDateString() === d.toDateString();
  const tomorrow = new Date(now + DAY).toDateString() === d.toDateString();
  if (today) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}
