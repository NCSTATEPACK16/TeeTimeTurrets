import { describe, expect, it } from "vitest";
import { SPAWN_CLEARANCE_M } from "./matchConfig";
import { createSpawnSet, openingSpawn, respawnPoint } from "./spawn";
import type { SpawnHole, SpawnOccupant } from "./spawn";
import { mulberry32 } from "./rng";

/**
 * Spawns are a course-frame question, and every test here is built on a hole whose placement is
 * **rotated**. A hole at rotation 0 makes the local and course answers identical, which would
 * make the whole file inert without a single assertion changing.
 */

/** Tees on a wide ring so clearance is unambiguous; each hole's cup 100 m "up" its local +X. */
function ring(count: number, radius = 400): SpawnHole[] {
  const holes: SpawnHole[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    holes.push({
      placement: {
        offsetX: Math.cos(angle) * radius,
        offsetZ: Math.sin(angle) * radius,
        // Deliberately not zero, and different per hole.
        rotation: angle + Math.PI / 5,
      },
      spec: { index: i, tee: { x: -50, z: 0 }, cup: { x: 50, z: 0 } },
    });
  }
  return holes;
}

const flat = () => 0;

function occupant(x: number, z: number, dead = false): SpawnOccupant {
  return { position: { x, z }, dead };
}

describe("createSpawnSet", () => {
  it("puts each spawn at its own hole's tee in the course frame", () => {
    const holes = ring(4);
    const set = createSpawnSet(holes, flat);

    expect(set).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      const p = holes[i]!.placement;
      const cos = Math.cos(p.rotation);
      const sin = Math.sin(p.rotation);
      expect(set[i]!.x).toBeCloseTo(p.offsetX + -50 * cos, 6);
      expect(set[i]!.z).toBeCloseTo(p.offsetZ + -50 * sin, 6);
      expect(set[i]!.hole).toBe(i);
    }
  });

  it("faces each spawn down its own hole toward the cup", () => {
    const holes = ring(4);
    const set = createSpawnSet(holes, flat);

    for (let i = 0; i < 4; i++) {
      const spawn = set[i]!;
      const p = holes[i]!.placement;
      const cup = {
        x: p.offsetX + 50 * Math.cos(p.rotation),
        z: p.offsetZ + 50 * Math.sin(p.rotation),
      };
      // Drive 10 m along the heading and you must have got closer to the cup, from a tee that
      // is 100 m away from it. A heading computed in the hole's local frame -- the mistake this
      // is written against -- points somewhere else entirely on a rotated hole.
      const before = Math.hypot(cup.x - spawn.x, cup.z - spawn.z);
      const after = Math.hypot(
        cup.x - (spawn.x + Math.cos(spawn.heading) * 10),
        cup.z - (spawn.z + Math.sin(spawn.heading) * 10),
      );
      expect(after).toBeCloseTo(before - 10, 6);
    }
  });

  it("stands each spawn on the ground it is given", () => {
    // Not a constant: the sampler is asked at the spawn's own point, so a set built against a
    // sloped course does not put every cart at the same height.
    const holes = ring(3);
    const set = createSpawnSet(holes, (x, _z) => x * 0.1);

    for (const spawn of set) expect(spawn.y).toBeCloseTo(spawn.x * 0.1, 6);
  });
});

describe("openingSpawn", () => {
  it("deals a different hole to every cart while there are holes left", () => {
    const set = createSpawnSet(ring(18), flat);
    const used = new Set<number>();
    for (let i = 0; i < 18; i++) used.add(openingSpawn(set, i).hole);

    // Eighteen carts, eighteen holes, no two on the same tee. Red against `set[0]` for everyone,
    // which is what `loadCourse` did before there was a spawn module.
    expect(used.size).toBe(18);
  });

  it("wraps once the roster is longer than the course", () => {
    const set = createSpawnSet(ring(18), flat);
    expect(openingSpawn(set, 18).hole).toBe(openingSpawn(set, 0).hole);
  });
});

describe("respawnPoint", () => {
  it("never picks a tee an enemy is parked on", () => {
    const holes = ring(4);
    const set = createSpawnSet(holes, flat);
    const camped = set[2]!;
    // One living cart sitting exactly on tee 2, and three tees free.
    const occupants = [occupant(0, 0), occupant(camped.x, camped.z)];
    const random = mulberry32(7);

    // Many draws: a single one can miss a bad tee by luck, which is what makes a one-shot
    // assertion here worthless.
    for (let i = 0; i < 200; i++) {
      expect(respawnPoint(set, random, occupants, 0).hole).not.toBe(2);
    }
  });

  it("ignores a dead cart when judging whether a tee is contested", () => {
    const set = createSpawnSet(ring(2), flat);
    const occupants = [occupant(0, 0), occupant(set[1]!.x, set[1]!.z, true)];
    const random = mulberry32(11);

    // Only two tees, and the one holding a corpse must be available -- otherwise a match in
    // which everyone is mid-respawn has nowhere to put anybody.
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(respawnPoint(set, random, occupants, 0).hole);
    expect(seen.has(1)).toBe(true);
  });

  it("does not count the respawning cart's own corpse against a tee", () => {
    const set = createSpawnSet(ring(2), flat);
    // The cart being respawned is sitting on tee 0 and is alive as far as this list knows.
    const occupants = [occupant(set[0]!.x, set[0]!.z), occupant(9999, 9999)];
    const random = mulberry32(3);

    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(respawnPoint(set, random, occupants, 0).hole);
    expect(seen.has(0)).toBe(true);
  });

  it("takes the emptiest tee when every one of them is contested", () => {
    // Three tees, an enemy near each, all inside the clearance radius -- so no draw can ever
    // succeed and the fallback is the only thing that answers.
    const set = createSpawnSet(ring(3), flat);
    const occupants: SpawnOccupant[] = [
      occupant(0, 0),
      occupant(set[0]!.x + 1, set[0]!.z),
      occupant(set[1]!.x + 5, set[1]!.z),
      // The farthest of the three, and still well inside the clearance radius.
      occupant(set[2]!.x + SPAWN_CLEARANCE_M - 1, set[2]!.z),
    ];
    const random = mulberry32(5);

    // Named, not "one of them": red against a fallback that takes index 0, which puts every
    // contested respawn in a match on the same tee.
    expect(respawnPoint(set, random, occupants, 0).hole).toBe(2);
  });

  it("draws from the stream it is given rather than from the clock", () => {
    const set = createSpawnSet(ring(18), flat);
    const occupants = [occupant(0, 0)];
    const first = [];
    const second = [];
    const a = mulberry32(99);
    const b = mulberry32(99);
    for (let i = 0; i < 20; i++) first.push(respawnPoint(set, a, occupants, 0).hole);
    for (let i = 0; i < 20; i++) second.push(respawnPoint(set, b, occupants, 0).hole);

    expect(second).toEqual(first);
    // The control: with 18 tees, 20 draws that are all the same tee would make the equality
    // above true for a reason that has nothing to do with the stream.
    expect(new Set(first).size).toBeGreaterThan(1);
  });
});
