/**
 * Fixed-step accumulator: the render loop runs at display rate, physics at exactly 60 Hz.
 * When a frame takes too long, extra time is dropped instead of spiraling.
 */
export class FixedStepper {
  private acc = 0;

  constructor(
    readonly dt: number,
    readonly maxSubsteps: number,
  ) {}

  /** Adds a frame's elapsed seconds and returns how many fixed steps to run now. */
  advance(frameSeconds: number): number {
    this.acc += Math.max(0, frameSeconds);
    // Tiny epsilon so 1/60 s frames do not alternate 0 and 2 steps from rounding.
    let steps = Math.floor(this.acc / this.dt + 1e-9);
    if (steps > this.maxSubsteps) {
      steps = this.maxSubsteps;
      this.acc = 0;
    } else {
      this.acc = Math.max(0, this.acc - steps * this.dt);
    }
    return steps;
  }

  /** How far the render time is between the last two physics states, 0..1. */
  get alpha(): number {
    return Math.min(this.acc / this.dt, 1);
  }

  reset(): void {
    this.acc = 0;
  }
}
