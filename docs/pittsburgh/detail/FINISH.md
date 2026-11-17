# Pittsburgh detail pass: finishing (17 Nov 2026)

Branch `pittsburgh-finish-test`, from `main` at `d79fd61` (PR #28 Pittsburgh detail + PR #29 toolbox). This pass finishes the open items from `OPEN.md` and the paused wave-2 work (`PAUSED.md`) without agents.

## What was done

| # | Item | Result |
| --- | --- | --- |
| 1 | **Road alignment (wave 2)** | Ported onto the toolbox layout (`ground-drape.js` → `js/world/toolbox/landscape/`). The Mount Washington crest sits on its ground (Pittsburgh smooths elevation over ±10 m via `eleSmoothM` in the catalog; other routes keep ±60 m). The ground mesh stays off steep streets and from under the route's bridges. Going-to-the-Sun has the curved centre line. The 3 tests it used to break pass. |
| 2 | **Road meets** | Same-level crossings of the route with no junction are hidden under the road (also inside a junction's ease zone when on the road). Route junctions never rise above the road as `routeDist` sees it. Stubs already cut at one end aren't drawn. Within 25 m of the route: **20** sites with issues (the QC's budget), 24 in all; it was 22 / 28 with road alignment merged before these fixes. |
| 3 | **Draw-call budget** | Every spot on Balanced: **≤ 258 draw calls and ≤ 1.73 M triangles** (budget 600 / 2 M). High at the three busiest: 8.8 km 252 / 1.83 M, 11.3 km 279 / 1.95 M, 17.3 km 291 / 1.79 M. Kit sidewalks and car parks now LOD out past the mid band (1.2×), which took 8.8 km from 2.08 M back to 1.73 M triangles with the kit route-wide. |
| 4 | **Street kit route-wide + junction corners** | `streetKit` runs the whole route (0–18.4 km) with four new zones: North Shore (General Robinson & Federal, masonry), downtown (Market, Forbes & Smithfield, masonry), West End hillside (rowhouse, parking) and the Carnegie Science Center (industrial, its car parks). Junction corners in a zone get a signal mast (busy junctions), a corner street sign and push buttons through `StreetKit.addCorner()`; the kit's own mapped signals and corner signs step aside (`externalJunctions`). |
| 5 | **Clipping** | The clipping QC now sees every kit mesh, not just the LOD band where the camera starts (it was under-reporting the kit). Kit furniture keeps clear of lamp posts and tree trunks by kind (`LAMP_CLEAR`); awnings and blade signs aren't hung over lamp posts; city lamps and street trees keep clear of kit facades. Car parks are cut along the ground's 6 m grid so they lie on it (w2-clip's WIP, verified). Bridge deck slabs face outwards (they were wound inwards: lit from inside, lamps on their edges stood on nothing). |
| 6 | **Baked lighting on the M4** | Measured here (headless, software GPU, `--no-draw`): the bake runs behind the loader and **no re-bake happened during either ride**. Ride frames over 0–3 km: median 11.9 ms, p95 19.1 ms, worst 186 ms, 29 of 2,000 over 25 ms; over 8–10 km: median 12.2, p95 19.4, worst 213, 27 of 1,333 over 25 ms. None of the slow frames had bake work in them (streaming and kit dressing on this 2-CPU VM). The first bake took 8.5–8.8 s behind the loader (148 ms of CPU). The M4 checklist is below. |
| 7 | **Polish** | The deck winding fix above (floating lamps on decks). The street under the trail at 1.50 km is a real ramp on the bank under the Fort Duquesne Bridge: the promenade stops there and picks up after it (`extra-spots.jpg`); left as mapped. |

## Checks
- `npm test`: 133 / 133.
- `npm run qc -- --strict`: all routes clean (Pittsburgh: 0 fail, 0 warn; road meets 20 within 25 m, at the budget).
- `npm run routes:check` clean; `npm run lint:scenes`: 0 errors.
- Clipping `--no-life` (now with every kit mesh): 0 fail, 87 warn; see the table below.
- Toolbox guard (`tools/toolbox_guard.mjs`) against `main` on Route 28, Big Sur, Going-to-the-Sun, Alpe d'Huez, Yosemite and Zion: the only object changes are Going-to-the-Sun's road furniture (the curved centre line, intended) and the rider / gulls (their animation phase moves with frame timing: recording `main` twice gives identical shots, the branch shifts them by one shot). No scenery changed on other routes.

### Clipping, by category (warnings)
| category | main (PR #28 QC: kit in 2 zones, only the LOD band near the camera) | now (kit route-wide, every kit mesh checked) |
| --- | --- | --- |
| fail | 0 | 0 |
| ground-over-street | 39 | 33 |
| post-in-solid | 9 | 23 (14 lamps ↔ kit facades/fences, 9 lamps ↔ bridges) |
| tree-in-solid | 0 | 18 (street trees against kit facades and kit furniture) |
| floating | 6 | 7 |
| z-fight | 6 | 5 |
| structure-through-building | 1 | 1 |
| **all warnings** | **61** | **87** |

Most of the rise is the street kit now running the whole route and the QC now seeing all of it (on `main` it skipped kit meshes beyond 260 m of the start). Before the clearance fixes above, the same full check found 146.

### Draw calls and triangles (Balanced, chase camera, golden hour)
| km | calls main | calls now | M tris main | M tris now |
| --- | --- | --- | --- | --- |
| 0.30 | 169 | 180 | 1.02 | 1.11 |
| 0.65 | 222 | 217 | 1.48 | 1.48 |
| 1.60 | 165 | 187 | 1.08 | 1.21 |
| 2.00 | 241 | 239 | 1.44 | 1.44 |
| 2.50 | 195 | 196 | 1.31 | 1.34 |
| 3.05 | 176 | 201 | 1.12 | 1.32 |
| 3.45 | 170 | 172 | 1.29 | 1.34 |
| 3.90 | 134 | 163 | 1.03 | 1.23 |
| 4.60 | 175 | 193 | 1.05 | 1.16 |
| 5.60 | 203 | 191 | 1.33 | 1.24 |
| 6.60 | 145 | 140 | 1.19 | 1.16 |
| 8.80 | 244 | 235 | 1.77 | 1.73 |
| 10.70 | 160 | 161 | 1.07 | 1.06 |
| 11.30 | 237 | 250 | 1.56 | 1.60 |
| 12.00 | 227 | 258 | 1.36 | 1.49 |
| 13.10 | 176 | 196 | 1.07 | 1.17 |
| 14.60 | 171 | 185 | 1.00 | 1.04 |
| 16.00 | 120 | 136 | 0.83 | 0.89 |
| 17.30 | 258 | 251 | 1.56 | 1.54 |

Extra spots (now only): 1.51 km 189 / 1.27 M, 2.83 km 161 / 1.12 M, 15.40 km 217 / 1.19 M. Pictures: `finish/before-after-1…4.jpg`, `finish/extra-spots.jpg`. (Main's 0.3–4.6 km counts are from `--breakdown`, 5.6–17.3 km from a plain run; they agree within a few calls.)

## M4 checklist (baked lighting, with the **I** overlay)
Ride Pittsburgh on Balanced, then High, at golden hour and at night:
1. **Load:** the loader stays up while the bake prepares (the overlay's bake line says `preparing NN%`); when the ride starts it says `ready`. Pass: no frame over 25 ms in the first 10 s of riding.
2. **Ride 0–3 km and 8–10 km:** watch the overlay's session line (`frames … worst … over 25 ms`; `bake: N frames with bake work, M over 25 ms`). Pass: p95 under 16.7 ms (60 fps), at most a handful of frames over 25 ms, and **0** bake frames over 25 ms.
3. **Re-bakes:** if the bake line shows `re-baking`, note the km. Pass: each step ≤ 4 ms CPU and no visible pop of shadows.
4. **Night:** sun shadows off, AO and lights on; same frame-time pass as 2.
5. **High at 11.3 km (1.95 M triangles here):** pass if it holds 60 fps; if not, the fallback is Balanced's tree and kit LOD bands on High.

## Still open
- **Road meets (20 near the route):** the Point ramps at 2.77–2.84 km (deck junctions beside the route: lips, a ramp crossing with no junction; `extra-spots.jpg` shows the interchange) need hand-placed deck heights; overlaps at 1.32, 4.40, 4.87, 11.70 and 15.66 km (one-way carriageways merging at a shallow angle, trimmed at their nodes but not between them); junction overlaps at 7.29 and 16.52 km; lips at 2.51 and 15.75 km; a crossing at 10.38 km; a clipped street at 15.25 km.
- **Clipping:** posts in bridges (10, lamps on girder decks touching the trusses), lamps 38–60 m above water at 9.76 and 15.95 km (lamps on mapped decks with no slab drawn under them), and the kit collisions left in the table.
- **Z-fight** at three route junctions (10.39, 13.09, 17.02 km), as on `main`.
- Frame spikes up to ~210 ms on this VM come from streaming, not the bake; check on the M4 with the overlay.

---

# Second round (17 Nov 2026, later): road texture, brick, foliage, open items

## What was done
| Item | Result |
| --- | --- |
| **Road texture pass** | The toolbox road-surface tool (`materials/road-surface.js`, scene `road`) now runs on Pittsburgh by area: worn North Shore streets; patched downtown and East Carson asphalt; fresh decks on the Clemente and West End bridges and a fresh Grandview Avenue; a worn, cracked McArdle. The trails take their own surface through a new **`road.trail`** setting (`world.js` decorates the trail material too). |
| **Brick** (added on request) | A new **`brick`** kind in the road-surface tool: courses 10.5 cm deep laid across the road, bricks 21.5 cm long in running bond, dark sand joints that fade to the brick's average far off, wheel tracks polished darker, grime; asphalt patches still show. On the route: the steep **West End descent (14.45–15.62 km)** and **Market Square** (OSM: sett). For the city's own streets, a new scene field **`brickStreets`** (`city/city.js`): streets that OSM tags `brick`, `sett`, `paving_stones` or `cobblestone` (the city builder keeps it as street flag bit 3: 30 streets, e.g. Grant Street, Market Square, Wyoming Street) and steep residential streets (class 5, at least 7 % over 25 m: 174, on Mount Washington, the South Side Slopes and the West End) are drawn in brick with their own material. |
| **Foliage pass** | The city's street trees get the toolbox foliage-and-bark surface shader (`decorateTreeMaterial`: leafy clumps with sunlit tips and dark hollows on the crowns, bark on the trunks; `aTree` on the street-tree geometry). The hillside woods use the **alps pack's deciduous trees** (beech, oak, field maple, ash) with the same shader, as stand-ins for western PA's hardwoods (same genera; the pack is European, so this bends the "regional plants" rule at the genus level). |
| **Lamps and the kit** | Fences and riverfront rails leave a gap where a lamp post stands; lamp posts keep 20 m (was 14 m) from the styled bridges' members on every street, not just bridge decks. Lamps ↔ kit facades/furniture: 14 → **0**. |
| **Z-fight** | The route's road overlay in junctions: overlapping spans (junctions close together along the route) are merged, so two strips never sit at one height. Route-junction z-fight: 3 sites → **0**. |
| **High under 2 M triangles** | The new trees and brick streets pushed High over (8.8 km 2.08 M). High's kit LOD bands are shorter (near 380 → 320 m, mid 1100 → 900 m, detailed cars 140 → 90 m), street-tree trunks have four sides, street trees stand within 520 m of the ride (was 650; the hillside woods carry the distance) and a car park holds at most 45 parked cars. |
| **Presets** | The city preset (`routes/presets/city.json`) carries `packs` and `brickStreets`. |

## Checks
- `npm test` 144 / 144 (with main's route selector merged) · course QC `--strict` all routes clean · `routes:check` clean · `lint:scenes` 0 errors · PR #32 merges cleanly.
- **Clipping `--no-life`:** 0 fail, **70 warn** (was 87): ground-over-street 33, post-in-solid 10 (lamps ↔ bridges; kit collisions 0), tree-in-solid 18, floating 6, z-fight 2, structure-through-building 1.
- **Draw calls, Balanced:** at most **297 calls and 1.79 M triangles**; **High:** 8.8 km 284 / 1.98 M, 11.3 km 314 / 1.94 M, 12.0 km 321 / 1.86 M, 17.3 km 322 / 1.95 M (budget 600 / 2 M).
- **Toolbox guard** against `main` (Route 28, Going-to-the-Sun, Alpe d'Huez): object fingerprints change only for the rider (animation phase), Going-to-the-Sun's curve (intended, from round one) and the road shader on Alpe d'Huez, whose pixels are identical where both runs rendered (24.48 km). On this VM the guard's software-GL renders come out black at random in both runs, so pixel diffs are only trusted where neither side is black.

| km | calls round 1 | calls now | M tris round 1 | M tris now |
| --- | --- | --- | --- | --- |
| 0.30 | 180 | 207 | 1.11 | 1.22 |
| 0.65 | 217 | 252 | 1.48 | 1.56 |
| 1.60 | 187 | 214 | 1.21 | 1.26 |
| 2.00 | 239 | 277 | 1.44 | 1.54 |
| 2.50 | 196 | 231 | 1.34 | 1.44 |
| 3.05 | 201 | 226 | 1.32 | 1.40 |
| 3.42 | – | 205 | – | 1.37 |
| 3.90 | 163 | 192 | 1.23 | 1.33 |
| 4.60 | 193 | 230 | 1.16 | 1.22 |
| 5.60 | 191 | 228 | 1.24 | 1.31 |
| 6.60 | 140 | 163 | 1.16 | 1.27 |
| 8.80 | 235 | 267 | 1.73 | 1.79 |
| 10.70 | 161 | 197 | 1.06 | 1.15 |
| 11.30 | 250 | 287 | 1.60 | 1.62 |
| 12.00 | 258 | 297 | 1.49 | 1.53 |
| 13.10 | 196 | 230 | 1.17 | 1.22 |
| 14.60 | 185 | 223 | 1.04 | 1.04 |
| 14.80 | – | 223 | – | 1.00 |
| 15.40 | 217 | 251 | 1.19 | 1.18 |
| 16.00 | 136 | 155 | 0.89 | 1.01 |
| 17.30 | 251 | 287 | 1.54 | 1.65 |

Pictures: `finish2/round2-before-after.jpg` (round one left, now right) and `finish2/highlights.jpg` (brick, foliage, trail surface).

## Still open
- **Road meets:** 20 sites near the route, at the QC's budget (the Point ramps at 2.77–2.84 km need hand-placed deck heights).
- **Trees ↔ kit facades and furniture (24 trees):** crowns against awnings and cornices, trunks against shelters.
- **Lamps ↔ bridges (10):** posts on the McArdle girder decks and near the Fort Pitt / Mon Wharf ramps touching deck members.
- **Lamps over water at 9.76 and 15.95 km:** no street or route deck within 60 m of them; they need a close look in the preview (likely lights of a styled bridge whose deck isn't drawn).
- **Brick colour:** checked at golden hour only; check it at night and in the midday standard look.
- The M4 check with the **I** overlay (checklist above).
