// The park's soundscape: birdsong by day, synthesised. Starts on the first
// tap (browsers need a gesture for audio) and can be muted from the HUD; the
// choice is remembered.

import { audio } from "../activities/jam";
import { setSfxMuted } from "./sfx";
import type { WeatherKind } from "./weather";

const MUTE_KEY = "commons.muted";

export interface SoundInput {
  /** 0 day … 1 night. */
  dark: number;
  weather: WeatherKind;
}

export class Soundscape {
  private started = false;
  muted: boolean;
  private master: GainNode | null = null;
  private nextBird = 0;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // storage unavailable
    }
    this.muted = m;
    setSfxMuted(m);
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
    setSfxMuted(this.muted);
    return this.muted;
  }

  private start() {
    if (this.started) return;
    this.started = true;
    const a = audio();
    this.master = a.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(a.destination);
  }

  update(now: number, s: SoundInput) {
    if (!this.started || !this.master || this.muted) return;
    // Birds by day, quieter spells in the rain.
    if (s.dark < 0.4 && s.weather !== "rain" && now > this.nextBird) {
      this.nextBird = now + 1500 + Math.random() * 4500;
      this.bird(audio(), audio().currentTime);
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
}
