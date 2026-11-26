// User settings, saved in this browser.
const KEY = 'bikefree.settings.v1';

export const DEFAULT_SETTINGS = {
  units: 'imperial',      // 'imperial' | 'metric'
  riderKg: 80,
  bikeKg: 9,
  shiftMode: 'erg',       // 'erg' | 'sim'
  difficulty: 100,        // % of physics resistance
  hillFeel: 50,           // % of the road grade the trainer passes on (Zwift's trainer difficulty; 25/50/75/100)
  realRatio: 0,           // 0 = auto-estimate from the trainer
  haptics: true,
  worldSound: true,       // ambience in the 3D world (the subway's trains, escalators, chimes): quiet; off = silent
  startGear: 12,
  ftp: 200,               // watts, for % FTP workouts
  worldTime: 'auto',      // 3D time of day: auto (the route's default) | morning | midday | golden | night
  worldQuality: 'balanced', // stylized scenery: low | balanced | high (phones: low, set once in loadSettings)
  camera: 'close',        // chase camera: close (speed feel, the default since 23 Nov) | closest (Zwift-style chase, further back) | classic (4.5 m back, fixed)
  hudSize: 'small',       // ride-screen power bar: small (default) | medium | large (the original size)
  minimap: 'follow',      // ride-screen minimap: follow (zoomed in, ~3 km across: the default) | course (whole route) | off (phones: off, set once)
  minimapView: 'follow',  // the minimap's view when it's turned back on (Settings: Minimap on/off + its view)
  worldWeather: 'clear',  // 3D weather: clear | marine | clouds | rain
  scenery: 'builtin-park-yosemite', // 3D loop shown behind free rides and workouts
  mapLandmarks: true,     // the city panel's map shows its landmarks (PLAN 7.9; the toggle at the map's bottom right)
  // the graphics menu's finer settings (laptops; user, 23 Nov): fps cap (0 none, 60, 30), battery saver (off | on |
  // auto: while unplugged), draw distance and tree density (×), and on/off for live shadows, atmosphere (sun beams,
  // mist), roadside grass and brush, and people & cars
  gfx: { fps: 0, battery: 'off', distance: 1, trees: 1, shadows: true, atmosphere: true, verge: true, life: true, post: true },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    s.gfx = { ...DEFAULT_SETTINGS.gfx, ...(s.gfx || {}) };
    // v0.13: 'midday' was the old default, so a saved 'midday' becomes "Route's default" once.
    if (!s.timeAuto) { if (s.worldTime === 'midday') s.worldTime = 'auto'; s.timeAuto = true; }
    // 18 Nov: the minimap zooms in and follows you by default, so a saved 'course' (the old default) becomes 'follow' once.
    if (!s.mapFollow) { if (s.minimap === 'course') s.minimap = 'follow'; s.mapFollow = true; }
    // 19 Nov (PLAN 6.10): the Closest camera is the default, so a saved 'close' (the old default) becomes 'closest' once;
    // a choice made after that (Close included) is kept
    if (!s.camClosest) { if (s.camera === 'close') s.camera = 'closest'; s.camClosest = true; }
    // 23 Nov (user: "ensure the default camera is close"): Close is the default again, so a saved 'closest' becomes
    // 'close' once; a choice made after that (Chase included) is kept
    if (!s.camClose) { if (s.camera === 'closest') s.camera = 'close'; s.camClose = true; }
    // 21 Nov: phones ride on Light scenery (no antialiasing, pixel ratio 1, the simpler shaders, a nearer horizon) — set
    // once, so a phone already saved on Balanced moves to Light; a choice made after that is kept
    if (!s.phoneQuality) { if (isPhone()) s.worldQuality = 'low'; s.phoneQuality = true; }
    if (s.worldQuality === 'ultra' && isTouchDevice()) s.worldQuality = 'high';   // (Ultra is for laptops and desktops)
    // 23 Nov (user: "on mobile set default to off"): phones ride without the minimap — set once; turning it on is kept
    if (!s.phoneMap) { if (isPhone()) { if (s.minimap !== 'off') s.minimapView = s.minimap; s.minimap = 'off'; } s.phoneMap = true; }
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** A phone (a touch screen as the main pointer and a small screen, or a phone's browser). */
export function isPhone() {
  try {
    if (/iPhone|iPod|Android.+Mobile|Mobile.+Firefox/i.test(navigator.userAgent)) return true;
    return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  } catch { return false; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export const KG_PER_LB = 0.45359237;
export const MI_PER_KM = 0.621371;

/** A phone or a tablet (iPadOS reports a Mac with touch): Ultra isn't offered there. */
export function isTouchDevice() {
  const nav = globalThis.navigator, ua = nav?.userAgent || '';
  return /iPhone|iPad|iPod|Android|Mobile/.test(ua) || (/Macintosh/.test(ua) && nav?.maxTouchPoints > 1);
}
/** Hide the Ultra choice (data-desktop options) on phones and tablets. */
export function hideDesktopOnlyOptions(root = globalThis.document) {
  if (!isTouchDevice()) return;
  for (const o of root?.querySelectorAll?.('option[data-desktop]') || []) o.remove();
}
