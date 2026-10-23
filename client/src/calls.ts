// Phone calls (ADR 0013; server: crates/social/src/calls.rs). Friends with a
// phone ring each other through the social gateway; the voices go through
// LiveKit, one room per call. Anyone in a call can ring another friend in;
// answering while you're in another call moves you over. Whoever started
// the call (its host) can remove people; every call goes in the call log.

import { type Participant, type RemoteTrack, Room, RoomEvent, Track } from "livekit-client";
import type { Auth } from "./net/api";
import type { Social } from "./social";

/** The Mobile Phone (item id, migration 0029). */
export const PHONE = 950;

export interface Member {
  id: string;
  name: string;
}

export interface Contact {
  id: string;
  name: string;
  online: boolean;
  phone: boolean;
  callable: boolean;
  why: string | null;
}

export interface Contacts {
  phone: boolean;
  can_call: boolean;
  why: string | null;
  /** An under-16's switch for calls (once calls are open to them). */
  switch: boolean;
  voice_ok: boolean;
  in_call: string | null;
  friends: Contact[];
}

export interface Ringing {
  call: string;
  fromId: string;
  fromName: string;
  members: Member[];
}

interface Pass {
  call: string;
  url: string;
  token: string;
  members?: Member[];
  host?: string | null;
}

/** A line of the call log. */
export interface LogLine {
  direction: "out" | "in";
  status: "talked" | "unanswered" | "missed" | "declined" | "removed" | string;
  people: Member[];
  /** Unix seconds. */
  at: number;
  /** How long (null: still on). */
  secs: number | null;
}

