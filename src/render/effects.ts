import * as THREE from "three";
import { ShardPool } from "./shardPool";
import type { BurstSpec } from "./shardPool";
import { SpriteParticles } from "./spriteParticles";
import { createSpriteAtlas } from "./spriteAtlas";
import { SpriteFrame } from "./spritePool";
import type { SpriteSpec } from "./spritePool";
import { SurfaceId } from "../sim/surfaces";

/**
 * Match effects: muzzle puffs, impact puffs, ram sparks, death bursts and water splashes. Pure
 * presentation, triggered by `MatchScreen` from `Sim.events`; nothing here feeds back into the sim.
 *
 * **One draw for every shard.** All bursts share one `InstancedMesh` of flat-shaded tetrahedra
 * with per-instance colour, fed from `ShardPool` each frame. Splashes are a small fixed pool of
 * ring meshes. Nothing is created after construction.
 *
 * **Sprites on top (Stage 3.5).** Two `SpriteParticles` layers add the soft volume shards cannot:
 * smoke, flashes, fire, dust, confetti, tyre roost and ball tracers. `smoke` blends normally;
 * `glow` is additive. Burning wrecks keep a smoke column going for `WRECK_S`, and blasts leave a
 * scorch decal that fades over `SCORCH_S`. Two more draws in all, plus one for the decals.
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

// Sprite specs. Sizes are metres across; colours are tints of the white atlas cells.
const MUZZLE_FLASH: SpriteSpec = { count: 2, speed: 1, life: 0.12, sizeStart: 1.1, sizeEnd: 0.4, gravity: 0, drag: 6, color: 0xffd27a, alpha: 1, frame: SpriteFrame.Flash, spin: 2 };
const MUZZLE_SMOKE: SpriteSpec = { count: 5, speed: 2.2, lift: 0.6, life: 1.1, sizeStart: 0.4, sizeEnd: 1.6, gravity: -0.4, drag: 2.5, color: 0xe6e3dc, alpha: 0.55, frame: SpriteFrame.Puff };
const IMPACT_FLASH: SpriteSpec = { count: 1, speed: 0, life: 0.14, sizeStart: 2.2, sizeEnd: 1, gravity: 0, drag: 0, color: 0xffe2a0, alpha: 1, frame: SpriteFrame.Flash };
const IMPACT_SMOKE: SpriteSpec = { count: 6, speed: 3, lift: 1, life: 1.2, sizeStart: 0.6, sizeEnd: 2.2, gravity: -0.6, drag: 3, color: 0xcfc8b8, alpha: 0.6, frame: SpriteFrame.Smoke, jitter: 0.3 };
const FIREBALL: SpriteSpec = { count: 14, speed: 5, lift: 2, life: 0.7, sizeStart: 1.6, sizeEnd: 3.2, gravity: -2, drag: 3.5, color: [0xffb347, 0xff7a2a, 0xffd36b], alpha: 1, frame: SpriteFrame.Smoke, jitter: 0.5, spin: 2 };
const BLAST_FLASH: SpriteSpec = { count: 1, speed: 0, life: 0.22, sizeStart: 7, sizeEnd: 3, gravity: 0, drag: 0, color: 0xfff0c8, alpha: 1, frame: SpriteFrame.Flash };
const SHOCKWAVE: SpriteSpec = { count: 1, speed: 0, life: 0.4, sizeStart: 1, sizeEnd: 9, gravity: 0, drag: 0, color: 0xffffff, alpha: 0.5, frame: SpriteFrame.Ring };
const BLAST_SMOKE: SpriteSpec = { count: 12, speed: 4, lift: 2.5, life: 2.6, sizeStart: 1.5, sizeEnd: 4.5, gravity: -0.8, drag: 2, color: [0x2c2b2a, 0x3d3a37, 0x555049], alpha: 0.8, frame: SpriteFrame.Smoke, jitter: 0.6 };
const EMBERS: SpriteSpec = { count: 16, speed: 9, lift: 4, life: 1.1, sizeStart: 0.22, sizeEnd: 0.05, gravity: 9, drag: 1, color: 0xffb04a, alpha: 1, frame: SpriteFrame.Spark };
const CONFETTI: SpriteSpec = { count: 40, speed: 7, lift: 6, life: 2.4, sizeStart: 0.28, sizeEnd: 0.22, gravity: 5, drag: 2.2, color: [0xffffff], alpha: 1, frame: SpriteFrame.Confetti, spin: 12 };
const WRECK_SMOKE: SpriteSpec = { count: 1, speed: 0.4, lift: 2.2, life: 3, sizeStart: 1.2, sizeEnd: 4, gravity: -0.3, drag: 0.6, color: [0x2a2928, 0x3a3734], alpha: 0.65, frame: SpriteFrame.Smoke, jitter: 0.4 };
const WRECK_FIRE: SpriteSpec = { count: 1, speed: 0.3, lift: 1.5, life: 0.5, sizeStart: 0.9, sizeEnd: 0.3, gravity: -1, drag: 1, color: [0xff8a2a, 0xffb347], alpha: 0.9, frame: SpriteFrame.Smoke, jitter: 0.3 };
const SPLASH_SPRAY: SpriteSpec = { count: 14, speed: 3, lift: 5, life: 0.9, sizeStart: 0.5, sizeEnd: 1.4, gravity: 7, drag: 1.5, color: 0xeaf6ff, alpha: 0.7, frame: SpriteFrame.Puff, jitter: 0.4 };
const TRACER: SpriteSpec = { count: 1, speed: 0, life: 0.28, sizeStart: 0.38, sizeEnd: 0.06, gravity: 0, drag: 0, color: 0xfff1c0, alpha: 0.85, frame: SpriteFrame.Spark };
const FLARE: SpriteSpec = { count: 1, speed: 2, lift: 22, life: 4, sizeStart: 2.4, sizeEnd: 1.4, gravity: 6, drag: 0.15, color: 0xff5a3a, alpha: 1, frame: SpriteFrame.Flash, spin: 3 };
const FLARE_TRAIL: SpriteSpec = { count: 1, speed: 1.2, lift: 21, life: 4.2, sizeStart: 0.8, sizeEnd: 3.5, gravity: 5.5, drag: 0.2, color: 0xd8d3cc, alpha: 0.35, frame: SpriteFrame.Smoke };
const SAND_PLUME: SpriteSpec = { count: 12, speed: 3.5, lift: 3.5, life: 1.4, sizeStart: 0.5, sizeEnd: 2.2, gravity: 2, drag: 2.2, color: 0xe2cf9d, alpha: 0.7, frame: SpriteFrame.Smoke, jitter: 0.3 };

/** Tyre roost per surface: what a spinning wheel throws up from it. */
const ROOST: Partial<Record<SurfaceId, SpriteSpec>> = {
  [SurfaceId.Fairway]: { count: 1, speed: 1.5, lift: 1, life: 0.6, sizeStart: 0.2, sizeEnd: 0.5, gravity: 3, drag: 2, color: 0x7fae4e, alpha: 0.55, frame: SpriteFrame.Clump, focus: 0.6 },
  [SurfaceId.Rough]: { count: 2, speed: 2.2, lift: 1.4, life: 0.7, sizeStart: 0.22, sizeEnd: 0.45, gravity: 5, drag: 1.5, color: 0x5f8a3a, alpha: 0.8, frame: SpriteFrame.Clump, focus: 0.6 },
  [SurfaceId.Green]: { count: 1, speed: 1.2, lift: 0.8, life: 0.4, sizeStart: 0.15, sizeEnd: 0.3, gravity: 4, drag: 2, color: 0x8fc25a, alpha: 0.5, frame: SpriteFrame.Clump, focus: 0.6 },
  [SurfaceId.Sand]: { count: 3, speed: 2.8, lift: 2, life: 1.1, sizeStart: 0.35, sizeEnd: 1.4, gravity: 1.5, drag: 2, color: 0xe6d3a3, alpha: 0.65, frame: SpriteFrame.Smoke, focus: 0.55 },
  [SurfaceId.Water]: { count: 3, speed: 3, lift: 3, life: 0.7, sizeStart: 0.25, sizeEnd: 0.8, gravity: 8, drag: 1, color: 0xeaf6ff, alpha: 0.7, frame: SpriteFrame.Drop, focus: 0.5 },
};

