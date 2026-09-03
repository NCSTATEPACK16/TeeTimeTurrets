import * as THREE from "three";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { TURRET_GEOMETRY } from "../sim/entities/Cart";
import { BALL_RADIUS } from "./BallSwarm";

/**
 * The hero cart: chassis, canopy, and a turret bolted to the roof whose barrel *is* a golf club
 * -- a shaft with the club head as the muzzle. Built to concept images 01 (form language), 03
 * (chase cam) and 04 (recoil launch). Procedural primitives only, per the zero-external-asset
 * constraint.
 *
 * Render-facing only: it owns no Rapier body and no authoritative state. Every frame it is
 * handed a snapshot from `sim/entities/Cart.ts` and poses itself to match.
 *
 * The barrel's elevation is the equipped club's own `loftDeg`, and the muzzle sits at
 * `TURRET_GEOMETRY.barrelLength` along it. Both come from the sim so the club head the player
 * sees is exactly where `computeMuzzle` says the ball leaves from -- there is one set of numbers,
 * not a visual copy that can drift out of step with the ballistics.
 */

const CHASSIS_SIZE = { width: 1.4, height: 0.6, length: 2.2 };
const WHEEL_RADIUS = 0.35;
const CANOPY_THICKNESS = 0.09;
const POST_RADIUS = 0.045;
const MAX_WINDUP_TILT_RADIANS = 0.32;

/** Roof height comes from the sim so the turret ring and `computeMuzzle` cannot disagree. */
const ROOF_Y = TURRET_GEOMETRY.pivotHeight;
const SHAFT_LENGTH = TURRET_GEOMETRY.barrelLength;

const PAINT = 0x2f6f4f;
const TRIM = 0xf0f0e8;
const TURRET_RED = 0xc4382f;

export class GolfClub extends THREE.Group {
  private readonly turretPivot: THREE.Group;
  /** Pitches the barrel to the equipped club's loft. Separate from the yaw pivot above it. */
  private readonly barrelPitch: THREE.Group;
  private readonly housing: THREE.Mesh;
  private readonly headSlot: THREE.Group;
  private readonly loadedBall: THREE.Mesh;
  private clubHead: THREE.Mesh;
  private equippedClub: ClubType;

  constructor(initialClub: ClubType = ClubType.Driver) {
    super();
    this.equippedClub = initialClub;

    this.add(buildChassis());
    this.add(buildSeatBack());
    for (const offset of wheelOffsets()) {
      const wheel = buildWheel();
      wheel.position.copy(offset);
      this.add(wheel);
    }
    for (const post of canopyPosts()) this.add(post);
    this.add(buildCanopy());

    // Turret ring on the roof, exactly where image 03 puts it.
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, ROOF_Y, 0);
    this.add(this.turretPivot);
    this.turretPivot.add(buildTurretRing());

    this.housing = buildTurretHousing();
    this.turretPivot.add(this.housing);

    this.barrelPitch = new THREE.Group();
    this.barrelPitch.position.set(0, 0.26, 0);
    this.turretPivot.add(this.barrelPitch);

    // Shaft laid along +Z (the cart's forward) rather than +Y: this is a cannon barrel that
    // happens to be a golf club, not a club standing upright in a bag.
    const shaft = buildShaft();
    shaft.position.set(0, 0, SHAFT_LENGTH / 2);
    this.barrelPitch.add(shaft);

    this.headSlot = new THREE.Group();
    this.headSlot.position.set(0, 0, SHAFT_LENGTH);
    this.barrelPitch.add(this.headSlot);

    this.clubHead = buildClubHead(initialClub);
    this.headSlot.add(this.clubHead);

