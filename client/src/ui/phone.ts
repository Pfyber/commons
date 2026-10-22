// The phone (ADR 0013): your friends to call, and the call you're in: who's
// on, who's talking, mute, ring someone else in, hang up. And the card that
// pops up when someone's calling you.

import { type Calls, type Contacts } from "../calls";
import { ApiError } from "../net/api";
import { Panel, button, el } from "./panels";

export class PhonePanel extends Panel {
  private contacts: Contacts | null = null;
  private msg = "";
  private adding = false;
  private busy = false;

  constructor(private calls: Calls) {
    super("📞 Phone", "phone");
    calls.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.load();
  }

  private load() {
    void this.calls
      .contacts()
      .then((c) => {
        this.contacts = c;
        if (this.open) this.render();
      })
      .catch(() => {});
  }

  private async act(f: () => Promise<unknown>) {
    this.busy = true;
    this.msg = "";
    this.render();
    try {
      await f();
    } catch (e) {
      this.msg = e instanceof ApiError ? e.message : "That didn't work. Try again?";
    } finally {
      this.busy = false;
      this.adding = false;
      if (this.open) this.render();
      this.load();
    }
  }

  render() {
    this.body.replaceChildren();
    const calls = this.calls;
    const c = this.contacts;
    if (calls.live) {
      this.body.append(el("h3", "", calls.members.length > 1 ? `On a call · ${calls.members.length}` : "Ringing…"));
      const list = el("div", "rows call-members");
      for (const m of calls.members) {
        const row = el("div", "row");
        const talking = calls.speaking.has(m.id);
        row.append(el("span", talking ? "talk on" : "talk", talking ? "🔊" : "🔈"), el("span", "name", m.name));
        list.append(row);
      }
      this.body.append(list);
      if (!calls.micOk) this.body.append(el("p", "hint", "🎙️ Your microphone is blocked, so you can listen only. Allow it in the browser to talk."));
      const actions = el("div", "call-actions");
      actions.append(
        button(calls.muted ? "🎙️ Unmute" : "🔇 Mute", () => calls.toggleMute(), "small"),
        button("➕ Add someone", () => {
          this.adding = !this.adding;
          this.render();
        }, "small"),
        button("Hang up", () => void this.act(() => calls.hangUp()), "small hang-up"),
      );
      this.body.append(actions);
      if (!this.adding) {
        if (this.msg) this.body.append(el("p", "error", this.msg));
        return;
      }
    }
    if (!c) {
      this.body.append(el("p", "hint", "Dialling up your contacts…"));
      return;
    }
    if (c.switch) {
      // Under 16, once calls are open to them: their own switch.
      const row = el("label", "row voice-switch");
      const box = el("input");
      box.type = "checkbox";
      box.checked = c.voice_ok;
      box.onchange = () => void this.act(() => calls.setVoiceOk(box.checked));
      row.append(box, el("span", "name", "Phone calls with my friends"));
      this.body.append(row);
    }
    if (!c.can_call) {
      this.body.append(el("p", "hint", c.why ?? "Calls aren't available."));
      return;
    }
    this.body.append(el("p", "hint", calls.live ? "Ring a friend into this call:" : "Call a friend who has a phone. Anyone on the call can ring more friends in, up to eight."));
    const list = el("div", "rows");
    const inCall = new Set(calls.members.map((m) => m.id));
    const friends = [...c.friends].sort((a, b) => Number(b.callable) - Number(a.callable) || a.name.localeCompare(b.name));
    for (const f of friends) {
      if (inCall.has(f.id)) continue;
      const row = el("div", "row");
      const name = el("span", "name");
      name.append(el("strong", "", f.name), el("span", "hint", f.callable ? (f.online ? " · around" : "") : ` · ${f.why ?? ""}`));
      const b = button(calls.live ? "Ring in" : "📞 Call", () => void this.act(() => calls.ring(f.id)), "small");
      b.disabled = !f.callable || this.busy;
      row.append(name, b);
      list.append(row);
    }
    if (!friends.length) list.append(el("p", "empty", "Make some friends first: tap someone to add them."));
    this.body.append(list);
    if (this.msg) this.body.append(el("p", "error", this.msg));
  }
}

/** The card that pops up while someone's calling you. */
export class IncomingCall {
  readonly el = el("div", "incoming-call");

  constructor(private calls: Calls) {
    this.el.hidden = true;
    document.body.appendChild(this.el);
    calls.onChange(() => this.render());
  }

  private render() {
    const r = this.calls.ringing;
    this.el.hidden = !r;
    if (!r) return;
    this.el.replaceChildren();
    const others = r.members.filter((m) => m.id !== r.fromId).map((m) => m.name);
    const who = el("div", "who");
    who.append(el("strong", "", `📞 ${r.fromName} is calling`), el("span", "hint", others.length ? `with ${others.join(", ")}` : this.calls.live ? "Answering leaves your call" : ""));
    const answer = button("Answer", () => void this.calls.answer(true).catch((e) => this.calls.onToast(e instanceof ApiError ? e.message : "Couldn't pick up.")), "answer");
    const decline = button("Decline", () => void this.calls.answer(false), "decline");
    this.el.append(who, answer, decline);
  }
}
