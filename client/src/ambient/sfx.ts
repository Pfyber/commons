// Little sound effects, synthesised like the rest (no sample files): the
// fishing line plopping in and a fish splashing out, pool on the tavern's
// table, and the soft rumble of a skateboard. They share the HUD's mute
// (Soundscape).
//
// The pool sounds are rendered sample by sample, the way the real thing
// makes them: a ball's clack is a sharp impulse ringing a few stiff,
// inharmonic modes for a few milliseconds. Each comes in a few variants,
// rendered once, and plays through a touch of room echo.

import { audio, setNotesMuted } from "../activities/jam";

let muted = false;
let out: GainNode | null = null;
let room: ConvolverNode | null = null;
let noise: AudioBuffer | null = null;

/** Mirrors the HUD's sound toggle. */
export function setSfxMuted(m: boolean) {
  muted = m;
  // The instruments (the fairground's, the bandstand's) go quiet too.
  setNotesMuted(m);
  if (out) out.gain.value = m ? 0 : 1;
  if (m) {
    skate.stop();
    poolRoll.stop();
  }
}

/** The effects' output, or null while muted. */
function bus(): GainNode | null {
  if (muted) return null;
  const a = audio();
  if (!out) {
    out = a.createGain();
    out.connect(a.destination);
    room = a.createConvolver();
    room.buffer = roomEcho(a);
    room.connect(out);
  }
  return out;
}

/** A small room's echo: half a second of dark, decaying noise. */
function roomEcho(a: AudioContext): AudioBuffer {
  const len = Math.floor(a.sampleRate * 0.6);
  const b = a.createBuffer(2, len, a.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += 0.25 * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-i / (a.sampleRate * 0.11)) * (i < a.sampleRate * 0.008 ? 0 : 1);
    }
  }
  return b;
}

/**
 * Where a sound goes: panned (-1 left … 1 right) into the output, with
 * `wet` of it sent into the room echo too.
 */
function dest(pan = 0, wet = 0): AudioNode | null {
  const o = bus();
  if (!o) return null;
  const a = audio();
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(o);
  if (wet > 0 && room) {
    const g = a.createGain();
    g.gain.value = wet;
    p.connect(g).connect(room);
  }
  return p;
}

/** Plays `buf` at `t`, as loud as `level`, optionally darker (`lowpass` Hz) or re-pitched. */
function play(buf: AudioBuffer, t: number, level: number, opts: { pan?: number; wet?: number; lowpass?: number; rate?: number } = {}) {
  if (level < 0.003) return;
  const d = dest(opts.pan, opts.wet);
  if (!d) return;
  const a = audio();
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate ?? 1;
  const g = a.createGain();
  g.gain.value = level;
  let head: AudioNode = src;
  if (opts.lowpass) {
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = opts.lowpass;
    f.Q.value = 0.5;
    head = head.connect(f);
  }
  head.connect(g).connect(d);
  src.start(t);
}

export const at = (delayMs: number) => audio().currentTime + Math.max(0, delayMs) / 1000;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// ---- rendering sounds sample by sample -------------------------------------

/** A mono buffer `secs` long filled by `fill`, normalised to a peak of 1. */
function render(secs: number, fill: (d: Float32Array, sr: number) => void): AudioBuffer {
  const a = audio();
  const b = a.createBuffer(1, Math.ceil(a.sampleRate * secs), a.sampleRate);
  const d = b.getChannelData(0);
  fill(d, a.sampleRate);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] /= peak;
  return b;
}

/** Adds a decaying sine (one ringing mode) from `t0` s: `tau` s to fall to 1/e. */
function mode(d: Float32Array, sr: number, t0: number, hz: number, tau: number, amp: number) {
  const start = Math.floor(t0 * sr);
  const end = Math.min(d.length, start + Math.floor(tau * 7 * sr));
  const ph = Math.random() * Math.PI * 2;
  for (let i = start; i < end; i++) {
    const t = (i - start) / sr;
    d[i] += amp * Math.exp(-t / tau) * Math.sin(ph + 2 * Math.PI * hz * t);
  }
}

