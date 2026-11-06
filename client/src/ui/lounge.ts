// The café's open voice (ADR 0021): the warning before you go in, and the
// bar along the top while you're inside (who's talking, your microphone,
// turning everyone down, leaving or joining the voice).

import type { Consent, Lounge } from "../lounge";
import { button, el } from "./panels";

/** What the door (and the question inside) says. */
export const CAFE_WARNING =
  "🎙️ Open voice inside: everyone in the café hears everyone, and they'll hear you if your microphone's on. You can mute yourself or leave the voice at any time.";

/** The choices at the door: go in with the microphone on, muted, or stay out. */
export function cafeChoices(go: (c: Consent) => void, stay: () => void): [string, () => void][] {
  return [
    ["🎙️ Go in, microphone on", () => go("mic")],
    ["🔇 Go in, muted (just listen)", () => go("muted")],
    ["🚶 Stay outside", stay],
  ];
}

export class LoungeBar {
  readonly el = el("div", "pill lounge-bar");
  private off: () => void;

  constructor(
    private lounge: Lounge,
    private ask: () => void,
  ) {
    document.body.append(this.el);
    this.off = lounge.onChange(() => this.render());
    this.render();
  }

  render() {
    const l = this.lounge;
    this.el.replaceChildren();
    if (!l.on) {
      this.el.append(el("span", "", "☕ Café voice: off"), button("Join voice", () => this.ask(), "small"));
      return;
    }
    const talking = [...l.speaking].filter(Boolean);
    const who = talking.length ? `🗣️ ${talking.slice(0, 3).join(", ")}${talking.length > 3 ? "…" : ""}` : `👂 ${l.others} listening`;
    this.el.append(
      el("span", "lounge-live", "🔴 Café voice"),
      el("span", "", who),
      button(l.mic ? "🎙️ Mic on" : "🔇 Muted", () => void l.setMic(!l.mic), l.mic ? "small primary" : "small"),
      button(l.deaf ? "🔈 Sound off" : "🔊 Sound on", () => l.setDeaf(!l.deaf), "small"),
      button("Leave voice", () => void l.leave(), "small"),
    );
  }

  destroy() {
    this.off();
    this.el.remove();
  }
}
