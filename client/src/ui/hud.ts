// Minimal HUD (spec §16): place name, chat, emote bar, toasts. Large touch
// targets, nothing persistent beyond what's needed.

import { EMOTES, FREE_EMOTES } from "../world/avatars";
import { onSettings, setSettings, settings } from "../settings";
import { EMOTE_ICONS, iconUrl, pxIcon } from "./icons";
import { isTyping } from "./panels";

const LOG_LINES = 6;
const LOG_MS = 12_000;
/** Where your last emote's kept (the emotes button does it again). */
const LAST_EMOTE_KEY = "commons.emote.last";

/** A little badge on a button's top right corner (the emotes' ▴, the ride's ⚙). */
function corner(cls: string): HTMLElement {
  const c = document.createElement("span");
  c.className = `hud-corner ${cls}`;
  c.setAttribute("aria-hidden", "true");
  return c;
}

/** A button's word, beside its icon (in a tray, where there's room to say what it does). */
function label(text: string): HTMLElement {
  return Object.assign(document.createElement("span"), { className: "tray-label", textContent: text });
}

/** A tray of buttons that opens above the bottom bar: a title (and a note on its right), its buttons, a line under them. */
function tray(title: string, note: string, cls: string): HTMLElement {
  const t = document.createElement("div");
  t.className = `hud-tray ${cls}`;
  t.hidden = true;
  const head = document.createElement("div");
  head.className = "hud-tray-head";
  head.append(Object.assign(document.createElement("strong"), { textContent: title }), Object.assign(document.createElement("span"), { textContent: note }));
  const body = document.createElement("div");
  body.className = "hud-tray-body";
  const foot = document.createElement("div");
  foot.className = "hud-tray-foot";
  foot.hidden = true;
  t.append(head, body, foot);
  return t;
}

export interface HudHandlers {
  onChat(text: string): void;
  onEmote(id: number): void;
  onSit(): void;
  /** The ride button: on (or off) the ride you've picked. */
  onRide(): void;
  /** The ride button's ⚙: which of your rides it gets you on. */
  onRidePick(): void;
  /** The toys button: pick a toy to play with. */
  onToys(): void;
  onBag(): void;
  onAlbum(): void;
  onFriends(): void;
  /** The day's missions (skating, fishing…), and the bonus for doing them all. */
  onDaily(): void;
  onNotifications(): void;
  /** Toggles sound; returns whether it's now muted. */
  onSound(): boolean;
  /** The ⚙️ settings. */
  onSettings(): void;
  onTasks(): void;
  onMood(): void;
  onMap(): void;
  /** Your borrowed library books. */
  onBooks(): void;
  /** The phone: call friends, or the call you're in. */
  onPhone(): void;
  /** Your clubs. */
  onClubs(): void;
  /** Indoors: walk to the way out and leave. */
  onLeave(): void;
}

