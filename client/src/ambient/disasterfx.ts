// The sounds of Caesar's disasters, rendered sample by sample like the
// arena's others: a war horn; lava (a ground-shaking rumble, then a molten
// churn that goes on under the fight); meteors (a shrieking fall, a crater
// punched in the sand, stones pattering down); and the lions: a chesty growl
// when they come for you, a great roar out of the gate, claws, a yelp.

import { burst, at, drone, hit, mode, pick, play, render, tone } from "./sfx";

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A one-pole lowpass over noise, `soft` its coefficient (0..1), summed into `d`, enveloped by `env(0..1)`. */
function noise(d: Float32Array, sr: number, t0: number, len: number, amp: number, soft: (x: number) => number, env: (x: number) => number) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(len * sr);
  let lp = 0;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const x = i / n;
    lp += soft(x) * (Math.random() * 2 - 1 - lp);
    d[start + i] += amp * env(x) * lp;
  }
}

/**
 * A big cat's voice: a rough pulse train at `hz(x)` Hz through a pair of
 * throat resonances, its rasp (sub-beats, jittering) the growl in it.
 */
function voice(d: Float32Array, sr: number, t0: number, len: number, amp: number, hz: (x: number) => number, env: (x: number) => number, rasp: number, f1: number, f2: number) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(len * sr);
  let ph = 0;
  // Two simple resonators (the throat, the mouth).
  const reson = (f: number, r: number) => {
    let [y1, y2] = [0, 0];
    const c = 2 * r * Math.cos((2 * Math.PI * f) / sr);
    return (x: number) => {
      const y = x + c * y1 - r * r * y2;
      y2 = y1;
      y1 = y;
      return y * (1 - r);
    };
  };
  const a = reson(f1, 0.97);
  const b = reson(f2, 0.95);
  let jitter = 0;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const x = i / n;
    jitter += 0.02 * ((Math.random() - 0.5) * 2 - jitter);
    ph += (hz(x) * (1 + jitter * 0.5)) / sr;
    if (ph > 1) ph -= 1;
    // A rough glottal pulse.
    const pulse = ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI) ** 2 : 0;
    const gate = 1 - rasp + rasp * (0.5 + 0.5 * Math.sign(Math.sin(2 * Math.PI * hz(x) * 0.47 * (i / sr))));
    const src = pulse * gate + (Math.random() - 0.5) * 0.3 * rasp;
    d[start + i] += amp * env(x) * (a(src) * 1.1 + b(src) * 0.8);
  }
}

function renderHorn(): AudioBuffer {
  return render(2, (d, sr) => {
    // A great bronze horn: a slow bend up to a held note, then a fall.
    for (const [mult, v] of [[1, 0.55], [2.01, 0.32], [3, 0.16], [4.02, 0.08], [0.5, 0.26]]) {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const hz = (t < 0.25 ? 92 + 18 * Math.sin((t / 0.25) * Math.PI * 0.5) : 110 - Math.max(0, t - 1.3) * 12) * mult;
        ph += (2 * Math.PI * hz) / sr;
        const env = Math.min(1, t * 6) * Math.exp(-Math.max(0, t - 1.1) / 0.32);
        d[i] += v * env * (Math.sin(ph) + 0.35 * Math.sin(ph * 2 + 0.5));
      }
    }
  });
}

/** Caesar's horn: the disaster's upon them. */
export function horn(vol = 1) {
  const t = at(0);
  play(pick("disaster-horn", renderHorn, 1), t, 0.5 * vol, { wet: 0.34 });
  burst(t, 0.5, 0.05 * vol, "lowpass", 200, 80);
}

function renderQuake(): AudioBuffer {
  return render(2.4, (d, sr) => {
    // The ground splitting: a deep shudder, rocks grinding, molten rock breaking through.
    noise(d, sr, 0, 2.3, 1.5, () => 0.03, (x) => Math.min(1, x * 6) * (1 - x) ** 1.2);
    for (let k = 0; k < 7; k++) {
      const t = rand(0, 1.3);
      mode(d, sr, t, rand(46, 80), rand(0.12, 0.3), rand(0.5, 0.9));
      hit(d, sr, t, 0.02, 0.3, 0.3);
    }
    noise(d, sr, 0.5, 1.7, 0.2, () => 0.5, (x) => Math.sin(Math.PI * x) ** 2);
  });
}

