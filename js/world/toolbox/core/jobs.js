// Jobs: long builds written as generators so they can run in frame-sized slices (PLAN F30 — an area built on the
// ride must not stall the view) or all at once (the start, behind the loader; tools and tests), with the same code
// in the same order either way, so the result is the same.
//
// A job is a generator. It checks `due()` at points where it may pause (between streets, between buildings…) and
// yields there when its slice is used up; a nested job is called with `yield*`. Outside a slice (`drain`) `due()`
// is never true, so the job runs straight through without pausing. A job may also `yield { wait: promise }` to
// pause until the promise settles (only the world's area builder runs those: `drain` can't wait).
//
//   const L = drain(makeCityLandscapeJob(...));          // all at once
//   const r = runSlice(job, 4);                          // up to ~4 ms now: { done, value } or { done: false, wait }

/** The current slice's deadline (performance.now() ms); Infinity outside a slice. */
export const clock = { deadline: Infinity };

/** Is the slice used up? (Checked at a job's pause points; cheap.) */
export const due = () => performance.now() > clock.deadline;

/** Array.prototype.forEach as a job: `fn` exactly as forEach calls it, pausing between items when the slice is used up. */
export function* each(arr, fn) {
  for (let k = 0, n = arr.length; k < n; k++) {
    if (k in arr) fn(arr[k], k, arr);
    if (due()) yield;
  }
}

/** Run a job to the end now (no pauses). */
export function drain(job) {
  const outer = clock.deadline;
  clock.deadline = Infinity;
  try {
    for (;;) {
      const r = job.next();
      if (r.done) return r.value;
      if (r.value?.wait) throw new Error('drain: this job waits for something; run it with runSlice');
    }
  } finally { clock.deadline = outer; }
}

/**
 * Run a job for up to `ms` (it pauses at its next pause point after that): { done: true, value } when it finished,
 * else { done: false, wait } (wait: a promise it is waiting for, if that's why it paused).
 */
export function runSlice(job, ms) {
  const outer = clock.deadline;
  clock.deadline = performance.now() + ms;
  try {
    for (;;) {
      const r = job.next();
      if (r.done) return { done: true, value: r.value };
      if (r.value?.wait) return { done: false, wait: r.value.wait };
      if (due()) return { done: false };
    }
  } finally { clock.deadline = outer; }
}

/** Array.prototype.map as a job: `fn` exactly as map calls it, pausing between items when the slice is used up. */
export function* mapJob(arr, fn) {
  const out = new Array(arr.length);
  for (let k = 0, n = arr.length; k < n; k++) {
    if (k in arr) out[k] = fn(arr[k], k, arr);
    if (due()) yield;
  }
  return out;
}

/** As mapJob, with a job for each item (`gen` a generator function): it may pause inside an item too. */
export function* mapGen(arr, gen) {
  const out = new Array(arr.length);
  for (let k = 0, n = arr.length; k < n; k++) {
    if (k in arr) out[k] = yield* gen(arr[k], k, arr);
    if (due()) yield;
  }
  return out;
}