/**
 * Adds a burst of noise from `t0` s decaying with `tau`; `tone` 0 is dull
 * (low-passed), 1 bright (high-passed). Starts at full strength: a hit.
 */
function hit(d: Float32Array, sr: number, t0: number, tau: number, amp: number, tone: number) {
  const start = Math.floor(t0 * sr);
  const end = Math.min(d.length, start + Math.floor(tau * 7 * sr));
  // One-pole filter: dull tones keep what's below ~250 Hz…1.7 kHz; bright
  // ones take away what's below ~150 Hz…3 kHz.
  const bright = tone > 0.5;
  const k = bright ? 0.02 + (tone - 0.5) * 0.8 : 0.03 + tone * 0.4;
  let lp = 0;
  for (let i = start; i < end; i++) {
    const n = Math.random() * 2 - 1;
    lp += k * (n - lp);
    const s = bright ? n - lp : lp * 2;
    d[i] += amp * Math.exp(-(i - start) / sr / tau) * s;
  }
}

/** A few variants of each sound, rendered once on first use. */
const variants = new Map<string, AudioBuffer[]>();
function pick(key: string, make: () => AudioBuffer, n = 4): AudioBuffer {
  let v = variants.get(key);
  if (!v) {
    v = Array.from({ length: n }, make);
    variants.set(key, v);
  }
  return v[Math.floor(Math.random() * v.length)];
}

// ---- fishing -----------------------------------------------------------------

/** The bobber plopping into the water, `delayMs` from now. */
export function splash(vol = 1, delayMs = 0) {
  if (muted) return;
  const t = at(delayMs);
  tone(t, 0.16, 0.22 * vol, "sine", 520, 180);
  burst(t, 0.3, 0.2 * vol, "bandpass", 1400, 500, 0.8);
  burst(t + 0.05, 0.22, 0.06 * vol, "highpass", 3500);
}

/** A tug on the line: a little bloop. */
export function nibble(vol = 1) {
  if (muted) return;
  const t = at(0);
  tone(t, 0.09, 0.14 * vol, "sine", 300, 620);
  tone(t + 0.11, 0.09, 0.1 * vol, "sine", 300, 620);
}

/** A fish pulled out of the water, and a happy little chime. */
export function landed(vol = 1, rarity = 0) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.28, 0.18 * vol, "highpass", 1200, 2600);
  tone(t, 0.12, 0.12 * vol, "sine", 260, 700);
  [784, 988, 1175, 1568].forEach((hz, i) => {
    tone(t + 0.12 + i * 0.08, 0.35, 0.09 * vol, "triangle", hz);
  });
  // Rarer catches get a bigger celebration on top, after the chime.
  if (rarity >= 2) celebrate(t + 0.45, vol, rarity);
}

