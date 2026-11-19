#!/usr/bin/env node
// Clipping and overlap QC: open a route's real 3D scene in headless Chrome and look for things drawn
// through each other — the rider riding through objects, the camera inside walls, trees and posts inside
// buildings, bridges cutting through buildings, flickering coplanar surfaces, ground covering streets, and
// (in a city) traffic, people, trains and boats passing through the rider, each other or buildings.
//
//   npm run qc:clipping                         Pittsburgh (default) → tools/qc-clipping-report.html
//   node tools/qc_clipping.mjs zion bigsur      other routes
//   options: --no-life  --life-seconds 600  --shots 4 (pictures per check)  --json out.json  --strict
//            --chrome /path/to/chrome   (default: your installed Google Chrome; or set CHROME_PATH)
//
// The checks themselves live in tools/qc-clipping.js and run inside the page, on the app's own scene.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.gpx': 'application/gpx+xml', '.css': 'text/css', '.png': 'image/png' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    try { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
    catch { res.writeHead(404); res.end(); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const km = (m) => (m == null ? '–' : (m / 1000).toFixed(2));

function report(runs) {
  const sections = runs.map(({ park, info, result, shots }) => {
    const byCheck = new Map();
    for (const f of result.findings) { if (!byCheck.has(f.check)) byCheck.set(f.check, []); byCheck.get(f.check).push(f); }
    const summary = [...byCheck].map(([check, list]) => `<tr><td class="${list[0].severity}">${list[0].severity.toUpperCase()}</td><td>${esc(check)}</td><td>${list.length}</td><td>${esc(list[0].note)}</td></tr>`).join('');
    const rows = result.findings.map((f, n) => `<tr class="${f.severity}"><td>${f.severity.toUpperCase()}</td><td>${esc(f.check)}</td><td>${esc(f.label)}</td>
      <td>${km(f.from)}${f.to - f.from > 1 ? `–${km(f.to)}` : ''}${f.dirs && f.dirs !== 'both ways' ? ` <small>(${f.dirs})</small>` : ''}</td><td>${f.value ?? ''}</td><td>${f.count}</td><td>${esc(f.extra || '')}</td>
      <td>${f.at != null ? `<a href="world-preview.html?park=${park}&pos=${Math.round(f.at)}">ride</a>` : ''}${shots[n] ? ` · <a href="#shot-${park}-${n}">picture</a>` : ''}</td></tr>`).join('');
    const pics = Object.entries(shots).map(([n, url]) => { const f = result.findings[n]; return `<figure id="shot-${park}-${n}"><img src="${url}" alt="${esc(f.check)}"><figcaption><b class="${f.severity}">${esc(f.check)}</b> · ${esc(f.label)} · ${km(f.at)} km${f.extra ? ` · ${esc(f.extra)}` : ''}</figcaption></figure>`; }).join('');
    return `<section><h2>${esc(info.name)}</h2>
      <p>${km(info.total)} km ridden (${km(info.oneWay)} km one way) · ${info.meshes} meshes, ${Math.round(info.triangles).toLocaleString()} triangles, ${info.instances.toLocaleString()} trees/posts${info.city ? `, ${info.buildings.toLocaleString()} buildings` : ''} · life simulated ${result.life.simulated} s · took ${Object.entries(result.timing).map(([k, v]) => `${k} ${v}s`).join(', ')}</p>
      ${summary ? `<table><tr><th></th><th>check</th><th>findings</th><th>what</th></tr>${summary}</table>` : '<p class="ok">No clipping or overlap found.</p>'}
      ${pics ? `<div class="pics">${pics}</div>` : ''}
      ${rows ? `<details open><summary>All findings</summary><table><tr><th></th><th>check</th><th>objects</th><th>km (one way)</th><th>worst</th><th>hits</th><th>detail</th><th>look</th></tr>${rows}</table></details>` : ''}</section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>bikefree clipping QC</title><style>
  :root{color-scheme:light dark;--fg:#1d2733;--bg:#f6f8fb;--card:#fff;--accent:#2f6fde;--line:#d8dee8}
  @media (prefers-color-scheme:dark){:root{--fg:#e6ebf2;--bg:#11161d;--card:#18202a;--line:#2b3644}}
  body{font:14px/1.45 system-ui,sans-serif;color:var(--fg);background:var(--bg);margin:0 auto;padding:24px;max-width:1200px}
  h1{color:var(--accent)} section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:18px 0}
  table{border-collapse:collapse;width:100%;margin:8px 0} td,th{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  .fail,tr.fail td:first-child{color:#d64545;font-weight:600} .warn,tr.warn td:first-child{color:#c98a12;font-weight:600} tr.info{opacity:.65} .ok{color:#27ae60}
  a{color:var(--accent)} .pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px} figure{margin:0} img{width:100%;border-radius:6px;border:1px solid var(--line)} figcaption{font-size:12px}
  </style></head><body><h1>Clipping &amp; overlap QC</h1><p>Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Each route's real scene, checked along the whole ride. <em>ride</em>/<em>drone</em> links open the 3D preview (run <code>npm start</code>, open this report from <code>tools/</code>).</p>${sections}</body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const shotsPer = Number(opt('--shots', 4)), json = opt('--json', null), lifeSeconds = opt('--life-seconds', null);
  const html = opt('--html', 'tools/qc-clipping-report.html'), chrome = opt('--chrome', process.env.CHROME_PATH || null);
  const why = flag('--why'), lifeOnly = flag('--life-only'), noLife = flag('--no-life'), strict = flag('--strict'), quality = opt('--quality', 'balanced');
  const parks = args.length ? args : ['pittsburgh'];

  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch { console.error('playwright-core is missing: run npm install'); process.exit(2); }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const launch = { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };
  const browser = await chromium.launch(chrome ? { ...launch, executablePath: chrome } : { ...launch, channel: 'chrome' });
  const runs = [];
  let bad = false;
  try {
    for (const park of parks) {
      const page = await browser.newPage({ viewport: { width: 640, height: 384 } });
      page.on('pageerror', (e) => console.error(`  page error: ${e.message}`));
      await page.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));   // bundled scenery only
      await page.goto(`${base}/tools/qc-clipping.html`);
      await page.waitForFunction(() => window.qcReady && window.qc, null, { timeout: 60000 });
      const t0 = Date.now();
      process.stdout.write(`${park}: building the scene… `);
      const info = await page.evaluate(([p, q]) => window.qc.load(p, q), [park, quality]);
      process.stdout.write(`${info.meshes} meshes, ${Math.round(info.triangles).toLocaleString()} triangles. Checking… `);
      const result = await page.evaluate((o) => window.qc.run(o), { why, lifeOnly, life: !noLife, lifeSeconds: lifeSeconds == null ? undefined : Number(lifeSeconds) });
      console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      const shots = {};
      const per = new Map();
      for (const [n, f] of result.findings.entries()) {
        if (f.severity === 'info' || /rider$|solid$|overlap$|water$|bridge$|land$/.test(f.check) && /^(vehicle|person|train|boat|vehicles)/.test(f.check)) continue;   // moving things: a still can't show the moment
        const k = per.get(f.check) || 0; if (k >= shotsPer) continue; per.set(f.check, k + 1);
        shots[n] = await page.evaluate((x) => window.qc.shot(x), f);
      }
      const counts = { fail: 0, warn: 0, info: 0 }; for (const f of result.findings) counts[f.severity]++;
      console.log(`  ${counts.fail} fail · ${counts.warn} warn · ${counts.info} info`);
      const byCheck = new Map(); for (const f of result.findings) byCheck.set(`${f.severity.toUpperCase().padEnd(4)} ${f.check}`, (byCheck.get(`${f.severity.toUpperCase().padEnd(4)} ${f.check}`) || 0) + 1);
      for (const [k, n] of byCheck) console.log(`    ${k.padEnd(34)} ${n}`);
      runs.push({ park, info, result, shots });
      bad ||= counts.fail > 0 || (strict && counts.warn > 0);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  if (json) await writeFile(json, JSON.stringify(runs.map(({ park, info, result }) => ({ park, info, ...result })), null, 2));
  if (html) { const out = resolve(ROOT, html); await writeFile(out, report(runs)); console.log(`\nReport: ${relative(process.cwd(), out)}`); }
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
