import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Node,
} from 'three/webgpu';
import {
  frontFacing,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  normalLocal,
  positionGeometry,
  positionLocal,
  select,
  sin,
  texture,
  time,
  uv,
  varying,
  vec2,
} from 'three/tsl';
import type { HolesJson } from '@gcs/level-schema';
// The Tee Time Links logo: one file at the repo root, shared with TeeTimeTurrets' title.
import logoUrl from '../../../../../art/brand/tee-time-links.svg?url';
import type { Vec3Like } from '../level/heightSampler';
import { mergeColoured } from './colouredGeometry';
import { envConfig } from './envConfig';

/*
 * One oversized flag on every pin: a 4 m pole and a 1.6 x 1.1 m cloth that waves a little, showing
 * the compact logo, the hole number and its par. The idea is Turrets' src/entities/Flagstick.ts
 * (pennant wave, felled state); the code is free drive's own, on node materials and TSL.
 *
 * Draws: 2 for all 18 flags (an instanced pole, an instanced cloth). No collider: a cart passing
 * through a pin knocks it over (FlagKnocks), and it stands back up a few seconds later.
 */

type Hole = HolesJson['holes'][number];
const cfg = envConfig.flags;

export interface FlagPlacement {
  readonly hole: number;
  readonly par: number;
  /** The pole's foot: the pin, on the ground. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Three `rotation.y` of the cloth at rest: its front face (local +Z) looks back at the tee. */
  readonly clothYaw: number;
  /** Start of this flag's wave cycle, radians, so 18 flags don't wave in step. */
  readonly phase: number;
  /** The text its atlas cell is drawn from: the hole number and "PAR p". */
  readonly lines: readonly [string, string];
}

export function flagFaceLines(hole: Hole): [string, string] {
  return [`${hole.number}`, `PAR ${hole.par}`];
}

/** One flag per hole at its pin, standing on the ground, in hole order (the atlas cell order). */
export function placeHoleFlags(holes: readonly Hole[], heightAt: (x: number, z: number) => number): FlagPlacement[] {
  return [...holes]
    .sort((a, b) => a.number - b.number)
    .map((hole) => {
      const { x, z } = hole.pin;
      return {
        hole: hole.number,
        par: hole.par,
        x,
        y: heightAt(x, z),
        z,
        // rotation.y takes local +Z to (sin yaw, cos yaw): point it from the pin to the tee.
        clothYaw: Math.atan2(hole.tee.x - x, hole.tee.z - z),
        // The golden angle spreads the phases evenly whatever the hole count.
        phase: (hole.number * 2.399963) % (Math.PI * 2),
        lines: flagFaceLines(hole),
      };
    });
}

/** How one flag stands this instant. `tilt` turns the pole about the horizontal (axisX, 0, axisZ). */
export interface FlagPose {
  tilt: number;
  axisX: number;
  axisZ: number;
  /** The cloth's yaw about the pole. */
  yaw: number;
  /** Lift of the pole's foot, so a felled pole lies on the ground rather than half in it. */
  lift: number;
  /** Wave strength, 1 standing and 0 lying down, so a flat cloth doesn't ripple into the green. */
  wave: number;
}

/**
 * Knock-over state for every flag, on its own clock (fixed steps). A pure function of the steps it
 * is given: no renderer, no wall clock. The browser and test/env/holeFlags.test.ts drive the same
 * object.
 */
export class FlagKnocks {
  private clock = 0;
  /** Clock time of the knock, or NaN while standing. */
  private readonly knockedAt: Float64Array;
  private readonly fallAngle: Float64Array;
  private readonly axisX: Float64Array;
  private readonly axisZ: Float64Array;
  /** Yaw the cloth swings through as it falls, so it lands flat across the fall line. */
  private readonly yawSwing: Float64Array;
  private down = 0;

  constructor(
    readonly flags: readonly FlagPlacement[],
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    const n = flags.length;
    this.knockedAt = new Float64Array(n).fill(Number.NaN);
    this.fallAngle = new Float64Array(n);
    this.axisX = new Float64Array(n).fill(1);
    this.axisZ = new Float64Array(n);
    this.yawSwing = new Float64Array(n);
  }

  /** Flags not standing upright after the latest step. */
  get moving(): number {
    return this.down;
  }

  /** The fall angle (radians) a knocked flag tips to; 0 if it was never knocked. */
  restAngle(i: number): number {
    return this.fallAngle[i]!;
  }

