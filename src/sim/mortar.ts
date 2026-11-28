/**
 * The Mulligan Mortar (Stage 3.5c): a killstreak reward that drops six balls on a point after a
 * telegraph. `docs/superpowers/specs/2026-11-27-mortar-and-capture-flags-design.md` §3 is the
 * rulebook; `world.ts` runs it, since the balls are pooled bodies in its Rapier world.
 *
 * This module holds the numbers and the barrage slots, and nothing that needs a physics world, so
 * the arithmetic can be read and tested on its own. DOM-free; allocation-free after construction.
 */

/** Kills in a streak that earn a mortar: one at 3, 6, 9... while none is held. */
export const MORTAR_STREAK = 3;
export const MORTAR_BALLS = 6;
/** Seconds from the call to the first ball's touchdown: the warning everyone gets. */
export const MORTAR_TELEGRAPH_S = 2;
/** Seconds between balls, so the barrage lasts a second. */
export const MORTAR_BALL_GAP_S = 0.2;
/** Each ball lands uniformly inside a disc this wide round the target. The ring drawn is this. */
export const MORTAR_SPREAD_M = 8;
/** The furthest from its caller a mortar lands. A longer aim lands here on the same bearing. */
export const MORTAR_MAX_RANGE_M = 160;
/** A ball appears this far above its impact point, falling at `MORTAR_DROP_SPEED`. */
export const MORTAR_DROP_HEIGHT_M = 40;
export const MORTAR_DROP_SPEED = 20;
/** A direct hit: the driver's damage. */
export const MORTAR_BALL_DAMAGE = 2;
/** On its first touchdown, a ball costs every enemy this close (in x and z) this much. */
export const MORTAR_SPLASH_M = 3;
export const MORTAR_SPLASH_DAMAGE = 1;
/** Barrages in the air at once. Each needs its own 3-kill streak, so a 4v4 cannot fill these. */
export const MAX_BARRAGES = 4;
/**
 * `hashChannel(seed, MORTAR_CHANNEL)` seeds the spread. Channels in use: `BOT_CHANNEL` 3,
 * `SPAWN_CHANNEL` 4, `BOT_SKILL_CHANNEL` 5.
 */
export const MORTAR_CHANNEL = 6;

const TICKS_PER_S = 60;
const DT = 1 / TICKS_PER_S;
/** The pooled ball's, as `BallPool.ts` and `world.ts`'s preview use. */
const GRAVITY = 9.81;
const LINEAR_DAMPING = 0.05;

export const MORTAR_TELEGRAPH_TICKS = MORTAR_TELEGRAPH_S * TICKS_PER_S;
export const MORTAR_BALL_GAP_TICKS = Math.round(MORTAR_BALL_GAP_S * TICKS_PER_S);

/**
 * Ticks a ball takes to fall `MORTAR_DROP_HEIGHT_M` from `MORTAR_DROP_SPEED`, integrated the way
 * Rapier moves the real ball (gravity, then damping, then the step: the order `previewTrajectory`
 * mirrors) rather than from the closed-form fall, which ignores damping and would land late.
 */
export const MORTAR_DROP_TICKS = ((): number => {
  const damp = 1 / (1 + LINEAR_DAMPING * DT);
  let vy = -MORTAR_DROP_SPEED;
  let fallen = 0;
  let ticks = 0;
  while (fallen < MORTAR_DROP_HEIGHT_M) {
    vy -= GRAVITY * DT;
    vy *= damp;
    fallen -= vy * DT;
    ticks++;
  }
  return ticks;
})();

/** One mortar in the air: where its six balls come down, and how many have been dropped. */
export class Barrage {
  active = false;
  owner = -1;
  callTick = 0;
  /** Balls dropped so far. */
  spawned = 0;
  /** Impact points, x and z interleaved, for `MORTAR_BALLS` balls. */
  readonly impacts = new Float64Array(MORTAR_BALLS * 2);
  /** Where the barrage was aimed: the centre of the ring. */
  targetX = 0;
  targetZ = 0;

  /** The tick ball `i` must be dropped on so it touches down on schedule. */
  dropTick(i: number): number {
    return this.callTick + MORTAR_TELEGRAPH_TICKS + i * MORTAR_BALL_GAP_TICKS - MORTAR_DROP_TICKS;
  }

  /**
   * Starts this slot: the target, and the six impact points drawn now from `random`, two draws per
   * ball (radius as the square root of a uniform, so the disc is filled evenly, then the angle).
   */
  start(owner: number, callTick: number, x: number, z: number, random: () => number): void {
    this.active = true;
    this.owner = owner;
    this.callTick = callTick;
    this.spawned = 0;
    this.targetX = x;
    this.targetZ = z;
    for (let i = 0; i < MORTAR_BALLS; i++) {
      const r = MORTAR_SPREAD_M * Math.sqrt(random());
      const a = random() * Math.PI * 2;
      this.impacts[i * 2] = x + r * Math.cos(a);
      this.impacts[i * 2 + 1] = z + r * Math.sin(a);
    }
  }

  clear(): void {
    this.active = false;
    this.owner = -1;
    this.spawned = 0;
  }
}