/** A bright brassy note: a sawtooth, its brightness swelling then mellowing. */
function brass(t: number, hz: number, len: number, level: number) {
  const o = bus();
  if (!o || level < 0.002) return;
  const a = audio();
  for (const detune of [-6, 6]) {
    const osc = a.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = hz;
    osc.detune.value = detune;
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(hz * 1.5, t);
    f.frequency.linearRampToValueAtTime(hz * 6, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(hz * 2.5, t + len);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.03);
    g.gain.setValueAtTime(level, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(f).connect(g).connect(o);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }
}

/** A bell: a pure note with a high partial, ringing out. */
function bell(t: number, hz: number, level: number, len = 1.2) {
  tone(t, len, level, "sine", hz);
  tone(t, len * 0.5, level * 0.4, "sine", hz * 2.76);
  tone(t, len * 0.25, level * 0.25, "sine", hz * 5.4);
}

/**
 * The fanfare for a rare catch, growing with rarity: rare gets a sparkly
 * run of bells; epic a brassy "ta-da!"; legendary a full fanfare with a
 * cymbal; mythical a drumroll first, then a triumphant chord climb, a
 * cascade of bells and a shimmer that hangs in the air.
 */
function celebrate(t: number, vol: number, rarity: number) {
  const v = vol;
  // A shimmer of high notes (pentatonic, so it always sounds happy).
  const shimmer = (at: number, n: number, gap: number, level: number) => {
    const scale = [1568, 1760, 2093, 2349, 2637, 3136, 3520];
    for (let i = 0; i < n; i++) tone(at + i * gap, 0.25, level * v, "triangle", scale[(i * 3 + rarity) % scale.length]);
  };
  if (rarity === 2) {
    [1047, 1319, 1568, 2093].forEach((hz, i) => bell(t + i * 0.07, hz, 0.06 * v, 0.8));
    shimmer(t + 0.3, 6, 0.045, 0.035);
    return;
  }
  let at = t;
  if (rarity >= 5) {
    // A drumroll, speeding up and swelling…
    let k = 0;
    for (let d = 0; d < 0.9; k++) {
      burst(at + d, 0.08, (0.05 + d * 0.18) * v, "bandpass", 1800, 1200, 1.5);
      d += Math.max(0.03, 0.09 - k * 0.004);
    }
    tone(at, 0.9, 0.08 * v, "sine", 110, 220);
    at += 0.95;
    // …a crash.
    burst(at, 1.6, 0.22 * v, "highpass", 3000, 6000);
  }
  // "Ta-da-daaa!": up an arpeggio to a held major chord.
  const root = rarity >= 4 ? 523.25 : 392;
  const third = root * 1.26;
  const fifth = root * 1.5;
  brass(at, root, 0.14, 0.05 * v);
  brass(at + 0.13, third, 0.14, 0.05 * v);
  brass(at + 0.26, fifth, 0.14, 0.055 * v);
  for (const hz of [root * 2, third * 2, fifth, root]) brass(at + 0.4, hz, rarity >= 4 ? 1.1 : 0.7, 0.045 * v);
  bell(at + 0.4, root * 4, 0.05 * v, 1.4);
  shimmer(at + 0.45, 8 + rarity * 2, 0.04, 0.03);
  if (rarity >= 4) {
    // A cymbal swell under the chord, then a second, higher "hooray".
    burst(at + 0.38, 1.2, 0.12 * v, "highpass", 4000, 8000);
    const up = at + 1.15;
    for (const hz of [root * 1.335 * 2, root * 1.68 * 2, root * 2 * 2]) brass(up, hz, 0.9, 0.04 * v);
    [2093, 2637, 3136, 4186].forEach((hz, i) => bell(up + 0.05 + i * 0.09, hz, 0.04 * v, 1.2));
  }
  if (rarity >= 5) {
    // The mythical: a key change up for the big finish, a falling cascade of bells, and a long shimmer.
    const fin = at + 2.0;
    for (const hz of [587.33, 739.99, 880, 1174.66]) brass(fin, hz, 1.6, 0.045 * v);
    burst(fin, 2.0, 0.14 * v, "highpass", 5000, 9000);
    [4186, 3520, 3136, 2637, 2349, 2093, 1760, 1568].forEach((hz, i) => bell(fin + 0.1 + i * 0.08, hz, 0.035 * v, 1.6));
    shimmer(fin + 0.7, 24, 0.05, 0.022);
  }
}

/** A fish slapping down onto the bank. */
export function flop(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.12, 0.25 * vol, "lowpass", 900, 300);
  tone(t, 0.08, 0.1 * vol, "sine", 180, 90);
  burst(t + 0.18, 0.06, 0.12 * vol, "bandpass", 1400, 900, 2);
}

/** A smack at a flopping fish: higher with each hit (`hits` so far). */
export function whack(vol = 1, hits = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.07, 0.3 * vol, "lowpass", 1600, 400);
  tone(t, 0.06, 0.12 * vol, "square", 220 + hits * 90, 120 + hits * 60);
  tone(t + 0.02, 0.12, 0.06 * vol, "triangle", 660 + hits * 220);
}

// ---- people together, and emotes -------------------------------------------------

