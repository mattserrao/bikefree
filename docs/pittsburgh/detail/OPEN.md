# Pittsburgh detail pass — still-open items (running list)

Collected from each agent's final report as it comes in. Suggestions are added once all agents have reported.

## From S4 · road alignment, McArdle → finish (reported 16 Nov, merged `b3920ac`)
- **Heights wrong at path/deck ends:** 11.45, 11.94, 12.30, 12.78, 13.30, 14.53, 16.41 km (table in `s4.md`). Handed to the intersections agent.
- **Ramps zig-zag in height** at Mon Wharf and the Smithfield approach. Handed to the intersections agent.
- **Jagged uphill edge** on a steep road about 80 m north of McArdle (12.07 km shot): the far ground mesh is too coarse.
- **West End Bridge approach hillside** is still grass and boulders; the **Carnegie Science Center lot** is still bare.
- **Four floating lamp posts**, two on the West End Bridge deck (baseline had three).
- **Crest rounding:** the app's ±60 m elevation smoothing still rounds the Mount Washington crest by up to 3 m (road up to +3.1 m over ground).
- **High preset not measured** (Balanced peak 509 draw calls, 1.71 M triangles at 11.3 km).
- **Curved road centre line is Pittsburgh-only;** other routes pass QC with it on, but it's not switched on.

## From S3 · street & facade kit, South Side (reported 16 Nov, merged `b339c69`)
- **Clipping warnings up in the South Side:** 40 against the baseline's 15. 32 are ground-over-street at junction corners, where the 6 m ground mesh bulges because cross streets still sit at the old low level. 6 are scenery-on-street at 9.0 km.
- **Junction corners not wired to the kit:** the intersections agent should call `externalJunctions(true)` + `addCorner({x, z, yaw, arm, signal, sign, button, bollards})`, build corner pads to `sidewalkTop()` / `curbAt(s)`, and bring cross-street ends up to road level.
- **Sidewalk cross-section not in road alignment:** `street-grade.js` fixes the East Carson wall only inside kit zones. Road alignment should fold the cross-section into street heights route-wide; the ground mesh needs about 2.5 m from the curb to reach sidewalk level.
- **Kit not switched on route-wide:** with `"fromM": 0` it adds 46–54 draw calls, and 650 m reaches 593 of the 600 budget. Held until baked lighting lands.
- **8.8 km is already at 709 draw calls** when every chunk is built, without the kit: over budget.
- **Work-slice spikes:** single kit slices take 25–45 ms on this busy VM; untested on the M4.
- **Polish:** shop labels repeat on neighbouring units; parked cars are blocky up close.
