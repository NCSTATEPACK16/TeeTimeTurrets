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

/**
 * Free drive's paint choices (Choose Your Ride's swatch row, `&paint=` on the free-drive URL): a
 * canopy and the rider's matching shirt. The two team pairs, then pine, sun and clay from Clubhouse
 * Sunset (`src/ui/title/title.css`), each with a darker shirt. Pure data with no imports, because
 * free drive (`drive/`) imports this file too.
 */
export interface Paint {
  readonly id: string;
  readonly name: string;
  readonly canopy: number;
  readonly shirt: number;
}

export const PAINTS: readonly Paint[] = [
  { id: "blue", name: "Blue", canopy: TEAM_CANOPY[0], shirt: TEAM_SHIRT[0] },
  { id: "orange", name: "Orange", canopy: TEAM_CANOPY[1], shirt: TEAM_SHIRT[1] },
  { id: "pine", name: "Pine", canopy: 0x1e4d2b, shirt: 0x163a20 },
  { id: "sun", name: "Sun", canopy: 0xf6c343, shirt: 0xc99a2a },
  { id: "clay", name: "Clay", canopy: 0xc84b31, shirt: 0x9c3825 },
];

/** Six-digit lower-case hex, no `#`: how a paint travels in a URL. */
export function paintHex(color: number): string {
  return color.toString(16).padStart(6, "0");
}

/** The paint whose canopy is this hex, or null for anything not in the table. */
export function paintFromHex(hex: string | null | undefined): Paint | null {
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const color = parseInt(hex, 16);
  return PAINTS.find((p) => p.canopy === color) ?? null;
}
