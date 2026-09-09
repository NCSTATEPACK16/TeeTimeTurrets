/**
 * The pin's shape and its two states.
 *
 * The shape lives in the sim rather than only in the renderer for the same reason
 * `CART_COLLIDER` and `TURRET_GEOMETRY` do: `world.ts` builds a collider from it and
 * `src/entities/Flagstick.ts` draws to match. One set of numbers, so a fattened drawn pole
 * cannot quietly disagree with what a putt actually deflects off.
 *
 * A true leaf beyond the sim's own types: no Rapier, no three, no DOM.
 */

/**
 * Pole radius and total height, metres.
 *
 * **The radius is load-bearing arithmetic, not taste.** `isInCup` holes the ball when its centre
 * is within `CUP_RADIUS` (0.55) of the cup centre; a pin of radius r standing at that centre keeps
 * the ball's centre at least `r + BALL_RADIUS` (0.15) away from it. So holing out with the pin in
 * is possible only while
 *
 *     r + 0.15 < 0.55   i.e.   r < 0.40
 *
 * That inequality is why `isInCup` needs no exception for the standing pin and gains none: the
 * geometry cannot produce the failure an exception would have guarded. At 0.025 the margin is
 * thirteenfold. **Fatten this past 0.40 and holing out becomes impossible with the pin standing,
 * with no test naming the reason** -- which is why `world.props.test.ts` raises it past 0.40 on
 * purpose and watches the hole-out assertion break.
 *
 * The height is read against the cart, not against `prop-silhouettes-01.jpg`: that sheet scales
 * every prop to its own cell, so it gives proportion within a prop and never scale between two.
 * A real flagstick is a shade over 2.1 m and the cart's canopy is at 2.05 m, so a true-scale pin
 * reads as a pin from beside the green and is genuinely small from the tee -- which is what H17,
 * the pin marker, exists to solve.
 */
export const PIN_SHAPE = {
  radius: 0.025,
  height: 2.1,
  /** Collider centre above the cup: a Rapier cylinder is centre-anchored, the mesh is not. */
  get halfHeight(): number {
    return this.height / 2;
  },
} as const;

/**
 * Standing or felled, and nothing else.
 *
 * The collider handle is deliberately not here: `world.ts` owns every Rapier resource and the
 * removal path with it (`AGENTS.md`). This is the state the renderer reads and the state
 * `loadHole` resets, kept apart from the body so neither can be changed without the other being
 * visible in the diff.
 */
export class Pin {
  /**
   * True while the pin is up. A felled pin has no collider, so it deflects nothing and a cart can
   * drive over the cup -- which is the price of knocking it down rather than a side effect.
   */
  standing = true;

  /** Felled by a struck ball or by a cart. Idempotent: two contacts in one tick fell it once. */
  fell(): boolean {
    if (!this.standing) return false;
    this.standing = false;
    return true;
  }

  /**
   * Stood back up. Called by `loadHole` and nothing else: a felled pin stays down for the hole,
   * which is the only version of the mechanic that cannot be farmed for a clear putting line.
   */
  stand(): void {
    this.standing = true;
  }
}
