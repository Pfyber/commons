// The Concert Hall (ADR 0015; server: crates/social/src/concert.rs). One
// player on stage, everyone in the hall listening: the performer joins the
// stage's LiveKit room with a pass that may talk, everyone else with a
// listen-only one (LiveKit refuses their microphone), so the hall hears the
// performer and nobody else. Listeners can turn it down or mute it.

import { type RemoteTrack, Room, RoomEvent, Track } from "livekit-client";
import type { Auth } from "./net/api";
import type { Social } from "./social";

/** Who's on stage, and until when (unix seconds). */
export interface Stage {
  performer: string;
  name: string;
  since: number;
  until: number;
}

export interface Status {
  in_hall: boolean;
  instance?: number;
  stage?: Stage | null;
  can_perform?: boolean;
  why_not_perform?: string | null;
  why_not_hear?: string | null;
}

interface Pass {
  url: string;
  token: string;
  stage: Stage;
}

type Push = { t: string; [k: string]: unknown };

export class Concert {
  /** In the hall (and which instance), and how its stage stands. */
  inHall = false;
  stage: Stage | null = null;
  status: Status = { in_hall: false };
  /** What we're doing: nothing, listening, or on stage. */
  mode: "off" | "listening" | "performing" = "off";
  /** Why we can't hear (the age rules, a block), if we can't. */
  why: string | null = null;
  volume = 0.9;
  muted = false;
  private room: Room | null = null;
  private audio: HTMLMediaElement[] = [];
  private listeners = new Set<() => void>();
  onToast: (text: string) => void = () => {};

  constructor(
    private auth: Auth,
    private selfId: string,
    social: Social,
  ) {
    social.onPush((m) => this.receive(m));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  get mine(): boolean {
    return this.stage?.performer === this.selfId;
  }

  /** Arrived in the hall: how the stage stands, and listen if someone's on. */
  async enterHall() {
    this.inHall = true;
    await this.refresh();
  }

  /** Left the hall: off the stage and out of the room. */
  async leaveHall() {
    this.inHall = false;
    if (this.mode === "performing") await this.auth.send("/api/social/concert/leave", {}).catch(() => {});
    await this.disconnect();
    this.stage = null;
    this.emit();
  }

  async refresh() {
    // The zone's presence report may still be on its way: ask again a moment later.
    for (let i = 0; i < 4 && this.inHall; i++) {
      this.status = await this.auth.get<Status>("/api/social/concert");
      if (this.status.in_hall) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!this.inHall) return;
    this.stage = this.status.stage ?? null;
    this.why = this.status.why_not_hear ?? null;
    await this.follow();
    this.emit();
  }

  private receive(m: Push) {
    if (m.t !== "concert" || !this.inHall) return;
    const was = this.stage;
    this.stage = (m.stage as Stage | null) ?? null;
    if (this.stage && this.stage.performer !== was?.performer && !this.mine) this.onToast(`🎤 ${this.stage.name} took the stage!`);
    if (!this.stage && was && was.performer !== this.selfId) this.onToast(`🎤 ${was.name} stepped down. The stage is free.`);
    void this.follow().finally(() => this.emit());
  }

  /** Listens to whoever's on (or stops, with nobody). */
  private async follow() {
    if (!this.stage) return this.disconnect();
    if (this.mine) return; // performing: our own room is up already
    if (this.mode === "listening") return;
    try {
      const p = await this.auth.send<Pass>("/api/social/concert/listen", {});
      this.why = null;
      await this.join(p, false);
    } catch (e) {
      this.why = e instanceof Error ? e.message : "You can't hear the stage just now.";
      await this.disconnect();
    }
  }

  /** Takes the stage: everyone in the hall hears you. */
  async takeStage() {
    const p = await this.auth.send<Pass>("/api/social/concert/stage", {});
    this.stage = p.stage;
    await this.disconnect();
    await this.join(p, true);
    this.emit();
  }

  async stepDown() {
    await this.auth.send("/api/social/concert/leave", {});
    await this.disconnect();
    this.stage = null;
    this.emit();
  }

  setVolume(v: number) {
    this.volume = v;
    for (const a of this.audio) a.volume = this.muted ? 0 : v;
    this.emit();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
  }

  private async join(p: Pass, talk: boolean) {
    const room = new Room({ adaptiveStream: false, dynacast: false });
    this.room = room;
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.volume = this.muted ? 0 : this.volume;
        el.dataset.concert = "1";
        document.body.appendChild(el);
        this.audio.push(el);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const el of track.detach()) el.remove();
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.room === room) void this.disconnect().finally(() => this.emit());
      });
    try {
      await room.connect(p.url, p.token);
    } catch {
      this.room = null;
      this.onToast("🎤 The hall's sound system isn't answering. Try again in a moment?");
      return;
    }
    this.mode = talk ? "performing" : "listening";
    if (talk) {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        this.onToast("🎙️ Your microphone is blocked, so the hall can't hear you. Allow it in the browser and try again.");
      }
    }
    this.emit();
  }

  private async disconnect() {
    const room = this.room;
    this.room = null;
    this.mode = "off";
    for (const a of this.audio) a.remove();
    this.audio = [];
    if (room) await room.disconnect().catch(() => {});
  }
}

/** "52 min left". */
export function timeLeft(s: Stage): string {
  const m = Math.max(0, Math.ceil((s.until - Date.now() / 1000) / 60));
  return `${m} min left`;
}
