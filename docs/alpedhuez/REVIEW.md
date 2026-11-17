# Alpe d'Huez — wireframe review (16 Nov 2026)

Route: Tour de France 2026 Stage 19, Gap → Alpe d'Huez, one way. Scene: wireframe placeholder.

## Sources
- ASO *itinéraire horaire*, stage 19 (3 Apr 2026): every town, junction and road number with its km
- Published stage GPX (cyclingstage.com): used only to check the routed line, not copied
- Elevation: AWS Terrain Tiles z14 (z13 where z14 has no data)

## Checks
- Routed line vs the stage GPX: no stage point more than 60 m from the route
- Every itinerary checkpoint within 1 km of its official distance; the drift is even (−0.7 %)
- Climbs: Bayard 4.8 km 7.2 % to 1,246 m · Noyer to 1,660 m · Ornon to 1,366 m · Alpe 13.8 km 8.1 % to 1,834 m
- `node tools/qc_course.mjs alpedhuez --strict`: 0 fail, 0 warn (hairpins as info)
- Snapshots (`npm run snap -- alpedhuez@60:drone alpedhuez@24900 alpedhuez@99000:drone alpedhuez@120000:drone alpedhuez@126900`): 202–210 draw calls, 0.7–0.8 M triangles

## Known gaps
- Distance 127.0 km vs 127.9 km official (map geometry vs road measurement)
- Climbing 3,358 m vs ~3,500 m official: the road profile smooths out small rollers
- Terrain streams from the internet (not baked yet); no scenery

---

# Alpe d'Huez — hero review (16 Nov 2026)

Branch `alpedhuez-hero-test`. Plan: `docs/alpedhuez/HERO_PLAN.md`. The whole stage, Gap → Alpe d'Huez, on race day, at real places from OpenStreetMap, in the gentle cartoon look with midday baked light.

## What's in it
- **Ground:** AWS Terrain Tiles z14 baked at 10 m along the road and 40 m out to 9 km (`alpedhuez-terrain.grid.bin.gz`, 4.6 MB). Holes in z14 are filled from z13. Lakes are kept only where the map has water (Lac du Sautet at 770 m, the Laffrey lakes, Saint-Pierre-Cognet, Lac Blanc, Plan d'eau du Champsaur).
- **Map data:** `tools/fetch_osm_corridor.py` (OSM API tiles within 1.5 km of the road) → `tools/build_places.py` → `alpedhuez-places.bin.gz` (0.3 MB): 20 m land cover, 7,300 building footprints, 78 lifts, 71 power lines, 5 dams. `tools/place_boards.py` adds 39 town boards and the Bayard, Noyer and Ornon col boards.
- **Planting:** the new `alps` pack (106 models) through `vegetation.zones`: walnut, ash and maple in the valleys, beech and fir on shady slopes, Scots pine on sunny ones, spruce and larch higher, larch and arolle at the top. Land cover decides forest, hay meadow, farmland, scree and village ground.
- **Villages:** every building from its footprint, in six regional styles by stretch (Provençal Gap, Champsaur/Dévoluy stone, Trièves/Beaumont, Valbonnais/Oisans with balconies, the hairpin villages, the resort blocks). Churches with towers, Notre-Dame des Neiges as a tent, the Sautet dam, lifts and power lines.
- **Road:** EU white markings, French *bornes* (red caps on the N85, yellow on the departmental roads), snow poles on the cols, the Beaume tunnel and the Huez galleries, bend boards 21 → 1 at the mapped *virages* with altitude and winners.
- **Switchbacks:** the ground between two legs is one bank; the inside of a tight turn sits at the lower side's level; patches holding a hairpin are drawn at 3 m (`groundMesh.fineCells`); the upper leg stands on a dry-stone retaining wall (`hairpinWalls`). Opt-in (`switchbacks`), so other routes are unchanged.
- **Race day:** people placed by stretch: thin in the valleys, groups in the villages, thick on the last 2 km of each col, a wall on the 21 bends, an orange crowd at Dutch Corner (bend 7). Near the rider they are cheering figures; further off, crowd cards. Fan flags, camper vans, tents, parked cars, barriers at the start, through Bourg and the last 3 km, painted words on the road, polka-dot summit banners, km-to-go banners from 10 km, the red flame at 1 km, the finish gantry and a TV helicopter. No traffic. Generic colours and words, no brands.
- **Life:** cows on the Champsaur and Matheysine pastures, sheep on the Noyer and Ornon, marmots by the summits, ravens and an eagle.

## Checks
- `node tools/qc_course.mjs alpedhuez --strict`: 0 fail, 0 warn
- `node tools/qc_clipping.mjs alpedhuez --no-life`: 0 fail, 0 warn
- `npm test`: 130 pass · `npm run lint:scenes`: 0 errors · `npm run routes:check`: clean
- Guard (`tools/toolbox_guard.mjs`, before = the plan commit): every other route identical in pixels and objects (Going-to-the-Sun and Big Sur re-checked after the last changes)
- Budget at Balanced: 150–260 draw calls everywhere; triangles 0.9–1.7 M on the way, up to 2.3 M on the busiest hairpins with crowds (allowance 2.5 M)

## Snapshots at the fixed spots
| Spot | km | Draw calls | Triangles |
| --- | --- | --- | --- |
| Gap climb | 2.0 | 232 | 1.09 M |
| Col Bayard | 4.8 | 244 | 1.14 M |
| Champsaur | 15.1 | 186 | 0.90 M |
| Noyer near the top | 24.5 | 239 | 1.28 M |
| Saint-Étienne-en-Dévoluy | 32.4 | 219 | 1.05 M |
| Tunnel de la Beaume | 41.9 | 221 | 1.24 M |
| Barrage du Sautet | 52.1 | 213 | 1.18 M |
| Corps | 55.4 | 222 | 1.11 M |
| La Salle-en-Beaumont | 67.5 | 240 | 1.14 M |
| Valbonnais | 79.7 | 216 | 0.90 M |
| Col d'Ornon | 98.7 | 227 | 1.29 M |
| Le Bourg-d'Oisans | 111.0 | 187 | 1.03 M |
| Bend 21 | 114.3 | 220 | 1.67 M |
| Bend 7, Dutch Corner | 120.8 | 235 | 1.68 M |
| Finish | 126.9 | 149 | 0.86 M |

`npm run snap -- alpedhuez@<m>` at each spot. Contact sheet: `docs/alpedhuez/hero-spots.jpg`.

## Still to do
- A githack ride on the Mac and the M4 Air (frame times while crowd stretches stream in)
- Not built: runners beside the rider, podium and team buses, a sheepdog, griffon vultures, visitors at overlooks
