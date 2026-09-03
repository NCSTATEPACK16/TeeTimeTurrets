/**
 * Ball collider radius: the one authoritative source. Sim shapes the physics, render draws to
 * match it -- not the other way around, same rule TURRET_GEOMETRY (Cart.ts) and
 * TARGET_PART_SHAPES (Target.ts) already follow. world.ts's course-ball collider and
 * BallPool.ts's pooled-ball colliders both read this; src/entities/BallSwarm.ts re-exports it
 * for the render side (src/render/scene.ts, src/entities/GolfClub.ts,
 * tools/gate/gateScene.ts).
 *
 * A true leaf: no imports, so nothing importing this can create a cycle.
 */
export const BALL_RADIUS = 0.15;
