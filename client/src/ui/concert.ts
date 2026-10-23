// The Concert Hall's stage panel (ADR 0015), at the microphone stand: who's
// on and for how long, taking the stage (16 and over) or stepping down, and
// for listeners how loud it is.

import { type Concert, timeLeft } from "../concert";
import { ApiError } from "../net/api";
import { Panel, button, el } from "./panels";

export interface ConcertHost {
  /** Up onto the stage (where the performer stands). */
  walkOnStage(): void;
  toast(text: string): void;
}

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "That didn't work.");

export class ConcertPanel extends Panel {
  private msg = el("p", "error");
  private busy = false;

  constructor(
    private concert: Concert,
    private host: ConcertHost,
  ) {
    super("🎤 The stage", "concert");
    concert.onChange(() => this.open && this.render());
  }

  render() {
    this.body.replaceChildren();
    const c = this.concert;
    const s = c.stage;
    if (s && c.mine) {
      this.body.append(
        el("p", "concert-live", "🔴 You're on stage"),
        el("p", "", `Everyone in the hall hears you, and only you. ${timeLeft(s)}.`),
        button(
          "Step down",
          () => this.run(c.stepDown(), "🎤 You stepped down. Thanks for the show!"),
          "primary",
        ),
      );
    } else if (s) {
      this.body.append(el("p", "concert-live", `🎤 ${s.name} is on stage`), el("p", "hint", `${timeLeft(s)}. You can only listen while someone's on.`));
      if (c.why) this.body.append(el("p", "hint warn", c.why));
      else {
        const row = el("div", "concert-volume");
        const slider = el("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "1";
        slider.step = "0.05";
        slider.value = String(c.volume);
        slider.oninput = () => c.setVolume(Number(slider.value));
        row.append(el("span", "", "🔈"), slider, button(c.muted ? "Unmute" : "Mute", () => c.toggleMute(), "small"));
        this.body.append(row);
      }
    } else {
      this.body.append(el("p", "", "The stage is free. Sing, play, tell a story or host a quiz: whoever's in the hall hears you, for up to an hour."));
      if (c.status.can_perform) {
        this.body.append(
          button(
            "🎤 Take the stage",
            () => this.run(c.takeStage().then(() => this.host.walkOnStage()), "🎤 You're on! Everyone in the hall can hear you."),
            "primary",
          ),
        );
      } else this.body.append(el("p", "hint warn", c.status.why_not_perform ?? "The hall's sound system is off just now."));
    }
    this.body.append(this.msg);
  }

  private run(p: Promise<unknown>, done: string) {
    if (this.busy) return;
    this.busy = true;
    this.msg.textContent = "";
    p.then(() => this.host.toast(done))
      .catch((e) => (this.msg.textContent = errText(e)))
      .finally(() => {
        this.busy = false;
        if (this.open) this.render();
      });
  }
}
