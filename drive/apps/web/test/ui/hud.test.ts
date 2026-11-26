import { describe, expect, it } from 'vitest';
import { speedoAngle, surfaceLabel } from '../../src/ui/hud';
import { rideTopMph } from '../../src/ui/menus';
import { uiConfig } from '../../src/ui/uiConfig';

const wheel = (material: string, inContact = true) => ({ material, inContact }) as Parameters<typeof surfaceLabel>[0][number];

describe('HUD helpers', () => {
  it('names the surface most wheels are on', () => {
    expect(surfaceLabel([wheel('fairway'), wheel('fairway'), wheel('rough'), wheel('fairway')])).toBe('On the fairway');
    expect(surfaceLabel([wheel('bunker'), wheel('bunker'), wheel('green'), wheel('rough')])).toBe('In the bunker');
  });

  it('ignores wheels in the air, and says so when none are down', () => {
    expect(surfaceLabel([wheel('water', false), wheel('cartpath'), wheel('cartpath', false), wheel('cartpath', false)])).toBe(
      'On the cart path',
    );
    expect(surfaceLabel([wheel('fairway', false), wheel('fairway', false)])).toBe(uiConfig.airborneLabel);
  });

  it('has a label for every material', () => {
    for (const label of Object.values(uiConfig.surfaceLabels)) expect(label.length).toBeGreaterThan(0);
  });

  it('sweeps the speedometer ring from stop to full scale and clamps beyond it', () => {
    const { sweepDeg, fullMph } = uiConfig.speedo;
    expect(speedoAngle(0)).toBe(-sweepDeg / 2);
    expect(speedoAngle(fullMph)).toBe(sweepDeg / 2);
    expect(speedoAngle(fullMph * 3)).toBe(sweepDeg / 2);
    expect(speedoAngle(-5)).toBe(-sweepDeg / 2);
  });
});

describe('ride cards', () => {
  it('show each mode’s real top speed, rounded to 5 mph', () => {
    expect(rideTopMph('chill')).toBe(15);
    expect(rideTopMph('joyride')).toBe(45);
  });
});
