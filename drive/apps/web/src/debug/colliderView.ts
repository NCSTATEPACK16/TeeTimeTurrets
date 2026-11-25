import { BufferAttribute, BufferGeometry, EdgesGeometry, BoxGeometry, Group, LineBasicNodeMaterial, LineSegments } from 'three/webgpu';
import { color } from 'three/tsl';
import { xToCol, zToRow } from '@gcs/level-schema';
import type { HeightSampler } from '../level/heightSampler';
import type { CartTuning } from '../vehicle/cartTuning';
import type { RapierCart } from '../vehicle/RapierCart';

const RADIUS_CELLS = 15;
const LIFT = 0.02;
/** Slip bar height per m/s of sideways slide at the contact patch, m. */
const SLIP_SCALE = 0.4;

function lineMaterial(hex: string): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial({ depthTest: false, transparent: true });
  m.colorNode = color(hex);
  return m;
}

/**
 * ?debug=1 collider view: the chassis collider box (child of the cart view), the four
 * suspension rays, a slip bar per wheel (height = sideways slide), and the heightfield's
 * actual triangles around the cart.
 */
export class ColliderView {
  readonly world = new Group();
  readonly chassis: LineSegments;
  private readonly rays: LineSegments;
  private readonly slips: LineSegments;
  private readonly field: LineSegments;
  private readonly fieldPositions: Float32Array;

  constructor(
    tuning: CartTuning,
    private readonly heights: HeightSampler,
  ) {
    const { halfWidth: hx, halfHeight: hy, halfLength: hz } = tuning.body;
    this.chassis = new LineSegments(new EdgesGeometry(new BoxGeometry(2 * hx, 2 * hy, 2 * hz)), lineMaterial('#ff3b30'));
    this.chassis.renderOrder = 10;

    const rayGeo = new BufferGeometry();
    rayGeo.setAttribute('position', new BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    this.rays = new LineSegments(rayGeo, lineMaterial('#ffd60a'));
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 10;

    const slipGeo = new BufferGeometry();
    slipGeo.setAttribute('position', new BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    this.slips = new LineSegments(slipGeo, lineMaterial('#ff2bd6'));
    this.slips.frustumCulled = false;
    this.slips.renderOrder = 10;

    const n = 2 * RADIUS_CELLS;
    // Per cell: the top edge, the left edge and the shared diagonal; two endpoints each.
    this.fieldPositions = new Float32Array(n * n * 3 * 2 * 3);
    const fieldGeo = new BufferGeometry();
    fieldGeo.setAttribute('position', new BufferAttribute(this.fieldPositions, 3));
    this.field = new LineSegments(fieldGeo, lineMaterial('#00e5ff'));
    this.field.frustumCulled = false;
    this.field.renderOrder = 9;
    this.world.add(this.rays, this.slips, this.field);
  }

  update(cart: RapierCart): void {
    const rays = this.rays.geometry.getAttribute('position') as BufferAttribute;
    for (const [i, w] of cart.wheels().entries()) {
      const hp = cart.controller.wheelHardPoint(i);
      if (!hp) continue;
      rays.setXYZ(i * 2, hp.x, hp.y, hp.z);
      rays.setXYZ(i * 2 + 1, w.contactPoint.x, w.contactPoint.y, w.contactPoint.z);
    }
    rays.needsUpdate = true;

    const slips = this.slips.geometry.getAttribute('position') as BufferAttribute;
    for (const [i, w] of cart.dynamics().entries()) {
      const p = w.contactPoint;
      slips.setXYZ(i * 2, p.x, p.y, p.z);
      slips.setXYZ(i * 2 + 1, p.x, p.y + w.sideSlip * SLIP_SCALE, p.z);
    }
    slips.needsUpdate = true;

    const grid = this.heights.grid;
    const p = cart.position();
    const cc = Math.round(xToCol(grid, p.x));
    const rc = Math.round(zToRow(grid, p.z));
    const n = 2 * RADIUS_CELLS;
    const out = this.fieldPositions;
    let k = 0;
    const put = (r: number, c: number) => {
      const rr = Math.min(Math.max(r, 0), grid.height - 1);
      const cl = Math.min(Math.max(c, 0), grid.width - 1);
      out[k++] = (cl - (grid.width - 1) / 2) * grid.cellSize;
      out[k++] = this.heights.node(rr, cl) + LIFT;
      out[k++] = (rr - (grid.height - 1) / 2) * grid.cellSize;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const r = rc - RADIUS_CELLS + j;
        const c = cc - RADIUS_CELLS + i;
        put(r, c);
        put(r, c + 1);
        put(r, c);
        put(r + 1, c);
        put(r, c + 1);
        put(r + 1, c);
      }
    }
    (this.field.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}
