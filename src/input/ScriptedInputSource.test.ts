import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "./ScriptedInputSource";

/**
 * The second InputSource implementation the Phase 2 gate requires: if the whole gate can be
 * driven by replaying an array of intents, the interface is genuinely input-shaped. If it
 * can't, the interface is still keyboard-shaped and Phase 4's touch layer pays for it.
 */

function drain(source: ScriptedInputSource, ticks: number): ReturnType<ScriptedInputSource["sample"]>[] {
  const seen = [];
  for (let i = 0; i < ticks; i++) {
    const intent = source.sample();
    seen.push({ ...intent });
    source.endTick();
  }
  return seen;
}

describe("ScriptedInputSource", () => {
  it("holds a step's intent for the number of ticks it declares", () => {
    const source = new ScriptedInputSource([{ ticks: 3, intent: { throttle: 1 } }]);
    const seen = drain(source, 3);
    expect(seen.map((i) => i.throttle)).toEqual([1, 1, 1]);
  });

  it("advances to the next step when the current one runs out", () => {
    const source = new ScriptedInputSource([
      { ticks: 2, intent: { throttle: 1 } },
      { ticks: 2, intent: { throttle: -1 } },
    ]);
    expect(drain(source, 4).map((i) => i.throttle)).toEqual([1, 1, -1, -1]);
  });

  it("fills unspecified fields with the neutral intent rather than leaking the previous step", () => {
    // Otherwise a script that brakes once brakes forever, and the gate silently tests the
    // wrong thing while still passing.
    const source = new ScriptedInputSource([
      { ticks: 1, intent: { brake: true, throttle: 1 } },
      { ticks: 1, intent: { throttle: 1 } },
    ]);
    const seen = drain(source, 2);
    expect(seen[0]!.brake).toBe(true);
    expect(seen[1]!.brake).toBe(false);
    expect(seen[1]!.throttle).toBe(1);
  });

  it("emits edge-triggered fields only on the first tick of a step", () => {
    // selectClub is a press. A step that holds one for 10 ticks must not re-select the club 10
    // times -- in the cart that would reset the swing charge every tick.
    const source = new ScriptedInputSource([{ ticks: 3, intent: { selectClub: ClubType.Iron } }]);
    const seen = drain(source, 3);
    expect(seen.map((i) => i.selectClub)).toEqual([ClubType.Iron, null, null]);
  });

  it("goes neutral and reports finished once the script is exhausted", () => {
    const source = new ScriptedInputSource([{ ticks: 1, intent: { throttle: 1, fire: true } }]);
    expect(source.finished).toBe(false);
    drain(source, 1);
    expect(source.finished).toBe(true);

    const after = source.sample();
    expect(after.throttle).toBe(0);
    expect(after.fire).toBe(false);
  });

  it("keeps sampling safely past the end instead of throwing", () => {
    const source = new ScriptedInputSource([{ ticks: 1, intent: { throttle: 1 } }]);
    expect(() => drain(source, 50)).not.toThrow();
  });

  it("treats an empty script as immediately finished", () => {
    const source = new ScriptedInputSource([]);
    expect(source.finished).toBe(true);
    expect(source.sample().throttle).toBe(0);
  });
});
