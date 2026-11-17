// Scene linter: checks scene JSON against the toolbox schema (js/world/toolbox/scene-schema.js).
//
//   npm run lint:scenes                        # every scene in routes/scenes
//   node tools/lint_scene.mjs routes/scenes/route28.json
//   node tools/lint_scene.mjs --strict …       # warnings fail too
//
// Errors: an unknown top-level field (with a "did you mean"), a missing required field, a wrong type, an
// unknown pack, a field that only works on another terrain. Warnings: an unknown field inside a block,
// an old field name (still works; the toolbox name is suggested), a stylized scene missing the standard
// look (gentle cartoon + baked light) — informational for scenes made before the toolbox.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENE_FIELDS, FIELD_ALIASES } from '../js/world/toolbox/scene-schema.js';
import { PACK_META, packId } from '../js/world/toolbox/packs/meta.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const distance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
  return d[a.length][b.length];
};
const suggest = (name, options) => {
  const best = options.map((o) => [o, distance(name, o)]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(2, name.length / 3) ? ` (did you mean "${best[0]}"?)` : '';
};
const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

// fields that only do something on one kind of terrain
const NEEDS = {
  mountainRoad: ['real-mountain'], glacier: ['real-mountain'], glaciers: ['real-mountain'], burns: ['real-mountain'],
  streams: ['real-mountain'], lakeIslands: ['real-mountain'], terrainGridFile: ['real-coast', 'real-mountain', 'authored-city'],
  terrainData: ['authored-region'], cityData: ['authored-city'], streetKit: ['authored-city'], heroes: ['authored-city'],
  junctions: ['authored-city'], riverfront: ['authored-city'], coastline: [undefined, 'authored-coast', 'authored-region'],
};

/** Lint one scene object. Returns { errors: [], warnings: [] }. */
export function lintScene(scene, name = 'scene') {
  const errors = [], warnings = [];
  const known = Object.keys(SCENE_FIELDS);
  if (typeOf(scene) !== 'object') return { errors: [`${name}: not a JSON object`], warnings };
  const wire = scene.style === 'wireframe';
  for (const [key, spec] of Object.entries(SCENE_FIELDS)) {
    if (!spec.required || key in scene) continue;
    if (wire && ['palette'].includes(key)) continue;
    errors.push(`${name}: missing required field "${key}" (${spec.doc})`);
  }
  for (const [key, value] of Object.entries(scene)) {
    if (FIELD_ALIASES[key]) { warnings.push(`${name}: "${key}" is the old name for "${FIELD_ALIASES[key]}" (still works)`); continue; }
    const spec = SCENE_FIELDS[key];
    if (!spec) { errors.push(`${name}: unknown field "${key}"${suggest(key, known)}`); continue; }
    if (spec.type !== 'any' && typeOf(value) !== spec.type) errors.push(`${name}: "${key}" should be ${spec.type === 'array' ? 'an array' : `a ${spec.type}`}, not ${typeOf(value)}`);
    if (NEEDS[key] && !NEEDS[key].includes(scene.terrain)) errors.push(`${name}: "${key}" only works with terrain ${NEEDS[key].filter(Boolean).map((t) => `"${t}"`).join(' or ')} (this scene: "${scene.terrain}")`);
    if (spec.keys) {
      const items = Array.isArray(value) ? value.filter((v) => typeOf(v) === 'object') : typeOf(value) === 'object' ? [value] : [];
      for (const item of items) for (const k of Object.keys(item)) {
        if (!spec.keys.includes(k)) warnings.push(`${name}: unknown field "${key}.${k}"${suggest(k, spec.keys)}`);
      }
    }
  }
  for (const p of scene.packs || scene.kitExtensions || []) {
    const id = packId(p);
    if (!id) errors.push(`${name}: unknown pack "${p}"${suggest(p, Object.entries(PACK_META).flatMap(([k, m]) => [k, ...m.aliases]))} — packs: ${Object.keys(PACK_META).join(', ')}`);
    else if (id !== p) warnings.push(`${name}: pack "${p}" is now called "${id}"`);
  }
  if (scene.format && scene.format !== 'bikefree-scene-1') errors.push(`${name}: format must be "bikefree-scene-1"`);
  if (scene.style && !['stylized', 'wireframe'].includes(scene.style)) errors.push(`${name}: style must be "stylized" or "wireframe"`);
  if (scene.life?.kit && !['wildlife', 'coast'].includes(scene.life.kit)) errors.push(`${name}: life.kit must be "wildlife" or "coast"`);
  if (scene.style === 'stylized' && scene.terrain !== 'authored-city') {
    if (!scene.look) warnings.push(`${name}: no "look" — the toolbox standard is "gentle"`);
    if (!scene.lighting?.baked) warnings.push(`${name}: no baked lighting — the toolbox standard is "lighting": { "baked": "<time>" }`);
  }
  return { errors, warnings };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const quiet = args.includes('--quiet');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) files = readdirSync(join(ROOT, 'routes/scenes')).filter((f) => f.endsWith('.json') && !f.endsWith('-city.json')).map((f) => `routes/scenes/${f}`);
  let errors = 0, warnings = 0;
  for (const f of files) {
    const scene = JSON.parse(readFileSync(f.startsWith('/') ? f : join(ROOT, f), 'utf8'));
    const r = lintScene(scene, basename(f, '.json'));
    errors += r.errors.length; warnings += r.warnings.length;
    for (const e of r.errors) console.log(`error  ${e}`);
    if (!quiet) for (const w of r.warnings) console.log(`warn   ${w}`);
  }
  console.log(`\n${files.length} scenes: ${errors} errors, ${warnings} warnings`);
  process.exitCode = errors || (strict && warnings) ? 1 : 0;
}
