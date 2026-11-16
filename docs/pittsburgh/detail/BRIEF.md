# Pittsburgh detail pass — coordinator brief (16 Nov 2026)

Branch `pittsburgh-detail-test` = `main` (v0.13.3, perf-test merged) + `pittsburgh-p5` (P5 rivers).
Four section agents work in parallel, each in its own git worktree and branch; the coordinator
integrates everything onto `pittsburgh-detail-test`, re-runs every QC and opens one PR.

## The problems (from the user)
1. **Low level of detail** — plain boxes, flat roofs, bare lots, empty sidewalks.
2. **Intersections are slammed together** — street ribbons just overlap at junctions (height slots +
   `_levelJunctions` plateaus); no junction surface, no corners, curbs, crosswalks or stop lines; ramps
   and parallel carriageways pile on top of each other (Mon Wharf, 2.5 km).
3. **Roads jump around** — the route and streets kink and zig-zag (Market St 3.4 km, General Robinson
   0.3 km), East Carson rides on a wall above its own storefronts (5.6 km), heights step.

## Decisions (user, 16 Nov 2026)
- **Look:** keep the current Pittsburgh hero look (stylized low-poly, golden hour, post, river fog,
  clouds) — but with **fixed lighting and baked shadows** (no per-frame sun shadow map for static
  scenery). Golden hour is the one baked time. Night still works (lights + baked ambient occlusion, no
  sun shadows). Midday / blue-hour presets are dropped for Pittsburgh on this branch.
- **Budget holds** on every preset: under 600 draw calls and 2 M triangles (Balanced and High), 60 fps at
  1.5× pixel ratio, no frame over 25 ms. New detail is merged per chunk or instanced, with distance LOD.
- **Split by area**; **one branch, one PR**.
- Everything built is **shared and reusable**: other routes and other agents must be able to use it.

## Sections (by the route's own waypoints; metres are approximate)
| | Section | Route span | Shared system it owns |
| --- | --- | --- | --- |
| S1 | North Shore start → Clemente Bridge → Allegheny riverfront → the Point → Mon Wharf ramp | 0 – 2.7 km | **Baked lighting**: fixed sun + baked shadows / AO |
| S2 | Downtown: Market St → Market Square → Forbes → Smithfield → Smithfield Street Bridge → Station Square | 2.7 – 5.3 km | **Junctions**: real intersection geometry |
| S3 | South Side: East Carson 10th → 27th → SouthSide Works → riverfront trail → Muriel → McArdle foot | 5.3 – 10.9 km | **Street & facade detail kit** |
| S4 | McArdle climb → Grandview Ave → Duquesne Incline top → Grandview W → West End Bridge → North Shore finish | 10.9 – 18.3 km | **Road alignment**: smooth centrelines and grades + QC checks |

Owning a shared system means: you design and build it route-agnostically, prove it on your section,
document it, and make it safe to switch on for the whole route. Your section is also yours to make look
good with any tool. In **wave 2** each agent applies all four systems to its own section and fixes seams.

## Shared-system contracts
- **Baked lighting (S1)** — a scene opts in (e.g. `"lighting": { "baked": "golden" }`). Static scenery
  (terrain, buildings, bridges, streets, trees, props) gets its sun shadow and AO from a bake; the renderer
  stops re-rendering a sun shadow map every frame for it. Dynamic things (rider, traffic, people, boats)
  get cheap shadows (blob/contact or a tiny local shadow map). Must cope with chunk streaming and the
  Light/Balanced/High presets. Either an offline bake tool (`tools/bake_*.mjs`, small committed output,
  aim ≤ 2 MB gzipped per route) or a bake-once-at-load that costs ≤ 1 s on the M4 — measure and choose.
- **Junctions (S2)** — a module that turns the street graph into junction polygons (one level surface
  per junction, rounded curb returns, sidewalks wrapping the corner, crosswalks and stop lines, merged
  nodes where OSM puts several junctions within a few metres), with street ribbons trimmed to the
  junction edge. Replaces the overlap-and-height-slot approach where it applies. Owns street height
  *inside* a junction radius. New clipping/course QC counts (e.g. overlapping street ribbons) to prove it.
- **Detail kit (S3)** — a catalogue of merged/instanced low-poly pieces and placement rules: storefront
  ground floors, cornices, window bays, parapets, rooftop clutter (HVAC, stair heads, water tanks at a
  believable scale), sidewalks and curbs, street furniture (signals, signs, hydrants, benches, bus
  shelters, bollards, planters, bike racks, meters), lot fill (parking lots with stalls, fences). Seeded
  and deterministic, LOD'd, a few draw calls per chunk. Crosswalk/stop-line paint belongs to Junctions.
- **Road alignment (S4)** — builder-side tools that smooth the route line and street centrelines in plan
  (no kinks, curvature-limited, still within the mapped corridor) and in profile (grade-limited, no
  steps, decks and ramps meeting the ground cleanly), plus the route-height-vs-ground issue on the
  Mount Washington crest (13.3–14.1 km). Owns street height *between* junctions. New course-QC checks
  (heading jitter, lateral jumps, grade spikes, street steps) that work on any route.

## Rules for working in parallel
- Work only in your worktree `/home/claude/wt/<s>` on branch `pgh-<s>`. Commit there; do not push, do
  not touch other worktrees or `/home/claude/bikefree`.
- Put each shared system in **new files** (`js/world/<name>.js`, `tools/citylib/<name>.py`, …). Edits
  to hot shared files (`city.js`, `city-landscape.js`, `world.js`, `post.js`, `build_city.py`,
  `qc_course.mjs`, `qc-clipping.js`, `snap_scene.mjs`) must be **small, local hooks**, each marked with a
  comment tag like `// [junctions]`, so four branches merge cleanly.
- **Do not commit generated files**: `routes/scenes/pittsburgh-city.json`, `routes/cities/pittsburgh.gpx`,
  terrain grids, `sw-assets.js`, `js/version.js`, `package.json`'s version, `PLAN.md`,
  `docs/pittsburgh/REVIEW.md`. Regenerate locally to test; the coordinator rebuilds after merging. A new
  committed data file of your own (e.g. a bake output or hand-placed section data) is fine.
- Headless Chrome is heavy and the machine has 2 CPUs: run every Chrome job (snap, snap:cam,
  qc:clipping) through the lock — `flock /tmp/bikefree-chrome.lock <command>` — and keep shot lists short.
- Baseline shots (golden hour, Balanced, software GPU) are in `/home/claude/baseline/`
  (`pittsburgh-<metres>.jpg`, `snapshots.json` with draw calls and triangles).
- Before finishing: `npm test`, `npm run qc -- pittsburgh --strict`, `npm run qc:clipping -- --no-life`
  (full life run if you changed traffic-relevant geometry), before/after snapshots of your section.
- Write `docs/pittsburgh/detail/<s>.md`: what changed, before/after pictures and numbers, the shared
  system's how-to (API, scene keys, how another route switches it on), and what's left.
