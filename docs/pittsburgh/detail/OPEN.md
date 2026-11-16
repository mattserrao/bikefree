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

## From the intersections agent · junctions + road meets, route-wide (reported 16 Nov, merged)
- **138 of 1,370 meeting sites still have issues** (baseline 816 of 2,077). 82 of them are within 25 m of the route. The `road-meet` check is info-level only; a test caps growth (≤ 10 junction/link issues within 25 m, < 200 in total).
- **Clipping warnings up:** 91 → 127 (ground-over-street 58 → 94, z-fight 11 → 17). Not yet triaged one by one; the suspicion is the check samples each street's full width, including the trimmed-away parts.
- **About 93 overlaps remain,** mostly 25–150 m out at interchanges; thin ground wedges show between trimmed ribbons.
- **Specific spots:** a hole inside a merged junction at 6.02 km; lips at deck junctions beside the route at 2.51, 2.81 and 2.82 km; the ramp sawtooth at Mon Wharf and the Smithfield approach is reduced but not gone; the deck end at 16.41 km is 1.9 m off.
- **Contact sheet "after" pictures predate the final S4 merge:** re-render them.
- **For road alignment (builder):** set deck clearance over the route in the builder; give a deck's end its ground street's height; the route height at 4.07 km.
- **S3's corner API not wired in** (`addCorner`, corner pads to `sidewalkTop()`/`curbAt(s)`, cross-street ends at road level).
- **Street-building time:** the new passes add about 1.5–3.5 s at load on this VM.
