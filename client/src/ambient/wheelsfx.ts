// The wheel of classes' sounds, mostly rendered sample by sample: the spring
// wound back and let go, the air it stirs, a real flapper snapping off every
// peg (each class with a note of its own as it comes under the pointer, the
// last few pegs thudding like a heartbeat), the heavy clunk of it stopping,
// and a sting for whichever class it gave you: a sword drawn, a bow loosed,
// a fuse and a bomb, a spear thrust, an armoured stamp.

import { bar } from "./salvagesfx";
import { at, burst, crowdRoar, hit, mode, pick, play, render, tone } from "./sfx";

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Adds a sine gliding from `f0` to `f1` Hz over `len` s, fading from the start. */
function sweep(d: Float32Array, sr: number, t0: number, len: number, f0: number, f1: number, amp: number) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(len * sr);
  let ph = 0;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const x = i / n;
    ph += (2 * Math.PI * f0 * Math.pow(f1 / f0, x)) / sr;
    d[start + i] += amp * Math.min(1, x * 40) * Math.pow(1 - x, 1.6) * Math.sin(ph);
  }
}

/** Adds noise swelling up and away (a blade drawn, air split): `bright` 0–1. */
function swell(d: Float32Array, sr: number, t0: number, len: number, amp: number, bright: number) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(len * sr);
  let lp = 0;
  const k = 0.04 + bright * 0.5;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const x = i / n;
    const w = Math.random() * 2 - 1;
    lp += k * (w - lp);
    d[start + i] += amp * Math.sin(Math.PI * x) ** 2 * (bright > 0.6 ? w - lp : lp * 2);
  }
}

// ---- the spin ---------------------------------------------------------------------

function renderWindup(): AudioBuffer {
  return render(0.7, (d, sr) => {
    // Hauled back against its spring, the pawl clicking home, tighter and tighter.
    for (let k = 0; k < 9; k++) {
      const t = 0.5 * (1 - Math.pow(1 - k / 9, 1.5));
      hit(d, sr, t, 0.003, 0.5 + k * 0.03, 0.9);
      mode(d, sr, t, 1200 + k * 170, 0.009, 0.3);
      mode(d, sr, t, 300 + k * 30, 0.018, 0.35);
    }
    sweep(d, sr, 0, 0.62, 95, 300, 0.4);
  });
}

/** Wound back. */
export function windup() {
  play(pick("wheel-wind", renderWindup, 2), at(0), 0.5, { wet: 0.12 });
}

function renderRelease(): AudioBuffer {
  return render(0.8, (d, sr) => {
    // SPROING: the spring let go, the whole wheel lurching off.
    hit(d, sr, 0, 0.006, 0.8, 0.85);
    hit(d, sr, 0, 0.04, 0.6, 0.25);
    sweep(d, sr, 0, 0.5, 420, 120, 0.9);
    sweep(d, sr, 0, 0.32, 840, 230, 0.32);
    mode(d, sr, 0, 72, 0.13, 0.7);
  });
}

/** Let go: the lurch, and the rush of air and the rumble dying away over `secs`. */
export function release(secs: number) {
  const t = at(0);
  play(pick("wheel-release", renderRelease, 2), t, 0.5, { wet: 0.16 });
  burst(t, secs * 0.62, 0.07, "bandpass", 1500, 260, 0.8);
  burst(t, secs * 0.4, 0.03, "highpass", 5200, 2000);
  tone(t, secs * 0.7, 0.05, "triangle", 74, 36);
}

function renderPeg(): AudioBuffer {
  return render(0.09, (d, sr) => {
    // The flapper snapping off a peg: a dry tick, the leather's slap, the
    // rim's wood answering underneath.
    hit(d, sr, 0, 0.0025, 0.8, 0.92);
    hit(d, sr, 0.001, 0.008, 0.4, 0.4);
    mode(d, sr, 0, rand(3200, 3700), 0.005, 0.42);
    mode(d, sr, 0, rand(1560, 1800), 0.011, 0.5);
    mode(d, sr, 0, rand(580, 660), 0.02, 0.42);
    mode(d, sr, 0, 245, 0.024, 0.3);
  });
}

