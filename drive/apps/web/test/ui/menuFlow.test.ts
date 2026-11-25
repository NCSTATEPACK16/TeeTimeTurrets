import { describe, expect, it } from 'vitest';
import { MenuFlow } from '../../src/ui/menuFlow';
import type { ModeName } from '../../src/modes/modes';

function flow(ride: ModeName = 'chill', showMenus = true) {
  const plays: ModeName[] = [];
  const f = new MenuFlow(ride, showMenus, (r) => plays.push(r));
  return { f, plays };
}

describe('menu flow', () => {
  it('goes title -> ride select -> play with the chosen ride', () => {
    const { f, plays } = flow();
    f.setReady();
    expect(f.screen).toBe('title');
    f.teeOff();
    expect(f.screen).toBe('ride');
    f.pick('joyride');
    expect(f.start()).toBe(true);
    expect(f.screen).toBe('play');
    expect(plays).toEqual(['joyride']);
  });

  it('waits for the course before starting', () => {
    const { f, plays } = flow();
    f.teeOff();
    expect(f.start()).toBe(false);
    expect(f.screen).toBe('ride');
    f.setReady();
    expect(f.start()).toBe(true);
    expect(plays).toEqual(['chill']);
  });

  it('nudges through the rides in both directions, wrapping', () => {
    const { f } = flow();
    f.nudge(1);
    expect(f.ride).toBe('joyride');
    f.nudge(1);
    expect(f.ride).toBe('chill');
    f.nudge(-1);
    expect(f.ride).toBe('joyride');
  });

  it('backs out of a panel, then ride select; never past a fresh title', () => {
    const { f, plays } = flow();
    f.setReady();
    f.openPanel('controls');
    expect(f.panel).toBe('controls');
    f.back();
    expect(f.panel).toBeNull();
    f.teeOff();
    f.back();
    expect(f.screen).toBe('title');
    f.back();
    expect(f.screen).toBe('title');
    expect(plays).toEqual([]);
  });

  it('pauses to the title and resumes the round with Back', () => {
    const { f, plays } = flow();
    f.setReady();
    f.teeOff();
    f.start();
    f.pause();
    expect(f.screen).toBe('title');
    f.back();
    expect(f.screen).toBe('play');
    expect(plays).toEqual(['chill', 'chill']);
  });

  it('skips straight to play with menus off, starting once the course loads', () => {
    const { f, plays } = flow('joyride', false);
    expect(f.screen).toBe('play');
    expect(plays).toEqual([]);
    f.setReady();
    expect(plays).toEqual(['joyride']);
  });

  it('notifies listeners on every change', () => {
    const { f } = flow();
    let n = 0;
    f.onChange(() => n++);
    f.setReady();
    f.teeOff();
    f.nudge(1);
    f.back();
    expect(n).toBe(4);
  });
});
