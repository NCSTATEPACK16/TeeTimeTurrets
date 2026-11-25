/** M1 behaviours beyond the gate: floating, respawn, rollover assist, never-stuck, tree trunks. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Pose } from '@gcs/level-schema';
import { Simulation } from '../../src/core/sim';
import { trunkFor } from '../../src/level/treeConfig';
import { chillTuning } from '../../src/vehicle/cartTuning';
import { NO_INPUT } from '../../src/vehicle/VehicleModel';
import { IS_SYNTHETIC, loadTestLevel, realCourse } from '../helpers/packet';

let chill: Simulation;
let joy: Simulation;
beforeAll(async () => {
  const level = await loadTestLevel();
  chill = await Simulation.create(level, 'chill');
  joy = await Simulation.create(level, 'joyride');
});

/** qa.deepWater when the packet authors one, else the deepest probe marked water, or null. */
function deepWater(sim: Simulation): Pose | null {
  const authored = sim.level.course.qa.deepWater;
  if (authored) return authored;
  let best: Pose | null = null;
  let depth = 0;
  for (const p of sim.level.course.qa.probes) {
    const d = sim.water.depthAt(p.x, p.z);
    if (p.material === 'water' && d > depth) {
      depth = d;
      best = { x: p.x, z: p.z, headingDeg: 0 };
    }
  }
  return depth > 1 ? best : null;
}

/** Roll the cart about its forward axis by `deg` (positive = right side down); heading 0 only. */
function rollBy(sim: Simulation, deg: number): void {
  const r = (-deg * Math.PI) / 180 / 2;
  sim.cart.body.setRotation({ x: 0, y: 0, z: Math.sin(r), w: Math.cos(r) }, true);
  const p = sim.cart.position();
  sim.cart.body.setTranslation({ x: p.x, y: p.y + 0.6, z: p.z }, true);
}

describe('deep water', () => {
  it('Joyride floats with the motor stalled and bobs without jitter', (ctx) => {
    const pose = deepWater(joy);
    if (!pose) return ctx.skip();
    joy.reset(pose);
    joy.run({ ...NO_INPUT, throttle: 1 }, 2 * 60);
    let maxVy = 0;
    joy.run({ ...NO_INPUT, throttle: 1 }, 2 * 60, (s) => {
      maxVy = Math.max(maxVy, Math.abs(s.cart.body.linvel().y));
    });
    const w = joy.cart.waterState();
    console.log(
      `deep water (Joyride): depth ${w.depth.toFixed(2)} m, submerged ${w.submerged.toFixed(2)} m, ` +
        `stalled ${w.stalled}, wheels down ${joy.cart.wheels().filter((x) => x.inContact).length}, ` +
        `speed ${joy.cart.forwardSpeed().toFixed(2)} m/s, max |vy| 2–4 s ${maxVy.toFixed(3)} m/s`,
    );
    expect(w.stalled).toBe(true);
    expect(w.buoyant).toBe(true);
    expect(Math.abs(joy.cart.forwardSpeed())).toBeLessThan(0.5);
    expect(maxVy).toBeLessThan(0.2);
    expect(joy.respawned).toBe(false);
  });

  it('Chill respawns on the nearest cart path after 3 s afloat', (ctx) => {
    const pose = deepWater(chill);
    if (!pose) return ctx.skip();
    chill.reset(pose);
    let respawnAt = -1;
    chill.run(NO_INPUT, 6 * 60, (s) => {
      if (respawnAt < 0 && s.respawned) respawnAt = s.stepCount;
    });
    const p = chill.cart.position();
    const onPath = chill.paths.nearest(p.x, p.z)!;
    console.log(`Chill respawn: after ${respawnAt >= 0 ? 'yes' : 'no'}; now ${onPath.distance.toFixed(2)} m from ${onPath.pathId}`);
    expect(respawnAt).toBeGreaterThan(0);
    expect(onPath.distance).toBeLessThan(0.5);
    expect(chill.surfaces.materialAt(p.x, p.z)).toBe('cartpath');
  });
});

