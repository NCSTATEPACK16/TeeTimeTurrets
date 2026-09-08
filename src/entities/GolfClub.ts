import * as THREE from "three";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { CART_COLLIDER } from "../sim/entities/Cart";
import { CART_GRAPH } from "./cartGraph";
import { DRIVER_GRAPH } from "./driverGraph";
import { buildGraph } from "./primitiveGraph";
import type { BuiltGraph, SlotColors } from "./primitiveGraph";
import { BALL_RADIUS } from "./BallSwarm";

/**
 * The hero cart: chassis, canopy, a rider at the wheel, and a turret bolted to the roof whose
 * barrel *is* a golf club -- a shaft with the club head as the muzzle. Built to concept images 01
 * (form language), 03 (chase cam) and 04 (recoil launch).
 *
 * The geometry is not written here. It is authored in Blender and exported as parameter graphs
 * (`graphs/cart.json` and `graphs/driver.json`, `ASSET_PIPELINE.md` section 4), and this class
 * does what it always did: pose them. No mesh data crosses the line, so `AGENTS.md`'s
 * procedural-primitives rule is intact.
 *
 * Render-facing only: it owns no Rapier body and no authoritative state. Every frame it is handed
 * a snapshot from `sim/entities/Cart.ts` and poses itself to match.
 *
 * The barrel's elevation is the equipped club's own `loftDeg`, and the muzzle sits at
 * `TURRET_GEOMETRY.barrelLength` along it. Both come from the sim so the club head the player
 * sees is exactly where `computeMuzzle` says the ball leaves from -- there is one set of numbers,
 * not a visual copy that can drift out of step with the ballistics. `cartGraph.test.ts` asserts
 * the exported graph still agrees with them.
 */

/** Node names the pose code addresses. The graph is generated, so a rename in Blender has to
 *  surface as a loud failure here rather than a cart that silently stops aiming. */
const TURRET_PIVOT = "turret_pivot";
const BARREL_PITCH = "barrel_pitch";
const SWING_ARM = "swing_arm";
const HOUSING_PITCH = "housing_pitch";
const HEAD_SLOT = "head_slot";

const HEAD_NODES: Readonly<Record<ClubType, string>> = {
  [ClubType.Putter]: "head_putter",
  [ClubType.Iron]: "head_iron",
  [ClubType.Driver]: "head_driver",
};

/**
 * The swing, in seconds and radians rather than in fractions of a reload.
 *
 * Seconds because a swing is a swing: the putter reloads in 0.4 s and the driver in 2.2 s, so a
 * fixed *fraction* of the reload would make the driver's swing five times the slower of the two,
 * which reads as the heavy club being wielded by someone underwater. Charging is what takes
 * longer with a driver; swinging is not.
 */
export const SWING = {
  /**
   * Backswing travel at full charge, 100 degrees, which is what `swing-sequence-01.jpg` draws.
   * Not the ~200 of a real golf swing, because address here is a raised gun barrel rather than a
   * club head at a ball on the ground: 200 from this start buries the club behind and below the
   * cart, where the chase camera is.
   */
  backswingRadians: 1.75,
  /**
   * How far past impact the club carries through before it settles back to address.
   *
   * Capped by the cart, not by taste, and the cap is tighter than it looks. The binding club is
   * the **putter**, not the driver: it addresses at 3 degrees of loft rather than 13, so for the
   * same rotation of `swing_arm` its head is 10 degrees further below horizontal and it reaches
   * the roof first. At the shipped pivot the shaft touches the canopy's front edge at 0.71 rad;
   * 0.65 leaves 4.7 cm of daylight at the closest point of the whole swing, on every club.
   *
   * Paired with the 0.25 tilt authored on `swing_yoke` in Blender and with
   * `TURRET_GEOMETRY.pivotHeight`/`pivotForward` -- change any one and re-run the clearance test
   * in `GolfClub.test.ts`, which is what measured this.
   */
  followThroughRadians: 0.65,
  /**
   * How much of the swing the housing takes up on its trunnion, as a fraction of the club's own
   * angle. `swing-sequence-01.jpg` tips the whole housing back into the backswing rather than
   * swinging a club inside a housing that stays put, and that is what makes the mechanism legible
   * at a glance.
   *
   * Cosmetic by construction: `housing_pitch` is a *sibling* of `barrel_pitch` in the graph, so
   * no value here can move the muzzle. `GolfClub.test.ts` holds that.
   */
  housingShare: 0.35,
  /** Top of the backswing down to impact. Short on purpose: see `swingAngle`. */
  downswingSeconds: 0.09,
  followThroughSeconds: 0.22,
  /** Even an uncharged tap swings this much, so a shot is never a club that does not move. */
  minBackswing: 0.25,
} as const;

