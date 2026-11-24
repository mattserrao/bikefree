// Prepare GPX + small catalog entries for the app. Requires Node and Python 3;
// there are no network requests and no extra packages.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildCatalogRoute } from '../js/routes.js';
import { findStops } from '../js/route-plan.js';
import { parseTerrainGrid } from '../js/terrain-grid.js';
import { gunzipSync } from 'node:zlib';
import { haversine } from '../js/gpx.js';
import { VERSION } from '../js/version.js';
import { normalizeScene } from '../js/world/toolbox/scene-schema.js';
import { packModels } from '../js/world/toolbox/packs/meta.js';
import { cityThumb } from './city_thumbs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readGrid = (path) => (path.endsWith('.json') ? JSON.parse(read(path)) : parseTerrainGrid(gunzipSync(readFileSync(resolve(root, path)))));
const catalog = JSON.parse(read('routes/catalog.json'));
const seen = new Set();
const paths = [];
const output = [];
for (const item of catalog) {
  if (!/^[a-z0-9-]+$/.test(item.id) || seen.has(item.id)) throw new Error(`Invalid or duplicate route ID: ${item.id}`);
  if (typeof item.name !== 'string' || !item.name.trim() || typeof item.park !== 'string' || !item.park.trim()) throw new Error(`${item.id}: name and park/location are required`);
  seen.add(item.id);
  for (const path of [item.file, item.scene].filter(Boolean)) {
    if (!path.startsWith('routes/') || path.includes('..') || !existsSync(resolve(root, path))) throw new Error(`${item.id}: missing or invalid path ${path}`);
  }
  const route = buildCatalogRoute(read(item.file), { ...item, mirror: false });   // validate the route as authored (the app rides it there and back)
  if (route.lat.some((v) => !Number.isFinite(v) || Math.abs(v) > 90) || route.lon.some((v) => !Number.isFinite(v) || Math.abs(v) > 180)) throw new Error(`${item.id}: invalid GPX coordinates`);
  // a one-way route (a Tour stage to a summit finish) stops at B; the app mirrors it into A → B → A
  if (!route.closed && !item.oneWay && !item.network && !item.area) throw new Error(`${item.id}: scenic routes must close; add a returning leg or a closed loop (or set "oneWay": true)`);
  if (item.oneWay && (item.outAndBack || route.closed)) throw new Error(`${item.id}: a oneWay route must not be closed or outAndBack`);
  if (!route.hasElevation) throw new Error(`${item.id}: elevation is required`);
  if (!Array.isArray(item.expectedKm) || item.expectedKm.length !== 2) throw new Error(`${item.id}: expectedKm needs [min, max]`);
  if (route.total / 1000 < item.expectedKm[0] || route.total / 1000 > item.expectedKm[1]) throw new Error(`${item.id}: route length outside expectedKm`);
  if (item.oneWay && Math.max(...route.grade.map(Math.abs)) > 15) throw new Error(`${item.id}: grade exceeds 15%; inspect elevation before publishing`);
  if (item.outAndBack) {
    for (let i = 0; i < route.turnIdx; i += 10) {
      const j = route.lat.length - 1 - i;
      if (haversine({ lat: route.lat[i], lon: route.lon[i] }, { lat: route.lat[j], lon: route.lon[j] }) > 15) throw new Error(`${item.id}: return leg does not retrace the outbound leg`);
    }
    if (Math.max(...route.grade.map(Math.abs)) > 12) throw new Error(`${item.id}: grade exceeds 12%; inspect elevation before publishing`);
  }
  const row = { id: item.id, name: item.name, park: item.park, km: Number((route.total / 1000).toFixed(1)), climbM: Math.round(route.ascent), file: item.file };
  if (item.outAndBack) row.outAndBack = true;
  if (item.oneWay) row.oneWay = true;
  if (item.stage) row.stage = item.stage;   // 'draft': Rough Drafts
  // retired (the old Pittsburgh map): not listed in the app; kept for PGH's build tools (tools/build_pgh.py,
  // pgh_heroes.mjs, pgh_city.py), the QC tools and the kit tests, which ride its areas
  if (item.retired) row.retired = true;
  if (item.area) row.area = item.area;      // one area of a city of areas (PLAN 5.4): not listed; QC, snapshots and the preview open it
  if (item.eleSmoothM != null) {   // [w2-align] the route's elevation smoothing (± m; the app's default is 60)
    if (!(item.eleSmoothM >= 0 && item.eleSmoothM <= 200)) throw new Error(`${item.id}: eleSmoothM must be 0–200 m`);
    row.eleSmoothM = item.eleSmoothM;
  }
  if (item.network) {
    // a ride network over this loop (choose your turns: tools/build_network.mjs, js/network.js)
    if (!item.network.startsWith('routes/') || item.network.includes('..') || !existsSync(resolve(root, item.network))) throw new Error(`${item.id}: missing network ${item.network}`);
    const net = JSON.parse(read(item.network));
    if (net.format === 'bikefree-network-2') {
      // a city of areas (PLAN 5.4): one of them rides this route; each has a catalog entry of its own
      const mine = net.areas?.find((a) => a.base === item.file);
      if (!mine || !net.origin) throw new Error(`${item.id}: the network's areas must include ${item.file}`);
      for (const a of net.areas) if (!catalog.some((c) => c.id === a.catalogId && c.file === a.base)) throw new Error(`${item.id}: no catalog entry ${a.catalogId} riding ${a.base}`);
      if (!(mine.legM > 0 && mine.legM <= route.total && net.edges?.length && net.presets?.length)) throw new Error(`${item.id}: invalid network (rebuild it with tools/build_network.mjs)`);
    } else {
      if (net.format !== 'bikefree-network-1' || net.base !== item.file) throw new Error(`${item.id}: the network must be built on ${item.file}`);
      if (!(net.legM > 0 && net.legM <= route.total && net.edges?.length && net.presets?.length)) throw new Error(`${item.id}: invalid network (rebuild it with tools/build_network.mjs)`);
    }
    row.network = item.network;
    paths.push(item.network);
  }
  // named start points for the route selector: the routing POIs, placed on the way out
  const stops = findStops(route, item.routing?.pois);
  if (stops.length) row.stops = stops;
  if (!item.area) {
    // the menu's card (PLAN 7.11): its numbers and a thumbnail outline, so the list shows without fetching any GPX.
    // The same fields as the route the app builds (js/app.js reads `stats` where it would read the loaded route).
    const ridden = buildCatalogRoute(read(item.file), item);
    row.stats = { total: ridden.total, ascent: ridden.ascent };   // (unrounded: the card rounds them, as it does the route's)
    if (ridden.turnS) row.stats.turnS = ridden.turnS;
    if (ridden.oneWay) row.stats.oneWay = { ascent: ridden.oneWay.ascent };
    if (ridden.stageRoute) row.stats.stageRoute = true;
    const last = ridden.turnIdx ?? ridden.lat.length - 1, step = Math.max(1, Math.ceil(last / 120)), outline = [];
    for (let i = 0; i <= last; i += step) outline.push([+ridden.lat[i].toFixed(5), +ridden.lon[i].toFixed(5)]);
    if ((last % step) !== 0) outline.push([+ridden.lat[last].toFixed(5), +ridden.lon[last].toFixed(5)]);
    row.outline = outline;
  }
  if (item.scene) {
    const scene = normalizeScene(JSON.parse(read(item.scene)));
    if (scene.format !== 'bikefree-scene-1' || !['authored-coast', 'authored-region', 'authored-city', 'real-coast', 'real-mountain', 'wireframe'].includes(scene.terrain)) throw new Error(`${item.id}: unsupported scene format or terrain`);
    // a wireframe placeholder (new routes, before scenery): real terrain drawn as lines, no scenery kit
    const wireframe = scene.terrain === 'wireframe';
    if (wireframe !== (scene.style === 'wireframe')) throw new Error(`${item.id}: a wireframe scene needs both "style" and "terrain": "wireframe"`);
    if (scene.terrain === 'authored-city') {
      // city data from tools/build_city.py: rivers, height grid, buildings, streets, bridges
      if (!scene.cityData?.startsWith('routes/scenes/') || scene.cityData.includes('..') || !existsSync(resolve(root, scene.cityData))) throw new Error(`${item.id}: missing city data`);
      const city = JSON.parse(read(scene.cityData));
      if (city.format !== 'bikefree-city-1' || !(city.buildings?.count > 0) || !(city.grid?.nx > 1)) throw new Error(`${item.id}: invalid city data`);
      for (const r of scene.rivers || []) if (!Array.isArray(r.path) || r.path.length < 2) throw new Error(`${item.id}: invalid river path`);
      paths.push(scene.cityData);
    }
    if (scene.terrain === 'real-coast' || scene.terrainGridFile) {
      // a real height grid around the route from tools/build_terrain_grid.py
      if (!scene.terrainGridFile?.startsWith('routes/scenes/') || scene.terrainGridFile.includes('..') || !existsSync(resolve(root, scene.terrainGridFile))) throw new Error(`${item.id}: missing terrain grid`);
      const grid = readGrid(scene.terrainGridFile);
      if (grid.format !== 'bikefree-terrain-grid-1' || !(grid.coarse?.nx > 1) || !(grid.fine?.blocks?.length > 0)) throw new Error(`${item.id}: invalid terrain grid`);
      for (const b of scene.bridges || []) if (!(b.fromM >= 0 && b.toM > b.fromM && b.toM <= (route.turnS || route.total))) throw new Error(`${item.id}: invalid bridge span`);
      paths.push(scene.terrainGridFile);
    }
    if (scene.placesFile) {
      // real places from OpenStreetMap (tools/build_places.py)
      if (!scene.placesFile.startsWith('routes/scenes/') || scene.placesFile.includes('..') || !existsSync(resolve(root, scene.placesFile))) throw new Error(`${item.id}: missing places file`);
      const places = readGrid(scene.placesFile);
      if (places.format !== 'bikefree-places-1' || !(places.landcover?.nx > 1)) throw new Error(`${item.id}: invalid places file`);
      paths.push(scene.placesFile);
    }
    if (scene.terrain === 'authored-coast' && (!Array.isArray(scene.coastline) || scene.coastline.length < 2)) throw new Error(`${item.id}: a coastline needs at least two coordinates`);
    for (const [lat, lon] of scene.coastline || []) if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) throw new Error(`${item.id}: invalid coastline coordinate`);
    if (!wireframe && (!scene.assets?.startsWith('models/scenery/') || scene.assets.includes('..') || !existsSync(resolve(root, scene.assets)))) throw new Error(`${item.id}: missing scenery asset kit`);
    const kit = wireframe ? { format: 'bikefree-scenery-1', assets: {} } : JSON.parse(read(scene.assets));
    if (kit.format !== 'bikefree-scenery-1') throw new Error(`${item.id}: invalid scenery asset kit`);
    for (const extra of scene.extraAssets || []) {
      if (!extra.startsWith('models/scenery/') || extra.includes('..')) throw new Error(`${item.id}: invalid extra scenery path`);
      const extension = JSON.parse(read(extra));
      if (extension.format !== 'bikefree-scenery-1') throw new Error(`${item.id}: invalid extra scenery kit`);
      Object.assign(kit.assets, extension.assets); paths.push(extra);
    }
    const validCoordinate = (p) => Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
    const validRadius = (p) => Array.isArray(p.radiusM) && p.radiusM.length === 2 && p.radiusM.every((r) => Number.isFinite(r) && r > 0);
    for (const lake of scene.lakes || []) if (!validCoordinate(lake) || !Number.isFinite(lake.elevationM) || !validRadius(lake)) throw new Error(`${item.id}: invalid lake placement or dimensions`);
    for (const form of [...(scene.formations || []), ...(scene.islands || [])]) if (!validCoordinate(form) || !validRadius(form) || !(form.heightM > 0)) throw new Error(`${item.id}: invalid landform placement or dimensions`);
    for (const river of scene.terrain === 'authored-city' ? [] : scene.rivers || []) if (!(river.widthM > 0) || !Array.isArray(river.path) || river.path.length < 2 || river.path.some(([lat, lon]) => !validCoordinate({ lat, lon }))) throw new Error(`${item.id}: invalid river path or width`);
    // models from the procedural regional packs (js/world/toolbox/packs) are built at load, not bundled
    const procedural = new Set((scene.packs || []).flatMap(packModels));
    for (const name of [...(scene.vegetation?.trees || []), ...(scene.vegetation?.shrubs || []), ...(scene.vegetation?.cover || [])]) if (!kit.assets[name] && !procedural.has(name)) throw new Error(`${item.id}: missing vegetation model ${name}`);
    for (const range of scene.bridgeRanges || []) if (!(range.fromM >= 0 && range.toM > range.fromM && range.toM <= (route.turnS || route.total))) throw new Error(`${item.id}: invalid bridge range`);
    for (const landmark of scene.landmarks || []) {
      if (!kit.assets[landmark.asset]) throw new Error(`${item.id}: missing landmark model ${landmark.asset}`);
      if (!(landmark.span > 0) || !Number.isFinite(landmark.lat) || !Number.isFinite(landmark.lon)) throw new Error(`${item.id}: invalid landmark placement`);
      if (landmark.creekWidthM !== undefined && !(landmark.creekWidthM > 0)) throw new Error(`${item.id}: creekWidthM must be positive`);
      let distance = Infinity;
      for (let i = 0; i < route.lat.length; i += 5) distance = Math.min(distance, haversine(landmark, { lat: route.lat[i], lon: route.lon[i] }));
      if (distance > 120) throw new Error(`${item.id}: landmark is ${Math.round(distance)} m from the road`);
    }
    for (const feature of [...(scene.signs || []), ...(scene.lookouts || []), ...(scene.seaStacks || [])]) {
      if (!Number.isFinite(feature.atM) || feature.atM < 0 || feature.atM > (route.turnS || route.total)) throw new Error(`${item.id}: scenery feature must be placed on the outbound route`);
      for (const key of ['widthM', 'heightM', 'lengthM', 'offshoreM']) {
        if (feature[key] !== undefined && !(feature[key] > 0)) throw new Error(`${item.id}: ${key} must be positive`);
      }
    }
    if (scene.terrainData) {
      const t = scene.terrainData;
      if (t.format !== 'bikefree-terrain-1' || !t.file?.startsWith('routes/scenes/') || t.file.includes('..') || !existsSync(resolve(root, t.file))) throw new Error(`${item.id}: missing or invalid terrain data`);
      if (readFileSync(resolve(root, t.file)).length !== t.width * t.height * 5) throw new Error(`${item.id}: terrain data size does not match its grid`);
      paths.push(t.file);
    }
    paths.push(...[item.scene, scene.assets].filter(Boolean));
    row.scene = item.scene;
    if (wireframe) row.wireframe = true;
  }
  paths.push(item.file);
  output.push(row);
}