  /** Advance `dt` seconds and knock over any standing flag the cart is passing through. */
  step(dt: number, cart: Vec3Like, velocity: Vec3Like): void {
    this.clock += dt;
    const { reachM, minSpeed, standAfterS, riseS } = cfg.knock;
    const reach = cfg.pole.height;
    const speed = Math.hypot(velocity.x, velocity.z);
    let down = 0;
    for (let i = 0; i < this.flags.length; i++) {
      const at = this.knockedAt[i]!;
      if (!Number.isNaN(at)) {
        if (this.clock - at < standAfterS + riseS) {
          down++;
          continue;
        }
        this.knockedAt[i] = Number.NaN;
      }
      if (speed <= minSpeed) continue;
      const f = this.flags[i]!;
      const dx = f.x - cart.x;
      const dz = f.z - cart.z;
      const dy = cart.y - f.y;
      const d = Math.hypot(dx, dz);
      if (d > reachM || dy < -reach || dy > reach) continue;
      // Away from the cart; straight along its travel if it is right on the pin.
      if (d > 1e-3) this.knock(i, dx / d, dz / d);
      else this.knock(i, velocity.x / speed, velocity.z / speed);
      down++;
    }
    this.down = down;
  }

  /** Flag i's pose now. Writes into `out`; allocation-free with a reused one. */
  pose(i: number, out: FlagPose = { tilt: 0, axisX: 1, axisZ: 0, yaw: 0, lift: 0, wave: 1 }): FlagPose {
    const k = this.fallen(i);
    out.tilt = this.fallAngle[i]! * k;
    out.axisX = this.axisX[i]!;
    out.axisZ = this.axisZ[i]!;
    out.yaw = this.flags[i]!.clothYaw + this.yawSwing[i]! * k;
    out.lift = cfg.pole.radius * k;
    out.wave = 1 - k;
    return out;
  }

  /** 0 standing, 1 lying down: eased in like a fall, eased out as it stands. */
  private fallen(i: number): number {
    const at = this.knockedAt[i]!;
    if (Number.isNaN(at)) return 0;
    const age = this.clock - at;
    const { fallS, standAfterS, riseS } = cfg.knock;
    if (age < fallS) {
      const t = age / fallS;
      return t * t;
    }
    if (age < standAfterS) return 1;
    if (age < standAfterS + riseS) {
      const t = (age - standAfterS) / riseS;
      return 1 - t * t * (3 - 2 * t);
    }
    return 0;
  }

  /** Tip flag i over toward the unit direction (dx, dz). */
  private knock(i: number, dx: number, dz: number): void {
    const f = this.flags[i]!;
    const length = cfg.pole.height;
    const { minFallDeg, maxFallDeg } = cfg.knock;
    // Tip far enough that the top rests on the ground where it lands.
    const drop = (this.heightAt(f.x + dx * length, f.z + dz * length) - f.y) / length;
    const lo = Math.cos((maxFallDeg * Math.PI) / 180);
    const hi = Math.cos((minFallDeg * Math.PI) / 180);
    this.fallAngle[i] = Math.acos(Math.min(Math.max(drop, lo), hi));
    // Turning about up x d by a positive angle takes up toward d.
    this.axisX[i] = dz;
    this.axisZ[i] = -dx;
    // Swing the cloth to face along the fall line (its free edge across it), whichever way is nearer:
    // tipped over, it then lies flat instead of standing on its edge.
    let swing = wrapPi(Math.atan2(dx, dz) - f.clothYaw);
    if (swing > Math.PI / 2) swing -= Math.PI;
    else if (swing < -Math.PI / 2) swing += Math.PI;
    this.yawSwing[i] = swing;
    this.knockedAt[i] = this.clock;
  }
}