const SMOKE_CAPACITY = 1200;
const GLOW_CAPACITY = 500;
/** How long a dead cart's hulk smokes: the respawn delay, and a little after. */
const WRECK_S = 3.6;
const WRECKS = 8;
/** Smoke puffs per second from a wreck, tapering as it burns out. */
const WRECK_RATE = 9;
const SCORCHES = 32;
const SCORCH_S = 20;
const SCORCH_RADIUS_M = 1.8;

interface Wreck {
  x: number;
  y: number;
  z: number;
  age: number;
  carry: number;
}

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

  /** Smoke, dust and spray: normal blending. */
  readonly smoke: SpriteParticles;
  /** Flashes, fire, sparks and tracers: additive. */
  readonly glow: SpriteParticles;
  private readonly atlas: THREE.Texture;
  private readonly wrecks: Wreck[] = [];
  private readonly scorchTexture: THREE.Texture;
  private readonly scorchGeometry = new THREE.CircleGeometry(1, 20);
  private readonly scorchMaterial: THREE.ShaderMaterial;
  private readonly confetti: SpriteSpec;
  /** FLARE with its colour swapped per launch. */
  private readonly flareSpec: SpriteSpec = { ...FLARE };
  private readonly scorchMesh: THREE.InstancedMesh;
  private readonly scorchAge = new Float32Array(SCORCHES).fill(SCORCH_S);
  private scorchNext = 0;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normal = new THREE.Vector3();

  /**
   * `heightAt` lays scorch marks onto the ground. `confetti` is the two team colours a kill's
   * confetti is thrown in.
   */
  constructor(
    random: () => number = Math.random,
    private readonly heightAt: (x: number, z: number) => number = () => 0,
    confettiColors: readonly number[] = [0xffffff],
  ) {
    this.shards = new ShardPool(SHARD_CAPACITY, random);
    this.atlas = createSpriteAtlas();
    this.smoke = new SpriteParticles(SMOKE_CAPACITY, this.atlas, false, random);
    this.glow = new SpriteParticles(GLOW_CAPACITY, this.atlas, true, random);
    this.group.add(this.smoke.mesh, this.glow.mesh);
    for (let i = 0; i < WRECKS; i++) this.wrecks.push({ x: 0, y: 0, z: 0, age: WRECK_S, carry: 0 });

    this.confetti = { ...CONFETTI, color: confettiColors };
    // Soot discs. The instance colour's red channel is the scorch's strength, so a fading mark
    // needs no extra attribute: 1 when fresh, 0 when gone.
    this.scorchTexture = createScorchTexture();
    this.scorchMaterial = new THREE.ShaderMaterial({
      vertexShader: SCORCH_VERTEX,
      fragmentShader: SCORCH_FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMask: { value: null } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.scorchMaterial.uniforms.uMask!.value = this.scorchTexture;
    this.scorchGeometry.rotateX(-Math.PI / 2);
    this.scorchMesh = new THREE.InstancedMesh(this.scorchGeometry, this.scorchMaterial, SCORCHES);
    this.scorchMesh.frustumCulled = false;
    this.scorchMesh.renderOrder = 1;
    for (let i = 0; i < SCORCHES; i++) {
      this.scorchMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
      this.scorchMesh.setColorAt(i, this.color.setRGB(0, 0, 0));
    }
    this.group.add(this.scorchMesh);

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
    this.glow.pool.emit(x, y, z, MUZZLE_FLASH);
    this.smoke.pool.emit(x, y, z, MUZZLE_SMOKE);
  }

  impact(x: number, y: number, z: number): void {
    this.shards.burst(x, y, z, IMPACT);
    this.shards.burst(x, y, z, IMPACT_DUST);
    this.glow.pool.emit(x, y, z, IMPACT_FLASH);
    this.smoke.pool.emit(x, y, z, IMPACT_SMOKE);
  }

  /** A ball landed in a bunker: a sand plume. */
  sandPlume(x: number, y: number, z: number): void {
    this.smoke.pool.emit(x, y + 0.2, z, SAND_PLUME, 0, 1, 0);
  }

  /** One frame of tyre roost behind a wheel. `dx/dz` is backwards along the cart; `rate` 0..1. */
  roost(surface: SurfaceId, x: number, y: number, z: number, dx: number, dz: number, rate: number): void {
    const spec = ROOST[surface];
    if (!spec || rate <= 0) return;
    this.smoke.pool.emit(x, y, z, spec, dx * 0.8, 0.6, dz * 0.8, rate);
  }

  /** One tracer dot where a fast ball is now; a stream of them reads as a streak. */
  tracer(x: number, y: number, z: number): void {
    this.glow.pool.emit(x, y, z, TRACER);
  }

  /** A signal flare fired straight up, with a lazy smoke trail. */
  flare(x: number, y: number, z: number, color: number): void {
    this.flareSpec.color = color;
    this.glow.pool.emit(x, y, z, this.flareSpec, 0, 1, 0);
    this.smoke.pool.emit(x, y, z, FLARE_TRAIL, 0, 1, 0, 3);
  }

  /**
   * A far-off explosion for the ambient battle: flash and smoke only, scaled up so it reads at a
   * few hundred metres.
   */
  distantBlast(x: number, y: number, z: number, scale: number): void {
    this.glow.pool.emit(x, y, z, BLAST_FLASH, 0, 0, 0, 1);
    this.smoke.pool.emit(x, y, z, BLAST_SMOKE, 0, 1, 0, Math.max(0.5, scale * 0.6));
  }

  ram(x: number, y: number, z: number): void {
    this.shards.burst(x, y + 0.6, z, RAM_SPARKS);
  }

  death(x: number, y: number, z: number): void {
    this.shards.burst(x, y + 0.8, z, DEATH_BODY);
    this.shards.burst(x, y + 0.8, z, DEATH_FIRE);
    this.shards.burst(x, y + 1.2, z, DEATH_SMOKE);
    this.glow.pool.emit(x, y + 1, z, BLAST_FLASH);
    this.glow.pool.emit(x, y + 0.8, z, FIREBALL);
    this.glow.pool.emit(x, y + 0.8, z, EMBERS);
    this.smoke.pool.emit(x, y + 0.5, z, SHOCKWAVE);
    this.smoke.pool.emit(x, y + 1.2, z, BLAST_SMOKE);
    // Goofy on purpose: a cart goes up in a fireball *and* a shower of team-colour confetti.
    this.smoke.pool.emit(x, y + 1.2, z, this.confetti);
    this.startWreck(x, y, z);
    this.scorch(x, z);
  }

  /** A blackened patch on the ground at a blast, fading over `SCORCH_S`. */
  scorch(x: number, z: number): void {
    const i = this.scorchNext;
    this.scorchNext = (i + 1) % SCORCHES;
    this.scorchAge[i] = 0;
    // Tilt the disc to the ground's slope, from a central difference.
    const h = this.heightAt;
    const e = SCORCH_RADIUS_M;
    this.normal.set(h(x - e, z) - h(x + e, z), 2 * e, h(x, z - e) - h(x, z + e)).normalize();
    this.rotation.setFromUnitVectors(this.up, this.normal);
    this.position.set(x, h(x, z) + 0.04, z);
    const r = SCORCH_RADIUS_M * (0.8 + 0.4 * ((i * 0.618) % 1));
    this.scale.set(r, 1, r);
    this.scorchMesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    this.scorchMesh.instanceMatrix.needsUpdate = true;
  }

  private startWreck(x: number, y: number, z: number): void {
    let wreck = this.wrecks[0]!;
    for (const w of this.wrecks) if (w.age > wreck.age) wreck = w;
    wreck.x = x;
    wreck.y = y;
    wreck.z = z;
    wreck.age = 0;
    wreck.carry = 0;
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
    this.smoke.pool.emit(x, y + 0.2, z, SPLASH_SPRAY, 0, 1, 0);
    // The oldest ring is the one to reuse: it has faded the furthest.
    let ring = this.rings[0]!;
    for (const r of this.rings) if (r.age > ring.age) ring = r;
    ring.age = 0;
    ring.mesh.position.set(x, y + 0.05, z);
    ring.mesh.visible = true;
  }

  update(dt: number): void {
    this.updateWrecks(dt);
    this.smoke.update(dt);
    this.glow.update(dt);
    this.updateScorches(dt);
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

  private updateWrecks(dt: number): void {
    for (const w of this.wrecks) {
      if (w.age >= WRECK_S) continue;
      w.age += dt;
      const burn = Math.max(0, 1 - w.age / WRECK_S);
      w.carry += dt * WRECK_RATE * burn;
      while (w.carry >= 1) {
        w.carry -= 1;
        this.smoke.pool.emit(w.x, w.y + 0.9, w.z, WRECK_SMOKE);
        if (burn > 0.35) this.glow.pool.emit(w.x, w.y + 0.7, w.z, WRECK_FIRE);
      }
    }
  }

  private updateScorches(dt: number): void {
    let dirty = false;
    for (let i = 0; i < SCORCHES; i++) {
      const age = this.scorchAge[i]!;
      if (age >= SCORCH_S) continue;
      const next = Math.min(SCORCH_S, age + dt);
      this.scorchAge[i] = next;
      // Full strength for the first half, then fading out.
      const strength = Math.min(1, (1 - next / SCORCH_S) * 2);
      this.scorchMesh.setColorAt(i, this.color.setRGB(strength, strength, strength));
      dirty = true;
    }
    if (dirty && this.scorchMesh.instanceColor) this.scorchMesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.shards.clear();
    this.smoke.pool.clear();
    this.glow.pool.clear();
    for (const w of this.wrecks) w.age = WRECK_S;
    this.scorchAge.fill(SCORCH_S);
    for (let i = 0; i < SCORCHES; i++) this.scorchMesh.setColorAt(i, this.color.setRGB(0, 0, 0));
    if (this.scorchMesh.instanceColor) this.scorchMesh.instanceColor.needsUpdate = true;
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
    this.smoke.dispose();
    this.glow.dispose();
    this.atlas.dispose();
    this.scorchGeometry.dispose();
    this.scorchMaterial.dispose();
    this.scorchTexture.dispose();
    this.scorchMesh.dispose();
    this.group.clear();
  }
}

const SCORCH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vStrength;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vStrength = instanceColor.r;
    vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SCORCH_FRAGMENT = /* glsl */ `
  uniform sampler2D uMask;
  varying vec2 vUv;
  varying float vStrength;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(uMask, vUv).a * vStrength * 0.85;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.09, 0.075, 0.06, a);
    #include <fog_fragment>
  }
`;

/** The scorch disc's mask, in alpha: solid at the centre, ragged, fading out at the rim. */
function createScorchTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.75)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  // A ragged edge, so it reads as a burn rather than a decal.
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = c * (0.8 + 0.2 * Math.sin(i * 2.7) * Math.cos(i * 1.3));
    if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    else g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.fill();
  return new THREE.CanvasTexture(canvas);
}