    this.loadedBall = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }),
    );
    this.loadedBall.position.set(0, 0.22, 0.04);
    this.loadedBall.visible = false;
    this.headSlot.add(this.loadedBall);

    this.applyLoft(initialClub);
  }

  /** Swap the visible club head. Stats live in physics/Ballistics.ts; this only changes the look. */
  setClub(club: ClubType): void {
    if (club === this.equippedClub) return;
    this.equippedClub = club;
    this.headSlot.remove(this.clubHead);
    this.clubHead.geometry.dispose();
    (this.clubHead.material as THREE.Material).dispose();
    this.clubHead = buildClubHead(club);
    this.headSlot.add(this.clubHead);
    this.applyLoft(club);
  }

  /** yawRadians: turret rotation relative to the chassis, matching a tank turret. */
  setAimYaw(yawRadians: number): void {
    this.turretPivot.rotation.y = yawRadians;
  }

  /**
   * charge01 in [0,1]: the barrel cocks further back as the shot winds up, so power is readable
   * from the cart's silhouette alone and not only from the HUD bar.
   */
  setChargeVisual(charge01: number): void {
    this.barrelPitch.rotation.x = -this.loftRadians() - MAX_WINDUP_TILT_RADIANS * clamp01(charge01);
  }

  /** Shows the ball riding on the club head, ready to be fired. */
  setBallLoaded(loaded: boolean): void {
    this.loadedBall.visible = loaded;
  }

  /** Call once before this instance is discarded: frees geometries/materials, per AGENTS.md. */
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

  private loftRadians(): number {
    return (CLUB_STATS[this.equippedClub].loftDeg * Math.PI) / 180;
  }

  /**
   * Negative X-rotation lifts a +Z-facing barrel, so the putter lies nearly flat at 3 deg and the
   * iron cocks up at 22 deg. The player can read the club from across the fairway.
   */
  private applyLoft(club: ClubType): void {
    this.barrelPitch.rotation.x = -((CLUB_STATS[club].loftDeg * Math.PI) / 180);
  }
}

function buildChassis(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(CHASSIS_SIZE.width, CHASSIS_SIZE.height, CHASSIS_SIZE.length);
  const mesh = new THREE.Mesh(geometry, bodyMaterial(PAINT));
  mesh.position.y = CHASSIS_SIZE.height / 2 + WHEEL_RADIUS;
  return mesh;
}

/** Reads as a seat from behind, which is the angle the chase camera spends its life at. */
function buildSeatBack(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(CHASSIS_SIZE.width * 0.8, 0.5, 0.12);
  const mesh = new THREE.Mesh(geometry, bodyMaterial(TRIM));
  mesh.position.set(0, CHASSIS_SIZE.height + WHEEL_RADIUS + 0.2, -0.25);
  return mesh;
}

function buildCanopy(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(CHASSIS_SIZE.width + 0.18, CANOPY_THICKNESS, CHASSIS_SIZE.length * 0.82);
  const mesh = new THREE.Mesh(geometry, bodyMaterial(TRIM));
  mesh.position.y = ROOF_Y - CANOPY_THICKNESS / 2;
  return mesh;
}

function canopyPosts(): THREE.Mesh[] {
  const chassisTop = CHASSIS_SIZE.height + WHEEL_RADIUS;
  const height = ROOF_Y - chassisTop;
  const x = CHASSIS_SIZE.width / 2 - 0.06;
  const z = CHASSIS_SIZE.length / 2 - 0.2;
  return [
    [-x, -z],
    [x, -z],
    [-x, z],
    [x, z],
  ].map(([px, pz]) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, height, 8),
      bodyMaterial(0x35393d),
    );
    mesh.position.set(px!, chassisTop + height / 2, pz!);
    return mesh;
  });
}

function buildTurretRing(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.12, 16), bodyMaterial(0x8d9298));
  mesh.position.y = 0.06;
  return mesh;
}

function buildTurretHousing(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.62), bodyMaterial(TURRET_RED));
  mesh.position.y = 0.29;
  return mesh;
}

function buildWheel(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.25, 16);
  geometry.rotateZ(Math.PI / 2);
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
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

/** Rotated to lie along +Z, since a cylinder is built along +Y and this is a barrel. */
function buildShaft(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(0.05, 0.07, SHAFT_LENGTH, 10);
  geometry.rotateX(Math.PI / 2);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.7 }),
  );
}

/**
 * Silhouette differentiation by club type, primitives only: putter reads as a flat mallet, iron
 * as an angled blade, driver as a large bulbous head. Each is oriented as the muzzle of a barrel
 * pointing down +Z, so the face is what the ball leaves through.
 */
function buildClubHead(club: ClubType): THREE.Mesh {
  switch (club) {
    case ClubType.Putter: {
      const geometry = new THREE.BoxGeometry(0.52, 0.16, 0.14);
      return new THREE.Mesh(geometry, headMaterial(0x8a8a8a));
    }
    case ClubType.Iron: {
      const geometry = new THREE.BoxGeometry(0.34, 0.42, 0.1);
      geometry.rotateX(0.3);
      return new THREE.Mesh(geometry, headMaterial(0xb0b0b0));
    }
    case ClubType.Driver: {
      const geometry = new THREE.SphereGeometry(0.3, 16, 12);
      geometry.scale(1.25, 1, 1.35);
      return new THREE.Mesh(geometry, headMaterial(0x101010));
    }
  }
}

function bodyMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
}

function headMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
