import RAPIER from "@dimforge/rapier3d-compat";

/**
 * A knockable target: eleven capsules in a standing pose, held rigid by *body type* and flipped
 * to Dynamic on impact so the joints only ever have to shape a collapse.
 *
 * Everything structural here comes from docs/DECISIONS.md "Ragdolls", which corrected an earlier
 * design that tried to hold the pose with joint stiffness/damping. Those fields are inert in the
 * JS bindings (dimforge/rapier.js#287) and spherical joints have no angular limits (#290), so:
 *
 * - Parts are `Fixed` at rest. A Fixed body cannot drift, cannot sag and costs the solver
 *   nothing, which is a better pose than any amount of joint tuning would buy.
 * - Revolute limits (knees, elbows) are set on the **created joint object**, never on JointData
 *   -- setting them on the descriptor is a silent no-op (#260).
 * - Shoulders/hips/neck/spine are spherical, accepting free twist and suppressing it with
 *   angular damping that is higher on distal limbs than proximal ones.
 * - Self-collision is off via collision groups. Neighbouring capsules always interpenetrate
 *   slightly at the joint anchor; letting them collide is the classic permanent-buzz bug.
 * - No CCD on any part -- it stays on the ball alone (AGENTS.md invariant).
 *
 * Sim-only: no rendering here, matching every prior phase's ordering.
 */

export type TargetPartName =
  | "pelvis"
  | "torso"
  | "head"
  | "upperArmL"
  | "lowerArmL"
  | "upperArmR"
  | "lowerArmR"
  | "upperLegL"
  | "lowerLegL"
  | "upperLegR"
  | "lowerLegR";

export interface TargetPart {
  readonly name: TargetPartName;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Pose position in world space, relative to the target's own origin. Restored by `reset()`. */
  readonly restOffset: { x: number; y: number; z: number };
}

/**
 * A light dummy rather than a person: heavy enough not to be flung by a hit, light enough that
 * the ~16 kg ball (BALL_RADIUS is 0.15 m here, arcade scale) reads as authoritative against it.
 * This is what keeps the ball-to-heaviest-part mass ratio inside DECISIONS.md's <= 1:20 bound
 * without touching BALL_DENSITY -- see Target.test.ts's ratio assertion.
 */
export const TARGET_DENSITY = 400;

/**
 * Post-impact velocity clamp, the second half of DECISIONS.md's "Ball mass" decision. Applied on
 * the knockdown frame and every tick afterwards while down, so a hard hit topples the rig instead
 * of launching it and a joint solve cannot accumulate its way into an explosion.
 */
export const MAX_PART_LINVEL = 8;
export const MAX_PART_ANGVEL = 12;

/**
 * Membership bit 1, filtering out that same bit: parts collide with the ground, the ball and the
 * cart, but never with each other -- including across targets, which costs nothing since two
 * ragdolls interpenetrating is not a case this course produces.
 */
const TARGET_MEMBERSHIP = 0x0002;
const TARGET_FILTER = 0xfffd;
export const TARGET_GROUPS = (TARGET_MEMBERSHIP << 16) | TARGET_FILTER;

type JointKind = "spherical" | "revolute";

interface PartSpec {
  name: TargetPartName;
  /** Capsule radius and half-height (the cylindrical half, excluding the caps). */
  radius: number;
  halfHeight: number;
  /** Pose offset from the target origin, which sits on the ground at the target's feet. */
  x: number;
  y: number;
  /** Higher on distal limbs than proximal ones, per DECISIONS.md. */
  angularDamping: number;
  parent?: TargetPartName;
  joint?: JointKind;
  /** World-space Y of the joint anchor in the rest pose. */
  jointY?: number;
  /** Revolute hinge limits, radians, applied to the created joint object. */
  limits?: readonly [number, number];
}

/**
 * Eleven capsules, the top of DECISIONS.md's 7-11 range: pelvis, torso, head, upper/lower arm x2,
 * upper/lower leg x2. Capsules over boxes -- fewer contact points, no corner snagging, no
 * tunneling at joint seams. Written as data so the construction loop stays one code path.
 */
