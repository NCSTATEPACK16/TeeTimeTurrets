import GUI from 'lil-gui';
import type { ModeName } from '../modes/modes';
import type { CartTuning } from '../vehicle/cartTuning';

/** Chassis fields RapierCart.setTuning refuses to change; shown read-only, not as sliders. */
const GEOMETRY = new Set(['mass', 'wheelbase', 'trackFront', 'trackRear', 'wheelRadius', 'body', 'centerOfMassY', 'hardpointY']);

type Obj = Record<string, unknown>;

/**
 * ?tune=1: live sliders over the current mode's cart tuning. Edits apply at once through
 * `onChange`; "Copy JSON" puts the edited preset on the clipboard for pasting into cartTuning.ts.
 */
export class TuningPanel {
  private gui: GUI | null = null;

  constructor(private readonly onChange: (mode: ModeName, t: CartTuning) => void) {}

  show(mode: ModeName, tuning: CartTuning): void {
    this.gui?.destroy();
    const edited = structuredClone(tuning);
    const gui = new GUI({ title: `Tuning · ${mode}` });
    const apply = () => this.onChange(mode, structuredClone(edited));
    this.addFields(gui, edited as unknown as Obj, apply);
    const actions = {
      'Copy JSON': () => void navigator.clipboard?.writeText(JSON.stringify(edited, null, 2)),
    };
    gui.add(actions, 'Copy JSON');
    this.gui = gui;
  }

  private addFields(gui: GUI, obj: Obj, apply: () => void, depth = 0): void {
    for (const [key, value] of Object.entries(obj)) {
      if (depth === 0 && GEOMETRY.has(key)) continue;
      if (typeof value === 'number') {
        const span = Math.max(Math.abs(value) * 3, 1);
        const lo = value < 0 ? -span : 0;
        gui.add(obj, key, lo, span).onChange(apply);
      } else if (typeof value === 'boolean') {
        gui.add(obj, key).onChange(apply);
      } else if (key === 'measure') {
        gui.add(obj, key, ['roll', 'tilt']).onChange(apply);
      } else if (value && typeof value === 'object') {
        const folder = gui.addFolder(key);
        folder.close();
        this.addFields(folder, value as Obj, apply, depth + 1);
      }
    }
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
