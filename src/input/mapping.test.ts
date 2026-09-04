import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { intentFromKeys } from "./mapping";

/**
 * The mapping is a pure function of (held keys, keys pressed this tick, aim delta) so it can be
 * tested with no DOM at all -- the browser shell around it only has to collect those three
 * things. Held vs. pressed is the important split: driving is a held state, while club select is
 * edge-triggered and would repeat every tick if read from the held set.
 */

const NONE: ReadonlySet<string> = new Set();

function held(...codes: string[]): ReadonlySet<string> {
  return new Set(codes);
}

describe("intentFromKeys driving axes", () => {
  it("reads W as full forward throttle", () => {
    expect(intentFromKeys(held("KeyW"), NONE, 0).throttle).toBe(1);
  });

  it("reads S as full reverse throttle", () => {
    expect(intentFromKeys(held("KeyS"), NONE, 0).throttle).toBe(-1);
  });

  it("cancels to zero when forward and reverse are held together", () => {
    // A naive `if (W) 1; if (S) -1;` chain silently makes the last-checked key win, which reads
    // in play as the cart lurching when both are held during a panic stop.
    expect(intentFromKeys(held("KeyW", "KeyS"), NONE, 0).throttle).toBe(0);
  });

  it("cancels to zero when both steer keys are held together", () => {
    expect(intentFromKeys(held("KeyA", "KeyD"), NONE, 0).steer).toBe(0);
  });

  it("steers left with A and right with D", () => {
    expect(intentFromKeys(held("KeyA"), NONE, 0).steer).toBe(-1);
    expect(intentFromKeys(held("KeyD"), NONE, 0).steer).toBe(1);
  });

  it("accepts the arrow keys as aliases for WASD", () => {
    expect(intentFromKeys(held("ArrowUp"), NONE, 0).throttle).toBe(1);
    expect(intentFromKeys(held("ArrowDown"), NONE, 0).throttle).toBe(-1);
    expect(intentFromKeys(held("ArrowLeft"), NONE, 0).steer).toBe(-1);
    expect(intentFromKeys(held("ArrowRight"), NONE, 0).steer).toBe(1);
  });

  it("produces a neutral intent when nothing is held", () => {
    const intent = intentFromKeys(NONE, NONE, 0);
    expect(intent.throttle).toBe(0);
    expect(intent.steer).toBe(0);
    expect(intent.brake).toBe(false);
    expect(intent.fire).toBe(false);
    expect(intent.aimDelta).toBe(0);
    expect(intent.selectClub).toBeNull();
  });
});

describe("intentFromKeys held actions", () => {
  it("treats space as the held fire button, not a press", () => {
    // Charge accumulates while held, so this has to come from the held set. Reading it from
    // the pressed set would cap every shot at one tick of charge.
    expect(intentFromKeys(held("Space"), NONE, 0).fire).toBe(true);
    expect(intentFromKeys(NONE, held("Space"), 0).fire).toBe(false);
  });

  it("brakes while shift is held", () => {
    expect(intentFromKeys(held("ShiftLeft"), NONE, 0).brake).toBe(true);
  });

  it("also fires on F, so a hand already on WASD can shoot while driving", () => {
    expect(intentFromKeys(held("KeyF"), NONE, 0).fire).toBe(true);
  });
});

describe("intentFromKeys edge-triggered actions", () => {
  it("selects a club only on the tick the number key goes down", () => {
    expect(intentFromKeys(NONE, held("Digit3"), 0).selectClub).toBe(ClubType.Driver);
    expect(intentFromKeys(held("Digit3"), NONE, 0).selectClub).toBeNull();
  });

  it("maps the number row to putter, iron, driver in ascending power", () => {
    expect(intentFromKeys(NONE, held("Digit1"), 0).selectClub).toBe(ClubType.Putter);
    expect(intentFromKeys(NONE, held("Digit2"), 0).selectClub).toBe(ClubType.Iron);
    expect(intentFromKeys(NONE, held("Digit3"), 0).selectClub).toBe(ClubType.Driver);
  });

  it("has no mode-toggle binding: C is unbound now that the cart is the only mode", () => {
    const intent = intentFromKeys(held("KeyC"), held("KeyC"), 0);
    expect(intent.throttle).toBe(0);
    expect(intent.steer).toBe(0);
    expect(intent.fire).toBe(false);
    expect(intent.selectClub).toBeNull();
  });
});

describe("intentFromKeys turret aim", () => {
  it("passes a pointer aim delta straight through", () => {
    expect(intentFromKeys(NONE, NONE, 0.031).aimDelta).toBeCloseTo(0.031, 9);
  });

  it("adds keyboard turret keys to the pointer delta so both work at once", () => {
    const withPointer = intentFromKeys(held("KeyE"), NONE, 0.01).aimDelta;
    const keyOnly = intentFromKeys(held("KeyE"), NONE, 0).aimDelta;
    expect(keyOnly).toBeGreaterThan(0);
    expect(withPointer).toBeCloseTo(keyOnly + 0.01, 9);
  });

  it("turns the turret the opposite way with Q and E", () => {
    expect(intentFromKeys(held("KeyQ"), NONE, 0).aimDelta).toBeLessThan(0);
    expect(intentFromKeys(held("KeyE"), NONE, 0).aimDelta).toBeGreaterThan(0);
  });

  it("cancels keyboard turret input when both keys are held", () => {
    expect(intentFromKeys(held("KeyQ", "KeyE"), NONE, 0).aimDelta).toBe(0);
  });
});
