import { ClubType } from "../physics/Ballistics";
import { neutralIntent } from "../sim/intent";
import type { PlayerIntent } from "../sim/intent";
import type { InputSource } from "./InputSource";
import { PAD_AXES, PAD_BUTTONS, intentFromPad, padActive, padMenuEdges } from "./gamepadMapping";
import type { PadFrame, PadMenuEdges } from "./gamepadMapping";

/**
 * The browser half of gamepad input (Stage 4b): reads `navigator.getGamepads()` once a tick into
 * fixed arrays, and hands them to `gamepadMapping.ts`, which decides everything. Only the first
 * connected pad is read, and a pad with the `standard` mapping is preferred over one without.
 *
 * `poll()` is the one read per tick. `sample()` and `menuEdges()` both read what it stored, so a
 * press is seen by both and counted once; `poll()` then moves this tick's buttons into `prev`.
 *
 * `getGamepads()` returns a fresh array per call in every browser, which is the one allocation
 * here and the browser's, not this file's.
 */
export class GamepadSource implements InputSource {
  private readonly buttons = new Uint8Array(PAD_BUTTONS);
  private readonly prev = new Uint8Array(PAD_BUTTONS);
  private readonly axes = new Float64Array(PAD_AXES);
  private readonly frame: PadFrame = { buttons: this.buttons, prev: this.prev, axes: this.axes };
  private readonly intent: PlayerIntent = neutralIntent();
  private readonly edges: PadMenuEdges = { pause: false, map: false, horn: false };
  /** True while a pad is connected. */
  connected = false;
  /** The connected pad's `id`, for the settings and the connect screen. */
  id = "";

  /** The club equipped now, which L1/R1 step from. The screen sets it before each `sample()`. */
  club: ClubType | null = null;

  /** Reads the pad. Call once per tick, before `sample()` and `menuEdges()`. */
  poll(): void {
    this.prev.set(this.buttons);
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (pad === null || (p.mapping === "standard" && pad.mapping !== "standard")) pad = p;
    }
    this.connected = pad !== null;
    if (pad === null) {
      this.buttons.fill(0);
      this.axes.fill(0);
      this.id = "";
      return;
    }
    this.id = pad.id;
    for (let i = 0; i < PAD_BUTTONS; i++) {
      const b = pad.buttons[i];
      this.buttons[i] = b !== undefined && (b.pressed || b.value > 0.5) ? 1 : 0;
    }
    for (let i = 0; i < PAD_AXES; i++) this.axes[i] = pad.axes[i] ?? 0;
  }

  /** True when the pad was pressed or a stick moved this tick: the pad is the input in use. */
  get active(): boolean {
    return this.connected && padActive(this.frame);
  }

  sample(): PlayerIntent {
    return intentFromPad(this.frame, this.club ?? ClubType.Putter, this.intent);
  }

  /** Start, Select and the horn this tick, for the match screen. */
  menuEdges(): PadMenuEdges {
    return padMenuEdges(this.frame, this.edges);
  }

  /** The pad's raw frame, for menu navigation. Read-only. */
  get state(): PadFrame {
    return this.frame;
  }

  endTick(): void {
    // Edges live in `prev`, which `poll()` advances; nothing accumulates between ticks.
  }

  dispose(): void {
    this.buttons.fill(0);
    this.prev.fill(0);
    this.axes.fill(0);
  }
}