/** A high five: a sharp slap of palms, a thump, and a bright ding. */
export function highFive(vol = 1, delayMs = 0) {
  if (muted) return;
  const t = at(delayMs);
  burst(t, 0.05, 0.45 * vol, "bandpass", 2600, 1800, 1.2);
  burst(t, 0.02, 0.3 * vol, "highpass", 5000);
  tone(t, 0.08, 0.15 * vol, "sine", 160, 90);
  tone(t + 0.04, 0.4, 0.07 * vol, "triangle", 1568);
  tone(t + 0.1, 0.45, 0.06 * vol, "triangle", 2093);
}

/** A hug: a soft rustle of clothes and a warm, rising "aww". */
export function hug(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.35, 0.08 * vol, "lowpass", 700, 300);
  tone(t + 0.15, 0.5, 0.06 * vol, "triangle", 392, 440);
  tone(t + 0.3, 0.7, 0.06 * vol, "triangle", 494, 523);
  tone(t + 0.45, 0.9, 0.05 * vol, "sine", 659);
}

/** Dancing together: a funky little bass riff. */
export function danceRiff(vol = 1) {
  if (muted) return;
  const t = at(0);
  [82, 82, 123, 110, 98, 123].forEach((hz, i) => tone(t + i * 0.12, 0.1, 0.14 * vol, "square", hz));
  [659, 784].forEach((hz, i) => tone(t + 0.36 + i * 0.24, 0.12, 0.05 * vol, "triangle", hz));
}

/** Someone asks you to do something together: a friendly two-note pop. */
export function asked(vol = 1) {
  if (muted) return;
  const t = at(0);
  tone(t, 0.1, 0.08 * vol, "sine", 660, 700);
  tone(t + 0.1, 0.16, 0.08 * vol, "sine", 990, 1000);
}

/** Setting off following someone: two soft footstep ticks and a rising note. */
export function follow(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.04, 0.1 * vol, "bandpass", 900, 700, 2);
  burst(t + 0.16, 0.04, 0.1 * vol, "bandpass", 900, 700, 2);
  tone(t + 0.1, 0.25, 0.05 * vol, "triangle", 523, 659);
}

/** Rock, paper, scissors: a fist pumping down. */
export function fistPump(vol = 1, delayMs = 0) {
  if (muted) return;
  const t = at(delayMs);
  burst(t, 0.06, 0.15 * vol, "lowpass", 600, 200);
  tone(t, 0.06, 0.08 * vol, "sine", 140, 90);
}

/** …and the result: a win, a loss or a draw. */
export function rpsResult(kind: "win" | "lose" | "draw", vol = 1) {
  if (muted) return;
  const t = at(0);
  const notes = kind === "win" ? [523, 659, 784, 1046] : kind === "lose" ? [392, 330, 262] : [523, 523];
  notes.forEach((hz, i) => tone(t + i * 0.1, i === notes.length - 1 ? 0.35 : 0.1, 0.07 * vol, "triangle", hz));
}

/** An emote's little sound (ids as in protocol `emote::*`). */
export function emoteSound(id: number, vol = 1) {
  if (muted || vol <= 0.01) return;
  const t = at(0);
  switch (id) {
    case 1: // wave: a breezy whoosh
      burst(t, 0.3, 0.07 * vol, "bandpass", 800, 2400, 1.5);
      break;
    case 2: // laugh: "ha-ha-ha"
      [700, 640, 580].forEach((hz, i) => tone(t + i * 0.11, 0.08, 0.07 * vol, "square", hz, hz * 0.9));
      break;
    case 3: // clap: three quick claps
      for (let i = 0; i < 3; i++) burst(t + i * 0.16, 0.05, 0.3 * vol, "bandpass", 1600, 1100, 1.5);
      break;
    case 4: // dance: a bar of groove
      [98, 147, 98, 131].forEach((hz, i) => tone(t + i * 0.13, 0.1, 0.1 * vol, "square", hz));
      break;
    case 5: // sleep: a little snore
      tone(t, 0.6, 0.05 * vol, "sawtooth", 90, 70);
      break;
    case 6: // cheer: a rising sparkle, "yay!"
      [523, 659, 784, 1046, 1318].forEach((hz, i) => tone(t + i * 0.06, 0.2, 0.06 * vol, "triangle", hz));
      break;
    case 7: // heart: a soft two-note chime
      tone(t, 0.5, 0.06 * vol, "sine", 784);
      tone(t + 0.14, 0.7, 0.06 * vol, "sine", 1046);
      break;
    case 8: // robot: bleep bloop
      [440, 880, 330, 660].forEach((hz, i) => tone(t + i * 0.09, 0.07, 0.05 * vol, "square", hz));
      break;
  }
}

