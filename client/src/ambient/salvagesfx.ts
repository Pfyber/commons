// The sounds of spending money and of the magnet, synthesised like the rest
// and mostly rendered sample by sample, the way the real thing makes them.
// The till: keys clacking, the ratchet, the drawer slamming out, one struck
// bell and the coins settling (`sfx.cash`, money coming in, is a bright chime
// instead: you can hear which way the money went). The magnet: a heavy
// iron plunge with a cavity of air closing over it and a trail of bubbles,
// metal knocking on metal down in the murk, a ringing mallet for every
// reward (more of it, and higher, the rarer the thing), and the depths
// murmuring all through the dive.

import { at, burst, drone, hit, mode, pick, play, render, tone } from "./sfx";

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Adds a sine gliding from `f0` to `f1` Hz over `len` s, swelling in and dying away: a bubble, a gulp. */
function glide(d: Float32Array, sr: number, t0: number, len: number, f0: number, f1: number, amp: number) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(len * sr);
  let ph = Math.random() * Math.PI * 2;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const x = i / n;
    ph += (2 * Math.PI * f0 * Math.pow(f1 / f0, x)) / sr;
    d[start + i] += amp * Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15 + 0.02)), 0.7) * Math.exp(-2.4 * x) * Math.sin(ph);
  }
}

// ---- the till -------------------------------------------------------------------

function renderTill(): AudioBuffer {
  return render(1.9, (d, sr) => {
    // Two keys pressed, a hair apart: plastic on a sprung metal stalk.
    for (const [t, hz] of [[0, 1850], [0.062, 1640]]) {
      hit(d, sr, t, 0.005, 0.5, 0.85);
      mode(d, sr, t, hz + rand(-40, 40), 0.012, 0.22);
      mode(d, sr, t, 610, 0.02, 0.26);
    }
    // The lever's ratchet, gathering.
    for (let k = 0; k < 5; k++) {
      const t = 0.125 + k * 0.014;
      hit(d, sr, t, 0.003, 0.18 + k * 0.05, 0.92);
      mode(d, sr, t, 2700 + k * 180, 0.006, 0.12);
    }
    // KA-CHUNK: the drawer sprung out against its stop, felt in the chest.
    const slam = 0.2;
    hit(d, sr, slam, 0.045, 0.85, 0.22);
    hit(d, sr, slam, 0.008, 0.55, 0.9);
    mode(d, sr, slam, 94, 0.11, 0.95);
    mode(d, sr, slam, 186, 0.07, 0.55);
    mode(d, sr, slam, 417, 0.04, 0.34);
    mode(d, sr, slam, 1240, 0.018, 0.2);
    // CHING: one bell, struck twice by its bouncing clapper. A bell's own
    // out-of-tune partials are what make it ring true.
    const ching = slam + 0.012;
    for (const [dt, v] of [[0, 1], [0.074, 0.55]]) {
      const t = ching + dt;
      hit(d, sr, t, 0.002, 0.4 * v, 0.95);
      for (const [hz, tau, a] of [[1319, 0.62, 0.34], [2637, 0.48, 0.72], [3164, 0.34, 0.42], [3956, 0.22, 0.34], [5274, 0.15, 0.3], [7120, 0.08, 0.2]]) mode(d, sr, t, hz * rand(0.999, 1.001), tau, a * v);
    }
    // The coins shaken up, settling in their tray.
    for (let k = 0; k < 9; k++) {
      const t = slam + 0.09 + k * rand(0.03, 0.05);
      const v = 0.2 * (1 - k / 11);
      mode(d, sr, t, rand(3400, 6800), rand(0.02, 0.05), v);
      mode(d, sr, t, rand(7400, 9800), 0.012, v * 0.5);
    }
  });
}

function renderCoinPour(): AudioBuffer {
  return render(0.8, (d, sr) => {
    for (let k = 0; k < 24; k++) {
      const t = 0.7 * Math.pow(k / 24, 1.4) * rand(0.9, 1.05);
      const v = 0.4 * (1 - k / 30) * rand(0.5, 1);
      mode(d, sr, t, rand(3000, 7400), rand(0.02, 0.06), v);
      mode(d, sr, t, rand(7000, 10500), 0.015, v * 0.5);
    }
  });
}

