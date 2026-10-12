// Client for governance (server: crates/api/src/gov.rs): the Story of the
// Town, proposals and voting at the town hall, the public ledger, reports
// and the Caretaker's tools.

import type { Auth } from "./net/api";

export interface LedgerEntry {
  id: number;
  kind: string;
  summary: string;
  at: number;
}

export interface ProposalSummary {
  id: number;
  kind?: string;
  title: string;
  status: "collecting" | "discussion" | "voting" | "passed" | "failed" | "withdrawn";
  author?: string;
  by_caretaker?: boolean;
  ends: number;
  result?: ProposalResult | null;
}

export interface ProposalResult {
  turnout: number;
  eligible: number;
  quorum_met: boolean;
  winner: number | null;
  winner_text: string | null;
  voters: number;
  detail: { rounds?: (number | null)[][]; yes?: number; no?: number; share?: number };
  reason?: string;
}

export interface Proposal extends ProposalSummary {
  kind: string;
  body: string;
  options: string[];
  ranked: boolean;
  electorate: "founders" | "residents";
  threshold: number;
  quorum: number;
  created: number;
  voters: number;
  suggestions: { id: number; text: string; mine: boolean; support: number; supported: boolean }[];
  comments: { author: string; body: string; at: number }[];
  me: { voted: boolean; eligible: boolean; days: number; needs_days: number; caretaker: boolean };
}

export interface Story {
  name: string;
  phase: number;
  next: { phase: number; need?: number; have?: number; text: string };
  open: { id: number; title: string; status: string; ends: number }[];
  recent: LedgerEntry[];
  rules: { founding_days: number; resident_days: number; active_minutes: number; active_interactions: number };
  me?: {
    days: number;
    tier: "visitor" | "newcomer" | "resident" | "steward";
    caretaker: boolean;
    can_vote_founding: boolean;
    can_vote: boolean;
    can_propose: boolean;
    voted: number[];
  };
}

export interface Report {
  id: number;
  target_id: string | null;
  target_name: string;
  reason: string;
  context: string;
  at: number;
  reporter: string;
  reports_against: number;
}

export class Gov {
  story: Story | null = null;

  constructor(private auth: Auth) {}

  async loadStory(): Promise<Story> {
    this.story = await this.auth.get<Story>("/api/gov/story");
    return this.story;
  }

  proposals(): Promise<ProposalSummary[]> {
    return this.auth.get("/api/gov/proposals");
  }

  proposal(id: number): Promise<Proposal> {
    return this.auth.get(`/api/gov/proposals/${id}`);
  }

  create(p: { kind: string; title: string; body?: string; options?: string[]; collect?: boolean }): Promise<{ id: number }> {
    return this.auth.send("/api/gov/proposals", p);
  }

  async comment(id: number, text: string) {
    await this.auth.send(`/api/gov/proposals/${id}/comment`, { text });
  }

  async suggest(id: number, text: string) {
    await this.auth.send(`/api/gov/proposals/${id}/suggest`, { text });
  }

  async support(id: number, suggestion: number) {
    await this.auth.send(`/api/gov/proposals/${id}/support/${suggestion}`, {});
  }

  async vote(id: number, ranking: number[]) {
    await this.auth.send(`/api/gov/proposals/${id}/vote`, { ranking });
  }

  async advance(id: number) {
    await this.auth.send(`/api/gov/proposals/${id}/advance`, {});
  }

  ledger(before?: number): Promise<LedgerEntry[]> {
    return this.auth.get(`/api/gov/ledger${before ? `?before=${before}` : ""}`);
  }

  async report(target_name: string, reason: string, context: string) {
    await this.auth.send("/api/gov/report", { target_name, reason, context });
  }

  reports(): Promise<Report[]> {
    return this.auth.get("/api/gov/reports");
  }

  async resolve(id: number, action: string, note = "") {
    await this.auth.send(`/api/gov/reports/${id}/resolve`, { action, note });
  }

  async decision(title: string, body: string, until: string) {
    await this.auth.send("/api/gov/decision", { title, body, until });
  }
}
