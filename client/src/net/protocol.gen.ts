// AUTO-GENERATED from server/crates/protocol by `cargo run -p commons-protocol --bin gen-ts`.
// Do not edit by hand.
/* eslint-disable */

export const PROTOCOL_VERSION = 2;
export const CELL_TILES = 16;

export class Writer {
  private buf = new Uint8Array(64);
  private view = new DataView(this.buf.buffer);
  private len = 0;
  private reserve(n: number) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.reserve(1); this.view.setUint8(this.len, v); this.len += 1; }
  u16(v: number) { this.reserve(2); this.view.setUint16(this.len, v, true); this.len += 2; }
  u32(v: number) { this.reserve(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; }
  bool(v: boolean) { this.u8(v ? 1 : 0); }
  bytes(b: Uint8Array) { this.reserve(b.length); this.buf.set(b, this.len); this.len += b.length; }
  str(v: string) { const b = textEncoder.encode(v); this.u16(b.length); this.bytes(b); }
  vec<T>(v: T[], f: (x: T) => void) { this.u16(v.length); for (const x of v) f(x); }
  finish(): Uint8Array { return this.buf.slice(0, this.len); }
}

export class Reader {
  private view: DataView;
  private pos = 0;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number) { if (this.pos + n > this.buf.length) throw new Error("protocol: unexpected end of message"); }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  u16() { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  bool() { return this.u8() !== 0; }
  str() { const n = this.u16(); this.need(n); const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
  vec<T>(f: () => T): T[] { const n = this.u16(); const out: T[] = []; for (let i = 0; i < n; i++) out.push(f()); return out; }
  done() { if (this.pos !== this.buf.length) throw new Error(`protocol: ${this.buf.length - this.pos} trailing bytes`); }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** Packs encoded messages into one frame of `[u16 length][message]` entries. */
export function encodeFrame(msgs: Uint8Array[]): Uint8Array {
  const w = new Writer();
  for (const m of msgs) { w.u16(m.length); w.bytes(m); }
  return w.finish();
}

/** Splits a frame into its encoded messages. */
export function splitFrame(frame: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let pos = 0;
  while (pos < frame.length) {
    if (pos + 2 > frame.length) throw new Error("protocol: truncated frame");
    const n = view.getUint16(pos, true);
    pos += 2;
    if (pos + n > frame.length) throw new Error("protocol: truncated frame");
    out.push(frame.subarray(pos, pos + n));
    pos += n;
  }
  return out;
}

export interface Tile {
  x: number;
  y: number;
}

export function encTile(w: Writer, v: Tile) {
  w.u16(v.x);
  w.u16(v.y);
}

export function decTile(r: Reader): Tile {
  return {
    x: r.u16(),
    y: r.u16(),
  };
}

export interface EntityInfo {
  id: number;
  name: string;
  look: number;
  x: number;
  y: number;
  state: number;
  speedX10: number;
  t0: number;
  path: Tile[];
}

export function encEntityInfo(w: Writer, v: EntityInfo) {
  w.u32(v.id);
  w.str(v.name);
  w.u32(v.look);
  w.u16(v.x);
  w.u16(v.y);
  w.u8(v.state);
  w.u8(v.speedX10);
  w.u32(v.t0);
  w.vec(v.path, (x) => encTile(w, x));
}

export function decEntityInfo(r: Reader): EntityInfo {
  return {
    id: r.u32(),
    name: r.str(),
    look: r.u32(),
    x: r.u16(),
    y: r.u16(),
    state: r.u8(),
    speedX10: r.u8(),
    t0: r.u32(),
    path: r.vec(() => decTile(r)),
  };
}

export type ClientMsg =
  | { t: "Hello"; joinToken: string; version: number; viewW: number; viewH: number }
  | { t: "MoveTo"; x: number; y: number }
  | { t: "Emote"; emote: number }
  | { t: "ChatSay"; text: string }
  | { t: "Ping"; clientT: number }
  | { t: "Sit"; seat: number }
  | { t: "Stand" }
  | { t: "GameMove"; table: number; uci: string }
  ;

export function encodeClientMsg(m: ClientMsg): Uint8Array {
  const w = new Writer();
  switch (m.t) {
    case "Hello":
      w.u8(1);
      w.str(m.joinToken);
      w.u16(m.version);
      w.u8(m.viewW);
      w.u8(m.viewH);
      break;
    case "MoveTo":
      w.u8(2);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "Emote":
      w.u8(3);
      w.u8(m.emote);
      break;
    case "ChatSay":
      w.u8(4);
      w.str(m.text);
      break;
    case "Ping":
      w.u8(5);
      w.u32(m.clientT);
      break;
    case "Sit":
      w.u8(6);
      w.u32(m.seat);
      break;
    case "Stand":
      w.u8(7);
      break;
    case "GameMove":
      w.u8(8);
      w.u32(m.table);
      w.str(m.uci);
      break;
  }
  return w.finish();
}

export function decodeClientMsg(b: Uint8Array): ClientMsg {
  const r = new Reader(b);
  let m: ClientMsg;
  const tag = r.u8();
  switch (tag) {
    case 1:
      m = { t: "Hello", joinToken: r.str(), version: r.u16(), viewW: r.u8(), viewH: r.u8() };
      break;
    case 2:
      m = { t: "MoveTo", x: r.u16(), y: r.u16() };
      break;
    case 3:
      m = { t: "Emote", emote: r.u8() };
      break;
    case 4:
      m = { t: "ChatSay", text: r.str() };
      break;
    case 5:
      m = { t: "Ping", clientT: r.u32() };
      break;
    case 6:
      m = { t: "Sit", seat: r.u32() };
      break;
    case 7:
      m = { t: "Stand" };
      break;
    case 8:
      m = { t: "GameMove", table: r.u32(), uci: r.str() };
      break;
    default:
      throw new Error(`protocol: unknown ClientMsg tag ${tag}`);
  }
  r.done();
  return m;
}

export type ServerMsg =
  | { t: "Welcome"; zone: string; instance: number; selfId: number; serverT: number }
  | { t: "CellEnter"; cell: number; entities: EntityInfo[] }
  | { t: "CellLeave"; cell: number; ids: number[] }
  | { t: "Spawn"; entity: EntityInfo }
  | { t: "Despawn"; id: number }
  | { t: "MoveStart"; id: number; speedX10: number; t0: number; path: Tile[] }
  | { t: "Snap"; id: number; x: number; y: number }
  | { t: "EmoteShown"; id: number; emote: number }
  | { t: "ChatBubble"; id: number; text: string }
  | { t: "Pong"; clientT: number; serverT: number }
  | { t: "Error"; code: number; message: string }
  | { t: "StateChange"; id: number; state: number; x: number; y: number }
  | { t: "GameState"; table: number; status: number; white: number; black: number; fen: string; last: string; legal: string[] }
  | { t: "ScreenState"; screen: number; title: string; source: string; startedT: number; durationMs: number }
  ;

export function encodeServerMsg(m: ServerMsg): Uint8Array {
  const w = new Writer();
  switch (m.t) {
    case "Welcome":
      w.u8(1);
      w.str(m.zone);
      w.u16(m.instance);
      w.u32(m.selfId);
      w.u32(m.serverT);
      break;
    case "CellEnter":
      w.u8(2);
      w.u16(m.cell);
      w.vec(m.entities, (x) => encEntityInfo(w, x));
      break;
    case "CellLeave":
      w.u8(3);
      w.u16(m.cell);
      w.vec(m.ids, (x) => w.u32(x));
      break;
    case "Spawn":
      w.u8(4);
      encEntityInfo(w, m.entity);
      break;
    case "Despawn":
      w.u8(5);
      w.u32(m.id);
      break;
    case "MoveStart":
      w.u8(6);
      w.u32(m.id);
      w.u8(m.speedX10);
      w.u32(m.t0);
      w.vec(m.path, (x) => encTile(w, x));
      break;
    case "Snap":
      w.u8(7);
      w.u32(m.id);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "EmoteShown":
      w.u8(8);
      w.u32(m.id);
      w.u8(m.emote);
      break;
    case "ChatBubble":
      w.u8(9);
      w.u32(m.id);
      w.str(m.text);
      break;
    case "Pong":
      w.u8(10);
      w.u32(m.clientT);
      w.u32(m.serverT);
      break;
    case "Error":
      w.u8(11);
      w.u16(m.code);
      w.str(m.message);
      break;
    case "StateChange":
      w.u8(12);
      w.u32(m.id);
      w.u8(m.state);
      w.u16(m.x);
      w.u16(m.y);
      break;
    case "GameState":
      w.u8(13);
      w.u32(m.table);
      w.u8(m.status);
      w.u32(m.white);
      w.u32(m.black);
      w.str(m.fen);
      w.str(m.last);
      w.vec(m.legal, (x) => w.str(x));
      break;
    case "ScreenState":
      w.u8(14);
      w.u32(m.screen);
      w.str(m.title);
      w.str(m.source);
      w.u32(m.startedT);
      w.u32(m.durationMs);
      break;
  }
  return w.finish();
}

export function decodeServerMsg(b: Uint8Array): ServerMsg {
  const r = new Reader(b);
  let m: ServerMsg;
  const tag = r.u8();
  switch (tag) {
    case 1:
      m = { t: "Welcome", zone: r.str(), instance: r.u16(), selfId: r.u32(), serverT: r.u32() };
      break;
    case 2:
      m = { t: "CellEnter", cell: r.u16(), entities: r.vec(() => decEntityInfo(r)) };
      break;
    case 3:
      m = { t: "CellLeave", cell: r.u16(), ids: r.vec(() => r.u32()) };
      break;
    case 4:
      m = { t: "Spawn", entity: decEntityInfo(r) };
      break;
    case 5:
      m = { t: "Despawn", id: r.u32() };
      break;
    case 6:
      m = { t: "MoveStart", id: r.u32(), speedX10: r.u8(), t0: r.u32(), path: r.vec(() => decTile(r)) };
      break;
    case 7:
      m = { t: "Snap", id: r.u32(), x: r.u16(), y: r.u16() };
      break;
    case 8:
      m = { t: "EmoteShown", id: r.u32(), emote: r.u8() };
      break;
    case 9:
      m = { t: "ChatBubble", id: r.u32(), text: r.str() };
      break;
    case 10:
      m = { t: "Pong", clientT: r.u32(), serverT: r.u32() };
      break;
    case 11:
      m = { t: "Error", code: r.u16(), message: r.str() };
      break;
    case 12:
      m = { t: "StateChange", id: r.u32(), state: r.u8(), x: r.u16(), y: r.u16() };
      break;
    case 13:
      m = { t: "GameState", table: r.u32(), status: r.u8(), white: r.u32(), black: r.u32(), fen: r.str(), last: r.str(), legal: r.vec(() => r.str()) };
      break;
    case 14:
      m = { t: "ScreenState", screen: r.u32(), title: r.str(), source: r.str(), startedT: r.u32(), durationMs: r.u32() };
      break;
    default:
      throw new Error(`protocol: unknown ServerMsg tag ${tag}`);
  }
  r.done();
  return m;
}
