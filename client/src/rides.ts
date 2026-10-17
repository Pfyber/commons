// Riding (server: crates/api/src/vehicles.rs): what you're on, and getting
// on or off. A vehicle you own goes faster anywhere outdoors in the city;
// anything in the Vehicles shop can be test-ridden on its track.

import type { Economy, Item } from "./economy";
import type { Auth } from "./net/api";
import { TEST_RIDE } from "./world/vehicles";

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

  /** Vehicles you own. */
  owned(): Item[] {
    return this.eco.ofKind("vehicle").filter((v) => this.eco.qty(v.id) > 0);
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
