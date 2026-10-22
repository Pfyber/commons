// Minimal HUD (spec §16): place name, chat, emote bar, toasts. Large touch
// targets, nothing persistent beyond what's needed.

import { EMOTES, FREE_EMOTES } from "../world/avatars";
import { EMOTE_ICONS, iconUrl, pxIcon } from "./icons";
import { isTyping } from "./panels";

const LOG_LINES = 6;
const LOG_MS = 12_000;

export interface HudHandlers {
  onChat(text: string): void;
  onEmote(id: number): void;
  onSit(): void;
  onRide(): void;
  /** The toys button: pick a toy to play with. */
  onToys(): void;
  onBag(): void;
  onAlbum(): void;
  onFriends(): void;
  onNotifications(): void;
  /** Toggles sound; returns whether it's now muted. */
  onSound(): boolean;
  onTasks(): void;
  onMood(): void;
  onMap(): void;
  /** Your borrowed library books. */
  onBooks(): void;
  /** The phone: call friends, or the call you're in. */
  onPhone(): void;
  /** Your clubs. */
  onClubs(): void;
}

export class Hud {
  private place: HTMLDivElement;
  private nearby: HTMLDivElement;
  private log: HTMLDivElement;
  readonly input: HTMLInputElement;
  private toastEl: HTMLDivElement;
  private sitBtn: HTMLButtonElement;
  private rideBtn: HTMLButtonElement;
  private toysEl: HTMLButtonElement;
  private coinsEl: HTMLDivElement;
  private badgeEl!: HTMLSpanElement;
  private toastTimer = 0;
  private tasksEl: HTMLButtonElement;
  private followEl: HTMLDivElement;
  private moodBtn!: HTMLButtonElement;
  private chatPlaceholder = "";
  private booksBtn!: HTMLButtonElement;
  private phoneBtn!: HTMLButtonElement;
  private clubsBtn!: HTMLButtonElement;

