// Little sound effects, synthesised like the rest (no sample files): the
// fishing line plopping in and a fish splashing out, pool on the tavern's
// table, and the soft rumble of a skateboard. They share the HUD's mute
// (Soundscape).
//
// The pool sounds are rendered sample by sample, the way the real thing
// makes them: a ball's clack is a sharp impulse ringing a few stiff,
// inharmonic modes for a few milliseconds. Each comes in a few variants,
// rendered once, and plays through a touch of room echo.

import { audio } from "../activities/jam";

let muted = false;
let out: GainNode | null = null;
let room: ConvolverNode | null = null;
let noise: AudioBuffer | null = null;

/** Mirrors the HUD's sound toggle. */
export function setSfxMuted(m: boolean) {
  muted = m;
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
export function landed(vol = 1) {
  if (muted) return;
  const t = at(0);
  burst(t, 0.28, 0.18 * vol, "highpass", 1200, 2600);
  tone(t, 0.12, 0.12 * vol, "sine", 260, 700);
  [784, 988, 1175, 1568].forEach((hz, i) => {
    tone(t + 0.12 + i * 0.08, 0.35, 0.09 * vol, "triangle", hz);
  });
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
