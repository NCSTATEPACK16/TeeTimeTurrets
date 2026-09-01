import { neutralIntent } from "./InputSource";
import type { InputSource, PlayerIntent } from "./InputSource";

/**
 * Replays a fixed array of intents. This is the implementation that lets the Phase 2 gate run
 * headlessly: if the whole gate can be driven from a script, the InputSource interface is
 * genuinely input-shaped rather than keyboard-shaped, which is the thing the gate is really
 * checking. It is also the shape a Phase 5 server would replay a client's inputs through.
 */

export interface ScriptedStep {
  /** How many fixed ticks this step's intent is held for. */
  ticks: number;
  /**
   * The intent for those ticks. Anything omitted is neutral, not inherited from the previous
   * step -- a script that brakes once must not brake forever.
   */
  intent: Partial<PlayerIntent>;
}

export class ScriptedInputSource implements InputSource {
  private readonly script: readonly ScriptedStep[];
  private readonly current: PlayerIntent = neutralIntent();
  private stepIndex = 0;
  private tickInStep = 0;

  constructor(script: readonly ScriptedStep[]) {
    this.script = script;
  }

  get finished(): boolean {
    return this.stepIndex >= this.script.length;
  }

  sample(): PlayerIntent {
    reset(this.current);
    const step = this.script[this.stepIndex];
    if (step === undefined) return this.current;

    Object.assign(this.current, step.intent);

    // selectClub and toggleMode are presses, not held states. A step declaring `ticks: 10`
    // means "hold this for 10 ticks", and holding a press would re-fire it every tick -- which
    // in the cart resets the swing charge on all ten.
    if (this.tickInStep > 0) {
      this.current.selectClub = null;
      this.current.toggleMode = false;
    }
    return this.current;
  }

  endTick(): void {
    const step = this.script[this.stepIndex];
    if (step === undefined) return;
    this.tickInStep += 1;
    if (this.tickInStep >= step.ticks) {
      this.stepIndex += 1;
      this.tickInStep = 0;
    }
  }

  dispose(): void {
    /* nothing to release */
  }
}

function reset(intent: PlayerIntent): void {
  intent.throttle = 0;
  intent.steer = 0;
  intent.brake = false;
  intent.aimDelta = 0;
  intent.fire = false;
  intent.selectClub = null;
  intent.toggleMode = false;
}