function wrapPi(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

const _tip = new Quaternion();
const _yaw = new Quaternion();
const _axis = new Vector3();
const _up = new Vector3(0, 1, 0);
const _foot = new Vector3();
const _one = new Vector3(1, 1, 1);

/** The flag's instance matrix: foot at the pin, tipped by the pose, cloth turned about the pole. */
export function flagMatrix(flag: FlagPlacement, pose: FlagPose, out: Matrix4 = new Matrix4()): Matrix4 {
  _axis.set(pose.axisX, 0, pose.axisZ);
  if (pose.tilt === 0 || _axis.lengthSq() === 0) _tip.identity();
  else _tip.setFromAxisAngle(_axis.normalize(), pose.tilt);
  _yaw.setFromAxisAngle(_up, pose.yaw);
  return out.compose(_foot.set(flag.x, flag.y + pose.lift, flag.z), _tip.multiply(_yaw), _one);
}

// --- rendering (browser) -------------------------------------------------------------------------

export interface HoleFlags {
  readonly group: Group;
  readonly placements: readonly FlagPlacement[];
  readonly knocks: FlagKnocks;
  /** Every fixed step: the knock-over check against the cart. */
  step(dt: number, cart: Vec3Like, velocity: Vec3Like): void;
  /** Every frame: write the poses of any flag that is falling, down or standing up. */
  update(): void;
  /** Draw the cloth atlas once fonts and the logo are ready. The flags show plain cloth until then. */
  paintFaces(): Promise<void>;
  dispose(): void;
}

export function createHoleFlags(holes: readonly Hole[], heights: { heightAt(x: number, z: number): number }): HoleFlags {
  const heightAt = (x: number, z: number) => heights.heightAt(x, z);
  const placements = placeHoleFlags(holes, heightAt);
  const knocks = new FlagKnocks(placements, heightAt);
  const n = placements.length;
  const { atlas } = cfg.face;

  const canvas = document.createElement('canvas');
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = cfg.face.cloth;
  ctx.fillRect(0, 0, atlas.width, atlas.height);
  const faceTexture = new CanvasTexture(canvas);
  faceTexture.colorSpace = SRGBColorSpace;
  faceTexture.anisotropy = cfg.face.anisotropy;

  // Per flag: the atlas cell's corner (u0, v0) and the wave's phase. Canvas row 0 is the top (v = 1).
  const cells = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  placements.forEach((p, i) => {
    const col = i % atlas.cols;
    const row = Math.floor(i / atlas.cols);
    cells.setXYZ(i, (col * atlas.cellW) / atlas.width, 1 - ((row + 1) * atlas.cellH) / atlas.height, p.phase);
  });
  const waves = new InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
  waves.setUsage(DynamicDrawUsage);

  const poleGeometry = buildPoleGeometry();
  const poleMaterial = new MeshStandardNodeMaterial({ vertexColors: true, roughness: cfg.pole.roughness, metalness: 0 });
  const poles = new InstancedMesh(poleGeometry, poleMaterial, n);
  poles.name = 'hole-flag-poles';

  const clothGeometry = buildClothGeometry();
  const clothMaterial = buildClothMaterial(faceTexture, cells, waves);
  const cloths = new InstancedMesh(clothGeometry, clothMaterial, n);
  cloths.name = 'hole-flag-cloths';

  // The instances span the course and move when knocked; a whole-course bound is always in view anyway.
  poles.frustumCulled = false;
  cloths.frustumCulled = false;

  const group = new Group();
  group.name = 'hole-flags';
  group.add(poles, cloths);

  const pose: FlagPose = { tilt: 0, axisX: 1, axisZ: 0, yaw: 0, lift: 0, wave: 1 };
  const matrix = new Matrix4();
  const writeAll = () => {
    for (let i = 0; i < n; i++) {
      knocks.pose(i, pose);
      flagMatrix(placements[i]!, pose, matrix);
      poles.setMatrixAt(i, matrix);
      cloths.setMatrixAt(i, matrix);
      waves.setX(i, pose.wave);
    }
    poles.instanceMatrix.needsUpdate = true;
    cloths.instanceMatrix.needsUpdate = true;
    waves.needsUpdate = true;
  };
  writeAll();
  // One more write after the last flag is upright, so it is drawn standing.
  let wasMoving = false;

  return {
    group,
    placements,
    knocks,
    step: (dt, cart, velocity) => knocks.step(dt, cart, velocity),
    update: () => {
      const moving = knocks.moving > 0;
      if (moving || wasMoving) writeAll();
      wasMoving = moving;
    },
    paintFaces: async () => {
      await paintFlagAtlas(ctx, placements);
      faceTexture.needsUpdate = true;
    },
    dispose: () => {
      poles.dispose();
      cloths.dispose();
      poleGeometry.dispose();
      clothGeometry.dispose();
      poleMaterial.dispose();
      clothMaterial.dispose();
      faceTexture.dispose();
    },
  };
}

/** The white pole and its ink ferrule, base at y = 0, one geometry with vertex colours. */
function buildPoleGeometry(): BufferGeometry {
  const { pole, ferrule } = cfg;
  const shaft = new CylinderGeometry(pole.radius, pole.radius, pole.height, pole.segments).translate(0, pole.height / 2, 0);
  const band = new CylinderGeometry(ferrule.radius, ferrule.radius, ferrule.height, pole.segments).translate(
    0,
    ferrule.bottom + ferrule.height / 2,
    0,
  );
  const merged = mergeColoured([
    { geometry: shaft, color: pole.color },
    { geometry: band, color: ferrule.color },
  ]);
  shaft.dispose();
  band.dispose();
  return merged;
}

/** The cloth at rest in the flag's frame: hoist edge on the pole's surface, top just under its top. */
function buildClothGeometry(): BufferGeometry {
  const { cloth, pole } = cfg;
  return new PlaneGeometry(cloth.width, cloth.height, cloth.segmentsX, cloth.segmentsY).translate(
    pole.radius + cloth.width / 2,
    pole.height - cloth.topGap - cloth.height / 2,
    0,
  );
}

function buildClothMaterial(
  atlasTexture: CanvasTexture,
  cells: InstancedBufferAttribute,
  waves: InstancedBufferAttribute,
): MeshStandardNodeMaterial {
  const { cloth, pole, wave, face } = cfg;
  const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: cloth.roughness, metalness: 0 });
  // Facets from the displaced surface itself, so the wave reads in the light without a normal pass.
  material.flatShading = true;

  const cell = instancedBufferAttribute(cells, 'vec3') as Node<'vec3'>;
  const strength = instancedDynamicBufferAttribute(waves, 'float') as Node<'float'>;
  // Instancing runs before positionNode in three 0.186 (NodeMaterial.setupPosition): positionLocal
  // and normalLocal are already in the flag's placed frame, while positionGeometry is the rest cloth.
  const along = positionGeometry.x.sub(pole.radius).div(cloth.width).clamp(0, 1);
  const crest = sin(along.mul(wave.waves * Math.PI * 2).sub(time.mul(wave.rate)).add(cell.z));
  material.positionNode = positionLocal.add(normalLocal.mul(along.mul(crest).mul(strength).mul(wave.amplitude)));

  // Two-sided: seen from the back, read the cell mirrored, so the number is the right way round.
  const local = uv();
  const u = select(frontFacing, local.x, local.x.oneMinus());
  const corner = varying(cell.xy) as Node<'vec2'>;
  const atlasUv = vec2(u.mul(face.atlas.cellW / face.atlas.width), local.y.mul(face.atlas.cellH / face.atlas.height)).add(
    corner,
  );
  material.colorNode = texture(atlasTexture, atlasUv);
  return material;
}

