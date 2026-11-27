// Snapshots of tools/desert-kit-preview.html (Out West's desert trees and red-rock pieces on their own): node tools/snap_kit.mjs kit hoodoo arch butte tunnel "tunnel&in" → tools/snapshots/kit-<mode>.png
import { chromium } from 'playwright-core';
import http from 'node:http'; import { readFile, mkdir } from 'node:fs/promises'; import { extname, join } from 'node:path'; import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));   // (the repo this file is in: no hard-coded checkout — code review P10)
const outDir = join(root, 'tools', 'snapshots'); await mkdir(outDir, { recursive: true });
const srv = http.createServer(async (q, s) => { try { const p = decodeURIComponent(q.url.split('?')[0]); const b = await readFile(join(root, p)); s.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[extname(p)] || 'application/octet-stream' }); s.end(b); } catch { s.writeHead(404); s.end(); } }).listen(8765);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); }); p.on('pageerror', (e) => console.log('err', e.message));
for (const mode of process.argv.slice(2)) {
  await p.goto(`http://localhost:8765/tools/desert-kit-preview.html?mode=${mode}`); await p.waitForFunction(() => window.done, null, { timeout: 120000 });
  console.log(mode, await p.evaluate(() => window.tris)); await p.screenshot({ path: join(outDir, `kit-${mode.replace('&', '_')}.png`) });
}
await b.close(); srv.close();
