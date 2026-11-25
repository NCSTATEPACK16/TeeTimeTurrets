import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/core/loop';

const dt = 1 / 60;

describe('FixedStepper', () => {
  it('runs exactly one step per 60 Hz frame, without 0/2 alternation', () => {
    const s = new FixedStepper(dt, 5);
    const counts = Array.from({ length: 600 }, () => s.advance(dt));
    expect(counts.every((n) => n === 1)).toBe(true);
  });

  it('runs 60 steps per second at any display rate', () => {
    for (const hz of [30, 60, 75, 120, 144, 240]) {
      const s = new FixedStepper(dt, 5);
      let steps = 0;
      for (let i = 0; i < hz * 10; i++) steps += s.advance(1 / hz);
      expect(Math.abs(steps - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('caps substeps after a long frame and drops the rest', () => {
    const s = new FixedStepper(dt, 5);
    expect(s.advance(1)).toBe(5);
    expect(s.alpha).toBe(0);
    expect(s.advance(dt)).toBe(1);
  });

  it('reports the interpolation alpha between physics states', () => {
    const s = new FixedStepper(dt, 5);
    expect(s.advance(dt * 0.25)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.25, 9);
    expect(s.advance(dt)).toBe(1);
    expect(s.alpha).toBeCloseTo(0.25, 9);
    expect(s.advance(-1)).toBe(0);
  });
});
