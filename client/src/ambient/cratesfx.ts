// The daily crate's sounds, synthesised like the rest, but rich: everything
// rings out in the room (the effects' echo), and it's built from a few
// pieces layered up: a bell (a sine with its glassy overtones), sparkles
// (quick high pings scattered left and right), a thump (a falling sub and a
// dark puff), a whoosh (noise swept up), and a pad (a soft held chord).
//
// The crate lands with a thump and a twinkle; each tap knocks its wood (a
// hollow, resonant knock, the latch rattling, a hum rising a step each time);
// it bursts open with a boom, a whoosh and a run of bells, bigger the rarer
// the best thing inside. Each card, tapped, charges up (a rising swell and
// ticks, longer and tenser the rarer it is) and turns over with a pop and a
// bell, a fanfare for a legendary. All three seen: a ta-da; collecting: a
// whoosh up and a cascade.

import { coins } from "./casinosfx";
import { at, hiss, ring } from "./sfx";

/** C major, going up from C5. */
const C = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98, 1760, 1975.53, 2093, 2349.32, 2637.02];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A bell: the note, its octave, and the glassy overtones a struck bell has. */
function bell(t: number, hz: number, len: number, lvl: number, pan = 0, wet = 0.45) {
  ring(t, len, lvl, "sine", hz, hz, pan, wet);
  ring(t, len * 0.6, lvl * 0.35, "sine", hz * 2, hz * 2, pan, wet);
  ring(t, len * 0.35, lvl * 0.16, "sine", hz * 2.76, hz * 2.76, pan, wet);
  ring(t, 0.12, lvl * 0.1, "triangle", hz * 5.4, hz * 5.4, pan, wet);
}

/** Sparkles: `n` quick high pings over `over` seconds, scattered left and right. */
function sparkle(t: number, n: number, over: number, lvl: number) {
  for (let k = 0; k < n; k++) {
    const dt = Math.random() * over;
    const hz = rnd(2600, 7200);
    ring(t + dt, rnd(0.06, 0.14), lvl * rnd(0.5, 1), "triangle", hz, hz * 1.01, rnd(-0.8, 0.8), 0.6);
  }
}

/** A thump: a sub falling away and a dark puff of air. */
function thump(t: number, lvl: number) {
  ring(t, 0.5, lvl, "sine", 140, 36, 0, 0.15);
  ring(t, 0.7, lvl * 0.55, "sine", 58, 42, 0, 0.1);
  hiss(t, 0.22, lvl * 0.6, "lowpass", 900, 90, 0.7, 0, 0.2);
}

/** A whoosh: noise swept up (or down), swelling in. */
function whoosh(t: number, len: number, lvl: number, from = 300, to = 6000) {
  hiss(t, len, lvl, "bandpass", from, to, 1.3, 0, 0.45, len * 0.6);
}

/** A pad: a soft chord held, swelling in (each note two voices, a hair apart). */
function pad(t: number, len: number, notes: number[], lvl: number, wet = 0.6) {
  notes.forEach((hz, k) => {
    const pan = notes.length > 1 ? (k / (notes.length - 1)) * 1.2 - 0.6 : 0;
    ring(t, len, lvl, "triangle", hz, hz, pan, wet, len * 0.3);
    ring(t, len, lvl * 0.6, "sine", hz * 1.004, hz * 1.004, -pan, wet, len * 0.35);
  });
}

/** A chip run: square-wave notes (the old sound chips' voice), quick, one after another. */
function chip(t: number, notes: number[], step: number, lvl: number, pan = 0) {
  notes.forEach((hz, k) => {
    ring(t + k * step, step * 0.9, lvl, "square", hz, hz, pan, 0.25, 0.002);
    ring(t + k * step, step * 0.5, lvl * 0.3, "square", hz * 2, hz * 2, -pan, 0.2, 0.002);
  });
}

/** The cards coming out of the crate: three chip blips going up, a swish under each. */
export function cardsOut(vol = 1) {
  const t = at(250);
  [C[4], C[7], C[11]].forEach((hz, k) => {
    const tk = t + k * 0.13;
    ring(tk, 0.08, 0.05 * vol, "square", hz * 0.5, hz, (k - 1) * 0.4, 0.3, 0.002);
    ring(tk + 0.03, 0.14, 0.035 * vol, "triangle", hz, hz, (k - 1) * 0.4, 0.4);
    hiss(tk, 0.12, 0.03 * vol, "bandpass", 1200, 4000, 1.2, (k - 1) * 0.4, 0.3, 0.05);
  });
}

/** The crate turns up (the popup, or set down in front of you). */
export function arrive(vol = 1) {
  const t = at(0);
  thump(t, 0.18 * vol);
  whoosh(t - 0.02, 0.3, 0.05 * vol, 2000, 400);
  bell(t + 0.12, C[7], 0.6, 0.05 * vol, -0.3);
  bell(t + 0.2, C[11], 0.7, 0.045 * vol, 0.3);
  sparkle(t + 0.15, 7, 0.45, 0.03 * vol);
}

