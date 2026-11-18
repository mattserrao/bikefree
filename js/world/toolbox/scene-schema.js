// Scene schema: every field a "bikefree-scene-1" scene JSON may use, which toolbox part reads it, and the
// field names inside each block. Plain data (no three.js) so the build, the scene linter (tools/lint_scene.mjs,
// part of npm test), the new-route scaffold and the docs share it.
//
// normalizeScene() maps old field names onto the toolbox's names, so older scenes keep working:
//   kitExtensions ["adirondack" | "glacier"]  →  packs ["northeast" | "northern-rockies"]
//   glacier { tunnels, guardwalls, … }        →  mountainRoad { … }
import { packId } from './packs/meta.js';

const T = 'js/world/toolbox/';

// type: string | number | boolean | object | array | any; keys: known fields inside an object block (or in each
// array item); tool: the module that reads it; required: every stylized scene needs it
export const SCENE_FIELDS = {
  // identity
  format: { type: 'string', required: true, doc: 'always "bikefree-scene-1"' },
  style: { type: 'string', required: true, doc: '"stylized" (scenery) or "wireframe" (road + wire terrain, no scenery)' },
  title: { type: 'string', doc: 'scene title' },
  region: { type: 'string', doc: 'region name shown in the app' },
  description: { type: 'string', doc: 'one line about the look' },
  note: { type: 'string', doc: 'free note for builders' },
  seed: { type: 'number', doc: 'random seed for every scatter' },
  biome: { type: 'string', doc: 'forest | alpine | coast | desert | tropical | city (informational; presets are by biome)' },
  preview: { type: 'object', keys: ['positionM', 'camera', 'time'], doc: 'where the route picker preview looks' },

  // landform
  terrain: { type: 'string', required: true, tool: T + 'landscape/index.js', doc: 'authored-coast (default) | authored-region | real-coast | real-mountain | authored-city | wireframe' },
  terrainData: { type: 'object', tool: T + 'landscape/authored-region.js', keys: ['file', 'format', 'north', 'south', 'west', 'east', 'width', 'height', 'baseM', 'sdfMaxM', 'lakes'], doc: 'baked USGS grid + lakes (tools/build_scene_terrain.py)' },
  terrainGridFile: { type: 'string', tool: T + 'landscape/real-terrain.js', doc: 'real height grid (tools/build_terrain_grid.py)' },
  terrainBuild: { type: 'object', keys: ['padM', 'coarseM', 'fineM', 'fineCellM', 'lakes', 'minLakeHa', 'lakeNames', 'gpx', 'rivers', 'osmWater', 'osmCorridorM', 'box', 'lat0'], doc: 'settings for the terrain bake tools (a city\'s areas share one "box" and "lat0": PLAN 5.4)' },
  buildingStyles: { type: 'array', tool: T + 'structures/footprints.js', keys: ['fromM', 'toM', 'walls', 'roofs', 'trim', 'stone', 'pitch', 'eaveM', 'blockAreaM2', 'balconies'], doc: 'map-footprint buildings: wall, roof and shutter colours, stone plinths and roof pitch by stretch' },
  buildings: { type: 'object', tool: T + 'structures/footprints.js', keys: ['reachM', 'chunkM', 'landmarks'], doc: 'map-footprint buildings: draw reach, stretch size, landmark shapes by name ("tent")' },
  buildingKit: { type: 'object', tool: T + 'structures/buildings/kit.js', keys: ['detailM', 'dressingM', 'chunkM', 'reachM', 'detailReachM', 'detailBudgetMs', 'cityFacades', 'styles'], doc: 'map-footprint buildings drawn by the building kit (cities: homes, and textured facades for the rest): archetypes, textured walls and roofs, windows, wings, balconies, dormers, chimneys, lean-tos and ground dressing, by regional style per stretch (presets.js)' },
  cables: { type: 'object', tool: T + 'structures/cables.js', keys: ['lifts', 'power', 'reachM'], doc: 'ski lifts and power lines from the map (places file): pylons, stations, chairs, poles, wires' },
  dams: { type: 'object', tool: T + 'structures/dam.js', keys: ['crestM'], doc: 'dams from the map (places file): concrete walls along the mapped crest; crestM by name' },
  boards: { type: 'array', tool: T + 'roadside/boards.js', keys: ['atM', 'kind', 'side', 'lateralM', 'number', 'alt', 'title', 'lines', 'auto'], doc: 'roadside boards in one atlas: bend (numbered hairpins), town / townEnd, col, info (tools/place_boards.py writes towns and cols)' },
  placesFile: { type: 'string', tool: T + 'landscape/real-terrain.js', doc: 'real places from OpenStreetMap: land cover, buildings, lifts, power (tools/build_places.py)' },
  places: { type: 'object', keys: ['buildingsM', 'liftsM', 'powerM', 'landcoverCellM'], doc: 'settings for tools/build_places.py' },
  osm: { type: 'object', keys: ['corridorM', 'tileDeg'], doc: 'OpenStreetMap corridor for the real-place tools (tools/fetch_osm_corridor.py)' },
  realHorizon: { type: 'boolean', doc: 'false: the stylized ground reaches the horizon (no streamed real terrain)' },
  reliefM: { type: 'number', doc: 'authored relief height' },
  baseElevationM: { type: 'number', doc: 'authored base elevation' },
  coastline: { type: 'array', tool: T + 'landscape/authored-coast.js', doc: 'authored coast or a regional scene by the sea: [[lat, lon], …]' },
  oceanSide: { type: 'string', doc: 'authored coast: which side the sea is' },
  lakes: { type: 'array', keys: ['name', 'lat', 'lon', 'radiusM', 'elevationM'], doc: 'authored lakes' },
  rivers: { type: 'array', keys: ['name', 'widthM', 'path', 'depthM'], doc: 'authored rivers (city scenes: river names)' },
  formations: { type: 'array', keys: ['name', 'lat', 'lon', 'radiusM', 'heightM', 'shape', 'island', 'color'], doc: 'authored buttes, domes, peaks' },
  islands: { type: 'array', keys: ['name', 'lat', 'lon', 'radiusM', 'heightM'], doc: 'authored islands' },
  valley: { type: 'object', keys: ['axis', 'widthM', 'heightM'], doc: 'authored canyon/valley' },
  snowLineM: { type: 'number', doc: 'snow above this elevation' },
  treelineM: { type: 'number', doc: 'trees thin out to krummholz here' },
  divide: { type: 'any', doc: 'real-mountain: the continental divide (wet west / dry east planting)' },
  glaciers: { type: 'array', tool: T + 'landscape/real-terrain.js', keys: ['name', 'lat', 'lon', 'radiusM', 'aspect', 'dropM'], doc: 'ice fields on the real terrain' },
  burns: { type: 'array', tool: T + 'landscape/real-terrain.js', keys: ['name', 'lat', 'lon', 'lengthM', 'widthM', 'angle'], doc: 'fire scars (snags, fireweed, burned ground)' },
  streams: { type: 'array', keys: ['name', 'fromM', 'toM', 'widthM', 'minRoadM', 'searchM'], doc: 'creeks traced down the real valleys' },
  lakeIslands: { type: 'array', keys: ['name', 'lat', 'lon', 'lengthM', 'widthM', 'heightM', 'angle', 'trees'], doc: 'islands in real lakes' },
  sites: { type: 'array', keys: ['name', 'lat', 'lon', 'widthM', 'lengthM', 'angle', 'atRoad'], doc: 'flat built pads (lodges, car parks, visitor centres): cleared of trees' },

  // look
  palette: { type: 'object', required: true, tool: T + 'materials/surfaces.js', keys: ['grass', 'meadow', 'rock', 'cliff', 'water', 'shallowWater', 'sand', 'forest', 'forestFloor', 'canopy', 'snow', 'ice', 'scree', 'cutRock', 'burn', 'fireweed', 'shrub', 'bluff', 'argillite', 'farTint', 'farTintAmount', 'hay', 'farmland', 'village'], doc: '6–10 muted colours (hay, farmland, village: mapped land cover)' },
  look: { type: 'string', tool: T + 'atmosphere/look.js', doc: 'cartoon look: "gentle" (the standard) | "bold"' },
  timeOfDay: { type: 'string', doc: 'default time: midday | morning | afternoon | golden | night' },
  lighting: { type: 'object', tool: T + 'atmosphere/baked-light.js', keys: ['baked', 'sun', 'cellM', 'marginM', 'reachM', 'maxTexels', 'windowM', 'windowMoveM'], doc: 'fixed sun with baked shadows/AO: { "baked": "midday" }' },
  post: { type: 'any', tool: T + 'atmosphere/post.js', doc: 'hero post chain: bloom, grade, vignette' },
  atmosphere: { type: 'object', keys: ['fogNearM', 'fogFarM', 'fogFarRealM', 'lakeMist'], doc: 'fog distances and lake mist' },
  vista: { type: 'object', tool: T + 'atmosphere/vista.js', keys: ['rock', 'snow', 'meadow', 'forest', 'haze', 'ridgeInk', 'clouds'], doc: 'distance detail, aerial haze, ridge ink, cartoon cumulus' },
  weather: { type: 'object', tool: T + 'atmosphere/weather.js', keys: ['presets', 'labels', 'bankTop', 'bank'], doc: 'weather presets offered: clear | marine | clouds | rain | smoke' },
  season: { type: 'string', doc: 'summer | fall' },
  wire: { type: 'object', keys: ['background', 'ground', 'line', 'contourM', 'majorContourM', 'gridM'], doc: 'wireframe colours and line spacing' },

  // scenery models
  assets: { type: 'string', tool: T + 'packs/blender-kits.js', doc: 'Blender kit: models/scenery/regional.json or coastal.json' },
  extraAssets: { type: 'array', tool: T + 'packs/blender-kits.js', doc: 'more Blender kits merged in' },
  packs: { type: 'array', tool: T + 'packs/index.js', doc: 'procedural regional packs: northeast | northern-rockies' },
  vegetation: { type: 'object', tool: T + 'vegetation/forest.js', keys: ['layout', 'species', 'trees', 'shrubs', 'cover', 'edge', 'canopyM', 'treeScale', 'coverScale', 'density', 'treeDensity', 'forestDensity', 'vergeDensity', 'treelineM', 'rich', 'coverBoost', 'tierKeep', 'windows', 'yardTrees', 'zones'], doc: 'planting: layout "forest-edge" for continuous forest; "zones": species by elevation band and aspect from a pack (data-driven mountain planting)' },
  water: { type: 'object', tool: T + 'materials/surfaces.js', keys: ['style', 'lakeReachM', 'nearRouteM'], doc: '"lake" style: ripples and treeline reflection, no surf' },

  // road and roadside
  road: { type: 'object', tool: T + 'materials/road-surface.js', keys: ['surface', 'zones', 'markings', 'trail'], doc: 'road surface by stretch: fresh, worn, patched, chip seal, frost-heaved …; markings "eu": white dashed centre and edges; "fr": French rules in metres (T1 centre, T2 edges, solid on blind bends, villages); trail: { surface, zones } for a city route\'s trail stretches' },
  brickStreets: { type: 'object', tool: T + 'city/city.js', keys: ['osm', 'minGrade', 'classes', 'minLengthM'], doc: 'city: brick-paved streets — the ones OSM tags brick, sett or paving stones, and steep residential streets (minGrade)' },
  roadAlign: { type: 'object', keys: ['curve', 'streets', 'bankM'], doc: 'city: smooth the route and street profiles' },
  roadside: { type: 'array', tool: T + 'roadside/guardrail.js', keys: ['fromM', 'toM', 'side'], doc: 'post-and-rail guardrail stretches' },
  verge: { type: 'object', tool: T + 'roadside/verge.js', keys: ['markers', 'poles', 'posts', 'debris', 'reachM'], doc: 'mile markers, snow poles, delineators, rockfall' },
  signs: { type: 'array', tool: T + 'roadside/details.js', keys: ['atM', 'side', 'label', 'subtitle', 'direction', 'lateralM', 'kind', 'symbol'], doc: 'guide, warning, DEC and diamond signs' },
  lookouts: { type: 'array', tool: T + 'roadside/details.js', keys: ['atM', 'side', 'widthM', 'lengthM'], doc: 'turnouts / overlooks beside the road' },
  seaStacks: { type: 'array', keys: ['atM', 'offshoreM', 'widthM', 'heightM'], doc: 'coast: rocks offshore' },
  poles: { type: 'object', tool: T + 'structures/settlement.js', keys: ['side', 'spacingM', 'lateralM'], doc: 'utility poles with wires' },

  // structures
  towns: { type: 'array', tool: T + 'structures/settlement.js', keys: ['name', 'fromM', 'toM', 'setbackM', 'spacingM', 'skip'], doc: 'villages facing the road (forest-edge layout)' },
  camps: { type: 'any', tool: T + 'structures/settlement.js', doc: 'lakeside camps, docks and boats' },
  bridges: { type: 'array', tool: T + 'structures/arch-bridges.js', keys: ['fromM', 'toM', 'name', 'creek', 'arch', 'style', 'side'], doc: 'bridges by distance; arch: open-spandrel concrete arch' },
  bridgeRanges: { type: 'array', keys: ['name', 'fromM', 'toM', 'depthM', 'lateralM'], doc: 'authored bridge decks' },
  bridgeColors: { type: 'object', keys: ['structure', 'rail'], doc: 'bridge colours (masonry for stone)' },
  mountainRoad: { type: 'object', tool: T + 'structures/mountain-road.js', keys: ['culverts', 'guardwalls', 'tunnels', 'waterfalls', 'buildings', 'parking', 'snowbanks'], doc: 'mountain road structures: masonry guardwalls, tunnels with galleries, arches, waterfalls, culverts, lodges, snowbanks' },

  // life
  traffic: { type: 'object', tool: T + 'life/traffic.js', keys: ['perMinute', 'mix'], doc: 'two-lane traffic; 4/min is light' },
  life: { type: 'object', tool: T + 'life/', keys: ['kit', 'lighthouses', 'cattle', 'moments', 'goats', 'bighorn', 'marmots', 'squirrels', 'bears', 'ducks', 'ravens', 'eagles', 'cows', 'sheep', 'name'], doc: 'wildlife (mountains) or coast life (birds, cattle, lighthouse); "kit" picks one explicitly' },
  reflectorPosts: { type: 'boolean', tool: T + 'roadside/details.js', doc: 'false: no white reflector posts every 90 m (the verge kit has the road\'s own delineators)' },
  switchbacks: { type: 'boolean', tool: T + 'landscape/real-terrain.js', doc: 'real terrain: one bank between close legs of a switchback, the inside of tight turns at the lower level (Alpe d\'Huez)' },
  hairpinWalls: { type: 'object', tool: T + 'structures/hairpin-walls.js', keys: ['minDropM', 'parapetM', 'color'], doc: 'dry-stone retaining walls under the upper leg of close switchbacks' },
  groundMesh: { type: 'object', tool: 'js/world/stylized-terrain.js', keys: ['fineCells'], doc: 'cells across the finest 96 m ground patch (16 = 6 m; 32 = 3 m for hairpin roads)' },
  raceDay: { type: 'object', tool: T + 'life/race-day.js', keys: ['crowd', 'camps', 'barriers', 'kom', 'kmToGo', 'flammeRouge', 'finishM', 'helicopter', 'noCrowd', 'paint', 'paintWords', 'peopleReachM', 'cardReachM', 'campReachM'], doc: 'race day: crowds, flags, camper vans, barriers, banners, finish gantry, TV helicopter (no traffic)' },
  visitors: { type: 'object', tool: T + 'life/visitors.js', keys: ['spots', 'lookouts', 'walking', 'kids', 'dogs', 'strollers'], doc: 'people at overlooks and sites' },

  // city kit (authored-city)
  cityData: { type: 'string', tool: T + 'city/city.js', doc: 'city data (tools/build_city.py)' },
  origin: { type: 'object', keys: ['lat', 'lon'], doc: 'a city of areas (PLAN 5.4): the city\'s shared frame — every area is projected around this point (js/world/world.js)' },
  streetKit: { type: 'object', tool: T + 'city/street-kit.js', keys: ['fromM', 'toM', 'rangeM', 'parkTrees', 'zones'], doc: 'facades, furniture, street trees' },
  mainStreets: { type: 'array', keys: ['name', 'fromM', 'toM'], doc: 'city main streets' },
  junctions: { type: 'any', tool: T + 'city/junctions.js', doc: 'junction planning' },
  riverfront: { type: 'object', tool: T + 'city/riverfront.js', keys: ['maxGapM', 'spans', 'waterSteps'], doc: 'river walls, steps, trails' },
  riverFlow: { type: 'object', doc: 'river flow directions' },
  qcAccept: { type: 'array', doc: 'course QC warnings reviewed and accepted: [{check, fromM, toM, why}] (reported as info)' },
  routeTrees: { type: 'array', keys: ['fromM', 'toM', 'spacingM', 'offsetM', 'sides'], doc: 'street trees along the route' },
  bridgeFrames: { type: 'object', tool: T + 'city/bridges.js', doc: 'city bridge frames by name' },
  heroes: { type: 'array', tool: T + 'city/heroes.js', keys: ['model', 'name', 'lat', 'lon', 'heightM', 'bodyM', 'radiusM', 'rebuilt', 'traced', 'turnDeg'], doc: 'landmark buildings' },
  hotspots: { type: 'array', keys: ['name', 'lat', 'lon', 'radiusM'], doc: 'busy places (more people)' },
  overlooks: { type: 'object', keys: ['fromM', 'toM', 'count', 'spacingM', 'toward', 'look'], doc: 'city overlooks' },
  views: { type: 'array', keys: ['name', 'atM', 'rangeM', 'cam', 'look'], doc: 'named views' },
  stadiumShapes: { type: 'object', tool: T + 'city/bridges.js', doc: 'stadium footprints' },
  fountain: { type: 'object', keys: ['lat', 'lon', 'radiusM'], doc: 'fountain' },
};

// old names → toolbox names
export const FIELD_ALIASES = { kitExtensions: 'packs', glacier: 'mountainRoad' };

/** Map old field names onto the toolbox's names (in place; returns the scene). */
export function normalizeScene(scene) {
  if (!scene || typeof scene !== 'object') return scene;
  if (scene.kitExtensions && !scene.packs) scene.packs = scene.kitExtensions.map((n) => packId(n) || n);
  if (scene.packs) scene.packs = scene.packs.map((n) => packId(n) || n);
  if (scene.glacier && !scene.mountainRoad) scene.mountainRoad = scene.glacier;
  delete scene.kitExtensions; delete scene.glacier;
  return scene;
}

/** Which life kit a scene uses: life.kit, else wildlife on real mountains and coast life on a real coast. */
export function lifeKit(scene, landscape) {
  if (!scene.life) return null;
  return scene.life.kit || (landscape.mountain ? 'wildlife' : landscape.real ? 'coast' : null);
}
