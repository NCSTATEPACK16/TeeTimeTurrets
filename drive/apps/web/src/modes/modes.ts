import type { ChaseSettings } from '../camera/cameraConfig';
import type { SkidSettings } from '../fx/fxConfig';
import type { CartTuning } from '../vehicle/cartTuning';
import { chill } from './chill';
import { joyride } from './joyride';

export type ModeName = 'chill' | 'joyride';

/** Everything a driving mode changes: cart feel, camera framing, skid persistence. */
export interface ModeConfig {
  name: ModeName;
  label: string;
  cart: CartTuning;
  chase: ChaseSettings;
  skids: SkidSettings;
}

export const MODES: Record<ModeName, ModeConfig> = { chill, joyride };

export function nextMode(name: ModeName): ModeName {
  return name === 'chill' ? 'joyride' : 'chill';
}
