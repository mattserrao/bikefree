#!/usr/bin/env node
// Ride feel trace (PLAN 6.11): ride the real Session in Node with a fake trainer — a rider holding a constant cadence
// in one gear, the trainer holding the ERG target (with a ~1 s response) — and print the target watts, the grade the
// trainer feels and the on-screen speed over time, for the current code and (with --before) the code at 08cd816.
//
//   node tools/ride_feel_trace.mjs                 # all scenarios, after vs before, a summary table
//   node tools/ride_feel_trace.mjs --trace alpe    # one scenario second by second (alpe | canton | descent | step6)
//   node tools/ride_feel_trace.mjs --csv out.csv   # every scenario, every second, both versions
//
// Also used by test/hill-feel.test.mjs (`makeRide`, `stepRoute`).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEFORE_REV = '08cd816';
const TICK_S = 0.25;

// ---------- a fake clock (the session reads performance.now() and Date.now()) ----------
let clockMs = 1e6;
let clockOn = false;
function useFakeClock() {
  if (clockOn) return;
  clockOn = true;
  const perf = globalThis.performance;
  Object.defineProperty(globalThis, 'performance', { value: { ...perf, now: () => clockMs }, configurable: true, writable: true });
  Date.now = () => 1.7e12 + clockMs;
}

class Fake extends EventTarget { vibrate() {} }

