// The café's open voice (ADR 0021; server: crates/social/src/lounge.rs).
// Inside The Cozy Cup everyone hears everyone: one LiveKit room per café
// instance, a pass that may talk and listen. Nothing is joined until you've
// said yes (the warning at the door, or the question inside if you came
// another way), and your microphone only goes on if you chose that.
// Whoever you've blocked (or who's blocked you) is never played, and may
// not subscribe to you.

import { type Participant, type RemoteParticipant, type RemoteTrack, Room, RoomEvent, Track } from "livekit-client";
import type { Auth } from "./net/api";

interface Pass {
  url: string;
  token: string;
  room: string;
  blocked: string[];
}

export interface LoungeStatus {
  in_cafe: boolean;
  why_not?: string | null;
}

/** What you said at the door, for the café you're about to walk into. */
export type Consent = "mic" | "muted";

export class Lounge {
  /** Connected to the café's voice. */
  on = false;
  /** Our microphone's on (and we're heard). */
  mic = false;
  /** Everyone else turned right down. */
  deaf = false;
  /** Names of whoever's talking just now. */
  speaking = new Set<string>();
  /** How many others are in the voice room. */
  others = 0;
  private room: Room | null = null;
  private blocked = new Set<string>();
  private audio = new Map<string, HTMLMediaElement[]>();
  private listeners = new Set<() => void>();
  private gen = 0;
  onToast: (text: string) => void = () => {};

  constructor(private auth: Auth) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  /** Whether you may use the café's voice (asks again while the zone's report is on its way). */
  async status(): Promise<LoungeStatus> {
    let s: LoungeStatus = { in_cafe: false };
    for (let i = 0; i < 5; i++) {
      s = await this.auth.get<LoungeStatus>("/api/social/lounge");
      if (s.in_cafe) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    return s;
  }

  /** Into the café's voice, the microphone on or off as you chose. */
  async join(consent: Consent) {
    const gen = ++this.gen;
    const s = await this.status();
    if (gen !== this.gen) return;
    if (!s.in_cafe) return;
    if (s.why_not) {
      this.onToast(`🎙️ ${s.why_not}`);
      return;
    }
    const p = await this.auth.send<Pass>("/api/social/lounge/join", {});
    if (gen !== this.gen) return;
    this.blocked = new Set(p.blocked);
    const room = new Room({ adaptiveStream: false, dynacast: false });
    this.room = room;
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, who: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio || this.blocked.has(who.identity)) return;
        const el = track.attach();
        el.volume = this.deaf ? 0 : 1;
        el.dataset.lounge = "1";
        document.body.appendChild(el);
        this.audio.set(who.identity, [...(this.audio.get(who.identity) ?? []), el]);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, who: RemoteParticipant) => {
        for (const el of track.detach()) el.remove();
        this.drop(who.identity);
      })
      // They've blocked us: LiveKit stops sending, and we stop playing.
      .on(RoomEvent.TrackSubscriptionPermissionChanged, (_pub, status, who: RemoteParticipant) => {
        if (status === "not_allowed") this.drop(who.identity);
      })
      .on(RoomEvent.ParticipantConnected, () => this.allow())
      .on(RoomEvent.ParticipantDisconnected, (who: RemoteParticipant) => {
        this.drop(who.identity);
        this.allow();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (who: Participant[]) => {
        this.speaking = new Set(who.filter((p) => !this.blocked.has(p.identity)).map((p) => p.name ?? ""));
        this.emit();
      })
      .on(RoomEvent.Disconnected, () => {
        if (this.room === room) void this.leave().finally(() => this.emit());
      });
    try {
      await room.connect(p.url, p.token);
    } catch {
      if (this.room === room) this.room = null;
      this.onToast("🎙️ The café's voice isn't answering. Try again in a moment?");
      return;
    }
    if (gen !== this.gen) return void room.disconnect();
    this.on = true;
    this.allow();
    if (consent === "mic") await this.setMic(true);
    this.emit();
  }

  /**
   * Only those we haven't blocked (either way) may hear us: everyone in
   * the room, or (with blocks among them) everyone but them.
   */
  private allow() {
    const room = this.room;
    if (!room) return;
    const others = [...room.remoteParticipants.values()];
    this.others = others.length;
    const blockedHere = others.some((p) => this.blocked.has(p.identity));
    room.localParticipant.setTrackSubscriptionPermissions(
      !blockedHere,
      blockedHere ? others.filter((p) => !this.blocked.has(p.identity)).map((p) => ({ participantIdentity: p.identity, allowAll: true })) : [],
    );
    this.emit();
  }

  /** Just blocked `name`: they're silenced and can't hear us, from now on. */
  block(name: string) {
    const who = [...(this.room?.remoteParticipants.values() ?? [])].find((p) => p.name === name);
    if (!who) return;
    this.blocked.add(who.identity);
    this.drop(who.identity);
    this.speaking.delete(name);
    this.allow();
  }

  /** Stops playing `identity`. */
  private drop(identity: string) {
    for (const el of this.audio.get(identity) ?? []) el.remove();
    this.audio.delete(identity);
  }

  async setMic(on: boolean) {
    const room = this.room;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      this.mic = on;
    } catch {
      this.mic = false;
      this.onToast("🎙️ Your microphone is blocked, so nobody can hear you. Allow it in the browser and try again.");
    }
    this.emit();
  }

  setDeaf(deaf: boolean) {
    this.deaf = deaf;
    for (const els of this.audio.values()) for (const el of els) el.volume = deaf ? 0 : 1;
    this.emit();
  }

  /** Out of the café's voice (leaving the café, or "leave voice"). */
  async leave() {
    this.gen++;
    const room = this.room;
    const was = this.on;
    this.room = null;
    this.on = false;
    this.mic = false;
    this.others = 0;
    this.speaking.clear();
    for (const els of this.audio.values()) for (const el of els) el.remove();
    this.audio.clear();
    if (room) await room.disconnect().catch(() => {});
    if (was || room) await this.auth.send("/api/social/lounge/leave", {}).catch(() => {});
    this.emit();
  }
}