/**
 * The swing angle for one frame, in radians about `swing_arm`'s local X.
 *
 * Pure, and separated from the class so the frame that matters can be asserted directly:
 * **at impact this returns exactly 0**, which is what puts the club head back on the barrel axis
 * where `computeMuzzle` says the ball originates.
 *
 * Negative winds the club up and back over the turret; positive carries it down and through.
 *
 * One artifact is deliberate and worth knowing. The sim fires on the *release* edge, so the ball
 * leaves at `reload01 = 0` -- the top of the backswing -- and the downswing plays over the ball's
 * first ~0.09 s of flight. At roughly five frames, and with the ball 3 m out by the time the club
 * reaches impact, it reads as "just struck" from the 6.5 m chase camera. Making it literally true
 * would mean delaying `Cart.fire` by `downswingSeconds`, which buys accuracy with input latency
 * on every shot; the controls were asked to stay as they are. `downswingSeconds` is the one knob
 * a play session should turn if this reads wrong.
 */
export function swingAngle(
  charge01: number,
  reload01: number,
  reloadSeconds: number,
  chargeAtRelease01: number,
): number {
  if (charge01 > 0) return -SWING.backswingRadians * backswingScale(charge01);
  if (reload01 >= 1) return 0;

  const top = -SWING.backswingRadians * backswingScale(chargeAtRelease01);
  const impact = Math.min(SWING.downswingSeconds / reloadSeconds, 0.5);
  const settled = Math.min((SWING.downswingSeconds + SWING.followThroughSeconds) / reloadSeconds, 1);

  if (reload01 < impact) {
    // Accelerating into the ball rather than easing into it: `1 - t^2` is fast at the start of
    // the window and slowest as it arrives, which is the wrong way round for a swing, so the
    // curve is squared on the remaining travel instead.
    const t = reload01 / impact;
    return top * (1 - t) * (1 - t);
  }
  if (reload01 < settled) {
    // Out past impact, over the top of the follow-through and back to address in one arc.
    const t = (reload01 - impact) / Math.max(settled - impact, 1e-6);
    return SWING.followThroughRadians * Math.sin(t * Math.PI);
  }
  return 0;
}

function backswingScale(charge01: number): number {
  const c = clamp01(charge01);
  return SWING.minBackswing + (1 - SWING.minBackswing) * c;
}

export interface GolfClubOptions {
  /** A seated rider at the wheel. Off for a cart that is scenery rather than somebody's. */
  rider?: boolean;
}

export class GolfClub extends THREE.Group {
  private readonly graph: BuiltGraph;
  private readonly rider: BuiltGraph | null;
  private readonly turretPivot: THREE.Object3D;
  /** Pitches the barrel to the equipped club's loft. Separate from the yaw pivot above it. */
  private readonly barrelPitch: THREE.Object3D;
  /**
   * Swings the club through the shot. Sits *below* `barrelPitch`, and below the tilted
   * `swing_yoke` that gives the swing its plane, so a swing angle of zero is a no-op on where the
   * muzzle points. That ordering is the whole reason the animation is safe to add.
   */
  private readonly swingArm: THREE.Object3D;
  /**
   * The turret housing, tipping back on its trunnion as the club goes up. A *sibling* of
   * `barrelPitch`, not an ancestor of it, which is what makes it safe: it is drawn by the swing
   * and cannot be read by it.
   */
  private readonly housingPitch: THREE.Object3D;
  private readonly heads: Readonly<Record<ClubType, THREE.Object3D>>;
  private readonly loadedBall: THREE.Mesh;
  private readonly ballGeometry: THREE.SphereGeometry;
  private readonly ballMaterial: THREE.MeshStandardMaterial;
  private equippedClub: ClubType;
  /**
   * How hard the last shot was hit. The sim clears `charge` the instant it fires, so the
   * downswing has nothing left to tell it how far back the club had been taken -- that is
   * animation state, and it lives here rather than being added to `Cart` for the renderer's sake.
   */
  private chargeAtRelease = 0;

  constructor(
    initialClub: ClubType = ClubType.Driver,
    slotColors: SlotColors = {},
    options: GolfClubOptions = {},
  ) {
    super();
    this.equippedClub = initialClub;

    this.graph = buildGraph(CART_GRAPH, slotColors);
    this.add(this.graph.root);

    // The rider is his own graph with his own four material slots, so a chassis repaint cannot
    // reach his trousers and `cartGraph.test.ts`'s exact-eight-slots assertion still holds.
    this.rider = options.rider === false ? null : buildGraph(DRIVER_GRAPH);
    if (this.rider) this.add(this.rider.root);

    this.turretPivot = this.requireNode(TURRET_PIVOT);
    this.barrelPitch = this.requireNode(BARREL_PITCH);
    this.swingArm = this.requireNode(SWING_ARM);
    this.housingPitch = this.requireNode(HOUSING_PITCH);
    this.heads = {
      [ClubType.Putter]: this.requireNode(HEAD_NODES[ClubType.Putter]),
      [ClubType.Iron]: this.requireNode(HEAD_NODES[ClubType.Iron]),
      [ClubType.Driver]: this.requireNode(HEAD_NODES[ClubType.Driver]),
    };

    // All three heads ship in the graph and only the equipped one is drawn. Toggling `visible`
    // rather than rebuilding geometry matters because `main.ts` assigns the club every frame:
    // the old build-and-dispose path made a club swap a geometry churn.
    this.showOnly(initialClub);

    this.ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
    this.ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    this.loadedBall = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
    this.loadedBall.position.set(0, 0.22, 0.04);
    this.loadedBall.visible = false;
    // Not part of the graph: the round riding the club head is transient state, not cart geometry.
    this.requireNode(HEAD_SLOT).add(this.loadedBall);

    this.applyLoft(initialClub);
  }

