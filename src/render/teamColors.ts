/**
 * Team colours for 4v4 (`docs/art/specs/cart-v2.md`). Team 0 is the player's (cart index 0, and
 * `teamOf` in `src/sim/matchConfig.ts` alternates), so friendly is always blue.
 *
 * They go on surfaces no loadout cosmetic touches: the cart's `canopy` slot and the rider's
 * `shirt`. Chassis paint and turret skin stay things a player buys. The barns' `team_trim` uses
 * the canopy colour so a spawn's garage matches its carts.
 */
export const TEAM_CANOPY: readonly [number, number] = [0x2f7be0, 0xf07a1a];
export const TEAM_SHIRT: readonly [number, number] = [0x2560b8, 0xc85f12];

/** The index-safe lookup: an out-of-range team falls back to team 0 rather than `undefined`. */
export function teamColors(team: number): { canopy: number; shirt: number } {
  const t = team === 1 ? 1 : 0;
  return { canopy: TEAM_CANOPY[t], shirt: TEAM_SHIRT[t] };
}
