import * as THREE from "three";
import { GameLoop } from "./engine/GameLoop";
import { KeyboardMouseSource } from "./input/KeyboardMouseSource";
import { RenderScene } from "./render/scene";
import type { FrameView } from "./render/scene";
import { FIXED_DT, POOL_TRANSFORM_STRIDE, Sim, TRANSFORM_STRIDE } from "./sim/world";
import type { BallTransform, CartTransform } from "./sim/world";
import { generateCourse } from "./sim/course";
import { drawHud, readHud } from "./ui/hud";
import { drawMatchResults, readMatchResults } from "./ui/matchResults";
import { Nameplates } from "./ui/nameplates";

/**
 * Fixed until a course-select screen exists (Phase 1.75). Changing it changes every hole, which
 * is the whole point of the seed -- and is the cheapest way to eyeball generation variety
 * during development.
 */
const COURSE_SEED = 2026;

async function main(): Promise<void> {
  const container = document.getElementById("app");
  const hud = readHud();
  const results = readMatchResults();
  if (!container || !hud || !results) {
    throw new Error("expected #app, the #hud elements and #match-results in index.html");
  }

  // One course, nine holes, one seed. Playing past hole 0 is Phase 1.75's round flow: the
  // renderer's ground mesh is built once, so advancing needs a screen transition, not just
  // sim.loadHole.
  const course = generateCourse(COURSE_SEED, 9);
  const sim = await Sim.create(course.holes[0]);
  const render = new RenderScene(container, sim.terrain, sim.targets.length, sim.bots.length);
  const plateRoot = document.getElementById("nameplates");
  if (!plateRoot) throw new Error("expected #nameplates in index.html");
  const nameplates = new Nameplates(plateRoot, sim.bots.map((_, i) => `BOT ${i + 1}`));
  const input = new KeyboardMouseSource(render.renderer.domElement);

  // Dev-only inspection hook for manual tuning in the browser console (phase-0 spike, not shipped UI).
  (window as unknown as { __teetimeturrets: unknown }).__teetimeturrets = { sim, render, course };

  // Not part of PlayerIntent: "start the hole again" is a screen-level action that Phase 1.75's
  // ScreenManager will own via the results screen's NEXT HOLE. This is a dev affordance until then.
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyR") sim.reset();
  });

  // Same reset path R already triggers: it re-rolls the clock, clears the result, re-seeds the
  // bots and stands the targets back up.
  results.playAgain.addEventListener("click", () => sim.reset());

  // Edge-triggers document.exitPointerLock() below: a primitive, not a per-frame allocation.
  let resultsWereVisible = false;

  // Reused across frames rather than rebuilt -- GameLoop's frame callback is covered by the
  // AGENTS.md no-allocation rule just as the fixed step is.
  const view: FrameView = {
    ball: cloneBall(sim.current),
    cart: cloneCart(sim.currentCart),
    charge01: 0,
    club: sim.cart.equippedClub,
    turretLoaded: turretLoaded(sim),
    targetTransforms: new Float32Array(sim.currentTargetTransforms.length),
    targetPartCount: sim.targetPartCount,
    poolTransforms: new Float32Array(sim.currentPoolTransforms.length),
    botCarts: sim.currentBotCarts.map(cloneCart),
  };

  const loop = new GameLoop({
    fixedDt: FIXED_DT,
    step: () => {
      sim.step(input.sample());
      input.endTick();
    },
    render: (alpha) => {
      interpolateBall(sim.previous, sim.current, alpha, view.ball);
      interpolateCart(sim.previousCart, sim.currentCart, alpha, view.cart);
      for (let i = 0; i < view.botCarts.length; i++) {
        interpolateCart(sim.previousBotCarts[i]!, sim.currentBotCarts[i]!, alpha, view.botCarts[i]!);
      }
      view.charge01 = sim.cart.charge;
      view.club = sim.cart.equippedClub;
      view.turretLoaded = turretLoaded(sim);
      interpolateTransforms(
        sim.previousTargetTransforms,
        sim.currentTargetTransforms,
        alpha,
        view.targetTransforms,
      );
      interpolateTransforms(
        sim.previousPoolTransforms,
        sim.currentPoolTransforms,
        alpha,
        view.poolTransforms,
        POOL_TRANSFORM_STRIDE,
      );

      render.draw(view);
      drawNameplates(render, nameplates, view, sim);
      drawHud(hud, sim);
      drawMatchResults(results, sim);

      // Pointer-locked players (mouse aim) cannot see or reach #play-again -- the canvas has
      // captured and hidden the cursor -- so release the lock on the tick the overlay first
      // becomes visible rather than leaving Esc as the only undocumented way out.
      const resultsVisible = !results.root.hidden;
      if (resultsVisible && !resultsWereVisible && document.pointerLockElement !== null) {
        document.exitPointerLock();
      }
      resultsWereVisible = resultsVisible;
    },
  });
  loop.start();
}

/**
 * What rides the club head is a round of ammo, not the course ball -- images 03 and 04, and what
 * actually fires.
 */
function turretLoaded(sim: Sim): boolean {
  return sim.cart.ammo > 0;
}

/** Metres above a cart's capsule centre that its plate floats. Clears the turret's club head. */
const NAMEPLATE_HEIGHT = 2.6;
const plateScratch = { x: 0, y: 0 };

