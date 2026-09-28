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

/**
 * How many pooled balls exist: the size of the render's ball buffers as much as the pool's. Here,
 * beside the radius, because the render side needs it and `BallPool.ts` imports Rapier -- taking it
 * from there pulled Rapier into every chunk that draws a ball. `BallPool.ts` re-exports it.
 */
export const POOL_SIZE = 32;
