// Virtual pacer: a rider who holds a fixed power and rides the same road physics as you.
// Distances are "ridden" metres in the same frame as the rider's (route: metres from your start point;
// free ride / workouts: total metres), so the gap is simply pacer.dist − yours.
import { stepSpeed } from './physics.js';

export const PACER_WATTS = [75, 100, 125, 150, 175, 200];
export const PACER_LEAD_M = 8; // starts just in front of you

export class Pacer {
  constructor(watts = 0) {
    this.watts = watts;
    this.dist = 0;
    this.speed = 0;
    this.grade = 0;   // % grade where the pacer is (for its posture)
  }
  get on() { return this.watts > 0; }

  /** Put the pacer just ahead of a rider at `riderDist`, standing still. */
  reset(riderDist) {
    this.dist = riderDist + PACER_LEAD_M;
    this.speed = 0;
  }

  /** Advance dt seconds. gradeAt(dist) → % grade where the pacer is; params are the physics params. */
  step(dt, gradeAt, params) {
    if (!this.on || dt <= 0) return;
    // Small sub-steps keep it stable through the session's uneven tick spacing.
    let left = Math.min(dt, 2);
    while (left > 0) {
      const h = Math.min(0.25, left);
      this.grade = gradeAt(this.dist);
      this.speed = stepSpeed(this.speed, this.watts, this.grade, h, params);
      this.dist += this.speed * h;
      left -= h;
    }
  }

  /** Pedalling cadence for the animation. */
  get cadence() { return this.speed > 0.4 ? 82 + Math.min(8, this.watts / 40) : 0; }
}
