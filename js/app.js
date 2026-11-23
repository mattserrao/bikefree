// bikefree: the app. Each part of the page lives in js/app/ (one module per section); this entry wires them up
// and boots the menu.
import * as store from './store.js';
import { registerServiceWorker } from './offline.js';
import { log, profiles, trainer, ride, hrStrap, session } from './app/core.js';
import { deviceStatus } from './app/devices.js';
import { plan } from './app/planner.js';
import { pacer, renderPacerChoice } from './app/pacer-ui.js';
import { applyHudPrefs, world } from './app/ride-screen.js';
import { ftpRun } from './app/hud.js';
import { refreshRouteList, routesLoaded } from './app/routes-menu.js';
import { refreshWorkoutList } from './app/workouts-ui.js';
import { checkRecovery } from './app/summary.js';
import { renderProfile } from './app/profiles-ui.js';
import './app/route-options.js';
import './app/preview.js';
import './app/city-panel.js';
import './app/route-loading.js';
import './app/offline-ui.js';
import './app/settings-ui.js';
import './app/pause-graphics.js';
import './app/hud-layout.js';

// ---------- Boot ----------
renderPacerChoice();
applyHudPrefs();
renderProfile();
session.autoStart = false;
deviceStatus();
const listShown = refreshRouteList();
refreshWorkoutList();
checkRecovery();
// The service worker's first install precaches the app (code, styles and the catalogs, ~4 MB): not while the menu is
// loading (PLAN 7.11) — once the list and its background routes are in and the page is idle
const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 1000));
listShown.catch(() => {}).then(() => routesLoaded).catch(() => {}).then(() => whenIdle(() => registerServiceWorker(log)));
log('app', 'Ready. Close Zwift, Zwift Companion and the Wahoo app, then connect your devices.');

// For debugging in the browser console.
window.bikefree = { pacer, session, trainer, ride, hrStrap, store, profiles, get world() { return world; }, get ftpRun() { return ftpRun; }, get plan() { return plan; } };
