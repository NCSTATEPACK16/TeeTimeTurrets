import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVEL, readSettings } from '../../src/core/settings';

describe('readSettings', () => {
  it('defaults to the dummy level with debug off', () => {
    expect(readSettings('')).toEqual({
      debug: false,
      tune: false,
      mode: 'chill',
      levelId: DEFAULT_LEVEL,
      forceWebGL: false,
      view: null,
      menu: true,
      home: null,
      paint: null,
    });
  });

  it('reads ?debug, ?level and ?webgl', () => {
    expect(readSettings('?debug=1&level=course-02&webgl=true')).toEqual({
      debug: true,
      tune: false,
      mode: 'chill',
      levelId: 'course-02',
      forceWebGL: true,
      view: null,
      menu: true,
      home: null,
      paint: null,
    });
  });

  it('reads ?tune and ?mode, falling back to Chill for unknown modes', () => {
    expect(readSettings('?tune=1&mode=joyride')).toMatchObject({ tune: true, mode: 'joyride' });
    expect(readSettings('?mode=turbo').mode).toBe('chill');
  });

  it('reads a ?view bookmark and ignores malformed ones', () => {
    expect(readSettings('?view=-60,40,2.5,105,-6').view).toEqual({ x: -60, z: 40, height: 2.5, headingDeg: 105, pitchDeg: -6 });
    expect(readSettings('?view=1,2,3').view).toBeNull();
    expect(readSettings('?view=1,2,3,x,5').view).toBeNull();
  });

  it('shows the menus unless ?menu=0 or a ?view bookmark skips them', () => {
    expect(readSettings('?menu=1').menu).toBe(true);
    expect(readSettings('?menu=0').menu).toBe(false);
    expect(readSettings('?view=-60,40,2.5,105,-6').menu).toBe(false);
  });

  it('rejects level ids that could escape the levels folder', () => {
    expect(readSettings('?level=../secrets').levelId).toBe(DEFAULT_LEVEL);
    expect(readSettings('?level=Dummy').levelId).toBe(DEFAULT_LEVEL);
  });

  it('reads a same-site ?home for the Main menu button, and refuses anything off-site', () => {
    expect(readSettings('?home=/').home).toBe('/');
    expect(readSettings('?home=../').home).toBe('../');
    expect(readSettings('?home=/play/index.html').home).toBe('/play/index.html');
    for (const bad of ['//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)', '']) {
      expect(readSettings(`?home=${encodeURIComponent(bad)}`).home, bad).toBeNull();
    }
  });

  it('reads ?paint only as a canopy hex from the paint table', () => {
    expect(readSettings('?paint=1e4d2b').paint).toMatchObject({ id: 'pine', canopy: 0x1e4d2b, shirt: 0x163a20 });
    expect(readSettings('?paint=123456').paint).toBeNull();
    expect(readSettings('?paint=red').paint).toBeNull();
  });
});