const RIG: readonly PartSpec[] = [
  { name: "pelvis", radius: 0.14, halfHeight: 0.08, x: 0, y: 0.95, angularDamping: 2 },
  { name: "torso", radius: 0.16, halfHeight: 0.22, x: 0, y: 1.3, angularDamping: 2, parent: "pelvis", joint: "spherical", jointY: 1.05 },
  { name: "head", radius: 0.12, halfHeight: 0.05, x: 0, y: 1.68, angularDamping: 3, parent: "torso", joint: "spherical", jointY: 1.55 },

  { name: "upperArmL", radius: 0.07, halfHeight: 0.13, x: 0.26, y: 1.35, angularDamping: 4, parent: "torso", joint: "spherical", jointY: 1.5 },
  { name: "lowerArmL", radius: 0.06, halfHeight: 0.12, x: 0.26, y: 1.05, angularDamping: 6, parent: "upperArmL", joint: "revolute", jointY: 1.2, limits: [0, 2.4] },
  { name: "upperArmR", radius: 0.07, halfHeight: 0.13, x: -0.26, y: 1.35, angularDamping: 4, parent: "torso", joint: "spherical", jointY: 1.5 },
  { name: "lowerArmR", radius: 0.06, halfHeight: 0.12, x: -0.26, y: 1.05, angularDamping: 6, parent: "upperArmR", joint: "revolute", jointY: 1.2, limits: [0, 2.4] },

  { name: "upperLegL", radius: 0.09, halfHeight: 0.17, x: 0.11, y: 0.7, angularDamping: 4, parent: "pelvis", joint: "spherical", jointY: 0.9 },
  { name: "lowerLegL", radius: 0.08, halfHeight: 0.17, x: 0.11, y: 0.3, angularDamping: 6, parent: "upperLegL", joint: "revolute", jointY: 0.5, limits: [-2.4, 0] },
  { name: "upperLegR", radius: 0.09, halfHeight: 0.17, x: -0.11, y: 0.7, angularDamping: 4, parent: "pelvis", joint: "spherical", jointY: 0.9 },
  { name: "lowerLegR", radius: 0.08, halfHeight: 0.17, x: -0.11, y: 0.3, angularDamping: 6, parent: "upperLegR", joint: "revolute", jointY: 0.5, limits: [-2.4, 0] },
] as const;

/** Knees and elbows hinge in the sagittal plane, so the axis runs across the body (world X). */
const HINGE_AXIS = { x: 1, y: 0, z: 0 };

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

export class Target {
  readonly parts: TargetPart[] = [];
  /** True once a hit has flipped the rig to Dynamic. Stays true until `reset()` (a new hole). */
  isDown = false;

  private readonly world: RAPIER.World;
  private readonly origin: { x: number; y: number; z: number };
  private readonly byName = new Map<TargetPartName, TargetPart>();
  private readonly joints: RAPIER.ImpulseJoint[] = [];
  /** Reused per-tick scratch, per the AGENTS.md no-allocation-in-the-hot-loop rule. */
  private readonly clampScratch = { x: 0, y: 0, z: 0 };

