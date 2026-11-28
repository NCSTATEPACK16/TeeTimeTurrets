import * as THREE from "three";
import { Flagstick } from "../entities/Flagstick";
import { CAPTURE_RADIUS_M, NO_TEAM } from "../sim/flags";
import { teamColors } from "./teamColors";

/**
 * Capture flags A-C on the course (UI-SPEC H18, Stage 3.5c): a flagstick on each capture green,
 * its cloth in the owner's colour, a lettered card above it, and a ring on the grass at the
 * capture radius so the edge you have to be inside is visible. Render-only; `sim/flags.ts` decides
 * who owns what, and this reads `CaptureField.owner` once a frame.
 */

/** A real pin is 2.1 m and reads as a few white pixels from 100 m. A capture flag must be found. */
const FLAG_SCALE = 3;
const NEUTRAL_COLOUR = 0xf2f2ee;
/** Just off the grass, so the ring does not fight the ground for depth. */
const RING_LIFT_M = 0.12;
const RING_WIDTH_M = 0.5;
const RING_SEGMENTS = 64;
const RING_OPACITY = 0.55;
/** The letter card, above the top of the scaled pole. */
const LETTER_HEIGHT_M = 8.4;
const LETTER_SIZE_M = 2.2;
const LETTERS = ["A", "B", "C"] as const;

export interface CaptureFlagView {
  readonly objects: readonly THREE.Object3D[];
  /** Colours each flag by `owner[i]` (a team, or `NO_TEAM`) and waves the cloth. */
  update(owner: ArrayLike<number>, elapsedSeconds: number): void;
  dispose(): void;
}

function ownerColour(owner: number): number {
  return owner === NO_TEAM ? NEUTRAL_COLOUR : teamColors(owner).canopy;
}

/** A white disc with the flag's letter, as a runtime canvas texture like the tee signs' faces. */
function letterTexture(letter: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "#1d232a";
  g.stroke();
  g.fillStyle = "#1d232a";
  g.font = "bold 84px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, size / 2, size / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createCaptureFlagView(
  sites: readonly { readonly x: number; readonly z: number }[],
  heightAt: (x: number, z: number) => number,
): CaptureFlagView {
  const objects: THREE.Object3D[] = [];
  const sticks: Flagstick[] = [];
  const rings: THREE.MeshBasicMaterial[] = [];
  const disposables: { dispose(): void }[] = [];
  const shown = new Int8Array(sites.length).fill(-2);

  const ringGeometry = new THREE.RingGeometry(CAPTURE_RADIUS_M - RING_WIDTH_M, CAPTURE_RADIUS_M, RING_SEGMENTS);
  ringGeometry.rotateX(-Math.PI / 2);
  disposables.push(ringGeometry);

  sites.forEach((site, i) => {
    const y = heightAt(site.x, site.z);
    const stick = new Flagstick();
    stick.scale.setScalar(FLAG_SCALE);
    stick.position.set(site.x, y, site.z);
    sticks.push(stick);
    objects.push(stick);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: NEUTRAL_COLOUR,
      transparent: true,
      opacity: RING_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    rings.push(ringMaterial);
    disposables.push(ringMaterial);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(site.x, y + RING_LIFT_M, site.z);
    ring.name = `capture_ring_${LETTERS[i] ?? i}`;
    objects.push(ring);

    const texture = letterTexture(LETTERS[i] ?? String(i + 1));
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
    disposables.push(texture, spriteMaterial);
    const letter = new THREE.Sprite(spriteMaterial);
    letter.scale.setScalar(LETTER_SIZE_M);
    letter.position.set(site.x, y + LETTER_HEIGHT_M, site.z);
    letter.name = `capture_letter_${LETTERS[i] ?? i}`;
    objects.push(letter);
  });

  return {
    objects,
    update(owner, elapsedSeconds) {
      for (let i = 0; i < sticks.length; i++) {
        const o = owner[i] ?? NO_TEAM;
        if (shown[i] !== o) {
          shown[i] = o;
          const colour = ownerColour(o);
          sticks[i]!.setPennantColour(colour);
          rings[i]!.color.setHex(colour);
        }
        sticks[i]!.update(elapsedSeconds);
      }
    },
    dispose() {
      for (const stick of sticks) stick.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
