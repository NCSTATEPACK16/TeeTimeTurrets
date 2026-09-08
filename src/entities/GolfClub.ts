import * as THREE from "three";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { CART_GRAPH } from "./cartGraph";
import { buildGraph } from "./primitiveGraph";
import type { BuiltGraph, SlotColors } from "./primitiveGraph";
import { BALL_RADIUS } from "./BallSwarm";

/**
 * The hero cart: chassis, canopy, and a turret bolted to the roof whose barrel *is* a golf club
 * -- a shaft with the club head as the muzzle. Built to concept images 01 (form language), 03
 * (chase cam) and 04 (recoil launch).
 *
 * The geometry is no longer written here. It is authored in Blender and exported as a parameter
 * graph (`graphs/cart.json`, `ASSET_PIPELINE.md` section 4), and this class does what it always
 * did: pose it. That split is what let the cart go from eleven boxes to a shape with a nose,
 * fenders, a windscreen, seats, rims and a bag without this file growing a single primitive. No
 * mesh data crosses the line, so `AGENTS.md`'s procedural-primitives rule is intact.
 *
 * Render-facing only: it owns no Rapier body and no authoritative state. Every frame it is
 * handed a snapshot from `sim/entities/Cart.ts` and poses itself to match.
 *
 * The barrel's elevation is the equipped club's own `loftDeg`, and the muzzle sits at
 * `TURRET_GEOMETRY.barrelLength` along it. Both come from the sim so the club head the player
 * sees is exactly where `computeMuzzle` says the ball leaves from -- there is one set of numbers,
 * not a visual copy that can drift out of step with the ballistics. `cartGraph.test.ts` asserts
 * the exported graph still agrees with them.
 */

const MAX_WINDUP_TILT_RADIANS = 0.32;

/** Node names the pose code addresses. The graph is generated, so a rename in Blender has to
 *  surface as a loud failure here rather than a cart that silently stops aiming. */
const TURRET_PIVOT = "turret_pivot";
const BARREL_PITCH = "barrel_pitch";
const HEAD_SLOT = "head_slot";

const HEAD_NODES: Readonly<Record<ClubType, string>> = {
  [ClubType.Putter]: "head_putter",
  [ClubType.Iron]: "head_iron",
  [ClubType.Driver]: "head_driver",
};

export class GolfClub extends THREE.Group {
  private readonly graph: BuiltGraph;
  private readonly turretPivot: THREE.Object3D;
  /** Pitches the barrel to the equipped club's loft. Separate from the yaw pivot above it. */
  private readonly barrelPitch: THREE.Object3D;
  private readonly heads: Readonly<Record<ClubType, THREE.Object3D>>;
  private readonly loadedBall: THREE.Mesh;
  private readonly ballGeometry: THREE.SphereGeometry;
  private readonly ballMaterial: THREE.MeshStandardMaterial;
  private equippedClub: ClubType;

  constructor(initialClub: ClubType = ClubType.Driver, slotColors: SlotColors = {}) {
    super();
    this.equippedClub = initialClub;

    this.graph = buildGraph(CART_GRAPH, slotColors);
    this.add(this.graph.root);

    this.turretPivot = this.requireNode(TURRET_PIVOT);
    this.barrelPitch = this.requireNode(BARREL_PITCH);
    this.heads = {
      [ClubType.Putter]: this.requireNode(HEAD_NODES[ClubType.Putter]),
      [ClubType.Iron]: this.requireNode(HEAD_NODES[ClubType.Iron]),
      [ClubType.Driver]: this.requireNode(HEAD_NODES[ClubType.Driver]),
    };

    // All three heads ship in the graph and only the equipped one is drawn. Toggling `visible`
    // rather than rebuilding geometry matters because `main.ts` assigns the club every frame:
    // the old build-and-dispose path made a club swap a geometry churn.
    this.showOnly(initialClub);

    this.ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
    this.ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    this.loadedBall = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
    this.loadedBall.position.set(0, 0.22, 0.04);
    this.loadedBall.visible = false;
    // Not part of the graph: the round riding the club head is transient state, not cart geometry.
    this.requireNode(HEAD_SLOT).add(this.loadedBall);

    this.applyLoft(initialClub);
  }

  /** Swap the visible club head. Stats live in physics/Ballistics.ts; this only changes the look. */
  setClub(club: ClubType): void {
    if (club === this.equippedClub) return;
    this.equippedClub = club;
    this.showOnly(club);
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

  /**
   * Repaints one material slot. A slot's material is shared by every part using it, so this is a
   * single colour write and not a tree walk -- which is what lets the clubhouse preview a paint
   * live while the turntable spins.
   */
  setSlotColor(slot: string, color: number): void {
    this.graph.setSlotColor(slot, color);
  }

  /** Applies a whole cosmetic at once. Slots the graph does not declare are ignored. */
  setSlotColors(colors: SlotColors): void {
    for (const [slot, color] of Object.entries(colors)) this.graph.setSlotColor(slot, color);
  }

  /** Call once before this instance is discarded: frees geometries/materials, per AGENTS.md. */
  dispose(): void {
    this.graph.dispose();
    this.ballGeometry.dispose();
    this.ballMaterial.dispose();
  }

  private requireNode(name: string): THREE.Object3D {
    const node = this.graph.named.get(name);
    if (!node) {
      throw new Error(
        `cart graph is missing the node "${name}" the renderer poses. Re-export from Blender with ` +
          `that object present, or update GolfClub.ts if it was deliberately renamed.`,
      );
    }
    return node;
  }

  private showOnly(club: ClubType): void {
    for (const type of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
      this.heads[type].visible = type === club;
    }
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

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
