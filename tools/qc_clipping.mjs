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
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  const { server } = await serve(ROOT);   // (tools/lib/harness.mjs: code review P9)
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
