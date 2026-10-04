import { beforeAll, describe, expect, it } from "vitest";
import v8 from "node:v8";
import { Session } from "node:inspector/promises";
import { arenaFromCourse } from "../src/sim/arena";
import { authoredCourse } from "../src/sim/authoredCourse";
import { buildCourseWorld } from "../src/sim/courseWorld";
import { ARENA_BOTS } from "../src/sim/matchConfig";
import { Sim } from "../src/sim/world";

/**
 * The fixed tick makes no objects of its own (AGENTS.md: no per-frame allocation in `Sim.step`).
 *
 * A `.mjs` test in `tools/` rather than a `.ts` one beside the sim, because it needs Node's
 * `inspector` and `v8` modules and the project's `tsconfig.json` does not load Node's types.
 *
 * **How it is measured.** V8's allocation tracker -- the "allocation instrumentation" timeline --
 * records every heap allocation with the function that made it, collected or not: exact counts and
 * bytes, not a sample. It runs over a stretch of a full match on the shipped course with the shipped
 * roster, after a warm-up long enough for bots to close, fire and die.
 *
 * **What counts as an allocation.** Anything a sim or physics function allocates that is not a
 * 16-byte `HeapNumber`. V8 boxes a double into one wherever optimized code has to hand it on as a
 * value -- out of a call it did not inline, for one -- which is the engine's choice, not a
 * construction in the code. An object, an array or a closure is at least 24 bytes, so
 * `bytes - 16 * count` is exactly the bytes of everything else.
 *
 * **Why not zero, and why two windows.** V8 also allocates its own bookkeeping while the match
 * runs -- a feedback vector or a map transition when something is compiled or first takes a
 * double, kilobytes at a time -- and the tracker charges it to whichever frame is running, a module
 * body included. It lands somewhere different on each run and does not recur: measured, up to
 * about 11 KB in one function in one window, and never the same function twice. A construction in
 * the tick recurs every tick -- one three-field object is 48 bytes a tick, in every window. So the
 * tick is traced over two separate windows, and a function is at fault only if it made more than
 * `MAX_EXTRA_BYTES_PER_TICK` beyond boxed doubles in **both**.
 *
 * **No re-optimizing in the windows.** The warm-up runs with V8's optimizer on, as the game does,
 * so the windows measure optimized code. During the windows, tiering is capped at the baseline
 * compiler. A function whose optimized code is thrown away can then run on, but it cannot be
 * optimized again. That matters because a deopt-and-reoptimize cycle allocates V8 bookkeeping
 * charged to the function, and the cycle can repeat. `syncCurrentPool` showed it on CI
 * (4 Oct 2026, "30.0 and 38.3 bytes a tick" in both windows): optimized while no ball was active,
 * it deoptimizes when one goes active ("insufficient type feedback" at `r.x`), and a GC then
 * deoptimizes it again ("weak objects"). A trace of one local run showed seven such cycles. Which
 * window a cycle lands in depends on concurrent compilation and GC timing, so the test failed only
 * sometimes. Capped, a function deoptimizes at most once and lands in at most one window. A
 * construction in the tick still happens on every tick, in both windows.
 *
 * **Inlining is off for the run**, so each allocation stays in the frame that made it. With it on,
 * Rapier's glue -- which wraps every vector it hands back in a fresh object -- is folded into
 * whichever sim function called it and would be charged to the sim. Rapier's own allocations are
 * measured and reported, not held to zero: nothing on this side of its binding can remove them.
 */

v8.setFlagsFromString("--no-turbo-inlining");
v8.setFlagsFromString("--no-maglev-inlining");

const WARM_TICKS = 1800;
const WINDOW_TICKS = 300;
const HEAP_NUMBER_BYTES = 16;
/** See the header: above V8's own bookkeeping, below one small object a tick. */
const MAX_EXTRA_BYTES_PER_TICK = 16;

const isSim = (script) => /\/src\/(sim|physics)\//.test(script) && !script.includes(".test.");

/** Per window, per function: `{ script, count, bytes }`, keyed by "name in file". */
const windows = [];

beforeAll(async () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const sim = await Sim.create(arenaFromCourse(world), { botCount: ARENA_BOTS });
  for (let i = 0; i < WARM_TICKS; i++) sim.step();
  // Freeze tiering for the windows (see the header, "No re-optimizing in the windows").
  v8.setFlagsFromString("--max-opt=1");

  const session = new Session();
  session.connect();
  let chunks = [];
  session.on("HeapProfiler.addHeapSnapshotChunk", (message) => chunks.push(message.params.chunk));
  await session.post("HeapProfiler.enable");
  for (let w = 0; w < 2; w++) {
    chunks = [];
    await session.post("HeapProfiler.startTrackingHeapObjects", { trackAllocations: true });
    for (let i = 0; i < WINDOW_TICKS; i++) sim.step();
    await session.post("HeapProfiler.stopTrackingHeapObjects", { reportProgress: false });
    windows.push(allocationsByFunction(JSON.parse(chunks.join(""))));
  }
  await session.post("HeapProfiler.disable");
  session.disconnect();
  sim.dispose();
}, 300_000);

