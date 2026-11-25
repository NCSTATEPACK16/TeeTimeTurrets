import { RIDES, type Ride, type RideId } from "./titleConfig";

export type TitleView = "title" | "ride";

/**
 * Title -> Choose Your Ride -> go, with no DOM, so it runs in the Node test environment. The
 * TitleScreen renders whatever this says and forwards clicks and keys to it; `start` hands back
 * the chosen ride and the screen decides what that means (the arena, or free drive).
 */
export class TitleFlow {
  view: TitleView = "title";
  ride: RideId;
  private readonly listeners: (() => void)[] = [];

  constructor(ride: RideId = "turrets") {
    this.ride = ride;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** The title's TEE OFF: on to ride select. */
  teeOff(): void {
    if (this.view !== "title") return;
    this.view = "ride";
    this.changed();
  }

  pick(ride: RideId): void {
    if (this.ride === ride || !RIDES.some((r) => r.id === ride)) return;
    this.ride = ride;
    this.changed();
  }

  /** Step through the rides (arrow keys), wrapping. */
  nudge(dir: -1 | 1): void {
    const i = RIDES.findIndex((r) => r.id === this.ride);
    this.pick(RIDES[(i + dir + RIDES.length) % RIDES.length]!.id);
  }

  /** Esc: back to the title from ride select. False when there is nowhere further back. */
  back(): boolean {
    if (this.view !== "ride") return false;
    this.view = "title";
    this.changed();
    return true;
  }

  /** Ride select's TEE OFF: the ride to start, or null when not on ride select. */
  start(): Ride | null {
    if (this.view !== "ride") return null;
    return RIDES.find((r) => r.id === this.ride)!;
  }
}