/** A little wooden door, drawn in pixels, for the leave button. */
function doorIcon(): string {
  const c = document.createElement("canvas");
  c.width = 14;
  c.height = 18;
  const x = c.getContext("2d")!;
  const p = (col: string, px: number, py: number, w = 1, h = 1) => {
    x.fillStyle = col;
    x.fillRect(px, py, w, h);
  };
  p("#2b2219", 1, 2, 12, 16);
  p("#2b2219", 2, 1, 10, 1);
  p("#2b2219", 3, 0, 8, 1);
  p("#7a4e32", 2, 2, 10, 15);
  p("#7a4e32", 3, 1, 8, 1);
  p("#94603e", 2, 2, 1, 15);
  p("#5c3a24", 4, 4, 6, 5);
  p("#5c3a24", 4, 10, 6, 5);
  p("#f6c343", 9, 9, 2, 2);
  p("#b8b0a0", 0, 17, 14, 1);
  return c.toDataURL();
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
  private boatEl: HTMLDivElement;
  private moodBtn!: HTMLButtonElement;
  private chatPlaceholder = "";
  private booksBtn!: HTMLButtonElement;
  private phoneBtn!: HTMLButtonElement;
  private clubsBtn!: HTMLButtonElement;
  private exitBtn: HTMLButtonElement;

  constructor(root: HTMLElement, h: HudHandlers) {
    root.innerHTML = `
      <div class="top">
        <div class="pill place"></div>
        <div class="top-right">
          <div class="pill coins" title="Coins"></div>
          <button type="button" class="pill btn map-btn" title="City map (M)" aria-label="City map"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("map")}" /></button>
          <button type="button" class="pill btn bag-btn" title="Bag (B)" aria-label="Bag"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("bag")}" /></button>
          <button type="button" class="pill btn album-btn extra" title="Naturalist's Journal (L)" aria-label="Journal"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("book")}" /></button>
          <button type="button" class="pill btn friends-btn extra" title="Friends (F)" aria-label="Friends"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("friends")}" /><span class="online-dot" hidden></span></button>
          <button type="button" class="pill btn daily-btn" title="Daily missions" aria-label="Daily missions"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("daily")}" /><span class="badge-count" hidden>!</span></button>
          <button type="button" class="pill btn notes-btn" title="Notifications (N)" aria-label="Notifications"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("bell")}" /><span class="badge-count" hidden></span></button>
          <button type="button" class="pill btn clubs-btn" title="Clubs (K)" aria-label="Clubs"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("shield")}" /><span class="badge-count" hidden>!</span></button>
          <button type="button" class="pill btn phone-btn" title="Phone" aria-label="Phone" hidden><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("phone")}" /></button>
          <button type="button" class="pill btn books-btn" title="Your library books" aria-label="Your library books" hidden><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("books")}" /><span class="badge-count"></span></button>
          <button type="button" class="pill btn sound-btn extra" title="Sound" aria-label="Sound"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("sound")}" /></button>
          <button type="button" class="pill btn view-btn" title="Switch to 3D view" aria-label="Switch to 3D view"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("view3d")}" /></button>
          <button type="button" class="pill btn settings-btn" title="Settings" aria-label="Settings"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("gear")}" /></button>
          <button type="button" class="pill btn more-btn" title="More" aria-label="More" aria-expanded="false"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("more")}" /></button>
          <div class="pill nearby" title="People in view"></div>
        </div>
      </div>
      <button type="button" class="pill btn tasks-chip" hidden></button>
      <div class="pill follow-chip" hidden><span></span><button type="button">Stop</button></div>
      <div class="pill boat-chip" hidden><span></span><button type="button">Go ashore</button></div>
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
    if (matchMedia("(pointer: coarse)").matches) this.input.placeholder = "Say something…";
    // Phones get a simpler layout (body.phone, in the styles): the rarer
    // buttons behind "more", the chat and the emotes folded into a button each.
    const phone = () => document.body.classList.toggle("phone", matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 600);
    phone();
    window.addEventListener("resize", phone);
    const topRight = root.querySelector<HTMLElement>(".top-right")!;
    const moreBtn = root.querySelector<HTMLButtonElement>(".more-btn")!;
    const setMore = (open: boolean) => {
      topRight.classList.toggle("more-open", open);
      moreBtn.setAttribute("aria-expanded", String(open));
    };
    moreBtn.onclick = () => setMore(!topRight.classList.contains("more-open"));
    // (Picking one of them folds them away again.)
    topRight.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".extra")) setMore(false);
    });
    this.coinsEl = root.querySelector(".coins")!;
    this.tasksEl = root.querySelector(".tasks-chip")!;
    this.followEl = root.querySelector(".follow-chip")!;
    this.boatEl = root.querySelector(".boat-chip")!;
    this.tasksEl.onclick = () => h.onTasks();
    root.querySelector<HTMLButtonElement>(".map-btn")!.onclick = () => h.onMap();
    root.querySelector<HTMLButtonElement>(".bag-btn")!.onclick = () => h.onBag();
    root.querySelector<HTMLButtonElement>(".album-btn")!.onclick = () => h.onAlbum();
    root.querySelector<HTMLButtonElement>(".friends-btn")!.onclick = () => h.onFriends();
    root.querySelector<HTMLButtonElement>(".daily-btn")!.onclick = () => h.onDaily();
    root.querySelector<HTMLButtonElement>(".notes-btn")!.onclick = () => h.onNotifications();
    this.booksBtn = root.querySelector<HTMLButtonElement>(".books-btn")!;
    this.booksBtn.onclick = () => h.onBooks();
    this.phoneBtn = root.querySelector<HTMLButtonElement>(".phone-btn")!;
    this.phoneBtn.onclick = () => h.onPhone();
    this.clubsBtn = root.querySelector<HTMLButtonElement>(".clubs-btn")!;
    this.clubsBtn.onclick = () => h.onClubs();
    this.badgeEl = root.querySelector(".notes-btn .badge-count")!;
    this.dailyBadge = root.querySelector(".daily-btn .badge-count")!;
    const soundBtn = root.querySelector<HTMLButtonElement>(".sound-btn")!;
    const sound = () => this.setMuted(h.onSound());
    soundBtn.onclick = sound;
    root.querySelector<HTMLButtonElement>(".settings-btn")!.onclick = () => h.onSettings();
    // 2D or 3D, at a press: it shows the view it'll switch to.
    const viewBtn = root.querySelector<HTMLButtonElement>(".view-btn")!;
    viewBtn.onclick = () => setSettings({ view3d: !settings.view3d });
    onSettings((s) => {
      const next = s.view3d ? "2D" : "3D";
      viewBtn.title = `Switch to ${next} view`;
      viewBtn.setAttribute("aria-label", viewBtn.title);
      viewBtn.querySelector("img")!.src = iconUrl(s.view3d ? "view2d" : "view3d");
    });
    window.addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      // M for the map (C too, as it was).
      if (e.key === "c" || e.key === "C") h.onMap();
      if (e.key === "b" || e.key === "B") h.onBag();
      if (e.key === "l" || e.key === "L") h.onAlbum();
      if (e.key === "f" || e.key === "F") h.onFriends();
      if (e.key === "k" || e.key === "K") h.onClubs();
      if (e.key === "n" || e.key === "N") h.onNotifications();
      if (e.key === "m" || e.key === "M") h.onMap();
      if ((e.key === "r" || e.key === "R") && !e.repeat && !this.rideBtn.hidden) h.onRide();
    });

    const form = root.querySelector<HTMLFormElement>(".chat")!;
    const bottom = root.querySelector<HTMLElement>(".bottom")!;
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const text = this.input.value.trim();
      if (text) h.onChat(text);
      this.input.value = "";
      this.input.blur();
    };
    // On a phone the chat bar is folded into a button until it's wanted
    // (and folds away again once it's left).
    this.input.addEventListener("focus", () => bottom.classList.add("chatting"));
    this.input.addEventListener("blur", () => window.setTimeout(() => document.activeElement !== this.input && bottom.classList.remove("chatting"), 120));
    this.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.input.blur();
      ev.stopPropagation();
    });

    const bar = root.querySelector(".emotes")!;
    // (Phones: the chat and the emotes, each folded into a button.)
    const chatFab = document.createElement("button");
    chatFab.type = "button";
    chatFab.className = "chat-fab";
    chatFab.title = "Chat";
    chatFab.setAttribute("aria-label", "Chat");
    chatFab.replaceChildren(pxIcon("chat"));
    // (Focused straight from the tap, so the phone's keyboard comes up.)
    chatFab.onclick = () => {
      bottom.classList.add("chatting");
      this.input.focus();
    };
    bar.appendChild(chatFab);
    // The emotes, as the ride: one tap does your last emote again; its ⚙ (top right) opens them all.
    const emoteFab = document.createElement("button");
    emoteFab.type = "button";
    emoteFab.className = "emote-fab";
    this.emoteFab = emoteFab;
    emoteFab.onclick = () => {
      this.closeTray();
      h.onEmote(this.lastEmote);
    };
    bar.appendChild(emoteFab);
    this.emoteGear = this.gear("All emotes, sitting and toys", () => this.toggleTray(this.emoteTray, emoteFab));
    this.usedEmote(this.lastEmote);
    this.emoteTray = tray("Emotes", `keys 1–${FREE_EMOTES}`, "emote-tray");
    bar.appendChild(this.emoteTray);
    // Under the emotes, in the same tray: sitting down (or up), and your toys.
    const more = document.createElement("div");
    more.className = "emote-more";
    this.emoteTray.insertBefore(more, this.emoteTray.querySelector(".hud-tray-foot"));
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
    this.sitBtn.onclick = () => {
      this.closeTray();
      h.onSit();
    };
    more.appendChild(this.sitBtn);
    // Your ride: one tap on (or off) the one you've picked; its ⚙ (top right) to pick another.
    this.rideBtn = document.createElement("button");
    this.rideBtn.type = "button";
    this.rideBtn.className = "ride-btn";
    this.rideBtn.hidden = true;
    this.rideBtn.onclick = () => {
      this.closeTray();
      h.onRide();
    };
    bar.appendChild(this.rideBtn);
    this.rideGear = this.gear("Change your ride", () => (this.openTray === this.rideTray ? this.closeTray() : h.onRidePick()));
    this.rideTray = tray("Your rides", "", "ride-tray");
    bar.appendChild(this.rideTray);
    this.toysEl = document.createElement("button");
    this.toysEl.type = "button";
    this.toysEl.className = "toys-btn";
    this.toysEl.title = "Play with a toy";
    this.toysEl.setAttribute("aria-label", this.toysEl.title);
    this.toysEl.hidden = true;
    this.toysEl.onclick = () => {
      this.closeTray();
      h.onToys();
    };
    more.appendChild(this.toysEl);
    this.setSitting(false);
    // The way out, in the corner, when you're inside somewhere.
    this.exitBtn = document.createElement("button");
    this.exitBtn.type = "button";
    this.exitBtn.className = "exit-btn";
    this.exitBtn.hidden = true;
    const door = document.createElement("img");
    door.className = "px-icon";
    door.alt = "";
    door.src = doorIcon();
    door.width = 28;
    door.height = 36;
    this.exitBtn.append(door, document.createElement("span"));
    this.exitBtn.onclick = () => h.onLeave();
    root.appendChild(this.exitBtn);
    const grid = this.emoteTray.querySelector(".hud-tray-body")!;
    for (const [id, e] of Object.entries(EMOTES).filter(([id]) => Number(id) <= FREE_EMOTES)) {
      const b = document.createElement("button");
      b.type = "button";
      b.append(pxIcon(EMOTE_ICONS[Number(id)] ?? "heart"), Object.assign(document.createElement("span"), { className: "emote-key", textContent: id }));
      b.title = `${e.label} (${id})`;
      b.className = "emote";
      b.setAttribute("aria-label", e.label);
      b.onclick = () => {
        h.onEmote(Number(id));
        this.closeTray();
      };
      grid.appendChild(b);
    }
    // A tray closes on a tap anywhere else, or Esc.
    document.addEventListener(
      "pointerdown",
      (ev) => {
        const t = ev.target as Node;
        if (this.openTray && !this.openTray.contains(t) && !this.trayAnchor?.contains(t)) this.closeTray();
      },
      true,
    );
    window.addEventListener("keydown", (ev) => ev.key === "Escape" && this.closeTray());
  }

  private emoteTray: HTMLElement;
  private rideTray: HTMLElement;
  private rideGear: HTMLElement;
  private emoteFab!: HTMLButtonElement;
  private emoteGear!: HTMLElement;

  /** Your last emote (kept on this device): the emotes button does it again. */
  private get lastEmote(): number {
    let id = 1;
    try {
      id = Number(localStorage.getItem(LAST_EMOTE_KEY)) || 1;
    } catch {
      // (Not kept: a wave.)
    }
    return id >= 1 && id <= FREE_EMOTES ? id : 1;
  }

  /** You did emote `id` (from the tray, or its key): the emotes button's now that one. */
  usedEmote(id: number) {
    if (id < 1 || id > FREE_EMOTES) return;
    try {
      localStorage.setItem(LAST_EMOTE_KEY, String(id));
    } catch {
      // (Just for now, then.)
    }
    const label = EMOTES[id]?.label ?? "Emote";
    this.emoteFab.replaceChildren(pxIcon(EMOTE_ICONS[id] ?? "heart"), this.emoteGear);
    this.emoteFab.title = `${label} again (${id})`;
    this.emoteFab.setAttribute("aria-label", this.emoteFab.title);
  }

  /** A round ⚙ on a button's top right corner: `open` (its tray), not the button's own tap. */
  private gear(title: string, open: () => void): HTMLElement {
    const g = corner("hud-gear");
    g.append(pxIcon("gear", 1));
    g.removeAttribute("aria-hidden");
    g.setAttribute("role", "button");
    g.setAttribute("aria-haspopup", "true");
    g.tabIndex = 0;
    g.title = title;
    g.setAttribute("aria-label", title);
    const go = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
      open();
    };
    g.addEventListener("click", go);
    g.addEventListener("keydown", (ev) => (ev.key === "Enter" || ev.key === " ") && go(ev));
    return g;
  }
  /** The tray that's open (the emotes, or your rides), and the button it opened from. */
  private openTray: HTMLElement | null = null;
  private trayAnchor: HTMLElement | null = null;

  /** Opens `t` above `anchor` (centred on it, kept on screen), or closes it if it's open. */
  private toggleTray(t: HTMLElement, anchor: HTMLElement) {
    if (this.openTray === t) return this.closeTray();
    this.closeTray();
    this.openTray = t;
    this.trayAnchor = anchor;
    t.hidden = false;
    anchor.classList.add("open");
    const bar = t.parentElement!;
    const mid = anchor.offsetLeft + anchor.offsetWidth / 2;
    const room = bar.getBoundingClientRect().left;
    const left = Math.max(-room + 8, Math.min(mid - t.offsetWidth / 2, window.innerWidth - room - t.offsetWidth - 8));
    t.style.left = `${Math.round(left)}px`;
    t.style.setProperty("--tip", `${Math.round(mid - left)}px`);
  }

  private closeTray() {
    if (!this.openTray) return;
    this.openTray.hidden = true;
    this.trayAnchor?.classList.remove("open");
    this.openTray = null;
    this.trayAnchor = null;
  }

  /**
   * Your rides, to pick from (the ride button's ⚙): each with its picture, the
   * one picked marked; `pick` gets you on it. `hint`: a line under them.
   */
  showRidePicker(rides: { icon: string; name: string; picked: boolean; on: boolean }[], pick: (i: number) => void, hint = "") {
    const body = this.rideTray.querySelector(".hud-tray-body")!;
    body.replaceChildren();
    rides.forEach((r, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = r.picked ? "ride-opt picked" : "ride-opt";
      const img = document.createElement("img");
      img.className = "px-icon";
      img.alt = "";
      img.width = 24;
      img.height = 24;
      img.src = r.icon;
      const name = Object.assign(document.createElement("span"), { className: "ride-opt-name", textContent: r.name });
      const tag = Object.assign(document.createElement("span"), { className: "ride-opt-tag", textContent: r.on ? "Riding" : r.picked ? "✓" : "" });
      b.append(img, name, tag);
      b.onclick = () => {
        this.closeTray();
        pick(i);
      };
      body.appendChild(b);
    });
    const foot = this.rideTray.querySelector<HTMLElement>(".hud-tray-foot")!;
    foot.textContent = hint;
    foot.hidden = !hint;
    if (this.openTray !== this.rideTray) this.toggleTray(this.rideTray, this.rideBtn);
  }

  /** The leave button: where it takes you (`label`), or null to hide it (outdoors). */
  setExit(label: string | null) {
    this.exitBtn.hidden = label === null;
    if (label === null) return;
    this.exitBtn.querySelector("span")!.textContent = label;
    this.exitBtn.title = `${label}: walks you to the door and out`;
    this.exitBtn.setAttribute("aria-label", this.exitBtn.title);
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
    this.toysEl.replaceChildren(img, label("Toys"));
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
    this.rideBtn.replaceChildren(img, this.rideGear);
    this.rideBtn.title = ride.on ? `Get off the ${ride.name} (R)` : `Ride the ${ride.name} (R)`;
    this.rideBtn.setAttribute("aria-label", this.rideBtn.title);
    this.rideBtn.classList.toggle("on", ride.on);
  }

  setSitting(sitting: boolean) {
    this.sitBtn.replaceChildren(pxIcon(sitting ? "stand" : "sit"), label(sitting ? "Stand up" : "Sit"));
    this.sitBtn.title = sitting ? "Stand up" : "Sit down here";
    this.sitBtn.setAttribute("aria-label", this.sitBtn.title);
  }

  setPlace(name: string, instance: number) {
    this.place.textContent = `${name} · ${instance}`;
  }

  /** The friends button: a green dot on its corner while at least one friend's online (`n` of them). */
  setFriendsOnline(n: number) {
    const btn = document.querySelector<HTMLElement>(".friends-btn");
    const dot = btn?.querySelector<HTMLElement>(".online-dot");
    if (!btn || !dot) return;
    dot.hidden = n === 0;
    const title = n ? `Friends (F): ${n} online` : "Friends (F)";
    btn.title = title;
    btn.setAttribute("aria-label", title);
  }

  /** The daily missions' button: marked when everything's done and the bonus is waiting. */
  setDailyReady(ready: boolean) {
    this.dailyBadge.hidden = !ready;
  }
  private dailyBadge: HTMLElement;

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

  /** "🚣 Your rowboat · 12 min · Go ashore" while you're in a boat; null hides it. */
  setBoat(text: string | null, buttonLabel = "Go ashore", onButton?: () => void) {
    this.boatEl.hidden = text === null;
    if (text === null) return;
    this.boatEl.querySelector("span")!.textContent = text;
    const b = this.boatEl.querySelector("button")!;
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