/** A heap snapshot's allocation trace, summed per function. */
function allocationsByFunction(snapshot) {
  const byFunction = new Map();
  const { trace_function_info_fields: infoFields, trace_node_fields: nodeFields } = snapshot.snapshot.meta;
  const infos = snapshot.trace_function_infos;
  const strings = snapshot.strings;
  const NAME = infoFields.indexOf("name");
  const SCRIPT = infoFields.indexOf("script_name");
  const FUNCTION = nodeFields.indexOf("function_info_index");
  const COUNT = nodeFields.indexOf("count");
  const SIZE = nodeFields.indexOf("size");
  const CHILDREN = nodeFields.indexOf("children");

  const walk = (tree) => {
    for (let i = 0; i < tree.length; i += nodeFields.length) {
      const count = tree[i + COUNT];
      if (count > 0) {
        const info = tree[i + FUNCTION] * infoFields.length;
        const script = strings[infos[info + SCRIPT]];
        const key = `${strings[infos[info + NAME]] || "(anonymous)"} in ${script.replace(/.*\/(src|node_modules)\//, "$1/")}`;
        const total = byFunction.get(key) ?? { script, count: 0, bytes: 0 };
        total.count += count;
        total.bytes += tree[i + SIZE];
        byFunction.set(key, total);
      }
      walk(tree[i + CHILDREN]);
    }
  };
  walk(snapshot.trace_tree);
  return byFunction;
}

/** Bytes a tick a function allocated beyond boxed doubles, in one window. */
function extraPerTick(total) {
  return (total.bytes - HEAP_NUMBER_BYTES * total.count) / WINDOW_TICKS;
}

describe("the fixed tick", () => {
  it(`makes no object, array or closure in the sim, in either of two ${WINDOW_TICKS}-tick windows of a full match`, () => {
    const [first, second] = windows;
    const offenders = [...first.entries()]
      .filter(([key, t]) => isSim(t.script) && second.has(key))
      .map(([key, t]) => ({ key, a: extraPerTick(t), b: extraPerTick(second.get(key)) }))
      .filter(({ a, b }) => a >= MAX_EXTRA_BYTES_PER_TICK && b >= MAX_EXTRA_BYTES_PER_TICK)
      .map(({ key, a, b }) => `${key}: ${a.toFixed(1)} and ${b.toFixed(1)} bytes a tick beyond boxed doubles`);
    expect(offenders).toEqual([]);
  });

  /**
   * The controls. The tracker saw the tick at all -- Rapier's binding allocates on every tick with
   * carts in the world, so a trace without it traced nothing -- and it did see sim frames, so the
   * filter above is not passing an empty list.
   */
  it("traced the tick: Rapier allocated, and sim functions appear in the trace", () => {
    for (const window of windows) {
      const rapier = [...window.values()].filter((t) => t.script.includes("rapier"));
      expect(rapier.reduce((sum, t) => sum + t.bytes, 0) / WINDOW_TICKS).toBeGreaterThan(1000);
      expect([...window.values()].filter((t) => isSim(t.script)).length).toBeGreaterThan(5);
    }
  });
});

/**
 * Rapier's allocations are its own, but how often the sim asks is the sim's. Every
 * `translation()` and `linvel()` is a fresh object, so the pool reads each live ball once a tick
 * (`BallPool.sync`) and everything else -- the pool's own step, pickups, a bot's ammo search, the
 * render snapshot -- reads that. A bot looking for ammo used to ask Rapier where every landed ball
 * was, every tick it was empty.
 */
describe("what the tick asks Rapier", () => {
  it("reads each live ball's position and velocity exactly once a tick", async () => {
    const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
    const world = buildCourseWorld(authoredCourse(2026), 2026);
    const sim = await Sim.create(arenaFromCourse(world), { botCount: ARENA_BOTS });
    for (let i = 0; i < 1200; i++) sim.step();

    const proto = RAPIER.RigidBody.prototype;
    const calls = { translation: 0, linvel: 0 };
    const originals = { translation: proto.translation, linvel: proto.linvel };
    proto.translation = function (...args) {
      calls.translation++;
      return originals.translation.apply(this, args);
    };
    proto.linvel = function (...args) {
      calls.linvel++;
      return originals.linvel.apply(this, args);
    };
    // `BallPool.sync` reads every ball still live after the world step, once; a hit reads where the
    // ball struck, once. Those are the only reads the tick is allowed.
    let syncedBalls = 0;
    let hits = 0;
    const cursor = sim.events.cursor();
    try {
      for (let i = 0; i < 600; i++) {
        sim.step();
        syncedBalls += sim.ballPool.all.filter((b) => b.state !== "idle").length;
        for (let s = cursor.begin(); s < sim.events.total; s++) {
          if (sim.events.at(s).kind === "hit") hits++;
        }
        cursor.end();
      }
    } finally {
      proto.translation = originals.translation;
      proto.linvel = originals.linvel;
      sim.dispose();
    }
    // The premise: balls were in play, so there was something to over-read.
    expect(syncedBalls).toBeGreaterThan(600);
    expect(calls.translation).toBe(syncedBalls + hits);
    expect(calls.linvel).toBe(syncedBalls);
  }, 120_000);
});
