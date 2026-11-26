import { describe, expect, it } from 'vitest';
import { ChaseCamera, type V3 } from '../../src/camera/chase';
import { chillChase, joyrideChase } from '../../src/camera/cameraConfig';

const flat = () => 0;

function simulate(fps: number, seconds: number, cart: (t: number) => V3, forward: V3): ChaseCamera {
  const cam = new ChaseCamera();
  cam.snap(cart(0), forward, flat);
  const dt = 1 / fps;
  for (let i = 1; i <= Math.round(seconds * fps); i++) cam.update(dt, cart(i * dt), forward, flat);
  return cam;
}

describe('ChaseCamera', () => {
  it('rests behind and above the cart, looking ahead of it', () => {
    const cam = new ChaseCamera();
    cam.snap({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, flat); // facing north
    expect(cam.position.z).toBeCloseTo(chillChase.distance, 9);
    expect(cam.position.y).toBeCloseTo(chillChase.height, 9);
    expect(cam.target.z).toBeCloseTo(-chillChase.lookAhead, 9);
  });

  it('converges to the same place at 30 and 144 fps after the cart stops', () => {
    const forward = { x: 1, y: 0, z: 0 };
    const cart = (t: number) => ({ x: Math.min(t, 2) * 6.7, y: 0, z: 0 });
    const a = simulate(30, 6, cart, forward);
    const b = simulate(144, 6, cart, forward);
    expect(Math.abs(a.position.x - b.position.x)).toBeLessThan(1e-3);
    expect(Math.abs(a.target.x - b.target.x)).toBeLessThan(1e-3);
  });

  it('lags a moving cart by about the same distance at any frame rate', () => {
    const forward = { x: 1, y: 0, z: 0 };
    const cart = (t: number) => ({ x: t * 6.7, y: 0, z: 0 });
    const a = simulate(30, 3, cart, forward);
    const b = simulate(144, 3, cart, forward);
    expect(Math.abs(a.position.x - b.position.x)).toBeLessThan(0.15);
  });

  it('stays above the ground and keeps its heading when the cart points straight up', () => {
    const cam = new ChaseCamera();
    const hill = (x: number) => (x < -3 ? 10 : 0);
    cam.snap({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, hill);
    expect(cam.position.y).toBeGreaterThanOrEqual(10 + chillChase.minGroundClearance - 1e-9);
    cam.update(1 / 60, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, hill);
    expect(cam.target.x).toBeGreaterThan(0);
  });
});

describe('ChaseCamera mode presets', () => {
  const forward = { x: 0, y: 0, z: -1 };
  const origin = { x: 0, y: 0, z: 0 };

  it('Joyride widens the FOV with speed; Chill does not', () => {
    const joy = new ChaseCamera(joyrideChase);
    const calm = new ChaseCamera(chillChase);
    for (const cam of [joy, calm]) {
      cam.snap(origin, forward, flat);
      for (let i = 0; i < 300; i++) cam.update(1 / 60, origin, forward, flat, { speed: joyrideChase.fovKickTo });
    }
    expect(joy.fovDeg).toBeCloseTo(joyrideChase.fovDeg + joyrideChase.fovKickDeg, 1);
    expect(calm.fovDeg).toBeCloseTo(chillChase.fovDeg, 6);
  });

  it('landing shake moves the camera and dies out', () => {
    const cam = new ChaseCamera(joyrideChase);
    cam.snap(origin, forward, flat);
    const rest = { ...cam.position };
    cam.addShake(6);
    let maxOffset = 0;
    for (let i = 0; i < 20; i++) {
      cam.update(1 / 60, origin, forward, flat);
      maxOffset = Math.max(maxOffset, Math.hypot(cam.position.x - rest.x, cam.position.y - rest.y));
    }
    for (let i = 0; i < 180; i++) cam.update(1 / 60, origin, forward, flat);
    expect(maxOffset).toBeGreaterThan(0.01);
    expect(Math.hypot(cam.position.x - rest.x, cam.position.y - rest.y)).toBeLessThan(1e-3);
  });

  it('Chill orbits after 8 idle seconds and stops on any input', () => {
    const cam = new ChaseCamera(chillChase);
    cam.snap(origin, forward, flat);
    for (let i = 0; i < 7.5 * 60; i++) cam.update(1 / 60, origin, forward, flat, { idle: true });
    expect(cam.orbiting).toBe(false);
    for (let i = 0; i < 2 * 60; i++) cam.update(1 / 60, origin, forward, flat, { idle: true });
    expect(cam.orbiting).toBe(true);
    cam.update(1 / 60, origin, forward, flat, { idle: false });
    expect(cam.orbiting).toBe(false);
  });

  it('Joyride never orbits', () => {
    const cam = new ChaseCamera(joyrideChase);
    cam.snap(origin, forward, flat);
    for (let i = 0; i < 20 * 60; i++) cam.update(1 / 60, origin, forward, flat, { idle: true });
    expect(cam.orbiting).toBe(false);
  });
});
