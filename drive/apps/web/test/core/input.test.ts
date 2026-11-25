import { describe, expect, it } from 'vitest';
import { IDLE, InputManager, applyDeadzone, mergeControls, readGamepad, readKeyboard, type GamepadLike } from '../../src/core/input';

function pad(over: { axes?: number[]; buttons?: Record<number, number>; mapping?: string; connected?: boolean } = {}): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = over.buttons?.[i] ?? 0;
    return { value, pressed: value > 0.5 };
  });
  return { connected: over.connected ?? true, mapping: over.mapping ?? 'standard', axes: over.axes ?? [0, 0, 0, 0], buttons };
}

describe('keyboard', () => {
  it('maps WASD and arrows to pedals and steering', () => {
    expect(readKeyboard(new Set(['KeyW']))).toMatchObject({ throttle: 1, brake: 0, steer: 0 });
    expect(readKeyboard(new Set(['ArrowDown', 'ArrowLeft']))).toMatchObject({ throttle: 0, brake: 1, steer: -1 });
    expect(readKeyboard(new Set(['KeyD']))).toMatchObject({ steer: 1 });
    expect(readKeyboard(new Set(['KeyA', 'KeyD']))).toMatchObject({ steer: 0 });
    expect(readKeyboard(new Set(['Space', 'KeyR']))).toMatchObject({ handbrake: true, reset: true });
    expect(readKeyboard(new Set(['ShiftLeft', 'KeyM']))).toMatchObject({ boost: true, mode: true, handbrake: false });
    expect(readKeyboard(new Set())).toEqual(IDLE);
  });
});

describe('gamepad (standard mapping)', () => {
  it('reads triggers, stick and buttons', () => {
    const c = readGamepad(pad({ axes: [0.6, 0, 0, 0], buttons: { 7: 1, 0: 1, 3: 1 } }));
    expect(c.throttle).toBe(1);
    expect(c.brake).toBe(0);
    expect(c.steer).toBeCloseTo((0.6 - 0.15) / 0.85, 9);
    expect(c.handbrake).toBe(true);
    expect(c.reset).toBe(true);
    expect(c.boost).toBe(false);
    expect(readGamepad(pad({ buttons: { 5: 1, 8: 1 } }))).toMatchObject({ boost: true, mode: true });
    expect(readGamepad(pad({ buttons: { 6: 0.5 } })).brake).toBeCloseTo((0.5 - 0.05) / 0.95, 9);
  });

  it('ignores stick drift inside the deadzone', () => {
    expect(readGamepad(pad({ axes: [0.1, 0, 0, 0] })).steer).toBe(0);
    expect(readGamepad(pad({ axes: [-1, 0, 0, 0] })).steer).toBe(-1);
    expect(applyDeadzone(0.15, 0.15)).toBe(0);
    expect(applyDeadzone(-2, 0.15)).toBe(-1);
  });

  it('ignores disconnected and non-standard pads', () => {
    expect(readGamepad(pad({ buttons: { 7: 1 }, connected: false }))).toEqual(IDLE);
    expect(readGamepad(pad({ buttons: { 7: 1 }, mapping: '' }))).toEqual(IDLE);
    expect(readGamepad(null)).toEqual(IDLE);
  });
});

describe('merging sources', () => {
  it('takes the stronger pedal and steering input', () => {
    const kb = readKeyboard(new Set(['KeyA']));
    const gp = readGamepad(pad({ axes: [0.5, 0, 0, 0], buttons: { 7: 0.6 } }));
    const m = mergeControls(kb, gp);
    expect(m.steer).toBe(-1);
    expect(m.throttle).toBeCloseTo((0.6 - 0.05) / 0.95, 9);
  });
});

describe('InputManager', () => {
  it('tracks keys from events and fires reset once per press', () => {
    const target = new EventTarget() as unknown as Window;
    let pads: GamepadLike[] = [];
    const im = new InputManager(target, () => pads);
    const key = (type: string, code: string) => {
      const e = new Event(type) as Event & { code: string };
      e.code = code;
      target.dispatchEvent(e);
    };
    key('keydown', 'KeyW');
    key('keydown', 'KeyR');
    expect(im.poll()).toMatchObject({ throttle: 1, reset: true });
    expect(im.poll().reset).toBe(false); // still held
    key('keyup', 'KeyR');
    expect(im.poll().reset).toBe(false);
    pads = [pad({ buttons: { 3: 1 } })];
    expect(im.poll().reset).toBe(true); // gamepad press is a new edge
    key('keydown', 'KeyM');
    expect(im.poll().mode).toBe(true);
    expect(im.poll().mode).toBe(false); // mode toggles once per press
    key('keyup', 'KeyM');
    target.dispatchEvent(new Event('blur'));
    pads = [];
    expect(im.poll()).toMatchObject({ throttle: 0 });
    im.dispose();
  });

  it('counts a tap that is pressed and released between two polls, once', () => {
    const target = new EventTarget() as unknown as Window;
    const im = new InputManager(target, () => []);
    const key = (type: string, code: string) => {
      const e = new Event(type) as Event & { code: string };
      e.code = code;
      target.dispatchEvent(e);
    };
    im.poll();
    key('keydown', 'KeyM');
    key('keyup', 'KeyM');
    expect(im.poll().mode).toBe(true);
    expect(im.poll().mode).toBe(false);
    key('keydown', 'KeyR');
    key('keyup', 'KeyR');
    key('keydown', 'KeyR');
    key('keyup', 'KeyR');
    expect(im.poll().reset).toBe(true); // two taps in one frame still fire once
    expect(im.poll().reset).toBe(false);
    im.dispose();
  });
});
