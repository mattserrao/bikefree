// The ride: virtual gears, terrain (manual grade or GPX route), workouts, trainer control,
// speed/distance physics, timer and 1 Hz recording.
import {
  GEAR_RATIOS, clamp, stepSpeed, ergTargetForBike, simGradeForGear, estimateRealRatio, DEFAULTS,
  feltGrade, shapeGrade, momentumGrade, HILL_FEEL_DEFAULT,
} from './physics.js';
import { shiftDirection } from './parsers.js';
import { Recorder } from './recorder.js';
import { routeAt, wrapDist, lapAt, finishDistanceM, carryAt, carrySpeed } from './gpx.js';

/** SIM grade sent while a conveyor carries you (escalator): the trainer's lightest resistance, no pedalling needed. */
export const CARRY_SIM_GRADE = -5;
import { segmentIndexAt, targetWatts } from './workout.js';

export const TICK_MS = 250;
const DATA_STALE_MS = 2500;
const HR_STALE_MS = 5000;
const AUTO_PAUSE_MS = 3000;
const DEFAULT_REAL_RATIO = 2.4;
const FREE_START_ALT = 100;

export class Session extends EventTarget {
  constructor({ trainer, ride, hr, log, settings }) {
    super();
    this.trainer = trainer;
    this.ride = ride;
    this.hrStrap = hr;
    this.log = log;
    this.settings = settings;
    this.recorder = new Recorder();

    this.mode = 'free';      // 'free' | 'route' | 'workout'
    this.route = null;       // built route (gpx.js)
    this.workout = null;     // parsed workout (workout.js)
    this.sceneryRoute = null;   // network scenery behind a free ride or workout (setScenery)
    this.gear = settings.startGear;
    this._manualGrade = 0;
    this.workoutBias = 1;
    this.demoSpeedMps = null;
    this.autoStart = true;      // the app turns this off while you're on the menu (and behind the loading screen)
    this.held = false;          // [phase 8] the world is loading the streets ahead: time and distance wait (setHeld)
    this._resumeAfterHold = false;
    this._resetRideState();

    ride.addEventListener('press', (e) => this._onPress(e.detail));
    trainer.addEventListener('reconnected', () => { this._lastSent = null; });
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  _resetRideState() {
    this.speedMps = 0;
    this.distanceM = 0;
    this.altitudeM = FREE_START_ALT;
    this.elevGainM = 0;
    this.movingS = 0;
    this.running = false;
    this.autoPaused = false;
    this.held = false; this._resumeAfterHold = false;   // [phase 8]
    this.power = 0;
    this.cadence = 0;
    this.hr = null;
    this._power3s = [];
    this._powerSum = 0;
    this._powerN = 0;
    this._lastActiveAt = 0;
    this._lastSentAt = 0;
    this._lastSent = null;
    this.target = null;
    this.trainerGrade = null;    // the grade the trainer feels (ERG: pedalGrade, SIM: shapedGrade)
    this.shapedGrade = null;     // Hill feel × road grade, blended over distance and ≤ 1 %/s (PLAN 6.11)
    this.pedalGrade = null;      // ERG: the shaped grade as the bike's momentum lets it through to the pedals
    this.routeOffset = 0;
    this.sceneryOffset = 0;       // a free ride's or workout's network scenery (F37): ridden from 0 with the ride
    this.sceneryRoute?.netRide?.reset();
    this.routeStart = 0;          // metres along the route where this ride started (Reverse / ⅓ / ⅔)
    this.routeFinishM = null;     // point to point, not endless: metres to ride before the finish (null: endless)
    this.routeGoalM = null;       // route selector, "Keep riding": metres to the planned goal (a toast, the ride goes on)
    this.routeGoalHit = false;
    this.routeDone = false;
    this._lastLap = 1;
    this.workoutT = 0;
    this.workoutDone = false;
    this.segIndex = -1;
    this._acc = { n: 0, p: 0, c: 0 };
    this._lastSampleAt = 0;
    this.realRatioEst = this.realRatioEst ?? null;
  }

  // ---------- Derived values ----------
  get ratio() { return GEAR_RATIOS[this.gear - 1]; }
  get gearCount() { return GEAR_RATIOS.length; }
  get power3s() {
    if (!this._power3s.length) return 0;
    return this._power3s.reduce((a, [, w]) => a + w, 0) / this._power3s.length;
  }
  get avgPower() { return this._powerN ? this._powerSum / this._powerN : 0; }
  get realRatio() { return this.settings.realRatio || this.realRatioEst || DEFAULT_REAL_RATIO; }
  /** Distance ridden on the current route (all laps). */
  get routeRidden() {
    const d = Math.max(0, this.distanceM - this.routeOffset);
    return this.routeFinishM == null ? d : Math.min(d, this.routeFinishM);   // the rider stays on the line
  }
  /** Position along the route (wraps around on loops). */
  get routePos() {
    if (!this.route) return 0;
    const at = this.routeRidden + this.routeStart;
    // finishing back at the start (Reverse): stay at the end of the way back, not wrapped onto the way out
    if (this.routeFinishM != null && at >= this.route.total) return this.route.total - 0.01;
    return wrapDist(this.route, at);
  }
  /** Distance left in this lap (a lap is one full there-and-back from wherever you started). */
  get routeLapToGo() {
    if (!this.route) return 0;
    if (this.routeFinishM != null) return this.routeFinishM - this.routeRidden;   // distance to the finish
    return this.route.total - (this.routeRidden % this.route.total);
  }
  /** Current lap on a loop route (1-based). */
  get routeLap() { return !this.route ? 1 : this.route.netRide ? this.route.netRide.lapAt(this.routePos) : lapAt(this.route, this.routeRidden); }
  /**
   * Scenery behind a free ride or workout (F37): a network's free ride (a path route) is ridden along as you go —
   * from where it was set, its turns yours to choose as on a route; the grade stays the ride's own (free: yours,
   * a workout: its targets). Anything else (a loop, none): null, and the app rolls the loop by as before.
   */
  setScenery(route) {
    const r = route?.netRide ? route : null;
    if (r === (this.sceneryRoute || null)) return;
    this.sceneryRoute = r;
    this.sceneryOffset = this.distanceM;
    r?.netRide.reset();
  }
  /** Where you are on the scenery's path (metres since it was set). */
  get sceneryPos() { return Math.max(0, this.distanceM - this.sceneryOffset); }
  /** The network path whose turns you choose now — a network route's, or (off a route) the scenery's — and where you are on it. */
  get turnRide() { return this.mode === 'route' ? this.route?.netRide || null : this.sceneryRoute?.netRide || null; }
  get turnPos() { return this.mode === 'route' ? this.routePos : this.sceneryPos; }
  /** On a network route (or network scenery): change the way you'll go at the next junction (−1 left, +1 right). */
  turn(dir) {
    const net = this.turnRide;
    if (!net || !net.choose(dir, this.turnPos)) return false;
    if (this.settings.haptics) this.ride.vibrate();
    this._changed();
    return true;
  }
  /** The conveyor carrying you (an escalator: {from, to, mps, label}), or null. */
  get carry() { return this.mode === 'route' && this.route && !this.routeDone ? carryAt(this.route, this.routePos) : null; }
  get gradePct() {
    if (this.mode === 'route' && this.route) return this.routeDone ? 0 : routeAt(this.route, this.routePos).grade;
    return this._manualGrade;
  }
  get segment() { return this.workout && this.segIndex >= 0 ? this.workout.segments[this.segIndex] : null; }
  /** Current workout ERG target (null when free riding). */
  get workoutTarget() {
    if (this.mode !== 'workout' || !this.workout || this.workoutDone) return null;
    return targetWatts(this.segment, this.workoutT, this.settings.ftp, this.workoutBias);
  }
  get hasRide() { return this.recorder.active; }

  physicsParams() {
    return { ...DEFAULTS, riderKg: this.settings.riderKg, bikeKg: this.settings.bikeKg };
  }

  _changed() { this.dispatchEvent(new Event('change')); }

  // ---------- Controls ----------
  shift(dir) {
    const g = clamp(this.gear + dir, 1, this.gearCount);
    if (g === this.gear) return;
    this.gear = g;
    this._lastSent = null;
    if (this.settings.haptics) this.ride.vibrate();
    this._changed();
  }

  setGrade(pct) {
    this._manualGrade = clamp(Math.round(pct * 2) / 2, -10, 16);
    this._lastSent = null;
    this._changed();
  }

  /** Workout intensity, as a multiplier (0.5–1.5). */
  setBias(b) {
    this.workoutBias = clamp(Math.round(b * 100) / 100, 0.5, 1.5);
    this._lastSent = null;
    this._changed();
  }

  start() {
    if (this.held) { this._resumeAfterHold = true; return; }   // [phase 8] (it starts when the hold ends)
    if (!this.recorder.active) this.recorder.setLapLabel(this._lapName());
    this.running = true;
    this.autoPaused = false;
    this.recorder.start(Date.now());
    this._changed();
  }

  pause() {
    this._resumeAfterHold = false;
    this.running = false;
    this.recorder.stop(Date.now());
    this._changed();
  }

  toggle() {
    if (this.held) { this._resumeAfterHold = !this._resumeAfterHold; this._changed(); return; }   // [phase 8] (pause / unpause the hold's resume)
    this.running ? this.pause() : this.start();
  }

  /**
   * [phase 8] Hold the ride while the world loads the streets ahead: time and distance stop (as a pause, so the
   * recording has the gap), and the ride carries on by itself when the hold ends — unless you paused meanwhile.
   * The trainer keeps its resistance (the grade where you are).
   */
  setHeld(on) {
    on = !!on;
    if (on === this.held) return;
    if (on) {
      const was = this.running;
      if (was) this.pause();
      this.held = true;
      this._resumeAfterHold = was;
    } else {
      this.held = false;
      const go = this._resumeAfterHold;
      this._resumeAfterHold = false;
      if (go) this.start();
    }
    this._changed();
  }

  lap() {
    if (!this.recorder.active) return;
    this.recorder.lap(Date.now(), 'Manual lap');
    this.log('app', 'Lap');
    this.dispatchEvent(new Event('lap'));
  }

  _lapName() {
    if (this.mode === 'route' && this.route) return this.route.closed && this.routeFinishM == null ? `${this.route.name} · lap ${this.routeLap}` : this.route.name;
    if (this.mode === 'workout' && this.segment) return this.segment.label;
    return 'Free ride';
  }

  _modeLap() {
    if (this.recorder.active) this.recorder.lap(Date.now(), this._lapName());
  }

  /** Up/down on the D-pad or arrow keys: workout intensity during ERG steps, otherwise grade. */
  upDown(dir) {
    if (this.workoutTarget != null) return this.setBias(this.workoutBias + dir * 0.05);
    if (this.mode !== 'route') return this.setGrade(this._manualGrade + dir * 0.5);
  }

  /** Choose free ride. */
  setFree() {
    this.mode = 'free';
    this._modeLap();
    this._lastSent = null;
    this._changed();
  }

  /** Ride a route from its start (starting from the current distance). `finishM`: metres to the finish
   *  (the end of a point-to-point stage, or the route selector's planned length; null: ride on, turning at
   *  each end). `goalM`: metres to a goal that's only announced — the ride keeps going. */
  setRoute(route, startM = 0, finishM = null, goalM = null) {
    this.routeStart = startM || 0;
    this.routeFinishM = finishM > 0 ? finishM : null;
    this.routeGoalM = this.routeFinishM == null && goalM > 0 ? goalM : null;
    this.routeGoalHit = false;
    this.mode = 'route';
    this.route = route;
    route.netRide?.reset();   // a network route (js/network.js): the plan again, nothing chosen yet
    this.routeOffset = this.distanceM;
    this.routeDone = false;
    this._lastLap = 1;
    this._lastSent = null;
    this._modeLap();
    this._changed();
  }

  restartRoute() { if (this.route) this.setRoute(this.route, 0, this.routeFinishM == null ? null : finishDistanceM(this.route, 0)); }

  setWorkout(workout) {
    this.mode = 'workout';
    this.workout = workout;
    this.workoutT = 0;
    this.workoutDone = false;
    this.workoutBias = 1;
    this.segIndex = 0;
    if (this.recorder.active) this.recorder.lap(Date.now(), workout.segments[0].label);
    else this.recorder.setLapLabel(workout.segments[0].label);
    this._lastSent = null;
    this._changed();
  }

  /** Jump to the next workout step. */
  skipSegment() {
    if (this.mode !== 'workout' || !this.workout || this.workoutDone) return;
    const seg = this.segment;
    if (seg) this.workoutT = seg.start + seg.duration;
  }

  /** End the ride; returns the ride object (or null if nothing recorded) and resets. */
  finish() {
    const meta = this.rideMeta();
    const ride = this.recorder.finish(Date.now(), meta);
    this.recorder.reset();
    this._resetRideState();
    if (this.mode === 'route') this.routeOffset = 0;
    if (this.mode === 'workout' && this.workout) { this.segIndex = 0; }
    this._changed();
    return ride;
  }

  rideMeta() {
    const name = this.mode === 'route' && this.route ? this.route.name
      : this.mode === 'workout' && this.workout ? this.workout.name : 'Free ride';
    return { name: this.demoSpeedMps != null ? `Demo · ${name}` : name, mode: this.mode, ftp: this.settings.ftp, riderKg: this.settings.riderKg, demo: this.demoSpeedMps != null };
  }

  _onPress(name) {
    const dir = shiftDirection(name);
    if (dir) return this.shift(dir);
    if (name === 'navUp') return this.upDown(1);
    if (name === 'navDown') return this.upDown(-1);
    if (name === 'A') return this.toggle();
    if (name === 'Y') return this.lap();
    if (name === 'navLeft' || name === 'navRight') {
      // ◀ ▶ choose the turn; in a workout ▶ skips the step, except while a junction's prompt is up on its scenery
      const net = this.turnRide;
      if (net && (this.mode !== 'workout' || net.prompt(this.turnPos, this.speedMps))) return this.turn(name === 'navLeft' ? -1 : 1);
      if (name === 'navRight' && this.mode === 'workout') return this.skipSegment();
    }
  }

  // ---------- Loop ----------
  _tick() {
    const nowPerf = performance.now();
    const now = Date.now();
    const dt = TICK_MS / 1000;
    if (this.trainer.demo) this.trainer.pollDemo();
    const d = this.trainer.data;
    const fresh = this.trainer.connected && nowPerf - this.trainer.lastDataAt < DATA_STALE_MS;
    this._fresh = fresh;
    this.power = fresh ? Math.max(0, d.powerW || 0) : 0;
    this.cadence = fresh ? Math.max(0, d.cadenceRpm || 0) : 0;
    const strapFresh = this.hrStrap?.connected && nowPerf - this.hrStrap.lastAt < HR_STALE_MS;
    this.hr = strapFresh ? this.hrStrap.bpm : fresh && d.heartRate ? d.heartRate : null;

    const est = fresh ? estimateRealRatio(d.speedKph, this.cadence) : null;
    if (est && est > 0.5 && est < 6) {
      this.realRatioEst = this.realRatioEst ? this.realRatioEst * 0.97 + est * 0.03 : est;
    }

    this._power3s.push([nowPerf, this.power]);
    while (this._power3s.length && nowPerf - this._power3s[0][0] > 3000) this._power3s.shift();

    const pedalling = this.power > 5 || this.cadence > 10;
    if (pedalling) this._lastActiveAt = nowPerf;

    // Auto start / auto pause
    if (this.autoStart && !this.held && !this.running && !this.autoPaused && pedalling && this.movingS === 0) this.start();
    if (this.running && !pedalling && this.speedMps < 0.5 && nowPerf - this._lastActiveAt > AUTO_PAUSE_MS) {
      this.running = false;
      this.autoPaused = true;
      this.recorder.stop(now);
      this._changed();
    }
    if (this.autoPaused && pedalling && !this.held) this.start();

    // Physics
    const p = this.physicsParams();
    const grade = this.gradePct;
    // An assisted conveyor (an escalator) carries you at its own pace (no road physics on it), and you slow gently onto it.
    const carry = this.carry;
    if (!carry) this.speedMps = stepSpeed(this.speedMps, this.power, grade, dt, p);
    // Demo mode holds a constant speed so every feature can be tried without a bike.
    if (this.demoSpeedMps != null) this.speedMps = this.running ? this.demoSpeedMps : 0;
    // (no corner speed cap: you carry your speed through a network's turns, U-turns included — PLAN 7.4)
    if (this.mode === 'route' && this.route?.carry && !this.routeDone) this.speedMps = carrySpeed(this.route, this.routePos, this.speedMps, dt);
    if (this.running) {
      const ds = this.speedMps * dt;
      this.distanceM += ds;
      if (this.mode === 'route' && this.route) {
        // Only count climbing along the route — not the jump to its starting elevation.
        const ele = routeAt(this.route, this.routePos).ele;
        // (a conveyor's lift isn't climbing you did)
        if (this._eleRoute === this.route && ele > this.altitudeM && !carry) this.elevGainM += ele - this.altitudeM;
        this._eleRoute = this.route;
        this.altitudeM = ele;
      } else {
        this._eleRoute = null;
        const dz = ds * Math.sin(Math.atan(grade / 100));
        this.altitudeM += dz;
        if (dz > 0) this.elevGainM += dz;
      }
      if (this.speedMps > 0.3 || pedalling || carry) this.movingS += dt;
      this._powerSum += this.power;
      this._powerN++;
      if (this.mode === 'workout' && this.workout && !this.workoutDone) this.workoutT += dt;
    }

    this._updateRoute();
    this._updateWorkout(now);
    this._record(now, carry ? 0 : grade);
    this._control(nowPerf, p, grade, carry, dt);
    this.dispatchEvent(new Event('tick'));
  }

  _updateRoute() {
    if (this.mode !== 'route' && this.sceneryRoute) this.sceneryRoute.netRide.update(this.sceneryPos);   // its path refills, its turns lock
    if (this.mode !== 'route' || !this.route || this.routeDone) return;
    if (this.routeGoalM != null && !this.routeGoalHit && this.distanceM - this.routeOffset >= this.routeGoalM) {
      this.routeGoalHit = true;
      if (this.settings.haptics) this.ride.vibrate();
      this.log('app', `Goal reached: ${this.route.name}`, 'ok');
      this.dispatchEvent(new Event('routeGoal'));
    }
    if (this.routeFinishM != null) {
      // point to point, not endless: the ride ends at the finish line
      if (this.distanceM - this.routeOffset >= this.routeFinishM) {
        this.routeDone = true;
        this._lastSent = null;
        this.log('app', `Finish: ${this.route.name}`, 'ok');
        this.dispatchEvent(new Event('routeFinished'));
      }
      return;
    }
    if (this.route.netRide) {
      // a network route: the path follows the plan (or your turns); a lap each time the plan comes round
      this.route.netRide.update(this.routePos);
      const lap = this.route.netRide.lapAt(this.routePos);
      if (lap !== this._lastLap) {
        this._lastLap = lap;
        if (this.recorder.active) this.recorder.lap(Date.now(), `${this.route.name} · lap ${lap}`);
        if (this.settings.haptics) this.ride.vibrate();
        this.log('app', `Lap ${lap} of ${this.route.name}`, 'ok');
        this.dispatchEvent(new Event('routeLap'));
      }
      return;
    }
    if (this.route.closed) {
      const lap = this.routeLap;
      if (lap !== this._lastLap) {
        this._lastLap = lap;
        if (this.recorder.active) this.recorder.lap(Date.now(), `${this.route.name} · lap ${lap}`);
        if (this.settings.haptics) this.ride.vibrate();
        this.log('app', `Lap ${lap} of ${this.route.name}`, 'ok');
        this.dispatchEvent(new Event('routeLap'));
      }
      return;
    }
    if (this.routeRidden >= this.route.total) {
      this.routeDone = true;
      this._lastSent = null;
      this.log('app', `Route complete: ${this.route.name}`, 'ok');
      this.dispatchEvent(new Event('routeFinished'));
    }
  }

  _updateWorkout(now) {
    if (this.mode !== 'workout' || !this.workout || this.workoutDone) return;
    const idx = segmentIndexAt(this.workout, this.workoutT);
    if (idx === -1) {
      this.workoutDone = true;
      this.segIndex = -1;
      this._lastSent = null;
      if (this.recorder.active) this.recorder.lap(now, 'After workout');
      this.log('app', `Workout complete: ${this.workout.name}. Shifting is back to normal.`, 'ok');
      this.dispatchEvent(new Event('workoutFinished'));
      this._changed();
      return;
    }
    if (idx !== this.segIndex) {
      this.segIndex = idx;
      const seg = this.workout.segments[idx];
      if (this.recorder.active) this.recorder.lap(now, seg.label);
      this._lastSent = null;
      if (this.settings.haptics) this.ride.vibrate();
      this.dispatchEvent(new Event('segment'));
      this._changed();
    }
  }

  _record(now, grade) {
    if (!this.running) { this._acc = { n: 0, p: 0, c: 0 }; return; }
    this._acc.n++; this._acc.p += this.power; this._acc.c += this.cadence;
    if (now - this._lastSampleAt < 1000) return;
    this._lastSampleAt = now;
    const n = this._acc.n || 1;
    let lat = null, lon = null;
    if (this.mode === 'route' && this.route) {
      const at = routeAt(this.route, this.routePos);
      lat = at.lat; lon = at.lon;
    }
    this.recorder.add([now, Math.round(this._acc.p / n), Math.round(this._acc.c / n),
      +this.speedMps.toFixed(3), +this.distanceM.toFixed(2), +this.altitudeM.toFixed(2),
      this.hr ?? 0, +grade.toFixed(2), lat, lon]);
    this._acc = { n: 0, p: 0, c: 0 };
  }

  /** Send the trainer the resistance for the current gear, cadence, grade or workout step. */
  _control(nowPerf, p, grade, carry = null, dt = TICK_MS / 1000) {
    // Ride feel (PLAN 6.11): the trainer gets Hill feel × grade (like Zwift's trainer difficulty), blended in over
    // distance and at most 1 %/s; in ERG the bike's momentum then takes the hill first (it bites as the bike slows).
    // Shifts still change resistance at once (the gear's speed is in the target, not in the lag).
    const v = this.speedMps;
    this.shapedGrade = shapeGrade(this.shapedGrade, feltGrade(grade, this.settings.hillFeel ?? HILL_FEEL_DEFAULT), v, dt);
    this.pedalGrade = momentumGrade(this.pedalGrade, this.shapedGrade, v, dt);
    const ergMode = this.settings.shiftMode === 'erg';
    this.trainerGrade = ergMode ? this.pedalGrade : this.shapedGrade;
    if (!this.trainer.connected || this.trainer.busy || this.trainer.reconnecting) return;
    // No recent data (Bluetooth hiccup): hold the last resistance rather than guessing.
    if (!this._fresh && this.workoutTarget == null) return;
    const diff = this.settings.difficulty / 100;
    const due = nowPerf - this._lastSentAt > 2000;
    const send = (key, fn) => {
      this._lastSent = key;
      this._lastSentAt = nowPerf;
      fn();
    };

    const wt = this.workoutTarget;
    if (wt != null) {
      this.target = { mode: 'ERG', value: wt, source: 'workout' };
      if (this._lastSent !== `w${wt}` || due) send(`w${wt}`, () => this.trainer.setErgWatts(wt));
      return;
    }

    if (carry) {
      // carried (an escalator): the lightest resistance, both modes; back to the gear's at the end
      const erg = this.settings.shiftMode === 'erg';
      this.target = { mode: erg ? 'ERG' : 'SIM', value: erg ? 0 : CARRY_SIM_GRADE, source: 'carry' };
      if (this._lastSent !== 'carry' || due) {
        this._lastSentMode = 'carry';
        send('carry', () => (erg ? this.trainer.setErgWatts(0) : this.trainer.setGrade(CARRY_SIM_GRADE, { windMps: 0, crr: 0, cw: 0 })));
      }
      return;
    }

    if (this.settings.shiftMode === 'erg') {
      const watts = ergTargetForBike(this.cadence, this.ratio, this.pedalGrade, v, p, diff);
      this.target = { mode: 'ERG', value: watts, source: 'gear' };
      const last = typeof this._lastSent === 'number' ? this._lastSent : null;
      if (last === null || this._lastSentMode !== 'erg' || Math.abs(watts - last) >= 3 || due) {
        this._lastSentMode = 'erg';
        send(watts, () => this.trainer.setErgWatts(watts));
      }
    } else {
      const g = simGradeForGear(this.cadence, this.ratio, this.realRatio, this.shapedGrade, p, diff);
      this.target = { mode: 'SIM', value: g, source: 'gear' };
      const last = typeof this._lastSent === 'number' ? this._lastSent : null;
      if (last === null || this._lastSentMode !== 'sim' || Math.abs(g - last) >= 0.2 || due) {
        this._lastSentMode = 'sim';
        send(g, () => this.trainer.setGrade(g, { windMps: 0, crr: p.crr, cw: 0 }));
      }
    }
  }

  settingsChanged() {
    this._lastSent = null;
    this._changed();
  }
}
