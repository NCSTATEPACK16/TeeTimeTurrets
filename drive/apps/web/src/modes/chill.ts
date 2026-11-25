import { chillChase } from '../camera/cameraConfig';
import { chillTuning } from '../vehicle/cartTuning';
import type { ModeConfig } from './modes';

/** Chill: 15 mph, forgiving, light skid marks that fade after 60 s. */
export const chill: ModeConfig = {
  name: 'chill',
  label: 'Chill',
  cart: chillTuning,
  chase: chillChase,
  skids: { segmentsPerWheel: 512, fadeSeconds: 60 },
};