function renderChurn(): AudioBuffer {
  return render(5, (d, sr) => {
    // Molten rock on the move: a low roar with thick bubbles breaking in it.
    noise(d, sr, 0, 5, 1.1, () => 0.05, () => 1);
    noise(d, sr, 0, 5, 0.16, () => 0.32, (x) => 0.6 + 0.4 * Math.sin(x * Math.PI * 6));
    for (let k = 0; k < 16; k++) {
      const t = rand(0.1, 4.7);
      const hz = rand(90, 240);
      const start = Math.floor(t * sr);
      let ph = 0;
      const n = Math.floor(0.14 * sr);
      for (let i = 0; i < n && start + i < d.length; i++) {
        const x = i / n;
        ph += (2 * Math.PI * hz * (1 + x * 1.6)) / sr;
        d[start + i] += rand(0.2, 0.3) * Math.sin(ph) * Math.sin(Math.PI * x) ** 2;
      }
    }
    // (Its ends meeting, for the loop.)
    const fade = Math.floor(0.08 * sr);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] *= k;
      d[d.length - 1 - i] *= k;
    }
  });
}

/** The lava breaks through; returns the way to stop its roar. */
export function lava(vol = 1): () => void {
  play(pick("disaster-quake", renderQuake, 2), at(0), 0.7 * vol, { wet: 0.2, lowpass: 2600 });
  return drone(pick("disaster-churn", renderChurn, 1), 0.3 * vol, 900);
}

function renderWhistle(): AudioBuffer {
  return render(0.75, (d, sr) => {
    // A shriek falling out of the sky, with air tearing round it.
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const x = i / d.length;
      ph += (2 * Math.PI * (1500 * Math.pow(0.26, x))) / sr;
      d[i] += 0.3 * Math.min(1, x * 3) * Math.sin(ph + 2 * Math.sin(ph * 0.5));
    }
    noise(d, sr, 0, 0.75, 0.5, (x) => 0.1 + x * 0.2, (x) => x ** 2);
  });
}

/** One coming down (ending about now + 0.7 s). */
export function meteorFall(vol = 1, pan = 0) {
  play(pick("disaster-whistle", renderWhistle, 3), at(0), 0.3 * vol, { pan, wet: 0.16 });
}

function renderImpact(): AudioBuffer {
  return render(1.5, (d, sr) => {
    // A crater punched in the sand: a sub-deep WHUMP you feel, the crack of it…
    hit(d, sr, 0, 0.04, 1, 0.2);
    mode(d, sr, 0, 54, 0.32, 1.1);
    mode(d, sr, 0, 92, 0.14, 0.7);
    hit(d, sr, 0, 0.004, 0.9, 0.9);
    noise(d, sr, 0, 0.7, 1, (x) => 0.32 * (1 - x) + 0.02, (x) => (1 - x) ** 2.4);
    // …and stones pattering back down.
    for (let k = 0; k < 16; k++) {
      const t = 0.22 + Math.random() * 1;
      mode(d, sr, t, rand(700, 2300), rand(0.012, 0.03), 0.13 * rand(0.4, 1));
    }
  });
}

export function meteorImpact(vol = 1, pan = 0) {
  play(pick("disaster-impact", renderImpact, 4), at(0), 0.62 * vol, { pan, wet: 0.2, lowpass: 5000 });
}

function renderRoar(): AudioBuffer {
  return render(2, (d, sr) => {
    // The full roar: a swell from the chest up to a bellow, tailing to a rumbling huff.
    const hz = (x: number) => 62 + 82 * Math.sin(Math.min(1, x * 2.2) * Math.PI * 0.5) - 62 * Math.max(0, x - 0.55) ** 1.1;
    const env = (x: number) => Math.min(1, x * 7) * (x < 0.55 ? 1 : Math.exp(-(x - 0.55) * 4.5));
    voice(d, sr, 0, 1.95, 1.3, hz, env, 0.65, 330, 900);
    voice(d, sr, 0, 1.95, 0.5, (x) => hz(x) * 0.5, env, 0.9, 170, 520);
    noise(d, sr, 0, 1.6, 0.25, () => 0.26, (x) => env(x) * 0.7);
  });
}

