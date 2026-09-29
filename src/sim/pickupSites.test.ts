import { describe, expect, it } from "vitest";
import { insidePolygon, placePickupSites, SCATTER_RADIUS_NEAR_M, type SiteGround } from "./pickupSites";

/** Smoke check for pickup placement (`docs/art/specs/pickups.md`). A fake 1 km field, a pond in it. */
const pond = { x: 300, z: 300, r: 60 };
const ground: SiteGround = {
  bounds: { minX: -500, minZ: -500, maxX: 500, maxZ: 500 },
  drivable: (x, z) => Math.hypot(x - pond.x, z - pond.z) > pond.r,
  hotspots: [{ x: -200, z: 200 }],
};
const clubhouse = { x: 0, z: 0 };

describe("pickup sites", () => {
  it("rings the depot with two of each type, then scatters apart and off the water", () => {
    const sites = placePickupSites(ground, clubhouse, 7);
    const depot = sites.filter((s) => s.depot);
    expect(depot.map((s) => s.type)).toEqual(["bucket", "hot_dog", "drink", "bucket", "hot_dog", "drink"]);
    for (const s of depot) expect(Math.hypot(s.x, s.z - 16)).toBeCloseTo(6, 6);
    const scatter = sites.filter((s) => !s.depot);
    expect(scatter.length).toBeGreaterThan(20);
    for (const s of scatter) expect(ground.drivable(s.x, s.z)).toBe(true);
    for (const a of scatter)
      for (const b of scatter) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(SCATTER_RADIUS_NEAR_M);
    expect(placePickupSites(ground, clubhouse, 7)).toEqual(sites);
  });

  it("keeps every scatter site inside the zone when one is given", () => {
    const zone = [{ x: 0, z: 0 }, { x: 500, z: 0 }, { x: 500, z: -500 }, { x: 0, z: -500 }];
    const scatter = placePickupSites(ground, clubhouse, 7, zone).filter((s) => !s.depot);
    expect(scatter.length).toBeGreaterThan(3);
    for (const s of scatter) expect(insidePolygon(zone, s.x, s.z)).toBe(true);
  });
});
