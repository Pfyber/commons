// The Dance Off's music: a funky loop synthesised on the spot (Web Audio, no
// files), 120 BPM to match the chart (arcade BEAT_MS), starting on the
// dance's first beat. Kick, snare on two and four, hats, a syncopated slap
// bass in E minor and offbeat chord stabs; the seed picks the bass line.

import { BEAT_MS, DANCE_BEATS, rng } from "./arcade-shared";

const SIXTEENTH = BEAT_MS / 4 / 1000;
/** Bass lines (semitones above E1, -1 rests), sixteen steps a bar. */
const BASS = [
  [0, -1, 0, 12, -1, 10, -1, 7, 0, -1, 0, -1, 3, -1, 5, 7],
  [0, -1, -1, 0, 12, -1, 0, -1, 3, -1, 3, 5, -1, 7, 10, -1],
  [0, 0, -1, 7, -1, 0, 10, -1, 0, -1, 12, -1, 7, 5, 3, -1],
];
/** E minor 9 and A13, the stabs' two chords (Hz). */
const CHORDS = [
  [164.8, 196.0, 246.9, 293.7, 370.0],
  [220.0, 277.2, 329.6, 392.0, 493.9],
];

export class DanceMusic {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private timer = 0;
  private noise: AudioBuffer | null = null;

  constructor(private muted: () => boolean) {}

  /** Plays from `delayMs` from now (the dance's start) for the whole dance. */
  start(delayMs: number, seed: number) {
    this.stop();
    if (this.muted()) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const bass = BASS[Math.floor(rng(seed)() * BASS.length)];
    const t0 = ctx.currentTime + Math.max(0, delayMs) / 1000;
    const steps = DANCE_BEATS * 4;
    let next = 0;
    // Schedule a little ahead, a few times a second.
    const pump = () => {
      if (!this.ctx) return;
      while (next < steps && t0 + next * SIXTEENTH < this.ctx.currentTime + 0.4) {
        this.play(next, t0 + next * SIXTEENTH, bass);
        next++;
      }
      if (next >= steps) return;
      this.timer = window.setTimeout(pump, 100);
    };
    pump();
  }

  stop() {
    window.clearTimeout(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  private play(step: number, t: number, bass: number[]) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    // A bar of count-in hats, then the groove.
    if (step < 16) {
      if (s % 4 === 0) this.hat(t, 0.3);
      return;
    }
    if (s === 0 || s === 8 || s === 10) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.22 : 0.12);
    const n = bass[s];
    if (n >= 0) this.bass(t, 41.2 * 2 ** (n / 12));
    if (s === 6 || s === 14) this.stab(t, CHORDS[bar % 4 === 3 ? 1 : 0]);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private burst(t: number, len: number, level: number, filter: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  private snare(t: number) {
    this.burst(t, 0.18, 0.5, "bandpass", 1800);
  }

  private hat(t: number, level: number) {
    this.burst(t, 0.05, level, "highpass", 7000);
  }

  private bass(t: number, hz: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = hz;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(f).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.22);
  }

  private stab(t: number, chord: number[]) {
    const ctx = this.ctx!;
    for (const hz of chord) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g).connect(this.out!);
      o.start(t);
      o.stop(t + 0.16);
    }
  }
}
