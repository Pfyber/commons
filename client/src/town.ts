// Client for town life (server: crates/api/src/town.rs): topic quarters and
// their boards, the town goal, and the notice board's daily requests.

import type { Applied } from "./economy";
import type { Auth } from "./net/api";

export interface Quarter {
  slug: string;
  name: string;
  blurb: string;
  icon: string;
  members: number;
  joined: boolean;
  posts_this_week: number;
}

export interface Post {
  id: number;
  author_id: string;
  author_name: string;
  body: string;
  tags: string[];
  at: number;
}

export interface TagInfo {
  tag: string;
  authors: number;
  /** Enough different people use it: a street is forming. */
  forming: boolean;
}

export interface Goal {
  key: string;
  title: string;
  blurb: string;
  target: number;
  raised: number;
  done: boolean;
  mine: number;
  /** Keys of every goal reached so far. */
  reached: string[];
}

export interface Request {
  n: number;
  from: string;
  text: string;
  item: number;
  qty: number;
  reward: number;
  done: boolean;
}

export class Town {
  quarters: Quarter[] = [];
  goal: Goal | null = null;

  constructor(private auth: Auth) {}

  async loadQuarters(): Promise<Quarter[]> {
    this.quarters = await this.auth.get<Quarter[]>("/api/town/quarters");
    return this.quarters;
  }

  quarter(slug: string): Quarter | undefined {
    return this.quarters.find((q) => q.slug === slug);
  }

  async setJoined(slug: string, joined: boolean) {
    await this.auth.send(`/api/town/quarters/${slug}/${joined ? "join" : "leave"}`, {});
    await this.loadQuarters();
  }

  board(slug: string, tag?: string): Promise<{ posts: Post[]; tags: TagInfo[] }> {
    const q = tag ? `?tag=${encodeURIComponent(tag)}` : "";
    return this.auth.get(`/api/town/quarters/${slug}/board${q}`);
  }

  async post(slug: string, body: string): Promise<void> {
    await this.auth.send(`/api/town/quarters/${slug}/board`, { body });
  }

  async loadGoal(): Promise<Goal> {
    this.goal = await this.auth.get<Goal>("/api/town/goal");
    return this.goal;
  }

  async donate(amount: number): Promise<{ accepted: number; completed: boolean; coins: number; goal: Goal }> {
    const r = await this.auth.send<{ accepted: number; completed: boolean; coins: number; goal: Goal }>(
      "/api/town/goal/donate",
      { amount, key: crypto.randomUUID() },
    );
    this.goal = r.goal;
    return r;
  }

  async requests(): Promise<Request[]> {
    return (await this.auth.get<{ requests: Request[] }>("/api/town/requests")).requests;
  }

  deliver(n: number): Promise<Applied> {
    return this.auth.send<Applied>(`/api/town/requests/${n}/deliver`, {});
  }
}