/** Money out: KA-CHING! The till's keys, its drawer, its bell (a dearer thing gets a pour of coins too). */
export function till(price = 0, vol = 1) {
  const t = at(0);
  play(pick("till", renderTill, 3), t, 0.95 * vol, { wet: 0.16 });
  if (price >= 500) play(pick("coinpour", renderCoinPour, 2), t + 0.3, 0.3 * vol, { wet: 0.2 });
}

// ---- water -----------------------------------------------------------------------

function renderBubble(): AudioBuffer {
  return render(0.16, (d, sr) => {
    const hz = rand(380, 1150);
    glide(d, sr, 0, rand(0.05, 0.11), hz, hz * rand(1.5, 2.1), 1);
  });
}

function renderPlunk(): AudioBuffer {
  return render(2.5, (d, sr) => {
    // The slap of something heavy on the surface, and the spray thrown up.
    hit(d, sr, 0, 0.05, 0.7, 0.22);
    hit(d, sr, 0, 0.13, 0.26, 0.78);
    hit(d, sr, 0.05, 0.2, 0.15, 0.85);
    // Down it punches: a thump you feel…
    mode(d, sr, 0, 54, 0.2, 1);
    mode(d, sr, 0, 82, 0.12, 0.6);
    // …and the hole it tore in the water slamming shut: KER-PLOOMP.
    glide(d, sr, 0.03, 0.42, 92, 310, 1.05);
    glide(d, sr, 0.16, 0.3, 170, 520, 0.42);
    // Iron ringing dully, its chain clattering after it.
    mode(d, sr, 0.01, 880, 0.2, 0.14);
    mode(d, sr, 0.01, 1465, 0.13, 0.09);
    for (let k = 0; k < 7; k++) {
      const t = 0.06 + k * rand(0.045, 0.075);
      mode(d, sr, t, rand(2600, 4300), 0.022, 0.11 * (1 - k / 9));
      mode(d, sr, t, rand(900, 1300), 0.016, 0.08);
    }
    // A trail of bubbles racing back up from it as it sinks.
    for (let k = 0; k < 20; k++) {
      const t = 0.42 + Math.pow(k / 20, 1.3) * 1.75;
      const hz = rand(260, 900) * (1 + (k / 20) * 0.6);
      glide(d, sr, t, rand(0.04, 0.1), hz, hz * rand(1.4, 2), 0.3 * (1 - k / 24));
    }
  });
}

/** The magnet going in: far heavier than a bobber. `delayMs` from now. */
export function plunge(vol = 1, delayMs = 0) {
  play(pick("plunge", renderPlunk, 3), at(delayMs), 0.72 * vol, { wet: 0.22 });
}

function renderDive(): AudioBuffer {
  return render(1.7, (d, sr) => {
    // The murk closing over: a soft, deep rush…
    hit(d, sr, 0, 0.38, 0.5, 0.12);
    glide(d, sr, 0, 0.85, 210, 58, 0.8);
    mode(d, sr, 0.02, 62, 0.28, 0.5);
    // …and everything that came down with it, bubbling away.
    for (let k = 0; k < 16; k++) {
      const t = 0.05 + Math.pow(k / 16, 1.2) * 1.4;
      const hz = rand(240, 760);
      glide(d, sr, t, rand(0.05, 0.11), hz, hz * rand(1.4, 1.9), 0.3);
    }
  });
}

function renderDepths(): AudioBuffer {
  return render(6, (d, sr) => {
    // Deep slow noise: the sea's own weight. Its tail is folded into its
    // head, so it loops without a seam.
    const fade = Math.floor(sr * 0.8);
    const all = new Float32Array(d.length + fade);
    let a = 0;
    let b = 0;
    for (let i = 0; i < all.length; i++) {
      const n = Math.random() * 2 - 1;
      a += 0.012 * (n - a);
      b += 0.05 * (a - b);
      all[i] = a * 2.2 + b * 2;
    }
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      all[i] = all[i] * k + all[d.length + i] * (1 - k);
    }
    d.set(all.subarray(0, d.length));
  });
}

let depthsOff: (() => void) | null = null;

