/**
 * When each enemy's nameplate walks its line of sight. At render rate, with eight carts, the walk
 * was up to 3,500 height samples a frame; sight changes on the scale of a cart driving behind a
 * hill, not of a frame. Each cart is re-checked once a period, and the carts are spread across the
 * period so the work lands a little every frame instead of all at once.
 */
export class LosSchedule {
  /** Wall-clock ms each cart is next due at. */
  private readonly nextAt: number[];

  constructor(count: number, private readonly periodMs: number) {
    this.nextAt = [];
    for (let i = 0; i < count; i++) this.nextAt.push((i * periodMs) / Math.max(1, count));
  }

  due(index: number, nowMs: number): boolean {
    return nowMs >= (this.nextAt[index] ?? 0);
  }

  done(index: number, nowMs: number): void {
    this.nextAt[index] = nowMs + this.periodMs;
  }

  /** The cached answer no longer applies -- the plate came back on screen, say. Due now. */
  invalidate(index: number): void {
    this.nextAt[index] = Number.NEGATIVE_INFINITY;
  }
}