/** A lion out of the gate. */
export function roar(vol = 1, delayMs = 0) {
  play(pick("disaster-roar", renderRoar, 3), at(delayMs), 0.72 * vol, { wet: 0.32, lowpass: 3600 });
}

function renderGrowl(): AudioBuffer {
  return render(0.85, (d, sr) => {
    // Low, close, and rising: it's about to spring.
    const env = (x: number) => Math.min(1, x * 5) * Math.min(1, (1 - x) * 8);
    voice(d, sr, 0, 0.82, 1.5, (x) => 46 + 34 * x, env, 0.9, 240, 640);
    noise(d, sr, 0, 0.8, 0.12, () => 0.2, env);
  });
}

/** It crouches. */
export function growl(vol = 1) {
  play(pick("disaster-growl", renderGrowl, 3), at(0), 0.58 * vol, { wet: 0.1, lowpass: 2600 });
}

function renderPounce(): AudioBuffer {
  return render(0.5, (d, sr) => {
    // A rush of air and a snarl as it leaps.
    noise(d, sr, 0, 0.42, 0.7, (x) => 0.1 + x * 0.3, (x) => Math.sin(Math.PI * x) ** 2);
    voice(d, sr, 0, 0.4, 1.3, (x) => 120 - 40 * x, (x) => Math.sin(Math.PI * x) ** 0.7, 0.8, 420, 1100);
  });
}

export function pounce(vol = 1) {
  play(pick("disaster-pounce", renderPounce, 3), at(0), 0.5 * vol, { wet: 0.08 });
}

function renderClaws(): AudioBuffer {
  return render(0.42, (d, sr) => {
    // It lands: a thud of heavy paws, and three claws raking.
    hit(d, sr, 0, 0.03, 0.8, 0.24);
    mode(d, sr, 0, 96, 0.08, 0.8);
    for (const t of [0.015, 0.075, 0.135]) noise(d, sr, t, 0.1, 0.5, () => 0.8, (x) => (1 - x) ** 1.4);
    for (const t of [0.015, 0.075, 0.135]) mode(d, sr, t, rand(2300, 3400), 0.05, 0.14);
  });
}

export function claws(vol = 1) {
  play(pick("disaster-claws", renderClaws, 3), at(0), 0.56 * vol, { wet: 0.08 });
}

function renderYelp(): AudioBuffer {
  return render(0.36, (d, sr) => {
    voice(d, sr, 0, 0.33, 1.4, (x) => 190 - 80 * x, (x) => Math.min(1, x * 10) * (1 - x), 0.4, 600, 1500);
  });
}

/** It's hurt. */
export function yelp(vol = 1) {
  play(pick("disaster-yelp", renderYelp, 3), at(0), 0.36 * vol, { wet: 0.08 });
}

function renderDeath(): AudioBuffer {
  return render(1.3, (d, sr) => {
    // A last, sinking moan, and the great weight of it hitting the sand.
    voice(d, sr, 0, 1, 1.3, (x) => 118 - 76 * x, (x) => Math.min(1, x * 6) * (1 - x) ** 1.3, 0.75, 300, 780);
    hit(d, sr, 0.92, 0.04, 0.7, 0.2);
    mode(d, sr, 0.92, 72, 0.14, 0.7);
  });
}

/** It's dead. */
export function lionDown(vol = 1) {
  play(pick("disaster-death", renderDeath, 2), at(0), 0.56 * vol, { wet: 0.24 });
}

/** A vote cast: a stone clacked into the urn. */
export function voteClack(vol = 1) {
  const t = at(0);
  tone(t, 0.09, 0.09 * vol, "triangle", 620, 440);
  tone(t + 0.05, 0.1, 0.07 * vol, "triangle", 880, 700);
}