  constructor(root: HTMLElement, h: HudHandlers) {
    root.innerHTML = `
      <div class="top">
        <div class="pill place"></div>
        <div class="top-right">
          <div class="pill coins" title="Coins"></div>
          <button type="button" class="pill btn map-btn" title="City map (C)" aria-label="City map"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("map")}" /></button>
          <button type="button" class="pill btn bag-btn" title="Bag (B)" aria-label="Bag"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("bag")}" /></button>
          <button type="button" class="pill btn album-btn" title="Album (L)" aria-label="Album"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("book")}" /></button>
          <button type="button" class="pill btn friends-btn" title="Friends (F)" aria-label="Friends"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("friends")}" /></button>
          <button type="button" class="pill btn notes-btn" title="Notifications (N)" aria-label="Notifications"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("bell")}" /><span class="badge-count" hidden></span></button>
          <button type="button" class="pill btn clubs-btn" title="Clubs (K)" aria-label="Clubs"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("shield")}" /><span class="badge-count" hidden>!</span></button>
          <button type="button" class="pill btn phone-btn" title="Phone" aria-label="Phone" hidden><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("phone")}" /></button>
          <button type="button" class="pill btn books-btn" title="Your library books" aria-label="Your library books" hidden><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("books")}" /><span class="badge-count"></span></button>
          <button type="button" class="pill btn sound-btn" title="Sound (M)" aria-label="Sound"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("sound")}" /></button>
          <div class="pill nearby" title="People in view"></div>
        </div>
      </div>
      <button type="button" class="pill btn tasks-chip" hidden></button>
      <div class="pill follow-chip" hidden><span></span><button type="button">Stop</button></div>
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
    if (matchMedia("(pointer: coarse)").matches) this.input.placeholder = "Tap to chat";
    this.coinsEl = root.querySelector(".coins")!;
    this.tasksEl = root.querySelector(".tasks-chip")!;
    this.followEl = root.querySelector(".follow-chip")!;
    this.tasksEl.onclick = () => h.onTasks();
    root.querySelector<HTMLButtonElement>(".map-btn")!.onclick = () => h.onMap();
    root.querySelector<HTMLButtonElement>(".bag-btn")!.onclick = () => h.onBag();
    root.querySelector<HTMLButtonElement>(".album-btn")!.onclick = () => h.onAlbum();
    root.querySelector<HTMLButtonElement>(".friends-btn")!.onclick = () => h.onFriends();
    root.querySelector<HTMLButtonElement>(".notes-btn")!.onclick = () => h.onNotifications();
    this.booksBtn = root.querySelector<HTMLButtonElement>(".books-btn")!;
    this.booksBtn.onclick = () => h.onBooks();
    this.phoneBtn = root.querySelector<HTMLButtonElement>(".phone-btn")!;
    this.phoneBtn.onclick = () => h.onPhone();
    this.clubsBtn = root.querySelector<HTMLButtonElement>(".clubs-btn")!;
    this.clubsBtn.onclick = () => h.onClubs();
    this.badgeEl = root.querySelector(".badge-count")!;
    const soundBtn = root.querySelector<HTMLButtonElement>(".sound-btn")!;
    const sound = () => this.setMuted(h.onSound());
    soundBtn.onclick = sound;
    window.addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      if (e.key === "c" || e.key === "C") h.onMap();
      if (e.key === "b" || e.key === "B") h.onBag();
      if (e.key === "l" || e.key === "L") h.onAlbum();
      if (e.key === "f" || e.key === "F") h.onFriends();
      if (e.key === "k" || e.key === "K") h.onClubs();
      if (e.key === "n" || e.key === "N") h.onNotifications();
      if (e.key === "m" || e.key === "M") sound();
      if ((e.key === "r" || e.key === "R") && !this.rideBtn.hidden) h.onRide();
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
    this.moodBtn = document.createElement("button");
    this.moodBtn.type = "button";
    this.moodBtn.className = "mood-btn";
    this.moodBtn.title = "How you'd like company";
    this.moodBtn.setAttribute("aria-label", this.moodBtn.title);
    this.moodBtn.replaceChildren(pxIcon("chat"));
    this.moodBtn.onclick = () => h.onMood();
    bar.appendChild(this.moodBtn);
    this.sitBtn = document.createElement("button");
    this.sitBtn.type = "button";
    this.sitBtn.className = "sit";
    this.sitBtn.onclick = () => h.onSit();
    bar.appendChild(this.sitBtn);
    this.rideBtn = document.createElement("button");
    this.rideBtn.type = "button";
    this.rideBtn.className = "ride-btn";
    this.rideBtn.hidden = true;
    this.rideBtn.onclick = () => h.onRide();
    bar.appendChild(this.rideBtn);
    this.toysEl = document.createElement("button");
    this.toysEl.type = "button";
    this.toysEl.className = "toys-btn";
    this.toysEl.title = "Play with a toy";
    this.toysEl.setAttribute("aria-label", this.toysEl.title);
    this.toysEl.hidden = true;
    this.toysEl.onclick = () => h.onToys();
    bar.appendChild(this.toysEl);
    this.setSitting(false);
    for (const [id, e] of Object.entries(EMOTES).filter(([id]) => Number(id) <= FREE_EMOTES)) {
      const b = document.createElement("button");
      b.type = "button";
      b.append(pxIcon(EMOTE_ICONS[Number(id)] ?? "heart"));
      b.title = `${e.label} (${id})`;
      b.setAttribute("aria-label", e.label);
      b.onclick = () => h.onEmote(Number(id));
      bar.appendChild(b);
    }
  }

  /** The toys button (your toys, to play with): its icon, or null to hide it. */
  setToys(icon: string | null) {
    this.toysEl.hidden = icon === null;
    if (icon === null) return;
    const img = document.createElement("img");
    img.className = "px-icon";
    img.alt = "";
    img.width = 24;
    img.height = 24;
    img.src = icon;
    this.toysEl.replaceChildren(img);
  }

  /** The ride button: what you'd ride (its icon), and whether you're on it; null hides it. */
  setRide(ride: { icon: string; name: string; on: boolean } | null) {
    this.rideBtn.hidden = ride === null;
    if (!ride) return;
    const img = document.createElement("img");
    img.className = "px-icon";
    img.alt = "";
    img.width = 24;
    img.height = 24;
    img.src = ride.icon;
    this.rideBtn.replaceChildren(img);
    this.rideBtn.title = ride.on ? `Get off the ${ride.name} (R)` : `Ride the ${ride.name} (R)`;
    this.rideBtn.setAttribute("aria-label", this.rideBtn.title);
    this.rideBtn.classList.toggle("on", ride.on);
  }

  setSitting(sitting: boolean) {
    this.sitBtn.replaceChildren(pxIcon(sitting ? "stand" : "sit"));
    this.sitBtn.title = sitting ? "Stand up" : "Sit down here";
    this.sitBtn.setAttribute("aria-label", this.sitBtn.title);
  }

  setPlace(name: string, instance: number) {
    this.place.textContent = `${name} · ${instance}`;
  }

  setBadge(n: number) {
    this.badgeEl.hidden = n === 0;
    this.badgeEl.textContent = n > 9 ? "9+" : String(n);
  }

  /** Shows the current sound state on the button. */
  setMuted(muted: boolean) {
    const img = document.querySelector<HTMLImageElement>(".sound-btn img");
    if (img) img.src = iconUrl(muted ? "mute" : "sound");
  }

  /** Shows the current mood on its button. */
  setMood(icon: string, on: boolean) {
    this.moodBtn.title = on ? `Your sign: ${icon}` : "How you'd like company";
    this.moodBtn.classList.toggle("on", on);
  }

  /** A hint in the chat box (e.g. "only people here can hear you"); null restores it. */
  setChatHint(text: string | null) {
    if (!this.chatPlaceholder) this.chatPlaceholder = this.input.placeholder;
    this.input.placeholder = text ?? this.chatPlaceholder;
    this.input.classList.toggle("whisper", text !== null);
  }

  /** "Following Ana · Stop" (or who follows you); null hides it. */
  setFollow(text: string | null, buttonLabel = "Stop", onButton?: () => void) {
    this.followEl.hidden = text === null;
    if (text === null) return;
    this.followEl.querySelector("span")!.textContent = text;
    const b = this.followEl.querySelector("button")!;
    b.textContent = buttonLabel;
    b.onclick = () => onButton?.();
  }

  /** The Caretaker's tasks chip under the place name; null hides it. */
  /** The phone button: shown once you own a phone; lit while you're on a call. */
  setPhone(owned: boolean, live: boolean) {
    this.phoneBtn.hidden = !owned;
    this.phoneBtn.classList.toggle("live", live);
  }

  /** The clubs button: a mark while an invite waits or a club's rent is due. */
  setClubs(attention: boolean) {
    this.clubsBtn.querySelector<HTMLElement>(".badge-count")!.hidden = !attention;
  }

  /** The books button, with how many you have out (hidden with none). */
  setBooks(n: number) {
    this.booksBtn.hidden = n === 0;
    this.booksBtn.querySelector(".badge-count")!.textContent = String(n);
  }

  setTasks(text: string | null) {
    this.tasksEl.hidden = text === null;
    if (text !== null) this.tasksEl.textContent = text;
  }

  setCoins(n: number) {
    this.coinsEl.replaceChildren(pxIcon("coin"), document.createTextNode(String(n)));
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
