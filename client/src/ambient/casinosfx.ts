// The Casino's sounds, synthesised like the rest: reels whirring and
// clunking to a stop, the win jingles (a coin shower for a big one), the
// roulette ball rolling round the rim and rattling over the frets into its
// pocket, and the races (the bell, hooves drumming, the crowd).

import { at, burst, tone } from "./sfx";

/** A reel ticking past a symbol. */
export function reelTick(vol = 1) {
  const t = at(0);
  burst(t, 0.018, 0.05 * vol, "highpass", 3500);
  tone(t, 0.012, 0.025 * vol, "square", 1900 + Math.random() * 200);
}

/** A reel clunking to a stop (`i`: which, a little higher each). */
export function reelStop(i = 0, vol = 1) {
  const t = at(0);
  tone(t, 0.14, 0.16 * vol, "sine", 170 + i * 12, 70);
  burst(t, 0.06, 0.12 * vol, "lowpass", 1200, 300);
  tone(t + 0.01, 0.05, 0.05 * vol, "triangle", 900 + i * 60);
}

/** The lever pulled / the button pressed: a ratchet and a whoosh. */
export function pull(vol = 1) {
  const t = at(0);
  for (let k = 0; k < 5; k++) burst(t + k * 0.03, 0.02, 0.06 * vol, "bandpass", 2600 - k * 200, 2600 - k * 200, 4);
  burst(t + 0.12, 0.35, 0.05 * vol, "bandpass", 600, 2400, 1.2);
}

/** Coins tumbling into the tray: `n` clinks. */
export function coins(n: number, vol = 1, delayMs = 0) {
  const t = at(delayMs);
  for (let k = 0; k < n; k++) {
    const dt = k * 0.055 + Math.random() * 0.03;
    const hz = 2200 + Math.random() * 1400;
    tone(t + dt, 0.09, 0.05 * vol, "triangle", hz, hz * 0.97);
    tone(t + dt, 0.05, 0.025 * vol, "square", hz * 1.5);
    burst(t + dt, 0.03, 0.03 * vol, "highpass", 7000);
  }
}

/**
 * A win, bigger the more it pays (`mult`: the payout over the bet): a
 * rising arpeggio of bells, then the coins; a big win gets a fanfare climb
 * and a long shower of coins.
 */
export function win(mult: number, vol = 1) {
  const t = at(0);
  const big = mult >= 10;
  const notes = big ? [523, 659, 784, 1047, 1319, 1568, 2093] : mult >= 3 ? [523, 659, 784, 1047] : [659, 988];
  notes.forEach((hz, k) => {
    tone(t + k * 0.08, 0.5, 0.07 * vol, "sine", hz);
    tone(t + k * 0.08, 0.25, 0.03 * vol, "triangle", hz * 2);
  });
  if (big) {
    // The chord, held, and a shimmer.
    for (const hz of [1047, 1319, 1568]) tone(t + 0.6, 1.4, 0.05 * vol, "triangle", hz);
    burst(t + 0.6, 1.2, 0.03 * vol, "highpass", 8000);
  }
  coins(Math.min(30, Math.round(3 + mult * 1.5)), vol * 0.8, notes.length * 80);
}

/** No luck: two soft descending notes. */
export function lose(vol = 1) {
  const t = at(0);
  tone(t, 0.18, 0.05 * vol, "triangle", 392);
  tone(t + 0.16, 0.3, 0.05 * vol, "triangle", 311);
}

/** The roulette ball rolling round the rim, `secs` long, slowing (a whir that falls). */
export function ballRoll(secs: number, vol = 1) {
  const t = at(0);
  burst(t, secs, 0.07 * vol, "bandpass", 2400, 700, 2.5);
  burst(t, secs * 0.9, 0.04 * vol, "lowpass", 500, 180, 0.7);
}

/** The ball clacking over a fret (`hard` 0..1). */
export function fret(hard = 0.5, vol = 1) {
  const t = at(0);
  const hz = 2600 + Math.random() * 900;
  tone(t, 0.025, (0.03 + 0.06 * hard) * vol, "triangle", hz, hz * 0.8);
  burst(t, 0.015, (0.03 + 0.05 * hard) * vol, "highpass", 5000);
}

/** The ball dropping into its pocket: a rattle, then it settles. */
export function pocket(vol = 1) {
  const t = at(0);
  [0, 0.07, 0.12, 0.16, 0.19].forEach((dt, k) => {
    const hz = 2300 - k * 150;
    tone(t + dt, 0.03, (0.09 - k * 0.012) * vol, "triangle", hz, hz * 0.85);
    burst(t + dt, 0.02, (0.06 - k * 0.008) * vol, "highpass", 4500);
  });
  tone(t + 0.22, 0.2, 0.05 * vol, "sine", 240, 180);
}

/** The bell that starts a race. */
export function raceBell(vol = 1) {
  const t = at(0);
  for (let k = 0; k < 6; k++) {
    tone(t + k * 0.09, 0.3, 0.07 * vol, "sine", 1760);
    tone(t + k * 0.09, 0.15, 0.03 * vol, "sine", 4850);
  }
}

/** One horse's stride: four hooves, low thuds (`vol` by how close). */
export function hooves(vol = 1) {
  const t = at(0);
  [0, 0.05, 0.16, 0.21].forEach((dt) => {
    tone(t + dt, 0.07, 0.07 * vol, "sine", 120 + Math.random() * 30, 60);
    burst(t + dt, 0.04, 0.05 * vol, "lowpass", 700);
  });
}

/** The crowd roaring (`secs`): a swell of voices. */
export function crowd(secs = 1.6, vol = 1) {
  const t = at(0);
  burst(t, secs, 0.06 * vol, "bandpass", 700, 1100, 0.8);
  burst(t + 0.1, secs * 0.9, 0.04 * vol, "bandpass", 1400, 2000, 1);
}
