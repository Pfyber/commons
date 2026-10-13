// Chess at the park tables (spec §7). The server is authoritative and sends
// the legal moves, so the client only renders the position and offers them.

import type { ServerMsg } from "../net/protocol.gen";
import { iconUrl } from "../ui/icons";

export type GameStateMsg = Extract<ServerMsg, { t: "GameState" }>;

const GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const STATUS = { WAITING: 0, PLAYING: 1, WHITE_WON: 2, BLACK_WON: 3, DRAW: 4 };
/** The Park Elder, the computer opponent (server: protocol ELDER_ID). */
export const ELDER_ID = 0xfffffffe;

/** 8×8 array of piece letters ("" for empty), rank 8 first. */
export function parseFen(fen: string): string[][] {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const out: string[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push("");
      else out.push(ch);
    }
    return out;
  });
}

const squareName = (file: number, rank: number) => "abcdefgh"[file] + (rank + 1);

export interface ChessHandlers {
  move(table: number, uci: string): void;
  close(): void;
  nameOf(entityId: number): string;
}

export class ChessPanel {
  readonly el: HTMLDivElement;
  private boardEl: HTMLDivElement;
  private infoEl: HTMLDivElement;
  private actionsEl: HTMLDivElement;
  private selected: string | null = null;
  private state: GameStateMsg | null = null;
  table = 0;

  constructor(
    root: HTMLElement,
    private selfId: () => number,
    private h: ChessHandlers,
  ) {
    this.el = document.createElement("div");
    this.el.className = "panel chess";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="panel-head"><strong>Chess</strong><button type="button" class="x" aria-label="Close"><img class="px-icon" alt="" width="24" height="24" src="${iconUrl("close")}" /></button></div>
      <div class="chess-info"></div>
      <div class="chess-board" role="grid" aria-label="Chess board"></div>
      <div class="chess-actions"></div>`;
    this.boardEl = this.el.querySelector(".chess-board")!;
    this.infoEl = this.el.querySelector(".chess-info")!;
    this.actionsEl = this.el.querySelector(".chess-actions")!;
    this.el.querySelector<HTMLButtonElement>(".x")!.onclick = () => h.close();
    root.appendChild(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  show(table: number, state: GameStateMsg | undefined) {
    if (this.table !== table) this.selected = null;
    this.table = table;
    this.el.hidden = false;
    if (state) this.update(state);
  }

  hide() {
    this.el.hidden = true;
    this.selected = null;
  }

  /** My side at this table, if I'm one of the players. */
  private mySide(): "white" | "black" | null {
    const s = this.state;
    if (!s) return null;
    if (s.white === this.selfId()) return "white";
    if (s.black === this.selfId()) return "black";
    return null;
  }

  private myTurn(): boolean {
    const s = this.state;
    if (!s || s.status !== STATUS.PLAYING) return false;
    const toMove = s.fen.split(" ")[1] === "w" ? "white" : "black";
    return this.mySide() === toMove;
  }

  update(state: GameStateMsg) {
    if (state.table !== this.table) return;
    if (this.state?.fen !== state.fen) this.selected = null;
    this.state = state;
    this.render();
  }

  private render() {
    const s = this.state!;
    const side = this.mySide();
    const name = (id: number) => (id === ELDER_ID ? "Park Elder 🧓" : id ? this.h.nameOf(id) : "empty seat");
    const toMove = s.fen.split(" ")[1] === "w" ? "White" : "Black";
    const status =
      s.status === STATUS.WAITING
        ? side
          ? "Waiting for someone to sit opposite, or play the Park Elder."
          : "Waiting for two players: sit on the benches either side of the table."
        : s.status === STATUS.PLAYING
          ? this.myTurn()
            ? "Your move."
            : `${toMove} to move.`
          : s.status === STATUS.DRAW
            ? "Draw."
            : `${s.status === STATUS.WHITE_WON ? "White" : "Black"} wins.`;
    this.infoEl.innerHTML = "";
    const players = document.createElement("div");
    players.className = "players";
    players.append(`♔ ${name(s.white)}  ·  ♚ ${name(s.black)}`);
    const st = document.createElement("div");
    st.className = "status";
    st.textContent = status + (s.last ? `  Last: ${s.last}` : "");
    this.infoEl.append(players, st);

    // Board, flipped for the black player.
    const grid = parseFen(s.fen);
    const flip = side === "black";
    const legalFrom = new Set(s.legal.map((m) => m.slice(0, 2)));
    const targets = new Set(this.selected ? s.legal.filter((m) => m.startsWith(this.selected!)).map((m) => m.slice(2, 4)) : []);
    const lastSquares = s.last ? [s.last.slice(0, 2), s.last.slice(2, 4)] : [];
    this.boardEl.innerHTML = "";
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rank = flip ? r : 7 - r;
        const file = flip ? 7 - f : f;
        const sq = squareName(file, rank);
        const piece = grid[7 - rank][file];
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = `sq ${(file + rank) % 2 ? "light" : "dark"}`;
        if (lastSquares.includes(sq)) cell.classList.add("last");
        if (sq === this.selected) cell.classList.add("sel");
        if (targets.has(sq)) cell.classList.add("target");
        cell.textContent = piece ? GLYPH[piece] : "";
        cell.setAttribute("aria-label", `${sq}${piece ? " " + piece : ""}`);
        const mine = this.myTurn() && legalFrom.has(sq);
        if (mine) cell.classList.add("movable");
        cell.onclick = () => this.clickSquare(sq);
        this.boardEl.appendChild(cell);
      }
    }

    this.actionsEl.innerHTML = "";
    if (side && s.status === STATUS.PLAYING) this.actionsEl.append(this.button("Resign", () => this.h.move(this.table, "resign")));
    if (side && s.status >= STATUS.WHITE_WON) this.actionsEl.append(this.button("Rematch", () => this.h.move(this.table, "new")));
    // Sitting alone: the Park Elder will take the other side.
    if (side && s.status === STATUS.WAITING && (!s.white || !s.black)) {
      this.actionsEl.append(this.button("Play the Park Elder 🧓", () => this.h.move(this.table, "elder")));
    }
  }

  private button(label: string, run: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = run;
    return b;
  }

  private clickSquare(sq: string) {
    const s = this.state;
    if (!s || !this.myTurn()) return;
    if (this.selected) {
      const moves = s.legal.filter((m) => m.startsWith(this.selected!) && m.slice(2, 4) === sq);
      if (moves.length) {
        // Promotions: always a queen (the most common choice).
        const mv = moves.find((m) => m.length === 4 || m.endsWith("q"))!;
        this.h.move(this.table, mv);
        this.selected = null;
        return;
      }
    }
    this.selected = s.legal.some((m) => m.startsWith(sq)) ? sq : null;
    this.render();
  }
}
