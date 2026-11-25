/**
 * Cart tuning. Every number the cart's feel depends on lives here (CLAUDE.md rule).
 * Geometry follows a Club Car Onward and is shared by both presets: switching modes
 * re-applies the feel values but never rebuilds the chassis.
 */
export interface CartTuning {
  mass: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheelRadius: number;
  /** Chassis collider half-extents; the chassis origin is the box center. Local forward is -Z. */
  body: { halfWidth: number; halfHeight: number; halfLength: number };
  /** Center of mass height in the chassis frame. Below the floor pan so Chill can't tip on normal slopes. */
  centerOfMassY: number;
  /** Suspension mount height in the chassis frame. */
  hardpointY: number;
  suspension: {
    restLength: number;
    maxTravel: number;
    /** Rapier scales these by chassis mass: static sag = g / (4 * stiffness). */
    stiffness: number;
    compression: number;
    relaxation: number;
    maxForce: number;
  };
  /** Tire grip: max friction impulse = suspension impulse * frictionSlip. */
  frictionSlip: number;
  /** Multiplier on frictionSlip for the rear (driven) wheels. */
  rearGrip: number;
  sideFrictionStiffness: number;
  drive: {
    /** Governed top speed, m/s. */
    topSpeed: number;
    reverseTopSpeed: number;
    /** Peak motor force at the rear wheels, N. */
    maxForce: number;
    /** Motor power limit, W; force tapers as power / speed above the knee. */
    power: number;
    /** Speed window below the target over which the governor fades the force out, m/s. */
    governorBand: number;
  };
  brake: {
    /** Total service brake force, N. */
    force: number;
    /** Regen drag when coasting with no pedal, N. */
    coastForce: number;
    /** Below this speed with no input the cart holds itself (auto park brake), m/s. */
    holdSpeed: number;
    /** Forward speed above which the brake pedal brakes; below it the pedal reverses, m/s. */
    reverseBelowSpeed: number;
  };
  steer: {
    maxAngleDeg: number;
    /** Steering lock at top speed; interpolated from maxAngleDeg by speed. */
    highSpeedAngleDeg: number;
    rateDegPerS: number;
    returnRateDegPerS: number;
  };
  resistance: {
    /** Rolling resistance coefficient (force = c * m * g). */
    rolling: number;
    /** Air drag, N per (m/s)^2. */
    airDrag: number;
  };
  /** Hold-to-boost. Disabled presets ignore the boost input. */
  boost: {
    enabled: boolean;
    /** Governed top speed while boosting, m/s. */
    topSpeed: number;
    /** Motor power limit while boosting, W. */
    power: number;
    /** Full meter lasts this long, s. */
    duration: number;
    /** Empty meter refills in this long while boost is released, s. */
    recharge: number;
  };
  /** Drift handbrake: rear wheels only. */
  handbrake: {
    /** Multiplier on rear grip while held (PRD: ~30%). */
    rearGrip: number;
    /** Rear brake force while held, N. */
    force: number;
    /** Yaw damping torque per rad/s while held, N·m·s; keeps drifts catchable. */
    yawDamping: number;
  };
  /** Water model; depth is water level minus ground height under the cart. */
  water: {
    /** Drag force per (m/s)^2 per meter of depth, N. */
    drag: number;
    /** Motor force fades linearly to zero at this depth, where the motor stalls, m. */
    stallDepth: number;
    /** Buoyancy starts once the chassis bottom is this far under the surface, m. */
    floatStart: number;
    /** Further submersion at which buoyancy equals the cart's weight, m. */
    floatSpan: number;
    /** Vertical velocity damping while buoyant, N·s/m (~0.7 of critical for the float spring). */
    heave: number;
    /** Steering lock multiplier in water deep enough to stall the motor. */
    steer: number;
    /** Seconds afloat before the cart respawns on the nearest path; null bobs until reset. */
    respawnAfter: number | null;
  };
  /** Righting assist. */
  rollover: {
    /** What the threshold measures: roll about the forward axis, or total tilt from upright. */
    measure: 'roll' | 'tilt';
    /** Assist engages above this angle, deg. */
    aboveDeg: number;
    /** ...after being past it this long, s. */
    delay: number;
    /** Assist releases below this angle, deg. */
    releaseDeg: number;
    /** Proportional righting torque, N·m per rad. */
    torque: number;
    /** Damping on the righting axis, N·m·s per rad. */
    damping: number;
  };
  /** Yaw torque at full steer while no wheel touches the ground, N·m. */
  airSteerTorque: number;
  /** A touchdown after at least this long airborne counts as a landing, s. */
  landingMinAir: number;
  /** Never stuck: throttle held under `speed` for `time` nudges the cart. */
  stuck: {
    speed: number;
    time: number;
    /** Nudge impulse, up and backward, N·s. */
    upImpulse: number;
    backImpulse: number;
    /** A second nudge within this long offers a reset, s. */
    offerResetWithin: number;
  };
  angularDamping: number;
  /** Extra drop height when (re)spawning, m. */
  spawnClearance: number;
}

