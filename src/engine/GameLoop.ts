/**
 * Fixed-step accumulator loop decoupled from the render rate -- the single most important
 * pattern this project borrows conceptually (not literally; see AGENTS.md license note) from
 * Claude-of-Tanks: simulate at a fixed cadence, render at whatever rate the display wants,
 * interpolate between the last two sim states for a stutter-free picture at any refresh rate.
 * See docs/ARCHITECTURE.md section 2a for the formulas this implements.
 *
 * Deliberately generic: no THREE, no Rapier, no knowledge of golf. `step` should mutate
 * whatever authoritative sim state your game has; `render` should read it back interpolated.
 */
export interface GameLoopOptions {
  /** Seconds per fixed sim tick, e.g. 1 / 60. */
  fixedDt: number;
  /** Advance the simulation by exactly one fixed tick. Called zero or more times per frame. */
  step: () => void;
  /** Called once per animation frame. alpha in [0, 1): 0 = previous sim state, ~1 = current. */
  render: (alpha: number) => void;
  /** Upper bound on a single frame's delta, seconds. Guards against a spiral of death after a stall/tab-switch. */
  maxFrameDt?: number;
}

export class GameLoop {
  private readonly fixedDt: number;
  private readonly maxFrameDt: number;
  private readonly stepFn: () => void;
  private readonly renderFn: (alpha: number) => void;

  private accumulator = 0;
  private lastTimeMs = 0;
  private rafHandle = 0;
  private running = false;

  constructor(options: GameLoopOptions) {
    this.fixedDt = options.fixedDt;
    this.maxFrameDt = options.maxFrameDt ?? 0.25;
    this.stepFn = options.step;
    this.renderFn = options.render;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = performance.now();
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  private frame = (nowMs: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.frame);

    const deltaSeconds = Math.min((nowMs - this.lastTimeMs) / 1000, this.maxFrameDt);
    this.lastTimeMs = nowMs;
    this.accumulator += deltaSeconds;

    while (this.accumulator >= this.fixedDt) {
      this.stepFn();
      this.accumulator -= this.fixedDt;
    }

    this.renderFn(this.accumulator / this.fixedDt);
  };
}
