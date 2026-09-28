import { describe, expect, it } from "vitest";
import { PauseState } from "./pauseState";

describe("PauseState", () => {
  it("runs a match that has been seen before straight away", () => {
    const p = new PauseState({ showControls: false });
    expect(p.paused).toBe(false);
    expect(p.panel).toBe("none");
  });

  it("opens a first match on the controls card, frozen until it is dismissed", () => {
    const p = new PauseState({ showControls: true });
    expect(p.paused).toBe(true);
    expect(p.panel).toBe("controls");
    p.dismissControls();
    expect(p.paused).toBe(false);
    expect(p.panel).toBe("none");
  });

  it("pauses on Esc and resumes on Esc", () => {
    const p = new PauseState({ showControls: false });
    p.escape(false);
    expect(p.paused).toBe(true);
    expect(p.panel).toBe("pause");
    p.escape(false);
    expect(p.paused).toBe(false);
  });

  it("pauses when the pointer lock is lost mid-match, because that is how Esc arrives while locked", () => {
    const p = new PauseState({ showControls: false });
    p.pointerLockLost(false);
    expect(p.panel).toBe("pause");
  });

  it("does not pause a match that is over", () => {
    const p = new PauseState({ showControls: false });
    p.pointerLockLost(true);
    p.escape(true);
    expect(p.paused).toBe(false);
  });

  it("does not let Esc skip the controls card into the pause menu", () => {
    const p = new PauseState({ showControls: true });
    p.escape(false);
    expect(p.panel).toBe("controls");
  });

  it("resumes from the pause menu's button", () => {
    const p = new PauseState({ showControls: false });
    p.escape(false);
    p.resume();
    expect(p.paused).toBe(false);
  });
});
