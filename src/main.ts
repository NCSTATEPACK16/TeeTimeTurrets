import * as THREE from "three";
import { GameLoop } from "./engine/GameLoop";
import { RenderScene } from "./render/scene";
import { FIXED_DT, Sim } from "./sim/world";
import type { BallTransform } from "./sim/world";

const CHARGE_DURATION_SECONDS = 1.1;
const AIM_TURN_RATE = 1.6; // radians per second, applied once per fixed tick (see stepInput)

async function main(): Promise<void> {
  const container = document.getElementById("app");
  const powerFillEl = document.getElementById("power-fill");
  if (!container || !powerFillEl) throw new Error("expected #app and #power-fill in index.html");
  const powerFill: HTMLElement = powerFillEl;

  const sim = await Sim.create();
  const render = new RenderScene(container);

  // Dev-only inspection hook for manual tuning in the browser console (phase-0 spike, not shipped UI).
  (window as unknown as { __teetimeturrets: unknown }).__teetimeturrets = { sim };

  let aimYaw = 0;
  let charging = false;
  let chargeStartMs = 0;
  let power = 0;

  const keysDown = new Set<string>();
  window.addEventListener("keydown", (event) => {
    keysDown.add(event.code);
    if (event.repeat) return;
    if (event.code === "Space" && !charging && sim.isResting()) {
      charging = true;
      chargeStartMs = performance.now();
    }
    if (event.code === "KeyR") {
      sim.reset();
      charging = false;
      power = 0;
    }
  });
  window.addEventListener("keyup", (event) => {
    keysDown.delete(event.code);
    if (event.code === "Space" && charging) {
      sim.launch(aimYaw, power);
      charging = false;
      power = 0;
    }
  });

  // Fixed-tick-rate input: aim turns at a rate defined in radians-per-tick, not radians-per-
  // render-frame, so it stays frame-rate independent and (once networked) reproducible from
  // replayed input alone -- the same reason ballistics live in the sim tick, not the render tick.
  function stepInput(): void {
    if (keysDown.has("ArrowLeft")) aimYaw -= AIM_TURN_RATE * FIXED_DT;
    if (keysDown.has("ArrowRight")) aimYaw += AIM_TURN_RATE * FIXED_DT;
  }

  const loop = new GameLoop({
    fixedDt: FIXED_DT,
    step: () => {
      stepInput();
      sim.step();
    },
    render: (alpha) => {
      if (charging) {
        power = Math.min(1, (performance.now() - chargeStartMs) / 1000 / CHARGE_DURATION_SECONDS);
      }
      render.draw(interpolate(sim.previous, sim.current, alpha), aimYaw, power);
      powerFill.style.width = `${Math.round(power * 100)}%`;
    },
  });
  loop.start();
}

const scratchA = new THREE.Quaternion();
const scratchB = new THREE.Quaternion();
const scratchOut = new THREE.Quaternion();

function interpolate(previous: BallTransform, current: BallTransform, alpha: number): BallTransform {
  scratchA.set(previous.rotation.x, previous.rotation.y, previous.rotation.z, previous.rotation.w);
  scratchB.set(current.rotation.x, current.rotation.y, current.rotation.z, current.rotation.w);
  scratchOut.slerpQuaternions(scratchA, scratchB, alpha);
  return {
    position: {
      x: previous.position.x + (current.position.x - previous.position.x) * alpha,
      y: previous.position.y + (current.position.y - previous.position.y) * alpha,
      z: previous.position.z + (current.position.z - previous.position.z) * alpha,
    },
    rotation: { x: scratchOut.x, y: scratchOut.y, z: scratchOut.z, w: scratchOut.w },
  };
}

main().catch((err: unknown) => {
  console.error(err);
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  document.body.innerHTML = `<pre style="color:#f66;padding:2rem;font:14px monospace;white-space:pre-wrap">${message}</pre>`;
});
