import { describe, expect, it } from 'vitest';
import { PathSampler } from '../../src/level/pathSampler';

const paths = [
  {
    id: 'square',
    width: 2.4,
    closed: true,
    source: 'authored' as const,
    points: [
      [0, 0, 0],
      [100, 0, 0],
      [100, 0, 100],
      [0, 0, 100],
    ] as [number, number, number][],
  },
];

describe('PathSampler', () => {
  const s = new PathSampler(paths);

  it('projects onto the nearest segment', () => {
    const p = s.nearest(40, -7)!;
    expect(p.x).toBeCloseTo(40);
    expect(p.z).toBeCloseTo(0);
    expect(p.distance).toBeCloseTo(7);
    expect(p.headingDeg).toBeCloseTo(90); // first leg runs east
  });

  it('uses the closing segment of a closed path', () => {
    const p = s.nearest(-3, 50)!;
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(50);
    expect(p.headingDeg).toBeCloseTo(0); // (0,100) -> (0,0) runs north
  });

  it('returns null with no paths', () => {
    expect(new PathSampler([]).nearestPose(0, 0)).toBeNull();
  });
});
