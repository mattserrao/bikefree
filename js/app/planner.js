// The map planner: plan your own route over a city's road network.
// (Part of the app: js/app.js imports every module in js/app/.)
import { saveSettings } from '../settings.js';
import { makePathRoute, planNext, planCloses, idsToKeys, edgeLines } from '../network.js';
import { planRide } from '../route-plan.js';
import { $, log, settings, session, fmtDist, distUnit, fmtElev, elevUnit, escapeHtml } from './core.js';
import { fmtPlanTime, planWatts } from './route-options.js';
import { routeItems, routeCache, selectedRouteId, resetRouteList, refreshRouteList } from './routes-menu.js';
import { city, renderCity } from './city-panel.js';

// ---------- Map planner (ride networks) ----------
// Tap a junction to start, then each segment to ride (only the ways on from where you've got to light up);
// tapping the segment you just rode turns back along it. A route that ends where it started laps; one that
// ends elsewhere finishes there. Saved in settings by segment names (they survive a rebuilt network).
const plan = { net: null, item: null, start: null, keys: [], layout: null };
function openPlanner(item = routeItems.find((it) => it.id === selectedRouteId)) {
  const r = item && routeCache.get(item.id);
  if (!r?.netRide || !item) return;
  plan.net = r.network; plan.item = item; plan.start = null; plan.keys = [];
  $('planTitle').textContent = `Plan your own route · ${(item.name || '').split(' · ')[0]}`;
  $('planName').value = '';
  $('planDlg').showModal();
  renderPlanner();
}
$('planOpen').addEventListener('click', () => openPlanner());
$('planUndo').addEventListener('click', () => { if (plan.keys.length) plan.keys.pop(); else plan.start = null; renderPlanner(); });
$('planClear').addEventListener('click', () => { plan.keys = []; plan.start = null; renderPlanner(); });
$('planName').addEventListener('input', () => renderPlanFacts());
$('planDlg').addEventListener('close', () => { if ($('planDlg').returnValue === 'save') savePlan(); });

