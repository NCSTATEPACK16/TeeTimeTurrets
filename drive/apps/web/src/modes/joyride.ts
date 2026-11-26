import { joyrideChase } from '../camera/cameraConfig';
import { joyrideTuning } from '../vehicle/cartTuning';
import type { ModeConfig } from './modes';

/** Joyride: 45 mph plus boost, drifts and flips; skid marks stay until the buffer wraps. */
export const joyride: ModeConfig = {
  name: 'joyride',
  label: 'Joyride',
  cart: joyrideTuning,
  chase: joyrideChase,
  skids: { segmentsPerWheel: 4096, fadeSeconds: null },
};
