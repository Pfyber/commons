import { describe, expect, it } from "vitest";
import type { MapObject } from "../world/map";
import { Combo, NO_INPUT, Park, QUARTER_H, Skater, type Input, type SkateEvent } from "./skatesim";

const T = 32;

/** A 20×14-tile pad at the origin: a quarter pipe along the north, a funbox with a rail, a ledge. */
function park(extra: MapObject[] = []): Park {
  const objects: MapObject[] = [
    { kind: "sk_park", x: 0, y: 0, w: 20, h: 14 },
    { kind: "sk_quarter", x: 0, y: 0, w: 20, h: 3, label: "n" },
    { kind: "sk_kicker", x: 4, y: 8, w: 3, h: 3, label: "e" },
    { kind: "sk_box", x: 7, y: 8, w: 6, h: 3, label: "14" },
    { kind: "sk_kicker", x: 13, y: 8, w: 3, h: 3, label: "w" },
    { kind: "sk_rail", x: 2, y: 12, w: 10, h: 1, label: "h:14:14" },
    ...extra,
  ];
  return new Park(objects, (tx, ty) => tx >= 0 && ty >= 0 && tx < 20 && ty < 14);
}

/** Runs `s` for `secs` at 120 steps a second, with `inp` (or a function of time), collecting what happened. */
function run(s: Skater, secs: number, inp: Input | ((t: number) => Input) = NO_INPUT): SkateEvent[] {
  const out: SkateEvent[] = [];
  const dt = 1 / 120;
  for (let t = 0; t < secs; t += dt) out.push(...s.step(dt, typeof inp === "function" ? inp(t) : inp));
  return out;
}

const steady = (rand = 0.5) => () => rand;

describe("the park", () => {
  it("knows how high it stands where", () => {
    const p = park();
    expect(p.height(5 * T, 6 * T)).toBe(0);
    expect(p.height(10 * T, 9 * T)).toBe(14);
    // A quarter pipe rises toward its lip.
    expect(p.height(5 * T, 3 * T - 1)).toBeLessThan(2);
    expect(p.height(5 * T, 1)).toBeGreaterThan(QUARTER_H - 3);
    // A kicker climbs to its top.
    expect(p.height(4 * T + 2, 9 * T)).toBeLessThan(p.height(7 * T - 2, 9 * T));
  });

  it("finds the rail and the funbox's ledges, not the edges where its kickers meet it", () => {
    const p = park();
    expect(p.lines.filter((l) => l.kind === "rail")).toHaveLength(1);
    const ledges = p.lines.filter((l) => l.kind === "ledge");
    expect(ledges).toHaveLength(2);
    expect(ledges.every((l) => l.ay === l.by)).toBe(true);
  });

  it("is walled by the edge of the concrete and the sides of things", () => {
    const p = park();
    expect(p.blocked(-5, 5 * T, 0)).toBe(true);
    expect(p.blocked(10 * T, 8 * T + 4, 0)).toBe(true);
    expect(p.blocked(10 * T, 8 * T + 4, 14)).toBe(false);
  });
});