function renderBeat(): AudioBuffer {
  return render(0.4, (d, sr) => {
    hit(d, sr, 0, 0.022, 0.5, 0.15);
    sweep(d, sr, 0, 0.24, 96, 50, 1);
    mode(d, sr, 0, 58, 0.09, 0.7);
  });
}

/** Each class's own note, as it comes under the pointer (a major pentatonic, so any run of them sings). */
const NOTES = [523.25, 659.25, 783.99, 880, 1046.5];

/**
 * A peg past the pointer: `speed` 1 flat out … 0 all but stopped, `kit` the
 * class now under it, `left` how many pegs are left to go. A quick dry
 * rattle at speed; slow, a deep satisfying clack with the class's note ringing
 * in it; the last few with a heartbeat under them.
 */
export function peg(speed: number, kit: number, left: number, delayMs = 0) {
  const t = at(delayMs);
  const s = Math.max(0, Math.min(1, speed));
  play(pick("wheel-peg", renderPeg, 5), t, 0.2 + (1 - s) * 0.34, { rate: (0.78 + s * 0.5) * rand(0.98, 1.02), wet: 0.08 + (1 - s) * 0.1, pan: rand(-0.06, 0.06) });
  if (s < 0.5) bar(t, NOTES[kit % NOTES.length], 0.03 + (0.5 - s) * 0.24);
  if (left <= 3.5) play(pick("wheel-beat", renderBeat, 1), t, 0.34 + (3.5 - left) * 0.1, { wet: 0.12 });
}

function renderClunk(): AudioBuffer {
  return render(0.6, (d, sr) => {
    // The brake biting and the pawl dropping home: CLUNK.
    hit(d, sr, 0, 0.005, 0.8, 0.88);
    hit(d, sr, 0, 0.05, 0.8, 0.2);
    for (const [hz, tau, a] of [[84, 0.14, 1], [176, 0.09, 0.55], [388, 0.05, 0.4], [1020, 0.02, 0.25]]) mode(d, sr, 0, hz, tau, a);
    hit(d, sr, 0.075, 0.004, 0.25, 0.88);
    mode(d, sr, 0.075, 1420, 0.012, 0.2);
  });
}

// ---- the class ---------------------------------------------------------------------

function renderKnight(): AudioBuffer {
  return render(1.3, (d, sr) => {
    // A sword drawn from its scabbard: SHIIING.
    swell(d, sr, 0, 0.26, 0.55, 0.9);
    for (const [hz, tau, a] of [[2214, 0.42, 0.7], [3351, 0.34, 0.55], [4780, 0.22, 0.42], [6280, 0.13, 0.32], [8120, 0.07, 0.2]]) mode(d, sr, 0.2, hz, tau, a);
    hit(d, sr, 0.2, 0.004, 0.4, 0.92);
  });
}

function renderArcher(): AudioBuffer {
  return render(1.1, (d, sr) => {
    // The bowstring: TWANG…
    hit(d, sr, 0, 0.004, 0.6, 0.85);
    sweep(d, sr, 0, 0.26, 470, 196, 1);
    sweep(d, sr, 0, 0.2, 940, 392, 0.4);
    // …the arrow…
    swell(d, sr, 0.04, 0.28, 0.32, 0.8);
    // …THOCK, dead in the target.
    hit(d, sr, 0.33, 0.012, 0.7, 0.5);
    mode(d, sr, 0.33, 390, 0.06, 0.6);
    mode(d, sr, 0.33, 910, 0.03, 0.4);
    sweep(d, sr, 0.33, 0.2, 170, 140, 0.25);
  });
}

