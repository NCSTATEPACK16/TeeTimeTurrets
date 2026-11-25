import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, uniform } from 'three/tsl';
import type { WheelDynamics } from '../vehicle/wheelDynamics';
import { skidLook, type SkidSettings } from './fxConfig';
import { skidTintFor } from './skidEmitter';

const VERTS_PER_QUAD = 6;
const NEVER = -1e9;

interface Trail {
  /** Last centre point laid, or null when the wheel is not skidding. */
  x: number;
  y: number;
  z: number;
  /** End edges of the last quad, so the next one joins without a gap. */
  left: [number, number, number] | null;
  right: [number, number, number] | null;
  active: boolean;
  cursor: number;
}

/**
 * Skid ribbons: one ring buffer of quads per wheel, 0.18 m wide, tinted by surface.
 * When a wheel's buffer fills, its oldest quads are overwritten. Chill marks fade with age;
 * Joyride marks stay until overwritten. Lifted 2 cm with polygon offset against z-fighting.
 */
export class SkidMarks {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly births: Float32Array;
  private readonly trails: Trail[];
  private readonly time = uniform(0);
  private readonly color = new Color();
  private clock = 0;
  private quads = 0;

  constructor(readonly settings: SkidSettings) {
    const total = 4 * settings.segmentsPerWheel * VERTS_PER_QUAD;
    this.positions = new Float32Array(total * 3);
    this.colors = new Float32Array(total * 3);
    this.births = new Float32Array(total).fill(NEVER);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('skidColor', new BufferAttribute(this.colors, 3));
    geometry.setAttribute('skidBirth', new BufferAttribute(this.births, 1));

    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      // Quad winding depends on travel direction; draw both faces.
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.colorNode = attribute('skidColor', 'vec3');
    const fade = settings.fadeSeconds;
    const age = this.time.sub(attribute('skidBirth', 'float'));
    material.opacityNode =
      fade === null
        ? float(skidLook.opacity)
        : float(1).sub(age.div(fade)).clamp(0, 1).mul(skidLook.opacity);

    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'skid-marks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.trails = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, left: null, right: null, active: false, cursor: 0 }));
  }

  /** Quads laid since creation (for the smoke test and the HUD). */
  get laid(): number {
    return this.quads;
  }

  /** Advance the fade clock and lay new quads under skidding wheels. */
  update(dt: number, wheels: readonly WheelDynamics[]): void {
    this.clock += dt;
    this.time.value = this.clock;
    for (const [i, w] of wheels.entries()) {
      const trail = this.trails[i]!;
      const tint = skidTintFor(w);
      if (!tint) {
        trail.active = false;
        trail.left = trail.right = null;
        continue;
      }
      const p = w.contactPoint;
      const y = p.y + skidLook.lift;
      if (!trail.active) {
        Object.assign(trail, { x: p.x, y, z: p.z, active: true, left: null, right: null });
        continue;
      }
      const dx = p.x - trail.x;
      const dz = p.z - trail.z;
      const len = Math.hypot(dx, dz);
      if (len > skidLook.maxJoin) {
        Object.assign(trail, { x: p.x, y, z: p.z, left: null, right: null });
        continue;
      }
      if (len < skidLook.minSegment) continue;
      const half = skidLook.width / 2;
      const px = (-dz / len) * half;
      const pz = (dx / len) * half;
      const startL = trail.left ?? [trail.x + px, trail.y, trail.z + pz];
      const startR = trail.right ?? [trail.x - px, trail.y, trail.z - pz];
      const endL: [number, number, number] = [p.x + px, y, p.z + pz];
      const endR: [number, number, number] = [p.x - px, y, p.z - pz];
      this.writeQuad(i, startL, startR, endL, endR, tint);
      Object.assign(trail, { x: p.x, y, z: p.z, left: endL, right: endR });
    }
  }

  private writeQuad(
    wheel: number,
    sl: readonly number[],
    sr: readonly number[],
    el: readonly number[],
    er: readonly number[],
    tint: string,
  ): void {
    const trail = this.trails[wheel]!;
    const quad = wheel * this.settings.segmentsPerWheel + trail.cursor;
    trail.cursor = (trail.cursor + 1) % this.settings.segmentsPerWheel;
    const v0 = quad * VERTS_PER_QUAD;
    const corners = [sl, sr, el, el, sr, er];
    this.color.set(tint);
    for (let k = 0; k < VERTS_PER_QUAD; k++) {
      const c = corners[k]!;
      this.positions.set(c, (v0 + k) * 3);
      this.colors[(v0 + k) * 3] = this.color.r;
      this.colors[(v0 + k) * 3 + 1] = this.color.g;
      this.colors[(v0 + k) * 3 + 2] = this.color.b;
      this.births[v0 + k] = this.clock;
    }
    const g = this.mesh.geometry;
    for (const [name, size] of [
      ['position', 3],
      ['skidColor', 3],
      ['skidBirth', 1],
    ] as const) {
      const attr = g.getAttribute(name) as BufferAttribute;
      attr.addUpdateRange(v0 * size, VERTS_PER_QUAD * size);
      attr.needsUpdate = true;
    }
    this.quads++;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}
