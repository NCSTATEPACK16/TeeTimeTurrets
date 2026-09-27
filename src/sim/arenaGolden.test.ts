import { beforeAll, describe, expect, it } from "vitest";
import { arenaFromCourse } from "./arena";
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import { authoredCourse } from "./authoredCourse";
import { buildCourseWorld } from "./courseWorld";
import type { CourseWorld } from "./courseWorld";
import { ARENA_BOTS } from "./matchConfig";
import { Sim } from "./world";

/**
 * A fingerprint of one scripted arena match on the shipped course.
 *
 * This is a refactoring guard, not a rule: it says nothing about whether the match is *good*, only
 * that a change which claims to preserve behaviour does. Every cart's position, heading, HP and
 * ammo, and the scoreboard, are folded into one hash every tick, so a divergence anywhere in the
 * world -- a respawn drawn from a different stream, a contact resolved in a different order, a bot
 * reading a different target -- changes the number.
 *
 * When a change is *meant* to alter the match (tuning, a new rule), re-record the constant in the
 * same commit and say so in the message. Recording it in a commit that claims to change nothing is
 * exactly the lie this test exists to catch.
 */

const COURSE_SEED = 2026;
const TICKS = 2400; // 40 s: long enough for bots to close, fire, and for someone to die.

/** 32-bit FNV-1a over the float64 bits of every value fed to it. */
class Fingerprint {
  private hash = 0x811c9dc5;
  private readonly view = new DataView(new ArrayBuffer(8));

  add(value: number): void {
    this.view.setFloat64(0, value);
    for (let i = 0; i < 8; i++) {
      this.hash ^= this.view.getUint8(i);
      this.hash = Math.imul(this.hash, 0x01000193) >>> 0;
    }
  }

  get value(): number {
    return this.hash;
  }
}

/** Drive, weave, and fire on a fixed rhythm -- enough that the player's own shots are in the hash. */
function scriptedIntent(tick: number, out: PlayerIntent): PlayerIntent {
  out.throttle = tick % 600 < 420 ? 1 : 0;
  out.steer = Math.sin(tick / 90) > 0.3 ? 1 : Math.sin(tick / 90) < -0.3 ? -1 : 0;
  out.brake = tick % 600 >= 540;
  out.aimDelta = tick % 240 < 20 ? 0.02 : 0;
  out.fire = tick % 45 < 20;
  out.selectClub = null;
  return out;
}

async function playScriptedMatch(world: CourseWorld): Promise<number> {
  const sim = await Sim.create(arenaFromCourse(world), { botCount: ARENA_BOTS });
  const print = new Fingerprint();
  const intent = neutralIntent();
  const carts = [sim.cart, ...sim.bots];
  try {
    for (let tick = 0; tick < TICKS; tick++) {
      sim.step(scriptedIntent(tick, intent));
      for (const cart of carts) {
        print.add(cart.position.x);
        print.add(cart.position.y);
        print.add(cart.position.z);
        print.add(cart.heading);
        print.add(cart.health.hp);
        print.add(cart.ammo);
      }
    }
    for (let i = 0; i < carts.length; i++) {
      print.add(sim.match.strokesFor(i));
      print.add(sim.match.pointsFor(i));
    }
  } finally {
    sim.dispose();
  }
  return print.value;
}

describe("arena determinism fingerprint", () => {
  let world: CourseWorld;
  beforeAll(() => {
    world = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED);
  });

  it("replays identically from the same seed", async () => {
    expect(await playScriptedMatch(world)).toBe(await playScriptedMatch(world));
  });

  it("matches the recorded fingerprint", async () => {
    expect(await playScriptedMatch(world)).toBe(499299135);
  });
});