// The runtime parser is deliberately tolerant; a real XML parser catches broken
// metadata escaping that would otherwise slip through the route geometry tests.
const xml = spawnSync('python3', ['-c', 'import sys, xml.etree.ElementTree as E; [E.parse(p) for p in sys.argv[1:]]',
  ...catalog.map((p) => resolve(root, p.file)), resolve(root, 'routes/demo-hills.gpx')], { encoding: 'utf8' });
if (xml.status !== 0) throw new Error(`GPX XML validation failed:\n${xml.stderr || xml.error}`);

// The road-graph cities (PGH, CNY, SKAN: routes/cities/graph-cities.json, one card each) and their card thumbnails
// (js/city-thumbs.js): the menu draws the cards from routes/cities/index.json without the graphs themselves
const graphCities = JSON.parse(read('routes/cities/graph-cities.json')).map((c) => {
  if (!/^[a-z0-9]+$/.test(c.id) || !c.name || !c.park) throw new Error(`graph city ${c.id}: id, name and park are required`);
  const file = `routes/cities/${c.id}.json`;
  if (!existsSync(resolve(root, file))) throw new Error(`graph city ${c.id}: missing ${file}`);
  const json = JSON.parse(read(file));
  const map = json.map && existsSync(resolve(root, json.map)) ? JSON.parse(read(json.map)) : null;
  return { ...c, thumb: cityThumb(json, map, c.name) };
});
const cityIndex = JSON.stringify({ format: 'bikefree-graph-cities-1', note: 'Generated by npm run routes:build from graph-cities.json. Do not edit.', cities: graphCities }) + '\n';

