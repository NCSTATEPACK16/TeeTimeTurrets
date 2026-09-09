import * as THREE from "three";
import { KeyboardMouseSource } from "../../input/KeyboardMouseSource";
import { RenderScene } from "../../render/scene";
import type { FrameView } from "../../render/scene";
import { CLUB_STATS } from "../../physics/Ballistics";
import type { ClubType } from "../../physics/Ballistics";
import { FIXED_DT, POOL_TRANSFORM_STRIDE, Sim, TRANSFORM_STRIDE } from "../../sim/world";
import type { BallTransform, CartTransform } from "../../sim/world";
import { drawHud, readHud } from "../hud";
import { createHudStateScratch, deriveHudState } from "../hudState";
import type { Hud } from "../hud";
import { drawMatchResults, readMatchResults } from "../matchResults";
import type { MatchResultsDom } from "../matchResults";
import { Nameplates } from "../nameplates";
import { PinMarker } from "../pinMarker";
import { on } from "../dom";
import type { Screen } from "../../app/ScreenManager";
import type { Round } from "../../sim/round";

/**
 * The hole itself: sim, scene, input, HUD and nameplates for one round, with a lifetime.
 *
 * This is what `main.ts` used to be. Moving it behind `Screen` is the whole point of Phase 1.75 --
 * a round can now be left and re-entered, and `exit()` is the single place that has to give
 * everything back. The Sim is created before `enter()` because `Sim.create` is async and the
 * screen lifecycle is not; `main.ts` awaits it and hands over a live one.
 */

export interface RoundScreenOptions {
  readonly renderer: THREE.WebGLRenderer;
  readonly sim: Sim;
  readonly round: Round;
  readonly hudRoot: HTMLElement;
  readonly nameplateRoot: HTMLElement;
  /** Called once the hole is over, with the strokes taken. Drives the transition to Results. */
  readonly onHoleComplete: (strokes: number) => void;
}

export class RoundScreen implements Screen {
  private readonly options: RoundScreenOptions;
  private render: RenderScene | null = null;
  private input: KeyboardMouseSource | null = null;
  private nameplates: Nameplates | null = null;
  private pinMarker: PinMarker | null = null;
  private hud: Hud | null = null;
  private matchResults: MatchResultsDom | null = null;
  private matchResultsWereVisible = false;
  private view: FrameView | null = null;
  private reported = false;
  /** Where the ball was when the current shot left the muzzle, or null between shots. */
  private driveOrigin: { x: number; z: number } | null = null;
  private lastShotCount = 0;
  /**
   * Sim time since this screen was entered, for the renderer's cosmetic cycles. Accumulated from
   * the fixed step rather than sampled from a wall clock: a frame-rate-dependent pennant would
   * make the scene gate's screenshot depend on how fast the machine ran.
   */
  private elapsedSeconds = 0;
  private readonly teardown: (() => void)[] = [];

  constructor(options: RoundScreenOptions) {
    this.options = options;
  }

  enter(): void {
    const { renderer, sim, hudRoot, nameplateRoot } = this.options;

    this.render = new RenderScene(renderer, sim.terrain, sim.surfaces, sim.targets.length, sim.bots.length);
    this.nameplates = new Nameplates(nameplateRoot, sim.bots.map((_, i) => `BOT ${i + 1}`));
    // Shares #nameplates: both are world-anchored chips over the same scene, and H17 follows H13's
    // projection (UI-SPEC §2). Stacking order is the container's, not theirs.
    this.pinMarker = new PinMarker(nameplateRoot);
    this.input = new KeyboardMouseSource(renderer.domElement);
    this.hud = readHud();
    this.matchResults = readMatchResults();
    if (!this.hud || !this.matchResults) {
      throw new Error("expected the #hud elements and #match-results in index.html");
    }
    hudRoot.hidden = false;
    // The match clock running out and the ball dropping are different endings. This overlay is
    // the former -- combat's "time up" card -- and the Results screen is the latter. Keeping both
    // means adding the golf ending did not quietly delete the combat one.
    this.teardown.push(on(this.matchResults.playAgain, "click", () => sim.reset()));

    // Rebuilt per entry rather than per frame: GameLoop's callbacks are covered by the AGENTS.md
    // no-allocation rule just as the fixed step is.
    this.view = {
      ball: cloneBall(sim.current),
      cart: cloneCart(sim.currentCart),
      charge01: 0,
      reload01: 1,
      club: sim.cart.equippedClub,
      turretLoaded: sim.cart.ammo > 0,
      targetTransforms: new Float32Array(sim.currentTargetTransforms.length),
      targetPartCount: sim.targetPartCount,
      poolTransforms: new Float32Array(sim.currentPoolTransforms.length),
      botCarts: sim.currentBotCarts.map(cloneCart),
      elapsedSeconds: 0,
      pinStanding: sim.pinStanding,
    };
  }