function planLayout(canvas) {
  const net = plan.net, lines = edgeLines(net).map((x) => ({ e: x.e, lat: [...x.lat], lon: [...x.lon] }));   // (each segment from its own area's line)
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  let lat0 = 0, n = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of lines) for (const v of L.lat) { lat0 += v; n++; }
  lat0 /= n;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  for (const L of lines) for (let i = 0; i < L.lat.length; i++) {
    const x = L.lon[i] * kx, y = L.lat[i] * ky;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 34 * dpr, w = canvas.width, h = canvas.height;
  const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const X = (lon) => w / 2 + (lon * kx - cx) * sc, Y = (lat) => h / 2 - (lat * ky - cy) * sc;
  for (const L of lines) L.pts = L.lat.map((la, i) => [X(L.lon[i]), Y(la)]);
  const nodes = [...net.nodes.values()].map((nd) => ({ nd, x: X(nd.lon), y: Y(nd.lat) }));
  return { lines, nodes, dpr, w, h };
}
const segDist = (pts, x, y) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
};
function renderPlanner() {
  const c = $('planMap');
  plan.layout = planLayout(c);
  const { lines, nodes, dpr, w, h } = plan.layout, ctx = c.getContext('2d');
  const css = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  const accent = css('--accent', '#7aa9f5'), ink = css('--ink', '#ece9e1'), muted = css('--muted', '#a8a69d'), bg = css('--panel', '#262624');
  ctx.clearRect(0, 0, w, h);
  const stroke = (pts, color, width, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
  };
  for (const L of lines) stroke(L.pts, muted, 3);
  const next = plan.start ? planNext(plan.net, plan.keys, plan.start) : [];
  for (const o of next) stroke(lines.find((L) => L.e === o.t.e).pts, ink, 4, [6, 5]);
  // the route so far, with an arrow on each step
  plan.keys.forEach((k, j) => {
    const L = lines.find((x) => x.e.id === k.slice(0, -1)), pts = k.endsWith('+') ? L.pts : [...L.pts].reverse();
    stroke(pts, accent, 6);
    const m = Math.floor(pts.length / 2), [ax, ay] = pts[Math.max(0, m - 1)], [bx, by] = pts[Math.min(pts.length - 1, m + 1)];
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.save(); ctx.translate(pts[m][0], pts[m][1]); ctx.rotate(ang);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(7 * dpr, 0); ctx.lineTo(-5 * dpr, 5 * dpr); ctx.lineTo(-5 * dpr, -5 * dpr); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = ink; ctx.font = `600 ${11 * dpr}px system-ui`; ctx.fillText(String(j + 1), pts[m][0] + 8 * dpr, pts[m][1] - 8 * dpr);
  });
  for (const { nd, x, y } of nodes) {
    const isStart = nd.id === plan.start;
    ctx.fillStyle = isStart ? accent : ink; ctx.strokeStyle = bg; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(x, y, (isStart ? 8 : 6) * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ink; ctx.font = `${12 * dpr}px system-ui`;
    const tw = ctx.measureText(nd.name).width;
    ctx.fillText(nd.name, Math.min(w - tw - 4 * dpr, x + 10 * dpr), y - 10 * dpr);
  }
  $('planSub').textContent = !plan.start ? 'Tap a junction to start.' : next.length ? 'Tap the next segment (dashed) — the one you just rode turns back.' : '';
  $('planSteps').innerHTML = plan.keys.map((k) => {
    const e = plan.net.edges.get(k.slice(0, -1)), fwd = k.endsWith('+');
    return `<li>${escapeHtml((e.toward?.[fwd ? 0 : 1] || e.name).replace(/^./, (ch) => ch.toUpperCase()))}</li>`;
  }).join('');
  renderPlanFacts();
}
function renderPlanFacts() {
  const keys = plan.keys;
  if (!keys.length) { $('planFacts').innerHTML = ''; $('planSave').disabled = true; return; }
  const r = makePathRoute(plan.net, { id: 'plan', name: 'plan', path: keys });
  const sim = planRide(r, 0, { mode: 'dist', value: r.lapM }, { watts: planWatts(), params: session.physicsParams(), pointToPoint: false, stopAtEnd: false });
  const loop = planCloses(plan.net, keys);
  const endName = plan.net.nodes.get(keys.at(-1).endsWith('+') ? plan.net.edges.get(keys.at(-1).slice(0, -1)).to : plan.net.edges.get(keys.at(-1).slice(0, -1)).from).name;
  $('planFacts').innerHTML = `<span><b>${fmtDist(r.lapM, 1)}</b> ${distUnit()}</span><span><b>${fmtElev(r.lapClimbM).toLocaleString()}</b> ${elevUnit()} climb</span>` +
    `<span><b>~${fmtPlanTime(sim.timeS)}</b> at ${planWatts()} W</span><span>${loop ? 'Loop — rides round and round' : `One way — finishes at ${escapeHtml(endName)}`}</span>`;
  $('planSave').disabled = false;
}
$('planMap').addEventListener('click', (e) => {
  if (!plan.layout) return;
  const rect = e.currentTarget.getBoundingClientRect(), d = plan.layout.dpr;
  const x = (e.clientX - rect.left) * d, y = (e.clientY - rect.top) * d;
  if (!plan.start) {
    let best = null;
    for (const n of plan.layout.nodes) { const dd = Math.hypot(n.x - x, n.y - y); if (dd < 26 * d && (!best || dd < best.d)) best = { n, d: dd }; }
    if (best) { plan.start = best.n.nd.id; renderPlanner(); }
    return;
  }
  // the nearest of the ways on (by the segment's line); a segment both ways on from here (a loop edge): the closer end
  let best = null;
  for (const o of planNext(plan.net, plan.keys, plan.start)) {
    const L = plan.layout.lines.find((l) => l.e === o.t.e), dd = segDist(L.pts, x, y);
    if (dd < 22 * d && (!best || dd < best.d - .5)) best = { o, d: dd };
  }
  if (best) { plan.keys.push(best.o.key); renderPlanner(); }
});
async function savePlan() {
  if (!plan.keys.length) return;
  const cityName = (plan.item.name || '').split(' · ')[0];
  const name = $('planName').value.trim() || `My route ${(settings.netRoutes || []).length + 1}`;
  const id = `mynet-${Date.now().toString(36)}`;
  settings.netRoutes = [...(settings.netRoutes || []), { id, network: plan.item.network, name, keys: idsToKeys(plan.net, plan.keys), created: Date.now() }];
  saveSettings(settings);
  log('app', `Saved your route: ${cityName} · ${name}`, 'ok');
  resetRouteList();   // rebuild the list with it
  await refreshRouteList(id);
  if ($('cityDlg').open) { city.sel = id; city.seg = null; renderCity(); }
}

export { plan, openPlanner };
