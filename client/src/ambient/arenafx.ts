// The sounds of the crowd's gifts in the arena, rendered sample by sample
// like the wheel's: wings beating up off the sand, a cork and a gulp and
// something magical going down, a shield humming up round you, the fury's
// growl, and (the best of them) that shield bursting like thick glass.

import { bar } from "./salvagesfx";
import { at, burst, hit, mode, pick, play, render, tone } from "./sfx";

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Adds a sine gliding from `f0` to `f1` Hz over `len` s, swelling in and dying away. */
function glide(d: Float32Array, sr: number, t0: number, len: number, f0: number, f1: number, amp: number) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(len * sr);
  let ph = 0;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const x = i / n;
    ph += (2 * Math.PI * f0 * Math.pow(f1 / f0, x)) / sr;
    d[start + i] += amp * Math.sin(Math.PI * Math.min(1, x * 1.1 + 0.01)) * Math.sin(ph);
  }
}

/** Adds a soft swell of noise (a wingbeat, a rush of air). */
function swell(d: Float32Array, sr: number, t0: number, len: number, amp: number, soft: number) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(len * sr);
  let lp = 0;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const x = i / n;
    lp += soft * (Math.random() * 2 - 1 - lp);
    d[start + i] += amp * Math.sin(Math.PI * x) ** 2 * lp * 3;
  }
}

function renderWings(): AudioBuffer {
  return render(0.85, (d, sr) => {
    // Three quick beats of feathered wings, each higher, lifting away.
    for (const [t, v] of [[0, 0.7], [0.14, 0.85], [0.28, 1]]) {
      swell(d, sr, t, 0.13, v, 0.12 + t * 0.2);
      hit(d, sr, t + 0.05, 0.015, 0.14 * v, 0.3);
    }
    swell(d, sr, 0.36, 0.45, 0.5, 0.42);
  });
}

/** Hermes' boots on: the wings beating, a bright run up. */
export function boots(vol = 1) {
  const t = at(0);
  play(pick("arena-wings", renderWings, 2), t, 0.5 * vol, { wet: 0.16 });
  [1047, 1319, 1568, 2093].forEach((hz, k) => bar(t + 0.22 + k * 0.045, hz, 0.1 * vol, (k - 1.5) * 0.15));
}

function renderPotion(): AudioBuffer {
  return render(1.1, (d, sr) => {
    // Pop goes the cork…
    glide(d, sr, 0, 0.04, 480, 1300, 0.9);
    hit(d, sr, 0, 0.004, 0.45, 0.85);
    // …and three deep gulps.
    for (const [t, hz] of [[0.2, 240], [0.4, 270], [0.6, 310]]) {
      glide(d, sr, t, 0.13, hz, hz * 1.9, 0.8);
      glide(d, sr, t + 0.1, 0.05, hz * 1.5, hz * 2.6, 0.2);
    }
  });
}

/** The potion down: gulp gulp, and something warm and magical beginning to work. */
export function potion(vol = 1) {
  const t = at(0);
  play(pick("arena-potion", renderPotion, 2), t, 0.46 * vol, { wet: 0.16 });
  [523, 622, 784, 932, 1245].forEach((hz, k) => bar(t + 0.62 + k * 0.075, hz, 0.1 * vol, Math.sin(k * 2) * 0.35));
  tone(t + 0.62, 1.1, 0.03 * vol, "sine", 311, 622);
  burst(t + 0.66, 0.8, 0.012 * vol, "highpass", 5000, 9000);
}

function renderShieldUp(): AudioBuffer {
  return render(0.9, (d, sr) => {
    // A field humming up out of nothing, a crystal chime as it closes.
    glide(d, sr, 0, 0.5, 110, 440, 0.8);
    glide(d, sr, 0, 0.5, 112, 660, 0.3);
    for (const [hz, tau, a] of [[1760, 0.4, 0.34], [2637, 0.32, 0.28], [3951, 0.2, 0.2], [5919, 0.1, 0.12]]) mode(d, sr, 0.36, hz, tau, a);
  });
}

/** The bubble closes round you. */
export function shieldUp(vol = 1) {
  play(pick("arena-shieldup", renderShieldUp, 2), at(0), 0.5 * vol, { wet: 0.24 });
}

