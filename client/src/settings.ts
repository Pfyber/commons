// The player's settings (the ⚙️ panel): how loud everything is, and how the
// world is drawn. Kept in this browser (localStorage); applied as they change.

export interface Settings {
  /** Volumes, 0–1: everything, then the sound effects, the ambience (birds), the music (instruments, the dance floor). */
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  /** Sharp (the screen's full resolution, the colour grade) or fast (one pixel to one, no grade). */
  quality: "high" | "low";
  /** The weather (rain, mist, cloud shadows), the day turning to night, name tags and speech bubbles, a frame counter. */
  weather: boolean;
  daynight: boolean;
  names: boolean;
  fps: boolean;
}

const KEY = "commons.settings";
const DEFAULTS: Settings = { master: 0.8, sfx: 1, ambience: 0.8, music: 0.8, quality: "high", weather: true, daynight: true, names: true, fps: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // storage unavailable, or junk in it: the defaults
  }
  return { ...DEFAULTS };
}

/** The settings now (read anywhere; change them with `setSettings`). */
export const settings: Settings = load();

const listeners: ((s: Settings) => void)[] = [];

/** Told whenever anything changes (and once now). */
export function onSettings(f: (s: Settings) => void) {
  listeners.push(f);
  f(settings);
}

export function setSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: this session only
  }
  for (const f of listeners) f(settings);
}

/** Back to how it all starts. */
export function resetSettings() {
  setSettings({ ...DEFAULTS });
}
