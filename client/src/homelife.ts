// A home's look and the laptop's drone (server: crates/api/src/homelife.rs).

import type { Applied, Economy } from "./economy";
import type { Auth } from "./net/api";

export interface Look {
  wall: number;
  wall_color: number;
  floor: number;
  floor_color: number;
}

export interface Parcel {
  id: string;
  item: number;
  qty: number;
  ordered: number;
  ready: number;
}

export class HomeLife {
  /** Told when an order's been placed (the drone sets off). */
  onOrder: () => void = () => {};

  constructor(
    private auth: Auth,
    private eco: Economy,
  ) {}

  look(owner: string): Promise<Look> {
    return this.auth.get<Look>(`/api/home/look/${owner}`);
  }

  setLook(l: Look): Promise<Look> {
    return this.auth.send<Look>("/api/home/look", l);
  }

  catalog(): Promise<{ fee: number; items: { item: number; price: number }[] }> {
    return this.auth.get("/api/drone/catalog");
  }

  async order(item: number, qty: number) {
    this.eco.applyResult(await this.auth.send<Applied>("/api/drone/order", { item, qty, key: crypto.randomUUID() }));
    this.onOrder();
  }

  /** Parcels on their way or on the step, and the server's clock (unix seconds). */
  parcels(): Promise<{ parcels: Parcel[]; now: number }> {
    return this.auth.get("/api/drone/parcels");
  }

  async claim(id: string) {
    this.eco.applyResult(await this.auth.send<Applied>("/api/drone/claim", { id }));
  }
}
