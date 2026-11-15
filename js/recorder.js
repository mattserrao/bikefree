// Records a ride at 1 Hz, tracks pause/resume and laps, summarizes, and exports .fit.
import { FitWriter, fitTime, semicircles, SPORT_CYCLING, SUB_SPORT_INDOOR, SUB_SPORT_VIRTUAL } from './fit.js';

// Sample layout (compact arrays keep storage small)
export const S = { T: 0, POWER: 1, CAD: 2, SPEED: 3, DIST: 4, ALT: 5, HR: 6, GRADE: 7, LAT: 8, LON: 9 };

export class Recorder {
  constructor() { this.reset(); }

  reset() {
    this.samples = [];
    this.events = [];   // {t, type:'start'|'stop'}
    this.laps = [];     // {startT, endT, startIdx, endIdx, label}
    this.startedAt = null;
    this._lapStartT = null;
    this._lapStartIdx = 0;
    this._lapLabel = null;
    this.timerOn = false;
  }

  get active() { return this.startedAt != null; }

  start(t) {
    if (this.timerOn) return;
    if (this.startedAt == null) { this.startedAt = t; this._lapStartT = t; }
    this.timerOn = true;
    this.events.push({ t, type: 'start' });
  }

  stop(t) {
    if (!this.timerOn) return;
    this.timerOn = false;
    this.events.push({ t, type: 'stop' });
  }

  add(sample) { this.samples.push(sample); }

  /** Close the current lap and start a new one. */
  lap(t, nextLabel = null) {
    if (!this.active) return;
    if (this.samples.length > this._lapStartIdx) {
      this.laps.push({ startT: this._lapStartT, endT: t, startIdx: this._lapStartIdx, endIdx: this.samples.length, label: this._lapLabel });
    }
    this._lapStartT = t;
    this._lapStartIdx = this.samples.length;
    this._lapLabel = nextLabel;
  }

  setLapLabel(label) { this._lapLabel = label; }

  /** End the ride. @returns ride object (plain data, storable) or null if nothing recorded */
  finish(t, meta = {}) {
    if (!this.samples.length) return null;
    this.stop(t);
    this.lap(t);
    const ride = {
      id: this.startedAt,
      startedAt: this.startedAt,
      endedAt: t,
      ...meta,
      samples: this.samples,
      events: this.events,
      laps: this.laps,
    };
    ride.summary = summarize(ride.samples, 0, ride.samples.length, ride.startedAt, t);
    return ride;
  }

  /** Snapshot for crash recovery. */
  snapshot(meta = {}) {
    if (!this.samples.length) return null;
    const t = this.samples[this.samples.length - 1][S.T];
    const laps = [...this.laps];
    if (this.samples.length > this._lapStartIdx) {
      laps.push({ startT: this._lapStartT, endT: t, startIdx: this._lapStartIdx, endIdx: this.samples.length, label: this._lapLabel });
    }
    const ride = { id: this.startedAt, startedAt: this.startedAt, endedAt: t, ...meta,
      samples: this.samples, events: [...this.events, { t, type: 'stop' }], laps, recovered: true };
    ride.summary = summarize(ride.samples, 0, ride.samples.length, ride.startedAt, t);
    return ride;
  }
}

/** Stats for samples[from, to). Each sample is one second of timer time. */
export function summarize(samples, from, to, startT, endT) {
  const n = to - from;
  const out = {
    timerS: n, elapsedS: Math.max(n, Math.round(((endT ?? 0) - (startT ?? 0)) / 1000)),
    distanceM: 0, avgPower: 0, maxPower: 0, avgHr: null, maxHr: null, avgCadence: 0, maxCadence: 0,
    avgSpeed: 0, maxSpeed: 0, ascentM: 0, kj: 0, np: 0,
  };
  if (n <= 0) return out;
  let pSum = 0, hrSum = 0, hrN = 0, cSum = 0, cN = 0, asc = 0;
  for (let i = from; i < to; i++) {
    const s = samples[i];
    pSum += s[S.POWER];
    out.maxPower = Math.max(out.maxPower, s[S.POWER]);
    if (s[S.HR]) { hrSum += s[S.HR]; hrN++; out.maxHr = Math.max(out.maxHr ?? 0, s[S.HR]); }
    if (s[S.CAD] > 0) { cSum += s[S.CAD]; cN++; }
    out.maxCadence = Math.max(out.maxCadence, s[S.CAD]);
    out.maxSpeed = Math.max(out.maxSpeed, s[S.SPEED]);
    if (i > from) { const d = s[S.ALT] - samples[i - 1][S.ALT]; if (d > 0) asc += d; }
  }
  const d0 = from > 0 ? samples[from - 1][S.DIST] : samples[from][S.DIST] - samples[from][S.SPEED];
  out.distanceM = Math.max(0, samples[to - 1][S.DIST] - Math.max(0, d0));
  out.avgPower = pSum / n;
  out.kj = pSum / 1000;
  out.avgHr = hrN ? hrSum / hrN : null;
  out.avgCadence = cN ? cSum / cN : 0;
  out.avgSpeed = out.distanceM / n;
  out.ascentM = asc;
  out.np = normalizedPower(samples, from, to);
  return out;
}

