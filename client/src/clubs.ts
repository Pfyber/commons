// Clubs (ADR 0014; server: crates/social/src/clubs.rs): the clubs you're in,
// your invites, a club's page (members, board, treasury, its rented room),
// the Club Hall's directory, and the crests shown by people's names.

import type { Auth } from "./net/api";
import type { Lease, Tier } from "./rent";
import type { Social } from "./social";

export type Role = "owner" | "mod" | "member";

/** A club room's lease (rent paid from the treasury). */
export type Room = Omit<Lease, "kind"> & { kind: "club_room"; members?: number | null };

export interface ClubTier extends Tier {
  members: number;
}

export interface MyClub {
  id: string;
  name: string;
  crest: string;
  color: string;
  role: Role;
  badge: boolean;
  members: number;
  room: Room | null;
}

export interface Invite {
  id: string;
  name: string;
  crest: string;
  color: string;
  from: string;
}

export interface PublicClub {
  id: string;
  name: string;
  crest: string;
  color: string;
  members: number;
}

export interface Member {
  id: string;
  name: string;
  role: Role;
  online: boolean;
}

export interface Post {
  id: number;
  author: string | null;
  author_id: string | null;
  text: string;
  /** Unix seconds. */
  at: number;
}

/** A club as its members see it. */
export interface Detail {
  club: PublicClub;
  role: Role;
  badge: boolean;
  treasury: number;
  cap: number;
  room: Room | null;
  tiers: ClubTier[];
  members: Member[];
  posts: Post[];
}

export interface Badge {
  club: string;
  crest: string;
  color: string;
}