/** The session's js modules: the working tree's, or `rev`'s (copied to a temp dir). */
async function loadJs(rev = null) {
  let dir = path.join(ROOT, 'js');
  if (rev) {
    dir = path.join(os.tmpdir(), `bikefree-js-${rev}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['session.js', 'physics.js', 'parsers.js', 'recorder.js', 'fit.js', 'gpx.js', 'workout.js', 'settings.js']) {
      fs.writeFileSync(path.join(dir, f), execFileSync('git', ['-C', ROOT, 'show', `${rev}:js/${f}`]));
    }
  }
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  return { session: await imp('session.js'), physics: await imp('physics.js'), gpx: await imp('gpx.js'), settings: await imp('settings.js') };
}

/**
 * A ride: the real Session, a trainer that holds the ERG target (first-order, `trainerTauS`) or, in SIM, a rider
 * making `simPowerW`; the rider pedals `cadence` rpm in `gear`.
 */
export async function makeRide({ rev = null, settings = {}, cadence = 85, gear = 12, trainerTauS = 1, simPowerW = 200 } = {}) {
  useFakeClock();
  const js = await loadJs(rev);
  const trainer = new Fake();
  Object.assign(trainer, {
    connected: true, busy: false, reconnecting: false, demo: false, lastDataAt: clockMs,
    data: { powerW: 0, cadenceRpm: cadence, speedKph: 30 },
    erg: null, sim: null,
    setErgWatts(w) { this.erg = w; this.sim = null; },
    setGrade(g) { this.sim = g; this.erg = null; },
  });
  const s = { ...js.settings.DEFAULT_SETTINGS, ...settings, startGear: gear };
  const session = new js.session.Session({ trainer, ride: new Fake(), hr: null, log: () => {}, settings: s });
  clearInterval(session._timer);
  const ride = {
    js, session, trainer, t: 0, cadence,
    /** One tick: the trainer's power answers its last target, the rider's cadence held, then the session ticks. */
    tick() {
      clockMs += TICK_S * 1000;
      ride.t += TICK_S;
      const want = trainer.erg != null ? trainer.erg : trainer.sim != null ? simPowerW : 0;
      const p = trainer.data.powerW;
      trainer.data.powerW = ride.cadence < 15 ? 0 : p + (want - p) * (1 - Math.exp(-TICK_S / trainerTauS));
      trainer.data.cadenceRpm = ride.cadence;
      trainer.lastDataAt = clockMs;
      session._tick();
    },
    /** Ride steady on the flat (free ride, 0 %) for `s` seconds: the bike up to its gear's speed. */
    settle(sec = 60) { session.setGrade(0); for (let i = 0; i < sec / TICK_S; i++) ride.tick(); },
    route(points, name = 'trace') { return js.gpx.buildRoute({ name, points }); },
  };
  return ride;
}

/** Ride a route from startM for `sec` seconds; one row a tick: {t, d, road, felt, target, power, kph}. */
export function stepRoute(ride, route, startM, sec, finishM = null) {
  const { session } = ride;
  session.setRoute(route, startM, finishM);
  const rows = [];
  for (let i = 0; i < sec / TICK_S; i++) {
    ride.tick();
    rows.push({
      t: +(i * TICK_S + TICK_S).toFixed(2), d: session.routePos, road: session.gradePct, felt: session.trainerGrade,
      target: session.target?.value ?? 0, power: session.power, kph: session.speedMps * 3.6,
    });
    if (session.routeDone) break;
  }
  return rows;
}

// ---------- scenarios ----------
function gpxPoints(file, fromM, toM, reverse = false, gpx) {
  const full = gpx.buildRoute({ ...gpx.parseGpx(fs.readFileSync(path.join(ROOT, file), 'utf8')), name: file });
  const pts = [];
  for (let d = fromM; d <= toM; d += 10) { const a = gpx.routeAt(full, d); pts.push({ lat: a.lat, lon: a.lon, ele: a.ele }); }
  return reverse ? pts.reverse() : pts;
}

export const SCENARIOS = {
  alpe: { label: "Alpe d'Huez: Bourg d'Oisans into the first hairpins (112.0–117.0 km)", file: 'routes/parks/alpedhuez.gpx', from: 112000, to: 117000, sec: 600 },
  canton: { label: 'Pittsburgh, Canton Ave (Beechview) climbed: the Slopes route 8.95 → 8.15 km reversed', file: 'routes/cities/pittsburgh-slopes.gpx', from: 8150, to: 8950, reverse: true, sec: 240 },
  descent: { label: "Alpe d'Huez's descent into the valley (107.4–111.0 km)", file: 'routes/parks/alpedhuez.gpx', from: 107400, to: 111000, sec: 300 },
  cantonDown: { label: 'Pittsburgh, down Canton Ave: the Slopes route 8.15 → 8.95 km', file: 'routes/cities/pittsburgh-slopes.gpx', from: 8150, to: 8950, sec: 150 },
};

export async function runScenario(key, { rev = null, cadence = 85, gear = 12, hillFeel = 50 } = {}) {
  const sc = SCENARIOS[key];
  const ride = await makeRide({ rev, cadence, gear, settings: { hillFeel } });
  ride.settle(60);
  const route = ride.route(gpxPoints(sc.file, sc.from, sc.to, sc.reverse, ride.js.gpx), sc.label);
  return stepRoute(ride, route, 0, sc.sec, route.total - 1);
}

/** Summary numbers of a trace: the first hill's rise (s to 50 / 90 %), the biggest one-second step, descent watts. */
export function summarize(rows) {
  const at1 = rows.filter((r) => Number.isInteger(r.t));
  let maxUp = 0, maxDown = 0;
  for (let i = 1; i < at1.length; i++) { const dw = at1[i].target - at1[i - 1].target; maxUp = Math.max(maxUp, dw); maxDown = Math.min(maxDown, dw); }
  let maxFeltRate = 0;
  for (let i = 1; i < at1.length; i++) maxFeltRate = Math.max(maxFeltRate, Math.abs(at1[i].felt - at1[i - 1].felt));
  const t0 = rows[0].target;
  const minW = Math.min(...rows.map((r) => r.target)), maxW = Math.max(...rows.map((r) => r.target));
  return { start: t0, minW, maxW, maxUpWps: Math.round(maxUp), maxDownWps: Math.round(maxDown), maxFeltPctPerS: +maxFeltRate.toFixed(2), timeS: rows.at(-1).t, km: +(rows.at(-1).d / 1000).toFixed(2) };
}

function every(rows, s) { return rows.filter((r) => Math.abs(r.t / s - Math.round(r.t / s)) < 1e-6); }

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const cadence = +opt('--cadence', 85), gear = +opt('--gear', 12), hillFeel = +opt('--hill-feel', 50);
  const keys = opt('--trace') ? [opt('--trace')] : Object.keys(SCENARIOS);
  const csv = opt('--csv');
  const lines = csv ? ['scenario,version,t,d,road,felt,target,power,kph'] : null;
  console.log(`Rider: ${cadence} rpm in gear ${gear}, ERG, Hill feel ${hillFeel} %, trainer response 1 s. Before = ${BEFORE_REV}.`);
  for (const key of keys) {
    const after = await runScenario(key, { cadence, gear, hillFeel });
    const before = await runScenario(key, { rev: BEFORE_REV, cadence, gear, hillFeel });
    console.log(`\n## ${SCENARIOS[key].label}`);
    console.log(' before', JSON.stringify(summarize(before)));
    console.log(' after ', JSON.stringify(summarize(after)));
    if (opt('--trace')) {
      const step = +opt('--every', 2);
      console.log('   t    m   road | before: felt   W   km/h | after: felt   W   km/h');
      const b = every(before, step), a = every(after, step);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = b[i], y = a[i];
        const f = (r) => r ? `${r.felt.toFixed(1).padStart(5)} ${String(r.target).padStart(4)} ${r.kph.toFixed(1).padStart(5)}` : ' '.repeat(16);
        const r0 = y || x;
        console.log(`${String(r0.t).padStart(5)} ${String(Math.round(r0.d)).padStart(4)} ${r0.road.toFixed(1).padStart(5)} |      ${f(x)} |      ${f(y)}`);
      }
    }
    if (lines) for (const [v, rows] of [['before', before], ['after', after]]) for (const r of every(rows, 1)) lines.push([key, v, r.t, r.d.toFixed(1), r.road.toFixed(2), r.felt.toFixed(2), r.target, r.power.toFixed(0), r.kph.toFixed(2)].join(','));
  }
  if (csv) { fs.writeFileSync(csv, lines.join('\n') + '\n'); console.log(`\nwrote ${csv}`); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
