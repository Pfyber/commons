// The Post Office in the Market: where your home is, or finding one.

import type { Homes } from "../homes";
import { Panel, button, el } from "./panels";

export interface PostOfficeHost {
  /** Walks to a named spot on the city map ("door:b0_3:5"). */
  walkToSpot(spot: string): void;
  /** Walks to the nearest free house; false if none is free. */
  findHome(): boolean;
  goInside(): void;
}

export class PostOfficePanel extends Panel {
  constructor(
    private homes: Homes,
    private host: PostOfficeHost,
  ) {
    super("Post Office", "post-office");
    homes.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    void this.homes.load().catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const mine = this.homes.mine;
    if (mine) {
      this.body.append(el("p", "", "You have a home in the city. Your door is marked with a little house on your map."));
      this.body.append(
        button("Walk home", () => (this.hide(), this.host.walkToSpot(`door:${mine}`)), "primary"),
        button("Go straight inside", () => (this.hide(), this.host.goInside())),
      );
    } else {
      const free = this.homes.free;
      this.body.append(
        el("p", "", "Every home in Commons is a house in one of the home blocks around the edge of the city, with a garden and a postbox."),
        el("p", "hint", free > 0 ? `${free} of ${this.homes.total} houses are free. Homes are free while the town is young.` : "Every house is lived in right now."),
      );
      if (free > 0) {
        this.body.append(
          button("Show me a free house", () => {
            this.hide();
            this.host.findHome();
          }, "primary"),
        );
        this.body.append(el("p", "hint", "Tap a free house's door to move in."));
      }
    }
  }
}