/** The fish slipping off: a sad two-note drop. */
export function gotAway(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.18, 0.08 * vol, "bandpass", 900, 400);
  tone(t + 0.05, 0.18, 0.08 * vol, "triangle", 440, 420);
  tone(t + 0.24, 0.3, 0.08 * vol, "triangle", 330, 300);
}

// ---- pool ------------------------------------------------------------------------

/** Ball on ball: a hard click ringing a few stiff, high modes very briefly. */
function renderClack(): AudioBuffer {
  return render(0.08, (d, sr) => {
    const k = rand(0.96, 1.04);
    hit(d, sr, 0, 0.0007, 1, 1);
    mode(d, sr, 0, 2950 * k, 0.009, 0.9);
    mode(d, sr, 0, 4420 * k, 0.006, 0.55);
    mode(d, sr, 0, 6230 * k, 0.004, 0.35);
    mode(d, sr, 0, 1680 * k, 0.005, 0.25);
  });
}

/** Cue tip on the cue ball: a softer, woodier "tock". */
function renderStrike(): AudioBuffer {
  return render(0.14, (d, sr) => {
    const k = rand(0.97, 1.03);
    hit(d, sr, 0, 0.0016, 0.8, 0.3);
    mode(d, sr, 0, 1320 * k, 0.008, 0.8);
    mode(d, sr, 0, 2180 * k, 0.005, 0.4);
    mode(d, sr, 0, 3050 * k, 0.003, 0.25);
    // the cue's wood
    mode(d, sr, 0, 210 * k, 0.03, 0.35);
  });
}

/** A ball into the rubber cushion: a muffled thud through the rail. */
function renderCushion(): AudioBuffer {
  return render(0.16, (d, sr) => {
    hit(d, sr, 0, 0.01, 1, 0);
    mode(d, sr, 0, rand(120, 160), 0.035, 0.6);
    mode(d, sr, 0, rand(380, 460), 0.012, 0.25);
  });
}

/**
 * Down a pocket: the thunk as it drops, the rattle as it rolls down the
 * return, and a dull click against the balls already in there.
 */
function renderPocket(): AudioBuffer {
  return render(0.85, (d, sr) => {
    hit(d, sr, 0, 0.012, 0.9, 0);
    mode(d, sr, 0, rand(240, 300), 0.04, 0.8);
    let t = rand(0.12, 0.16);
    let amp = 0.4;
    for (let i = 0; i < 6; i++) {
      hit(d, sr, t, 0.0015, amp * 0.6, 0.4);
      mode(d, sr, t, rand(700, 1000), 0.006, amp);
      t += rand(0.045, 0.085);
      amp *= 0.78;
    }
    t += 0.12;
    hit(d, sr, t, 0.0008, 0.2, 0.7);
    mode(d, sr, t, 2600, 0.006, 0.22);
    mode(d, sr, t, 3900, 0.004, 0.12);
  });
}

/** Table x (0…1000) to stereo pan. */
const panAt = (x: number) => (x / 1000 - 0.5) * 1.2;
const POOL_WET = 0.22;

/** The cue striking the cue ball; `power` 0–1. */
export function cueStrike(power: number, x = 500) {
  if (muted) return;
  const p = Math.min(1, Math.max(0.05, power));
  play(pick("cue", renderStrike), at(0), 0.25 + 0.55 * p, { pan: panAt(x), wet: POOL_WET, lowpass: 2500 + 10000 * p });
}