/** A tap on the crate (`i`: the first, second, third…): a hollow knock, the latch rattling, a hum rising a step each time. */
export function knock(i: number, vol = 1) {
  const t = at(0);
  const k = Math.min(i, 4);
  // The wood: a hollow, resonant knock (two body modes), and its thud.
  hiss(t, 0.16, (0.16 + k * 0.04) * vol, "bandpass", 420 + k * 30, 380, 7, 0, 0.35);
  hiss(t, 0.09, (0.1 + k * 0.03) * vol, "bandpass", 1150 + k * 60, 1000, 9, 0, 0.3);
  ring(t, 0.18, (0.16 + k * 0.04) * vol, "sine", 190 + k * 20, 70, 0, 0.2);
  // The latch and lid rattling.
  for (let n = 0; n < 3 + k; n++) hiss(t + 0.035 + n * 0.03, 0.025, 0.03 * vol, "bandpass", rnd(2600, 3800), 2400, 10, rnd(-0.4, 0.4), 0.3);
  // Something inside, eager: a hum a step higher each knock.
  const hum = 110 * 2 ** (k * 2 / 12);
  ring(t, 0.55, (0.022 + k * 0.012) * vol, "sawtooth", hum, hum * 2 ** (1 / 12), 0, 0.5, 0.08);
  ring(t, 0.5, (0.02 + k * 0.012) * vol, "sine", hum * 4, hum * 4 * 2 ** (1 / 12), 0, 0.5, 0.06);
  // The light starting to leak: a twinkle.
  if (k >= 2) sparkle(t + 0.05, 2 + k, 0.3, 0.02 * vol);
}

/**
 * Bursting open: a boom, a whoosh and a crack of light, then a run of bells,
 * bigger the rarer the best thing inside (`tier`: 0 common – 4 legendary).
 */
export function burstOpen(tier: number, vol = 1) {
  const t = at(0);
  thump(t, (0.3 + tier * 0.05) * vol);
  whoosh(t - 0.05, 0.55, 0.11 * vol, 250, 7000);
  hiss(t, 0.18, 0.08 * vol, "highpass", 4000, 9000, 0.7, 0, 0.5);
  const runs = [
    [0, 2, 4],
    [0, 2, 4, 7],
    [0, 2, 4, 7, 9, 11],
    [0, 2, 4, 7, 9, 11, 14],
    [0, 4, 7, 9, 11, 14, 16, 14, 16],
  ][tier] ?? [0, 2, 4];
  const step = tier >= 3 ? 0.065 : 0.08;
  runs.forEach((n, k) => bell(t + 0.1 + k * step, C[n], 0.8 + tier * 0.15, (0.055 + tier * 0.006) * vol, (k / runs.length) * 1.2 - 0.6));
  const end = t + 0.1 + runs.length * step;
  // A chip arpeggio racing up under the bells (the old consoles' fanfare), more of it the rarer.
  if (tier >= 1) {
    const arp = [C[0], C[4], C[7], C[14]];
    const bars = [0, 1, 2, 3, 4][tier];
    for (let b = 0; b < bars; b++) chip(t + 0.1 + b * 0.22, arp, 0.055, 0.022 * vol, (b % 2) * 0.6 - 0.3);
  }
  // Held under it: a chord, longer and fuller the rarer.
  const hold = [0.9, 1.3, 1.8, 2.4, 3.2][tier] ?? 1;
  pad(end - 0.1, hold, tier >= 2 ? [C[0], C[2], C[4], C[7]] : [C[0], C[4]], (0.018 + tier * 0.004) * vol);
  sparkle(t + 0.1, 6 + tier * 8, 0.6 + tier * 0.3, 0.03 * vol);
  if (tier >= 3) hiss(end - 0.2, hold, 0.022 * vol, "highpass", 9000, 9000, 0.7, 0, 0.7, 0.3);
  // A legendary: a sub boom, brass, a choir, coins.
  if (tier >= 4) {
    ring(t, 1.4, 0.18 * vol, "sine", 70, 38, 0, 0.3);
    [7, 11, 14, 14].forEach((n, k) => ring(end + 0.05 + k * 0.14, k === 3 ? 1.4 : 0.2, 0.04 * vol, "square", C[n] / 2, C[n] / 2, 0, 0.5, 0.01));
    pad(end, 2.6, [C[0] / 2, C[4] / 2, C[7] / 2, C[7]], 0.02 * vol, 0.8);
    coins(24, vol * 0.7, Math.round((end - t) * 1000) + 250);
  }
}

/** A face-down card nudged (hovered): a tiny tick. */
export function nudge(vol = 1) {
  ring(at(0), 0.035, 0.02 * vol, "triangle", 2400, 2600, 0, 0.2);
}

/**
 * A card charging up before it turns (`tier`: what's on it, `secs`: how
 * long): a swell rising and ticks coming faster, tenser the rarer.
 */
