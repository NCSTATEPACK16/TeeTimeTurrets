import type { CartTuning } from './cartTuning';

type RolloverTuning = CartTuning['rollover'];

/**
 * Decides when the righting assist pushes. It engages once the measured angle has stayed
 * above `aboveDeg` for `delay` seconds and holds until the angle drops below `releaseDeg`.
 * Pure state machine; RapierCart applies the torque.
 */
export class RolloverAssist {
  private over = 0;
  private active = false;

  update(angleDeg: number, dt: number, cfg: RolloverTuning): boolean {
    const a = Math.abs(angleDeg);
    if (this.active) {
      if (a < cfg.releaseDeg) {
        this.active = false;
        this.over = 0;
      }
      return this.active;
    }
    this.over = a > cfg.aboveDeg ? this.over + dt : 0;
    // Small epsilon so a delay of exactly n steps fires on step n despite float accumulation.
    if (a > cfg.aboveDeg && this.over >= cfg.delay - 1e-9) this.active = true;
    return this.active;
  }

  get engaged(): boolean {
    return this.active;
  }

  reset(): void {
    this.over = 0;
    this.active = false;
  }
}
