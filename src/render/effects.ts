import * as THREE from "three";
import { ClubType } from "../physics/Ballistics";

/**
 * Stage 2's pooled effects: muzzle smoke, impact dust, the burst a cart goes up in, and the ring a
 * cart throws up when it hits the water. Render-only, fed from `Sim.events` by the match screen.
 *
 * Every puff is one instance of a single flat-shaded icosahedron, so the whole lot is one draw call
 * however busy the fight gets. Puff state is preallocated; a spawn past capacity recycles the
 * oldest live puff rather than growing anything. The rings are a small pool of plain meshes, each
 * with its own material, because each fades on its own clock and instancing cannot fade instances
 * one by one.
 */

/** Live puffs at once. A driver shot is 7, a death 18; eight carts fighting stay well inside. */
export const PUFF_CAPACITY = 160;
/** Splash rings at once. */
const RING_CAPACITY = 6;
/** Seconds a splash ring takes to spread out and fade. */
const RING_LIFE_S = 0.9;
/** Metres a ring spreads to. */
const RING_MAX_RADIUS = 4.5;

interface Puff {
  active: boolean;
  /** Spawn order, so a full pool knows which puff is the oldest. */
  born: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  color: THREE.Color;
}

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
}

/** A spawn recipe: how many puffs, how big, how fast, what colour. */
interface Recipe {
  count: number;
  size0: number;
  size1: number;
  speed: number;
  rise: number;
  life: number;
  color: number;
  /** Colour variation, 0..1. */
  jitter: number;
}

const MUZZLE: Record<ClubType, Recipe> = {
  [ClubType.Putter]: { count: 3, size0: 0.18, size1: 0.45, speed: 0.8, rise: 0.4, life: 0.35, color: 0xe8e4dc, jitter: 0.05 },
  [ClubType.Iron]: { count: 5, size0: 0.25, size1: 0.7, speed: 1.2, rise: 0.6, life: 0.5, color: 0xdedad2, jitter: 0.06 },
  [ClubType.Driver]: { count: 7, size0: 0.35, size1: 1.0, speed: 1.8, rise: 0.8, life: 0.65, color: 0xd6d2ca, jitter: 0.08 },
};
const IMPACT: Recipe = { count: 5, size0: 0.25, size1: 0.8, speed: 2.4, rise: 1.2, life: 0.5, color: 0xb89a6a, jitter: 0.12 };
const BURST: Recipe = { count: 18, size0: 0.5, size1: 1.8, speed: 5, rise: 3.5, life: 1.1, color: 0x4a4038, jitter: 0.35 };
const BURST_FIRE: Recipe = { count: 6, size0: 0.4, size1: 1.1, speed: 3, rise: 2.5, life: 0.45, color: 0xff8a2a, jitter: 0.2 };
const SPRAY: Recipe = { count: 6, size0: 0.2, size1: 0.6, speed: 2, rise: 3, life: 0.6, color: 0xe6f4ff, jitter: 0.05 };

export class Effects extends THREE.Group {
  private readonly puffMesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private readonly rings: Ring[] = [];
  private readonly ringGeometry: THREE.RingGeometry;
  private spawned = 0;
  /** A small LCG: effects need spread, not the sim's seeded streams, but a fixed seed keeps a
   *  screenshot of the same frame the same. */
  private seed = 0x2f6b1d;
  private readonly matrixScratch = new THREE.Matrix4();
  private readonly positionScratch = new THREE.Vector3();
  private readonly scaleScratch = new THREE.Vector3();
  private readonly quaternionScratch = new THREE.Quaternion();
  private readonly colorScratch = new THREE.Color();

