# Alpe d'Huez hero plan — Tour de France 2026 Stage 19 on race day

Branch `alpedhuez-hero-test`, from `main` after the toolbox (PR #29). Written 16 Nov 2026, before any building.

## Decisions

| | Choice |
| --- | --- |
| Detail | **Hero everywhere**: Going-to-the-Sun level along all 127 km, not just the final climb |
| Day | **Race day, always**: 24 July 2026. Crowds, road paint, barriers, camper vans and banners. Roads closed, so no traffic |
| Places | **Real places, drawn stylized**: villages, churches, the Sautet dam, the tunnel and the resort placed from OpenStreetMap, then built in the cartoon style. Hairpin signs 21 → 1 at their real bends |
| Who builds it | **Claude alone, in phases**, with snapshots after each phase |
| Toolbox standard | Gentle look, baked midday light, chase camera, vista kit, a regional pack, under 600 draw calls and 2M triangles (Balanced, M4 Air) |
| Rule | Code is never written for this route alone. Every new feature is a toolbox kit behind a scene field, so Mont Ventoux and the Stelvio can use it next |

**Open, with defaults:**
- **Bake time:** midday is the standard. The real race reached the Alpe at about 17:30. The default is midday, with afternoon as an option at P5.
- **Triangle budget:** 2.5M on the Alpe with crowds, as Going-to-the-Sun got. Draw calls stay under 600.

---

## What the toolbox already gives this route

| Need | Toolbox part | Status |
| --- | --- | --- |
| Real ground, road pressed in, gorges bridged, creeks | `landscape/real-terrain.js` (`real-mountain`) | ✓ Needs the bake fix below |
| Forest by elevation zone, view windows, nested tiers | `vegetation/forest.js` | ⚠ The mountain zones are hard-coded to Glacier species |
| Cliffs, scree, snow in gullies, haze, ridge ink, clouds | `atmosphere/vista.js`, `haze.js` | ✓ Needs a new palette |
| Fixed sun, baked shadows and AO | `atmosphere/baked-light.js` | ⚠ Not yet tried on a 127 km route |
| Guardwalls, tunnels, culverts, arch bridges | `structures/mountain-road.js`, `arch-bridges.js` | ✓ |
| Road surface by stretch, verge markers, snow poles | `materials/road-surface.js`, `roadside/verge.js` | ⚠ No French km markers or road paint yet |
| People standing at sites | `life/visitors.js` | ⚠ Too small for race-day crowds |
| Wildlife | `life/wildlife.js` | ⚠ North American animals |
| Villages | `structures/settlement.js` | ⚠ New England style, placed from shorelines, not footprints |

**Missing:** an `alps` pack, buildings from map footprints, OSM land cover, a race-day kit, ski-resort pieces, a dam and numbered bend signs.

---

## The route, stretch by stretch

Kilometres are the route's own, from the official itinerary. The table also gives what each stretch must feel like.

| # | Stretch | km | Road | Landform and cover | Built | Race day |
| --- | --- | --- | --- | --- | --- | --- |
| A | **Gap → Col Bayard** | 0 – 4.8 | N85, wide | Dry south-facing slopes, Scots pine and oak scrub, Provençal light | Gap's northern edge, villas, the Bayard Nordic centre and golf course at the col | Start-town crowds thinning out; KOM banner at the col (1,246 m) |
| B | **Champsaur** | 4.8 – 19 | N85 down, then D17 / D817 | Open farmland valley: hay meadows, hedgerows, ash and walnut | Laye, Brutinel, Poligny, Le Marthouret, Le Villard: stone farmhouses with large barns | Farmers' fields with parked cars; families in villages |
| C | **Col du Noyer** | 19 – 25.2 | D17, narrow, 8.4% | Larch woods giving way to high pasture under the Dévoluy's limestone walls | Le Noyer village, the col's chalet bar | Thick crowds on the last 2 km; camper vans on the pasture; KOM banner at 1,664 m |
| D | **Dévoluy** | 25.2 – 37 | D17 → D117 | A stark, bright limestone bowl: scree fans, black pine, dry pasture | Saint-Étienne-en-Dévoluy, Superdévoluy's big resort blocks on the slope, Giers | Groups at Saint-Étienne |
| E | **Souloise gorge** | 37 – 46 | D937 | Narrow limestone gorge, river below, cliffs over the road | Saint-Disdier, **Tunnel de la Beaume**, Pellafol, La Posterle | Sparse; marshals at the tunnel |
| F | **Lac du Sautet and Corps** | 46 – 60 | D537 → N85 (Route Napoléon) | Turquoise reservoir in a deep gorge; Obiou's peak above | **Barrage du Sautet** (arch dam) and the bridge; Corps, a small town on the lake | Corps busy; spectators along the dam |
| G | **Beaumont plateau** | 60 – 76 | N85 → D212B → D26A | Rolling high farmland, orchards, long views to the Écrins | Les Côtes-de-Corps, Quet, La Salle-en-Beaumont (church on the slope), Saint-Laurent-en-Beaumont | Village crowds; hay-bale sculptures in fields |
| H | **Valbonnais / Bonne valley** | 76 – 89 | D526 | Narrowing green valley, the Bonne river, spruce on the shady side | Valbonnais (with its lake), Entraigues, Le Périer | Light |
| I | **Col d'Ornon** | 89 – 99.2 | D526, steady 6% | Spruce and larch forest, then an open grassy col | Chantelouve, Les Siauds, the col at 1,371 m | Crowds at the col; KOM banner |
| J | **Ornon descent and the Oisans** | 99.2 – 111.6 | D526 → D1091 | Lignarre gorge: rock and avalanche nets; then the flat Romanche valley floor | Le Rivier, La Pallud, La Paute, **Le Bourg-d'Oisans** (town, river walls) | Bourg packed; barriers start at the base of the climb |
| K | **The 21 hairpins** | 111.6 – 125.2 | D211 | 13.8 km at 8.1%: walnut and ash low down, larch and pasture up high; Grandes Rousses glaciers above, Écrins across the valley | Bend signs 21 → 1; La Garde (bend 16), Ribot, **Huez and its church at bend 7 (Dutch Corner)** | A wall of people the whole way; the orange crowd at Dutch Corner; painted road; camper vans on every flat spot |
| L | **Alpe d'Huez resort and the finish** | 125.2 – 127.0 | Resort streets to Avenue du Rif Nel | Ski slopes and lift lines, bare pasture | Apartment blocks, hotels, the tent-shaped church Notre-Dame des Neiges, lifts | Barriers both sides, flamme rouge, the last 220 m to the finish arch, podium and team buses beyond the line |

**First OSM census.** It counts buildings within 250 m of the road, place names within 1.2 km, and ski lifts within 2.5 km. "–" means the query timed out; P0 fills the gaps.

| km | Buildings | Places (sample) | Churches | Lifts |
| --- | --- | --- | --- | --- |
| 0–10 | – | Brutinel, Laye, Le Cros, Villard de Laye, Les Gondoins, Laye ski station | 3 | 8 |
| 10–20 | – | Poligny, La Fare-en-Champsaur, Les Forestons, Le Noyer | 2 | 6 |
| 20–30 | 64 | Le Noyer, Le Pré, Truziaud, Les Cypières | 0 | 6 |
| 30–40 | 588 | Saint-Étienne-en-Dévoluy, Saint-Disdier and 14 hamlets | 3 | 7 |
| 40–50 | 226 | – | 0 | 0 |
| 50–60 | 515 | Corps, Les Côtes-de-Corps and 11 hamlets | 2 | 1 |
| 60–70 | 311 | La Salle-, Quet- and Saint-Laurent-en-Beaumont and 16 hamlets | 1 | 1 |
| 70–80 | – | – | – | – |
| 80–90 | – | Valbonnais, Entraigues and 11 hamlets | 3 | 0 |
| 90–100 | 304 | Le Rivier, La Chalp, Chantepérier, Le Plan du Col | 2 | 4 |
| 100–110 | 318 | Ornon, La Paute, La Pallud (Palud) and 13 hamlets | 2 | 5 |
| 110–120 | 881 | Le Bourg-d'Oisans, then the lower hairpins | 0 | 0 |
| 120–127 | 773 | La Garde, Huez, Maronne, L'Alpe d'Huez | 2 | 60 |

- That's about **4,000+ buildings** near the road: the footprints kit must merge them per village.
- The map also has **two tunnels near Huez** (named "Léopold" and "Huez"). P0 checks whether the route passes through them; one may be the "tunnel bend" riders mention.
- The Tunnel de la Beaume wasn't found by this query, so P0 checks how it's tagged.

Gaps in this census are filled in P0. The OpenStreetMap API and an Overpass mirror both answer from the build machine.

---

## Status (16 Nov 2026)

All phases built on `alpedhuez-hero-test`. Notes in `docs/alpedhuez/REVIEW.md`. Where the build went differently from the plan below:

- **Land cover and buildings** come from one file, `routes/scenes/alpedhuez-places.bin.gz` (`tools/build_places.py`, scene field `placesFile`), not `build_landcover.py` + `build_settlements.py`.
- **Bend signs** are a new roadside kit, `roadside/boards.js` (`boards`), which also draws town and col boards; `tools/place_boards.py` places those from the map.
- **Race dressing** lives in `life/race-day.js` with the crowds. Road paint is one decal mesh drawn over the road, not a road-shader change, so other routes' road shader is untouched.
- **Switchbacks** needed a landscape change: the ground between two close legs is one bank, the inside of a tight turn sits at the lower side's level, patches with a hairpin are drawn at 3 m (`groundMesh.fineCells`), and the upper leg stands on a retaining wall (`hairpinWalls`). Opt-in by `switchbacks`, so other routes are unchanged.
- **Not built yet:** runners beside the rider, podium and team buses, a sheepdog, griffon vultures (an eagle stands in), visitors at overlooks.

## Phases

Each phase ends with snapshots at the fixed spots (below), strict QC and a short note in `docs/alpedhuez/REVIEW.md`. I send you the pictures before starting the next phase.

### P0 · Switch the scene to the mountain preset, and take the baseline
1. `routes/scenes/alpedhuez.json` changes from wireframe to the **mountain** preset, with the standard look, a French title and region, and `oneWay` kept. The catalog entry stays in **Rough Drafts**.
2. Run `npm run lint:scenes`.
3. OSM pull script `tools/fetch_osm_corridor.py`, reusable for any route:
   - fetches buildings, places, landuse/natural cover, water, tunnels, bridges, aerialways, power lines and worship places within a set corridor
   - uses the OSM API in tiles, as `build_city.py` does, and caches to `~/.cache/bikefree-osm`
   - writes `docs/alpedhuez/osm-census.md` with counts per stretch
4. Baseline snapshots at the fixed spots (wireframe).

**Done when:** the scene lints clean on the standard, the census is complete, and the baseline is recorded.

### P1 · Real terrain bake
1. **Fix `build_terrain_grid.py`:** Terrain Tiles has whole z14 tiles of "no data" near Valbonnais. Fill them from z13, as the route builder already does.
2. **Bake:** `padM` 9,000, `coarseM` 40, `fineM` 900, `fineCellM` 10.
   - The box is about 75 × 38 km, close to Going-to-the-Sun's 43 × 58 km. The fine band is 1.7× longer.
   - **Budget:** under 6 MB gzipped (Going-to-the-Sun is 3.3 MB). If it's over, use a coarser grid beyond 5 km from the road.
3. **Lakes:** `lakeNames` for Lac du Sautet, Lac de Valbonnais and the Grandes Rousses tarns seen from the top.
4. **Rivers:** `streams` traced for the Drac, the Souloise, the Bonne, the Lignarre, the Romanche and the Sarenne.
5. **Structures:** gorges bridged where the road crosses them, and the **Tunnel de la Beaume** as a `mountainRoad` tunnel.
6. **Also bake:** the snow line about 2,800 m and glaciers on the Grandes Rousses (`glaciers`).
7. **Measure baked light over 127 km.** If the bake is too big for one map, tile it along the route: a toolbox change to `baked-light.js`, behind `lighting.tileM`.

**Done when:**
- The road sits in the ground everywhere and the lakes are at the right level.
- Strict QC is clean: no road in a lake or flooded road.
- The bake loads in under 3 s on the Air.

### P2 · OSM land cover (new toolbox tool)
1. `tools/build_landcover.py` bakes OSM landuse and natural areas into a 20 m class mask in the terrain grid:
   - forest (broadleaf, conifer or mixed)
   - meadow or pasture, and farmland
   - scrub, bare rock, scree and glacier
   - residential and water
2. `landscape/real-terrain.js` reads the mask where it has one, and falls back to the landform guess where it doesn't. The forest planner and the ground palette use it.
3. Scene field: `landcover: { file, classes }`.

**Done when:** forest and meadow edges match the map at the fixed spots (side-by-side with OSM).

### P3 · `alps` pack and data-driven zones (new toolbox kits)
1. **`packs/alps.js`**, built with the model builder, with three LODs where the inventory asks for them.

   | Group | Models |
   | --- | --- |
   | Trees | Norway spruce, European larch, Scots pine, Austrian black pine, Swiss stone pine (arolle), silver fir, beech, ash, walnut, field maple, downy oak (the dry south around Gap) |
   | Shrubs and cover | green alder, juniper, alpine rose, broom, lavender patches (Gap), hay meadow, alpine meadow flowers (gentian, arnica, campanula, martagon lily), tall umbellifers, boulders and talus |
   | Farm | hay bales (round, wrapped), wooden fences, stone walls, a wayside cross, a fountain-trough |

2. **`vegetation.zones`**, a data-driven species mix by elevation, aspect and land cover, replacing the hard-coded Glacier planner. This is inventory item 5.
   - Going-to-the-Sun's planting moves to data with no visual change, checked with `npm run guard`.
   - Alpe d'Huez gets its own zones:

   | Zone | Planting |
   | --- | --- |
   | Valley | walnut, ash, maple and hedgerows |
   | Montane | beech and fir on the shady side, Scots pine on the sunny side |
   | Subalpine | spruce and larch |
   | High | larch and arolle to about 2,100 m, then pasture |

3. Gallery entries and `meta.js`. `npm test` checks the pack.

**Done when:** the gallery shows the pack at real scale, the guard shows Going-to-the-Sun unchanged, and the scale checks pass.

### P4 · Planting and ground, stretch by stretch
1. **Palette**, about 10 colours:
   - Dévoluy limestone: pale warm grey `#b9b2a3`
   - Oisans crystalline rock: dark blue-grey `#6f6f72`
   - hay-meadow green, larch green, spruce dark, dry Provençal grass for Gap, turquoise lake, glacier white
2. **Planting by stretch**, using the A–L table above:
   - meadow verges mown in the valleys
   - forest edges in the gorges
   - open pasture on the cols
   - hedgerows on the Champsaur and Beaumont farmland
3. **View windows** at the real overlooks:
   - the Dévoluy walls from the Noyer
   - Lac du Sautet
   - the Écrins from Beaumont
   - the Oisans valley from the hairpins

**Done when:**
- Each stretch reads differently at its fixed spots.
- Scale checks pass.
- Under 600 draw calls at every spot.

### P5 · Atmosphere and distance
1. Vista kit tuned for the two rocks: the bright limestone ribs and ledges of the Dévoluy, and the dark gneiss of the Oisans.
2. Snow in gullies above 2,600 m, haze with a warmer Provençal tint south of Corps, ridge ink and cartoon cumulus building over the peaks in the afternoon.
3. Baked light: midday by default. Afternoon (low-30s sun, closer to the real 17:30 finish) is an option to look at here.
4. Weather presets: clear, and clouds on the peaks.

**Done when:** three distance layers show at every fixed spot, and nothing shimmers.

### P6 · Villages and landmarks from the map (new toolbox kits)
1. **`structures/footprints.js`** turns OSM building footprints into stylized buildings:
   - extruded footprint, roof by type and pitch, levels to height
   - regional style from the scene: stone or render colours, roof material and colour, balconies, shutters
   - merged per village into one draw
   - Fed by `tools/build_settlements.py`, which takes footprints within a corridor, classifies them (house, farm, barn, church, apartment, hotel, shed) and writes `routes/scenes/<id>-buildings.json`. Budget: under 1 MB.
2. **Two regional styles in data:**
   - **Hautes-Alpes / Dévoluy:** grey stone, lauze or grey tile roofs
   - **Oisans / Isère:** render in ochre and cream, red and brown tile roofs, wooden balconies
3. **Landmark models** (named, placed from OSM):
   - **Ski resort pieces:** big apartment blocks stepped down the slope, lift pylons and cables drawn from the mapped lift lines, lift stations. Used at Alpe d'Huez, Superdévoluy and Laye; reusable for any ski town.
   - **Churches:** Huez's Saint-Ferréol church at bend 7, La Salle-en-Beaumont's church on its slope, and Notre-Dame des Neiges at the Alpe, a distinctive tent shape.
   - **`structures/dam.js`**: the Sautet arch dam, a curved concrete wall built from a few parameters. The bridge stays an arch bridge.
   - **Bayard:** the Nordic centre and golf course.
   - **Col du Noyer:** the chalet bar.
4. **Utility poles and lines** from OSM power lines. The settlement kit's poles get a French style.

**Done when:**
- Every named village is at its real place.
- No building QC findings: on the road, in water or clipping.
- Under 600 draw calls through Bourg d'Oisans and the resort.

### P7 · The mountain road
1. **Bend signs 21 → 1** (a new `signs` kind, `"bend"`):
   - the white sign with blue lettering, the bend number, the altitude and the winners' names, plus the "Virage n°" plaque
   - placed at the real bends. 20 switchbacks are found on the climb from 114.3 km (805 m) to 125.9 km (1,805 m).
   - P0 pins each of the 21 bends from OSM and the published altitudes, including the bend that isn't a sharp switchback.
2. **Road surface by stretch:** N85 fresh, D17 Noyer worn and narrow, D937 gorge patched, D526 chip seal, D211 freshly surfaced for the Tour.
3. **French roadside** (verge styles in data):
   - red-topped kilometre markers (*bornes*)
   - snow poles on the cols
   - rock-fall nets in the Lignarre and Souloise gorges
   - stone parapets and guardwalls on the drops
   - white-and-red delineators
4. **French signs:** town entry signs (white with red border) and col summit signs (the brown and white col signs with altitude).

**Done when:** QC is clean, every bend sign faces the climbing rider, and the signs are readable at chase distance.

### P8 · Race day (new toolbox kit: `life/race-day.js` + `roadside/race-dressing.js`)
Scene field `raceDay`, all data. It's built as instanced pools: one draw per kind per stretch, hidden past a reach.

1. **Crowd density curve by distance:**
   - sparse in the valleys, groups in villages
   - thick on the last 2 km of each col
   - a continuous wall on the hairpins
   - the **orange crowd at Dutch Corner (bend 7)**
2. **People:**
   - standing, clapping, waving flags
   - a few running beside you on the steep bits, who peel off safely and never cross the rider's line
3. **Flags in data:** generic country flags (Netherlands orange, France, Belgium, Denmark, Slovenia, Colombia, Basque) and plain banners. **No real sponsor logos or trademarks.**
4. **Camper vans, tents, folding chairs and parked cars** on flat verges and pasture, fewer where the slope is steep.
5. **Road paint:** decals in the road-surface shader at no extra draw cost. They're generic encouragement ("ALLEZ", "HUP", "VAS-Y", arrows, hearts) and invented names, denser on the hairpins.
6. **Course dressing:**
   - metal crowd barriers in the last 3 km and through Bourg
   - KOM banners at Bayard, Noyer and Ornon, using plain polka-dot style with no brands
   - km-to-go boards from 10 km
   - the red flamme rouge at 1 km
   - the finish arch and gantry at Avenue du Rif Nel
   - the podium and team buses past the line
7. **No traffic.** Roads are closed: `traffic` off, parked cars only.
8. **Overhead:** a TV helicopter circling ahead of the rider.

**Done when:**
- Clipping QC is clean: no people in barriers, vans or the road.
- Under 600 draw calls and 2.5M triangles on the Alpe at Balanced.
- No stutter as crowd stretches stream in.

### P9 · Life and finish
1. Animals for the region:
   - Tarine cows and sheep with a dog on the pastures (Noyer, Ornon)
   - marmots on the high verges
   - alpine choughs, and griffon vultures circling over the Dévoluy
   - cows' bells are out of scope (no sound)
2. Visitors at overlooks (`visitors`) for the few non-race spots.
3. Finish: with Endless off (the default) the ride ends at the line on Avenue du Rif Nel and the summary opens.

**Done when:** everything looks right on the bike.

### P10 · Check and ship
1. Strict QC, clipping QC (crowds, vans, barriers, buildings) and the guard (other routes unchanged).
2. Snapshots at every fixed spot, before and after, with draw calls and triangles.
3. Check at Light, Balanced and High.
4. A githack ride on the Mac, then a ride on the M4 Air.
5. Move Alpe d'Huez from Rough Drafts to In Progress, update the toolbox doc, PR.

---

## Fixed snapshot spots

| Spot | km | Why |
| --- | --- | --- |
| Gap climb | 2.0 | Dry south |
| Col Bayard | 4.8 | First col, KOM |
| Champsaur | 15.1 | Farmland, Poligny |
| Noyer near the top | 24.5 | Pasture, crowds, Dévoluy walls |
| Saint-Étienne-en-Dévoluy | 32.4 | Limestone bowl, village |
| Tunnel de la Beaume | 41.9 | Gorge |
| Barrage du Sautet | 52.1 | Dam and lake |
| Corps | 55.4 | Town |
| La Salle-en-Beaumont | 67.5 | Plateau village |
| Valbonnais | 79.7 | Valley |
| Col d'Ornon | 98.7 | Third col |
| Le Bourg-d'Oisans | 111.0 | Base town |
| Bend 21 | 114.3 | First hairpin |
| Huez, bend 7 (Dutch Corner) | about 121.9, pinned in P0 | The orange corner |
| Finish | 126.9 | Arch and resort |

---

## Budgets

| | Target |
| --- | --- |
| Draw calls (Balanced, M4 Air) | under 600 everywhere |
| Scenery triangles | under 2M; 2.5M on the Alpe with crowds |
| Frame | 60 fps at 1.5× pixel ratio; no frame over 25 ms at tile edges or crowd streaming |
| Download | terrain under 6 MB, land cover under 0.5 MB, buildings under 1 MB, pack code only (no textures) |

## New toolbox parts this route adds (reusable)

| Part | Scene field | Reused by |
| --- | --- | --- |
| `tools/fetch_osm_corridor.py` | – | every real-place route |
| `tools/build_landcover.py` + land-cover mask in real terrain | `landcover` | every real-terrain route |
| `packs/alps.js` | `packs: ["alps"]` | Mont Ventoux (south slopes), Stelvio, any Alpine pass |
| Data-driven zones | `vegetation.zones` | Going-to-the-Sun (moved to data), every mountain |
| `structures/footprints.js` + `tools/build_settlements.py` | `buildings`, `buildingStyles` | any route with real villages |
| Ski-resort pieces, lifts from OSM | `resort`, `lifts` | Ventoux (Mont Serein), Stelvio |
| `structures/dam.js` | `dams` | any reservoir route |
| Bend signs | `signs` kind `bend` | Stelvio's 48 bends, Ventoux's markers |
| French roadside styles | `verge.style: "fr"` | Ventoux |
| Race-day kit | `raceDay` | any race-stage route |
| Baked light tiling (if needed) | `lighting.tileM` | any long route |

Each one gets a schema entry, a lint rule, a gallery entry and QC checks, as `TOOLBOX.md` requires.

## Risks

- **127 km of hero detail is about 1.7× Going-to-the-Sun.** Planting and buildings must be streamed by stretch. Nothing is placed for the whole route at once.
- **Crowds are the heaviest item.** If the budget slips, stand-in billboards take over beyond 60 m.
- **OSM building coverage is uneven in the small hamlets.** Gaps get generic farm clusters at the mapped place nodes.
- **Hairpin numbering:** one of the 21 isn't a clean switchback. It's pinned by hand from published altitudes.