  constructor(world: RAPIER.World, origin: { x: number; y: number; z: number }) {
    this.world = world;
    this.origin = { ...origin };

    for (const spec of RIG) {
      const restOffset = { x: spec.x, y: spec.y, z: 0 };
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(origin.x + restOffset.x, origin.y + restOffset.y, origin.z)
          .setAngularDamping(spec.angularDamping),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(spec.halfHeight, spec.radius)
          .setDensity(TARGET_DENSITY)
          .setFriction(0.9)
          .setRestitution(0.05)
          .setCollisionGroups(TARGET_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );

      const part: TargetPart = { name: spec.name, body, collider, restOffset };
      this.parts.push(part);
      this.byName.set(spec.name, part);
    }

    for (const spec of RIG) {
      if (!spec.parent || !spec.joint || spec.jointY === undefined) continue;
      const child = this.part(spec.name);
      const parent = this.part(spec.parent);
      const parentSpec = RIG.find((s) => s.name === spec.parent)!;

      // Anchors are the same world point expressed in each body's local frame. Every body is
      // axis-aligned in the rest pose, so this is a plain subtraction -- and the shoulder/hip
      // anchors are offset sideways from the parent, hence the X term.
      const anchor1 = { x: spec.x - parentSpec.x, y: spec.jointY - parentSpec.y, z: 0 };
      const anchor2 = { x: 0, y: spec.jointY - spec.y, z: 0 };

      const data =
        spec.joint === "spherical"
          ? RAPIER.JointData.spherical(anchor1, anchor2)
          : RAPIER.JointData.revolute(anchor1, anchor2, HINGE_AXIS);
      const joint = world.createImpulseJoint(data, parent.body, child.body, true);

      // Limits go on the created joint, never on JointData -- dimforge/rapier.js#260.
      if (spec.joint === "revolute" && spec.limits) {
        (joint as RAPIER.RevoluteImpulseJoint).setLimits(spec.limits[0], spec.limits[1]);
      }
      this.joints.push(joint);
    }
  }

  part(name: TargetPartName): TargetPart {
    const part = this.byName.get(name);
    if (!part) throw new Error(`Target has no part named ${name}`);
    return part;
  }

  /**
   * Flips the *whole* rig to Dynamic and shoves the struck part.
   *
   * Every part goes dynamic, not just the one that was hit: a joint anchored to a still-Fixed
   * neighbour pins the ragdoll in mid-air instead of shaping a collapse, so a partial flip is a
   * broken collapse rather than a cheaper one.
   *
   * The impulse is scripted by combat.ts from the ball's impact speed rather than left to the
   * solver, because the contact that generated the event was resolved against a Fixed body on
   * that same tick. This is exactly the controllable path DECISIONS.md "Ball mass" names as the
   * fallback, and it cannot explode.
   */
  knockDown(part: TargetPart, impulse: { x: number; y: number; z: number }): void {
    if (!this.isDown) {
      this.isDown = true;
      for (const p of this.parts) p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    part.body.applyImpulse(impulse, true);
    this.step();
  }

  /** Re-applies the velocity clamp. Cheap no-op while the target is still standing. */
  step(): void {
    if (!this.isDown) return;
    for (const p of this.parts) {
      this.clamp(p.body.linvel(), MAX_PART_LINVEL, (v) => p.body.setLinvel(v, false));
      this.clamp(p.body.angvel(), MAX_PART_ANGVEL, (v) => p.body.setAngvel(v, false));
    }
  }

  private clamp(
    v: { x: number; y: number; z: number },
    max: number,
    apply: (v: { x: number; y: number; z: number }) => void,
  ): void {
    const magnitude = Math.hypot(v.x, v.y, v.z);
    if (magnitude <= max) return;
    const scale = max / magnitude;
    const out = this.clampScratch;
    out.x = v.x * scale;
    out.y = v.y * scale;
    out.z = v.z * scale;
    apply(out);
  }

  /** Back to the held pose. Called by Sim.reset(), i.e. once per new hole -- targets do not
   * stand back up on their own (spec §1's explicit out-of-scope list). */
  reset(): void {
    for (const p of this.parts) {
      p.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      p.body.setTranslation(
        {
          x: this.origin.x + p.restOffset.x,
          y: this.origin.y + p.restOffset.y,
          z: this.origin.z + p.restOffset.z,
        },
        false,
      );
      p.body.setRotation(IDENTITY_ROTATION, false);
      p.body.setLinvel(ZERO, false);
      p.body.setAngvel(ZERO, false);
    }
    this.isDown = false;
  }

  /** Removes every body and joint this target created, per AGENTS.md's resource-cleanup rule. */
  dispose(): void {
    for (const joint of this.joints) this.world.removeImpulseJoint(joint, false);
    this.joints.length = 0;
    for (const p of this.parts) this.world.removeRigidBody(p.body);
    this.parts.length = 0;
    this.byName.clear();
  }
}