  step(): void {
    const { sim } = this.options;
    if (!this.input) return;
    sim.step(this.input.sample());
    this.input.endTick();
    this.elapsedSeconds += FIXED_DT;

    this.trackLongestDrive();

    // The rest of the counters the sim writes itself. `Session` reads `sim.stats` when the hole
    // is scored, which is why nothing here has to copy or forward them.
    if (!this.reported && sim.holedOut) {
      this.reported = true;
      this.options.onHoleComplete(sim.strokes);
    }
  }

  /**
   * Image 13's LONGEST DRIVE tile. Measured rather than read from a table: distance is an
   * emergent result of the ballistics integration, and `sim/carry.ts` is explicit that it must
   * not become a second copy of `CLUB_STATS`.
   *
   * A shot is bracketed by `stats.shotsFired` ticking up (the ball has left the muzzle) and
   * `isResting()` going true again. Measured flat, in the XZ plane: a drive is a distance down
   * the hole, and counting the drop off a tee shelf as extra length would flatter downhill holes.
   *
   * The result goes to `sim.recordDrive`, not to the round. It belongs to the hole being played,
   * because that is what `Session` prices; the round's best is the fold of the holes' bests.
   */
  private trackLongestDrive(): void {
    const { sim } = this.options;
    const ball = sim.current.position;

    if (sim.stats.shotsFired !== this.lastShotCount) {
      this.lastShotCount = sim.stats.shotsFired;
      this.driveOrigin = { x: ball.x, z: ball.z };
      return;
    }
    if (this.driveOrigin === null || !sim.isResting()) return;

    const dx = ball.x - this.driveOrigin.x;
    const dz = ball.z - this.driveOrigin.z;
    sim.recordDrive(Math.hypot(dx, dz));
    this.driveOrigin = null;
  }

  draw(alpha: number): void {
    const { sim } = this.options;
    const view = this.view;
    if (!view || !this.render || !this.hud || !this.nameplates) return;

    interpolateBall(sim.previous, sim.current, alpha, view.ball);
    interpolateCart(sim.previousCart, sim.currentCart, alpha, view.cart);
    for (let i = 0; i < view.botCarts.length; i++) {
      interpolateCart(sim.previousBotCarts[i]!, sim.currentBotCarts[i]!, alpha, view.botCarts[i]!);
    }
    view.charge01 = sim.cart.charge;
    view.club = sim.cart.equippedClub;
    // Derived rather than stored, so the swing cannot drift from the reload it is animating.
    // `reloadSeconds` is the equipped club's, and a club swap deliberately does not clear the
    // reload -- so read the club here too rather than caching it.
    view.reload01 = reloadFraction(sim.cart.reloadRemaining, sim.cart.equippedClub);
    view.turretLoaded = sim.cart.ammo > 0;
    view.elapsedSeconds = this.elapsedSeconds;
    view.pinStanding = sim.pinStanding;
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

    this.render.draw(view);
    this.drawNameplates();
    this.drawPinMarker();
    drawHud(this.hud, sim);
    if (this.matchResults) {
      drawMatchResults(this.matchResults, sim);
      // Pointer-locked players (mouse aim) cannot see or reach the button -- the canvas has
      // captured and hidden the cursor -- so release the lock on the tick the overlay first
      // becomes visible rather than leaving Esc as the only undocumented way out.
      const visible = !this.matchResults.root.hidden;
      if (visible && !this.matchResultsWereVisible && document.pointerLockElement !== null) {
        document.exitPointerLock();
      }
      this.matchResultsWereVisible = visible;
    }
  }