/** Down into the murk: the plunge's rush, then the depths murmuring until `surfacing`. */
export function dive() {
  const t = at(0);
  play(pick("dive", renderDive, 2), t, 0.5, { wet: 0.2 });
  depthsOff?.();
  depthsOff = drone(pick("depths", renderDepths, 1), 0.16, 420);
}

/** The depths fade away (the dive's over). */
export function surfacing() {
  depthsOff?.();
  depthsOff = null;
}

/** A bubble or two rising by the magnet. */
export function bubbles(vol = 1) {
  const t = at(0);
  const n = Math.random() < 0.3 ? 2 : 1;
  for (let k = 0; k < n; k++) play(pick("bubble", renderBubble, 6), t + k * rand(0.05, 0.12), 0.1 * vol, { pan: rand(-0.4, 0.4), wet: 0.3 });
}

// ---- the mallet: every reward's voice ----------------------------------------------

/** A hard mallet on a tuned steel bar, at C5: played at any pitch by `rate`. */
function renderBar(): AudioBuffer {
  return render(1.5, (d, sr) => {
    const hz = 523.25;
    hit(d, sr, 0, 0.003, 0.26, 0.9);
    mode(d, sr, 0, hz, 0.62, 1);
    mode(d, sr, 0, hz * 2, 0.34, 0.32);
    mode(d, sr, 0, hz * 3.01, 0.2, 0.34);
    mode(d, sr, 0, hz * 5.42, 0.09, 0.2);
    mode(d, sr, 0, hz * 8.3, 0.04, 0.1);
  });
}

export function bar(t: number, hz: number, level: number, pan = 0) {
  play(pick("bar", renderBar, 1), t, level, { rate: hz / 523.25, wet: 0.3, pan });
}

function renderCrash(): AudioBuffer {
  return render(2.2, (d, sr) => {
    hit(d, sr, 0, 0.5, 0.7, 0.92);
    hit(d, sr, 0, 0.05, 0.5, 0.75);
    for (let k = 0; k < 40; k++) mode(d, sr, 0, rand(2400, 11000), rand(0.2, 0.75), 0.05);
  });
}

function renderBoom(): AudioBuffer {
  return render(1.2, (d, sr) => {
    hit(d, sr, 0, 0.03, 0.5, 0.2);
    glide(d, sr, 0, 0.7, 130, 44, 1);
    mode(d, sr, 0, 55, 0.3, 0.8);
  });
}

/** Up a major scale, further and higher the rarer: what each rarity's reward plays. */
const RUNS: number[][] = [
  [784, 1047],
  [659, 784, 1047, 1319],
  [523, 659, 784, 1047, 1319, 1568],
  [523, 659, 784, 1047, 1319, 1568, 2093],
  [392, 523, 659, 784, 1047, 1319, 1568, 2093, 2637],
  [392, 523, 659, 784, 1047, 1319, 1568, 2093, 2637, 3136, 3951],
];
/** The chord it lands on. */
const CHORDS: number[][] = [[], [1319], [1047, 1568], [784, 1047, 1568], [523, 784, 1047, 1568, 2093], [523, 784, 1047, 1319, 1568, 2093, 2637]];

/** A reward as good as rarity `r`: a run of the mallet, a chord, and (at the top) the sky falling in. */
function reward(t: number, r: number, vol: number) {
  const gap = r >= 4 ? 0.05 : 0.06;
  const run = RUNS[r];
  run.forEach((hz, k) => bar(t + k * gap, hz, (0.2 + (k / run.length) * 0.08) * vol, (k / run.length - 0.5) * 0.6));
  const land = t + run.length * gap;
  for (const hz of CHORDS[r]) {
    bar(land, hz, 0.14 * vol);
    tone(land, 0.7 + r * 0.22, (0.022 + r * 0.004) * vol, "triangle", hz);
  }
  if (r >= 2) burst(t, 0.25 + run.length * gap, (0.016 + r * 0.005) * vol, "highpass", 3200, 9500);
  if (r >= 3) play(pick("boom", renderBoom, 1), land, (0.26 + (r - 3) * 0.14) * vol, { wet: 0.2 });
  if (r >= 4) play(pick("crash", renderCrash, 2), land, (0.1 + (r - 4) * 0.08) * vol, { wet: 0.35 });
  if (r >= 5) {
    // Mythical: it rings out again an octave up, climbing away.
    [2093, 2637, 3136, 3951, 4186].forEach((hz, k) => bar(land + 0.26 + k * 0.07, hz, 0.12 * vol));
    play(pick("boom", renderBoom, 1), land + 0.26, 0.3 * vol, { wet: 0.2 });
  }
}