function renderBurst(): AudioBuffer {
  return render(1.2, (d, sr) => {
    // The blow landing on it: a deep, soft WHUMP you feel…
    hit(d, sr, 0, 0.02, 0.8, 0.2);
    mode(d, sr, 0, 86, 0.1, 0.7);
    glide(d, sr, 0, 0.26, 240, 58, 0.6);
    // …the sharp CRACK of it going…
    hit(d, sr, 0, 0.003, 1, 0.95);
    for (const [hz, tau, a] of [[1940, 0.07, 0.42], [3130, 0.06, 0.4], [4720, 0.05, 0.34], [6410, 0.04, 0.28], [8200, 0.03, 0.2]]) mode(d, sr, 0, hz * rand(0.97, 1.03), tau, a);
    // …and a hundred bright shards raining down, thinning away.
    for (let k = 0; k < 42; k++) {
      const t = 0.015 + Math.pow(k / 42, 1.6) * 0.9;
      const v = 0.3 * Math.pow(1 - k / 46, 1.3) * rand(0.5, 1);
      mode(d, sr, t, rand(2400, 9600), rand(0.015, 0.06), v);
      if (k % 3 === 0) mode(d, sr, t, rand(9000, 13000), 0.012, v * 0.6);
    }
  });
}

/** The shield bursts: no harm done. */
export function shieldBurst(vol = 1) {
  const t = at(0);
  play(pick("arena-burst", renderBurst, 3), t, 0.7 * vol, { wet: 0.28 });
  bar(t + 0.03, 1568, 0.14 * vol);
  bar(t + 0.09, 2093, 0.12 * vol);
  bar(t + 0.15, 3136, 0.1 * vol);
}

function renderFury(): AudioBuffer {
  return render(1, (d, sr) => {
    // A rising, throaty growl, and a war drum.
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const hz = 62 + 62 * Math.min(1, t / 0.55);
      const rasp = 0.62 + 0.38 * Math.sin(2 * Math.PI * 31 * t);
      const saw = 2 * ((t * hz) % 1) - 1;
      d[i] += 0.5 * rasp * saw * Math.min(1, t * 12) * Math.exp(-Math.max(0, t - 0.5) / 0.13);
    }
    hit(d, sr, 0, 0.03, 0.9, 0.2);
    mode(d, sr, 0, 72, 0.14, 1);
    hit(d, sr, 0.17, 0.03, 0.7, 0.2);
    mode(d, sr, 0.17, 88, 0.13, 0.9);
  });
}

/** The fury's on you. */
export function fury(vol = 1) {
  play(pick("arena-fury", renderFury, 2), at(0), 0.44 * vol, { wet: 0.16, lowpass: 2400 });
}

// ---- blows landing ----

/** Grit and rubble: a run of tiny, random knocks. */
function rubble(d: Float32Array, sr: number, t0: number, n: number, gap: number, amp: number) {
  for (let k = 0; k < n; k++) {
    const t = t0 + k * gap * rand(0.6, 1.4);
    mode(d, sr, t, rand(700, 3200), rand(0.004, 0.012), amp * (1 - (k / n) * 0.7) * rand(0.5, 1));
  }
}

function renderWallSlam(): AudioBuffer {
  return render(1.1, (d, sr) => {
    // A body into stone: a deep, dead thump; stone cracking; bits raining down.
    mode(d, sr, 0, 62, 0.16, 1);
    mode(d, sr, 0, 118, 0.07, 0.7);
    hit(d, sr, 0, 0.012, 1, 0.5);
    hit(d, sr, 0.004, 0.03, 0.6, 0.12);
    swell(d, sr, 0.05, 0.5, 0.16, 0.3);
    rubble(d, sr, 0.09, 26, 0.024, 0.28);
  });
}

/** Slammed into the wall. */
export function wallSlam(vol = 1) {
  play(pick("arena-wall", renderWallSlam, 3), at(0), 0.75 * vol, { wet: 0.22 });
}

function renderGuard(): AudioBuffer {
  return render(0.5, (d, sr) => {
    // Steel on a braced shield: a bright clank, a hollow boom behind it.
    hit(d, sr, 0, 0.004, 0.9, 0.7);
    for (const [hz, tau, a] of [[1720, 0.09, 0.5], [2640, 0.06, 0.34], [3910, 0.04, 0.22], [5230, 0.02, 0.14]]) mode(d, sr, 0, hz * rand(0.97, 1.03), tau, a);
    mode(d, sr, 0, 210, 0.08, 0.6);
    mode(d, sr, 0, 96, 0.1, 0.5);
  });
}

/** A blow, taken on the shield. */
export function guard(vol = 1) {
  play(pick("arena-guard", renderGuard, 4), at(0), 0.42 * vol, { wet: 0.16 });
}

function renderParry(): AudioBuffer {
  return render(1.2, (d, sr) => {
    // A perfect catch: a high, ringing, satisfying bell of steel.
    hit(d, sr, 0, 0.003, 0.9, 0.8);
    for (const [hz, tau, a] of [[2093, 0.5, 0.34], [3142, 0.34, 0.24], [4186, 0.22, 0.2], [6280, 0.12, 0.12]]) mode(d, sr, 0, hz, tau, a);
    glide(d, sr, 0.02, 0.4, 900, 3200, 0.12);
  });
}

/** Parried, on the instant. */
export function parry(vol = 1) {
  play(pick("arena-parry", renderParry, 2), at(0), 0.5 * vol, { wet: 0.3 });
}

