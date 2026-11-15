// Rider profiles, saved in this browser (localStorage).
//
// A profile holds who's riding — name, height, weight, gender — and its ride totals. The totals are worked
// out from the saved rides themselves (each ride is tagged with the profile that rode it), so deleting a
// ride from history keeps the numbers right. Rides saved before profiles existed belong to the first profile.

const KEY = 'bikefree.profiles.v1';
export const GENDERS = [
  ['', 'Prefer not to say'],
  ['male', 'Male'],
  ['female', 'Female'],
  ['nonbinary', 'Non-binary'],
];

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function blankProfile(fields = {}) {
  return { id: newId(), name: '', heightCm: null, weightKg: 80, gender: '', ftp: 200, createdAt: Date.now(), ...fields };
}

export class Profiles {
  /** @param {{getItem(k):string|null, setItem(k,v):void}} storage  @param {number} fallbackKg weight for the first profile */
  constructor(storage, fallbackKg = 80, fallbackFtp = 200) {
    this.storage = storage;
    let data = null;
    try { data = JSON.parse(storage.getItem(KEY) || 'null'); } catch { data = null; }
    if (!data || !Array.isArray(data.profiles) || !data.profiles.length) {
      const first = blankProfile({ weightKg: fallbackKg, ftp: fallbackFtp });
      data = { activeId: first.id, firstId: first.id, profiles: [first] };
    }
    if (!data.profiles.some((p) => p.id === data.activeId)) data.activeId = data.profiles[0].id;
    if (!data.firstId) data.firstId = data.profiles[0].id;
    // v0.11.3: FTP lives in the profile (each rider has their own); older profiles take the old setting
    for (const p of data.profiles) if (!Number.isFinite(p.ftp)) p.ftp = fallbackFtp;
    this.data = data;
    this._save();
  }

  _save() {
    try { this.storage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }

  get all() { return this.data.profiles; }
  get active() { return this.data.profiles.find((p) => p.id === this.data.activeId); }
  get firstId() { return this.data.firstId; }

  setActive(id) {
    if (!this.data.profiles.some((p) => p.id === id)) return false;
    this.data.activeId = id;
    this._save();
    return true;
  }

  create(fields = {}) {
    const p = blankProfile({ weightKg: this.active?.weightKg ?? 80, ftp: this.active?.ftp ?? 200, ...fields });
    this.data.profiles.push(p);
    this.data.activeId = p.id;
    this._save();
    return p;
  }

  update(id, fields) {
    const p = this.data.profiles.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, fields, { id: p.id });
    this._save();
    return p;
  }

  /** Removes a profile (never the last one). Its rides stay saved; they move to the first remaining profile. */
  remove(id) {
    if (this.data.profiles.length < 2) return false;
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    if (this.data.firstId === id) this.data.firstId = this.data.profiles[0].id;
    if (this.data.activeId === id) this.data.activeId = this.data.profiles[0].id;
    this._save();
    return true;
  }

  /** Which profile a saved ride belongs to. */
  ownerOf(ride) {
    const id = ride.profileId;
    return id && this.data.profiles.some((p) => p.id === id) ? id : this.data.firstId;
  }

  /** Ride totals for one profile, from the saved rides' summaries. */
  stats(id, rides) {
    let count = 0, distanceM = 0, movingS = 0, ascentM = 0, lastAt = null;
    for (const r of rides) {
      if (this.ownerOf(r) !== id) continue;
      count++;
      distanceM += r.summary?.distanceM || 0;
      movingS += r.summary?.timerS || 0;
      ascentM += r.summary?.ascentM || 0;
      lastAt = Math.max(lastAt ?? 0, r.startedAt || 0);
    }
    return { rides: count, distanceM, movingS, ascentM, lastAt };
  }
}

export const initials = (name) => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
export const cmToFtIn = (cm) => { const inches = Math.round(cm / 2.54); return [Math.floor(inches / 12), inches % 12]; };
export const ftInToCm = (ft, inch) => ((Number(ft) || 0) * 12 + (Number(inch) || 0)) * 2.54;
