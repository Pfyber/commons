// Clubs (ADR 0014): one panel, opened from the 🛡 button or the Club Hall's
// desk, directory and stairs. Your clubs and invites; founding a club (by
// renting its room); a club's page: its room and rent, the treasury, the
// members and their roles, inviting friends, and the board.

import { type Clubs, type Detail, type MyClub, type PublicClub, ROLE_NAMES, type Role, roomStatus } from "../clubs";
import type { Economy } from "../economy";
import { ApiError } from "../net/api";
import type { Social } from "../social";
import { confirmButton } from "./homes";
import { Panel, button, el } from "./panels";

export interface ClubsHost {
  /** Up to the club's room (members only). */
  goToRoom(club: string): void;
  /** The club whose room you're in, if any. */
  inRoom(): string | null;
  toast(text: string): void;
}

type View =
  | { kind: "list" }
  | { kind: "found" }
  | { kind: "club"; id: string }
  | { kind: "directory" }
  /** The stairs: which of your clubs' rooms to go up to. */
  | { kind: "rooms" };

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "That didn't work.");

function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** A club's crest on its colour. */
export function crestEl(c: { crest: string; color: string }, big = false): HTMLElement {
  const e = el("span", big ? "crest big" : "crest", c.crest);
  e.style.background = c.color;
  return e;
}

export class ClubsPanel extends Panel {
  private view: View = { kind: "list" };
  private detail: Detail | null = null;
  private directory: PublicClub[] | null = null;
  private msg = el("p", "error");
  private loading = 0;
  /** The founding form's choices, kept while you look around. */
  private form = { name: "", crest: "", color: "" };

  constructor(
    private clubs: Clubs,
    private social: Social,
    private eco: Economy,
    private host: ClubsHost,
  ) {
    super("🛡 Clubs", "clubs");
    clubs.onChange(() => this.open && this.view.kind !== "club" && this.view.kind !== "found" && this.render());
    clubs.onClubChanged = (id) => {
      if (this.open && this.view.kind === "club" && this.view.id === id) void this.loadClub(id);
    };
  }

  /** Your clubs (from the 🛡 button or the desk). */
  showList() {
    this.go({ kind: "list" });
  }

  showClub(id: string) {
    this.go({ kind: "club", id });
  }

  showDirectory() {
    this.go({ kind: "directory" });
  }

  /** At the stairs: straight up if there's one room to go to, else pick. */
  showRooms() {
    const rooms = this.clubs.mine.filter((c) => c.room);
    if (rooms.length === 1) return this.host.goToRoom(rooms[0].id);
    this.go({ kind: "rooms" });
  }

  private go(v: View) {
    this.view = v;
    this.msg.textContent = "";
    this.detail = null;
    this.show();
    void this.clubs.load().catch(() => {});
    if (v.kind === "club") void this.loadClub(v.id);
    if (v.kind === "directory") {
      this.directory = null;
      void this.clubs
        .directory()
        .then((d) => {
          this.directory = d;
          if (this.open && this.view.kind === "directory") this.render();
        })
        .catch(() => {});
    }
  }