export function charge(tier: number, secs: number, vol = 1) {
  const t = at(0);
  whoosh(t, secs + 0.05, (0.04 + tier * 0.012) * vol, 300, 2500 + tier * 1200);
  const from = C[0] * 2 ** (-tier / 12);
  ring(t, secs + 0.05, (0.02 + tier * 0.006) * vol, "triangle", from, from * 2 ** ((7 + tier * 2) / 12), 0, 0.5, secs * 0.8);
  // Ticks, closer and closer.
  const n = 3 + tier * 2;
  let dt = 0;
  for (let k = 0; k < n; k++) {
    const gap = (secs / n) * (1.6 - (k / n) * 1.2);
    if (dt + gap > secs) break;
    dt += gap;
    ring(t + dt, 0.03, (0.02 + (k / n) * 0.02) * vol, "square", 1800 + k * 90, 1800 + k * 90, 0, 0.2);
  }
  // Rarer: a heartbeat under it.
  if (tier >= 3) for (let k = 0; k < Math.floor(secs / 0.32); k++) ring(t + k * 0.32, 0.18, 0.08 * vol, "sine", 75, 45, 0, 0.1);
}

/** A card turning over (`tier` of what's on it; `i`: which, left to right, for where it sounds). */
export function reveal(tier: number, i: number, vol = 1) {
  const t = at(0);
  const pan = (i - 1) * 0.45;
  // The flip: a pop and a flick of card.
  ring(t, 0.09, 0.07 * vol, "sine", 380, 950, pan, 0.2);
  hiss(t, 0.06, 0.07 * vol, "highpass", 3000, 7000, 0.7, pan, 0.3);
  // Its bell: higher the rarer, then a little chord.
  const root = C[Math.min(C.length - 1, 2 + tier * 2)];
  bell(t + 0.04, root, 0.8 + tier * 0.25, (0.06 + tier * 0.008) * vol, pan);
  const up = [[], [7], [4, 7], [4, 7, 12], [4, 7, 12, 16]][tier] ?? [];
  up.forEach((st, k) => bell(t + 0.1 + k * 0.06, root * 2 ** (st / 12), 0.7 + tier * 0.2, 0.04 * vol, pan));
  if (tier >= 2) sparkle(t + 0.08, 4 + tier * 4, 0.5 + tier * 0.2, 0.028 * vol);
  // Rare and up: a chip arpeggio flourish on top.
  if (tier >= 2) chip(t + 0.12, [root, root * 2 ** (4 / 12), root * 2 ** (7 / 12), root * 2, root * 2 ** (19 / 12), root * 4].slice(0, 3 + tier), 0.05, 0.02 * vol, pan);
  if (tier >= 3) {
    thump(t, 0.15 * vol);
    whoosh(t, 0.4, 0.05 * vol, 600, 8000);
    pad(t + 0.15, 1.6, [root / 2, root * 2 ** (4 / 12) / 2, root * 2 ** (7 / 12) / 2], 0.015 * vol);
  }
  if (tier >= 4) {
    [0, 4, 7, 12].forEach((st, k) => ring(t + 0.2 + k * 0.12, k === 3 ? 1.2 : 0.18, 0.035 * vol, "square", (root / 2) * 2 ** (st / 12), (root / 2) * 2 ** (st / 12), pan, 0.5, 0.01));
    coins(16, vol * 0.6, 500);
  }
}

/** Coins on a card, counted in (`n` of them): a tumble of clinks, then a ka-ching. */
export function coinsIn(n: number, vol = 1) {
  const clinks = Math.max(4, Math.min(22, Math.round(n / 12)));
  coins(clinks, vol * 0.8, 120);
  const t = at(150 + clinks * 55);
  bell(t, C[11], 0.5, 0.045 * vol, 0.2);
  bell(t + 0.07, C[14], 0.7, 0.04 * vol, 0.2);
}

/** All three seen: a ta-da (a chip fanfare for a rare one). */
export function allSeen(best: number, vol = 1) {
  const t = at(0);
  if (best >= 2) chip(t, [C[0], C[4], C[7], C[7], C[9], C[11]], 0.07, 0.025 * vol);
  [C[4], C[7], C[11]].forEach((hz, k) => bell(t + k * 0.09, hz, k === 2 ? 1.1 : 0.4, 0.045 * vol, (k - 1) * 0.4));
  pad(t + 0.18, 1, [C[0], C[4], C[7]], 0.014 * vol);
  sparkle(t + 0.15, 5 + best * 2, 0.5, 0.025 * vol);
}

/** Collected: a whoosh up into the bag and a cascade of bells. */
export function collect(vol = 1) {
  const t = at(0);
  whoosh(t, 0.35, 0.07 * vol, 400, 5000);
  ring(t, 0.1, 0.09 * vol, "sine", 500, 1500, 0, 0.3);
  [7, 9, 11, 14, 16].forEach((n, k) => bell(t + 0.08 + k * 0.05, C[n], 0.4, 0.035 * vol, k * 0.2 - 0.4));
  coins(5, vol * 0.5, 300);
}