// (the outlines one line each: the catalog stays readable)
const index = JSON.stringify(output, (k, v) => (k === 'outline' ? `@@${JSON.stringify(v)}@@` : v), 2).replace(/"@@(.*?)@@"/g, (m, s) => JSON.parse(`"${s}"`)) + '\n';
const walk = (dir) => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((p) => p.isDirectory() ? walk(`${dir}/${p.name}`) : [`${dir}/${p.name}`]);
const files = [...new Set(['./', 'index.html', 'css/style.css', 'sw-assets.js',
  ...walk('js').filter((p) => p.endsWith('.js')), 'vendor/three.module.min.js', 'models/rider.json', 'models/rider-atlas.png', 'models/pacer-atlas.png', 'textures/surface-detail.png',
  'routes/demo-hills.gpx', 'routes/scenes/demo-hills.json', 'routes/parks/index.json', 'routes/cities/index.json', 'routes/ideas.json', 'tools/world-preview.html',
  // route pictures (PLAN 6.8): the manifest is precached; the pictures themselves are cached on first view (sw.js)
  ...(existsSync(resolve(root, 'routes/previews/index.json')) ? ['routes/previews/index.json'] : []), ...paths,
  // built-in city graphs (PGH) aren't catalog entries: hash their data too, so a data-only change makes a new cache
  ...(existsSync(resolve(root, 'routes/cities')) ? walk('routes/cities') : [])])].sort();