  private async loadClub(id: string) {
    const ticket = ++this.loading;
    try {
      const d = await this.clubs.detail(id);
      if (ticket !== this.loading || this.view.kind !== "club" || this.view.id !== id) return;
      if (d.role === null) {
        // Not (or no longer) a member.
        this.view = { kind: "list" };
        this.detail = null;
      } else this.detail = d;
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    if (this.open) this.render();
  }

  /** Runs an action, shows how it went, and refreshes the club. */
  private act(p: Promise<unknown>, done?: string) {
    this.msg.textContent = "";
    p.then(() => {
      if (done) this.host.toast(done);
      if (this.view.kind === "club") void this.loadClub(this.view.id);
      else if (this.open) this.render();
    }).catch((e) => {
      this.msg.textContent = errText(e);
    });
  }

  render() {
    this.body.replaceChildren();
    const v = this.view;
    this.titleEl.textContent = "🛡 Clubs";
    if (v.kind === "list") this.renderList();
    else if (v.kind === "found") this.renderFound();
    else if (v.kind === "club") this.renderClub();
    else if (v.kind === "directory") this.renderDirectory();
    else this.renderRooms();
    this.body.append(this.msg);
  }

  private clubRow(c: MyClub): HTMLElement {
    const row = el("div", "row club-row");
    const text = el("span", "name");
    text.append(el("strong", "", c.name), el("span", "hint", ` · ${c.members} member${c.members === 1 ? "" : "s"} · ${ROLE_NAMES[c.role]}${c.badge ? " · your badge" : ""}`));
    row.append(crestEl(c), text);
    if (c.room?.state === "grace") row.append(el("span", "hint warn", "rent due"));
    row.append(button("Open", () => this.showClub(c.id), "small primary-sm"));
    return row;
  }

  private renderList() {
    const c = this.clubs;
    if (c.invites.length) {
      this.body.append(el("h3", "", "Invites"));
      for (const i of c.invites) {
        const row = el("div", "row club-row");
        const text = el("span", "name");
        text.append(el("strong", "", i.name), el("span", "hint", ` · from ${i.from}`));
        row.append(
          crestEl(i),
          text,
          button("Join", () => this.act(c.answer(i.id, true), `🛡 Welcome to ${i.name}!`), "small primary-sm"),
          button("No thanks", () => this.act(c.answer(i.id, false)), "small"),
        );
        this.body.append(row);
      }
    }
    this.body.append(el("h3", "", "Your clubs"));
    if (!c.mine.length) {
      this.body.append(
        el("p", "", "A club is a few friends with a name, a crest and a room of their own at the Club Hall, with a board for news. Members chip into the club's treasury, which pays the room's rent each week."),
        el("p", "hint", "Friends can invite you into theirs, or you can found one at the Club Hall's desk."),
      );
    } else {
      const rows = el("div", "rows");
      for (const club of c.mine) rows.append(this.clubRow(club));
      this.body.append(rows);
    }
    const tier = c.tiers[0];
    if (c.mine.length < c.max) {
      this.body.append(
        button(`Found a club${tier ? ` (first week's rent: ${tier.rent} coins)` : ""}`, () => this.go({ kind: "found" }), c.mine.length ? "small" : "primary"),
      );
    } else this.body.append(el("p", "hint", `You're in ${c.max} clubs, the most anyone can be in.`));
    this.body.append(button("Club directory", () => this.showDirectory(), "small"));
  }

  private renderFound() {
    const c = this.clubs;
    const f = this.form;
    if (!f.crest) f.crest = c.crests[Math.floor(Math.random() * c.crests.length)] ?? "🛡";
    if (!f.color) f.color = c.colors[Math.floor(Math.random() * c.colors.length)] ?? "#3f7a8a";
    const tier = c.tiers[0];
    this.titleEl.textContent = "🛡 Found a club";
    this.body.append(
      el(
        "p",
        "",
        `Clubs are rented, never bought: founding one rents a ${tier?.name ?? "club room"} at the Club Hall for its members (up to ${tier?.members ?? 12}). You pay the first week, ${tier?.rent ?? "?"} coins; after that the club's treasury pays, from what members chip in.`,
      ),
    );
    const preview = el("div", "club-preview");
    const showPreview = () => preview.replaceChildren(crestEl(f, true), el("strong", "", f.name.trim() || "Your club"));
    showPreview();
    const name = el("input");
    name.maxLength = 24;
    name.placeholder = "Club name (3 to 24 letters)";
    name.value = f.name;
    name.oninput = () => {
      f.name = name.value;
      showPreview();
    };
    const crests = el("div", "swatches");
    for (const cr of c.crests) {
      const b = button(cr, () => {
        f.crest = cr;
        this.render();
      }, cr === f.crest ? "small on" : "small");
      crests.append(b);
    }
    const colors = el("div", "swatches");
    for (const col of c.colors) {
      const b = button("", () => {
        f.color = col;
        this.render();
      }, col === f.color ? "small swatch on" : "small swatch");
      b.style.background = col;
      b.setAttribute("aria-label", col);
      colors.append(b);
    }
    const cost = tier?.rent ?? 0;
    const go = button(`Found it (${cost} coins)`, () => {
      this.msg.textContent = "";
      go.disabled = true;
      c.found(f.name.trim(), f.crest, f.color)
        .then((r) => {
          this.form = { name: "", crest: "", color: "" };
          void this.eco.load().catch(() => {});
          this.host.toast(`🛡 ${r.name} is founded, and its room is yours for a week. Invite your friends!`);
          this.showClub(r.id);
        })
        .catch((e) => {
          go.disabled = false;
          this.msg.textContent = errText(e);
        });
    }, "primary");
    if (this.eco.coins < cost) {
      go.disabled = true;
      this.msg.textContent = `You need ${cost} coins for the first week's rent.`;
    }
    this.body.append(preview, name, el("h3", "", "Crest"), crests, el("h3", "", "Colour"), colors, go, button("Back", () => this.showList(), "small"));
    window.setTimeout(() => name.focus(), 0);
  }

  private renderRooms() {
    this.titleEl.textContent = "🛡 Up to the club rooms";
    const rooms = this.clubs.mine.filter((c) => c.room);
    if (!rooms.length) {
      this.body.append(el("p", "", "The club rooms upstairs are for members. Found a club at the desk, or ask a friend to invite you into theirs."));
      this.body.append(button("Your clubs", () => this.showList(), "primary"));
      return;
    }
    const rows = el("div", "rows");
    for (const c of rooms) {
      const row = el("div", "row club-row");
      row.append(crestEl(c), el("span", "name", c.name), button("Go up", () => (this.hide(), this.host.goToRoom(c.id)), "small primary-sm"));
      rows.append(row);
    }
    this.body.append(rows);
  }

  private renderDirectory() {
    this.titleEl.textContent = "🛡 Club directory";
    const d = this.directory;
    if (!d) {
      this.body.append(el("p", "hint", "Reading the directory…"));
      return;
    }
    if (!d.length) this.body.append(el("p", "empty", "No clubs have a room yet. Be the first!"));
    const mine = new Set(this.clubs.mine.map((c) => c.id));
    const rows = el("div", "rows");
    for (const c of d) {
      const row = el("div", "row club-row");
      const text = el("span", "name");
      text.append(el("strong", "", c.name), el("span", "hint", ` · ${c.members} member${c.members === 1 ? "" : "s"}`));
      row.append(crestEl(c), text);
      if (mine.has(c.id)) row.append(button("Open", () => this.showClub(c.id), "small primary-sm"));
      rows.append(row);
    }
    this.body.append(rows, el("p", "hint", "Clubs grow by invitation between friends. Know someone in one? Ask them!"), button("Your clubs", () => this.showList(), "small"));
  }

  private renderClub() {
    const d = this.detail;
    if (!d) {
      this.body.append(el("p", "hint", "Opening the club's book…"));
      return;
    }
    const c = this.clubs;
    const id = d.club.id;
    const staff = d.role === "owner" || d.role === "mod";
    const me = this.social.selfId;
    const room = d.room;
    this.titleEl.textContent = `${d.club.crest} ${d.club.name}`;
    const head = el("div", "club-preview");
    head.append(crestEl(d.club, true), el("span", "hint", `${d.members.length} of ${d.cap} members · you're ${d.role === "mod" ? "a moderator" : d.role === "owner" ? "the owner" : "a member"}`));
    this.body.append(head);

    if (d.room?.state === "grace") this.body.append(el("p", "hint warn", `Rent is due and the treasury has ${d.treasury} of ${d.room.rent} coins. Chip in below.`));

    // The board.
    this.body.append(el("h3", "", "Board"));
    const form = el("form", "add-friend");
    const input = el("input");
    input.maxLength = 280;
    input.placeholder = "Something for the members…";
    form.append(input, button("Post", () => form.requestSubmit(), "small primary-sm"));
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) this.act(c.say(id, text));
    };
    this.body.append(form);
    if (!d.posts.length) this.body.append(el("p", "empty", "Nothing on the board yet."));
    for (const p of d.posts) {
      const row = el("div", "note club-post");
      row.append(el("span", "text", `${p.author ?? "Someone"}: ${p.text}`), el("span", "time", ago(p.at)));
      if (staff || p.author_id === me) row.append(button("Remove", () => this.act(c.unsay(id, p.id)), "small"));
      this.body.append(row);
    }

    // Members.
    this.body.append(el("h3", "", "Members"));
    const rows = el("div", "rows");
    for (const m of d.members) {
      const row = el("div", "row member-row");
      const text = el("span", "name");
      text.append(el("span", m.online ? "dot on" : "dot", "●"), document.createTextNode(` ${m.name}`), el("span", "hint", ` · ${ROLE_NAMES[m.role]}`));
      row.append(text);
      if (m.id !== me) {
        if (d.role === "owner" && m.role === "member") row.append(button("Make moderator", () => this.act(c.setRole(id, m.id, "mod")), "small"));
        if (d.role === "owner" && m.role === "mod") row.append(button("Make member", () => this.act(c.setRole(id, m.id, "member")), "small"));
        if (d.role === "owner") row.append(confirmButton("Hand over", `Make ${m.name} the owner?`, () => this.act(c.setRole(id, m.id, "owner" as Role), `🛡 ${m.name} owns ${d.club.name} now.`)));
        if (d.role === "owner" || (d.role === "mod" && m.role === "member")) row.append(confirmButton("Remove", `Remove ${m.name}?`, () => this.act(c.remove(id, m.id))));
      }
      rows.append(row);
    }
    this.body.append(rows);

    // Inviting friends.
    if (staff) {
      const inClub = new Set(d.members.map((m) => m.id));
      const friends = this.social.friends.filter((f) => !inClub.has(f.id));
      if (d.members.length >= d.cap) this.body.append(el("p", "hint", "The room's full. A bigger room fits more members."));
      else if (!friends.length) this.body.append(el("p", "hint", "Clubs grow along friendships: make friends to invite them."));
      else {
        const pick = el("select");
        for (const f of friends) {
          const o = el("option", "", f.name);
          o.value = f.id;
          pick.append(o);
        }
        const row = el("div", "add-friend");
        row.append(pick, button("Invite", () => this.act(c.invite(id, pick.value), `🛡 Invite sent to ${friends.find((f) => f.id === pick.value)?.name ?? "your friend"}.`), "small primary-sm"));
        this.body.append(row);
      }
    }

    // The treasury.
    this.body.append(el("h3", "", `Treasury: ${d.treasury} coins`));
    const weeks = room && room.rent > 0 ? Math.floor(d.treasury / room.rent) : 0;
    this.body.append(el("p", "hint", room ? `Enough for ${weeks} more week${weeks === 1 ? "" : "s"} of rent. Coins given to the club stay with the club.` : "Coins given to the club stay with the club and pay its rent."));
    const give = el("div", "tier-row");
    for (const n of [5, 10, 25, 50]) {
      const b = button(`Chip in ${n}`, () => this.act(c.donate(id, n).then(() => this.eco.load()), `🛡 Thank you! ${n} coins to ${d.club.name}.`), "small");
      b.disabled = this.eco.coins < n;
      give.append(b);
    }
    this.body.append(give);

    // The room and its rent.
    this.body.append(el("h3", "", "The room"));
    if (room) {
      this.body.append(el("p", room.state === "grace" ? "hint warn" : "hint", roomStatus(room)));
      if (this.host.inRoom() !== id) this.body.append(button("Go to the room", () => (this.hide(), this.host.goToRoom(id)), "primary"));
      if (room.state === "grace" && staff) {
        this.body.append(button(`Pay ${room.rent} coins from the treasury`, () => this.act(c.pay(id), "🛡 Rent paid. The room is the club's for another week."), "small primary-sm"));
      }
      if (d.role === "owner" && room.state === "active") {
        const row = el("div", "tier-row");
        for (const t of d.tiers) {
          if (t.tier === room.tier) continue;
          const up = t.rent > room.rent;
          const label = up ? `Move up to a ${t.name} (${t.members} members, ${t.rent}/week, ${t.rent - room.rent} now)` : `Move down to a ${t.name} (${t.members} members, ${t.rent}/week)`;
          row.append(button(label, () => this.act(c.rentRoom(id, t.tier), `🛡 The club has a ${t.name} now.`), up ? "small primary-sm" : "small"));
        }
        this.body.append(row);
      }
    } else {
      this.body.append(el("p", "hint", "The club has no room just now (the rent wasn't paid). Everything else carries on."));
      if (d.role === "owner") {
        const row = el("div", "tier-row");
        for (const t of d.tiers) row.append(button(`Rent a ${t.name} (${t.members} members, ${t.rent}/week from the treasury)`, () => this.act(c.rentRoom(id, t.tier), `🛡 The club has a room again!`), "small primary-sm"));
        this.body.append(row);
      }
    }

    // You.
    this.body.append(el("h3", "", "You"));
    const you = el("div", "tier-row");
    if (!d.badge) you.append(button(`Show ${d.club.crest} by my name`, () => this.act(c.showBadge(id), `${d.club.crest} Now showing by your name.`), "small"));
    else you.append(el("span", "hint", `${d.club.crest} shows by your name.`));
    const alone = d.members.length === 1;
    if (d.role !== "owner" || alone) {
      you.append(
        confirmButton(alone ? "Close the club" : "Leave", alone ? "Close it? The room is given up" : `Leave ${d.club.name}?`, () =>
          this.act(c.leave(id).then(() => this.showList()), alone ? `🛡 ${d.club.name} is closed.` : `You've left ${d.club.name}.`),
        ),
      );
    } else you.append(el("span", "hint", "To leave, hand the club over to another member first."));
    this.body.append(you, button("Your clubs", () => this.showList(), "small"));
  }
}
