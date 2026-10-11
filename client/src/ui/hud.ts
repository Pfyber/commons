// Minimal HUD (spec §16): place name, chat, emote bar, toasts. Large touch
// targets, nothing persistent beyond what's needed.

import { EMOTES } from "../world/avatars";

const LOG_LINES = 6;
const LOG_MS = 12_000;

export interface HudHandlers {
  onChat(text: string): void;
  onEmote(id: number): void;
  onSit(): void;
  onBag(): void;
  onAlbum(): void;
}

export class Hud {
  private place: HTMLDivElement;
  private nearby: HTMLDivElement;
  private log: HTMLDivElement;
  readonly input: HTMLInputElement;
  private toastEl: HTMLDivElement;
  private sitBtn: HTMLButtonElement;
  private coinsEl: HTMLDivElement;
  private toastTimer = 0;

  constructor(root: HTMLElement, h: HudHandlers) {
    root.innerHTML = `
      <div class="top">
        <div class="pill place"></div>
        <div class="top-right">
          <div class="pill coins" title="Coins"></div>
          <button type="button" class="pill btn bag-btn" title="Bag (B)">🎒</button>
          <button type="button" class="pill btn album-btn" title="Album (L)">📖</button>
          <div class="pill nearby" title="People in view"></div>
        </div>
      </div>
      <div class="toast" role="status" hidden></div>
      <div class="bottom">
        <div class="log" aria-live="polite"></div>
        <form class="chat">
          <input maxlength="140" placeholder="Press Enter to chat" aria-label="Chat message" enterkeyhint="send" />
        </form>
        <div class="emotes" role="toolbar" aria-label="Emotes"></div>
      </div>`;
    this.place = root.querySelector(".place")!;
    this.nearby = root.querySelector(".nearby")!;
    this.log = root.querySelector(".log")!;
    this.input = root.querySelector(".chat input")!;
    this.toastEl = root.querySelector(".toast")!;
    this.coinsEl = root.querySelector(".coins")!;
    root.querySelector<HTMLButtonElement>(".bag-btn")!.onclick = () => h.onBag();
    root.querySelector<HTMLButtonElement>(".album-btn")!.onclick = () => h.onAlbum();
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "b" || e.key === "B") h.onBag();
      if (e.key === "l" || e.key === "L") h.onAlbum();
    });

    const form = root.querySelector<HTMLFormElement>(".chat")!;
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const text = this.input.value.trim();
      if (text) h.onChat(text);
      this.input.value = "";
      this.input.blur();
    };
    this.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.input.blur();
      ev.stopPropagation();
    });

    const bar = root.querySelector(".emotes")!;
    this.sitBtn = document.createElement("button");
    this.sitBtn.type = "button";
    this.sitBtn.className = "sit";
    this.sitBtn.onclick = () => h.onSit();
    bar.appendChild(this.sitBtn);
    this.setSitting(false);
    for (const [id, e] of Object.entries(EMOTES)) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = e.icon;
      b.title = `${e.label} (${id})`;
      b.setAttribute("aria-label", e.label);
      b.onclick = () => h.onEmote(Number(id));
      bar.appendChild(b);
    }
  }

  setSitting(sitting: boolean) {
    this.sitBtn.textContent = sitting ? "🧍" : "🪑";
    this.sitBtn.title = sitting ? "Stand up" : "Sit down here";
    this.sitBtn.setAttribute("aria-label", this.sitBtn.title);
  }

  setPlace(name: string, instance: number) {
    this.place.textContent = `${name} · ${instance}`;
  }

  setCoins(n: number) {
    this.coinsEl.textContent = `🪙 ${n}`;
  }

  setNearby(n: number) {
    this.nearby.textContent = `${n} here`;
  }

  addChat(name: string, text: string, self: boolean) {
    const line = document.createElement("div");
    line.className = self ? "line self" : "line";
    const who = document.createElement("strong");
    who.textContent = name;
    line.append(who, " ", text);
    this.log.appendChild(line);
    while (this.log.childElementCount > LOG_LINES) this.log.firstElementChild!.remove();
    window.setTimeout(() => line.classList.add("old"), LOG_MS);
  }

  toast(text: string, ms = 2500) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  focusChat() {
    this.input.focus();
  }
}