function renderGuardBreak(): AudioBuffer {
  return render(0.8, (d, sr) => {
    // The guard goes: a wooden crack, and pieces.
    hit(d, sr, 0, 0.008, 1, 0.45);
    mode(d, sr, 0, 340, 0.05, 0.8);
    mode(d, sr, 0.006, 720, 0.035, 0.6);
    mode(d, sr, 0, 90, 0.12, 0.8);
    rubble(d, sr, 0.04, 16, 0.02, 0.26);
  });
}

/** The guard's broken. */
export function guardBreak(vol = 1) {
  play(pick("arena-gbreak", renderGuardBreak, 2), at(0), 0.62 * vol, { wet: 0.16 });
}

function renderQuake(): AudioBuffer {
  return render(2, (d, sr) => {
    // A great weight landing: a chest-deep blow, the ground groaning under
    // it, sand hissing back down for a long moment after.
    mode(d, sr, 0, 44, 0.42, 1);
    mode(d, sr, 0, 74, 0.2, 0.8);
    mode(d, sr, 0, 136, 0.08, 0.5);
    hit(d, sr, 0, 0.02, 1, 0.3);
    swell(d, sr, 0.02, 0.9, 0.2, 0.05);
    swell(d, sr, 0.3, 1.5, 0.11, 0.55);
    rubble(d, sr, 0.15, 30, 0.04, 0.16);
  });
}

/** A stomp: the Goliath's, or a tank's. */
export function quake(vol = 1) {
  play(pick("arena-quake", renderQuake, 2), at(0), 0.85 * vol, { wet: 0.3 });
}

function renderKo(): AudioBuffer {
  return render(0.9, (d, sr) => {
    // Down, and out: a heavy drop, and a low bell of finality.
    mode(d, sr, 0, 58, 0.22, 1);
    hit(d, sr, 0, 0.018, 0.9, 0.25);
    mode(d, sr, 0.05, 220, 0.42, 0.22);
    mode(d, sr, 0.05, 331, 0.34, 0.14);
    swell(d, sr, 0.02, 0.4, 0.16, 0.2);
  });
}

/** Somebody's down. */
export function ko(vol = 1) {
  play(pick("arena-ko", renderKo, 2), at(0), 0.62 * vol, { wet: 0.32 });
}

/** Adds a ring that blooms rather than strikes: two sines `beat` Hz apart, so it shimmers. */
function shine(d: Float32Array, sr: number, t0: number, hz: number, tau: number, amp: number, beat: number) {
  const start = Math.floor(t0 * sr);
  const end = Math.min(d.length, start + Math.floor(tau * 7 * sr));
  const [p, q] = [rand(0, 2 * Math.PI), rand(0, 2 * Math.PI)];
  for (let i = start; i < end; i++) {
    const t = (i - start) / sr;
    const e = (1 - Math.exp(-t / 0.005)) * Math.exp(-t / tau);
    d[i] += (amp / 2) * e * (Math.sin(p + 2 * Math.PI * (hz - beat / 2) * t) + Math.sin(q + 2 * Math.PI * (hz + beat / 2) * t));
  }
}

function renderChargeFull(): AudioBuffer {
  return render(0.6, (d, sr) => {
    // Full: the light glinting off the blade.
    hit(d, sr, 0, 0.01, 0.4, 0.95);
    hit(d, sr, 0, 0.04, 0.1, 0.95);
    for (const [hz, tau, amp, beat] of [[4186, 0.108, 1, 5], [5920, 0.081, 0.6, 9], [7902, 0.054, 0.38, 13], [11175, 0.032, 0.18, 17]]) {
      shine(d, sr, 0, hz, tau, amp, beat);
    }
  });
}

/** Your charge is full. */
export function chargeFull(vol = 1) {
  play(pick("arena-full", renderChargeFull, 3), at(0), 0.2 * vol, { wet: 0.24 });
}

function renderBodyHit(): AudioBuffer {
  return render(0.36, (d, sr) => {
    // Under the blade's bite: weight going in.
    mode(d, sr, 0, 150, 0.06, 0.9);
    mode(d, sr, 0, 86, 0.09, 0.8);
    hit(d, sr, 0, 0.008, 0.7, 0.3);
  });
}

/** The thud under a blow. */
export function bodyHit(vol = 1) {
  play(pick("arena-body", renderBodyHit, 3), at(0), 0.42 * vol, { wet: 0.08 });
}

function renderFoot(): AudioBuffer {
  return render(0.5, (d, sr) => {
    mode(d, sr, 0, 52, 0.16, 1);
    swell(d, sr, 0.01, 0.2, 0.14, 0.3);
  });
}

/** The Goliath's tread. */
export function giantStep(vol = 1) {
  play(pick("arena-foot", renderFoot, 2), at(0), 0.3 * vol, { wet: 0.1 });
}
