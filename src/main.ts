import * as THREE from "three";
import { GameLoop } from "./engine/GameLoop";
import { KeyboardMouseSource } from "./input/KeyboardMouseSource";
import { RenderScene } from "./render/scene";
import type { FrameView } from "./render/scene";
import { FIXED_DT, POOL_TRANSFORM_STRIDE, Sim, SwingMode, TRANSFORM_STRIDE } from "./sim/world";
import type { BallTransform, CartTransform } from "./sim/world";
import { generateCourse } from "./sim/course";

/**
 * Fixed until a course-select screen exists (Phase 1.75). Changing it changes every hole, which
 * is the whole point of the seed -- and is the cheapest way to eyeball generation variety
 * during development.
 */
const COURSE_SEED = 2026;

async function main(): Promise<void> {
  const container = document.getElementById("app");
  const hud = readHud();
  if (!container || !hud) throw new Error("expected #app and the #hud elements in index.html");

  // One course, nine holes, one seed. Playing past hole 0 is Phase 1.75's round flow: the
  // renderer's ground mesh is built once, so advancing needs a screen transition, not just
  // sim.loadHole.
  const course = generateCourse(COURSE_SEED, 9);
  const sim = await Sim.create(course.holes[0]);
  const render = new RenderScene(container, sim.terrain, sim.targets.length);
  const input = new KeyboardMouseSource(render.renderer.domElement);

  // Dev-only inspection hook for manual tuning in the browser console (phase-0 spike, not shipped UI).
  (window as unknown as { __teetimeturrets: unknown }).__teetimeturrets = { sim, render, course };

  // Not part of PlayerIntent: "start the hole again" is a screen-level action that Phase 1.75's
  // ScreenManager will own via the results screen's NEXT HOLE. This is a dev affordance until then.
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyR") sim.reset();
  });

  // Reused across frames rather than rebuilt -- GameLoop's frame callback is covered by the
  // AGENTS.md no-allocation rule just as the fixed step is.
  const view: FrameView = {
    ball: cloneBall(sim.current),
    cart: cloneCart(sim.currentCart),
    aimYaw: 0,
    charge01: 0,
    club: sim.cart.equippedClub,
    mode: sim.mode,
    turretLoaded: turretLoaded(sim),
    targetTransforms: new Float32Array(sim.currentTargetTransforms.length),
    targetPartCount: sim.targetPartCount,
    poolTransforms: new Float32Array(sim.currentPoolTransforms.length),
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
      view.aimYaw = view.cart.turretYaw;
      view.charge01 = sim.cart.charge;
      view.club = sim.cart.equippedClub;
      view.mode = sim.mode;
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
      drawHud(hud, sim);
    },
  });
  loop.start();
}

interface Hud {
  powerFill: HTMLElement;
  mode: HTMLElement;
  club: HTMLElement;
  strokes: HTMLElement;
  status: HTMLElement;
}

function readHud(): Hud | null {
  const powerFill = document.getElementById("power-fill");
  const mode = document.getElementById("hud-mode");
  const club = document.getElementById("hud-club");
  const strokes = document.getElementById("hud-strokes");
  const status = document.getElementById("hud-status");
  if (!powerFill || !mode || !club || !strokes || !status) return null;
  return { powerFill, mode, club, strokes, status };
}

/**
 * A deliberately minimal readout, not the image-08 HUD -- that is Phase 4's job and wants the
 * layout done properly rather than grown one span at a time. This is only what a player needs to
 * understand what the cart is doing.
 */
function drawHud(hud: Hud, sim: Sim): void {
  const cart = sim.cart;
  hud.powerFill.style.width = `${Math.round(cart.charge * 100)}%`;
  setText(hud.mode, sim.mode === SwingMode.Cart ? "CART" : "STANDING");
  setText(hud.club, cart.equippedClub.toUpperCase());
  setText(hud.strokes, `STROKES ${sim.strokes}`);
  setText(hud.status, statusText(sim));
}

/**
 * What rides the club head in cart mode is a round of ammo, not the course ball -- images 03 and
 * 04, and what actually fires. In stationary mode there is no turret shot at all.
 */
function turretLoaded(sim: Sim): boolean {
  return sim.mode === SwingMode.Cart && sim.cart.ammo > 0;
}

function statusText(sim: Sim): string {
  if (sim.holedOut) return "HOLED OUT — R to reset";
  if (!sim.cart.canFire) return `RELOADING ${sim.cart.reloadRemaining.toFixed(1)}s`;
  if (sim.lastShotInWater) return "WATER HAZARD — plus one stroke";
  if (sim.lastShotOutOfBounds) return "OUT OF BOUNDS — returned to the tee";
  if (sim.mode !== SwingMode.Cart) return "READY";
  return sim.cart.ammo > 0 ? "READY" : "NO AMMO — fire a blank to boost";
}

/** Guarded so an unchanged string does not dirty the DOM every frame at 60fps. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
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