describe("a skater", () => {
  it("builds speed push by push, gliding between, up to full speed", () => {
    const s = new Skater(park(), 3 * T, 6 * T, steady());
    const hold = { ...NO_INPUT, x: 1 };
    // The first push: a shove while the foot's down...
    run(s, 0.45, hold);
    const one = s.speed;
    expect(one).toBeGreaterThan(60);
    // ...then a glide (no faster) till the next.
    run(s, 0.6, hold);
    expect(s.speed).toBeLessThanOrEqual(one);
    // Push on and on: faster with each, up to full speed.
    run(s, 0.6, hold);
    expect(s.speed).toBeGreaterThan(one + 30);
    // On a long run: a few more pushes and you're flat out.
    const long = new Skater(new Park([{ kind: "sk_park", x: 0, y: 0, w: 80, h: 6 }], (tx, ty) => tx >= 0 && ty >= 0 && tx < 80 && ty < 6), 2 * T, 3 * T, steady());
    let top = 0;
    const ev = run(long, 6, () => {
      top = Math.max(top, long.speed);
      return hold;
    });
    expect(ev.filter((e) => e.t === "push").length).toBeGreaterThan(3);
    expect(top).toBeGreaterThan(220);
  });


  it("ollies up and comes down again, an ollie in the combo, banked a moment after", () => {
    const s = new Skater(park(), 3 * T, 6 * T, steady());
    s.speed = 120;
    run(s, 0.2, { ...NO_INPUT, pop: true });
    const ev = run(s, 0.05);
    expect(ev.some((e) => e.t === "pop")).toBe(true);
    expect(s.mode).toBe("air");
    let peak = 0;
    const evs = run(s, 1.2, () => {
      peak = Math.max(peak, s.z);
      return NO_INPUT;
    });
    expect(peak).toBeGreaterThan(20);
    expect(evs.find((e) => e.t === "bank")).toMatchObject({ t: "bank", pts: 25, label: "Ollie" });
  });

  it("lands a kickflip; comes down mid-flip, and bails", () => {
    const s = new Skater(park(), 3 * T, 6 * T, steady());
    s.speed = 100;
    run(s, 0.4, { ...NO_INPUT, pop: true });
    run(s, 1 / 120);
    run(s, 1 / 120, { ...NO_INPUT, flip: true });
    const ev = run(s, 1.2);
    expect(ev.some((e) => e.t === "trick" && e.name === "Kickflip")).toBe(true);
    expect(ev.some((e) => e.t === "bail")).toBe(false);

    const b = new Skater(park(), 3 * T, 6 * T, steady());
    b.speed = 100;
    run(b, 0.01, { ...NO_INPUT, pop: true });
    run(b, 1 / 120);
    // A flip right before landing: a small ollie leaves no time for a double.
    run(b, 0.2);
    run(b, 1 / 120, { ...NO_INPUT, flip: true });
    run(b, 1 / 120, { ...NO_INPUT, flip: true });
    const lost = run(b, 0.8);
    expect(lost.some((e) => e.t === "bail")).toBe(true);
    expect(b.mode).toBe("bail");
  });

  it("goes up a quarter pipe, straight up out of it, and rolls back down it", () => {
    const s = new Skater(park(), 6 * T, 6 * T, steady());
    s.heading = -Math.PI / 2;
    s.speed = 260;
    let peak = 0;
    let vert = false;
    let landed = false;
    const ev: SkateEvent[] = [];
    for (let t = 0; t < 3 && !landed; t += 1 / 120) {
      const e = s.step(1 / 120, NO_INPUT);
      ev.push(...e);
      peak = Math.max(peak, s.z);
      vert ||= s.mode === "air" && !!s.air.vert;
      landed = vert && e.some((x) => x.t === "land");
    }
    expect(landed).toBe(true);
    expect(peak).toBeGreaterThan(QUARTER_H + 30);
    expect(ev.some((e) => e.t === "trick" && e.name === "Air")).toBe(true);
    // Back down it, headed south.
    expect(Math.sin(s.heading)).toBeGreaterThan(0.9);
    const y = s.y;
    run(s, 0.3);
    expect(s.y).toBeGreaterThan(y + 20);
  });

  it("grinds a rail it comes down on, along it, and rides off the end", () => {
    const s = new Skater(park(), 2 * T + 6, 12 * T + 16, steady());
    s.heading = 0;
    s.speed = 200;
    run(s, 0.3, { ...NO_INPUT, pop: true });
    let grinding = false;
    const ev = run(s, 2, () => {
      grinding ||= s.mode === "grind";
      return NO_INPUT;
    });
    expect(grinding).toBe(true);
    expect(ev.some((e) => e.t === "trick" && e.name === "50-50 Grind")).toBe(true);
    expect(s.x).toBeGreaterThan(12 * T);
  });

  it("links tricks across landings only with a manual", () => {
    const s = new Skater(park(), 3 * T, 6 * T, steady());
    s.speed = 120;
    const pop = (secs: number) => {
      run(s, secs, { ...NO_INPUT, pop: true });
      run(s, 1 / 120);
    };
    pop(0.2);
    // Manual pressed on the way down: caught on landing, the combo carries on.
    const air = run(s, 1.2, (t) => ({ ...NO_INPUT, manual: t > 0.45 && t < 0.47 }));
    expect(air.some((e) => e.t === "manual" && e.on)).toBe(true);
    expect(air.some((e) => e.t === "bank")).toBe(false);
    expect(s.combo.count).toBe(2);
  });

  it("is stopped by walls, bounced back the other way", () => {
    const s = new Skater(park(), 18 * T, 6 * T, steady());
    s.heading = 0;
    s.speed = 200;
    const ev = run(s, 1);
    expect(ev.some((e) => e.t === "wall")).toBe(true);
    expect(s.x).toBeLessThan(20 * T);
    expect(Math.cos(s.heading)).toBeLessThan(0);
  });
});

