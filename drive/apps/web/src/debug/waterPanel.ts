import GUI from 'lil-gui';
import { envConfig } from '../env/envConfig';
import { waterUniforms } from '../env/oceanWaves';

/** Slider ranges for the water uniforms: [min, max]. */
const RANGES = {
  waveScale: [0.1, 8],
  waveHeight: [0, 1],
  drag: [0, 1],
  timeScale: [0, 3],
  exposure: [0.2, 4],
  distanceSmoothing: [0, 1],
  scatterStrength: [0, 1],
} as const;

/**
 * ?tune=1: live sliders over the water shader's uniforms (env/oceanWaves.ts). "Copy JSON" puts
 * the values on the clipboard for pasting into envConfig.water.
 */
export class WaterPanel {
  private readonly gui: GUI;

  constructor() {
    const gui = new GUI({ title: 'Water' });
    const values: Record<string, number> = {};
    for (const [key, [lo, hi]] of Object.entries(RANGES)) {
      const u = waterUniforms[key as keyof typeof RANGES];
      values[key] = u.value;
      gui.add(values, key, lo, hi).onChange((v: number) => (u.value = v));
    }
    const scatter = { scatterColor: `#${waterUniforms.scatterColor.value.getHexString()}` };
    gui.addColor(scatter, 'scatterColor').onChange((hex: string) => waterUniforms.scatterColor.value.set(hex));
    gui.add(
      {
        'Copy JSON': () =>
          void navigator.clipboard?.writeText(
            JSON.stringify(
              {
                ...values,
                scatterColor: waterUniforms.scatterColor.value.toArray().map((c) => Number(c.toFixed(4))),
                normalIterations: envConfig.water.normalIterations,
              },
              null,
              2,
            ),
          ),
      },
      'Copy JSON',
    );
    this.gui = gui;
  }

  dispose(): void {
    this.gui.destroy();
  }
}
