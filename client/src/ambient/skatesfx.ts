// The skatepark's sounds, synthesised like the rest: urethane wheels
// rumbling over concrete (a joint clacking by now and then), the tail's
// snap of a pop, the board whooshing round in a flip, the slap and clack of
// a landing, the long scrape of a grind (ringing steel on a rail, gritty on a
// ledge's coping), a bail's thud and clatter, and the little chimes that
// count a combo up and the bigger ones that bank it.

import { audio } from "../activities/jam";
import { at, burst, crowdRoar, sfxNoise, sfxOut, sfxScale, tone } from "./sfx";

/** A loop of filtered noise whose loudness and colour follow something (the wheels, a grind). */
class NoiseLoop {
  private src: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private ring: OscillatorNode[] = [];
  private ringGain: GainNode | null = null;

  constructor(
    private type: BiquadFilterType,
    private q: number,
    /** Steel ringing under it (a rail): its partials (Hz). */
    private partials: number[] = [],
  ) {}

  /** Every frame: how loud (0 off) and how bright (Hz). */
  set(level: number, hz: number) {
    if (level <= 0.001) return this.stop();
    const out = sfxOut();
    if (!out) return this.stop();
    const a = audio();
    if (!this.src) {
      const src = a.createBufferSource();
      src.buffer = sfxNoise();
      src.loop = true;
      const f = a.createBiquadFilter();
      f.type = this.type;
      f.Q.value = this.q;
      f.frequency.value = hz;
      const g = a.createGain();
      g.gain.value = 0.0001;
      src.connect(f).connect(g).connect(out);
      src.start(a.currentTime, Math.random() * 0.8);
      this.src = src;
      this.filter = f;
      this.gain = g;
      if (this.partials.length) {
        const rg = a.createGain();
        rg.gain.value = 0.0001;
        rg.connect(out);
        this.ringGain = rg;
        this.ring = this.partials.map((p) => {
          const o = a.createOscillator();
          o.type = "sine";
          o.frequency.value = p;
          o.connect(rg);
          o.start();
          return o;
        });
      }
    }
    const t = a.currentTime;
    this.filter!.frequency.setTargetAtTime(hz, t, 0.04);
    this.gain!.gain.setTargetAtTime(level * sfxScale(), t, 0.05);
    // The rail's ring wavers as it's scraped.
    this.ringGain?.gain.setTargetAtTime(level * 0.18 * (0.7 + Math.random() * 0.6) * sfxScale(), t, 0.03);
  }

  stop() {
    if (!this.src || !this.gain) return;
    const t = audio().currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(Math.max(0.0001, this.gain.gain.value), t);
    this.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    this.src.stop(t + 0.15);
    if (this.ringGain) {
      this.ringGain.gain.cancelScheduledValues(t);
      this.ringGain.gain.setValueAtTime(Math.max(0.0001, this.ringGain.gain.value), t);
      this.ringGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      for (const o of this.ring) o.stop(t + 0.4);
    }
    this.src = null;
    this.filter = null;
    this.gain = null;
    this.ring = [];
    this.ringGain = null;
  }
}

const wheels = new NoiseLoop("bandpass", 0.9);
const wheelsLow = new NoiseLoop("lowpass", 0.7);
const railGrind = new NoiseLoop("bandpass", 5, [1870, 2930, 4410]);
const ledgeGrind = new NoiseLoop("bandpass", 1.6);
let jointAt = 0;

/**
 * Every frame for the skater you are: how fast you're rolling (px/s, 0 in
 * the air or down), whether you're grinding (and what), how far you've come
 * (for the joints in the concrete clacking by).
 */
export function rolling(speed: number, grinding: "" | "rail" | "ledge", travelled: number) {
  const s = Math.min(1, speed / 420);
  if (speed > 8 && !grinding) {
    wheels.set(0.05 + s * 0.12, 260 + s * 900);
    wheelsLow.set(0.06 + s * 0.08, 140 + s * 160);
    // A saw-cut joint every four tiles: clack-clack as the two trucks cross it.
    if (travelled - jointAt > 128) {
      jointAt = travelled;
      const t = at(0);
      tick(t, 0.5 + s * 0.5);
      tick(t + Math.max(0.02, 18 / Math.max(60, speed)), 0.4 + s * 0.4);
    }
  } else {
    wheels.set(0, 0);
    wheelsLow.set(0, 0);
  }
  if (grinding === "rail") railGrind.set(0.16 + s * 0.12, 2600 + s * 1400);
  else railGrind.set(0, 0);
  if (grinding === "ledge") ledgeGrind.set(0.2 + s * 0.1, 900 + s * 700);
  else ledgeGrind.set(0, 0);
}

export function quiet() {
  wheels.stop();
  wheelsLow.stop();
  railGrind.stop();
  ledgeGrind.stop();
}

function tick(t: number, k: number) {
  burst(t, 0.03, 0.05 * k, "bandpass", 2100, 1500, 3);
  tone(t, 0.035, 0.03 * k, "sine", 220, 140);
}

/** A push off: the back foot scuffing the concrete. */
export function push() {
  const t = at(0);
  burst(t, 0.16, 0.05, "bandpass", 700, 400, 0.8);
}

