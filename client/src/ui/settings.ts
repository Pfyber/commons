// The ⚙️ settings panel (from the HUD): sound (mute, and how loud each kind
// of sound is), graphics (sharp or fast, 2D or 3D, the weather, night
// falling, name tags, a frame counter), the keys, and logging out.

import { type Settings, resetSettings, setSettings, settings } from "../settings";
import { Panel, button, el } from "./panels";

const KEYS: [string, string][] = [
  ["WASD / arrows", "Walk (twice quickly: sprint)"],
  ["Enter", "Chat"],
  ["1–8", "Emotes"],
  ["B · L · F · N · K", "Bag · Journal · Friends · Notifications · Clubs"],
  ["M", "City map"],
  ["Esc", "Close what's open"],
];

export class SettingsPanel extends Panel {
  constructor(
    private host: {
      /** Whether sound's off; flips it (returns the new state). */
      muted: () => boolean;
      toggleMute: () => boolean;
      /** Who's signed in, and signing out. */
      name: () => string;
      logout: () => void;
    },
  ) {
    super("⚙️ Settings", "settings");
  }

  render() {
    this.body.replaceChildren();
    const s = settings;
    // ---- sound ----
    this.body.append(el("h4", "set-head", "🔊 Sound"));
    const muted = this.host.muted();
    this.body.append(
      button(muted ? "🔇 Sound is off · turn on" : "🔊 Sound is on · turn off", () => (this.host.toggleMute(), this.render()), muted ? "small" : "small on"),
    );
    const slider = (label: string, key: keyof Settings, hint: string) => {
      const row = el("label", "set-row");
      const value = el("span", "set-val", `${Math.round((s[key] as number) * 100)}%`);
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.value = String(Math.round((s[key] as number) * 100));
      input.disabled = muted;
      input.oninput = () => {
        setSettings({ [key]: Number(input.value) / 100 } as Partial<Settings>);
        value.textContent = `${input.value}%`;
      };
      const name = el("span", "set-name", label);
      name.title = hint;
      row.append(name, input, value);
      this.body.append(row);
    };
    slider("Overall", "master", "Everything at once");
    slider("Effects", "sfx", "Footsteps, splashes, games, the arena…");
    slider("Ambience", "ambience", "Birdsong and the park's background");
    slider("Music", "music", "The bandstand's instruments and the dance floor");
    // ---- graphics ----
    this.body.append(el("h4", "set-head", "🖥️ Graphics"));
    const quality = el("div", "tier-row");
    quality.append(
      button("✨ Sharp", () => (setSettings({ quality: "high" }), this.render()), s.quality === "high" ? "small on" : "small"),
      button("⚡ Fast", () => (setSettings({ quality: "low" }), this.render()), s.quality === "low" ? "small on" : "small"),
    );
    this.body.append(el("p", "hint", "Sharp: full screen resolution and the colour grade. Fast: lighter on older computers and phones."), quality);
    const toggle = (label: string, key: "weather" | "daynight" | "names" | "fps" | "view3d") => {
      const on = s[key];
      this.body.append(button(`${on ? "✅" : "⬜"} ${label}`, () => (setSettings({ [key]: !on } as Partial<Settings>), this.render()), "small set-toggle"));
    };
    const view = el("div", "tier-row");
    view.append(
      button("🗺️ 2D", () => (setSettings({ view3d: false }), this.render()), s.view3d ? "small" : "small on"),
      button("🧊 3D", () => (setSettings({ view3d: true }), this.render()), s.view3d ? "small on" : "small"),
    );
    this.body.append(el("p", "hint", "3D: the camera tilts and the world stands up in perspective. 2D: straight down, as drawn."), view);
    toggle("Weather (rain, mist, cloud shadows)", "weather");
    toggle("Night falls (day and night)", "daynight");
    toggle("Name tags and speech bubbles", "names");
    toggle("Frames per second counter", "fps");
    // ---- keys ----
    this.body.append(el("h4", "set-head", "⌨️ Keys"));
    const keys = el("div", "rows set-keys");
    for (const [k, what] of KEYS) {
      const row = el("div", "row");
      row.append(el("b", "", k), el("span", "name", what));
      keys.append(row);
    }
    this.body.append(keys);
    // ---- account ----
    this.body.append(el("h4", "set-head", "👤 Account"));
    this.body.append(el("p", "hint", `Signed in as ${this.host.name()}.`));
    const out = el("div", "tier-row");
    let sure = false;
    const logout = button("🚪 Log out", () => {
      if (!sure) {
        sure = true;
        logout.textContent = "🚪 Sure? Tap again to log out";
        return;
      }
      this.host.logout();
    }, "small");
    out.append(logout, button("↺ Reset settings", () => (resetSettings(), this.render()), "small"));
    this.body.append(out);
  }
}