/** Normalized power: 4th-power mean of 30 s rolling average. */
export function normalizedPower(samples, from, to) {
  if (to - from < 30) return 0;
  let win = 0, sum4 = 0, count = 0;
  const q = [];
  for (let i = from; i < to; i++) {
    const p = samples[i][S.POWER];
    q.push(p); win += p;
    if (q.length > 30) win -= q.shift();
    if (q.length === 30) { sum4 += (win / 30) ** 4; count++; }
  }
  return count ? (sum4 / count) ** 0.25 : 0;
}

/** Build a .fit file for a ride. */
export function rideToFit(ride) {
  const w = new FitWriter();
  const hasGps = ride.samples.some((s) => s[S.LAT] != null);
  const t0 = fitTime(ride.startedAt);
  const tEnd = fitTime(ride.endedAt);

  w.write('file_id', { type: 4, manufacturer: 255, product: 1, serial_number: ride.startedAt % 4294967295 || 1, time_created: t0 });

  // Interleave records and timer events in time order.
  const events = [...ride.events].sort((a, b) => a.t - b.t);
  let e = 0;
  for (const s of ride.samples) {
    while (e < events.length && events[e].t <= s[S.T]) {
      w.write('event', { timestamp: fitTime(events[e].t), event: 0, event_type: events[e].type === 'start' ? 0 : 4 });
      e++;
    }
    w.write('record', {
      timestamp: fitTime(s[S.T]),
      position_lat: s[S.LAT] != null ? semicircles(s[S.LAT]) : null,
      position_long: s[S.LON] != null ? semicircles(s[S.LON]) : null,
      altitude: s[S.ALT],
      heart_rate: s[S.HR] || null,
      cadence: Math.round(s[S.CAD]),
      distance: s[S.DIST],
      speed: s[S.SPEED],
      power: Math.round(s[S.POWER]),
      grade: s[S.GRADE],
    });
  }
  for (; e < events.length; e++) {
    w.write('event', { timestamp: fitTime(events[e].t), event: 0, event_type: events[e].type === 'start' ? 0 : 4 });
  }

  const lapMsg = (sum, startT, endT) => ({
    start_time: fitTime(startT), total_elapsed_time: sum.elapsedS, total_timer_time: sum.timerS,
    total_distance: sum.distanceM, total_calories: Math.round(sum.kj), avg_speed: sum.avgSpeed,
    max_speed: sum.maxSpeed, avg_heart_rate: sum.avgHr != null ? Math.round(sum.avgHr) : null,
    max_heart_rate: sum.maxHr, avg_cadence: Math.round(sum.avgCadence), max_cadence: Math.round(sum.maxCadence),
    avg_power: Math.round(sum.avgPower), max_power: Math.round(sum.maxPower), total_ascent: Math.round(sum.ascentM),
  });

  const laps = ride.laps.length ? ride.laps
    : [{ startT: ride.startedAt, endT: ride.endedAt, startIdx: 0, endIdx: ride.samples.length }];
  laps.forEach((lap, i) => {
    const sum = summarize(ride.samples, lap.startIdx, lap.endIdx, lap.startT, lap.endT);
    w.write('lap', { message_index: i, timestamp: fitTime(lap.endT), event: 9, event_type: 1,
      lap_trigger: i === laps.length - 1 ? 7 : 0, sport: SPORT_CYCLING, ...lapMsg(sum, lap.startT, lap.endT) });
  });

  const total = ride.summary;
  w.write('session', { message_index: 0, timestamp: tEnd, event: 8, event_type: 1, sport: SPORT_CYCLING,
    sub_sport: hasGps ? SUB_SPORT_VIRTUAL : SUB_SPORT_INDOOR, first_lap_index: 0, num_laps: laps.length,
    ...lapMsg(total, ride.startedAt, ride.endedAt) });

  const tzOffsetS = -new Date(ride.endedAt).getTimezoneOffset() * 60;
  w.write('activity', { timestamp: tEnd, total_timer_time: total.timerS, num_sessions: 1, type: 0,
    event: 26, event_type: 1, local_timestamp: tEnd + tzOffsetS });

  return w.finish();
}

export function fitFilename(ride) {
  const d = new Date(ride.startedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const slug = (ride.name || 'ride').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `bikefree-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${slug}.fit`;
}
