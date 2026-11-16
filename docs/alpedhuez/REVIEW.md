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