// ---- the find: the reel game -----------------------------------------------------

function renderFound(): AudioBuffer {
  return render(1.1, (d, sr) => {
    // Magnet on metal, a long way down: a muffled CLONK that hums.
    hit(d, sr, 0, 0.012, 0.6, 0.35);
    for (const [hz, tau, a] of [[196, 0.26, 0.9], [412, 0.2, 0.6], [867, 0.12, 0.4], [1411, 0.07, 0.2]]) mode(d, sr, 0, hz, tau, a);
    hit(d, sr, 0.075, 0.01, 0.25, 0.3);
    mode(d, sr, 0.075, 208, 0.14, 0.4);
    // The field catching hold, rising.
    glide(d, sr, 0.1, 0.5, 260, 1120, 0.3);
  });
}

/** The magnet's found something! */
export function found(vol = 1) {
  play(pick("found", renderFound, 3), at(0), 0.6 * vol, { wet: 0.28 });
}

function renderSnap(): AudioBuffer {
  return render(0.32, (d, sr) => {
    // Iron snapping to a magnet: a hard, short, deeply good CLACK.
    hit(d, sr, 0, 0.004, 0.9, 0.9);
    hit(d, sr, 0, 0.02, 0.5, 0.3);
    for (const [hz, tau, a] of [[310, 0.05, 0.7], [1180, 0.03, 0.5], [2950, 0.018, 0.4], [5400, 0.01, 0.3]]) mode(d, sr, 0, hz, tau, a);
  });
}

/** The needle stopped on rarity `r`; `middle`: the hard zone. The rarer, the happier. */
export function reelHit(r: number, middle: boolean) {
  const t = at(0);
  const rr = Math.max(0, Math.min(5, r));
  play(pick("snap", renderSnap, 3), t, 0.5, { wet: 0.12 });
  reward(t + 0.03, rr, 1);
  // Nailed the middle: one clear ting on top of it all.
  if (middle && rr > 0) bar(t + 0.03, 2093 * Math.pow(1.122, rr), 0.13);
}

function renderSlip(): AudioBuffer {
  return render(0.9, (d, sr) => {
    glide(d, sr, 0, 0.5, 340, 95, 0.9);
    for (let k = 0; k < 9; k++) {
      const t = 0.03 + k * rand(0.04, 0.06);
      mode(d, sr, t, rand(1700 - k * 90, 3100 - k * 140), 0.02, 0.16 * (1 - k / 11));
    }
    glide(d, sr, 0.44, 0.08, 420, 760, 0.22);
    glide(d, sr, 0.58, 0.07, 340, 640, 0.14);
  });
}

/** It slipped the magnet: the chain rattling away, a glug. */
export function reelMiss() {
  play(pick("slip", renderSlip, 2), at(0), 0.5, { wet: 0.25 });
}

// ---- the dive --------------------------------------------------------------------

/** The magnet's hum, pulling at something: `k` 0–1 how near it is to coming free. Played again and again. */
export function hum(k: number) {
  const t = at(0);
  const hz = 62 + k * 44;
  tone(t, 0.17, 0.07 + k * 0.04, "sawtooth", hz, hz * 1.02);
  tone(t, 0.17, 0.05 + k * 0.03, "sawtooth", hz * 1.504, hz * 1.52);
  tone(t, 0.14, 0.02 + k * 0.03, "sine", 340 + k * 980, 360 + k * 1040);
  // It crackles as it strains.
  if (Math.random() < 0.3 + k * 0.5) burst(t + rand(0, 0.08), 0.02, 0.018 + k * 0.03, "bandpass", rand(2600, 6200), rand(2600, 6200), 6);
}