function renderGrind(): AudioBuffer {
  return render(4.6, (d, sr) => {
    // Stone on stone: a low, gritty grinding, slowing as it stops.
    noise(d, sr, 0, 4.5, 1, (x) => 0.05 + (1 - x) * 0.05, (x) => Math.min(1, x * 8) * (1 - x) ** 0.7);
    noise(d, sr, 0, 4.5, 0.2, () => 0.4, (x) => (0.5 + 0.5 * Math.sin(x * 60 * (1 - x * 0.7))) * (1 - x));
    for (let k = 0; k < 24; k++) mode(d, sr, rand(0, 4.3), rand(50, 110), rand(0.05, 0.12), 0.3);
  });
}

/** The great stone wheel starts to turn. */
export function stoneGrind(vol = 1) {
  play(pick("disaster-grind", renderGrind, 1), at(0), 0.4 * vol, { wet: 0.14, lowpass: 1800 });
}

function renderSink(): AudioBuffer {
  return render(2.2, (d, sr) => {
    // Something enormous letting go underfoot: a deep thud, then stone grinding down.
    hit(d, sr, 0, 0.05, 1, 0.16);
    mode(d, sr, 0, 44, 0.5, 1.2);
    noise(d, sr, 0.05, 2.1, 1.2, (x) => 0.05 - x * 0.03, (x) => Math.min(1, x * 7) * (1 - x) ** 1.2);
    noise(d, sr, 0.05, 2, 0.16, () => 0.4, (x) => (0.5 + 0.5 * Math.sin(x * 70)) * (1 - x));
    mode(d, sr, 1.9, 56, 0.2, 0.9);
    hit(d, sr, 1.9, 0.03, 0.5, 0.2);
  });
}

/** The wheel starts down its shaft. */
export function stoneSink(vol = 1) {
  play(pick("disaster-sink", renderSink, 1), at(0), 0.62 * vol, { wet: 0.26, lowpass: 2200 });
}

function renderRise(): AudioBuffer {
  return render(2.6, (d, sr) => {
    // Coming back up, slowly, with a great weight on it, and things skittering in the dark.
    noise(d, sr, 0, 2.5, 1.2, (x) => 0.04 + x * 0.04, (x) => Math.min(1, x * 3) * Math.min(1, (1 - x) * 5));
    for (let k = 0; k < 22; k++) mode(d, sr, rand(0, 2.1), rand(900, 2600), rand(0.006, 0.016), 0.18 * rand(0.4, 1));
    mode(d, sr, 2.32, 50, 0.24, 1);
    hit(d, sr, 2.32, 0.03, 0.6, 0.25);
  });
}

/** It comes back up. */
export function stoneRise(vol = 1) {
  play(pick("disaster-rise", renderRise, 1), at(0), 0.6 * vol, { wet: 0.24, lowpass: 3200 });
}

function renderScreech(): AudioBuffer {
  return render(1.5, (d, sr) => {
    // A huge dry rasp and a hiss, nothing like a lion: chitin on chitin, rising and tearing.
    const env = (x: number) => Math.min(1, x * 8) * (x < 0.5 ? 1 : Math.exp(-(x - 0.5) * 4));
    voice(d, sr, 0, 1.45, 1.1, (x) => 150 + 240 * Math.sin(Math.min(1, x * 2) * Math.PI * 0.5) - 180 * x, env, 1, 1100, 2600);
    voice(d, sr, 0, 1.45, 0.8, (x) => 70 + 40 * x, env, 0.9, 260, 700);
    noise(d, sr, 0, 1.4, 0.5, () => 0.7, (x) => env(x) * (0.6 + 0.4 * Math.sin(x * 120)));
    for (let k = 0; k < 16; k++) hit(d, sr, 0.04 + k * 0.05, 0.006, 0.3, 0.95);
  });
}

/** It rears up and screams at everyone. */
export function scorpionRoar(vol = 1) {
  play(pick("disaster-screech", renderScreech, 2), at(0), 0.68 * vol, { wet: 0.32, lowpass: 6000 });
}

function renderHiss(): AudioBuffer {
  return render(0.7, (d, sr) => {
    // The tail drawing back: a dry rattle, a hiss, plates sliding.
    noise(d, sr, 0, 0.65, 0.7, () => 0.72, (x) => Math.min(1, x * 5) * (1 - x * 0.6));
    for (let k = 0; k < 11; k++) mode(d, sr, k * 0.055, rand(1500, 2800), 0.012, 0.3);
  });
}

