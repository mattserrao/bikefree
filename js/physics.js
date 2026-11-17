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

/**
 * Seconds for the trainer's grade to catch up with the road. A real bike carries its momentum into a hill and
 * slows over several seconds; without this, ERG jumped to the full hill wattage the instant the grade changed.
 */
export const MOMENTUM_TAU_S = 3;

/** One step of the momentum lag: move `cur` toward `target` with time constant `tau` over `dt` seconds. */
export function easeGrade(cur, target, dt, tau = MOMENTUM_TAU_S) {
  if (cur == null || !Number.isFinite(cur)) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(0.01, tau)));
}