/** A power shot: the hardest crack of the cue, with a thump you feel. */
export function powerStrike(x = 500) {
  if (muted) return;
  const t = at(0);
  play(pick("cue", renderStrike), t, 1, { pan: panAt(x), wet: POOL_WET * 1.5 });
  play(pick("clack", renderClack, 6), t, 0.6, { pan: panAt(x), wet: POOL_WET * 1.5 });
  tone(t, 0.25, 0.3, "sine", 120, 45);
  burst(t, 0.18, 0.25, "lowpass", 1800, 200);
}

/** Two balls clacking; `speed` (table units a second) of the hit, at table `x`. */
export function ballClack(speed: number, x = 500) {
  if (muted) return;
  const v = Math.min(1, speed / 1100);
  if (v < 0.01) return;
  // Soft kisses are quiet and darker; a hard break is loud and bright.
  play(pick("clack", renderClack, 6), at(0), 0.05 + 0.75 * v ** 0.8, {
    pan: panAt(x),
    wet: POOL_WET,
    lowpass: 2200 + 14000 * v,
    rate: rand(0.97, 1.03),
  });
}

/** A ball thumping into a cushion. */
export function cushion(speed: number, x = 500) {
  if (muted) return;
  const v = Math.min(1, speed / 1100);
  if (v < 0.03) return;
  play(pick("cushion", renderCushion), at(0), 0.5 * v ** 0.8, { pan: panAt(x), wet: POOL_WET });
}

/** A ball dropping into a pocket and rattling down the return. */
export function pocket(x = 500) {
  if (muted) return;
  play(pick("pocket", renderPocket, 3), at(0), 0.55, { pan: panAt(x), wet: POOL_WET });
}

/** The low hush of balls rolling over the cloth, as loud as they're quick. */
class ClothRoll {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  /** Called every frame with the balls' combined speed (0 when still). */
  update(speed: number) {
    const level = Math.min(0.18, speed / 9000);
    if (level < 0.004 || muted) return this.stop();
    if (!this.src) this.start();
    if (this.gain) this.gain.gain.setTargetAtTime(level, audio().currentTime, 0.05);
  }

  private start() {
    const d = dest(0, POOL_WET);
    if (!d) return;
    const a = audio();
    const src = a.createBufferSource();
    src.buffer = noiseBuffer(a);
    src.loop = true;
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const g = a.createGain();
    g.gain.value = 0.0001;
    src.connect(lp).connect(g).connect(d);
    src.start();
    this.src = src;
    this.gain = g;
  }

  stop() {
    if (!this.src || !this.gain) return;
    const t = audio().currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0.0001, t, 0.06);
    this.src.stop(t + 0.3);
    this.src = null;
    this.gain = null;
  }
}

export const poolRoll = new ClothRoll();

// ---- skateboard ----------------------------------------------------------------

function noiseBuffer(a: AudioContext): AudioBuffer {
  if (!noise) {
    noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** A shaped burst of filtered noise. */
export function burst(t: number, len: number, level: number, type: BiquadFilterType, from: number, to = from, q = 1) {
  const o = bus();
  if (!o || level < 0.002) return;
  const a = audio();
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  if (to !== from) f.frequency.exponentialRampToValueAtTime(to, t + len);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(o);
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.02);
}

/** A pitched blip that glides from `from` to `to` Hz. */
export function tone(t: number, len: number, level: number, type: OscillatorType, from: number, to = from) {
  const o = bus();
  if (!o || level < 0.002) return;
  const a = audio();
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + len);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(o);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

/** The wheels' quiet rumble while you ride, and the odd clack over a crack. */
class SkateRoll {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private nextClack = 0;

  /** Called every frame: whether your board is rolling. */
  update(rolling: boolean, now: number) {
    if (!rolling || muted) return this.stop();
    if (!this.src) this.start();
    if (now > this.nextClack) {
      this.nextClack = now + 350 + Math.random() * 600;
      const t = at(0);
      burst(t, 0.035, 0.035, "bandpass", 1800, 1400, 3);
      tone(t, 0.04, 0.025, "sine", 180, 120);
    }
  }

  private start() {
    const o = bus();
    if (!o) return;
    const a = audio();
    const src = a.createBufferSource();
    src.buffer = noiseBuffer(a);
    src.loop = true;
    // Low grit: a rolling hum, kept quiet.
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    const bp = a.createBiquadFilter();
    bp.type = "peaking";
    bp.frequency.value = 160;
    bp.gain.value = 8;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.07, a.currentTime + 0.15);
    src.connect(lp).connect(bp).connect(g).connect(o);
    src.start();
    this.src = src;
    this.gain = g;
  }

  stop() {
    if (!this.src || !this.gain) return;
    const a = audio();
    this.gain.gain.cancelScheduledValues(a.currentTime);
    this.gain.gain.setValueAtTime(this.gain.gain.value, a.currentTime);
    this.gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.2);
    this.src.stop(a.currentTime + 0.25);
    this.src = null;
    this.gain = null;
  }
}

