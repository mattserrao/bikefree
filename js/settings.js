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
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export const KG_PER_LB = 0.45359237;
export const MI_PER_KM = 0.621371;