/** The tail snapping on the concrete, and the board leaving it. Harder, the more you crouched. */
export function pop(power: number) {
  const t = at(0);
  burst(t, 0.03, 0.22 + power * 0.08, "highpass", 2400, 1800, 0.8);
  tone(t, 0.07, 0.14, "triangle", 260 + power * 60, 90);
  burst(t + 0.01, 0.09, 0.05, "bandpass", 1200, 500, 1.2);
}

/** The board whooshing round under you. */
export function flip(kind: number) {
  const t = at(0);
  const up = 700 + kind * 120;
  burst(t, 0.2, 0.07, "bandpass", up, up * 2.6, 2.2);
}

/** Wheels back down: a slap and a clack, louder the further you fell. */
export function land(fall: number) {
  const k = Math.min(1, fall / 600);
  const t = at(0);
  tone(t, 0.12, 0.12 + k * 0.12, "sine", 110, 48);
  burst(t, 0.05, 0.12 + k * 0.1, "bandpass", 1500, 900, 1.5);
  burst(t + 0.025, 0.04, 0.08 + k * 0.06, "bandpass", 2200, 1400, 2);
}

/** Onto a rail (a ringing clang) or a ledge (a scrape). */
export function grindOn(kind: "rail" | "ledge") {
  const t = at(0);
  if (kind === "rail") {
    tone(t, 0.25, 0.06, "sine", 1870);
    tone(t, 0.2, 0.04, "sine", 2930);
    burst(t, 0.06, 0.15, "highpass", 3000, 2000, 1);
  } else burst(t, 0.08, 0.15, "bandpass", 1100, 700, 1);
}

/** Into a wall: a thud. */
export function wall(speed: number) {
  const t = at(0);
  tone(t, 0.14, Math.min(0.2, 0.05 + speed / 1500), "sine", 90, 40);
  burst(t, 0.08, 0.1, "lowpass", 600, 200, 0.7);
}

/** A bail: a body hitting the ground, the board clattering off on its own. */
export function bail() {
  const t = at(0);
  tone(t, 0.25, 0.2, "sine", 120, 40);
  burst(t, 0.2, 0.16, "lowpass", 800, 150, 0.7);
  for (let i = 0; i < 4; i++) {
    const tt = t + 0.12 + i * (0.09 + Math.random() * 0.06);
    burst(tt, 0.04, 0.09 / (i + 1), "bandpass", 1800 - i * 200, 1200, 2);
    tone(tt, 0.05, 0.04 / (i + 1), "triangle", 300 - i * 30, 180);
  }
  // "Oof."
  tone(t + 0.02, 0.18, 0.05, "sawtooth", 210, 120);
}

/** A trick added to the combo: a blip, higher the longer the combo's got. */
export function counted(n: number) {
  const t = at(0);
  const hz = 520 * Math.pow(2, Math.min(18, n - 1) / 12);
  tone(t, 0.07, 0.05, "square", hz);
  tone(t + 0.04, 0.06, 0.03, "square", hz * 1.5);
}

/** A combo banked: a little run of notes, bigger for a bigger combo; a roar for a huge one. */
export function banked(pts: number, count: number) {
  const t = at(0);
  const notes = count >= 6 ? [523, 659, 784, 1046, 1318, 1568] : count >= 3 ? [523, 659, 784, 1046] : [659, 784];
  notes.forEach((hz, i) => tone(t + i * 0.06, i === notes.length - 1 ? 0.3 : 0.09, 0.06, "square", hz));
  if (pts >= 5000) crowdRoar(Math.min(1, pts / 20000) * 0.8 + 0.2);
}

/** The special meter full: a shimmer up. */
export function special() {
  const t = at(0);
  [784, 988, 1175, 1568, 1976].forEach((hz, i) => tone(t + i * 0.035, 0.18, 0.04, "triangle", hz));
}

/** Combo lost: a sad little drop. */
export function lost() {
  const t = at(0);
  tone(t, 0.3, 0.06, "square", 392, 196);
}

/** The run's countdown: beep, beep, beep, GO. */
export function countdown(n: number) {
  const t = at(0);
  if (n > 0) tone(t, 0.12, 0.08, "square", 660);
  else tone(t, 0.35, 0.1, "square", 1320);
}

/** Time's up: a horn. */
export function horn() {
  const t = at(0);
  tone(t, 0.6, 0.09, "sawtooth", 330, 320);
  tone(t, 0.6, 0.07, "sawtooth", 415, 410);
}

/**
 * A pump on surf trucks: the urethane hissing round the carve, the deck's
 * flex thumping as it springs back, a little higher the deeper and more in
 * rhythm (`power`, 0–1).
 */
export function pump(power: number) {
  const t = at(0);
  const k = 0.4 + 0.6 * power;
  burst(t, 0.18, 0.06 * k, "bandpass", 900 + power * 500, 2400 + power * 900, 1.4);
  tone(t, 0.09, 0.07 * k, "sine", 95 + power * 30, 60);
}

/** The run's last seconds: a tick each, sharper at the very end. */
export function hurry(n: number) {
  const t = at(0);
  tone(t, 0.06, n <= 3 ? 0.07 : 0.045, "square", n <= 3 ? 990 : 780);
}

/** The run's score counting up on the card: a tiny tick. */
export function tally() {
  tone(at(0), 0.03, 0.025, "square", 1180 + Math.random() * 80);
}