export function scorpionHiss(vol = 1) {
  play(pick("disaster-hiss", renderHiss, 2), at(0), 0.4 * vol, { wet: 0.1 });
}

function renderSting(): AudioBuffer {
  return render(0.5, (d, sr) => {
    // A whip of the tail, a hard wet thud into the sand.
    noise(d, sr, 0, 0.14, 0.9, (x) => 0.2 + x * 0.5, (x) => x ** 2);
    hit(d, sr, 0.13, 0.03, 1, 0.34);
    mode(d, sr, 0.13, 118, 0.1, 0.9);
    mode(d, sr, 0.13, 1900, 0.018, 0.34);
  });
}

export function scorpionSting(vol = 1) {
  play(pick("disaster-sting", renderSting, 3), at(0), 0.6 * vol, { wet: 0.1 });
}

function renderDart(): AudioBuffer {
  return render(0.3, (d, sr) => {
    // Spat: a sharp wet puff, a thin whistle after it.
    hit(d, sr, 0, 0.012, 0.9, 0.6);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const x = i / d.length;
      ph += (2 * Math.PI * (1700 - 900 * x)) / sr;
      d[i] += 0.16 * Math.sin(ph) * (1 - x);
    }
  });
}

export function dartSpit(vol = 1) {
  play(pick("disaster-dart", renderDart, 3), at(0), 0.42 * vol, { wet: 0.1 });
}

function renderPoison(): AudioBuffer {
  return render(0.7, (d, sr) => {
    // A sick, sinking gurgle.
    for (const [t, hz] of [[0, 300], [0.13, 240], [0.26, 190]]) {
      let ph = 0;
      const start = Math.floor(t * sr);
      const n = Math.floor(0.18 * sr);
      for (let i = 0; i < n && start + i < d.length; i++) {
        const x = i / n;
        ph += (2 * Math.PI * hz * (1 - x * 0.5)) / sr;
        d[start + i] += 0.5 * Math.sin(ph + 3 * Math.sin(ph * 0.5)) * Math.sin(Math.PI * x);
      }
    }
  });
}

/** Poison in you. */
export function poisoned(vol = 1) {
  play(pick("disaster-poison", renderPoison, 2), at(0), 0.4 * vol, { wet: 0.16 });
}

function renderChitin(): AudioBuffer {
  return render(0.28, (d, sr) => {
    // A blade skating off armour.
    hit(d, sr, 0, 0.006, 0.8, 0.8);
    mode(d, sr, 0, 1300, 0.05, 0.5);
    mode(d, sr, 0, 2150, 0.035, 0.34);
    mode(d, sr, 0, 300, 0.04, 0.5);
  });
}

/** A blow lands on its shell. */
export function scorpionHit(vol = 1) {
  play(pick("disaster-chitin", renderChitin, 3), at(0), 0.42 * vol, { wet: 0.08 });
}

function renderDeathRattle(): AudioBuffer {
  return render(1.7, (d, sr) => {
    // A long failing screech, legs rattling down, the great body crashing.
    voice(d, sr, 0, 1.1, 1, (x) => 320 - 250 * x, (x) => Math.min(1, x * 6) * (1 - x), 1, 900, 2100);
    for (let k = 0; k < 14; k++) mode(d, sr, 0.4 + k * 0.06, rand(800, 2000), 0.02, 0.26 * (1 - k / 14));
    hit(d, sr, 1.2, 0.05, 0.9, 0.2);
    mode(d, sr, 1.2, 58, 0.3, 1);
  });
}

export function scorpionDown(vol = 1) {
  play(pick("disaster-rattle", renderDeathRattle, 1), at(0), 0.62 * vol, { wet: 0.26 });
}

function renderAcid(): AudioBuffer {
  return render(5, (d, sr) => {
    // Rain, and everything it touches fizzing.
    noise(d, sr, 0, 5, 0.34, () => 0.55, () => 1);
    noise(d, sr, 0, 5, 0.5, () => 0.08, (x) => 0.7 + 0.3 * Math.sin(x * 20));
    for (let k = 0; k < 90; k++) mode(d, sr, rand(0.05, 4.9), rand(2200, 6000), rand(0.006, 0.02), 0.12 * rand(0.3, 1));
    const fade = Math.floor(0.08 * sr);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] *= k;
      d[d.length - 1 - i] *= k;
    }
  });
}

