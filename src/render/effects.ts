import * as THREE from "three";
import { ShardPool } from "./shardPool";
import type { BurstSpec } from "./shardPool";

/**
 * Match effects: muzzle puffs, impact puffs, ram sparks, death bursts and water splashes. Pure
 * presentation, triggered by `MatchScreen` from `Sim.events`; nothing here feeds back into the sim.
 *
 * **One draw for every shard.** All bursts share one `InstancedMesh` of flat-shaded tetrahedra
 * with per-instance colour, fed from `ShardPool` each frame. Splashes are a small fixed pool of
 * ring meshes. Nothing is created after construction.
 */

const SHARD_CAPACITY = 384;
const SPLASH_RINGS = 8;
const SPLASH_S = 0.9;
const SPLASH_MAX_RADIUS_M = 3.2;

const MUZZLE: BurstSpec = { count: 7, speed: 3, life: 0.45, gravity: -1.5, size: 0.14, color: 0xe9ece6, lift: 0.8 };
const IMPACT: BurstSpec = { count: 12, speed: 6, life: 0.55, gravity: 4, size: 0.12, color: 0xffc04a, lift: 1 };
const IMPACT_DUST: BurstSpec = { count: 6, speed: 2.5, life: 0.8, gravity: -0.5, size: 0.2, color: 0xd9d4c4, lift: 0.6 };
const RAM_SPARKS: BurstSpec = { count: 10, speed: 7, life: 0.35, gravity: 9, size: 0.08, color: 0xfff1a8, lift: 2 };
const DEATH_BODY: BurstSpec = { count: 26, speed: 9, life: 1.3, gravity: 9.8, size: 0.32, color: 0xeeeeea, lift: 5 };
const DEATH_FIRE: BurstSpec = { count: 18, speed: 5, life: 0.9, gravity: -2, size: 0.3, color: 0xff6a2a, lift: 2.5 };
const DEATH_SMOKE: BurstSpec = { count: 14, speed: 2, life: 2, gravity: -1.2, size: 0.55, color: 0x3a3a3a, lift: 2 };
const PICKUP_TAKEN: BurstSpec = { count: 14, speed: 4, life: 0.3, gravity: 2, size: 0.12, color: 0xffc24a, lift: 1.5 };
const PLATE_BREAK: BurstSpec = { count: 12, speed: 5, life: 0.45, gravity: 6, size: 0.14, color: 0x2ec4d0, lift: 1.5 };
const SPLASH_DROPS: BurstSpec = { count: 16, speed: 3.5, life: 0.8, gravity: 9.8, size: 0.12, color: 0xcfe8ff, lift: 4 };

interface SplashRing {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
}

export class EffectsLayer {
  readonly group = new THREE.Group();
  private readonly shards: ShardPool;
  private readonly shardMesh: THREE.InstancedMesh;
  private readonly shardGeometry = new THREE.TetrahedronGeometry(1);
  private readonly shardMaterial = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 });
  private readonly ringGeometry = new THREE.RingGeometry(0.8, 1, 32);
  private readonly rings: SplashRing[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0.3, 1, 0.5).normalize();
  private readonly color = new THREE.Color();

  constructor(random: () => number = Math.random) {
    this.shards = new ShardPool(SHARD_CAPACITY, random);
    this.shardMesh = new THREE.InstancedMesh(this.shardGeometry, this.shardMaterial, SHARD_CAPACITY);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.frustumCulled = false; // instances span the course; the bounds would be stale
    for (let i = 0; i < SHARD_CAPACITY; i++) {
      this.shardMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
      this.shardMesh.setColorAt(i, this.color.set(0xffffff));
    }
    this.group.add(this.shardMesh);

    this.ringGeometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < SPLASH_RINGS; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xe6f4ff, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(this.ringGeometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, material, age: SPLASH_S });
    }
  }

  muzzle(x: number, y: number, z: number): void {
    this.shards.burst(x, y, z, MUZZLE);
  }

  impact(x: number, y: number, z: number): void {
    this.shards.burst(x, y, z, IMPACT);
    this.shards.burst(x, y, z, IMPACT_DUST);
  }

  ram(x: number, y: number, z: number): void {
    this.shards.burst(x, y + 0.6, z, RAM_SPARKS);
  }

  death(x: number, y: number, z: number): void {
    this.shards.burst(x, y + 0.8, z, DEATH_BODY);
    this.shards.burst(x, y + 0.8, z, DEATH_FIRE);
    this.shards.burst(x, y + 1.2, z, DEATH_SMOKE);
  }

  /** A pickup's item taken: a short gold burst where it floated. */
  pickupTaken(x: number, y: number, z: number): void {
    this.shards.burst(x, y, z, PICKUP_TAKEN);
  }

  /** A shield plate shattered, at the cart (`y` is its body centre). */
  plateBreak(x: number, y: number, z: number): void {
    this.shards.burst(x, y + 0.55, z, PLATE_BREAK);
  }

  splash(x: number, y: number, z: number): void {
    this.shards.burst(x, y, z, SPLASH_DROPS);
    // The oldest ring is the one to reuse: it has faded the furthest.
    let ring = this.rings[0]!;
    for (const r of this.rings) if (r.age > ring.age) ring = r;
    ring.age = 0;
    ring.mesh.position.set(x, y + 0.05, z);
    ring.mesh.visible = true;
  }

  update(dt: number): void {
    this.shards.update(dt);
    const shards = this.shards.shards;
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i]!;
      const k = this.shards.scaleOf(s);
      if (k <= 0) {
        this.shardMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
        continue;
      }
      this.position.set(s.x, s.y, s.z);
      this.rotation.setFromAxisAngle(this.axis, s.angle);
      this.scale.set(k, k, k);
      this.shardMesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
      this.shardMesh.setColorAt(i, this.color.set(s.color));
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      if (r.age >= SPLASH_S) {
        r.mesh.visible = false;
        continue;
      }
      const t = r.age / SPLASH_S;
      const radius = 0.4 + (SPLASH_MAX_RADIUS_M - 0.4) * (1 - (1 - t) * (1 - t));
      r.mesh.scale.set(radius, 1, radius);
      r.material.opacity = 0.85 * (1 - t);
    }
  }

  clear(): void {
    this.shards.clear();
    for (const r of this.rings) {
      r.mesh.visible = false;
      r.age = SPLASH_S;
    }
  }

  dispose(): void {
    this.shardGeometry.dispose();
    this.shardMaterial.dispose();
    this.shardMesh.dispose();
    this.ringGeometry.dispose();
    for (const r of this.rings) r.material.dispose();
    this.group.clear();
  }
}
