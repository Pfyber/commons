// The park's soundscape, synthesised: birdsong by day, crickets at night,
// running water near the brook, pond and fountain, wind, and rain when it
// rains. Starts on the first tap (browsers need a gesture for audio) and can
// be muted from the HUD; the choice is remembered.

import { audio } from "../activities/jam";
import type { WeatherKind } from "./weather";

const MUTE_KEY = "commons.muted";

function noiseLoop(a: AudioContext): AudioBufferSourceNode {
  const len = a.sampleRate * 2;
  const b = a.createBuffer(1, len, a.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // Brownish noise: softer than white.
    last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985;
    d[i] = last * 3.5;
  }
  const s = a.createBufferSource();
  s.buffer = b;
  s.loop = true;
  return s;
}

export interface SoundInput {
  /** 0 day … 1 night. */
  dark: number;
  /** 0 … 1: how close running water is. */
  water: number;
  weather: WeatherKind;
  wind: number;
}

export class Soundscape {
  private started = false;
  muted: boolean;
  private master: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private nextBird = 0;
  private nextCricket = 0;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // storage unavailable
    }
    this.muted = m;
    const start = () => {
      this.start();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // storage unavailable
    }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }

  private start() {
    if (this.started) return;
    this.started = true;
    const a = audio();
    this.master = a.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(a.destination);
    const bed = (filter: BiquadFilterType, freq: number, q: number) => {
      const src = noiseLoop(a);
      const f = a.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = a.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master!);
      src.start();
      return g;
    };
    this.waterGain = bed("bandpass", 900, 0.7);
    this.windGain = bed("lowpass", 380, 0.5);
    this.rainGain = bed("highpass", 2500, 0.3);
  }

  update(now: number, s: SoundInput) {
    if (!this.started || !this.master) return;
    const a = audio();
    const t = a.currentTime;
    const ease = (g: GainNode | null, v: number) => g?.gain.setTargetAtTime(v, t, 0.6);
    // A babble that wobbles a little, like water over stones.
    ease(this.waterGain, s.water * (0.32 + 0.08 * Math.sin(now / 700)));
    ease(this.windGain, (0.05 + s.wind * 0.18) * (0.6 + 0.4 * Math.sin(now / 3100)));
    ease(this.rainGain, s.weather === "rain" ? 0.22 : 0);
    if (this.muted) return;

    // Birds by day (fewer in rain), crickets at night.
    if (s.dark < 0.4 && s.weather !== "rain" && now > this.nextBird) {
      this.nextBird = now + 1500 + Math.random() * 4500;
      this.bird(a, t);
    }
    if (s.dark > 0.6 && now > this.nextCricket) {
      this.nextCricket = now + 700 + Math.random() * 900;
      this.cricket(a, t);
    }
  }

  /** A short phrase of chirps. */
  private bird(a: AudioContext, t: number) {
    const pan = a.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master!);
    const base = 2200 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const at = t + i * (0.09 + Math.random() * 0.05);
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sine";
      const f = base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.75), at + 0.07);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      o.connect(g).connect(pan);
      o.start(at);
      o.stop(at + 0.1);
    }
  }

  private cricket(a: AudioContext, t: number) {
    const pan = a.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    pan.connect(this.master!);
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.06;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "triangle";
      o.frequency.value = 4300 + Math.random() * 300;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.025, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      o.connect(g).connect(pan);
      o.start(at);
      o.stop(at + 0.05);
    }
  }

  /** A soft purr (petting the cat). */
  purr() {
    if (!this.started || this.muted) return;
    const a = audio();
    const t = a.currentTime;
    for (let i = 0; i < 6; i++) {
      const at = t + i * 0.22;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sawtooth";
      o.frequency.value = 26 + (i % 2) * 3;
      const f = a.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 220;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.18, at + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.connect(f).connect(g).connect(this.master!);
      o.start(at);
      o.stop(at + 0.22);
    }
  }
}