describe("space in the air", () => {
  it("off a quarter pipe, flips you right round; on the flat, a kickflip", () => {
    const s = new Skater(park(), 6 * T, 6 * T, steady());
    s.heading = -Math.PI / 2;
    s.speed = 260;
    let pressed = false;
    const ev = run(s, 2.5, () => {
      const go = s.mode === "air" && !!s.air.vert && s.vz > 100 && !pressed;
      if (go) pressed = true;
      return { ...NO_INPUT, pop: go };
    });
    expect(ev.some((e) => e.t === "trick" && e.name === "Backflip")).toBe(true);
    expect(ev.some((e) => e.t === "bail")).toBe(false);

    const f = new Skater(park(), 3 * T, 6 * T, steady());
    f.speed = 100;
    run(f, 0.4, { ...NO_INPUT, pop: true });
    run(f, 0.02);
    run(f, 1 / 120, { ...NO_INPUT, pop: true });
    const flat = run(f, 1.2);
    expect(flat.some((e) => e.t === "trick" && e.name === "Kickflip")).toBe(true);
  });

  it("pushing off shows a stroke", () => {
    const s = new Skater(park(), 3 * T, 6 * T, steady());
    let pushed = false;
    run(s, 0.6, () => {
      pushed ||= s.pushing && s.push > 0.1;
      return { ...NO_INPUT, x: 1 };
    });
    expect(pushed).toBe(true);
  });
});

describe("ramps", () => {
  it("popping going up one launches you out forward, over it", () => {
    // Up the kicker at the funbox's west end, popping near its top: out over the box.
    const s = new Skater(park(), 4 * T - 20, 9 * T + 16, steady());
    s.heading = 0;
    s.speed = 260;
    let popped = false;
    let maxX = 0;
    run(s, 1.4, () => {
      // Pop held a moment on the kicker's face, let go near its top.
      const hold = s.mode === "ground" && s.x > 4 * T + 10 && s.x < 5 * T + 24;
      if (hold) popped = true;
      maxX = Math.max(maxX, s.x);
      return { ...NO_INPUT, pop: hold };
    });
    expect(popped).toBe(true);
    expect(maxX).toBeGreaterThan(12 * T);
  });

  it("a charged ollie clears a quarter pipe from behind, right over it", () => {
    // A free-standing quarter pipe in the open, its tall end to the east: ride at its back, westward.
    const p = park([{ kind: "sk_quarter", x: 12, y: 4, w: 3, h: 3, label: "e" }]);
    const s = new Skater(p, 19 * T, 5 * T + 16, steady());
    s.heading = Math.PI;
    s.speed = 200;
    run(s, 0.45, { ...NO_INPUT, pop: true });
    run(s, 1 / 120);
    const ev = run(s, 1.5);
    expect(ev.some((e) => e.t === "wall")).toBe(false);
    expect(s.x).toBeLessThan(12 * T);
  });
});

describe("dropping in and aiming", () => {
  it("rolls into a ramp from behind its tall end: over the coping and down", () => {
    const p = park([{ kind: "sk_quarter", x: 12, y: 4, w: 3, h: 3, label: "e" }]);
    const s = new Skater(p, 17 * T, 5 * T + 16, steady());
    s.heading = Math.PI;
    s.speed = 150;
    const ev = run(s, 1.2);
    expect(ev.some((e) => e.t === "wall")).toBe(false);
    expect(ev.some((e) => e.t === "trick" && e.name === "Drop In")).toBe(true);
    // Down its face and away west, faster than it came.
    expect(s.x).toBeLessThan(12 * T);
    expect(s.speed).toBeGreaterThan(150);
  });

  it("pops off a ramp the way the stick's held", () => {
    // Up the north quarter pipe, popping with the stick held east.
    const s = new Skater(park(), 6 * T, 2.6 * T, steady());
    s.heading = -Math.PI / 2;
    s.speed = 220;
    run(s, 0.1, { ...NO_INPUT, pop: true });
    run(s, 1 / 120, { ...NO_INPUT, x: 1 });
    expect(s.mode).toBe("air");
    expect(s.vx).toBeGreaterThan(150);
    expect(Math.abs(s.vy)).toBeLessThan(20);
  });

  it("held out over a quarter pipe's lip, flies on out of it", () => {
    const p = park();
    const s = new Skater(p, 6 * T, 6 * T, steady());
    s.heading = -Math.PI / 2;
    s.speed = 260;
    let out = false;
    run(s, 1.2, () => {
      out ||= s.mode === "air" && !s.air.vert && s.air.ramp && s.vy < -100;
      return { ...NO_INPUT, y: -1 };
    });
    expect(out).toBe(true);
  });
});

describe("a combo", () => {
  it("is its points times how many tricks, a trick done again worth half", () => {
    const c = new Combo();
    c.add("Kickflip", 100);
    c.add("50-50 Grind", 100);
    c.add("Kickflip", 100);
    expect(c.base).toBe(250);
    expect(c.total).toBe(750);
    expect(c.label).toBe("Kickflip + 50-50 Grind + Kickflip");
  });
});