  /** The live scene, for the dev console hook and the smoke harness. */
  get scene(): RenderScene | null {
    return this.render;
  }

  /** Renders one frame without advancing anything -- the Results screen's backdrop. */
  drawStill(): void {
    if (this.view && this.render) this.render.draw(this.view);
  }

  exit(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.options.hudRoot.hidden = true;
    // #hud-combat is a sibling of #hud, not a child, so hiding the HUD root leaves the health
    // and ammo cards lit over whatever screen comes next.
    if (this.hud) this.hud.combat.hidden = true;
    if (this.matchResults) this.matchResults.root.hidden = true;
    this.matchResults = null;
    this.input?.dispose();
    this.input = null;
    this.nameplates?.dispose();
    this.nameplates = null;
    this.pinMarker?.dispose();
    this.pinMarker = null;
    this.render?.dispose();
    this.render = null;
    this.view = null;
    this.hud = null;
  }

  /**
   * H17. The distance comes from `deriveHudState`'s own derivation rather than being recomputed
   * here, so the number on the marker and any future yardage in the HUD cannot disagree.
   */
  private drawPinMarker(): void {
    const { sim } = this.options;
    if (!this.render || !this.pinMarker) return;
    deriveHudState(sim, pinHudScratch);
    this.render.pinMarkerAnchor(pinAnchorScratch);
    const onScreen = this.render.projectPinMarker(
      pinAnchorScratch.x,
      pinAnchorScratch.y,
      pinAnchorScratch.z,
      plateScratch,
    );
    this.pinMarker.set(plateScratch.x, plateScratch.y, onScreen, pinHudScratch.pinDistanceText);
  }

  private drawNameplates(): void {
    const { sim } = this.options;
    const view = this.view;
    if (!view || !this.render || !this.nameplates) return;
    for (let i = 0; i < view.botCarts.length; i++) {
      const bot = sim.bots[i];
      if (bot === undefined) continue;
      placeNameplate(this.render, this.nameplates, i, view.botCarts[i]!, bot.health);
    }
  }
}

/** Metres above a cart's capsule centre that its plate floats. Clears the turret's club head. */
const NAMEPLATE_HEIGHT = 2.6;
const plateScratch = { x: 0, y: 0 };
/** Module-level scratch, reused per frame -- the render loop is covered by the no-allocation rule. */
const pinAnchorScratch = { x: 0, y: 0, z: 0 };
const pinHudScratch = createHudStateScratch();

/** Module-level rather than nested inside the method: a function declared inside a function body
 *  allocates a fresh closure on every call, and this one runs once per cart per frame. */
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
  plates.setPlate(index, plateScratch.x, plateScratch.y, visible, health.max > 0 ? health.hp / health.max : 0);
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

/**
 * `Cart.reloadRemaining` counts down in seconds; the renderer wants 0-at-the-shot rising to 1.
 *
 * A club with no reload left is 1, which the swing reads as "at address" -- so a cart that has
 * never fired stands with the club down the barrel rather than mid-follow-through.
 */
function reloadFraction(remainingSeconds: number, club: ClubType): number {
  const total = CLUB_STATS[club].reloadSeconds;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remainingSeconds / total));
}

function cloneBall(t: BallTransform): BallTransform {
  return { position: { ...t.position }, rotation: { ...t.rotation } };
}

function cloneCart(t: CartTransform): CartTransform {
  return { position: { ...t.position }, heading: t.heading, turretYaw: t.turretYaw };
}
