/**
 * What a player's actions are worth in points. Stage 2 uses these for the hit markers; Stage 8's
 * scoreboard, coins and XP (docs/REVAMP-PLAN.md) build on the same numbers, so a marker never
 * promises more than the results screen pays.
 */

/** Points per health point of damage a player's shot or ram takes off an enemy. */
export const SCORE_PER_DAMAGE = 10;

/** Points for a kill. */
export const SCORE_PER_KILL = 100;
