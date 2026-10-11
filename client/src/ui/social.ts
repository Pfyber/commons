// M4 panels: friends (list, requests, add, chat, gift) and notifications.

import { COIN, type Economy } from "../economy";
import { ApiError } from "../net/api";
import { type Friend, type Social, describe } from "../social";
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
      if (f.level >= 2) btns.append(button("Visit home", () => this.actions.visit(f), "small"));
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
    const giftable = [...this.eco.items.values()].filter((i) => this.eco.qty(i.id) > 0);
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
            await this.social.gift(f.id, it.id, qty, note.value);
            await this.eco.load();
            return `Sent to ${f.name}'s doorstep 🎁`;
          }), "small primary-sm"),
      );
      list.append(row);
    }
    this.body.append(note, list, this.msg);
  }
}

export class NotificationsPanel extends Panel {
  constructor(
    private social: Social,
    private actions: FriendActions & { visitId(id: string, name: string): void },
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
      const from = n.body.from_id;
      const name = n.body.from_name ?? "";
      const pending = from && this.social.incoming.some((p) => p.id === from);
      if (n.kind === "friend_request" && pending && from) {
        row.append(
          button("Accept", () => void this.social.respond(from, true), "small primary-sm"),
          button("Decline", () => void this.social.respond(from, false), "small"),
        );
      }
      const inviteLive = Date.now() / 1000 - n.at < INVITE_SECS;
      if (n.kind === "home_invite" && from && inviteLive) row.append(button("Visit", () => this.actions.visitId(from, name), "small primary-sm"));
      if (n === newestGift && this.waitingGifts > 0) row.append(button("Go home", () => this.actions.goHome(), "small"));
      this.body.append(row);
    }
  }
}
