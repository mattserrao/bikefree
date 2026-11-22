// The workout list: built-in and your own .zwo / .erg files.
// (Part of the app: js/app.js imports every module in js/app/.)
import * as store from '../store.js';
import { parseWorkout, BUILT_IN_WORKOUTS, targetWatts, markFtpTest } from '../workout.js';
import { $, log, settings, fmtTime, escapeHtml } from './core.js';
import { renderPreview } from './preview.js';
import { drawThumbs } from './routes-menu.js';
import { closeMenus } from './route-loading.js';

// ---------- Workouts ----------
let workoutItems = [];
let previewWorkout = null;
let selectedWorkoutId = null;
const workoutCache = new Map();

function parseWorkoutItem(item) {
  if (!workoutCache.has(item.id)) {
    const w = parseWorkout(item.text, item.filename || '');
    if (!w.name || w.name === 'Workout') w.name = item.name.replace(' (built-in)', '');
    if (item.ftpTest) markFtpTest(w);
    workoutCache.set(item.id, w);
  }
  return workoutCache.get(item.id);
}

async function refreshWorkoutList(selectId) {
  const builtins = BUILT_IN_WORKOUTS.map((b) => ({ ...b, kind: 'workout', name: `${parseWorkout(b.text).name} (built-in)` }));
  workoutItems = [...builtins, ...(await store.listLibrary('workout').catch(() => []))];
  if (selectId || !workoutItems.some((w) => w.id === selectedWorkoutId)) selectedWorkoutId = selectId || workoutItems[0].id;
  renderWorkoutList();
  previewSelectedWorkout();
}

function renderWorkoutList() {
  $('workoutList').innerHTML = workoutItems.map((it) => {
    let w = null;
    try { w = parseWorkoutItem(it); } catch { /* shown as unreadable */ }
    return `<button class="wrow ${it.id === selectedWorkoutId ? 'on' : ''}" data-id="${it.id}">
      <span><b>${escapeHtml(w ? w.name : it.name)}</b><span class="rsub">${w ? `${fmtTime(w.duration)}${it.id.startsWith('builtin') ? ' · built-in' : ''}` : 'Could not read this file'}</span></span>
      <canvas></canvas></button>`;
  }).join('');
  drawThumbs();
}
$('workoutList').addEventListener('click', (e) => {
  const row = e.target.closest('.wrow');
  if (!row) return;
  selectedWorkoutId = row.dataset.id;
  for (const r of $('workoutList').children) r.classList.toggle('on', r === row);
  previewSelectedWorkout();
});

function previewSelectedWorkout() {
  const item = workoutItems.find((w) => w.id === selectedWorkoutId);
  $('workoutDelete').hidden = !item || item.id.startsWith('builtin');
  if (!item) return;
  try {
    previewWorkout = parseWorkoutItem(item);
  } catch (err) {
    previewWorkout = null;
    log('app', `Could not read workout: ${err.message}`, 'error');
    return;
  }
  renderPreview();
}

function workoutStats(w) {
  let work = 0, maxW = 0;
  for (const s of w.segments) {
    if (s.kind !== 'erg') continue;
    work += targetWatts(s, s.start + s.duration / 2, settings.ftp) * s.duration;
    maxW = Math.max(maxW, targetWatts(s, s.start, settings.ftp), targetWatts(s, s.start + s.duration, settings.ftp));
  }
  return { kj: Math.round(work / 1000), maxW };
}

$('workoutDelete').addEventListener('click', async () => {
  closeMenus();
  const id = selectedWorkoutId;
  if (!id || id.startsWith('builtin') || !confirm('Remove this workout from your library?')) return;
  await store.deleteLibraryItem(id);
  workoutCache.delete(id);
  selectedWorkoutId = null;
  await refreshWorkoutList();
});
$('workoutFile').addEventListener('change', async (e) => {
  closeMenus();
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const w = parseWorkout(text, file.name);
    const name = w.name && w.name !== 'Workout' ? w.name : file.name.replace(/\.\w+$/, '');
    const id = `workout-${Date.now()}`;
    await store.saveLibraryItem({ id, kind: 'workout', name, text, filename: file.name });
    log('app', `Loaded workout ${name}`, 'ok');
    await refreshWorkoutList(id);
  } catch (err) {
    log('app', `Could not load workout: ${err.message}`, 'error');
  }
});

export { previewWorkout, workoutCache, refreshWorkoutList, renderWorkoutList, workoutStats };