export const skate = new SkateRoll();
// Frames stop in a background tab; so should the rumble and the rolling.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      skate.stop();
      poolRoll.stop();
    }
  });
}

// ---- bowling -----------------------------------------------------------------

/** A bowling ball down the lane: a low rolling rumble, louder the harder it goes. */
export function bowlRoll(ms: number, power: number, vol = 1) {
  if (muted) return;
  const t = at(0);
  const len = ms / 1000;
  burst(t, len, (0.05 + 0.07 * power) * vol, "lowpass", 180, 320, 1.5);
  tone(t, len, 0.05 * vol, "sine", 55, 75);
}

/** The ball meets the pins: a wooden crash, bigger the more go down. */
export function pinsCrash(n: number, vol = 1) {
  if (muted) return;
  const t = at(0);
  const k = Math.min(1, n / 10);
  burst(t, 0.12, (0.25 + 0.35 * k) * vol, "bandpass", 1400, 900, 1.2);
  for (let i = 0; i < Math.min(8, n); i++) burst(t + 0.03 + i * 0.035, 0.07, 0.12 * vol, "bandpass", 1800 + ((i * 397) % 900), 1200, 3);
  tone(t, 0.25, 0.08 * vol, "triangle", 220, 120);
}

/** A strike: the alley's jingle. */
export function strikeCheer(vol = 1) {
  if (muted) return;
  const t = at(150);
  [523, 659, 784, 1046, 784, 1046].forEach((hz, i) => tone(t + i * 0.08, i === 5 ? 0.4 : 0.1, 0.07 * vol, "square", hz));
}

// ---- the arena ---------------------------------------------------------------

/** A sword swung through the air: a quick whoosh, higher for a high swing. */
export function swordSwing(height: number, vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.18, 0.12 * vol, "bandpass", 900 + height * 500, 2600 + height * 600, 2);
}

/** Steel on flesh (well, padding): a dull thud and a grunt. */
export function swordHit(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.09, 0.4 * vol, "lowpass", 900, 300);
  tone(t, 0.12, 0.14 * vol, "square", 180, 90);
}

/** Blades meeting: a bright ringing clang. */
export function swordClang(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.05, 0.35 * vol, "highpass", 3000);
  for (const hz of [1870, 2490, 3320]) tone(t, 0.5, 0.05 * vol, "triangle", hz, hz * 0.99);
}

/** A parry: a sharp ping off the shield. */
export function swordParry(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.04, 0.3 * vol, "bandpass", 2400, 2400, 3);
  tone(t, 0.3, 0.08 * vol, "sine", 1568, 1480);
}

/** Dizzy: a wobbling, falling whistle. */
export function dizzy(vol = 1) {
  if (muted) return;
  const t = at(0);
  for (let i = 0; i < 3; i++) tone(t + i * 0.12, 0.12, 0.06 * vol, "sine", 900 - i * 120, 700 - i * 120);
}

/** The crowd roars (a win, a knockout). */
export function crowdRoar(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 1.4, 0.16 * vol, "bandpass", 500, 900, 0.7);
  burst(t + 0.1, 1.2, 0.1 * vol, "bandpass", 1300, 1700, 0.8);
}
