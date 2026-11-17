// Biome presets: scene templates for new routes, built from the finished routes' look blocks (palette,
// planting, atmosphere, vista, weather …) with every distance-placed or place-specific item left out, and the
// toolbox standard laid over them: the gentle cartoon look, a fixed midday sun with baked shadows, and the
// regional pack and vista kit where they fit.
//
//   node tools/build_presets.mjs          # writes routes/presets/<biome>.json
//   node tools/build_presets.mjs --check  # fails if a preset is out of date (part of npm test)
//
// npm run new-route copies one of these into a new scene. Edit the SOURCE scenes or the rules below, not the
// generated presets.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scene = (id) => JSON.parse(readFileSync(join(ROOT, 'routes/scenes', `${id}.json`), 'utf8'));
const pick = (s, keys) => Object.fromEntries(keys.filter((k) => k in s).map((k) => [k, structuredClone(s[k])]));

// the toolbox standard for every new route (lean cartoon style, decided 16 Nov 2026)
const STANDARD = { look: 'gentle', timeOfDay: 'midday', lighting: { baked: 'midday' } };

const PRESETS = {
  'forest-lake': {
    from: 'route28',
    name: 'Forest and lakes',
    description: 'Northern forest road past lakes and villages: continuous canopy, mown verge, lake water with treeline reflections, villages and camps from the real shoreline.',
    terrainTool: 'python3 tools/build_scene_terrain.py <id>  (USGS 30 m grid + lakes → <id>.terrain.bin; add "terrainData" from its output)',
    keys: ['terrain', 'assets', 'extraAssets', 'biome', 'reliefM', 'palette', 'vegetation', 'season', 'atmosphere', 'water', 'packs', 'poles'],
    add: { towns: [], signs: [], lookouts: [] },
  },
  mountain: {
    from: 'goingtothesun',
    name: 'Mountain pass',
    description: 'Real-elevation mountain road: forest by elevation zone up to treeline and snow, rock faces with ribs and ledges, aerial haze, ridge ink and cartoon cumulus (vista kit), roadside verge, worn alpine road surface, light traffic.',
    terrainTool: 'python3 tools/build_terrain_grid.py <id>  (AWS Terrain Tiles: 10 m near the road, 40 m out to the horizon)',
    keys: ['terrain', 'realHorizon', 'assets', 'extraAssets', 'biome', 'palette', 'snowLineM', 'treelineM', 'vegetation', 'vista', 'atmosphere', 'weather', 'water', 'packs', 'post', 'bridgeColors'],
    tidy: (s) => {
      delete s.vegetation.windows?.at;   // GTTS's view windows at its real overlooks
      s.road = { surface: 'worn', zones: [] };
      s.verge = { markers: { units: 'km' }, poles: [], posts: [], debris: [], reachM: 1300 };
      s.traffic = { perMinute: 3 };
      s.weather.labels = { marine: 'Valley fog', clouds: 'Clouds on the peaks' };
      s.terrainBuild = { lakes: true, padM: 9000, coarseM: 40, fineM: 900, fineCellM: 10, minLakeHa: 3, lakeNames: [] };
    },
    add: { mountainRoad: { tunnels: [], waterfalls: [] }, bridges: [], signs: [], lookouts: [] },
  },
  coast: {
    from: 'bigsur',
    name: 'Coast highway',
    description: 'Real coast: surf on the real shoreline, shallows from the sea floor, cliffs and golden grass, arch bridges over the gorges, marine-layer weather, sea birds, light highway traffic.',
    terrainTool: 'python3 tools/build_terrain_grid.py <id>  (real ground and sea floor out to the horizon)',
    keys: ['terrain', 'realHorizon', 'assets', 'extraAssets', 'palette', 'vegetation', 'post'],
    tidy: (s) => { s.biome = 'coast'; s.traffic = { perMinute: 4 }; s.life = { kit: 'coast' }; s.weather = { presets: ['clear', 'marine', 'clouds', 'rain'] }; },
    add: { roadside: [], bridges: [], seaStacks: [], signs: [], lookouts: [] },
  },
  city: {
    from: 'pittsburgh',
    name: 'City',
    description: 'City streets from OpenStreetMap: buildings, facades and street furniture (street kit), junctions, rivers and riverfront, bridges, hero landmarks, people and traffic, baked lighting.',
    terrainTool: 'python3 tools/build_city.py <id>  (city data) and python3 tools/build_terrain_grid.py <id>',
    keys: ['terrain', 'realHorizon', 'assets', 'extraAssets', 'biome', 'palette', 'vegetation', 'weather', 'post', 'roadAlign', 'riverfront', 'packs', 'brickStreets'],
    tidy: (s) => { s.weather = { presets: ['clear', 'marine', 'clouds'], labels: { marine: 'River fog' } }; },
    add: { streetKit: { zones: [] }, mainStreets: [], heroes: [], signs: [] },
  },
  'desert-canyon': {
    from: 'zion',
    name: 'Desert canyon',
    description: 'Authored canyon landforms around the GPX: sandstone formations and walls, a river in the valley floor, desert planting. The oldest kit (Blender regional models); no regional pack yet.',
    terrainTool: 'authored: place "formations" and the "valley" by hand (or bake real terrain with build_terrain_grid.py and use "real-mountain")',
    keys: ['terrain', 'assets', 'extraAssets', 'biome', 'reliefM', 'palette', 'vegetation', 'valley'],
    tidy: (s) => { s.valley = { ...s.valley }; delete s.valley.axis; },
    add: { formations: [], rivers: [], roadside: [], signs: [], lookouts: [] },
  },
};

export function buildPresets() {
  const out = {};
  for (const [id, p] of Object.entries(PRESETS)) {
    const src = scene(p.from);
    const s = { format: 'bikefree-scene-1', style: 'stylized', title: '', region: '', description: p.description, seed: 1101, ...pick(src, p.keys) };
    if (src.kitExtensions && !s.packs) s.packs = src.kitExtensions.map((k) => ({ adirondack: 'northeast', glacier: 'northern-rockies' }[k] || k));
    p.tidy?.(s);
    Object.assign(s, STANDARD, p.add, { preview: { positionM: 0, camera: 'chase' } });
    out[id] = { preset: { id, name: p.name, description: p.description, from: p.from, terrainTool: p.terrainTool }, scene: s };
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes('--check');
  const dir = join(ROOT, 'routes/presets');
  mkdirSync(dir, { recursive: true });
  let stale = 0;
  for (const [id, preset] of Object.entries(buildPresets())) {
    const file = join(dir, `${id}.json`), text = JSON.stringify(preset, null, 2) + '\n';
    if (check) { if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { console.log(`stale: routes/presets/${id}.json`); stale++; } }
    else { writeFileSync(file, text); console.log(`routes/presets/${id}.json  (from ${preset.preset.from})`); }
  }
  if (check) { console.log(stale ? `${stale} presets out of date: node tools/build_presets.mjs` : 'presets up to date'); process.exitCode = stale ? 1 : 0; }
}
