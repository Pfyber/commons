// The arcade's sound effects: little chiptune blips and booms, like the
// cabinets they come out of. Built on the shared effects (ambient/sfx), so
// the HUD's mute silences them too.

import { at, burst, tone } from "../ambient/sfx";

const sq = (t: number, len: number, level: number, from: number, to = from) => tone(t, len, level, "square", from, to);

/** Countdown: a short beep for 3, 2, 1, a higher one for GO. */
export function count(go: boolean) {
  const t = at(0);
  sq(t, go ? 0.28 : 0.12, 0.06, go ? 1046 : 523);
}

/** A game won (by you), lost, or just over (watching, or a draw). */
export function ending(kind: "win" | "lose" | "over") {
  const t = at(0);
  const notes = kind === "win" ? [523, 659, 784, 1046] : kind === "lose" ? [392, 330, 262, 196] : [523, 392];
  notes.forEach((hz, i) => sq(t + i * 0.11, i === notes.length - 1 ? 0.35 : 0.1, 0.06, hz));
}

/** Your turn in a turn-by-turn game. */
export function yourTurn() {
  const t = at(0);
  tone(t, 0.12, 0.05, "triangle", 880);
  tone(t + 0.08, 0.16, 0.05, "triangle", 1320);
}

// ---- pong ----

export function paddle(side: number) {
  sq(at(0), 0.06, 0.07, side ? 494 : 440);
}

export function wall() {
  sq(at(0), 0.04, 0.05, 330);
}

export function point(mine: boolean) {
  const t = at(0);
  if (mine) {
    sq(t, 0.08, 0.06, 660);
    sq(t + 0.08, 0.14, 0.06, 990);
  } else {
    sq(t, 0.2, 0.06, 220, 110);
  }
}

// ---- light cycles ----

export function turn() {
  sq(at(0), 0.03, 0.03, 700);
}

export function crash() {
  const t = at(0);
  burst(t, 0.45, 0.25, "lowpass", 2200, 200);
  sq(t, 0.3, 0.05, 180, 50);
}

// ---- connect four & memory ----

/** A disc dropping down a column and landing. */
export function disc() {
  const t = at(0);
  tone(t, 0.12, 0.05, "triangle", 900, 300);
  burst(t + 0.1, 0.05, 0.12, "bandpass", 1200, 800, 3);
}

export function flip() {
  burst(at(0), 0.04, 0.1, "highpass", 3000);
  tone(at(0), 0.05, 0.03, "triangle", 1200, 1600);
}

export function match() {
  const t = at(0);
  [784, 988, 1318].forEach((hz, i) => tone(t + i * 0.07, 0.2, 0.05, "triangle", hz));
}

export function mismatch() {
  sq(at(0), 0.18, 0.04, 196, 165);
}

// ---- contests ----

/** Basket catch: a fruit (bigger for the star), or something nasty. */
export function caught(kind: number) {
  const t = at(0);
  if (kind === 2) {
    sq(t, 0.18, 0.06, 160, 90);
    return;
  }
  sq(t, 0.06, 0.05, kind === 1 ? 1046 : 784);
  sq(t + 0.06, 0.1, 0.05, kind === 1 ? 1568 : 1046);
}

/** Turbo racer: a car hit. */
export function bump() {
  const t = at(0);
  burst(t, 0.3, 0.2, "lowpass", 1500, 250);
  sq(t, 0.18, 0.04, 150, 70);
}

export function laneHop() {
  burst(at(0), 0.08, 0.04, "bandpass", 1800, 3200, 2);
}

/** Dance off: a step landed (a crisp tick), or a stray press. */
export function step(good: boolean) {
  const t = at(0);
  if (good) burst(t, 0.03, 0.12, "highpass", 5000);
  else sq(t, 0.08, 0.04, 140);
}

// ---- tanks ----

export function fire() {
  const t = at(0);
  burst(t, 0.25, 0.2, "lowpass", 3000, 300);
  sq(t, 0.08, 0.05, 220, 80);
}

export function boom() {
  const t = at(0);
  burst(t, 0.6, 0.3, "lowpass", 1800, 120);
  sq(t, 0.4, 0.06, 120, 40);
}

/** A shell spent against a wall. */
export function thud() {
  burst(at(0), 0.08, 0.08, "lowpass", 900, 300);
}

// ---- pinball ----

/** A flipper snapping up. */
export function flipper() {
  const t = at(0);
  burst(t, 0.04, 0.12, "bandpass", 1600, 900, 2);
  sq(t, 0.03, 0.03, 260, 180);
}

/** A bumper kicking the ball away: a springy "boing" with a bell on top. */
export function bumper(i: number) {
  const t = at(0);
  const base = [523, 659, 784, 659, 784, 880, 880, 1046, 1046][i] ?? 659;
  tone(t, 0.18, 0.06, "triangle", base, base * 1.5);
  sq(t, 0.05, 0.035, base * 2);
  burst(t, 0.03, 0.06, "highpass", 4000);
}