function renderPop(): AudioBuffer {
  return render(0.75, (d, sr) => {
    // Sucked out of the mud…
    hit(d, sr, 0, 0.08, 0.4, 0.3);
    glide(d, sr, 0, 0.17, 170, 880, 0.9);
    // …POP, up it flies…
    glide(d, sr, 0.16, 0.05, 620, 1650, 0.8);
    // …CLANG, onto the magnet.
    const c = 0.25;
    hit(d, sr, c, 0.004, 0.75, 0.9);
    for (const [hz, tau, a] of [[318, 0.12, 0.6], [742, 0.09, 0.5], [1490, 0.07, 0.42], [2710, 0.05, 0.3], [4300, 0.03, 0.2]]) mode(d, sr, c, hz, tau, a);
  });
}

/** Free of the mud and onto the magnet! The rarer, the finer. */
export function pulledFree(r: number, real: boolean) {
  const t = at(0);
  play(pick("pop", renderPop, 3), t, 0.56, { wet: 0.2 });
  if (real) reward(t + 0.27, Math.max(0, Math.min(5, r)), 0.72);
  else bar(t + 0.27, 1047, 0.13);
}

function renderClick(): AudioBuffer {
  return render(0.05, (d, sr) => {
    hit(d, sr, 0, 0.003, 0.8, 0.88);
    mode(d, sr, 0, 2300, 0.006, 0.6);
    mode(d, sr, 0, 640, 0.008, 0.4);
  });
}

/** The winch's pawl, ticking over: lower and slower-sounding the heavier the load. */
export function winch(load: number) {
  play(pick("click", renderClick, 3), at(0), 0.12 + load * 0.04, { rate: rand(0.96, 1.04) / (1 + load * 0.3), lowpass: 5200 - load * 1100 });
}

function renderBump(): AudioBuffer {
  return render(0.5, (d, sr) => {
    hit(d, sr, 0, 0.06, 0.8, 0.14);
    mode(d, sr, 0, 74, 0.09, 0.8);
    mode(d, sr, 0, 171, 0.05, 0.3);
    for (let k = 0; k < 5; k++) {
      const hz = rand(190, 420);
      glide(d, sr, 0.04 + k * 0.06, 0.08, hz, hz * 1.5, 0.12);
    }
  });
}

/** Bump: the magnet settling in the mud. */
export function touchdown() {
  play(pick("bump", renderBump, 3), at(0), 0.3, { wet: 0.2 });
}

/** Something rare glinting on the bottom, across the water (`pan`). */
export function glint(r: number, pan: number) {
  const t = at(0);
  const hz = [0, 0, 2093, 2349, 2637, 3136][Math.min(5, r)] ?? 2093;
  bar(t, hz, 0.024 + r * 0.008, pan);
  bar(t + 0.07, hz * 1.5, 0.018 + r * 0.006, pan);
}

/** The clock's last seconds: a wood block, tighter as it runs out (`left` s). */
export function lastSeconds(left: number) {
  const t = at(0);
  const hz = 880 + (5 - left) * 90;
  tone(t, 0.05, 0.06, "square", hz, hz * 0.96);
  tone(t, 0.09, 0.05, "sine", hz / 2, hz / 2.1);
}

// ---- losing it -------------------------------------------------------------------

function renderWhack(): AudioBuffer {
  return render(0.5, (d, sr) => {
    // A big fish, full tilt into the chain.
    hit(d, sr, 0, 0.03, 0.9, 0.3);
    mode(d, sr, 0, 120, 0.09, 0.8);
    glide(d, sr, 0.01, 0.24, 290, 110, 0.5);
    for (let k = 0; k < 5; k++) mode(d, sr, 0.03 + k * 0.05, rand(1800, 3400), 0.02, 0.2);
  });
}

function renderSnip(): AudioBuffer {
  return render(0.42, (d, sr) => {
    // Snip-SNAP: a pincer on the chain.
    for (const [t, v] of [[0, 0.65], [0.13, 1]]) {
      hit(d, sr, t, 0.004, 0.8 * v, 0.9);
      for (const [hz, tau, a] of [[1640, 0.024, 0.5], [3280, 0.016, 0.42], [640, 0.03, 0.3]]) mode(d, sr, t, hz * rand(0.96, 1.04), tau, a * v);
    }
  });
}