function renderBomber(): AudioBuffer {
  return render(1.7, (d, sr) => {
    // The fuse fizzing…
    const n = Math.floor(0.34 * sr);
    for (let i = 0; i < n; i++) d[i] += (Math.random() * 2 - 1) * 0.2 * (Math.random() < 0.45 ? 1 : 0.15) * (i / n);
    // …BOOM, and the rumble rolling on.
    const b = 0.35;
    hit(d, sr, b, 0.12, 1, 0.14);
    hit(d, sr, b, 0.03, 0.5, 0.8);
    sweep(d, sr, b, 1, 150, 36, 1.2);
    mode(d, sr, b, 48, 0.32, 0.9);
  });
}

function renderSpearman(): AudioBuffer {
  return render(0.95, (d, sr) => {
    // A thrust: the air split, the steel point ringing as it strikes.
    swell(d, sr, 0, 0.17, 0.55, 0.45);
    hit(d, sr, 0.16, 0.006, 0.8, 0.85);
    for (const [hz, tau, a] of [[1370, 0.2, 0.6], [2240, 0.14, 0.5], [3610, 0.09, 0.38], [5100, 0.05, 0.25]]) mode(d, sr, 0.16, hz, tau, a);
    mode(d, sr, 0.16, 140, 0.08, 0.5);
  });
}

function renderTank(): AudioBuffer {
  return render(1.3, (d, sr) => {
    // Two armoured stamps, shaking the sand, plate clanking on plate.
    for (const [t, v] of [[0, 0.8], [0.26, 1]]) {
      hit(d, sr, t, 0.05, 0.9 * v, 0.14);
      sweep(d, sr, t, 0.42, 112, 40, 1.1 * v);
      for (const [hz, tau, a] of [[405, 0.09, 0.36], [920, 0.07, 0.3], [1630, 0.05, 0.24], [2520, 0.03, 0.15]]) mode(d, sr, t + 0.012, hz * rand(0.97, 1.03), tau, a * v);
    }
  });
}

const STINGS = [renderKnight, renderArcher, renderBomber, renderSpearman, renderTank];
/** How long after the clunk each class's own moment lands (the run waits for it). */
const STING_MS = [0.3, 0.42, 0.58, 0.26, 0.42];
/** The rising run each class gets, its key its own (from its note). */
const RUN = [1, 1.25, 1.5, 2, 2.5, 3];

function renderPop(): AudioBuffer {
  return render(0.4, (d, sr) => {
    // The confetti cannon.
    hit(d, sr, 0, 0.01, 0.8, 0.8);
    hit(d, sr, 0, 0.03, 0.5, 0.3);
    swell(d, sr, 0.02, 0.33, 0.25, 0.85);
  });
}

/** It's stopped on class `kit`: the clunk, its sting, the confetti, a run up the scale and the crowd. */
export function landed(kit: number) {
  const t = at(0);
  play(pick("wheel-clunk", renderClunk, 2), t, 0.72, { wet: 0.18 });
  const k = Math.max(0, Math.min(STINGS.length - 1, kit));
  play(pick(`wheel-sting-${k}`, STINGS[k], 2), t + 0.05, 0.6, { wet: 0.24 });
  const go = t + 0.05 + STING_MS[k];
  play(pick("wheel-pop", renderPop, 2), go, 0.36, { wet: 0.2 });
  const root = NOTES[k];
  RUN.forEach((m, i) => bar(go + i * 0.062, root * m, 0.17 + i * 0.012, (i / RUN.length - 0.5) * 0.7));
  const land = go + RUN.length * 0.062;
  for (const m of [1, 1.25, 1.5, 2]) {
    bar(land, root * m, 0.12);
    tone(land, 1, 0.022, "triangle", root * m);
  }
  burst(go, 0.8, 0.02, "highpass", 4000, 10000);
  // (The crowd's heard over it all, from a moment after.)
  window.setTimeout(() => crowdRoar(0.5), 180);
}
