// After editing PGH's map by hand (tools/pgh-editor.html → routes/cities/pgh.json): bring the rest up to date.
//   1. the routes laid out again on the edited ways (tools/pgh_routes.mjs --write: routes/cities/pgh-presets.json and
//      pgh.json's presets; the editor drops a route that ran over a way it split or removed)
//   2. with the OSM cache (tools/.cache/osm-pgh: on the machine that built PGH): the city data (sidewalks, one-ways,
//      buildings by way) and the bridge models again, then the routes again (they read the one-ways). Without it these
//      are kept: the editor keeps every way's id, so they still fit; a new way just has no city data yet.
//   3. the checks: the routes' own (twice, turns, one-ways), overpasses and underpasses, the tests' sanity of the file
//   4. the app's cache key (sw-assets.js), so phones load the new map
//
//   node tools/pgh_after_edit.mjs
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGraph } from '../js/graph.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (cmd, show = 2) => {
  const t0 = Date.now();
  try {
    const out = execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
    const lines = out.trim().split('\n');
    console.log(`· ${cmd} (${((Date.now() - t0) / 1000).toFixed(0)} s)${show ? '\n    ' + lines.slice(-show).join('\n    ') : ''}`);
    return out;
  } catch (err) { console.log(`✗ ${cmd}\n    ${String(err.stderr || err.message).trim().split('\n').slice(-3).join('\n    ')}`); process.exitCode = 1; return ''; }
};

// the file itself: it decodes, every way's ends are junctions, ids unique
const json = JSON.parse(readFileSync(resolve(root, 'routes/cities/pgh.json'), 'utf8'));
const G = decodeGraph(json);
const ids = new Set(G.edges.map((e) => e.id));
const bad = G.edges.filter((e) => !G.nodes.has(e.from) || !G.nodes.has(e.to));
if (ids.size !== G.edges.length || bad.length) { console.log(`✗ routes/cities/pgh.json: ${G.edges.length - ids.size} repeated way ids, ${bad.length} ways ending at no junction — open it in the editor again`); process.exit(1); }
const deg = new Map(); for (const e of G.edges) for (const v of [e.from, e.to]) deg.set(v, (deg.get(v) || 0) + 1);
console.log(`PGH: ${G.edges.length} ways, ${deg.size} junctions, ${[...deg.values()].filter((d) => d === 1).length} dead ends`);

const osm = existsSync(resolve(root, 'tools/.cache/osm-pgh')) && readdirSync(resolve(root, 'tools/.cache/osm-pgh')).some((f) => f.endsWith('.osm'));
const routes = () => {
  const L = run('node tools/pgh_routes.mjs --write', 0).split('\n');
  L.forEach((l, i) => { if (/^\s*checks:/.test(l)) { const r = L.slice(0, i).reverse().find((x) => / km, /.test(x)) || ''; console.log(`    ${r.replace(/ \(pgh-[^)]*\)/, '').split(',').slice(0, 2).join(',')} — ${l.trim()}`); } });
};
routes();
if (osm) {
  run('python3 tools/pgh_city.py', 1);
  run('node tools/pgh_bridges.mjs', 1);
  routes();
} else console.log('· no OSM cache here (tools/.cache/osm-pgh): the city data and the bridge models are kept as they are');
{ const x = run('node tools/pgh_crossings.mjs', 0).split('\n'); console.log('    ' + x.slice(0, 6).join('\n    ')); }   // (the summary, and the first few to look at)
run('node tools/build_routes.mjs', 1);
console.log(process.exitCode ? '\nSomething failed (above).' : '\nDone: commit routes/cities/ and sw-assets.js.');