/** Draw every cell: the compact mark on the hoist side, the hole number, and its par. */
async function paintFlagAtlas(ctx: CanvasRenderingContext2D, placements: readonly FlagPlacement[]): Promise<void> {
  const f = cfg.face;
  await Promise.all([document.fonts.load(f.number.font, '0123456789'), document.fonts.load(f.par.font, 'PAR 0123456789')]);
  await document.fonts.ready;
  let logo: HTMLImageElement | null = new Image();
  // The square compact mark is the SVG's #mark view. Its natural size is 150 x 150, so it is drawn at
  // an explicit size below.
  logo.src = `${logoUrl}#mark`;
  try {
    await logo.decode();
  } catch (err) {
    console.warn('hole flags: the logo did not decode; drawing the cloths without it', err);
    logo = null;
  }

  const { atlas } = f;
  ctx.fillStyle = f.cloth;
  ctx.fillRect(0, 0, atlas.width, atlas.height);
  placements.forEach((p, i) => {
    const x = (i % atlas.cols) * atlas.cellW;
    const y = Math.floor(i / atlas.cols) * atlas.cellH;
    ctx.strokeStyle = f.border.color;
    ctx.lineWidth = f.border.width;
    ctx.strokeRect(x + f.border.inset, y + f.border.inset, atlas.cellW - 2 * f.border.inset, atlas.cellH - 2 * f.border.inset);
    if (logo) ctx.drawImage(logo, x + f.logo.x, y + (atlas.cellH - f.logo.size) / 2, f.logo.size, f.logo.size);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f.number.font;
    ctx.lineJoin = 'round';
    ctx.lineWidth = f.number.outlineWidth;
    ctx.strokeStyle = f.number.outline;
    ctx.strokeText(p.lines[0], x + f.number.x, y + f.number.y, f.number.maxWidth);
    ctx.fillStyle = f.number.fill;
    ctx.fillText(p.lines[0], x + f.number.x, y + f.number.y, f.number.maxWidth);
    ctx.font = f.par.font;
    ctx.fillStyle = f.par.fill;
    ctx.fillText(p.lines[1], x + f.par.x, y + f.par.y);
  });
}
