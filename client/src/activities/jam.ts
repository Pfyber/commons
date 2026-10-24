// The bandstand jam (server: zone instance/play.rs). Eight pads on a
// pentatonic scale, so any notes sound good together; every note lands on a
// shared beat (server time / BEAT_MS), so people play in time without trying.
// Sound is synthesised with WebAudio: no samples to load.

import { el, isTyping } from "../ui/panels";
import { pxIcon } from "../ui/icons";

/** Mirrors protocol BEAT_MS and `instrument::*`. */
export const BEAT_MS = 125;
/** Notes land on the first beat at least this far ahead, so they reach
 * people nearby before it sounds (and still feel immediate to the player). */
const LEAD_MS = 90;
export const INSTRUMENTS = [
  { id: 0, name: "Bells", icon: "🔔" },
  { id: 1, name: "Bass", icon: "🎸" },
  { id: 2, name: "Drums", icon: "🥁" },
  // From the mall's Music shop.
  { id: 3, name: "Ukulele", icon: "🪕" },
  { id: 4, name: "Kalimba", icon: "🎼" },
  { id: 5, name: "Flute", icon: "🪈" },
];
/** Everyone can play these; the rest need the instrument. */
const FREE_INSTRUMENTS = 2;
const DRUM_NAMES = ["Kick", "Snare", "Hat", "Open", "Clap", "Low tom", "High tom", "Shaker"];
/** C major pentatonic, two octaves' worth of steps (semitones from C). */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const NOTE_NAMES = ["C", "D", "E", "G", "A", "C", "D", "E"];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8"];

let ctx: AudioContext | null = null;
/** The shared audio context, created on first use (needs a user gesture). */
export function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noiseBuffer(a: AudioContext): AudioBuffer {
  const b = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let noise: AudioBuffer | null = null;

/** The HUD's sound toggle: muted, nobody's notes play (yours or anyone's nearby). */
let notesMuted = false;
export function setNotesMuted(m: boolean) {
  notesMuted = m;
}

/** Plays one note at audio time `when` with loudness `vol` (0–1). */
export function playNote(instrument: number, pitch: number, when: number, vol: number) {
  if (notesMuted || vol <= 0.01) return;
  const a = audio();
  const out = a.createGain();
  out.connect(a.destination);
  const freq = (base: number) => base * 2 ** (SCALE[pitch] / 12);
  const env = (g: GainNode, peak: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak * vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  };
  if (instrument === 0) {
    // Bells: a sine with a soft octave partial.
    for (const [mult, peak] of [
      [1, 0.28],
      [2, 0.08],
    ]) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sine";
      o.frequency.value = freq(523.25) * mult;
      env(g, peak, 1.4);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 1.5);
    }
  } else if (instrument === 3) {
    // Ukulele: two bright plucks a hair apart.
    for (const [detune, delay] of [
      [0, 0],
      [4, 0.012],
    ]) {
      const o = a.createOscillator();
      const f = a.createBiquadFilter();
      const g = a.createGain();
      o.type = "triangle";
      o.frequency.value = freq(392) * 2 ** (detune / 1200);
      f.type = "lowpass";
      f.frequency.value = 2600;
      g.gain.setValueAtTime(0.0001, when + delay);
      g.gain.exponentialRampToValueAtTime(0.32 * vol, when + delay + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + delay + 0.55);
      o.connect(f).connect(g).connect(out);
      o.start(when + delay);
      o.stop(when + delay + 0.6);
    }
  } else if (instrument === 4) {
    // Kalimba: a soft sine with a quick, metallic overtone.
    for (const [mult, peak, decay] of [
      [1, 0.3, 1.1],
      [5.4, 0.05, 0.15],
    ]) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sine";
      o.frequency.value = freq(523.25) * mult;
      env(g, peak, decay);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + decay + 0.1);
    }
  } else if (instrument === 5) {
    // Flute: a breathy sine that swells in, with a little vibrato.
    const o = a.createOscillator();
    const lfo = a.createOscillator();
    const depth = a.createGain();
    const g = a.createGain();
    o.type = "sine";
    o.frequency.value = freq(523.25);
    lfo.frequency.value = 5.5;
    depth.gain.value = 4;
    lfo.connect(depth).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.25 * vol, when + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.75);
    o.connect(g).connect(out);
    o.start(when);
    lfo.start(when);
    o.stop(when + 0.8);
    lfo.stop(when + 0.8);
  } else if (instrument === 1) {
    // Bass: a filtered triangle two octaves down.
    const o = a.createOscillator();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    o.type = "triangle";
    o.frequency.value = freq(130.81);
    f.type = "lowpass";
    f.frequency.value = 900;
    env(g, 0.5, 0.6);
    o.connect(f).connect(g).connect(out);
    o.start(when);
    o.stop(when + 0.7);
  } else {
    // Drums: a pitched body and/or a noise burst per pad.
    noise ??= noiseBuffer(a);
    const body = [55, 180, 0, 0, 0, 90, 140, 0][pitch];
    const hiss = [0, 0.35, 0.05, 0.25, 0.18, 0, 0, 0.12][pitch];
    if (body) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.setValueAtTime(body * 2.2, when);
      o.frequency.exponentialRampToValueAtTime(body, when + 0.08);
      env(g, pitch === 0 ? 0.9 : 0.45, pitch === 0 ? 0.35 : 0.25);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.4);
    }
    if (hiss) {
      const s = a.createBufferSource();
      const f = a.createBiquadFilter();
      const g = a.createGain();
      s.buffer = noise;
      f.type = pitch === 1 || pitch === 4 ? "bandpass" : "highpass";
      f.frequency.value = pitch === 1 ? 1800 : pitch === 4 ? 1200 : 7000;
      env(g, pitch === 4 ? 0.5 : 0.3, hiss);
      s.connect(f).connect(g).connect(out);
      s.start(when);
      s.stop(when + hiss + 0.05);
    }
  }
}

