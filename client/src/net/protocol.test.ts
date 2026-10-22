// Cross-language check: bytes produced by the Rust codec (protocol.vectors.json,
// written by gen-ts) must decode here and re-encode to identical bytes.
import { describe, expect, it } from "vitest";
import {
  decodeClientMsg,
  decodeServerMsg,
  encodeClientMsg,
  encodeFrame,
  encodeServerMsg,
  splitFrame,
} from "./protocol.gen";
import vectors from "./protocol.vectors.json";

const fromHex = (h: string) => new Uint8Array(h.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("protocol codec matches Rust", () => {
  for (const v of vectors.client) {
    it(`client ${v.t}`, () => {
      const msg = decodeClientMsg(fromHex(v.hex));
      expect(msg.t).toBe(v.t);
      expect(toHex(encodeClientMsg(msg))).toBe(v.hex);
    });
  }
  for (const v of vectors.server) {
    it(`server ${v.t}`, () => {
      const msg = decodeServerMsg(fromHex(v.hex));
      expect(msg.t).toBe(v.t);
      expect(toHex(encodeServerMsg(msg))).toBe(v.hex);
    });
  }

  it("decodes field values", () => {
    const enter = decodeServerMsg(fromHex(vectors.server[1].hex));
    if (enter.t !== "CellEnter") throw new Error("expected CellEnter");
    const e = enter.entities[0];
    expect(e).toMatchObject({ id: 42, name: "Ćiril ☘", look: 0x80000001, x: 95, speedX10: 40, t0: 4_000_000_000 });
    expect(e.path).toEqual([
      { x: 95, y: 0 },
      { x: 90, y: 5 },
    ]);
    const chat = decodeClientMsg(fromHex(vectors.client[3].hex));
    expect(chat).toEqual({ t: "ChatSay", text: "hello 👋" });
  });

  it("frames and rejects garbage", () => {
    const a = encodeClientMsg({ t: "Emote", emote: 3 });
    const b = encodeClientMsg({ t: "MoveTo", x: 1, y: 2, sprint: false });
    expect(splitFrame(encodeFrame([a, b])).map(toHex)).toEqual([toHex(a), toHex(b)]);
    expect(() => splitFrame(new Uint8Array([5, 0, 1]))).toThrow();
    expect(() => decodeServerMsg(new Uint8Array([200]))).toThrow();
    expect(() => decodeClientMsg(new Uint8Array([3, 1, 0]))).toThrow(/trailing/);
  });
});
