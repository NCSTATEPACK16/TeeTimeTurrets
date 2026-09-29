import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GolfClub } from "./GolfClub";
import { ClubType } from "../physics/Ballistics";

/**
 * Its own file because the geometry cache is module state: other cart tests leave carts
 * undisposed, and in the same module they would hold the count above zero forever.
 */
describe("the geometry carts share", () => {
  it("is freed when the last cart drawing it is disposed, and not before", () => {
    const a = new GolfClub(ClubType.Driver);
    const b = new GolfClub(ClubType.Driver);
    let shared: THREE.Mesh | undefined;
    a.traverse((node) => {
      if (shared === undefined && (node as THREE.Mesh).isMesh && node.name.startsWith("merged:")) shared = node as THREE.Mesh;
    });
    expect(shared).toBeDefined();
    let freed = false;
    shared!.geometry.addEventListener("dispose", () => (freed = true));
    a.dispose();
    expect(freed).toBe(false);
    b.dispose();
    expect(freed).toBe(true);
    // A cart built afterwards gets live geometry of its own rather than the freed one.
    const c = new GolfClub(ClubType.Driver);
    let reused = false;
    c.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && (node as THREE.Mesh).geometry === shared!.geometry) reused = true;
    });
    expect(reused).toBe(false);
    c.dispose();
  });
});
