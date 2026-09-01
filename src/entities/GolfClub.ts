import * as THREE from "three";
import { ClubType } from "../physics/Ballistics";

/**
 * Render-facing entity: the golf-cart chassis + turret + swappable club head. Procedural
 * primitives only (no GLB/OBJ), per the project's zero-external-asset constraint.
 *
 * This is visual + local-input state, NOT authoritative simulation -- it does not own a
 * Rapier body. Phase 2 wires this up to a sim/entities/Cart.ts module that owns chassis
 * position, turret yaw, equipped club, and reload timer as authoritative state; this class
 * will then read that state each frame the same way render/scene.ts reads Sim.current today,
 * rather than tracking its own yaw/charge as it does now for standalone use. See
 * docs/ARCHITECTURE.md section 1 for the sim/render boundary this respects.
 */

const CHASSIS_SIZE = { width: 1.4, height: 0.6, length: 2.2 };
const WHEEL_RADIUS = 0.35;
const TURRET_HEIGHT_OFFSET = 0.55;
const SHAFT_LENGTH = 1.6;
const MAX_WINDUP_TILT_RADIANS = 0.6;

export class GolfClub extends THREE.Group {
  private readonly turretPivot: THREE.Group;
  private readonly shaft: THREE.Mesh;
  private readonly headSlot: THREE.Group;
  private clubHead: THREE.Mesh;
  private equippedClub: ClubType;

  constructor(initialClub: ClubType = ClubType.Driver) {
    super();
    this.equippedClub = initialClub;

    this.add(buildChassis());
    for (const wheelOffset of wheelOffsets()) {
      const wheel = buildWheel();
      wheel.position.copy(wheelOffset);
      this.add(wheel);
    }

    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, CHASSIS_SIZE.height / 2 + TURRET_HEIGHT_OFFSET, 0);
    this.add(this.turretPivot);

    this.shaft = buildShaft();
    this.shaft.position.set(0, SHAFT_LENGTH / 2, 0);
    this.turretPivot.add(this.shaft);

    this.headSlot = new THREE.Group();
    this.headSlot.position.set(0, SHAFT_LENGTH, 0);
    this.turretPivot.add(this.headSlot);

    this.clubHead = buildClubHead(initialClub);
    this.headSlot.add(this.clubHead);
  }

  /** Swap the visible club head geometry. Stats/behavior live in physics/Ballistics.ts, not here. */
  setClub(club: ClubType): void {
    if (club === this.equippedClub) return;
    this.equippedClub = club;
    this.headSlot.remove(this.clubHead);
    this.clubHead.geometry.dispose();
    (this.clubHead.material as THREE.Material).dispose();
    this.clubHead = buildClubHead(club);
    this.headSlot.add(this.clubHead);
  }

  /** yawRadians: turret rotation independent of chassis heading, matching a tank turret. */
  setAimYaw(yawRadians: number): void {
    this.turretPivot.rotation.y = yawRadians;
  }

  /** charge01 in [0,1]: purely visual windup feedback while the swing button is held. */
  setChargeVisual(charge01: number): void {
    this.shaft.rotation.z = -MAX_WINDUP_TILT_RADIANS * clamp01(charge01);
  }

  /** Call once before this instance is discarded: frees geometries/materials (InstancedMesh-adjacent hygiene per AGENTS.md). */
  dispose(): void {
    this.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });
  }
}

function buildChassis(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(CHASSIS_SIZE.width, CHASSIS_SIZE.height, CHASSIS_SIZE.length);
  const material = new THREE.MeshStandardMaterial({ color: 0x2f6f4f, roughness: 0.6, metalness: 0.1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = CHASSIS_SIZE.height / 2 + WHEEL_RADIUS;
  return mesh;
}

function buildWheel(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.25, 16);
  geometry.rotateZ(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  return new THREE.Mesh(geometry, material);
}

function wheelOffsets(): THREE.Vector3[] {
  const x = CHASSIS_SIZE.width / 2 + 0.05;
  const z = CHASSIS_SIZE.length / 2 - 0.4;
  const y = WHEEL_RADIUS;
  return [
    new THREE.Vector3(-x, y, z),
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(-x, y, -z),
    new THREE.Vector3(x, y, -z),
  ];
}

function buildShaft(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(0.05, 0.06, SHAFT_LENGTH, 10);
  const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.7 });
  return new THREE.Mesh(geometry, material);
}

/**
 * Silhouette differentiation by club type, primitives only: putter reads as a flat mallet,
 * iron as an angled blade, driver as a large bulbous head -- matching the research doc's
 * "silhouette over detail" approach to procedural club geometry.
 */
function buildClubHead(club: ClubType): THREE.Mesh {
  switch (club) {
    case ClubType.Putter: {
      const geometry = new THREE.BoxGeometry(0.5, 0.15, 0.12);
      return new THREE.Mesh(geometry, headMaterial(0x8a8a8a));
    }
    case ClubType.Iron: {
      const geometry = new THREE.BoxGeometry(0.32, 0.4, 0.08);
      geometry.rotateZ(-0.35);
      return new THREE.Mesh(geometry, headMaterial(0xb0b0b0));
    }
    case ClubType.Driver: {
      const geometry = new THREE.SphereGeometry(0.32, 16, 12);
      geometry.scale(1.3, 1, 1.1);
      return new THREE.Mesh(geometry, headMaterial(0x101010));
    }
  }
}

function headMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
