// Rider profiles: the profile dialog and switching riders.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings, KG_PER_LB } from '../settings.js';
import * as store from '../store.js';
import { GENDERS, initials, cmToFtIn, ftInToCm } from '../profiles.js';
import { $, log, settings, profiles, session, imperial, fmtDist, distUnit, fmtElev, elevUnit, escapeHtml } from './core.js';
import { fact } from './preview.js';

// ---------- Profiles ----------
const riderName = (p) => p.name?.trim() || `Rider ${profiles.all.indexOf(p) + 1}`;
const fmtHours = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
function statFacts(st) {
  return fact(st.rides.toLocaleString(), st.rides === 1 ? 'ride' : 'rides') +
    fact(fmtDist(st.distanceM, st.distanceM < 16000 ? 1 : 0), `${distUnit()} ridden`) +
    fact(fmtHours(st.movingS), 'riding') +
    fact(fmtElev(st.ascentM).toLocaleString(), `${elevUnit()} climbed`);
}

let rideCache = [];
async function renderProfile() {
  rideCache = await store.listRides().catch(() => []);
  const p = profiles.active;
  const st = profiles.stats(p.id, rideCache);
  $('pAvatar').textContent = initials(p.name);
  $('pName').textContent = p.name?.trim() ? p.name.trim() : 'Set up profile';
  $('pStats').textContent = p.name?.trim() ? `${st.rides} ${st.rides === 1 ? 'ride' : 'rides'} · ${fmtDist(st.distanceM, st.distanceM < 16000 ? 1 : 0)} ${distUnit()}` : '';
  $('welcome').hidden = !!p.name?.trim() || profiles.all.length > 1;
  if ($('profileDlg').open) fillProfileStats();
}

const pform = $('profileDlg').querySelector('form');
$('pdGender').innerHTML = GENDERS.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
function fillProfileStats() {
  const p = profiles.active;
  $('pdStats').innerHTML = statFacts(profiles.stats(p.id, rideCache));
}
function fillProfile() {
  const p = profiles.active, f = pform.elements, imp = imperial();
  $('pdAvatar').textContent = initials(p.name);
  $('pdTitle').textContent = p.name?.trim() ? p.name.trim() : 'Your profile';
  $('pdSince').textContent = `Rider since ${new Date(p.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}`;
  const sw = $('pdSwitch');
  sw.innerHTML = profiles.all.map((x) => `<option value="${x.id}">${escapeHtml(riderName(x))}</option>`).join('');
  sw.value = p.id;
  sw.hidden = profiles.all.length < 2;
  f.pname.value = p.name || '';
  $('pdHeightImp').hidden = !imp;
  $('pdHeightMet').hidden = imp;
  if (p.heightCm) {
    const [ft, inch] = cmToFtIn(p.heightCm);
    f.hft.value = ft; f.hin.value = inch; f.hcm.value = Math.round(p.heightCm);
  } else { f.hft.value = ''; f.hin.value = ''; f.hcm.value = ''; }
  f.pweight.value = +(imp ? p.weightKg / KG_PER_LB : p.weightKg).toFixed(1);
  f.pgender.value = p.gender || '';
  f.pftp.value = p.ftp;
  for (const el of pform.querySelectorAll('.u-weight')) el.textContent = imp ? 'lb' : 'kg';
  // Riders can't be switched mid-ride: the ride belongs to whoever started it.
  const locked = session.hasRide;
  sw.disabled = locked;
  $('pdNew').disabled = locked;
  $('pdDelete').hidden = profiles.all.length < 2 || locked;
  $('pdNote').textContent = locked ? 'Finish the current ride to switch or add riders.' : 'Weight sets how hard climbs feel. Your profile and rides stay in this browser.';
  fillProfileStats();
  setTimeout(() => { if (!f.pname.value) f.pname.focus(); }, 0);
}
function openProfile() { renderProfile().then(fillProfile); fillProfile(); $('profileDlg').showModal(); }
$('profileBtn').addEventListener('click', openProfile);
$('welcomeBtn').addEventListener('click', openProfile);

function useActiveProfile() {
  settings.riderKg = profiles.active.weightKg;
  settings.ftp = profiles.active.ftp;
  saveSettings(settings);
  session.settingsChanged();
  renderProfile();
}
$('pdSwitch').addEventListener('change', (e) => {
  profiles.setActive(e.target.value);
  useActiveProfile();
  fillProfile();
});
$('pdNew').addEventListener('click', () => {
  profiles.create();
  useActiveProfile();
  fillProfile();
  pform.elements.pname.focus();
});
$('pdDelete').addEventListener('click', () => {
  const p = profiles.active;
  if (!confirm(`Delete ${riderName(p)}? Their saved rides are kept and move to ${riderName(profiles.all.find((x) => x.id !== p.id && x.id === profiles.firstId) || profiles.all.find((x) => x.id !== p.id))}.`)) return;
  profiles.remove(p.id);
  useActiveProfile();
  fillProfile();
});
$('profileDlg').addEventListener('close', () => {
  if ($('profileDlg').returnValue !== 'save') return;
  const f = pform.elements, imp = imperial();
  const heightCm = imp
    ? (f.hft.value || f.hin.value ? ftInToCm(f.hft.value, f.hin.value) : null)
    : (Number(f.hcm.value) || null);
  const kg = Number(f.pweight.value) * (imp ? KG_PER_LB : 1);
  profiles.update(profiles.active.id, {
    name: f.pname.value.trim(),
    heightCm: heightCm ? Math.round(heightCm * 10) / 10 : null,
    weightKg: kg > 20 ? Math.round(kg * 10) / 10 : profiles.active.weightKg,
    gender: f.pgender.value,
    ftp: Math.round(Number(f.pftp.value)) || profiles.active.ftp,
  });
  useActiveProfile();
  log('app', `Profile saved: ${riderName(profiles.active)}`, 'ok');
});

export { riderName, statFacts, renderProfile, useActiveProfile };
