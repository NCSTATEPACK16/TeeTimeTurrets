import { describe, expect, it, vi } from "vitest";
import { ScreenManager } from "./ScreenManager";
import type { Screen } from "./ScreenManager";

/**
 * ROADMAP.md Phase 1.75 states the reason this class exists: "every screen disposes its own
 * geometry and materials on exit -- this is the whole reason the phase exists, and the thing a
 * later clubhouse would otherwise get wrong."
 *
 * So the behaviour under test is not "can it show a screen". It is the ordering and the
 * freshness: exit strictly before the next enter, exactly one live screen, and a brand new
 * instance every time -- because a factory that hands back a cached screen is exactly how a
 * scene leaks past the memory gate while every test still passes.
 *
 * ScreenManager imports no THREE and touches no DOM on purpose: the renderer is closed over by
 * the factories in main.ts, which keeps the transition logic testable in the node environment.
 */

interface Recorded extends Screen {
  readonly log: string[];
  readonly id: number;
}

function recorder(name: string, log: string[], id: number, hooks: Partial<Screen> = {}): Recorded {
  return {
    log,
    id,
    enter: hooks.enter ?? ((): void => void log.push(`${name}#${id} enter`)),
    step: hooks.step ?? ((): void => void log.push(`${name}#${id} step`)),
    draw: hooks.draw ?? ((): void => void log.push(`${name}#${id} draw`)),
    exit: hooks.exit ?? ((): void => void log.push(`${name}#${id} exit`)),
  };
}

function harness() {
  const log: string[] = [];
  let made = 0;
  const manager = new ScreenManager<"title" | "round">();
  manager.register("title", () => recorder("title", log, ++made));
  manager.register("round", () => recorder("round", log, ++made));
  return { log, manager, madeCount: () => made };
}

describe("activation", () => {
  it("enters the screen it is shown", () => {
    const { log, manager } = harness();
    manager.show("title");
    expect(log).toEqual(["title#1 enter"]);
    expect(manager.activeName).toBe("title");
  });

  it("starts with nothing active", () => {
    const { manager } = harness();
    expect(manager.activeName).toBeNull();
  });

  it("exits the old screen strictly BEFORE entering the new one", () => {
    const { log, manager } = harness();
    manager.show("title");
    log.length = 0;
    manager.show("round");
    // Entering first would have both screens' scenes resident at once, which is the GPU spike
    // the clubhouse gate is written to catch.
    expect(log).toEqual(["title#1 exit", "round#2 enter"]);
  });

  it("rejects an unregistered screen without disturbing the active one", () => {
    const { log, manager } = harness();
    manager.show("title");
    log.length = 0;
    expect(() => manager.show("settings" as "title")).toThrow(/settings/);
    expect(manager.activeName).toBe("title");
    expect(log).toEqual([]);
  });
});

describe("freshness -- the leak guard", () => {
  it("builds a NEW screen instance on every show", () => {
    const { manager, madeCount } = harness();
    manager.show("title");
    manager.show("round");
    manager.show("title");
    expect(madeCount()).toBe(3);
  });

  it("re-showing the active screen tears it down and rebuilds it", () => {
    const { log, manager } = harness();
    manager.show("round");
    log.length = 0;
    // Results -> NEXT HOLE -> Round has to give a fresh round, not the finished one.
    manager.show("round");
    expect(log).toEqual(["round#1 exit", "round#2 enter"]);
  });

  it("survives 20 enter/exit cycles calling exit exactly as often as enter", () => {
    const { log, manager } = harness();
    for (let i = 0; i < 20; i++) {
      manager.show("title");
      manager.show("round");
    }
    manager.dispose();
    const enters = log.filter((l) => l.endsWith("enter")).length;
    const exits = log.filter((l) => l.endsWith("exit")).length;
    expect(enters).toBe(40);
    expect(exits).toBe(40);
  });
});

describe("frame delegation", () => {
  it("drives only the active screen", () => {
    const { log, manager } = harness();
    manager.show("title");
    manager.show("round");
    log.length = 0;
    manager.step();
    manager.draw(0.5);
    expect(log).toEqual(["round#2 step", "round#2 draw"]);
  });

  it("passes the interpolation alpha through untouched", () => {
    const draw = vi.fn();
    const manager = new ScreenManager<"round">();
    manager.register("round", () => ({ enter: () => {}, step: () => {}, draw, exit: () => {} }));
    manager.show("round");
    manager.draw(0.25);
    expect(draw).toHaveBeenCalledWith(0.25);
  });

  it("is inert before anything is shown, rather than throwing into the frame loop", () => {
    const { manager } = harness();
    expect(() => {
      manager.step();
      manager.draw(0.5);
    }).not.toThrow();
  });
});

describe("failure handling", () => {
  it("leaves nothing active if enter throws, so the next show is not blocked", () => {
    const manager = new ScreenManager<"bad">();
    manager.register("bad", () => ({
      enter: () => {
        throw new Error("scene build failed");
      },
      step: () => {},
      draw: () => {},
      exit: () => {},
    }));
    expect(() => manager.show("bad")).toThrow(/scene build failed/);
    // A half-entered screen left in `active` would then be step()'d every frame forever.
    expect(manager.activeName).toBeNull();
  });

  it("still enters the new screen when the outgoing one throws on exit", () => {
    const log: string[] = [];
    const manager = new ScreenManager<"leaky" | "good">();
    manager.register("leaky", () => ({
      enter: () => void log.push("leaky enter"),
      step: () => {},
      draw: () => {},
      exit: () => {
        log.push("leaky exit");
        throw new Error("dispose blew up");
      },
    }));
    manager.register("good", () => recorder("good", log, 1));
    manager.show("leaky");
    // A screen that throws while tearing down must not strand the player on it.
    expect(() => manager.show("good")).not.toThrow();
    expect(manager.activeName).toBe("good");
    expect(log).toEqual(["leaky enter", "leaky exit", "good#1 enter"]);
  });
});

describe("dispose", () => {
  it("exits the active screen and clears it", () => {
    const { log, manager } = harness();
    manager.show("title");
    log.length = 0;
    manager.dispose();
    expect(log).toEqual(["title#1 exit"]);
    expect(manager.activeName).toBeNull();
  });

  it("is safe to call twice", () => {
    const { log, manager } = harness();
    manager.show("title");
    manager.dispose();
    log.length = 0;
    expect(() => manager.dispose()).not.toThrow();
    expect(log).toEqual([]);
  });
});
