import { describe, expect, it } from 'vitest';
import { LevelLoadError, loadLevel, type PacketReader } from '../../src/level/loadLevel';
import { diskReader, loadTestLevel } from '../helpers/packet';

function patched(base: PacketReader, file: string, edit: (b: Uint8Array) => Uint8Array): PacketReader {
  return async (name) => {
    const data = await base(name);
    return name === file ? (edit(new Uint8Array(data.slice(0))).buffer as ArrayBuffer) : data;
  };
}

describe('loadLevel', () => {
  it('loads and decodes the packet', async () => {
    const level = await loadTestLevel();
    const { width, height } = level.grid;
    expect(level.heights).toHaveLength(width * height);
    expect(level.material).toHaveLength(width * height);
    expect(level.minHeight).toBeLessThan(level.maxHeight);
    expect(level.heights.every(Number.isFinite)).toBe(true);
    expect(level.holes.holes.length).toBeGreaterThan(0);
    expect(level.scatter.length % 4).toBe(0);
  });

  it('rejects a file whose SHA-256 does not match course.json', async () => {
    const reader = patched(diskReader(), 'height.u16.bin', (b) => {
      b[100] = b[100]! ^ 0xff;
      return b;
    });
    await expect(loadLevel(reader)).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('rejects a truncated grid even when the hash is skipped', async () => {
    const original = globalThis.crypto;
    // Simulate a non-secure context where crypto.subtle is unavailable.
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const reader = patched(diskReader(), 'material.u8.bin', (b) => b.slice(0, b.length - 1));
      await expect(loadLevel(reader)).rejects.toThrow(LevelLoadError);
      await expect(loadLevel(reader)).rejects.toThrow(/expected \d+ bytes/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });

  it('rejects a course.json that fails the schema', async () => {
    const reader = patched(diskReader(), 'course.json', (b) => {
      const doc = JSON.parse(new TextDecoder().decode(b));
      doc.grid.cellSize = 2;
      return new TextEncoder().encode(JSON.stringify(doc));
    });
    await expect(loadLevel(reader)).rejects.toThrow(/schema validation/);
  });
});
