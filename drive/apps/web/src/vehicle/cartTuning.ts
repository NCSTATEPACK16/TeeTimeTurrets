/**
 * Cart tuning. Every number the cart's feel depends on lives here (CLAUDE.md rule).
 * Geometry matches the TeeTimeTurrets cart model (`src/entities/graphs/cart.json`) and is shared
 * by both presets: switching modes re-applies the feel values but never rebuilds the chassis.
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
    /** Steering lock at low speed, deg. */
    maxAngleDeg: number;
    /**
     * Heading rate the lock aims for, rad/s: above the speed where maxAngleDeg gives this rate,
     * the lock shrinks to atan(yawRate × wheelbase ÷ speed). Turrets turns at 2.4 rad/s.
     */
    yawRate: number;
    /** The lock never drops below this, however fast the cart goes, deg. */
    minAngleDeg: number;
    rateDegPerS: number;
    returnRateDegPerS: number;
  };
  /** Turrets' drive feel (`src/sim/entities/Cart.ts` CART_TUNING), layered on the motor force. */
  feel: {
    /** Fraction of the motor force that arrives the instant the pedal opens. */
    spoolInstant: number;
    /** The rest ramps in linearly over this long, s. A change of direction or a release restarts it. */
    spoolSeconds: number;
    /** The governed top speed drops by this fraction at full steer. */
    turnBleed: number;
    /** The governed top speed rises by this much per unit of downhill grade (rise over run)... */
    downhillPerGrade: number;
    /** ...up to this multiple. */
    downhillMaxScale: number;
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
  // The model's wheels: x ±0.68, z +0.76 and −0.78, radius 0.3 (cart.json wheel_* under chassis_pan).
  wheelbase: 1.54,
  trackFront: 1.36,
  trackRear: 1.36,
  wheelRadius: 0.3,
  // chassis_pan is 1.26 × 2.2. The box spans the model from the pan's underside (0.27 m above the
  // ground) to the hood's top, so its centre sits 0.57 m above the ground at rest length.
  body: { halfWidth: 0.63, halfHeight: 0.3, halfLength: 1.1 },
  centerOfMassY: -0.43,
  // Wheel centre at rest length: hardpointY − restLength = 0.3 − 0.57, the model's 0.3 m axle height.
  hardpointY: -0.02,
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
    maxAngleDeg: 25,
    yawRate: 2.4,
    minAngleDeg: 9,
    rateDegPerS: 120,
    returnRateDegPerS: 180,
  },
  feel: {
    spoolInstant: 0.25,
    spoolSeconds: 0.6,
    turnBleed: 0.15,
    downhillPerGrade: 1.0,
    downhillMaxScale: 1.15,
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
 * Joyride: the Turrets cart's numbers (`src/sim/entities/Cart.ts` CART_TUNING) on the raycast
 * vehicle. 20 m/s top and 7 m/s reverse; 16 m/s² of drive (4,800 N at 300 kg) held to 15 m/s by
 * 72 kW; 24 m/s² of brake; about 3.5 m/s² of coast with the drag; boost to 24 m/s. A looser rear
 * end, longer suspension travel, and flips allowed.
 *
 * Steering aims for Turrets' 2.4 rad/s of heading. Up to 8 m/s the raycast car gets it. Above
 * that the tyres cannot: 2.4 rad/s at 20 m/s is 48 m/s², about 4.9 g, which a tilting raycast car
 * slides or rolls out of. The lock still asks for it, and the grip decides what it gets.
 */
export const joyrideTuning: CartTuning = {
  ...chillTuning,
  suspension: { ...chillTuning.suspension, maxTravel: 0.24, stiffness: 34, compression: 3.0, relaxation: 4.0 },
  rearGrip: 0.85,
  drive: {
    topSpeed: 20,
    reverseTopSpeed: 7,
    maxForce: 4_800,
    power: 72_000,
    governorBand: 0.6,
  },
  // 1,050 N is Turrets' 3.5 m/s² coast at 300 kg; drag and rolling resistance supply about 200 N of it.
  brake: { ...chillTuning.brake, force: 7_200, coastForce: 850 },
  steer: {
    maxAngleDeg: 25,
    yawRate: 2.4,
    minAngleDeg: 9,
    rateDegPerS: 180,
    returnRateDegPerS: 240,
  },
  boost: { enabled: true, topSpeed: 24, power: 96_000, duration: 3, recharge: 6 },
  handbrake: { rearGrip: 0.3, force: 3_000, yawDamping: 500 },
  // Drag doubled with the motor (2,400 to 4,800 N), so 0.5 m of water still holds it to the same
  // wading speed, about 3.3 m/s (M1 gate, test/vehicle/waterEntry.test.ts).
  water: { ...chillTuning.water, drag: 150, respawnAfter: null },
  rollover: { measure: 'tilt', aboveDeg: 70, delay: 2, releaseDeg: 15, torque: 4_000, damping: 700 },
  airSteerTorque: 250,
};

export const cartTuning = chillTuning;