export const chillTuning: CartTuning = {
  mass: 300,
  wheelbase: 1.66,
  trackFront: 0.91,
  trackRear: 1.02,
  wheelRadius: 0.24,
  body: { halfWidth: 0.6, halfHeight: 0.3, halfLength: 1.2 },
  centerOfMassY: -0.45,
  hardpointY: -0.1,
  suspension: {
    restLength: 0.25,
    maxTravel: 0.18,
    stiffness: 40,
    compression: 3.5,
    relaxation: 4.5,
    maxForce: 20_000,
  },
  frictionSlip: 1.2,
  rearGrip: 1.0,
  sideFrictionStiffness: 1.0,
  drive: {
    topSpeed: 6.7,
    reverseTopSpeed: 3.0,
    maxForce: 700,
    power: 2_500,
    governorBand: 0.5,
  },
  brake: {
    force: 1_800,
    coastForce: 250,
    holdSpeed: 0.15,
    reverseBelowSpeed: 0.3,
  },
  steer: {
    maxAngleDeg: 30,
    highSpeedAngleDeg: 14,
    rateDegPerS: 120,
    returnRateDegPerS: 180,
  },
  resistance: {
    rolling: 0.015,
    airDrag: 0.9,
  },
  boost: { enabled: false, topSpeed: 6.7, power: 2_500, duration: 3, recharge: 6 },
  handbrake: { rearGrip: 0.3, force: 1_800, yawDamping: 700 },
  water: {
    drag: 75,
    stallDepth: 0.6,
    floatStart: 0.25,
    floatSpan: 0.2,
    heave: 3_000,
    steer: 0.5,
    respawnAfter: 3,
  },
  rollover: { measure: 'roll', aboveDeg: 25, delay: 0, releaseDeg: 8, torque: 4_000, damping: 700 },
  airSteerTorque: 0,
  landingMinAir: 0.15,
  stuck: { speed: 0.3, time: 3, upImpulse: 900, backImpulse: 600, offerResetWithin: 10 },
  angularDamping: 0.05,
  spawnClearance: 0.05,
};

/**
 * Joyride: the souped-up fantasy cart. Same chassis; ~3 s to 13.4 m/s (30 mph), boost to
 * 15 m/s, a looser rear end, longer suspension travel, and flips allowed.
 */
export const joyrideTuning: CartTuning = {
  ...chillTuning,
  suspension: { ...chillTuning.suspension, maxTravel: 0.24, stiffness: 34, compression: 3.0, relaxation: 4.0 },
  rearGrip: 0.85,
  drive: {
    topSpeed: 13.4,
    reverseTopSpeed: 4.5,
    maxForce: 2_400,
    power: 18_000,
    governorBand: 0.6,
  },
  brake: { ...chillTuning.brake, force: 3_000 },
  steer: {
    maxAngleDeg: 30,
    highSpeedAngleDeg: 9,
    rateDegPerS: 180,
    returnRateDegPerS: 240,
  },
  boost: { enabled: true, topSpeed: 15, power: 24_000, duration: 3, recharge: 6 },
  handbrake: { rearGrip: 0.3, force: 3_000, yawDamping: 500 },
  water: { ...chillTuning.water, respawnAfter: null },
  rollover: { measure: 'tilt', aboveDeg: 70, delay: 2, releaseDeg: 15, torque: 4_000, damping: 700 },
  airSteerTorque: 250,
};

export const cartTuning = chillTuning;
