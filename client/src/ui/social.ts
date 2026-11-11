// M4 panels: friends (list, requests, add, chat, gift) and notifications.

import { COIN, type Economy } from "../economy";
import { ApiError } from "../net/api";
import { type Friend, type Notification, type Social, describe } from "../social";
import { notifyChime } from "../ambient/sfx";
import { Panel, button, el, icon } from "./panels";

export interface FriendActions {
  join(f: Friend): void;
  visit(f: Friend): void;
  goHome(): void;
}

function err(e: unknown): string {
  return e instanceof ApiError ? e.message : "That didn't work.";
}

/** Home invitations last this long (server: social hub). */
const INVITE_SECS = 15 * 60;

function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

type View = { kind: "list" } | { kind: "chat"; friend: Friend } | { kind: "gift"; friend: Friend };

export class FriendsPanel extends Panel {
  private view: View = { kind: "list" };
  private msg = el("p", "error");

  constructor(
    private social: Social,
    private eco: Economy,
    private actions: FriendActions,
  ) {
    super("Friends", "friends");
    social.onChange(() => this.open && this.render());
    social.onDm = (from) => {
      if (this.open && this.view.kind === "chat" && this.view.friend.id === from) void this.social.history(from);
    };
  }

  showList() {
    this.view = { kind: "list" };
    this.show();
  }

  chatWith(f: Friend) {
    this.view = { kind: "chat", friend: f };
    this.show();
    void this.social.history(f.id);
  }

  private async act(f: () => Promise<unknown>, ok?: string) {
    this.msg.textContent = "";
    this.msg.className = "error";
    try {
      const r = await f();
      if (ok || typeof r === "string") {
        this.msg.className = "ok";
        this.msg.textContent = (typeof r === "string" ? r : ok) ?? "";
      }
    } catch (e) {
      this.msg.textContent = err(e);
    }
  }

  render() {
    this.body.replaceChildren();
    if (this.view.kind === "chat") return this.renderChat(this.view.friend);
    if (this.view.kind === "gift") return this.renderGift(this.view.friend);
    const s = this.social;

    const add = el("form", "add-friend");
    const input = el("input");
    input.placeholder = "Add a friend by name";
    input.maxLength = 20;
    add.append(input, button("Add", () => add.requestSubmit(), "small"));
    add.onsubmit = (e) => {
      e.preventDefault();
      if (input.value.trim()) void this.act(() => s.request(input.value.trim()));
    };
    this.body.append(add, this.msg);
    // Your home: friends dropping by whenever they like (the default), or only when you invite them.
    const open = el("label", "row voice-switch");
    const box = el("input");
    box.type = "checkbox";
    box.checked = s.dropIn;
    box.onchange = () => void this.act(() => s.setDropIn(box.checked), box.checked ? "Friends can drop by your home any time." : "Friends now need an invitation to come in.");
    open.append(box, el("span", "name", "Friends can visit my home any time"));
    this.body.append(open);

    if (s.incoming.length) {
      this.body.append(el("h3", "", "Requests"));
      for (const p of s.incoming) {
        const row = el("div", "row");
        row.append(el("span", "name", p.name), button("Accept", () => this.act(() => s.respond(p.id, true)), "small primary-sm"), button("Decline", () => this.act(() => s.respond(p.id, false)), "small"));
        this.body.append(row);
      }
    }

    this.body.append(el("h3", "", `Friends · ${s.friends.filter((f) => f.online).length} online`));
    if (!s.friends.length) this.body.append(el("p", "empty", "No friends yet. Tap someone in the park, or add them by name."));
    const sorted = [...s.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    for (const f of sorted) {
      const card = el("div", "friend");
      const head = el("div", "row");
      const dot = el("span", f.online ? "dot on" : "dot");
      const name = el("span", "name", f.name);
      if (f.level >= 2) name.append(el("span", "badge", "close friend"));
      if (s.unreadDms.has(f.id)) name.append(el("span", "badge new", "new message"));
      head.append(dot, name);
      const where = el("div", "where", f.online ? (f.where?.label ?? "online") : "away");
      const btns = el("div", "btns");
      if (f.online && f.where) btns.append(button("Join", () => this.actions.join(f), "small primary-sm"));
      if (f.level >= 2 || f.drop_in) btns.append(button("Visit home", () => this.actions.visit(f), "small"));
      btns.append(
        button("Message", () => this.chatWith(f), "small"),
        button("Gift", () => ((this.view = { kind: "gift", friend: f }), this.render()), "small"),
        button("Invite home", () => this.act(() => s.invite(f.id), `Invited ${f.name} to your home.`), "small"),
        button("Remove", () => confirm(`Remove ${f.name} from your friends?`) && this.act(() => s.remove(f.id)), "small subtle"),
      );
      card.append(head, where, btns);
      this.body.append(card);
    }

    if (s.outgoing.length) {
      this.body.append(el("h3", "", "Waiting for a reply"));
      for (const p of s.outgoing) this.body.append(el("p", "hint", p.name));
    }
    if (s.blocked.length) {
      this.body.append(el("h3", "", "Blocked"));
      for (const p of s.blocked) {
        const row = el("div", "row");
        row.append(el("span", "name", p.name), button("Unblock", () => this.act(() => s.unblock(p.id)), "small"));
        this.body.append(row);
      }
    }
  }

  private back() {
    const b = button("← Friends", () => ((this.view = { kind: "list" }), this.render()), "small subtle");
    return b;
  }

  private renderChat(f: Friend) {
    const log = el("div", "chat-log");
    for (const m of this.social.dms.get(f.id) ?? []) {
      const mine = m.from === this.social.selfId;
      const line = el("div", mine ? "msg mine" : "msg");
      line.append(el("span", "text", m.text), el("span", "time", ago(m.at)));
      log.append(line);
    }
    if (!log.childElementCount) log.append(el("p", "empty", `Say hello to ${f.name}!`));
    const form = el("form", "add-friend");
    const input = el("input");
    input.placeholder = `Message ${f.name}`;
    input.maxLength = 140;
    form.append(input, button("Send", () => form.requestSubmit(), "small primary-sm"));
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      void this.act(() => this.social.sendDm(f.id, text));
    };
    input.addEventListener("keydown", (e) => e.stopPropagation());
    this.body.append(this.back(), el("h3", "", f.name), log, form, this.msg);
    log.scrollTop = log.scrollHeight;
    input.focus();
  }

