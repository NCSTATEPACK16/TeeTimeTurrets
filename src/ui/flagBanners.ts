import type { SimEventKind } from "../sim/events";

/**
 * The H12 banner for a capture-flag event (Stage 3.5c), seen from the player's side, team 0.
 * DOM-free, like `streaks.ts`; `MatchScreen` pushes what this returns through `BannerFeed`.
 *
 * A bleed stroke is deliberately not a banner. It lands every 20 s while a side holds two flags,
 * and a banner that often is noise: the HUD's bleed timer and a clap carry it instead. Nor is an
 * enemy flag going neutral, which is good news the flag row already shows.
 */

export const FLAG_LETTERS: readonly string[] = ["A", "B", "C"];

const PLAYER_TEAM = 0;

export interface FlagBanner {
  readonly headline: string;
  readonly consequence: string;
}

/**
 * `flag` and `team` are the event's `target` and `amount`. `held` counts each side's flags now,
 * which is what decides whether the capture started a bleed.
 */
export function flagBanner(
  kind: SimEventKind,
  flag: number,
  team: number,
  held: { readonly us: number; readonly them: number },
): FlagBanner | null {
  const letter = FLAG_LETTERS[flag] ?? "?";
  if (kind === "flagCaptured") {
    if (team === PLAYER_TEAM) {
      return {
        headline: `FLAG ${letter} TAKEN`,
        consequence: held.us >= 2 ? "THEY BLEED A STROKE EVERY 20 S" : "HOLD TWO TO MAKE THEM BLEED",
      };
    }
    return {
      headline: `THEY TOOK FLAG ${letter}`,
      consequence: held.them >= 2 ? "WE BLEED A STROKE EVERY 20 S" : "DON'T LET THEM HOLD TWO",
    };
  }
  if (kind === "flagNeutral" && team === PLAYER_TEAM) {
    return { headline: `WE LOST FLAG ${letter}`, consequence: "TAKE IT BACK" };
  }
  return null;
}