/** The acid rain begins; returns the way to stop it. */
export function acidRain(vol = 1): () => void {
  const t = at(0);
  tone(t, 1.6, 0.05 * vol, "sine", 90, 60);
  return drone(pick("disaster-acid", renderAcid, 1), 0.26 * vol, 6000);
}

function renderSizzle(): AudioBuffer {
  return render(0.4, (d, sr) => {
    noise(d, sr, 0, 0.38, 0.8, () => 0.82, (x) => Math.min(1, x * 12) * (1 - x) ** 1.5);
  });
}

/** It burns. */
export function sizzle(vol = 1) {
  play(pick("disaster-sizzle", renderSizzle, 3), at(0), 0.3 * vol, { wet: 0.06 });
}

// ---- the little scorpions ----

function renderSkitter(): AudioBuffer {
  return render(0.16, (d, sr) => {
    // A handful of tiny feet on sand.
    for (let k = 0; k < 5; k++) mode(d, sr, k * 0.028 + rand(0, 0.008), rand(2600, 4400), 0.005, 0.22);
  });
}

/** Its feet, pattering. */
export function thiefSkitter(vol = 1) {
  play(pick("thief-skitter", renderSkitter, 3), at(0), 0.1 * vol, { wet: 0.03 });
}

function renderPeek(): AudioBuffer {
  return render(0.4, (d, sr) => {
    // Two clicks of a pincer, and a little scrabble.
    for (const t of [0, 0.11]) mode(d, sr, t, 3400, 0.009, 0.5);
    for (let k = 0; k < 4; k++) mode(d, sr, 0.22 + k * 0.03, rand(2400, 3600), 0.005, 0.2);
  });
}

/** Something's creeping out from behind a gift. */
export function thiefPeek(vol = 1) {
  play(pick("thief-peek", renderPeek, 2), at(0), 0.16 * vol, { wet: 0.08 });
}

function renderHook(): AudioBuffer {
  return render(0.42, (d, sr) => {
    // A hook going in: a tink; then a drag, starting to scrape.
    mode(d, sr, 0, 2900, 0.03, 0.7);
    mode(d, sr, 0, 4350, 0.02, 0.3);
    noise(d, sr, 0.1, 0.3, 0.5, () => 0.3, (x) => Math.min(1, x * 8) * (1 - x));
  });
}

/** It has the gift. */
export function thiefHook(vol = 1) {
  play(pick("thief-hook", renderHook, 2), at(0), 0.26 * vol, { wet: 0.08 });
}

function renderThiefSting(): AudioBuffer {
  return render(0.3, (d, sr) => {
    // A nip: sharp, small, and nasty.
    noise(d, sr, 0, 0.05, 0.9, () => 0.8, (x) => 1 - x);
    mode(d, sr, 0.005, 1900, 0.02, 0.8);
    mode(d, sr, 0.03, 900, 0.05, 0.5);
  });
}

/** Trodden on, it stung them. */
export function thiefSting(vol = 1) {
  play(pick("thief-sting", renderThiefSting, 2), at(0), 0.5 * vol, { wet: 0.06 });
}

function renderSquish(): AudioBuffer {
  return render(0.42, (d, sr) => {
    // A crunch of shell, a wet little pop, a last skitter of its legs.
    noise(d, sr, 0, 0.09, 0.9, () => 0.5, (x) => (1 - x) ** 2);
    mode(d, sr, 0.015, 520, 0.05, 0.9);
    mode(d, sr, 0.03, 240, 0.09, 0.7);
    for (let k = 0; k < 4; k++) mode(d, sr, 0.16 + k * 0.05, rand(2600, 3800), 0.005, 0.14 - k * 0.02);
  });
}

/** Done for. */
export function thiefSquish(vol = 1) {
  play(pick("thief-squish", renderSquish, 2), at(0), 0.5 * vol, { wet: 0.08 });
}
