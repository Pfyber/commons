// The park's bot, skating for real when you take it on in a 1v1: a
// skater of its own (skatesim.ts, the same physics as yours) steered round
// the park by a little rider: off to somewhere on the concrete, pushing,
// popping ollies (off the ramps when it's on one), and in the air a flip, a
// grab or a spin, let go of in time to land. In a grinds-only 1v1 it goes
// for the rails and ledges instead: lined up behind one's end, rolling
// along it, popped onto it, balanced along it. (Its score is the server's;
// this is how it looks getting it.)

import { NO_INPUT, type Input, type Line, type Park, Skater, wrap } from "./skatesim";

const T = 32;
/** How near (tiles) whoever it's up against it keeps to. */
const NEAR = 9;
/** Grinds only: how far back from a rail's end it lines up (px). */
const RUN_UP = 110;

export class BotRider {
  readonly s: Skater;
  private target: { x: number; y: number } | null = null;
  /** On the ground: till the next pop (s), and how long it's held down when it comes. */
  private popIn = 1.5;
  private popHold = 0;
  /** Going slow this long (s): stuck on something, off somewhere else. */
  private slow = 0;
  /** In the air: what it's doing (picked as it leaves the ground), and how far round a spin's to go (rad). */
  private air: { trick: "flip" | "grab" | "spin" | "none"; spin: number; stick: { x: number; y: number }; flipped: boolean } | null = null;
  /** Grinds only: the rail or ledge it's going for (from which end, which way along it), and how long it's been at it (s). */
  private rail: { line: Line; sx: number; sy: number; dx: number; dy: number; lined: boolean; t: number } | null = null;
  /** Grinds only: it goes for rails and ledges, no tricks in the air. */
  grinds = false;
  /** Rails it's tried and not got onto (left alone after). */
  private missed = new Set<number>();

  constructor(
    private park: Park,
    x: number,
    y: number,
    /** Where it may go: the open, flat concrete (map tiles). */
    private spots: { x: number; y: number }[],
    /** Who it stays near (art px), to be seen skating. */
    private around: () => { x: number; y: number } | null = () => null,
    private rand: () => number = Math.random,
  ) {
    this.s = new Skater(park, x, y, rand);
  }

  /** One step of \`dt\` s (\`go\`: it's riding; else it coasts to a stop). */
  step(dt: number, go: boolean): void {
    this.s.step(dt, go ? this.input(dt) : NO_INPUT);
  }

  private input(dt: number): Input {
    const s = this.s;
    if (this.grinds) return this.grinding(dt);
    if (s.mode === "air") return this.inAir();
    this.air = null;
    if (s.mode !== "ground") return NO_INPUT;
    // Somewhere to go: picked afresh when it's there, or stuck.
    this.slow = s.speed < 30 ? this.slow + dt : 0;
    if (!this.target || Math.hypot(this.target.x - s.x, this.target.y - s.y) < 48 || this.slow > 1.2) {
      // Somewhere near whoever it's up against (so it's seen), or anywhere.
      const you = this.around();
      const near = you ? this.spots.filter((p) => Math.hypot(p.x * T + 16 - you.x, p.y * T + 16 - you.y) < NEAR * T) : [];
      const from = near.length > 4 ? near : this.spots;
      const t = from[Math.floor(this.rand() * from.length)];
      this.target = { x: t.x * T + 16, y: t.y * T + 16 };
      this.slow = 0;
    }
    const a = Math.atan2(this.target.y - s.y, this.target.x - s.x);
    const inp: Input = { ...NO_INPUT, x: Math.cos(a), y: Math.sin(a) };
    // Pop: now and then rolling along, sooner going up a ramp.
    const ramp = this.park.rampAt(s.x, s.y);
    this.popIn -= dt * (ramp && ramp.kind !== "stairs" ? 3 : 1);
    if (this.popHold > 0) {
      this.popHold -= dt;
      // (Let go: the ollie.)
      if (this.popHold > 0) inp.pop = true;
      else this.popIn = 1.2 + this.rand() * 2;
    } else if (this.popIn <= 0 && s.speed > 110) {
      this.popHold = 0.15 + this.rand() * 0.3;
      inp.pop = true;
    }
    return inp;
  }