/**
 * Projects each bot cart's plate anchor and places it. Reads health straight off the sim -- a
 * read, never a mutation, per the AGENTS.md rule that src/ui/** consumes sim state.
 *
 * The player's own cart is never plated: UI-SPEC H13's data source is "remote cart positions"
 * (docs/UI-SPEC.md), and the chase camera already frames the player's cart with #hud-combat's
 * health card below it -- a second health bar mid-screen over your own cart would duplicate
 * both.
 */
function drawNameplates(render: RenderScene, plates: Nameplates, view: FrameView, sim: Sim): void {
  for (let i = 0; i < view.botCarts.length; i++) {
    const bot = sim.bots[i];
    if (bot === undefined) continue;
    placeNameplate(render, plates, i, view.botCarts[i]!, bot.health);
  }
}

/** Module-level rather than nested inside `drawNameplates`: a function declared inside a function
 *  body allocates a fresh closure on every call, and this one is called every frame. */
function placeNameplate(
  render: RenderScene,
  plates: Nameplates,
  index: number,
  cart: CartTransform,
  health: { readonly hp: number; readonly max: number },
): void {
  const visible = render.projectToScreen(
    cart.position.x,
    cart.position.y + NAMEPLATE_HEIGHT,
    cart.position.z,
    plateScratch,
  );
  plates.setPlate(
    index,
    plateScratch.x,
    plateScratch.y,
    visible,
    health.max > 0 ? health.hp / health.max : 0,
  );
}

const scratchA = new THREE.Quaternion();
const scratchB = new THREE.Quaternion();
const scratchOut = new THREE.Quaternion();

function interpolateBall(
  previous: BallTransform,
  current: BallTransform,
  alpha: number,
  out: BallTransform,
): void {
  scratchA.set(previous.rotation.x, previous.rotation.y, previous.rotation.z, previous.rotation.w);
  scratchB.set(current.rotation.x, current.rotation.y, current.rotation.z, current.rotation.w);
  scratchOut.slerpQuaternions(scratchA, scratchB, alpha);

  out.position.x = lerp(previous.position.x, current.position.x, alpha);
  out.position.y = lerp(previous.position.y, current.position.y, alpha);
  out.position.z = lerp(previous.position.z, current.position.z, alpha);
  out.rotation.x = scratchOut.x;
  out.rotation.y = scratchOut.y;
  out.rotation.z = scratchOut.z;
  out.rotation.w = scratchOut.w;
}

/**
 * Plain lerp on the angles is correct here rather than a shortest-arc slerp: heading and turret
 * yaw accumulate without ever being wrapped to [-PI, PI], so successive values never straddle a
 * discontinuity and a naive interpolation cannot take the long way round.
 */
function interpolateCart(
  previous: CartTransform,
  current: CartTransform,
  alpha: number,
  out: CartTransform,
): void {
  out.position.x = lerp(previous.position.x, current.position.x, alpha);
  out.position.y = lerp(previous.position.y, current.position.y, alpha);
  out.position.z = lerp(previous.position.z, current.position.z, alpha);
  out.heading = lerp(previous.heading, current.heading, alpha);
  out.turretYaw = lerp(previous.turretYaw, current.turretYaw, alpha);
}

/**
 * Lerps positions and slerps rotations for a whole flat transform buffer in place. Uninterpolated,
 * a ragdoll collapsing over about a second steps visibly at any refresh rate above 60 Hz -- and
 * the collapse is the thing this rendering exists to show.
 *
 * Standing parts are interpolated too rather than special-cased: the copy costs a handful of
 * floats and keeps this one code path instead of two.
 */
function interpolateTransforms(
  previous: Float32Array,
  current: Float32Array,
  alpha: number,
  out: Float32Array,
  stride: number = TRANSFORM_STRIDE,
): void {
  const count = Math.min(previous.length, current.length, out.length);
  for (let i = 0; i + stride <= count; i += stride) {
    out[i] = lerp(previous[i]!, current[i]!, alpha);
    out[i + 1] = lerp(previous[i + 1]!, current[i + 1]!, alpha);
    out[i + 2] = lerp(previous[i + 2]!, current[i + 2]!, alpha);

    scratchA.set(previous[i + 3]!, previous[i + 4]!, previous[i + 5]!, previous[i + 6]!);
    scratchB.set(current[i + 3]!, current[i + 4]!, current[i + 5]!, current[i + 6]!);
    scratchOut.slerpQuaternions(scratchA, scratchB, alpha);
    out[i + 3] = scratchOut.x;
    out[i + 4] = scratchOut.y;
    out[i + 5] = scratchOut.z;
    out[i + 6] = scratchOut.w;

    // Anything past the transform itself is a flag, not a value: copy, never interpolate. A
    // half-active ball would be drawn at half scale on the frame it spawns.
    for (let extra = TRANSFORM_STRIDE; extra < stride; extra++) {
      out[i + extra] = current[i + extra]!;
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cloneBall(t: BallTransform): BallTransform {
  return { position: { ...t.position }, rotation: { ...t.rotation } };
}

function cloneCart(t: CartTransform): CartTransform {
  return { position: { ...t.position }, heading: t.heading, turretYaw: t.turretYaw };
}

main().catch((err: unknown) => {
  console.error(err);
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  document.body.innerHTML = `<pre style="color:#f66;padding:2rem;font:14px monospace;white-space:pre-wrap">${message}</pre>`;
});
