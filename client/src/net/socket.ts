// Zone server connection: binary frames in both directions, plus clock sync
// so path motion can be evaluated against the instance clock.

import {
  type ClientMsg,
  type ServerMsg,
  PROTOCOL_VERSION,
  decodeServerMsg,
  encodeClientMsg,
  encodeFrame,
  splitFrame,
} from "./protocol.gen";

const PING_EVERY_MS = 5000;
const CLOCK_SAMPLES = 8;

/**
 * Estimates the instance clock. Keeps the offset from the lowest-RTT recent
 * ping, which has the least queueing error.
 */
export class ServerClock {
  private offset = 0;
  private samples: { rtt: number; offset: number }[] = [];

  seed(serverT: number) {
    if (this.samples.length === 0) this.offset = serverT - performance.now();
  }

  sample(clientT: number, serverT: number) {
    const now = performance.now();
    const rtt = Math.max(0, (now >>> 0) - clientT);
    this.samples.push({ rtt, offset: serverT + rtt / 2 - now });
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift();
    this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
  }

  get rtt(): number {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) : 0;
  }

  now(): number {
    return performance.now() + this.offset;
  }
}

export type CloseReason = { code: number; message: string } | null;

export class ZoneSocket {
  readonly clock = new ServerClock();
  private ws: WebSocket;
  private pingTimer = 0;
  private lastError: CloseReason = null;

  constructor(
    url: string,
    joinToken: string,
    view: { w: number; h: number },
    private onMessage: (m: ServerMsg) => void,
    private onClose: (reason: CloseReason) => void,
  ) {
    // A path ("/ws") means the game server sits behind this page's own host.
    if (url.startsWith("/")) url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this.send({
        t: "Hello",
        joinToken,
        version: PROTOCOL_VERSION,
        viewW: Math.min(255, view.w),
        viewH: Math.min(255, view.h),
      });
      this.ping();
      this.pingTimer = window.setInterval(() => this.ping(), PING_EVERY_MS);
    };
    this.ws.onmessage = (ev) => this.receive(new Uint8Array(ev.data as ArrayBuffer));
    this.ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.onClose(this.lastError);
    };
  }

  private receive(frame: Uint8Array) {
    for (const raw of splitFrame(frame)) {
      let msg: ServerMsg;
      try {
        msg = decodeServerMsg(raw);
      } catch (e) {
        console.error("bad server message", e);
        continue;
      }
      if (msg.t === "Welcome") this.clock.seed(msg.serverT);
      else if (msg.t === "Pong") {
        this.clock.sample(msg.clientT, msg.serverT);
        continue;
      } else if (msg.t === "Error") this.lastError = { code: msg.code, message: msg.message };
      this.onMessage(msg);
    }
  }

  private ping() {
    this.send({ t: "Ping", clientT: performance.now() >>> 0 });
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeFrame([encodeClientMsg(msg)]));
  }

  close() {
    this.onClose = () => {};
    window.clearInterval(this.pingTimer);
    this.ws.close();
  }
}