/** Audio time for server beat `beat`, given the current server time. */
export function beatTime(beat: number, serverNow: number): number | null {
  const ahead = (beat * BEAT_MS - serverNow) / 1000;
  if (ahead < -0.4) return null; // too late to be in time: drop it
  return audio().currentTime + Math.max(0, ahead);
}

export interface JamHost {
  serverNow(): number;
  send(instrument: number, pitch: number, beat: number): void;
  /** A little note above your own head. */
  sparkle(): void;
  /** Instruments from the mall you own (their ids). */
  owned(): Set<number>;
}

/** The pads, shown while you're at the bandstand. */
export class JamPanel {
  readonly el: HTMLDivElement;
  private instrument = 0;
  private pads: HTMLButtonElement[] = [];
  private keyHandler = (e: KeyboardEvent) => {
    if (isTyping(e) || e.repeat) return;
    const i = KEYS.indexOf(e.key);
    if (i >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.hit(i);
    }
  };

  constructor(private host: JamHost) {
    this.el = el("div", "jam");
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.render();
  }

  get open() {
    return !this.el.hidden;
  }

  show() {
    if (this.open) return;
    this.render();
    this.el.hidden = false;
    audio();
    window.addEventListener("keydown", this.keyHandler, true);
  }

  hide() {
    this.el.hidden = true;
    window.removeEventListener("keydown", this.keyHandler, true);
  }

  destroy() {
    this.hide();
    this.el.remove();
  }

  private hit(pitch: number) {
    const now = this.host.serverNow();
    const beat = Math.ceil((now + LEAD_MS) / BEAT_MS);
    const when = beatTime(beat, now);
    if (when !== null) playNote(this.instrument, pitch, when, 1);
    this.host.send(this.instrument, pitch, beat);
    this.host.sparkle();
    const pad = this.pads[pitch];
    pad.classList.remove("hit");
    void pad.offsetWidth;
    pad.classList.add("hit");
  }

  private render() {
    this.el.replaceChildren();
    const head = el("div", "jam-head");
    head.append(el("strong", "", "🎵 Jam"), el("span", "hint", "Anything you play fits the beat. Keys 1–8."));
    const close = el("button", "x", "");
    close.append(pxIcon("close", 2));
    close.onclick = () => this.hide();
    head.append(close);
    const tabs = el("div", "jam-tabs");
    const mine = this.host.owned();
    for (const ins of INSTRUMENTS.filter((i) => i.id <= FREE_INSTRUMENTS || mine.has(i.id))) {
      const b = el("button", ins.id === this.instrument ? "on" : "", `${ins.icon} ${ins.name}`);
      b.onclick = () => {
        this.instrument = ins.id;
        this.render();
      };
      tabs.append(b);
    }
    const pads = el("div", "jam-pads");
    this.pads = [];
    for (let i = 0; i < 8; i++) {
      const label = this.instrument === 2 ? DRUM_NAMES[i] : NOTE_NAMES[i];
      const p = el("button", `pad p${i}`);
      p.append(el("span", "note", label), el("span", "key", KEYS[i]));
      p.onpointerdown = (e) => {
        e.preventDefault();
        this.hit(i);
      };
      pads.append(p);
      this.pads.push(p);
    }
    this.el.append(head, tabs, pads);
  }
}
