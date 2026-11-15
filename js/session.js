// The ride: virtual gears, terrain grade, trainer control loop, speed/distance, timer.
import {
  GEAR_RATIOS, clamp, stepSpeed, ergTargetForGear, simGradeForGear, estimateRealRatio, DEFAULTS,
} from './physics.js';
import { shiftDirection } from './parsers.js';

const TICK_MS = 250;
const DATA_STALE_MS = 2500;
const AUTO_PAUSE_MS = 3000;
const DEFAULT_REAL_RATIO = 2.4;

export class Session extends EventTarget {
  constructor({ trainer, ride, log, settings }) {
    super();
    this.trainer = trainer;
    this.ride = ride;
    this.log = log;
    this.settings = settings;

    this.gear = settings.startGear;
    this.gradePct = 0;
    this.speedMps = 0;
    this.distanceM = 0;
    this.elevGainM = 0;
    this.movingS = 0;
    this.running = false;    // user pressed start (or auto-started)
    this.autoPaused = false;
    this.realRatioEst = null;

    this.power = 0;
    this.cadence = 0;
    this._power3s = [];      // [t, watts]
    this._powerSum = 0;
    this._powerN = 0;
    this._lastActiveAt = 0;

    this._lastSentAt = 0;
    this._lastSent = null;   // last ERG watts or SIM grade sent
    this.target = null;      // {mode, value} for display

    ride.addEventListener('press', (e) => this._onPress(e.detail));
    trainer.addEventListener('reconnected', () => { this._lastSent = null; });
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  get ratio() { return GEAR_RATIOS[this.gear - 1]; }
  get gearCount() { return GEAR_RATIOS.length; }
  get power3s() {
    if (!this._power3s.length) return 0;
    return this._power3s.reduce((a, [, w]) => a + w, 0) / this._power3s.length;
  }
  get avgPower() { return this._powerN ? this._powerSum / this._powerN : 0; }
  get realRatio() { return this.settings.realRatio || this.realRatioEst || DEFAULT_REAL_RATIO; }

  physicsParams() {
    return { ...DEFAULTS, riderKg: this.settings.riderKg, bikeKg: this.settings.bikeKg };
  }

  shift(dir) {
    const g = clamp(this.gear + dir, 1, this.gearCount);
    if (g === this.gear) return;
    this.gear = g;
    this._lastSent = null; // push the new resistance right away
    if (this.settings.haptics) this.ride.vibrate();
    this.dispatchEvent(new Event('change'));
  }

  setGrade(pct) {
    this.gradePct = clamp(Math.round(pct * 2) / 2, -10, 16);
    this._lastSent = null;
    this.dispatchEvent(new Event('change'));
  }

  start() { this.running = true; this.autoPaused = false; this.dispatchEvent(new Event('change')); }
  pause() { this.running = false; this.dispatchEvent(new Event('change')); }
  toggle() { this.running ? this.pause() : this.start(); }

  reset() {
    this.running = false;
    this.autoPaused = false;
    this.distanceM = 0;
    this.elevGainM = 0;
    this.movingS = 0;
    this.speedMps = 0;
    this._powerSum = 0;
    this._powerN = 0;
    this.dispatchEvent(new Event('change'));
  }

  _onPress(name) {
    const dir = shiftDirection(name);
    if (dir) return this.shift(dir);
    if (name === 'navUp') return this.setGrade(this.gradePct + 0.5);
    if (name === 'navDown') return this.setGrade(this.gradePct - 0.5);
    if (name === 'A') return this.toggle();
  }

  _tick() {
    const now = performance.now();
    const dt = TICK_MS / 1000;
    const d = this.trainer.data;
    const fresh = this.trainer.connected && now - this.trainer.lastDataAt < DATA_STALE_MS;
    this.power = fresh ? Math.max(0, d.powerW || 0) : 0;
    this.cadence = fresh ? Math.max(0, d.cadenceRpm || 0) : 0;

    // Real chain ratio estimate (for SIM mode), smoothed.
    const est = fresh ? estimateRealRatio(d.speedKph, this.cadence) : null;
    if (est && est > 0.5 && est < 6) {
      this.realRatioEst = this.realRatioEst ? this.realRatioEst * 0.97 + est * 0.03 : est;
    }

    // 3-second power window
    this._power3s.push([now, this.power]);
    while (this._power3s.length && now - this._power3s[0][0] > 3000) this._power3s.shift();

    const pedalling = this.power > 5 || this.cadence > 10;
    if (pedalling) this._lastActiveAt = now;

    // Auto start / auto pause
    if (!this.running && !this.autoPaused && pedalling && this.movingS === 0) this.start();
    if (this.running && !pedalling && this.speedMps < 0.5 && now - this._lastActiveAt > AUTO_PAUSE_MS) {
      this.running = false;
      this.autoPaused = true;
    }
    if (this.autoPaused && pedalling) { this.running = true; this.autoPaused = false; }

    // Virtual speed from measured power (also handles coasting)
    const p = this.physicsParams();
    this.speedMps = stepSpeed(this.speedMps, this.power, this.gradePct, dt, p);
    if (this.running) {
      const ds = this.speedMps * dt;
      this.distanceM += ds;
      if (this.gradePct > 0) this.elevGainM += ds * Math.sin(Math.atan(this.gradePct / 100));
      if (this.speedMps > 0.3 || pedalling) this.movingS += dt;
      this._powerSum += this.power;
      this._powerN++;
    }

    this._control(now, p);
    this.dispatchEvent(new Event('tick'));
  }

  /** Send the trainer the resistance for the current gear, cadence and grade. */
  _control(now, p) {
    if (!this.trainer.connected || this.trainer.busy || this.trainer.reconnecting) return;
    const diff = this.settings.difficulty / 100;
    const due = now - this._lastSentAt > 2000;

    if (this.settings.shiftMode === 'erg') {
      const watts = ergTargetForGear(this.cadence, this.ratio, this.gradePct, p, diff);
      this.target = { mode: 'ERG', value: watts };
      if (this._lastSent === null || Math.abs(watts - this._lastSent) >= 3 || due) {
        this._lastSent = watts;
        this._lastSentAt = now;
        this.trainer.setErgWatts(watts);
      }
    } else {
      const grade = simGradeForGear(this.cadence, this.ratio, this.realRatio, this.gradePct, p, diff);
      this.target = { mode: 'SIM', value: grade };
      if (this._lastSent === null || Math.abs(grade - this._lastSent) >= 0.2 || due) {
        this._lastSent = grade;
        this._lastSentAt = now;
        this.trainer.setGrade(grade, { windMps: 0, crr: p.crr, cw: 0 });
      }
    }
  }

  /** Call after changing settings. */
  settingsChanged() {
    this._lastSent = null;
    this.dispatchEvent(new Event('change'));
  }
}