  private renderGift(f: Friend) {
    this.body.append(this.back(), el("h3", "", `A gift for ${f.name}`), el("p", "hint", "It waits on their doorstep until they open it."));
    const note = el("input");
    note.placeholder = "Add a note (optional)";
    note.maxLength = 140;
    note.addEventListener("keydown", (e) => e.stopPropagation());
    // Wrapping and a card from the Gift Shop, if you have some.
    const choose = (kind: string, none: string) => {
      const pick = el("select", "gift-extra");
      const o = el("option", "", none);
      o.value = "0";
      pick.append(o);
      for (const it of this.eco.ofKind(kind).filter((i) => this.eco.qty(i.id) > 0)) {
        const opt = el("option", "", `${it.name} (have ${this.eco.qty(it.id)})`);
        opt.value = String(it.id);
        pick.append(opt);
      }
      return pick;
    };
    const wrap = choose("wrap", "No wrapping");
    const card = choose("card", "No card");
    if (wrap.options.length > 1 || card.options.length > 1) {
      const extras = el("div", "stall-form");
      extras.append(wrap, card);
      this.body.append(extras);
    }
    // Account-bound things (what you wear from the mall) are yours to keep.
    const giftable = [...this.eco.items.values()].filter((i) => this.eco.qty(i.id) > 0 && !i.meta.account_bound);
    if (!giftable.length) this.body.append(el("p", "empty", "Your bag is empty."));
    const list = el("div", "rows");
    for (const it of giftable) {
      const row = el("div", "row");
      const qty = it.id === COIN ? Math.min(10, this.eco.qty(it.id)) : 1;
      row.append(
        icon(it),
        el("span", "name", `${qty > 1 ? `${qty} ` : ""}${it.name} (have ${this.eco.qty(it.id)})`),
        button("Give", () =>
          this.act(async () => {
            await this.social.gift(f.id, it.id, qty, note.value, Number(wrap.value), Number(card.value));
            await this.eco.load();
            return `Sent to ${f.name}'s doorstep 🎁`;
          }), "small primary-sm"),
      );
      list.append(row);
    }
    this.body.append(note, list, this.msg);
  }
}

/** What can be done about a notification (accept, visit, join…). */
export type NoteActions = FriendActions & {
  visitId(id: string, name: string): void;
  /** Whether the invite into club `id` is still waiting for an answer. */
  clubInvited?(id: string): boolean;
  answerClub?(id: string, accept: boolean): void;
  /** Up to the club's room (a meetup that's on). */
  goToClubRoom?(id: string): void;
  /** To a place in the city (a club event's). */
  walkToSpot?(spot: string): void;
};

