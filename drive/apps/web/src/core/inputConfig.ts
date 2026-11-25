/** Key and gamepad bindings. Key names are KeyboardEvent.code values. */
export const inputConfig = {
  keys: {
    throttle: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    handbrake: ['Space'],
    boost: ['ShiftLeft', 'ShiftRight'],
    reset: ['KeyR'],
    mode: ['KeyM'],
  },
  /** Standard Gamepad mapping indices (https://w3c.github.io/gamepad/#remapping). */
  gamepad: {
    steerAxis: 0,
    throttleButton: 7, // right trigger
    brakeButton: 6, // left trigger
    handbrakeButton: 0, // A / Cross
    boostButton: 5, // right bumper
    resetButton: 3, // Y / Triangle
    modeButton: 8, // Back / Select
    deadzone: 0.15,
    triggerDeadzone: 0.05,
  },
  /** Menu keys (title, ride select, pause). */
  menuKeys: {
    confirm: ['Enter', 'NumpadEnter'],
    back: ['Escape', 'Backspace'],
    pause: ['Escape'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
  },
  /** Menu gamepad buttons (standard mapping) and the stick deflection that counts as a nudge. */
  menuPad: {
    confirm: 0, // A / Cross
    back: 1, // B / Circle
    start: 9, // Start / Options
    left: 14, // d-pad left
    right: 15, // d-pad right
    axis: 0,
    axisThreshold: 0.6,
  },
} as const;
