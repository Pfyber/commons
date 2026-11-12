// Riding (server: crates/api/src/vehicles.rs): what you're on, and getting
// on or off. A vehicle you own goes faster anywhere outdoors in the city;
// anything in the Vehicles shop can be test-ridden on its track.

import type { Economy, Item } from "./economy";
import type { Auth } from "./net/api";
import { TEST_RIDE } from "./world/vehicles";

/** The skateboard's code (`commons_sim::vehicles::SKATEBOARD`): everyone has one. */
export const SKATEBOARD = 5;

/** The ride you've picked (its item id), kept on this device: what the ride button gets you on. */
const PICK_KEY = "commons.ride.pick";

export class Rides {
  /** The saved ride: a vehicle's code (with `TEST_RIDE` on a test ride), 0 on foot. */
  ride = 0;

  constructor(
    private auth: Auth,
    private eco: Economy,
  ) {}

  get testRide(): boolean {
    return (this.ride & TEST_RIDE) !== 0;
  }

  /** On something of your own. */
  get riding(): boolean {
    return this.ride !== 0 && !this.testRide;
  }

  /** Vehicles you can ride: everyone's skateboard (free), then any you've bought. */
  owned(): Item[] {
    return this.eco.ofKind("vehicle").filter((v) => v.meta.code === SKATEBOARD || this.eco.qty(v.id) > 0);
  }

  /**
   * The ride the ride button gets you on: the one you're on; else the one
   * you last picked (still yours); else the newest you have.
   */
  picked(): Item | undefined {
    const owned = this.owned();
    const on = this.riding ? this.item(this.ride) : undefined;
    if (on && owned.includes(on)) return on;
    let id = 0;
    try {
      id = Number(localStorage.getItem(PICK_KEY)) || 0;
    } catch {
      // (No storage: the newest, then.)
    }
    return owned.find((v) => v.id === id) ?? owned[owned.length - 1];
  }

  /** Picks `it` as your ride (the ride button's from now on). */
  pick(it: Item) {
    try {
      localStorage.setItem(PICK_KEY, String(it.id));
    } catch {
      // (Not kept: it's still picked while you're on it.)
    }
  }

  /** The item for a ride code. */
  item(code: number): Item | undefined {
    return this.eco.ofKind("vehicle").find((v) => v.meta.code === (code & ~TEST_RIDE));
  }

  async load() {
    this.ride = (await this.auth.get<{ ride: number }>("/api/me/ride")).ride;
  }

  /** Gets on `item` (a test ride, if `test`), or off with 0. */
  async set(item: number, test = false) {
    this.ride = (await this.auth.send<{ ride: number }>("/api/me/ride", { item, test })).ride;
  }
}
