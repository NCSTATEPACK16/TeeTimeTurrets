/**
 * M1 gate: "Skid emitter fires only above the slip threshold".
 * Each threshold is probed just below and just above, with everything else held clearly past it.
 */
import { describe, expect, it } from 'vitest';
import { skidEmit, skidTint } from '../../src/fx/fxConfig';
import { shouldSkid, skidTintFor, type SkidInput } from '../../src/fx/skidEmitter';

const EPS = 1e-3;

/** A wheel sliding hard on cart path: well past every threshold. */
const sliding: SkidInput = {
  inContact: true,
  material: 'cartpath',
  speed: skidEmit.minSpeed + 5,
  forwardSpeed: skidEmit.lockSpeed + 5,
  sideSlip: skidEmit.sideSlip + 1,
  braking: false,
};

/** A wheel braking hard in a straight line: past the lock thresholds, no side slip. */
const locked: SkidInput = { ...sliding, sideSlip: 0, braking: true };

describe('skid emitter', () => {
  it('fires for a clear slide and a clear lock-up', () => {
    expect(shouldSkid(sliding)).toBe(true);
    expect(shouldSkid(locked)).toBe(true);
  });

  it('side slip: off just below the threshold, on just above', () => {
    expect(shouldSkid({ ...sliding, sideSlip: skidEmit.sideSlip - EPS })).toBe(false);
    expect(shouldSkid({ ...sliding, sideSlip: skidEmit.sideSlip + EPS })).toBe(true);
  });

  it('ground speed: off at or below 2 m/s, on just above, whatever the slip', () => {
    expect(skidEmit.minSpeed).toBe(2); // PRD
    expect(shouldSkid({ ...sliding, speed: skidEmit.minSpeed - EPS })).toBe(false);
    expect(shouldSkid({ ...sliding, speed: skidEmit.minSpeed })).toBe(false);
    expect(shouldSkid({ ...sliding, speed: skidEmit.minSpeed + EPS })).toBe(true);
    expect(shouldSkid({ ...locked, speed: skidEmit.minSpeed - EPS })).toBe(false);
  });

  it('brake lock: off just below the lock speed, on just above, and only while braking', () => {
    expect(shouldSkid({ ...locked, forwardSpeed: skidEmit.lockSpeed - EPS })).toBe(false);
    expect(shouldSkid({ ...locked, forwardSpeed: skidEmit.lockSpeed + EPS })).toBe(true);
    expect(shouldSkid({ ...locked, forwardSpeed: -(skidEmit.lockSpeed + EPS) })).toBe(true); // reversing
    expect(shouldSkid({ ...locked, braking: false })).toBe(false);
  });

  it('never fires in the air or in water', () => {
    expect(shouldSkid({ ...sliding, inContact: false })).toBe(false);
    expect(shouldSkid({ ...sliding, material: 'water' })).toBe(false);
  });

  it('tints by surface', () => {
    expect(skidTintFor(sliding)).toBe(skidTint.cartpath);
    expect(skidTintFor({ ...sliding, material: 'bunker' })).toBe(skidTint.bunker);
    expect(skidTintFor({ ...sliding, material: 'fairway' })).toBe(skidTint.fairway);
  });
});