  /** Grinds only: to a rail or ledge, onto it, along it. */
  private grinding(dt: number): Input {
    const s = this.s;
    // On it: balanced (a nudge back the way it's tipping, not quite perfect).
    if (s.mode === "grind") {
      this.rail = null;
      return { ...NO_INPUT, x: Math.max(-1, Math.min(1, s.balance * 3 + (this.rand() - 0.5) * 0.6)) };
    }
    if (s.mode === "air") {
      // Holding the line it popped along.
      const r = this.rail;
      return r ? { ...NO_INPUT, x: r.dx * 0.4, y: r.dy * 0.4 } : NO_INPUT;
    }
    if (s.mode !== "ground") return NO_INPUT;
    this.slow = s.speed < 30 ? this.slow + dt : 0;
    let r = this.rail;
    if (r) r.t += dt;
    if (r && (this.slow > 1.2 || r.t > 9)) this.missed.add(r.line.id);
    if (!r || this.slow > 1.2 || r.t > 9) r = this.rail = this.pickRail();
    if (!r) return NO_INPUT;
    // Along the line from its start (px): before it, negative.
    const along = (s.x - r.sx) * r.dx + (s.y - r.sy) * r.dy;
    const off = Math.abs((s.x - r.sx) * r.dy - (s.y - r.sy) * r.dx);
    let tx: number;
    let ty: number;
    if (!r.lined) {
      // First, round behind its start, on its line.
      tx = r.sx - r.dx * RUN_UP;
      ty = r.sy - r.dy * RUN_UP;
      if (Math.hypot(tx - s.x, ty - s.y) < 26) r.lined = true;
    } else {
      // Then along it, at its start's height a moment before reaching it: popped up onto it.
      tx = r.sx + r.dx * 80;
      ty = r.sy + r.dy * 80;
      if (along > 20 || off > 40) r.lined = false;
    }
    const a = Math.atan2(ty - s.y, tx - s.x);
    const inp: Input = { ...NO_INPUT, x: Math.cos(a), y: Math.sin(a) };
    if (this.popHold > 0) {
      this.popHold -= dt;
      if (this.popHold > 0) inp.pop = true;
    } else if (r.lined && along > -44 && along < -14 && off < 9 && s.speed > 100) {
      // Crouched as long as it takes to pop up to the line's height (and a bit).
      const lz = Math.max(r.line.za, r.line.zb) - s.z;
      const power = Math.max(0.15, Math.min(1, (Math.sqrt(1900 * (lz + 12)) - 240) / 160));
      this.popHold = power * 0.45 + 0.02;
      inp.pop = true;
    }
    return inp;
  }

  /** A rail or ledge to go for: one near whoever it's up against, from either end. */
  private pickRail(): BotRider["rail"] {
    const you = this.around() ?? { x: this.s.x, y: this.s.y };
    // (Rails it hasn't missed, near you; free-standing rails three times as likely as ledges.)
    if (this.missed.size >= this.park.lines.length) this.missed.clear();
    const fresh = this.park.lines.filter((l) => !this.missed.has(l.id));
    const near = fresh.filter((l) => Math.hypot((l.ax + l.bx) / 2 - you.x, (l.ay + l.by) / 2 - you.y) < NEAR * 2 * T);
    const from = near.length ? near : fresh;
    if (!from.length) return null;
    const weighted = from.flatMap((l) => (l.kind === "rail" ? [l, l, l] : [l]));
    const line = weighted[Math.floor(this.rand() * weighted.length)];
    const fwd = this.rand() < 0.5;
    const [sx, sy, ex, ey] = fwd ? [line.ax, line.ay, line.bx, line.by] : [line.bx, line.by, line.ax, line.ay];
    const len = Math.hypot(ex - sx, ey - sy) || 1;
    this.slow = 0;
    return { line, sx, sy, dx: (ex - sx) / len, dy: (ey - sy) / len, lined: false, t: 0 };
  }

  /** In the air: a trick picked as it takes off, let go of in time to come down straight. */
  private inAir(): Input {
    const s = this.s;
    const inp: Input = { ...NO_INPUT };
    if (!this.air) {
      const r = this.rand();
      const sticks = [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
      this.air = {
        trick: r < 0.4 ? "flip" : r < 0.7 ? "grab" : r < 0.9 ? "spin" : "none",
        spin: this.rand() < 0.6 ? Math.PI : Math.PI * 2,
        stick: sticks[Math.floor(this.rand() * sticks.length)],
        flipped: false,
      };
    }
    const a = this.air;
    const t = s.air.t;
    // Time left before it's down, about (rising, then falling the height it's at).
    const down = s.vz > 0 ? 1 : s.clearance / Math.max(60, -s.vz);
    if (a.trick === "flip" && !a.flipped && t > 0.06) {
      a.flipped = true;
      inp.flip = true;
      inp.x = a.stick.x;
      inp.y = a.stick.y;
    } else if (a.trick === "grab" && t > 0.05 && down > 0.18) {
      inp.grab = true;
      inp.x = a.stick.x;
      inp.y = a.stick.y;
    } else if (a.trick === "spin" && Math.abs(s.air.spin) < a.spin - 0.15 && (down > 0.12 || s.vz > 0)) {
      inp.spin = 1;
    }
    // (A spin that won't make it round in time: finished to the nearest half turn, or stopped.)
    if (a.trick === "spin" && !inp.spin) {
      const off = wrap(s.air.spin - Math.round(s.air.spin / Math.PI) * Math.PI);
      if (Math.abs(off) > 0.5 && down > 0.08) inp.spin = off > 0 ? -1 : 1;
    }
    return inp;
  }
}