  /** Swap the visible club head. Stats live in physics/Ballistics.ts; this only changes the look. */
  setClub(club: ClubType): void {
    if (club === this.equippedClub) return;
    this.equippedClub = club;
    this.showOnly(club);
    this.applyLoft(club);
  }

  /** yawRadians: turret rotation relative to the chassis, matching a tank turret. */
  setAimYaw(yawRadians: number): void {
    this.turretPivot.rotation.y = yawRadians;
  }

  /**
   * Pose the swing from the two numbers the sim already publishes.
   *
   * `charge01` in [0,1] is the shot winding up; `reload01` in [0,1] is how far through the
   * reload the cart is, so 0 is the frame the shot went off and 1 is ready to fire again.
   * Together they cover the whole cycle -- backswing, downswing, follow-through, address --
   * with no new state in `Cart` and nothing for a render frame to get out of step with.
   */
  setSwing(charge01: number, reload01: number): void {
    if (charge01 > 0) this.chargeAtRelease = clamp01(charge01);
    const reloadSeconds = CLUB_STATS[this.equippedClub].reloadSeconds;
    const angle = swingAngle(charge01, reload01, reloadSeconds, this.chargeAtRelease);
    this.swingArm.rotation.x = angle;
    this.housingPitch.rotation.x = angle * SWING.housingShare;
  }

  /** Shows the ball riding on the club head, ready to be fired. */
  setBallLoaded(loaded: boolean): void {
    this.loadedBall.visible = loaded;
  }

  /**
   * Repaints one material slot. A slot's material is shared by every part using it, so this is a
   * single colour write and not a tree walk -- which is what lets the clubhouse preview a paint
   * live while the turntable spins. The rider's slots are deliberately not reachable: they share
   * no names with the cart's eight.
   */
  setSlotColor(slot: string, color: number): void {
    this.graph.setSlotColor(slot, color);
  }

  /** Applies a whole cosmetic at once. Slots the graph does not declare are ignored. */
  setSlotColors(colors: SlotColors): void {
    for (const [slot, color] of Object.entries(colors)) this.graph.setSlotColor(slot, color);
  }

  /** Call once before this instance is discarded: frees geometries/materials, per AGENTS.md. */
  dispose(): void {
    this.graph.dispose();
    this.rider?.dispose();
    this.ballGeometry.dispose();
    this.ballMaterial.dispose();
  }

  private requireNode(name: string): THREE.Object3D {
    const node = this.graph.named.get(name);
    if (!node) {
      throw new Error(
        `cart graph is missing the node "${name}" the renderer poses. Re-export from Blender with ` +
          `that object present, or update GolfClub.ts if it was deliberately renamed.`,
      );
    }
    return node;
  }

  private showOnly(club: ClubType): void {
    for (const type of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
      this.heads[type].visible = type === club;
    }
  }

  /**
   * Negative X-rotation lifts a +Z-facing barrel, so the putter lies nearly flat at 3 deg and the
   * iron cocks up at 22 deg. The player can read the club from across the fairway.
   */
  private applyLoft(club: ClubType): void {
    this.barrelPitch.rotation.x = -((CLUB_STATS[club].loftDeg * Math.PI) / 180);
  }
}

/**
 * Puts a cart model where the simulation says its cart is.
 *
 * Sim yaw and Three yaw are different conventions and the conversion is easy to get subtly
 * wrong. Sim yaw 0 points down world +X; a Three object with `rotation.y = t` points its local
 * +Z (the cart's forward) at world (sin t, 0, cos t). Setting those equal gives t = PI/2 - yaw.
 * The turret pivot is a *child* of the cart group, so its local rotation is the difference of the
 * two converted angles, which simplifies to (heading - turretYaw).
 *
 * It lives here rather than inside `RenderScene` for one reason: it is half of the muzzle
 * agreement. `computeMuzzle` says in world coordinates where a shot leaves; this says in world
 * coordinates where the club head is drawn. A test that copied these three lines would agree with
 * its own copy rather than with the renderer, and the 0.26 m defect this file used to carry is
 * exactly what that kind of test fails to see.
 */
export function placeCart(
  model: GolfClub,
  position: { x: number; y: number; z: number },
  heading: number,
  turretYaw: number,
): void {
  // The sim's cart position is the capsule centre; the model's origin is at ground level.
  model.position.set(position.x, position.y - CART_COLLIDER.groundOffset, position.z);
  model.rotation.y = Math.PI / 2 - heading;
  model.setAimYaw(heading - turretYaw);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