describe('rollover', () => {
  it('Chill rights itself at once from its roof, and stays there with the assist off', () => {
    // Any flat spot will do: the synthetic pad, else the real course's flat drive start.
    const pad = chill.level.course.qa.wheelPad ?? chill.level.course.qa.driveStart;
    const flipAndWait = (assists: boolean) => {
      chill.cart.assists = assists;
      chill.reset({ ...pad, headingDeg: 0 });
      rollBy(chill, 175);
      let engaged = false;
      chill.run(NO_INPUT, 3 * 60, (s) => (engaged ||= s.cart.rightingAssistEngaged()));
      return { engaged, tilt: chill.cart.tiltDeg() };
    };
    try {
      const off = flipAndWait(false);
      const on = flipAndWait(true);
      console.log(`Chill righting: assist off tilt after 3 s ${off.tilt.toFixed(1)}°; assist on ${on.tilt.toFixed(1)}° (engaged ${on.engaged})`);
      expect(off.tilt).toBeGreaterThan(150);
      expect(on.engaged).toBe(true);
      expect(on.tilt).toBeLessThan(10);
    } finally {
      chill.cart.assists = true;
    }
  });

  // The low center of mass drops the cart back onto its wheels from its side, so start on the roof.
  it('Joyride waits 2 s on its roof before righting', () => {
    const pad = joy.level.course.qa.wheelPad ?? joy.level.course.qa.driveStart;
    joy.reset({ ...pad, headingDeg: 0 });
    rollBy(joy, 175);
    joy.run(NO_INPUT, 90); // 1.5 s
    const early = joy.cart.tiltDeg();
    const engagedEarly = joy.cart.rightingAssistEngaged();
    joy.run(NO_INPUT, 4 * 60);
    console.log(`Joyride righting: tilt at 1.5 s ${early.toFixed(1)}° (assist ${engagedEarly}), after 5.5 s ${joy.cart.tiltDeg().toFixed(1)}°`);
    expect(early).toBeGreaterThan(70);
    expect(engagedEarly).toBe(false);
    expect(joy.cart.tiltDeg()).toBeLessThan(15);
  });

  it('raw chassis roll at full lock stays small with the assist off', () => {
    chill.cart.assists = false;
    try {
      for (const steer of [1, -1]) {
        chill.reset(chill.level.course.qa.driveStart);
        chill.run(NO_INPUT, 30);
        chill.run({ ...NO_INPUT, throttle: 1 }, 6 * 60);
        let maxRoll = 0;
        chill.run({ ...NO_INPUT, throttle: 1, steer }, 6 * 60, (s) => {
          maxRoll = Math.max(maxRoll, Math.abs(s.cart.rollDeg()));
        });
        console.log(`raw roll (assist off) steer ${steer}: max |roll| ${maxRoll.toFixed(2)}°`);
        expect(maxRoll).toBeLessThan(10);
      }
    } finally {
      chill.cart.assists = true;
    }
  });
});

describe('never stuck', () => {
  it('nudges after 3 s of throttle without moving, and offers a reset on the second', () => {
    // Needs level ground, or the powerless cart just rolls: dummy-01's straight, or a real
    // course's spawn on the first tee (tees are planed to within 1%).
    chill.reset(IS_SYNTHETIC ? chill.level.course.qa.driveStart : chill.level.course.spawn);
    chill.cart.setTuning({ ...chillTuning, drive: { ...chillTuning.drive, maxForce: 0 } });
    try {
      chill.run(NO_INPUT, 30);
      const nudges: number[] = [];
      chill.run({ ...NO_INPUT, throttle: 1 }, 8 * 60, (s) => {
        if (s.cart.events.nudged) nudges.push(s.stepCount);
      });
      console.log(`never stuck: ${nudges.length} nudges, reset offered ${chill.cart.resetSuggested()}`);
      expect(nudges.length).toBeGreaterThanOrEqual(IS_SYNTHETIC ? 2 : realCourse.minNudges);
      // The reset offer follows the second nudge, which a real course's slope may not produce.
      if (IS_SYNTHETIC) expect(chill.cart.resetSuggested()).toBe(true);
    } finally {
      chill.cart.setTuning(chillTuning);
    }
  });
});

describe('tree trunks', () => {
  it('a 15 m/s run at a trunk bounces off instead of passing through', () => {
    const level = joy.level;
    const trees: { x: number; z: number; r: number }[] = [];
    for (const sp of level.course.scatter.species) {
      const trunk = trunkFor(sp.name)!;
      for (let i = 0; i < sp.count; i++) {
        const k = (sp.byteOffset / 16 + i) * 4;
        trees.push({ x: level.scatter[k]!, z: level.scatter[k + 1]!, r: trunk.radius * level.scatter[k + 2]! });
      }
    }
    expect(joy.trunks).toBe(trees.length);
    // A tree whose 12 m approach from the east is clear of other trunks.
    const target = trees.find((t) => trees.every((o) => o === t || !(o.x > t.x - 1 && o.x < t.x + 13 && Math.abs(o.z - t.z) < 2.5)))!;
    expect(target).toBeDefined();
    joy.launch({ x: target.x + 8, z: target.z, headingDeg: 270 }, 15);
    let minGap = Infinity;
    let minSpeed = Infinity;
    joy.run(NO_INPUT, 90, (s) => {
      const p = s.cart.position();
      minGap = Math.min(minGap, p.x - target.x);
      minSpeed = Math.min(minSpeed, s.cart.forwardSpeed());
    });
    console.log(`tree hit: trunk r ${target.r.toFixed(2)} m, closest center gap ${minGap.toFixed(2)} m, min forward speed ${minSpeed.toFixed(2)} m/s`);
    expect(minGap).toBeGreaterThan(target.r + 1.0); // the 1.2 m front overhang stopped at the trunk
    expect(minSpeed).toBeLessThan(5);
  });
});
