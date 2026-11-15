# Route 28 · Old Forge to Eighth Lake — scenery review

Test branch: `route28-test`. Scene: `routes/scenes/route28.json`, GPX: `routes/parks/route28.gpx` (28.6 km out, then back).

![Inlet sign, 18.4 km — current state](inlet-before.png)

*At the Inlet sign (18.4 km) you see open meadow, lupine and a few scattered trees. There is no village and no lake. The real spot is the head of Fourth Lake, in the middle of a village.*

## What's wrong, measured

### 1. The lakes are in the wrong places
The scene describes each lake as an ellipse (centre plus two radii). Checked against the GPX:

| Lake | Problem |
| --- | --- |
| **Second Lake** | The road runs **through** the ellipse, 290 m from its centre (10.7 km), so the terrain code turns it into a causeway. |
| **Eighth Lake** | The ellipse centre is **20 m from the turnaround**, so the rider U-turns in the middle of the lake. |
| **Fourth Lake** | Modelled as 3.8 × 1.3 km. The GPX sits at lake level (528–538 m) for about 9 km, from 8.5 to 18 km, so the real shoreline is several times longer than the model. |
| **First / Sixth / Seventh** | Their nearest edges are 100–700 m off the road. With trees in between, they're never seen. |
| **Missing** | Old Forge Pond (beside the start), Third Lake and Fifth Lake. |

Ellipses can't make bays, points, narrows or islands, and those shapes are what make the Fulton Chain look like itself.

### 2. The mountains are just gentle rolling ground
`reliefM: 45` gives soft sine-wave swells about 2–3 km apart. There are no individual hills. The real road runs low between forested hills that rise 150–300 m above the lakes, and the hills are what close in the view. Real elevation data only takes over beyond 1.5 km, and only when you're online. Inside 1.5 km everything stays nearly flat.

### 3. The trees are too few and the wrong kinds
- **Density:** 230 candidate spots per 192 m tile × `density 1.15` × `treeDensity 0.38` × the grove mask works out to roughly **20–25 trees per hectare**. That's parkland. A northern hardwood or conifer forest reads as a solid wall.
- **Range:** trees are only placed within about 3 tiles (~600 m), so the hills behind look bare.
- **Shapes:** `fir` is a stacked-disc cone of 14–17 m and `broadleaf` is a lollipop. Placed one by one in the open, both look like ornamental yard trees, which is why the scale feels off.
- **Ground cover:** lupine and alpine flowers are West Coast or alpine plants. An Adirondack roadside has mown grass, ferns, goldenrod, low blueberry, moss and granite boulders.

### 4. No towns
The asset kit has **no buildings at all**: no houses, camps, docks, boats, utility poles or mailboxes. So Old Forge (0 km), Inlet (18.4 km) and the camps along the lakes can't be drawn yet.

### 5. Why it feels empty
The whole ride looks the same: open meadow with a few trees and a far horizon. Route 28 works the other way. You ride through a dark tunnel of forest, then it suddenly opens onto the lake, then a village, then forest again. That rhythm is missing.

### 6. One thing to check: is the GPX on the right road?
Between 4 and 6 km the GPX dips south to 43.704° N, then follows the lakes at water level along roughly 43.72–43.75° N. It never goes near Eagle Bay. That's the shape I'd expect from **South Shore Road**. Route 28 itself runs further north, through Eagle Bay. I couldn't load map data here to confirm this, so please check it on a map before investing in the art. If the route is wrong, rebuild it with a waypoint at Eagle Bay.

## Ideas, in priority order

### A. Real shorelines *(biggest impact on "where are the lakes")*
- Add `lakes[].outline` to the scene format: OpenStreetMap `natural=water` polygons, fetched at build time by `tools/build_park_routes.py` through Overpass and simplified to about 20 m. Keep the ellipses as a fallback for other routes.
- Draw the water with a `ShapeGeometry`, and carve the terrain by distance to the polygon edge instead of the ellipse radius.
- New QC check, `road-in-lake`: fail if the GPX crosses water anywhere that isn't a bridge range. That would have caught Second Lake and Eighth Lake.
- Add small wooded islands where OpenStreetMap has them.
- *Note:* Overpass is blocked from this cloud workspace, so the fetch has to run on your Mac (or as a GitHub Action).

### B. A real Adirondack forest *(biggest impact on feel)*
- **New kit trees** (`tools/build_regional_assets.py`):
  - white pine, 25–32 m, with ragged crowns that stick up above the canopy. This is the signature silhouette.
  - red spruce or balsam fir, as narrow dark spires
  - hemlock
  - sugar maple
  - paper birch, whose white trunks read clearly from the road
- **Canopy at 18–24 m** with white pines sticking out above it. Trees should be close enough that the crowns touch.
- **Forest-edge layout** instead of random scatter:
  - 0–4 m from the road: shoulder
  - 4–8 m: mown grass strip
  - 8–12 m: saplings, shrubs and ferns
  - beyond 12 m: dense trees, about 150–250 per hectare in the near band
- Inside the forest, cut ground cover and draw a darker floor (needles and shade). That saves the triangle budget for trees.
- **Hills beyond tree range:** add a canopy texture to the ground shader (dark green mottling in a bumpy pattern) and a cheap billboard treeline along ridge crests, so distant hills look forested instead of bald.
- **Optional fall palette:** add `season: "fall"` to tint maples red and orange and birches yellow. It would be the showpiece version of this route.

### C. Hills that frame the road
Use the existing `formations` system (already used on Teton and Yosemite), with `shape: "dome"` and heights of 150–250 m. Place them 0.6–2 km off the road:
- Bald Mountain (Rondaxe), with its fire tower, above the north side near the start
- Black Bear Mountain near Inlet
- Seventh Lake Mountain north of Seventh Lake

Give each a few exposed granite ledges (cliff colour on the steep faces) and a fire-tower landmark asset. Raise the base `reliefM` a little, to 60–80, so the road feels like it's in a valley.

### D. Towns and camps
- Add a `towns` block to the scene format: `{ name, fromM, toM, side, style: "village" | "camps" }`.
- **Village:**
  - clapboard and log-sided buildings 12–25 m back from the road, with gable roofs and porches
  - general store, church steeple, motel row
  - sidewalk, parking, utility poles, a 30 mph sign
  - Old Forge at 0–1.5 km, Inlet around 17.8–19 km
- **Camps:** cabins every 60–150 m along the lakeside sections, each with a dock and a boathouse. The whole Fulton Chain is lined with them.
- **Blender kit:** 5–6 building variants, a dock, a boathouse, canoe and motorboat props, a mailbox and a utility pole.

### E. Things along the road
- utility poles and wires (one of the strongest realism cues on any rural road)
- driveways with mailboxes
- yellow curve and deer-crossing signs
- brown Adirondack trailhead signs
- steel guardrails on lake-side fills
- snowmobile trail markers on trees
- Remove the lookout sign and roadside rail at 21.6 km unless the lake really shows from there.

### F. Life and light
- **Water:** darker, tea-coloured water that reflects the treeline. Boats and canoes drifting, and an occasional loon.
- **Light:** morning mist lying on the lakes, and a low golden-hour sun angle as a preset for this route.
- **Traffic:** now and then a car, or another cyclist.

## Suggested phases on this branch
1. **Fix geography:** check the GPX road (6); add shorelines and the `road-in-lake` QC check (A).
2. **Build the forest:** new trees, edge layout and far canopy (B).
3. **Add terrain:** hills and the fire tower (C).
4. **Add towns:** Old Forge, Inlet and the camps (D).
5. **Final polish:** roadside props, water, light and life (E, F).
