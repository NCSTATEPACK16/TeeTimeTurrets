/** Physics constants. The fixed step is a project rule (CLAUDE.md): 60 Hz. */
export const physicsConfig = {
  gravity: -9.81,
  fixedHz: 60,
  /** Most physics steps run in one rendered frame before the loop drops time. */
  maxSubsteps: 5,
  /** Friction and bounce for chassis-to-ground contacts (wheels use the vehicle's own model). */
  groundFriction: 0.8,
  groundRestitution: 0,
  /** Invisible walls just outside the course grid (physics/boundaryColliders.ts). */
  boundary: {
    /** Wall thickness in meters. */
    thickness: 2,
    /** How far the walls reach above the highest terrain node, meters. */
    wallHeight: 3,
    /** How far they reach below the lowest node, meters. */
    below: 5,
    /** Low friction so the cart slides along a wall instead of sticking to it. */
    friction: 0.1,
    restitution: 0,
  },
} as const;

export const FIXED_DT = 1 / physicsConfig.fixedHz;
