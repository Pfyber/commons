//! TypeScript codegen for the client (`client/src/net/protocol.gen.ts`).
//! Field names are converted to camelCase; messages become a discriminated
//! union on `t`.

use crate::schema::{EnumSchema, RecordSchema};
use crate::wire::Ty;
use crate::{ClientMsg, EntityInfo, ServerMsg, Tile, record_schemas};
use std::fmt::Write;

const RUNTIME: &str = r#"export class Writer {
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
"#;

fn camel(s: &str) -> String {
    let mut out = String::new();
    let mut upper = false;
    for c in s.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn ts_type(ty: &Ty) -> String {
    match ty {
        Ty::U8 | Ty::U16 | Ty::U32 => "number".into(),
        Ty::Bool => "boolean".into(),
        Ty::Str => "string".into(),
        Ty::Vec(inner) => format!("{}[]", ts_type(inner)),
        Ty::Record(name) => (*name).into(),
    }
}

fn ts_enc(ty: &Ty, expr: &str) -> String {
    match ty {
        Ty::U8 => format!("w.u8({expr})"),
        Ty::U16 => format!("w.u16({expr})"),
        Ty::U32 => format!("w.u32({expr})"),
        Ty::Bool => format!("w.bool({expr})"),
        Ty::Str => format!("w.str({expr})"),
        Ty::Vec(inner) => format!("w.vec({expr}, (x) => {})", ts_enc(inner, "x")),
        Ty::Record(name) => format!("enc{name}(w, {expr})"),
    }
}

fn ts_dec(ty: &Ty) -> String {
    match ty {
        Ty::U8 => "r.u8()".into(),
        Ty::U16 => "r.u16()".into(),
        Ty::U32 => "r.u32()".into(),
        Ty::Bool => "r.bool()".into(),
        Ty::Str => "r.str()".into(),
        Ty::Vec(inner) => format!("r.vec(() => {})", ts_dec(inner)),
        Ty::Record(name) => format!("dec{name}(r)"),
    }
}

fn gen_record(out: &mut String, rec: &RecordSchema) {
    let n = rec.name;
    writeln!(out, "export interface {n} {{").unwrap();
    for (f, ty) in &rec.fields {
        writeln!(out, "  {}: {};", camel(f), ts_type(ty)).unwrap();
    }
    writeln!(out, "}}\n").unwrap();
    writeln!(out, "export function enc{n}(w: Writer, v: {n}) {{").unwrap();
    for (f, ty) in &rec.fields {
        writeln!(out, "  {};", ts_enc(ty, &format!("v.{}", camel(f)))).unwrap();
    }
    writeln!(out, "}}\n").unwrap();
    writeln!(out, "export function dec{n}(r: Reader): {n} {{").unwrap();
    writeln!(out, "  return {{").unwrap();
    for (f, ty) in &rec.fields {
        writeln!(out, "    {}: {},", camel(f), ts_dec(ty)).unwrap();
    }
    writeln!(out, "  }};\n}}\n").unwrap();
}

fn gen_enum(out: &mut String, e: &EnumSchema) {
    let n = e.name;
    writeln!(out, "export type {n} =").unwrap();
    for v in &e.variants {
        let fields: String = v
            .fields
            .iter()
            .map(|(f, ty)| format!("; {}: {}", camel(f), ts_type(ty)))
            .collect();
        writeln!(out, "  | {{ t: \"{}\"{} }}", v.name, fields).unwrap();
    }
    writeln!(out, "  ;\n").unwrap();

    writeln!(out, "export function encode{n}(m: {n}): Uint8Array {{").unwrap();
    writeln!(out, "  const w = new Writer();").unwrap();
    writeln!(out, "  switch (m.t) {{").unwrap();
    for v in &e.variants {
        writeln!(out, "    case \"{}\":", v.name).unwrap();
        writeln!(out, "      w.u8({});", v.tag).unwrap();
        for (f, ty) in &v.fields {
            writeln!(out, "      {};", ts_enc(ty, &format!("m.{}", camel(f)))).unwrap();
        }
        writeln!(out, "      break;").unwrap();
    }
    writeln!(out, "  }}\n  return w.finish();\n}}\n").unwrap();

    writeln!(out, "export function decode{n}(b: Uint8Array): {n} {{").unwrap();
    writeln!(out, "  const r = new Reader(b);").unwrap();
    writeln!(out, "  let m: {n};").unwrap();
    writeln!(out, "  const tag = r.u8();").unwrap();
    writeln!(out, "  switch (tag) {{").unwrap();
    for v in &e.variants {
        let fields: String = v
            .fields
            .iter()
            .map(|(f, ty)| format!(", {}: {}", camel(f), ts_dec(ty)))
            .collect();
        writeln!(out, "    case {}:", v.tag).unwrap();
        writeln!(out, "      m = {{ t: \"{}\"{} }};", v.name, fields).unwrap();
        writeln!(out, "      break;").unwrap();
    }
    writeln!(out, "    default:").unwrap();
    writeln!(
        out,
        "      throw new Error(`protocol: unknown {n} tag ${{tag}}`);"
    )
    .unwrap();
    writeln!(out, "  }}\n  r.done();\n  return m;\n}}\n").unwrap();
}

/// The full contents of `protocol.gen.ts`.
pub fn generate() -> String {
    let mut out = String::new();
    out.push_str("// AUTO-GENERATED from server/crates/protocol by `cargo run -p commons-protocol --bin gen-ts`.\n");
    out.push_str("// Do not edit by hand.\n/* eslint-disable */\n\n");
    writeln!(
        out,
        "export const PROTOCOL_VERSION = {};",
        crate::PROTOCOL_VERSION
    )
    .unwrap();
    writeln!(out, "export const CELL_TILES = {};\n", crate::CELL_TILES).unwrap();
    out.push_str(RUNTIME);
    out.push('\n');
    for rec in record_schemas() {
        gen_record(&mut out, &rec);
    }
    gen_enum(&mut out, &ClientMsg::schema());
    gen_enum(&mut out, &ServerMsg::schema());
    out.truncate(out.trim_end().len());
    out.push('\n');
    out
}

/// Sample messages whose Rust encodings the client tests must round-trip.
pub fn sample_vectors() -> String {
    let info = EntityInfo {
        id: 42,
        name: "Ćiril ☘".into(),
        look: 0x8000_0001,
        x: 95,
        y: 0,
        state: 0,
        speed_x10: 40,
        t0: 4_000_000_000,
        path: vec![Tile { x: 95, y: 0 }, Tile { x: 90, y: 5 }],
    };
    let client = [
        ClientMsg::Hello {
            join_token: "abc.def.ghi".into(),
            version: 1,
            view_w: 30,
            view_h: 17,
        },
        ClientMsg::MoveTo { x: 12, y: 65535 },
        ClientMsg::Emote { emote: 7 },
        ClientMsg::ChatSay {
            text: "hello 👋".into(),
        },
        ClientMsg::Ping { client_t: 123456 },
    ];
    let server = [
        ServerMsg::Welcome {
            zone: "founders_park".into(),
            instance: 2,
            self_id: 42,
            server_t: 77,
        },
        ServerMsg::CellEnter {
            cell: 35,
            entities: vec![info.clone()],
        },
        ServerMsg::CellLeave {
            cell: 35,
            ids: vec![1, 2],
        },
        ServerMsg::Spawn { entity: info },
        ServerMsg::MoveStart {
            id: 1,
            speed_x10: 40,
            t0: 9,
            path: vec![Tile { x: 1, y: 2 }],
        },
        ServerMsg::ChatBubble {
            id: 1,
            text: "".into(),
        },
        ServerMsg::Error {
            code: 4,
            message: "no path".into(),
        },
    ];
    let hex = |b: Vec<u8>| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    let list = |v: Vec<(&str, Vec<u8>)>| {
        v.into_iter()
            .map(|(name, b)| format!("    {{ \"t\": \"{name}\", \"hex\": \"{}\" }}", hex(b)))
            .collect::<Vec<_>>()
            .join(",\n")
    };
    format!(
        "{{\n  \"client\": [\n{}\n  ],\n  \"server\": [\n{}\n  ]\n}}\n",
        list(client.iter().map(|m| (m.name(), m.to_bytes())).collect()),
        list(server.iter().map(|m| (m.name(), m.to_bytes())).collect()),
    )
}
