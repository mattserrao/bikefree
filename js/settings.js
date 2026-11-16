// User settings, saved in this browser.
const KEY = 'bikefree.settings.v1';

export const DEFAULT_SETTINGS = {
  units: 'imperial',      // 'imperial' | 'metric'
  riderKg: 80,
  bikeKg: 9,
  shiftMode: 'erg',       // 'erg' | 'sim'
  difficulty: 100,        // % of physics resistance
  realRatio: 0,           // 0 = auto-estimate from the trainer
  haptics: true,
  startGear: 12,
  ftp: 200,               // watts, for % FTP workouts
  worldCam: 'chase',      // 3D camera: chase | eye | drone
  worldTime: 'auto',      // 3D time of day: auto (the route's default) | morning | midday | golden | night
  worldQuality: 'balanced', // stylized scenery: low | balanced | high
  hudSize: 'small',       // ride-screen power bar: small (default) | medium | large (the original size)
  minimap: 'course',      // ride-screen minimap: course (whole route) | follow (zoomed in) | off
  worldWeather: 'clear',  // 3D weather: clear | marine | clouds | rain
  scenery: 'builtin-park-yosemite', // 3D loop shown behind free rides and workouts
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    // v0.13: 'midday' was the old default, so a saved 'midday' becomes "Route's default" once.
    if (!s.timeAuto) { if (s.worldTime === 'midday') s.worldTime = 'auto'; s.timeAuto = true; }
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export const KG_PER_LB = 0.45359237;
export const MI_PER_KM = 0.621371;