const hash = createHash('sha256');
for (const file of files.filter((p) => !['./', 'sw-assets.js'].includes(p))) hash.update(file).update(file === 'routes/parks/index.json' ? index : file === 'routes/cities/index.json' ? cityIndex : readFileSync(resolve(root, file)));
// [F391] precache only the app (code, styles, the catalog and manifests, the demo route: ~3 MB). The route data (GPX,
// scenes, terrain, city files) and the rider models (~44 MB) are cached the first time a ride uses them, in the same
// revision's cache (sw.js, cache-first): a new build no longer downloads every route in the background on its first
// visit. The revision still hashes every file, so any change to the data makes a new cache.
const DATA = /^(routes\/(scenes|parks|cities|presets)\/|models\/)/;
const KEEP = new Set(['routes/parks/index.json', 'routes/scenes/demo-hills.json', 'routes/cities/index.json', 'routes/cities/graph-cities.json']);
const precache = files.filter((p) => !DATA.test(p) || KEEP.has(p));
// Route data and models are cached by content (sw.js DATA_CACHE): each file's own hash, so a deploy keeps every file
// that didn't change (the app's revision changes with any file and used to drop them all)
const dataFiles = [...new Set([...files, ...walk('models').filter((p) => /\.(json|png|webp|bin|gz)$/.test(p))])].filter((p) => DATA.test(p) && !KEEP.has(p)).sort();
const dataHashes = Object.fromEntries(dataFiles.map((p) => [p, createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex').slice(0, 10)]));
const manifest = `// Generated by npm run routes:build. Do not edit.\nself.BIKEFREE_APP_REVISION = '${VERSION}-${hash.digest('hex').slice(0, 12)}';\nself.BIKEFREE_APP_FILES = ${JSON.stringify(precache, null, 2)};\n` +
  `// route data and models: path → content hash (fetched and cached the first time a ride uses them)\nself.BIKEFREE_DATA_FILES = ${JSON.stringify(dataHashes, null, 1)};\n`;
for (const [path, contents] of [['routes/parks/index.json', index], ['routes/cities/index.json', cityIndex], ['sw-assets.js', manifest]]) {
  if (check) {
    if (!existsSync(resolve(root, path)) || read(path) !== contents) throw new Error(`${path} is stale; run npm run routes:build`);
  } else writeFileSync(resolve(root, path), contents);
}
console.log(`${check ? 'Checked' : 'Prepared'} ${output.length} routes · strict GPX XML · ${precache.length} precached files (of ${files.length}) · v${VERSION}`);
