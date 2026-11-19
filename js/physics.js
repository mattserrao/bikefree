// Bike physics and virtual gears. Pure functions — unit-tested in Node.

export const G = 9.81;
export const RHO = 1.2;            // air density kg/m³
export const WHEEL_CIRC = 2.105;   // m, 700x25c
export const DRIVETRAIN_LOSS = 0.03;

export const DEFAULTS = {
  riderKg: 80,
  bikeKg: 9,
  crr: 0.004,
  cda: 0.32,
};

// 24 virtual gear ratios (chainring/cog), easiest → hardest, similar spread to Zwift's.
export const GEAR_RATIOS = [
  0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68,
  1.86, 2.04, 2.22, 2.40, 2.61, 2.82, 3.03, 3.24,
  3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49,
];
export const DEFAULT_GEAR = 12; // 1-based

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Virtual road speed (m/s) for a cadence (rpm) in a gear ratio. */
export function speedFromCadence(cadenceRpm, ratio) {
  return (Math.max(0, cadenceRpm) / 60) * ratio * WHEEL_CIRC;
}

/** Resisting force at the wheel (N) at speed v (m/s) on a grade (percent). */
export function resistForce(v, gradePct, p = DEFAULTS) {
  const m = p.riderKg + p.bikeKg;
  const theta = Math.atan(gradePct / 100);
  return m * G * (p.crr * Math.cos(theta) + Math.sin(theta)) + 0.5 * RHO * p.cda * v * v;
}

/** Rider power (W) needed to hold speed v on a grade, including drivetrain loss. */
export function powerRequired(v, gradePct, p = DEFAULTS) {
  return (resistForce(v, gradePct, p) * v) / (1 - DRIVETRAIN_LOSS);
}

/**
 * Advance speed one time step from rider power (handles coasting and acceleration).
 * @returns new speed m/s
 */
export function stepSpeed(v, powerW, gradePct, dt, p = DEFAULTS) {
  const m = p.riderKg + p.bikeKg;
  const drive = (Math.max(0, powerW) * (1 - DRIVETRAIN_LOSS)) / Math.max(v, 1.0);
  const a = (drive - resistForce(v, gradePct, p)) / m;
  return Math.max(0, v + a * dt);
}

/**
 * ERG-mode virtual shifting: the wattage the trainer should hold so pedalling at this
 * cadence in this gear feels like riding at the matching speed on this grade.
 */
export function ergTargetForGear(cadenceRpm, ratio, gradePct, p = DEFAULTS, difficulty = 1) {
  if (cadenceRpm < 15) return 0;
  const v = speedFromCadence(cadenceRpm, ratio);
  return clamp(Math.round(powerRequired(v, gradePct, p) * difficulty), 0, 1500);
}

/**
 * SIM-mode virtual shifting: the grade to send so the trainer's resistance at the pedals
 * matches the virtual gear. The trainer brakes based on its own flywheel speed (set by the
 * real chain ratio). Pedal torque = wheel force × ratio, so scaling force by
 * virtualRatio/realRatio matches pedal torque.
 * We send zero wind resistance with this, so aero is folded into the grade.
 */
export function simGradeForGear(cadenceRpm, virtualRatio, realRatio, gradePct, p = DEFAULTS, difficulty = 1) {
  const m = p.riderKg + p.bikeKg;
  const v = speedFromCadence(cadenceRpm, virtualRatio);
  const fVirtual = resistForce(v, gradePct, p);
  const fTrainer = fVirtual * (virtualRatio / realRatio) * difficulty;
  const grade = (fTrainer / (m * G) - p.crr) * 100;
  return clamp(Math.round(grade * 10) / 10, -10, 20);
}

/** Estimate the real chain ratio from trainer speed and cadence (null if not usable). */
export function estimateRealRatio(trainerSpeedKph, cadenceRpm) {
  if (!(cadenceRpm > 50) || !(trainerSpeedKph > 5)) return null;
  return (trainerSpeedKph / 3.6) / ((cadenceRpm / 60) * WHEEL_CIRC);
}

// ---------- Ride feel (ride-feel-test) ----------

/** Hill feel choices (%): how much of the road grade the trainer passes on, like Zwift's "trainer difficulty". */
export const HILL_FEEL_OPTIONS = [25, 50, 75, 100];
export const HILL_FEEL_DEFAULT = 50;   // Zwift's default

/**
 * The grade the trainer should feel: the road grade scaled by Hill feel (flat riding is untouched, and the
 * on-screen speed still uses the real grade, as in Zwift).
 */
export function feltGrade(gradePct, hillFeelPct = HILL_FEEL_DEFAULT) {
  return gradePct * clamp(hillFeelPct, 0, 100) / 100;
}

// ---------- Hill feel, up and down (PLAN 6.11) ----------
//
// Three stages between the road and the trainer, each run once per tick by the session:
//   road grade → feltGrade (Hill feel) → shapeGrade (blended over distance, ≤ 1 %/s)
//     → SIM: sent as it is (the trainer's own flywheel carries the momentum)
//     → ERG: momentumGrade (the bike's momentum takes the hill first) → ergTargetForBike (gear demand + descent floor)

/** Most the felt grade changes per second (%/s), however sharp the road's change. */
export const GRADE_RATE_PCT_S = 1;
/** The felt grade blends toward the road's over a distance of GRADE_BLEND_M + GRADE_BLEND_S × speed (longer at speed). */
export const GRADE_BLEND_M = 2;
export const GRADE_BLEND_S = 1;
/** Below this speed the blend runs as if rolling at it, so a change while stopped (free ride ▲ ▼) still arrives. */
const GRADE_BLEND_MIN_MPS = 1.5;

