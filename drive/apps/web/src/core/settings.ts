/**
 * Runtime flags from the URL: ?debug=1, ?tune=1, ?mode=joyride, ?level=<id>, ?webgl=1 (force WebGL2),
 * ?view=x,z,height,headingDeg,pitchDeg (a fixed review camera instead of the chase camera),
 * ?menu=0 (skip the title and ride menus and start driving; a ?view bookmark skips them too),
 * ?home=<same-site path> (a Main menu button on the pause menu, back to the page that launched free
 * drive: TeeTimeTurrets' title passes ?home=/).
 */
export interface Settings {
  debug: boolean;
  /** Show the lil-gui tuning panel. */
  tune: boolean;
  mode: 'chill' | 'joyride';
  levelId: string;
  forceWebGL: boolean;
  view: ViewBookmark | null;
  /** Show the title and ride menus before driving. */
  menu: boolean;
  /** Where the pause menu's Main menu button goes; null hides the button. */
  home: string | null;
}

/** A fixed camera for look reviews: ground position, eye height above the terrain, compass heading, pitch. */
export interface ViewBookmark {
  x: number;
  z: number;
  height: number;
  headingDeg: number;
  pitchDeg: number;
}

function readView(raw: string | null): ViewBookmark | null {
  if (!raw) return null;
  const n = raw.split(',').map(Number);
  if (n.length !== 5 || !n.every(Number.isFinite)) return null;
  const [x, z, height, headingDeg, pitchDeg] = n as [number, number, number, number, number];
  return { x, z, height, headingDeg, pitchDeg };
}

export const DEFAULT_LEVEL = 'dummy-01';

/** Only a path on this site ("/", "/play/", "../"): never another host, so the link can't be turned into a redirect. */
function readHome(raw: string | null): string | null {
  if (!raw) return null;
  return /^(\/(?![/\\])|\.\.?\/)[\w\-./]*$/.test(raw) ? raw : null;
}

export function readSettings(search: string): Settings {
  const q = new URLSearchParams(search);
  const flag = (name: string) => ['1', 'true', 'yes'].includes((q.get(name) ?? '').toLowerCase());
  const level = q.get('level') ?? DEFAULT_LEVEL;
  return {
    debug: flag('debug'),
    tune: flag('tune'),
    mode: q.get('mode') === 'joyride' ? 'joyride' : 'chill',
    levelId: /^[a-z0-9][a-z0-9-]*$/.test(level) ? level : DEFAULT_LEVEL,
    forceWebGL: flag('webgl'),
    view: readView(q.get('view')),
    menu: !['0', 'false', 'no'].includes((q.get('menu') ?? '').toLowerCase()) && !q.get('view'),
    home: readHome(q.get('home')),
  };
}