/** "3 min", "45 s", "1 h 5 min". */
export function callLength(secs: number): string {
  if (secs < 60) return `${secs} s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

type Push = { t: string; [k: string]: unknown };

/** A gentle two-note ring, repeating, while a call is ringing you. */
class Ringtone {
  private ctx: AudioContext | null = null;
  private timer = 0;

  start(muted: () => boolean) {
    this.stop();
    const play = () => {
      if (muted()) return;
      try {
        this.ctx ??= new AudioContext();
        const ctx = this.ctx;
        const t = ctx.currentTime;
        for (const [i, f] of [660, 880, 660, 880].entries()) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = f;
          g.gain.setValueAtTime(0, t + i * 0.18);
          g.gain.linearRampToValueAtTime(0.08, t + i * 0.18 + 0.02);
          g.gain.linearRampToValueAtTime(0, t + i * 0.18 + 0.16);
          o.connect(g).connect(ctx.destination);
          o.start(t + i * 0.18);
          o.stop(t + i * 0.18 + 0.17);
        }
      } catch {
        // no audio here
      }
    };
    play();
    this.timer = window.setInterval(play, 2200);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
  }
}

export class Calls {
  /** The call you're in (null: none). */
  call: string | null = null;
  members: Member[] = [];
  /** Who started the call (or took over): they can remove people. */
  host: string | null = null;
  /** The call just left (news about it can arrive after LiveKit cut us off). */
  private lastCall: string | null = null;
  /** A call ringing you. */
  ringing: Ringing | null = null;
  muted = false;
  /** Whether the microphone is working (it can be blocked by the browser). */
  micOk = true;
  /** Who's talking right now (player ids). */
  speaking = new Set<string>();
  private room: Room | null = null;
  private audio = new Map<string, HTMLMediaElement[]>();
  private listeners = new Set<() => void>();
  private ringtone = new Ringtone();
  onToast: (text: string) => void = () => {};
  /** You're on a call, or not any more (to show the phone at your ear). */
  onCalling: (on: boolean) => void = () => {};
  /** Whether sound is muted (the ringtone keeps quiet then). */
  soundMuted: () => boolean = () => false;

  constructor(
    private auth: Auth,
    private social: Social,
  ) {
    social.onPush((m) => this.receive(m));
  }

  /** Whether you're the host of your call. */
  get hosting(): boolean {
    return this.live && this.host === this.social.selfId;
  }

  /** The host removes someone from the call. */
  async remove(id: string): Promise<void> {
    await this.auth.send("/api/social/call/remove", { id });
  }

  /** Your call log, newest first. */
  log(): Promise<LogLine[]> {
    return this.auth.get<{ calls: LogLine[] }>("/api/social/call/log").then((r) => r.calls);
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  get live(): boolean {
    return this.call !== null;
  }

  contacts(): Promise<Contacts> {
    return this.auth.get<Contacts>("/api/social/call/contacts");
  }

  /** Rings a friend: into your call, or a new one. */
  async ring(id: string): Promise<void> {
    const p = await this.auth.send<Pass>("/api/social/call/ring", { id });
    await this.join(p);
  }

  /** The club call: rings every member of `club` who's online; how many were rung. */
  async callClub(club: string): Promise<number> {
    const p = await this.auth.send<Pass & { rung: number }>(`/api/social/clubs/${club}/call`, {});
    await this.join(p);
    return p.rung;
  }

  /** Picks up (or turns down) the call ringing you. */
  async answer(accept: boolean): Promise<void> {
    const r = this.ringing;
    if (!r) return;
    this.ringing = null;
    this.ringtone.stop();
    this.emit();
    if (!accept) {
      await this.auth.send("/api/social/call/answer", { call: r.call, accept: false }).catch(() => {});
      return;
    }
    const p = await this.auth.send<Pass>("/api/social/call/answer", { call: r.call, accept: true });
    await this.join(p);
  }

  async hangUp(): Promise<void> {
    await this.auth.send("/api/social/call/leave", {}).catch(() => {});
    await this.disconnect();
  }

  /** An under-16 switching calls on or off (once calls are open to them). */
  setVoiceOk(on: boolean): Promise<unknown> {
    return this.auth.send("/api/social/call/settings", { voice_ok: on });
  }

  toggleMute() {
    this.muted = !this.muted;
    void this.room?.localParticipant.setMicrophoneEnabled(!this.muted).catch(() => {});
    this.emit();
  }

  /** Back into your call after a reload, if you were in one. */
  async resume(): Promise<void> {
    const r = await this.auth.get<Pass | { call: null }>("/api/social/call");
    if (r.call && "token" in r) await this.join(r);
  }

  private async join(p: Pass) {
    if (p.members) this.members = p.members;
    if (p.host !== undefined) this.host = p.host;
    if (this.call === p.call && this.room) {
      this.emit();
      return;
    }
    await this.disconnect(false);
    this.call = p.call;
    this.muted = false;
    const room = new Room({ adaptiveStream: false, dynacast: false });
    this.room = room;
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, who: Participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.caller = who.identity;
        document.body.appendChild(el);
        this.audio.set(who.identity, [...(this.audio.get(who.identity) ?? []), el]);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const el of track.detach()) el.remove();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.speaking = new Set(speakers.map((s) => s.identity));
        this.emit();
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.room === room) void this.disconnect();
      });
    this.emit();
    this.onCalling(true);
    try {
      await room.connect(p.url, p.token);
    } catch {
      this.onToast("📞 Couldn't get a line. Try again in a moment?");
      await this.hangUp();
      return;
    }
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      this.micOk = true;
    } catch {
      this.micOk = false;
      this.onToast("🎙️ Your microphone is blocked: you can listen, but nobody can hear you.");
    }
    this.emit();
  }

  private async disconnect(announce = true) {
    const room = this.room;
    this.room = null;
    const was = this.call !== null;
    if (this.call) this.lastCall = this.call;
    this.call = null;
    this.members = [];
    this.host = null;
    this.speaking.clear();
    for (const els of this.audio.values()) for (const el of els) el.remove();
    this.audio.clear();
    if (room) await room.disconnect().catch(() => {});
    if (was && announce) this.onCalling(false);
    this.emit();
  }

  private receive(m: Push) {
    switch (m.t) {
      case "call_ring": {
        this.ringing = { call: m.call as string, fromId: m.from_id as string, fromName: m.from_name as string, members: (m.members as Member[]) ?? [] };
        this.ringtone.start(this.soundMuted);
        this.emit();
        break;
      }
      case "call_missed":
        if (this.ringing && this.ringing.call === m.call) {
          this.onToast(`📞 Missed a call from ${this.ringing.fromName}.`);
          this.ringing = null;
          this.ringtone.stop();
          this.emit();
        }
        break;
      case "call":
        if (m.call === this.call) {
          this.members = m.members as Member[];
          this.host = (m.host as string | null) ?? null;
          this.emit();
        }
        break;
      case "call_removed":
        if (m.call === this.call || m.call === this.lastCall) {
          this.onToast(`📞 ${m.by_name as string} removed you from the call.`);
          void this.disconnect();
        }
        break;
      case "call_declined":
        this.onToast(`📞 ${m.name as string} can't talk right now.`);
        break;
      case "call_unanswered":
        this.onToast(`📞 ${m.name as string} didn't pick up.`);
        break;
      case "call_ended":
        if (m.call === this.call) {
          this.onToast("📞 The call's over.");
          void this.disconnect();
        }
        if (this.ringing?.call === m.call) {
          this.ringing = null;
          this.ringtone.stop();
          this.emit();
        }
        break;
    }
  }
}
