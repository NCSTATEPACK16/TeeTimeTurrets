import { Color, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import type { Vec3 } from '../vehicle/VehicleModel';
import type { WheelDynamics } from '../vehicle/wheelDynamics';
import { particleConfig as cfg } from './fxConfig';

type Kind = 'spray' | 'roost' | 'dust';

/**
 * Basic spray (water), roost (sand) and dust (rough, woods) from a fixed pool of instanced
 * blobs. Particles shrink as they age instead of fading, so one opaque material serves all.
 */
export class Particles {
  readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly kinds: Kind[];
  private readonly carry = [0, 0, 0, 0];
  private next = 0;
  private emitted = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly colors: Record<Kind, Color> = {
    spray: new Color(cfg.color.spray),
    roost: new Color(cfg.color.roost),
    dust: new Color(cfg.color.dust),
  };

  constructor() {
    const n = cfg.maxParticles;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(Infinity);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.kinds = new Array<Kind>(n).fill('spray');
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshBasicNodeMaterial(), n);
    this.mesh.name = 'particles';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, this.colors.spray);
  }

  /** Particles emitted since creation. */
  get total(): number {
    return this.emitted;
  }

  /** Emit from each wheel by surface and speed, then integrate and rebuild instances. */
  update(dt: number, wheels: readonly WheelDynamics[], cartVel: Vec3): void {
    for (const [i, w] of wheels.entries()) {
      const kind = this.kindFor(w);
      if (!kind || w.speed < cfg.minSpeed) {
        this.carry[i] = 0;
        continue;
      }
      const intensity = Math.min(w.speed / cfg.fullAt, 1);
      this.carry[i]! += cfg.rate[kind] * intensity * dt;
      while (this.carry[i]! >= 1) {
        this.carry[i]! -= 1;
        const y = kind === 'spray' ? w.contactPoint.y + w.waterDepth : w.contactPoint.y;
        this.spawn(kind, w.contactPoint.x, y, w.contactPoint.z, cartVel, w.speed);
      }
    }
    this.integrate(dt);
  }

  /** A burst, e.g. a splash on landing in water. */
  burst(kind: Kind, at: Vec3, count: number, speed: number): void {
    for (let i = 0; i < count; i++) this.spawn(kind, at.x, at.y, at.z, { x: 0, y: 0, z: 0 }, speed);
  }

  private kindFor(w: WheelDynamics): Kind | null {
    if (w.waterDepth > 0.05) return 'spray';
    if (!w.inContact) return null;
    if (w.material === 'bunker') return 'roost';
    if (cfg.dustSurfaces.includes(w.material)) return 'dust';
    return null;
  }

  private spawn(kind: Kind, x: number, y: number, z: number, cartVel: Vec3, speed: number): void {
    const i = this.next;
    this.next = (this.next + 1) % cfg.maxParticles;
    this.emitted++;
    const k = cfg.kick[kind] * speed;
    // Thrown back against the cart's motion, up, and scattered sideways.
    const r = () => Math.random() * 2 - 1;
    this.pos.set([x, y, z], i * 3);
    this.vel.set(
      [-cartVel.x * 0.25 + r() * k * 0.6, k * (0.6 + Math.random() * 0.6), -cartVel.z * 0.25 + r() * k * 0.6],
      i * 3,
    );
    this.age[i] = 0;
    this.life[i] = cfg.life[kind] * (0.7 + Math.random() * 0.6);
    this.size[i] = cfg.size[kind] * (0.7 + Math.random() * 0.6);
    this.grav[i] = cfg.gravity[kind];
    this.kinds[i] = kind;
  }

  private integrate(dt: number): void {
    let alive = 0;
    for (let i = 0; i < cfg.maxParticles; i++) {
      if (this.age[i]! >= this.life[i]!) continue;
      this.age[i]! += dt;
      const t = this.age[i]! / this.life[i]!;
      if (t >= 1) continue;
      this.vel[i * 3 + 1]! -= this.grav[i]! * dt;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      const scale = this.size[i]! * (1 - t * t);
      this.m.compose(this.p.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!), this.q, this.s.setScalar(scale));
      // Live particles are packed into the first instances each frame.
      this.mesh.setMatrixAt(alive, this.m);
      this.mesh.setColorAt(alive, this.colors[this.kinds[i]!]);
      alive++;
    }
    this.mesh.count = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get alive(): number {
    return this.mesh.count;
  }
}
