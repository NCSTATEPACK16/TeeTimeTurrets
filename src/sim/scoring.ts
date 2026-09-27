/**
 * What a match is worth, per `docs/REVAMP-PLAN.md` Stage 8. The per-event values live here from
 * Stage 2 on, because a hit marker shows them: a `+10` floating over a cart and the score on the
 * results screen must be one number, not two copies that can drift.
 */

/** Points for each point of health a player's shot takes off an enemy. */
export const POINTS_PER_DAMAGE = 10;
/** Points for a kill. */
export const POINTS_PER_KILL = 100;
