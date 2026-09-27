import { POINTS_PER_DAMAGE, POINTS_PER_KILL } from "../sim/scoring";

/** What a hit marker is marking: the player's ball connecting, or a cart the player killed. */
export type HitMarkerKind = "hit" | "kill";

export interface MarkerText {
  readonly label: string;
  /** A CSS modifier class, so a kill can read differently from a plain hit. */
  readonly variant: string;
}

/**
 * The marker for one of the player's hits or kills: the points it scored, from `sim/scoring.ts`.
 * It used to be a fixed "+50" whatever happened, which told the player nothing about the club.
 */
export function hitMarkerText(kind: HitMarkerKind, damage: number): MarkerText {
  if (kind === "kill") return { label: `+${POINTS_PER_KILL} ENEMY DOWN`, variant: "hit-marker--kill" };
  return { label: `+${POINTS_PER_DAMAGE * damage}`, variant: "hit-marker--hit" };
}