  constructor() {
    super();
    this.name = "effects";
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshLambertMaterial({ flatShading: true });
    this.puffMesh = new THREE.InstancedMesh(geometry, material, PUFF_CAPACITY);
    this.puffMesh.count = 0;
    // Instances move every frame and the mesh's own bounds are the unit puff at the origin.
    this.puffMesh.frustumCulled = false;
    for (let i = 0; i < PUFF_CAPACITY; i++) {
      this.puffs.push({
        active: false,
        born: 0,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 1,
        size0: 0,
        size1: 0,
        color: new THREE.Color(),
      });
      this.puffMesh.setColorAt(i, this.colorScratch.setHex(0xffffff));
    }
    this.add(this.puffMesh);

    this.ringGeometry = new THREE.RingGeometry(0.82, 1, 32);
    // Flat on the ground: the geometry is built in XY.
    this.ringGeometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_CAPACITY; i++) {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xeaf6ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.ringGeometry, ringMaterial);
      mesh.visible = false;
      this.add(mesh);
      this.rings.push({ mesh, material: ringMaterial, age: RING_LIFE_S });
    }
  }

  get activePuffs(): number {
    let n = 0;
    for (const puff of this.puffs) if (puff.active) n++;
    return n;
  }

  muzzle(x: number, y: number, z: number, club: ClubType): void {
    this.spawn(MUZZLE[club], x, y, z);
  }

  impact(x: number, y: number, z: number): void {
    this.spawn(IMPACT, x, y, z);
  }

  /** A cart going up: dark smoke and a flash of fire, about hull height. */
  burst(x: number, y: number, z: number): void {
    this.spawn(BURST, x, y + 0.6, z);
    this.spawn(BURST_FIRE, x, y + 0.9, z);
  }

  /** A cart hitting the water: a ring on the surface and a little spray. */
  splash(x: number, y: number, z: number): void {
    let ring = this.rings[0]!;
    for (const candidate of this.rings) if (candidate.age > ring.age) ring = candidate;
    ring.age = 0;
    ring.mesh.position.set(x, y + 0.05, z);
    ring.mesh.scale.setScalar(0.5);
    ring.material.opacity = 0.9;
    ring.mesh.visible = true;
    this.spawn(SPRAY, x, y + 0.2, z);
  }

  update(dt: number): void {
    let drawn = 0;
    for (const puff of this.puffs) {
      if (!puff.active) continue;
      puff.age += dt;
      if (puff.age >= puff.life) {
        puff.active = false;
        continue;
      }
      // Smoke slows as it spreads.
      const drag = Math.exp(-3 * dt);
      puff.vx *= drag;
      puff.vy *= drag;
      puff.vz *= drag;
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.z += puff.vz * dt;
      const t = puff.age / puff.life;
      // Grows, then shrinks away over its last third rather than popping out.
      const grow = puff.size0 + (puff.size1 - puff.size0) * Math.min(1, t * 1.5);
      const size = t > 2 / 3 ? grow * (1 - (t - 2 / 3) * 3) : grow;
      this.positionScratch.set(puff.x, puff.y, puff.z);
      this.scaleScratch.setScalar(Math.max(0.001, size));
      this.matrixScratch.compose(this.positionScratch, this.quaternionScratch, this.scaleScratch);
      this.puffMesh.setMatrixAt(drawn, this.matrixScratch);
      this.puffMesh.setColorAt(drawn, puff.color);
      drawn++;
    }
    this.puffMesh.count = drawn;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;

    for (const ring of this.rings) {
      if (!ring.mesh.visible) continue;
      ring.age += dt;
      if (ring.age >= RING_LIFE_S) {
        ring.mesh.visible = false;
        continue;
      }
      const t = ring.age / RING_LIFE_S;
      ring.mesh.scale.setScalar(0.5 + (RING_MAX_RADIUS - 0.5) * (1 - (1 - t) * (1 - t)));
      ring.material.opacity = 0.9 * (1 - t);
    }
  }

  /** Frees the one puff geometry, the ring geometry, and every material. */
  dispose(): void {
    this.puffMesh.geometry.dispose();
    (this.puffMesh.material as THREE.Material).dispose();
    this.puffMesh.dispose();
    this.ringGeometry.dispose();
    for (const ring of this.rings) ring.material.dispose();
    this.clear();
  }

  private spawn(recipe: Recipe, x: number, y: number, z: number): void {
    for (let i = 0; i < recipe.count; i++) {
      const puff = this.freePuff();
      puff.active = true;
      puff.born = this.spawned++;
      puff.x = x;
      puff.y = y;
      puff.z = z;
      // A random direction, biased upward.
      const a = this.random() * Math.PI * 2;
      const up = this.random();
      const speed = recipe.speed * (0.5 + this.random() * 0.5);
      puff.vx = Math.cos(a) * speed;
      puff.vz = Math.sin(a) * speed;
      puff.vy = recipe.rise * (0.4 + up * 0.6);
      puff.age = 0;
      puff.life = recipe.life * (0.75 + this.random() * 0.5);
      puff.size0 = recipe.size0;
      puff.size1 = recipe.size1 * (0.7 + this.random() * 0.6);
      puff.color.setHex(recipe.color);
      const shade = 1 - recipe.jitter * this.random();
      puff.color.multiplyScalar(shade);
    }
  }

  /** An idle puff, or the oldest live one when every slot is taken. */
  private freePuff(): Puff {
    let oldest = this.puffs[0]!;
    for (const puff of this.puffs) {
      if (!puff.active) return puff;
      if (puff.born < oldest.born) oldest = puff;
    }
    return oldest;
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
