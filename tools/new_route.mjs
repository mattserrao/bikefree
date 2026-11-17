// New-route scaffold: starts a route from a biome preset (routes/presets) with the toolbox standard look.
//
//   npm run new-route -- <id> --preset mountain --name "Mont Ventoux" --park "Bédoin → summit, Provence"
//   npm run new-route -- <id> --preset forest-lake --name "…" --waypoints "44.17,5.27;44.17,5.28" --one-way
//   npm run new-route -- --list            # the presets
//
// Options: --preset forest-lake | mountain | coast | city | desert-canyon (default mountain), --name, --park,
// --region, --waypoints "lat,lon;lat,lon;…" (BRouter waypoints, in the middle of each hamlet on the intended
// road), --km "min,max" (expected full-lap length), --one-way (race stage: stops at the finish),
// --no-branch (don't create <id>-test), --force (overwrite an existing scene).
//
// It writes routes/scenes/<id>.json (the preset with this route's names and terrain paths), adds the catalog
// entry under Rough Drafts, appends a PLAN.md section with the new-route workflow as a checklist, writes
// docs/<id>/REVIEW.md, and prints the commands to run next. Nothing is placed by distance yet: the road comes
// first (claude/new_route.md, step 2).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lintScene } from './lint_scene.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };

const presets = Object.fromEntries(readdirSync(join(ROOT, 'routes/presets')).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(ROOT, 'routes/presets', f), 'utf8'))]));
if (flag('--list')) {
  for (const [id, p] of Object.entries(presets)) console.log(`${id.padEnd(14)} ${p.preset.name} — ${p.preset.description}\n${' '.repeat(15)}terrain: ${p.preset.terrainTool}\n`);
  process.exit(0);
}
const presetId = opt('--preset', 'mountain');
const name = opt('--name', null), park = opt('--park', ''), region = opt('--region', '');
const waypoints = (opt('--waypoints', '') || '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));
const km = (opt('--km', '') || '').split(',').filter(Boolean).map(Number);
const oneWay = flag('--one-way'), noBranch = flag('--no-branch'), force = flag('--force');
const id = args[0];
if (!id || !/^[a-z][a-z0-9]*$/.test(id)) { console.log('usage: npm run new-route -- <id> --preset <biome> --name "…"   (id: lowercase letters and digits)\n       npm run new-route -- --list'); process.exit(1); }
const preset = presets[presetId];
if (preset) preset.preset.terrainTool = preset.preset.terrainTool.replaceAll('<id>', args[0] || '<id>');
if (!preset) { console.log(`no preset "${presetId}": ${Object.keys(presets).join(', ')}`); process.exit(1); }

const sceneFile = `routes/scenes/${id}.json`;
if (existsSync(join(ROOT, sceneFile)) && !force) { console.log(`${sceneFile} exists (use --force)`); process.exit(1); }

// branch first, so every file lands on it
if (!noBranch) {
  const branch = `${id}-test`;
  const r = spawnSync('git', ['checkout', '-b', branch], { cwd: ROOT, encoding: 'utf8' });
  console.log(r.status === 0 ? `branch ${branch}` : `branch not created (${(r.stderr || '').trim()}) — carrying on`);
}

// scene
const scene = structuredClone(preset.scene);
scene.title = name || id; scene.region = region || park;
if (['real-coast', 'real-mountain'].includes(scene.terrain) || scene.terrain === 'authored-city') scene.terrainGridFile = `routes/scenes/${id}-terrain.grid.bin.gz`;
if (scene.terrain === 'authored-city') scene.cityData = `routes/scenes/${id}-city.json`;
const lint = lintScene(scene, id);
if (lint.errors.length) { console.log(lint.errors.join('\n')); process.exit(1); }
writeFileSync(join(ROOT, sceneFile), JSON.stringify(scene, null, 2) + '\n');
console.log(`${sceneFile}  (preset ${presetId}: ${preset.preset.name})`);

// catalog entry (Rough Drafts)
const catalogFile = join(ROOT, 'routes/catalog.json');
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
if (!catalog.some((r) => r.id === id)) {
  const entry = { id, name: name || id, park: park || region || '', file: `routes/parks/${id}.gpx`, outAndBack: !oneWay, ...(oneWay ? { oneWay: true } : {}),
    expectedKm: km.length === 2 ? km : [0, 0], routing: { profile: 'fastbike', expect_km: km.length === 2 ? (oneWay ? km : km.map((k) => Math.round(k / 2))) : [0, 0], waypoints }, scene: sceneFile, stage: 'draft' };
  catalog.push(entry);
  writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`routes/catalog.json  + ${id} (Rough Drafts)`);
}

// PLAN.md section
const plan = `
## ${name || id} (\`${id}-test\`)

**Goal:** a new route from the \`${presetId}\` preset (${preset.preset.name}) with the toolbox standard look (gentle cartoon, baked midday light).

**Decisions:**
- Real road: _which road, which direction, one way or out and back_
- Art level, weather, traffic, life: _from the preset unless decided otherwise_

**Passes** (claude/new_route.md):
- [ ] 2 Road: GPX within 30 m of the chosen road, course QC clean (\`python3 tools/build_park_routes.py ${id}\`, \`npm run routes:build\`, \`npm run qc -- ${id}\`)
- [ ] 2b Wireframe ride (optional)
- [ ] 3 Baseline review in docs/${id}/REVIEW.md
- [ ] 4 Terrain and water (${preset.preset.terrainTool.split('  ')[0]})
- [ ] 5 Vegetation (regional pack: ${(scene.packs || ['none yet']).join(', ')})
- [ ] 6 Atmosphere (fog layers, vista kit)
- [ ] 7 Towns and landmarks (placed by distance once the road is final)
- [ ] 8 Life and polish
- [ ] 9 Check and ship: \`npm run lint:scenes\`, \`npm test\`, \`qc --strict\`, snapshots, ride on the M4 Air
`;
appendFileSync(join(ROOT, 'PLAN.md'), plan);
console.log('PLAN.md  + section');

const docDir = join(ROOT, 'docs', id);
mkdirSync(docDir, { recursive: true });
if (!existsSync(join(docDir, 'REVIEW.md'))) {
  writeFileSync(join(docDir, 'REVIEW.md'), `# ${name || id} — review\n\nPreset: \`${presetId}\` (${preset.preset.name}). Fixed spots: _list the distances you snapshot every pass_.\n\n## Baseline\n\n| Spot | Problem | Measured | Confidence |\n| --- | --- | --- | --- |\n\n## After\n`);
  console.log(`docs/${id}/REVIEW.md`);
}

console.log(`
Next:
  1. Road:     ${waypoints.length ? '' : 'add routing.waypoints to the catalog entry, then '}python3 tools/build_park_routes.py ${id}
               npm run routes:build && npm run qc -- ${id}
  2. Terrain:  ${preset.preset.terrainTool}
  3. Look:     npm run snap -- ${id}@1000 ${id}@5000      (and tools/world-preview.html?park=${id})
  4. Toolbox:  TOOLBOX.md lists every kit, pack and scene field; tools/toolbox-gallery.html shows the models.
`);
