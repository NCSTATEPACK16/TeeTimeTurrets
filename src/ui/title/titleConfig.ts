/**
 * Copy and timings for the Clubhouse Sunset title and Choose Your Ride. Colours live in title.css;
 * everything a designer would tune by number lives here, never inline.
 *
 * The rides are the game's three ways in: the Turrets arena match (this repo's src/), and the two
 * free-drive rides, Chill and Joyride, which are the separate app in drive/ served at /drive/.
 */

import { paintHex } from "../../render/teamColors";

export type RideId = "turrets" | "chill" | "joyride";

export interface Ride {
  readonly id: RideId;
  readonly name: string;
  readonly badge: string;
  readonly blurb: string;
  readonly tags: readonly string[];
  /** `match` starts the arena; `drive` opens free drive in that mode. */
  readonly kind: "match" | "drive";
}

export const RIDES: readonly Ride[] = [
  {
    id: "turrets",
    name: "Turrets",
    badge: "Arena",
    blurb:
      "The cart with the roof turret. Tee off against the bots on a full course and fire balls at anything that moves.",
    tags: ["Turret fire", "Bots", "Clubhouse loadout"],
    kind: "match",
  },
  {
    id: "chill",
    name: "Chill",
    badge: "Free drive",
    blurb:
      "A Sunday loop of Tee Time Links. Gentle speed, steady handling, and a pond dunk puts you back on the cart path.",
    tags: ["Path respawn", "Auto hold on hills", "Rights itself"],
    kind: "drive",
  },
  {
    id: "joyride",
    name: "Joyride",
    badge: "Free drive",
    blurb:
      "The cart the pro shop warned you about. Three times the speed, a boost button and handbrake drifts round Tee Time Links.",
    tags: ["Boost", "Handbrake drifts", "Flips allowed"],
    kind: "drive",
  },
];

export const TITLE_CONFIG = {
  /** Design size of the menu stages; they scale to the window (scene: cover, buttons: contain). */
  stage: { width: 1280, height: 720 },
  /** Seconds for the turret cart to cross the title screen. */
  driveSeconds: 12,
  /** Seconds per turret windmill-and-strike; each strike launches one ball. */
  swingSeconds: 1.8,
  /** Fraction of the swing where the club meets the ball (matches the strike keyframe). */
  contactAt: 0.52,
  /** Balls in flight at once; each repeats every balls * swingSeconds. */
  balls: 3,
  /** The Turrets card's swing, seconds. */
  cardSwingSeconds: 1.6,
  /** Free drive: the course it opens on. */
  driveLevel: "tee-time-links",
} as const;

/**
 * Where a free-drive ride goes: drive/ under the site's base, straight into driving (its own
 * menus skipped), with a Main menu button on its pause menu that comes back here.
 */
export function freeDriveUrl(base: string, mode: "chill" | "joyride", paint?: number): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  const q = new URLSearchParams({ level: TITLE_CONFIG.driveLevel, mode, menu: "0", home: root });
  // The canopy hex of a PAINTS entry (src/render/teamColors.ts); drive accepts nothing else.
  if (paint !== undefined) q.set("paint", paintHex(paint));
  return `${root}drive/?${q.toString()}`;
}