/**
 * The buttons for notification `n` still worth pressing (an invite not yet
 * gone stale, a request still waiting…), each doing its thing then `done`.
 * `gifts`: a gift's "Go home" (when there are gifts waiting there).
 */
function noteButtons(n: Notification, social: Social, actions: NoteActions, done: () => void, gifts = false, fresh = false): HTMLButtonElement[] {
  const out: HTMLButtonElement[] = [];
  const act = (label: string, f: () => void, cls = "small") => out.push(button(label, () => (f(), done()), cls));
  const from = n.body.from_id;
  const name = n.body.from_name ?? "";
  const age = Date.now() / 1000 - n.at;
  // (Just come in, a request's waiting: the friends list may not have caught up yet.)
  if (n.kind === "friend_request" && from && (fresh || social.incoming.some((p) => p.id === from))) {
    act("Accept", () => void social.respond(from, true), "small primary-sm");
    act("Decline", () => void social.respond(from, false));
  }
  if (n.kind === "home_invite" && from && age < INVITE_SECS) act("Visit", () => actions.visitId(from, name), "small primary-sm");
  const club = n.body.club_id;
  if (n.kind === "club_invite" && club && actions.clubInvited?.(club)) {
    act("Join", () => actions.answerClub?.(club, true), "small primary-sm");
    act("No thanks", () => actions.answerClub?.(club, false));
  }
  const place = (n.body as { place?: string }).place;
  if ((n.kind === "club_event_soon" || n.kind === "club_event_now") && place && age < 7200) act("Show me", () => actions.walkToSpot?.(place), "small primary-sm");
  if (n.kind === "club_meetup_now" && club && age < 3600) act("Go up", () => actions.goToClubRoom?.(club), "small primary-sm");
  if (n.kind === "gift" && gifts) act("Go home", () => actions.goHome());
  return out;
}

/**
 * New notifications popping up in a card top right, with a chime: what's
 * happened, and (an invite, a request) buttons to answer at once, without
 * going to the bell. Each goes after a while (an invite, a while longer),
 * or when it's answered or closed; three at most at once.
 */
export class NotifyPopups {
  private box = el("div", "notify-pops");

  constructor(
    private social: Social,
    private actions: NoteActions,
  ) {
    document.body.append(this.box);
  }

  show(n: Notification) {
    notifyChime(n.kind);
    const card = el("div", `notify-pop k-${n.kind}`);
    let timer = 0;
    const close = () => {
      window.clearTimeout(timer);
      card.classList.add("going");
      window.setTimeout(() => card.remove(), 250);
    };
    // Gifts: "Go home" (they wait on the doorstep).
    const buttons = noteButtons(n, this.social, this.actions, () => {
      void this.social.markRead();
      close();
    }, true, true);
    const x = button("✕", close, "notify-close");
    x.title = "Dismiss";
    const text = el("div", "notify-text", describe(n));
    const row = el("div", "notify-btns");
    row.append(...buttons);
    card.append(x, text);
    if (buttons.length) card.append(row);
    this.box.prepend(card);
    while (this.box.children.length > 3) this.box.lastElementChild?.remove();
    // Up a while (something to answer: longer), not going while the pointer's on it.
    const ms = buttons.length ? 20_000 : 7_000;
    const arm = () => (timer = window.setTimeout(close, ms));
    card.addEventListener("pointerenter", () => window.clearTimeout(timer));
    card.addEventListener("pointerleave", arm);
    arm();
  }
}

export class NotificationsPanel extends Panel {
  constructor(
    private social: Social,
    private actions: NoteActions,
  ) {
    super("Notifications", "notifications");
    social.onChange(() => this.open && this.render());
  }

  /** Gifts still on the doorstep; "Go home" only shows while there are some. */
  private waitingGifts = 0;

  show() {
    super.show();
    void this.social.markRead();
    this.social
      .gifts()
      .then((g) => {
        this.waitingGifts = g.length;
        if (this.open) this.render();
      })
      .catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const ns = this.social.notifications;
    if (!ns.length) this.body.append(el("p", "empty", "Nothing new. It's peaceful here."));
    const newestGift = ns.find((n) => n.kind === "gift");
    for (const n of ns) {
      const row = el("div", n.read ? "note" : "note unread");
      row.append(el("span", "text", describe(n)), el("span", "time", ago(n.at)));
      // (Going somewhere: the panel shuts.)
      const going = n.kind === "club_event_soon" || n.kind === "club_event_now";
      row.append(...noteButtons(n, this.social, this.actions, () => going && this.hide(), n === newestGift && this.waitingGifts > 0));
      this.body.append(row);
    }
  }
}
