import { describe, expect, it } from "vitest";
import { FrameGovernor } from "./frameGovernor";

/** The spec's "about 5 s", written out: reading the module's constant would pass whatever it is. */
const SPEC_SECONDS = 5;

/** The 120/60 governor (Stage 4b, spec §3). */

/** Feeds `seconds` of frames, each `interval(i)` ms long, drawing the ones it allows. */
function run(gov: FrameGovernor, seconds: number, interval: (i: number) => number, start = 0): number {
  let now = start;
  let last = start;
  for (let i = 0; now < start + seconds * 1000; i++) {
    now += interval(i);
    if (gov.shouldDraw(now)) {
      gov.record(now, now - last);
      last = now;
    }
  }
  return now;
}

const HZ120 = 1000 / 120;

describe("the 120/60 governor", () => {
  it("leaves a steady 120 Hz alone", () => {
    const gov = new FrameGovernor();
    run(gov, 20, () => HZ120);
    expect(gov.mode).toBe("uncapped");
  });

  it("locks to 60 after five seconds that miss 120, and not after four", () => {
    const gov = new FrameGovernor();
    const t = run(gov, SPEC_SECONDS - 0.5, () => 11);
    expect(gov.mode).toBe("uncapped");
    run(gov, 1, () => 11, t);
    expect(gov.mode).toBe("locked60");
  });

  it("forgives a few slow frames a second: it is the 95th percentile, not the worst", () => {
    const gov = new FrameGovernor();
    // Three 20 ms frames in every hundred.
    run(gov, 20, (i) => (i % 100 < 3 ? 20 : HZ120));
    expect(gov.mode).toBe("uncapped");
  });

  it("starts the count again after a good second", () => {
    const gov = new FrameGovernor();
    let t = run(gov, SPEC_SECONDS - 1, () => 11);
    t = run(gov, 1.5, () => HZ120, t);
    run(gov, SPEC_SECONDS - 1, () => 11, t);
    expect(gov.mode).toBe("uncapped");
  });

  it("draws every other 120 Hz frame once locked, and tries 120 again next match", () => {
    const gov = new FrameGovernor();
    const t = run(gov, SPEC_SECONDS + 1, () => 11);
    expect(gov.mode).toBe("locked60");
    let drawn = 0;
    for (let i = 1; i <= 120; i++) if (gov.shouldDraw(t + i * HZ120)) drawn++;
    expect(drawn).toBe(60);
    gov.reset();
    expect(gov.mode).toBe("uncapped");
    expect(gov.shouldDraw(t + 10_000)).toBe(true);
  });
});