function renderZap(): AudioBuffer {
  return render(0.55, (d, sr) => {
    // A jellyfish's sting: a buzzing, spitting zap.
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const buzz = Math.sign(Math.sin(2 * Math.PI * (118 + 40 * Math.sin(t * 90)) * t));
      const gate = Math.sin(2 * Math.PI * 31 * t) > -0.3 ? 1 : 0.15;
      d[i] += Math.exp(-t / 0.17) * gate * (0.55 * buzz + 0.5 * (Math.random() * 2 - 1));
    }
  });
}

function renderSink(): AudioBuffer {
  return render(1.3, (d, sr) => {
    // The lot falling away: chain running out, sinking into silence.
    for (let k = 0; k < 11; k++) {
      const t = k * (0.05 + k * 0.006);
      mode(d, sr, t, rand(1500, 2900) - k * 70, 0.022, 0.2 * (1 - k / 13));
    }
    glide(d, sr, 0.06, 0.9, 230, 66, 0.55);
    for (let k = 0; k < 6; k++) {
      const hz = rand(240, 560);
      glide(d, sr, 0.26 + k * 0.13, 0.08, hz, hz * 1.6, 0.14);
    }
  });
}

/** It's all lost: what hit you (`fish`, `crab`, `jelly`, or the clock), and the catch sinking away. */
export function lost(by: "fish" | "crab" | "jelly" | "time") {
  const t = at(0);
  if (by === "fish") play(pick("whack", renderWhack, 3), t, 0.58, { wet: 0.2 });
  else if (by === "crab") play(pick("snip", renderSnip, 3), t, 0.5, { wet: 0.2 });
  else if (by === "jelly") play(pick("zap", renderZap, 2), t, 0.34, { wet: 0.15, lowpass: 5200 });
  else tone(t, 0.55, 0.07, "triangle", 330, 196);
  play(pick("sink", renderSink, 2), t + 0.1, 0.46, { wet: 0.25 });
  // Two falling, rueful notes.
  bar(t + 0.42, 392, 0.12);
  bar(t + 0.62, 311, 0.12);
}

// ---- the prize -------------------------------------------------------------------

function renderBreach(): AudioBuffer {
  return render(1.1, (d, sr) => {
    // Bursting up through the surface, the water sheeting off it.
    glide(d, sr, 0, 0.26, 150, 480, 0.75);
    hit(d, sr, 0.05, 0.14, 0.42, 0.72);
    hit(d, sr, 0.1, 0.3, 0.2, 0.85);
    for (let k = 0; k < 15; k++) {
      const t = 0.14 + k * rand(0.03, 0.06);
      const hz = rand(700, 2400);
      glide(d, sr, t, 0.035, hz, hz * 1.5, 0.15 * (1 - k / 17));
    }
  });
}

/** Up it comes! The surface breaks, and a reward as good as the best thing on the chain. */
export function surfaced(r: number, pieces: number) {
  const t = at(0);
  play(pick("breach", renderBreach, 3), t, 0.56, { wet: 0.22 });
  reward(t + 0.16, Math.max(0, Math.min(5, r)), 1);
  // A greedy haul: a clink for each thing on the chain.
  for (let k = 1; k < pieces; k++) bar(t + 0.3 + k * 0.1, 2637 + k * 240, 0.08, k % 2 ? 0.3 : -0.3);
}

// ---- the magnet lure ---------------------------------------------------------------

/** The magnet lure going in: a plop, and a strange purple shimmer spreading (whole tones, climbing). */
export function magnetLure(vol = 1, delayMs = 0) {
  const t = at(delayMs);
  play(pick("bubble", renderBubble, 6), t, 0.28 * vol, { wet: 0.3 });
  play(pick("found", renderFound, 3), t, 0.2 * vol, { wet: 0.3, rate: 1.5 });
  [622, 698, 784, 880, 988, 1109, 1245, 1397].forEach((hz, k) => bar(t + 0.1 + k * 0.07, hz * 2, (0.09 - k * 0.005) * vol, Math.sin(k) * 0.5));
  burst(t + 0.1, 0.9, 0.012 * vol, "highpass", 5000, 10000);
}