/**
 * One step of the felt grade's shaping: blend toward `target` over distance (ds = metres ridden this step, at
 * speed v), then limit the change to GRADE_RATE_PCT_S. `cur` null: start at the target.
 */
export function shapeGrade(cur, target, v, dt) {
  if (cur == null || !Number.isFinite(cur)) return target;
  const sp = Math.max(GRADE_BLEND_MIN_MPS, v || 0);
  const len = GRADE_BLEND_M + GRADE_BLEND_S * sp;
  const want = cur + (target - cur) * (1 - Math.exp(-(sp * dt) / len));
  const max = GRADE_RATE_PCT_S * dt;
  return cur + clamp(want - cur, -max, max);
}

/**
 * Momentum (ERG). A bike rolling into a hill doesn't meet the hill's full force at the pedals at once: the force
 * first slows the bike, and the pedals take up the load as the bike gives up its speed. Modelled as a drivetrain
 * that picks up the hill's force in proportion to the share of the bike's speed it has lost: the speed it loses
 * builds at the unmet force / mass and the pedals' share of the force is mass × MOMENTUM_ACCEL × (speed lost /
 * speed), so the hill bites over τ = speed / MOMENTUM_ACCEL — ~5 s at 25 km/h, longer when you come in faster,
 * shorter as the bike slows on the climb (mass cancels: a heavier bike carries more momentum into a hill that
 * also pulls harder). The same holds at a crest (the load eases off as the bike picks up speed) and into a descent.
 */
export const MOMENTUM_ACCEL = 1.3;     // m/s²: tuned so a 5–8 % hill entered at 25 km/h is at ~90 % in ~10 s (Hill feel 50 %)
export const MOMENTUM_MIN_TAU_S = 0.8; // at a crawl the load still comes over the trainer's own response time

/** One step of the grade the pedals feel in ERG: toward `target` (the shaped felt grade) over τ = v / MOMENTUM_ACCEL, ≤ 1 %/s. */
export function momentumGrade(cur, target, v, dt) {
  if (cur == null || !Number.isFinite(cur)) return target;
  const tau = Math.max(MOMENTUM_MIN_TAU_S, Math.max(0, v || 0) / MOMENTUM_ACCEL);
  const max = GRADE_RATE_PCT_S * dt;     // and, like the shaped grade, at most 1 %/s (the bike slowing fast on a wall)
  return cur + clamp((target - cur) * (1 - Math.exp(-dt / tau)), -max, max);
}

/**
 * Descents: pedalling still meets resistance — the air and rolling drag of the bike you're driving at the descent's
 * speed (up to the fastest your gear still drives it, gear speed / SPIN_OUT_FROM), taken at the speed your gear turns
 * the pedals, × DESCENT_FLOOR_SHARE. It fades as the bike runs away from your gear (you spin out), to
 * DESCENT_FLOOR_MIN of that (never 0 while you pedal; coasting, under 15 rpm, is 0).
 */
export const DESCENT_FLOOR_SHARE = 0.7;
export const DESCENT_FLOOR_MIN = 0.4;
export const SPIN_OUT_FROM = 0.95;     // gear speed / bike speed where the fade starts…
export const SPIN_OUT_TO = 0.5;        // …and where it's all the way down to DESCENT_FLOOR_MIN
export const PEDAL_FLOOR_MIN_W = 10;

/** Engagement of the pedals with the bike: 1 while the gear keeps up with it, down to DESCENT_FLOOR_MIN as you spin out. */
export function gearEngagement(gearMps, bikeMps) {
  if (!(bikeMps > 0.5)) return 1;
  const x = clamp((gearMps / bikeMps - SPIN_OUT_TO) / (SPIN_OUT_FROM - SPIN_OUT_TO), 0, 1);
  const s = x * x * (3 - 2 * x);
  return DESCENT_FLOOR_MIN + (1 - DESCENT_FLOOR_MIN) * s;
}

/** The descent floor (W) for pedalling at this cadence and gear with the bike at bikeMps (0 below 15 rpm: coasting). */
export function descentFloorW(cadenceRpm, ratio, bikeMps, p = DEFAULTS, difficulty = 1) {
  if (cadenceRpm < 15) return 0;
  const vc = speedFromCadence(cadenceRpm, ratio);
  const vb = clamp(bikeMps || 0, vc, vc / SPIN_OUT_FROM);  // the bike's speed, as far as your gear still drives it
  const drag = resistForce(vb, 0, p);                       // air + rolling at that speed
  const w = (drag * vc / (1 - DRIVETRAIN_LOSS)) * DESCENT_FLOOR_SHARE * gearEngagement(vc, bikeMps);
  return Math.max(PEDAL_FLOOR_MIN_W, w * difficulty);
}

/**
 * ERG target for the simulated bike: the gear/cadence demand on the grade the pedals feel (`momentumGrade`), never
 * under the descent floor while you pedal. Shifting changes it at once (the gear speed), the hill comes in with the bike.
 */
export function ergTargetForBike(cadenceRpm, ratio, pedalGradePct, bikeMps, p = DEFAULTS, difficulty = 1) {
  if (cadenceRpm < 15) return 0;
  const v = speedFromCadence(cadenceRpm, ratio);
  const demand = powerRequired(v, pedalGradePct, p) * difficulty;
  return clamp(Math.round(Math.max(demand, descentFloorW(cadenceRpm, ratio, bikeMps, p, difficulty))), 0, 1500);
}
