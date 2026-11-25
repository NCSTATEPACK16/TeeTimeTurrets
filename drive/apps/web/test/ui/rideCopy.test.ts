/**
 * The Joyride ride is driving only (John's M2 close-out decision): nothing on the menus may
 * promise a turret or firing balls, since the game has neither.
 */
import { describe, expect, it } from 'vitest';
import { CLOUDS, RIDE_SCENE, TITLE_SCENE, cartSvg } from '../../src/ui/art';
import { uiConfig } from '../../src/ui/uiConfig';

const WEAPON = /turret|fir(e|ing)\b|shoot|ammo|cannon/i;

describe('ride copy and art', () => {
  it('no ride blurb or tag mentions a turret or firing', () => {
    for (const ride of uiConfig.rides) {
      expect(ride.blurb, ride.id).not.toMatch(WEAPON);
      for (const tag of ride.tags) expect(tag, `${ride.id} tag`).not.toMatch(WEAPON);
    }
    expect(uiConfig.title.cartLabel).not.toMatch(WEAPON);
  });

  it('the cart art has no roof turret, muzzle flash or struck balls', () => {
    for (const svg of [cartSvg({ driving: true, speedLines: true, label: uiConfig.title.cartLabel }), TITLE_SCENE, RIDE_SCENE, CLOUDS]) {
      expect(svg).not.toMatch(/mn-(arm|flash|feed|ball|recoil)/);
      expect(svg).not.toMatch(WEAPON);
    }
  });

  it('the title cart is labelled for screen readers from config', () => {
    expect(cartSvg({ driving: true, speedLines: false, label: uiConfig.title.cartLabel })).toContain(
      `aria-label="${uiConfig.title.cartLabel}"`,
    );
  });
});
