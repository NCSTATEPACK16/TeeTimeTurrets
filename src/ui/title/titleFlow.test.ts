import { describe, expect, it } from "vitest";
import { RIDES, freeDriveUrl } from "./titleConfig";
import { TitleFlow } from "./titleFlow";

describe("TitleFlow", () => {
  it("goes title -> ride select -> the chosen ride, Turrets first", () => {
    const f = new TitleFlow();
    expect(f.view).toBe("title");
    expect(f.start()).toBeNull(); // nothing starts from the title itself
    f.teeOff();
    expect(f.view).toBe("ride");
    expect(f.start()?.id).toBe("turrets");
    expect(f.start()?.kind).toBe("match");
  });

  it("nudges through all three rides in both directions, wrapping", () => {
    const f = new TitleFlow();
    f.nudge(1);
    expect(f.ride).toBe("chill");
    f.nudge(1);
    expect(f.ride).toBe("joyride");
    f.nudge(1);
    expect(f.ride).toBe("turrets");
    f.nudge(-1);
    expect(f.ride).toBe("joyride");
  });

  it("Esc steps back from ride select, and reports when there is nowhere to go", () => {
    const f = new TitleFlow();
    expect(f.back()).toBe(false);
    f.teeOff();
    expect(f.back()).toBe(true);
    expect(f.view).toBe("title");
  });

  it("tells listeners on each change, and ignores unknown or repeated picks", () => {
    const f = new TitleFlow();
    let n = 0;
    f.onChange(() => n++);
    f.pick("turrets");
    f.pick("nope" as never);
    expect(n).toBe(0);
    f.pick("joyride");
    f.teeOff();
    expect(n).toBe(2);
  });
});

describe("rides", () => {
  it("are Turrets (the arena) and the two free-drive rides", () => {
    expect(RIDES.map((r) => [r.id, r.kind])).toEqual([
      ["turrets", "match"],
      ["chill", "drive"],
      ["joyride", "drive"],
    ]);
  });

  it("only the arena ride promises a turret", () => {
    for (const r of RIDES.filter((x) => x.kind === "drive")) {
      expect(`${r.blurb} ${r.tags.join(" ")}`).not.toMatch(/turret|fir(e|ing)\b/i);
    }
  });

  it("free drive opens drive/ on Tee Time Links, past its own menus, with a way home", () => {
    const url = new URL(freeDriveUrl("/", "joyride"), "https://example.test");
    expect(url.pathname).toBe("/drive/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      level: "tee-time-links",
      mode: "joyride",
      menu: "0",
      home: "/",
    });
    expect(freeDriveUrl("/sub", "chill")).toMatch(/^\/sub\/drive\/\?.*home=%2Fsub%2F/);
  });
});
