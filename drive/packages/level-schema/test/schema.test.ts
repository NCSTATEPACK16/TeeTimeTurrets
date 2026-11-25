import { describe, expect, it } from 'vitest';
import {
  MATERIAL_NAMES,
  MaterialId,
  colToX,
  decodeStripeDeg,
  headingToForward,
  rowToZ,
  xToCol,
  zToRow,
  type CourseJson,
} from '../src/index';
import { PacketValidationError, courseSchema, validateCourse, validateHoles, validatePaths } from '../src/validate';

function minimalCourse(): CourseJson {
  return {
    schemaVersion: '0.2',
    id: 'test-01',
    name: 'Test',
    generator: { name: 'test', version: '0' },
    crs: null,
    grid: { width: 3, height: 2, cellSize: 1 },
    height: { file: 'height.u16.bin', scale: 0.001, offset: 0 },
    material: { file: 'material.u8.bin' },
    stripe: { file: 'stripe.u8.bin' },
    materials: [{ id: 0, name: 'rough', color: '#336633' }],
    spawn: { x: 0, z: 0, headingDeg: 0 },
    water: [],
    scatter: { file: 'scatter.bin', species: [] },
    holes: 'holes.json',
    paths: 'paths.json',
    attribution: [],
    files: { 'height.u16.bin': '0'.repeat(64) },
    qa: { driveStart: { x: 0, z: 0, headingDeg: 90 }, probes: [] },
  };
}

describe('material IDs', () => {
  it('match the schema enum order exactly', () => {
    expect([...MATERIAL_NAMES]).toEqual(courseSchema.$defs.materialName.enum);
  });

  it('assign IDs by index', () => {
    expect(MaterialId.rough).toBe(0);
    expect(MaterialId.water).toBe(6);
    expect(MaterialId.cartpath).toBe(7);
    expect(MaterialId.embankment).toBe(9);
  });
});

describe('course.json schema', () => {
  it('accepts a minimal course', () => {
    expect(() => validateCourse(minimalCourse())).not.toThrow();
  });

  it('rejects an unknown material name', () => {
    const c = minimalCourse() as unknown as { materials: { id: number; name: string; color: string }[] };
    c.materials[0]!.name = 'lava';
    expect(() => validateCourse(c)).toThrow(PacketValidationError);
  });

  it('rejects cell sizes other than 1 m and unknown keys', () => {
    expect(() => validateCourse({ ...minimalCourse(), grid: { width: 3, height: 2, cellSize: 2 } })).toThrow();
    expect(() => validateCourse({ ...minimalCourse(), extra: true })).toThrow();
  });

  it('rejects malformed hashes', () => {
    expect(() => validateCourse({ ...minimalCourse(), files: { 'height.u16.bin': 'abc' } })).toThrow();
  });
});

describe('holes.json and paths.json schemas', () => {
  it('accept valid documents and reject broken ones', () => {
    const p = { x: 1, z: 2 };
    expect(() => validateHoles({ holes: [{ number: 1, par: 4, tee: p, green: p, pin: p }] })).not.toThrow();
    expect(() => validateHoles({ holes: [] })).toThrow();
    const path = { id: 'loop', width: 2.4, closed: true, source: 'authored', points: [[0, 1, 0], [1, 1, 0]] };
    expect(() => validatePaths({ paths: [path], bridges: [] })).not.toThrow();
    expect(() => validatePaths({ paths: [{ ...path, points: [[0, 1]] }], bridges: [] })).toThrow();
  });
});

describe('grid convention', () => {
  const grid = { width: 513, height: 257, cellSize: 1 };

  it('centers the grid on the origin with row 0 at the north (-Z) edge', () => {
    expect(colToX(grid, 0)).toBe(-256);
    expect(colToX(grid, 512)).toBe(256);
    expect(rowToZ(grid, 0)).toBe(-128);
    expect(rowToZ(grid, 256)).toBe(128);
  });

  it('round-trips world and grid coordinates', () => {
    for (const v of [-100.25, 0, 17.5]) {
      expect(colToX(grid, xToCol(grid, v))).toBeCloseTo(v, 12);
      expect(rowToZ(grid, zToRow(grid, v))).toBeCloseTo(v, 12);
    }
  });

  it('maps compass headings to world directions', () => {
    const north = headingToForward(0);
    const east = headingToForward(90);
    expect(north.x).toBeCloseTo(0, 12);
    expect(north.z).toBeCloseTo(-1, 12);
    expect(east.x).toBeCloseTo(1, 12);
    expect(east.z).toBeCloseTo(0, 12);
  });

  it('decodes stripe bytes over 180 degrees without repeating a direction', () => {
    expect(decodeStripeDeg(0)).toBe(0);
    expect(decodeStripeDeg(128)).toBe(90);
    expect(decodeStripeDeg(255)).toBeLessThan(180);
  });
});

describe('optional v0.2 extensions (M2)', () => {
  const horizon = {
    file: 'horizon.u16.bin' as const,
    cellSize: 10,
    width: 601,
    height: 601,
    originX: -3000,
    originZ: -3000,
    scale: 0.002,
    offset: 100,
  };

  it('accept a horizon, a logo and qa.deepWater', () => {
    const c = minimalCourse();
    c.horizon = horizon;
    c.logo = { file: 'logo.webp' };
    c.qa.deepWater = { x: 1, z: 2, headingDeg: 0 };
    expect(() => validateCourse(c)).not.toThrow();
  });

  it('reject a malformed horizon or logo', () => {
    expect(() => validateCourse({ ...minimalCourse(), horizon: { ...horizon, file: 'h.bin' } })).toThrow();
    expect(() => validateCourse({ ...minimalCourse(), horizon: { ...horizon, cellSize: 0 } })).toThrow();
    expect(() => validateCourse({ ...minimalCourse(), logo: { file: '../logo.svg' } })).toThrow();
  });
});
