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
  camera: 'closest',      // chase camera: closest (back wheel at the bottom of the view, default) | close (speed feel) | classic (4.5 m back, fixed)
  hudSize: 'small',       // ride-screen power bar: small (default) | medium | large (the original size)
  minimap: 'follow',      // ride-screen minimap: follow (zoomed in, ~3 km across: the default) | course (whole route) | off
  worldWeather: 'clear',  // 3D weather: clear | marine | clouds | rain
  scenery: 'builtin-park-yosemite', // 3D loop shown behind free rides and workouts
  mapLandmarks: true,     // the city panel's map shows its landmarks (PLAN 7.9; the toggle at the map's bottom right)
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    // v0.13: 'midday' was the old default, so a saved 'midday' becomes "Route's default" once.
    if (!s.timeAuto) { if (s.worldTime === 'midday') s.worldTime = 'auto'; s.timeAuto = true; }
    // 18 Nov: the minimap zooms in and follows you by default, so a saved 'course' (the old default) becomes 'follow' once.
    if (!s.mapFollow) { if (s.minimap === 'course') s.minimap = 'follow'; s.mapFollow = true; }
    // 19 Nov (PLAN 6.10): the Closest camera is the default, so a saved 'close' (the old default) becomes 'closest' once;
    // a choice made after that (Close included) is kept
    if (!s.camClosest) { if (s.camera === 'close') s.camera = 'closest'; s.camClosest = true; }
    // 21 Nov: phones ride on Light scenery (no antialiasing, pixel ratio 1, the simpler shaders, a nearer horizon) — set
    // once, so a phone already saved on Balanced moves to Light; a choice made after that is kept
    if (!s.phoneQuality) { if (isPhone()) s.worldQuality = 'low'; s.phoneQuality = true; }
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
