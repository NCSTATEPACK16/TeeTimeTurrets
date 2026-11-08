import type { EffectsLayer } from "./effects";

/**
 * The war somewhere else: distant barrages just past the fight, so the course sounds and looks
 * like one front of a bigger battle. Pure decoration -- nothing here is in the sim, and nothing
 * lands anywhere a cart can be.
 *
 * - **Barrages** of 1-3 blasts at 220-420 m from the camera, on a random bearing. Their boom is
 *   handed to `onBoom` after the distance at the speed of sound, so the flash comes first.
 * - **Flares** arc up over the clubhouse now and then.
 *
 * `heat` doubles the barrage rate in the final stretch. Seeded randomness (`fxRandom`), fixed
 * arrays, nothing allocated per frame.
 */

const SOUND_MPS = 343;
const NEAR_M = 220;
const FAR_M = 420;
/** Mean seconds between barrages at heat 1. */
const BARRAGE_EVERY_S = 7;
const FLARE_EVERY_S = 11;
const PENDING = 12;

export class BattleAmbience {
  /** 1 normally, 2 in the final stretch. */
  heat = 1;
  /** Called with a gain (0..1) and a pan (-1..1) when a distant blast's sound arrives. */
  onBoom: ((gain: number, pan: number) => void) | null = null;
  private untilBarrage: number;
  private untilFlare: number;
  private readonly pendingAt = new Float64Array(PENDING).fill(Infinity);
  private readonly pendingGain = new Float32Array(PENDING);
  private readonly pendingPan = new Float32Array(PENDING);
  /** Follow-up blasts of the current barrage: seconds until each, and where. */
  private salvo = 0;
  private salvoIn = 0;
  private salvoX = 0;
  private salvoZ = 0;
  private clock = 0;

  constructor(
    private readonly effects: EffectsLayer,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly random: () => number,
    private readonly flareAt: { x: number; z: number } | null,
  ) {
    this.untilBarrage = 2 + random() * 3;
    this.untilFlare = 4 + random() * FLARE_EVERY_S;
  }

  update(dt: number, camX: number, camZ: number, camYaw: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    const r = this.random;

    this.untilBarrage -= dt * this.heat;
    if (this.untilBarrage <= 0) {
      this.untilBarrage = BARRAGE_EVERY_S * (0.5 + r());
      const bearing = r() * Math.PI * 2;
      const d = NEAR_M + r() * (FAR_M - NEAR_M);
      this.salvoX = camX + Math.cos(bearing) * d;
      this.salvoZ = camZ + Math.sin(bearing) * d;
      this.salvo = 1 + Math.floor(r() * 3);
      this.salvoIn = 0;
    }
    if (this.salvo > 0) {
      this.salvoIn -= dt;
      if (this.salvoIn <= 0) {
        this.salvo--;
        this.salvoIn = 0.25 + r() * 0.5;
        const x = this.salvoX + (r() - 0.5) * 40;
        const z = this.salvoZ + (r() - 0.5) * 40;
        this.blast(x, z, camX, camZ, camYaw);
      }
    }

    this.untilFlare -= dt * this.heat;
    if (this.untilFlare <= 0 && this.flareAt) {
      this.untilFlare = FLARE_EVERY_S * (0.6 + r() * 0.8);
      const x = this.flareAt.x + (r() - 0.5) * 30;
      const z = this.flareAt.z + (r() - 0.5) * 30;
      this.effects.flare(x, this.heightAt(x, z) + 2, z, r() < 0.5 ? 0xff5a3a : 0x7fff6a);
    }

    for (let i = 0; i < PENDING; i++) {
      if (this.pendingAt[i]! > this.clock) continue;
      this.pendingAt[i] = Infinity;
      this.onBoom?.(this.pendingGain[i]!, this.pendingPan[i]!);
    }
  }

  private blast(x: number, z: number, camX: number, camZ: number, camYaw: number): void {
    const y = this.heightAt(x, z);
    const dx = x - camX;
    const dz = z - camZ;
    const d = Math.hypot(dx, dz);
    this.effects.distantBlast(x, y + 3, z, d / 120);
    let slot = 0;
    for (let i = 0; i < PENDING; i++) if (this.pendingAt[i] === Infinity) slot = i;
    this.pendingAt[slot] = this.clock + d / SOUND_MPS;
    this.pendingGain[slot] = Math.max(0.15, 1 - (d - NEAR_M) / (FAR_M - NEAR_M)) * 0.55;
    // The listener's right is (-sin yaw, cos yaw), as in audioDirector.
    this.pendingPan[slot] = Math.max(-1, Math.min(1, (-dx * Math.sin(camYaw) + dz * Math.cos(camYaw)) / d));
  }
}
