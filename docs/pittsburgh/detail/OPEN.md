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

## From S1 · baked lighting, North Shore → Point (reported 16 Nov, merged `06b5e85`)
- **First bake may hitch:** on the software GPU the first bake's occluder step took 3–9 s in one frame (mostly shader compiling). Measure on the M4; fixes: `compileAsync` ahead, or bake behind the loader.
- **Re-bakes while riding:** a warm re-bake costs 92–104 ms here (worst step 36 ms) each time a streamed city chunk changes the static set. Measure on the M4; spread it over frames or bake ahead along the route if it hitches. (Coordinator: kit meshes now opt out with `userData.bake = false`.)
- **2.0 km is over budget:** 611 draw calls with the chase camera (about 640 with live shadows), before any S1 work — the downtown chunks in view.
- **Not handed over yet:** General Robinson and Federal St are still bare (kit not on there); the class-1 street mapped under the trail at 1.50–1.52 km splits the promenade; the Fort Duquesne ramps at about 1.0 km.
- **Dynamic flag:** anything new that moves must set `userData.dynamic`, or it loses its shadow once the bake is in.
- **Polish:** tree shadows are soft (2.5 m texels); the time-of-day menu still lists Morning and Daylight for Pittsburgh (both show golden); the fountain basin and the Blockhouse are unchanged.

## Integrated branch check (coordinator, 16 Nov, after all four merges)
- `npm test` 106/106 · course QC `--strict` all 12 routes 0 fail 0 warn · road meets 138 of 1,370 sites with issues (baseline 816 of 2,077).
- Clipping `--no-life`: 0 fail, 85 warn (baseline 91): ground-over-street 58 → 44, post-in-solid 18 → 9, **z-fight 11 → 22**, scenery-on-street 0 → 6, floating 3, structure-through-building 1.
- Draw calls at the 18 spots (Balanced, every chunk built for the bake): **8.8 km 695, 17.3 km 683** over the 600 budget; 650 m 544, 11.3 km 543, 2.5 km 530; the rest 215–485. Triangles max 1.86 M (8.8 km). Pictures: `integrated/before-after-1…3.jpg`.
- New: at 3.05 km, the PPG Place spires near the camera render as large black triangles (in the baseline too).

## Suggested plan
| # | Item | How to tackle it |
| --- | --- | --- |
| 1 | **Budget** (8.8, 17.3, 2.0 km over 600 draw calls) | `npm run snap -- --breakdown` at those spots; merge city chunks beyond ~1 km into one far-city mesh per sector (windows as texture, no rooftops), and fold per-chunk lamps/trees/walks into fewer meshes. Must land before the kit goes route-wide. |
| 2 | **Road meets left** (138 sites; Mon Wharf + Smithfield ramp sawtooth, hole at 6.02 km, lips at 2.51/2.81 km, deck end 16.41 km, interchange overlaps) | Resume the intersections agent. Do S4's builder items first (deck clearance over the route, deck ends at their ground street's height, route height at 4.07 km), then the sites. When under ~20 near the route, make `road-meet` a warning. Re-render the contact sheet. |
| 3 | **Clipping warnings** (z-fight doubled, 44 ground-over-street, 6 scenery-on-street) | Triage each finding from the report; make the ground-over-street check sample trimmed ribbon widths, not full widths. Target ≤ baseline per category. |
| 4 | **Kit route-wide + junction corners** | Wire S3's `addCorner` API into the junction planner; turn the kit on for General Robinson/Federal (masonry), downtown (tower/masonry), the West End (rowhouse) and the Science Center lot; fold the sidewalk cross-section (`street-grade.js`) into road alignment. After #1. |
| 5 | **Baked lighting on the M4** (first-bake hitch 3–9 s, re-bakes ~100 ms) | Compile the bake shaders ahead (`compileAsync`) and bake behind the loader; time-slice re-bakes or bake ahead along the route. Needs your Mac session with the **I** overlay (also measures High, never measured). |
| 6 | **Alignment leftovers** (crest +3.1 m, jagged road at 12.07 km, curve Pittsburgh-only) | Narrow the app's ±60 m elevation smoothing for city routes; finer far ground near steep streets; trial the curved centre line on Route 28 and Going-to-the-Sun. |
| 7 | **Polish** | 4 floating lamps; PPG spire shading at 3.05 km; the street under the trail at 1.50 km; repeated shop labels; blockier parked cars; tree-shadow softness; Pittsburgh's time menu (drop Morning/Daylight); fountain basin and Blockhouse. |

**Order:** wave 2 = #1, #2 and #3 in parallel (three agents, they touch different code); then #4; then the Mac session (#5); then #6–#7 and the PR.

## Wave 2 · #2 road meets (merged)
Issues within 25 m of the route 82 → 19 (1,076 sites, 23 with issues overall); `road-meet` warns past 20. Still open: Point ramps 2.81–2.84 km need hand-placed deck heights; lips at deck junctions 2.51 km (0.73 m) and 15.75 km; overlaps at 1.32, 4.14/4.39, 4.87, 7.29 (junction), 11.70, 15.66, 16.52 km; small steps at 11.63 and 18.13 km; street building 1–3 s slower at load (VM).

## Wave 2 paused (16 Nov, 17:45)
What was done and what's left per agent: `PAUSED.md`. `w2-align` is not in the PR (it conflicts with the road-meets changes; see PAUSED.md). Item #4 not started.