/** An idempotency key for one donation (randomUUID needs a secure context). */
function key(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const ROLE_NAMES: Record<Role, string> = { owner: "Owner", mod: "Moderator", member: "Member" };

export class Clubs {
  mine: MyClub[] = [];
  invites: Invite[] = [];
  max = 5;
  crests: string[] = [];
  colors: string[] = [];
  tiers: ClubTier[] = [];
  private listeners = new Set<() => void>();
  /** Crests by people's names (null: they show none), and names still to ask about. */
  private badges = new Map<string, Badge | null>();
  private asking = new Set<string>();
  private askTimer = 0;
  private badgeListeners = new Set<() => void>();
  /** A club page changed for its members (a donation, a post, someone joining). */
  onClubChanged: (club: string, what: Record<string, unknown>) => void = () => {};

  constructor(
    private auth: Auth,
    social: Social,
  ) {
    social.onPush((m) => {
      // An invite or a removal changes the list too.
      if (m.t === "notify" && String((m.n as { kind?: string })?.kind).startsWith("club_")) void this.load().catch(() => {});
      if (m.t !== "club") return;
      // Someone joining or leaving may change the crest by their name.
      for (const who of [m.joined, m.left]) if (typeof who === "string") this.forgetBadges(who);
      void this.load().catch(() => {});
      this.onClubChanged(m.club as string, m);
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  async load() {
    const r = await this.auth.get<{ clubs: MyClub[]; invites: Invite[]; max: number; crests: string[]; colors: string[]; tiers: ClubTier[] }>("/api/social/clubs");
    this.mine = r.clubs;
    this.invites = r.invites;
    this.max = r.max;
    this.crests = r.crests;
    this.colors = r.colors;
    this.tiers = r.tiers ?? [];
    // Our own badge may have changed.
    const me = this.auth.player?.display_name;
    if (me) {
      const b = this.mine.find((c) => c.badge);
      this.setBadge(me, b ? { club: b.name, crest: b.crest, color: b.color } : null);
    }
    this.changed();
  }

  club(id: string): MyClub | null {
    return this.mine.find((c) => c.id === id) ?? null;
  }

  directory(): Promise<PublicClub[]> {
    return this.auth.get<{ clubs: PublicClub[] }>("/api/social/clubs/directory").then((r) => r.clubs);
  }

  /** A club's page: the members' view, or (`role` null) just its name and size. */
  detail(id: string): Promise<Detail | { club: PublicClub; role: null }> {
    return this.auth.get(`/api/social/clubs/${id}`);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await this.auth.send<T>(path, body);
    await this.load().catch(() => {});
    return r;
  }

  found(name: string, crest: string, color: string) {
    return this.post<{ id: string; name: string }>("/api/social/clubs/found", { name, crest, color });
  }

  invite(club: string, friend: string) {
    return this.post(`/api/social/clubs/${club}/invite`, { id: friend });
  }

  answer(club: string, accept: boolean) {
    return this.post<{ joined: boolean }>(`/api/social/clubs/${club}/answer`, { accept });
  }

  leave(club: string) {
    return this.post<{ left: boolean; closed: boolean }>(`/api/social/clubs/${club}/leave`, {});
  }

  remove(club: string, who: string) {
    return this.post(`/api/social/clubs/${club}/remove`, { id: who });
  }

  setRole(club: string, who: string, role: Role) {
    return this.post(`/api/social/clubs/${club}/role`, { id: who, role });
  }

  donate(club: string, coins: number) {
    return this.post<{ treasury: number }>(`/api/social/clubs/${club}/donate`, { coins, key: key() });
  }

  say(club: string, text: string) {
    return this.post(`/api/social/clubs/${club}/post`, { text });
  }

  unsay(club: string, post: number) {
    return this.post(`/api/social/clubs/${club}/posts/${post}/delete`, {});
  }

  rentRoom(club: string, tier: number) {
    return this.post<{ room: Room }>(`/api/social/clubs/${club}/room`, { tier });
  }

  pay(club: string) {
    return this.post<{ room: Room }>(`/api/social/clubs/${club}/pay`, {});
  }

  showBadge(club: string) {
    return this.post(`/api/social/clubs/${club}/badge`, {});
  }

  // ---- crests by names ------------------------------------------------------

  onBadges(fn: () => void): () => void {
    this.badgeListeners.add(fn);
    return () => this.badgeListeners.delete(fn);
  }

  /** Asks again about `name`'s crest (or everyone's, e.g. on a new zone). */
  forgetBadges(name?: string) {
    if (name === undefined) this.badges.clear();
    else if (this.badges.delete(name)) this.badgeOf(name);
  }

  private setBadge(name: string, b: Badge | null) {
    const was = this.badges.get(name);
    this.badges.set(name, b);
    if (was?.crest !== b?.crest || was?.club !== b?.club) for (const fn of this.badgeListeners) fn();
  }

  /** The crest `name` shows (asking the server once, in batches, if not known yet). */
  badgeOf(name: string): Badge | null {
    if (this.badges.has(name)) return this.badges.get(name) ?? null;
    this.asking.add(name);
    if (!this.askTimer) this.askTimer = window.setTimeout(() => void this.ask(), 300);
    return null;
  }

  private async ask() {
    this.askTimer = 0;
    const names = [...this.asking].slice(0, 100);
    for (const n of names) this.asking.delete(n);
    if (this.asking.size) this.askTimer = window.setTimeout(() => void this.ask(), 300);
    if (!names.length) return;
    try {
      const r = await this.auth.get<Record<string, Badge>>(`/api/social/clubs/badges?names=${encodeURIComponent(names.join(","))}`);
      for (const n of names) this.badges.set(n, r[n] ?? null);
      for (const fn of this.badgeListeners) fn();
    } catch {
      // Ask again next time they're seen.
    }
  }
}

/** "Room paid until Thu 23 Oct", or what's owed and by when. */
export function roomStatus(r: Room): string {
  const day = (s: number) => new Date(s * 1000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  if (r.state === "grace" && r.grace_until) return `Rent is due: ${r.rent} coins from the treasury by ${day(r.grace_until)}, or the room is given up (the club carries on).`;
  return `${r.tier_name}: ${r.rent} coins a week from the treasury · paid until ${day(r.paid_until)}`;
}
