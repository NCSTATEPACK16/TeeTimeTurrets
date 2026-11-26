import type { MaterialName } from '@gcs/level-schema';
import type { ModeName } from '../modes/modes';

/**
 * Menu and HUD tunables (title screen, ride select, HUD). Colors live in ui/theme.css as CSS
 * variables; timings and copy live here and reach the CSS as custom properties.
 */
export const uiConfig = {
  /** Design size of the menu stages; they scale to the window (scene: cover, buttons: contain). */
  stage: { width: 1280, height: 720 },
  title: {
    /** Seconds for the cart to cross the title screen. */
    driveSeconds: 12,
    /** Screen-reader description of the title-screen cart. */
    cartLabel: 'A golf cart with a driver at the wheel, speeding down the fairway',
  },
  /** Seconds the controls card stays up after the round starts before it fades. */
  controlsCardSeconds: 12,
  /** The speedometer ring's full sweep (degrees) and the speed (mph) that fills it. */
  speedo: { sweepDeg: 270, fullMph: 55 },
  rides: [
    {
      id: 'chill',
      badge: 'Relaxed',
      blurb:
        'A Sunday loop of the course. Gentle speed, steady handling, and a pond dunk puts you back on the cart path in three seconds.',
      tags: ['Path respawn', 'Auto hold on hills', 'Rights itself'],
    },
    {
      id: 'joyride',
      badge: 'Mischief',
      blurb:
        'The cart the pro shop warned you about. Twice the speed, a boost button and handbrake drifts. Pure driving: tear around the course and see what it can do.',
      tags: ['Boost', 'Handbrake drifts', 'Flips allowed'],
    },
  ] as const satisfies readonly { id: ModeName; badge: string; blurb: string; tags: readonly string[] }[],
  /** The HUD's surface chip, by the material most wheels are on. */
  surfaceLabels: {
    rough: 'In the rough',
    fairway: 'On the fairway',
    fringe: 'On the fringe',
    green: 'On the green',
    tee: 'On the tee box',
    bunker: 'In the bunker',
    water: 'In the drink',
    cartpath: 'On the cart path',
    woods: 'In the woods',
    embankment: 'On the bank',
  } satisfies Record<MaterialName, string>,
  airborneLabel: 'Airborne!',
} as const;

export const MPH_PER_MPS = 2.236936;
