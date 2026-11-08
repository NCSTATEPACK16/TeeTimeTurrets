import * as THREE from "three";
import { mulberry32 } from "../sim/rng";

/**
 * The effects atlas: eight 128 px cells in a 4 x 2 grid, painted on a canvas at load time so no
 * image ships. Cell order is `SpriteFrame`'s. White on transparent throughout; each sprite is
 * tinted by its instance colour.
 *
 * An authored atlas (a CC0 pack repacked to this layout) can replace the painters later; nothing
 * else would change, since every consumer addresses cells by `SpriteFrame`.
 */

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;
const CELL = 128;

export function createSpriteAtlas(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = CELL * ATLAS_COLS;
  canvas.height = CELL * ATLAS_ROWS;
  const g = canvas.getContext("2d")!;
  const random = mulberry32(0x5eed);
  const painters = [puff, smoke, flash, spark, confetti, ring, clump, drop];
  painters.forEach((paint, i) => {
    g.save();
    g.translate((i % ATLAS_COLS) * CELL, Math.floor(i / ATLAS_COLS) * CELL);
    paint(g, random);
    g.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

type Painter = (g: CanvasRenderingContext2D, random: () => number) => void;

const C = CELL / 2;

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, number][]): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** A soft round puff: dust, steam, muzzle smoke. */
const puff: Painter = (g) => radial(g, C, C, C * 0.95, [[0, 0.9], [0.45, 0.55], [1, 0]]);

/** A lumpy smoke ball: overlapping soft blobs, so it reads as billowing rather than a disc. */
const smoke: Painter = (g, random) => {
  for (let i = 0; i < 9; i++) {
    const a = random() * Math.PI * 2;
    const d = random() * C * 0.38;
    radial(g, C + Math.cos(a) * d, C + Math.sin(a) * d, C * (0.35 + random() * 0.25), [[0, 0.55], [0.6, 0.25], [1, 0]]);
  }
};

/** A hot flash with four rays. */
const flash: Painter = (g) => {
  radial(g, C, C, C * 0.9, [[0, 1], [0.2, 0.85], [0.5, 0.25], [1, 0]]);
  g.fillStyle = "rgba(255,255,255,0.8)";
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(C, C);
    g.rotate((i * Math.PI) / 4);
    g.beginPath();
    g.ellipse(0, 0, C * 0.95, C * 0.06, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
};

/** A small, hard-cored ember. */
const spark: Painter = (g) => radial(g, C, C, C * 0.5, [[0, 1], [0.35, 0.9], [1, 0]]);

/** A confetti chip: a solid rounded rectangle. */
const confetti: Painter = (g) => {
  g.fillStyle = "#fff";
  g.beginPath();
  g.roundRect(C - 40, C - 24, 80, 48, 10);
  g.fill();
};

/** A thin ring: a shockwave or a ripple seen face-on. */
const ring: Painter = (g) => {
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(C, C, C * 0.78, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 22;
  g.stroke();
};

/** A clump of turf or sand: a few hard blobs. */
const clump: Painter = (g, random) => {
  g.fillStyle = "#fff";
  for (let i = 0; i < 6; i++) {
    const a = random() * Math.PI * 2;
    const d = random() * C * 0.35;
    g.beginPath();
    g.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, C * (0.14 + random() * 0.16), 0, Math.PI * 2);
    g.fill();
  }
};

/** A water droplet: a hard disc with a soft rim. */
const drop: Painter = (g) => radial(g, C, C, C * 0.6, [[0, 1], [0.7, 0.9], [1, 0]]);
