# Model realism study

Branch: `test/model-realism-study`. This is an isolated asset workshop; the riding
scenes continue to use their existing models. No downloaded art or new runtime
dependencies are required.

## View the examples

Run `npm start`, then open <http://localhost:8000/tools/model-study.html> in Chrome.
Select an asset, drag to orbit, scroll to zoom, and compare daylight with warm
evening light. Pause the turntable for silhouette inspection. Tree detail switches
between the actual near and distant meshes. Wireframe exposes the geometry cost;
the panel reports model triangles and dimensions in metres. Each asset is framed
to fit, so apparent on-screen size does not indicate relative physical scale.

The preview includes the road rider, checkered pacer, compact, SUV, camper,
cypress, pine, broadleaf, fir, palm, bench, outcrop, fern and flowers. These are the
actual bundled models. The **proposed compact** is new procedural geometry in
`tools/model-study-assets.js`: round twelve-sided tyres, a tapered cabin with
sloped glazing, mirrors, roof and lights, merged into one vertex-colour mesh.
It is a static model proposal; wheel animation, traffic light attributes and
per-instance paint masking need integration before adopting it in traffic.

## Art direction to preserve

Keep faceted forms, restrained region-specific colours, readable jersey accents,
soft directional light and authored silhouettes. Gain realism through scale,
pose, contact and material response before adding polygons or photographic
textures. Inspect at the normal chase and handlebar cameras as well as close up.

## Proposals, ordered by value

| Area | Proposed next pass | Cost and validation |
| --- | --- | --- |
| Nearby cars | Use the compact prototype to assess sloped cabin forms and round tyres. Give SUVs/campers distinct proportions; preserve opaque, simple glazing. | Prototype budget: ≤500 triangles, one merged mesh. Retain current distant shapes; test passing at 5–50 m. Add existing `aGlow` light semantics and paint masking before integration. |
| Bikers | Keep current pedal IK. Improve shoulder/elbow alignment, hand contact and helmet silhouette; add subtle effort-driven torso movement rather than a fixed bob. | Reuse rig and palette. Reserve full rig for rider, pacer and closest cyclists; batch simple distant cyclists. Check hands on bars and feet on pedals through a full crank cycle. |
| Trees | Author 2–3 asymmetric branch/canopy variants per species, with region-specific grouping and bounded scale/yaw variation. | Retain shared geometry and instancing. Existing cypress LOD: 1,336 → 376 triangles (72% fewer); fir: 1,944 → 504 (74% fewer). Evaluate transitions by projected size, with hysteresis. |
| Ground contact | Fit tyre contact and tree/rock bases to sampled terrain; partially bury stones and root bases. Use contact shadows only where they are visible. | Check steep slopes, bridge decks and overtaking; avoid new per-object shadow passes. Verify road and camera clearance with existing clipping QC. |
| Other scenery | Group grass, ferns, rocks and flowers by moisture, elevation and shelter. Add a few authored roadside signs, logs and fence segments. | Share materials, instance by spatial chunk, suppress tiny objects in Light detail. Prefer stronger placement over blanket density. |
| Materials/light | Use broad roughness differences: matte leaves/cloth, smoother glass/paint, rough stone. Match new vertex colours to the existing linear-colour pipeline. | Avoid texture maps until a road-view comparison demonstrates value. Compare daylight, evening and rain without crushed darks or plastic foliage. |
| Landscape | Prioritize route landmark silhouettes and irregular shorelines, consistent with `SCENERY_REVIEW.md`. | Spend triangles on recognizable skyline breaks. Keep distant terrain simpler and preserve offline fallback. |

## Optimization and adoption gates

Measure before changing quality defaults. Reuse `npm run snap -- --software ...`
for repeatable visual captures and draw-call/triangle counts, and `npm run qc`
plus `npm run qc:clipping` after adopting assets in routes. Run `npm test` and
`npm run routes:check` for regressions.

For each candidate compare the same route position, time, weather, viewport and
detail level against the current version. Record frame-time median and p95,
draw calls, triangles and resource usage after warm-up. Check a dense forest,
city, bridge approach and passing vehicle. Proposed target on the documented M4
Air / Chrome platform: 60 fps Balanced (16.7 ms frame budget), with sustained
rides to expose thermal throttling. This is a target, not a measured result.

Keep the full rider rig out of distant traffic. Keep merged instanced car batches
rather than one mesh for each window/wheel. Use spatially bounded scenery batches
for culling; consider chunking traffic only if profiling its current small agent
window shows meaningful waste. Cap pixel ratio before reducing distinctive model
silhouettes. Distant LOD should save GPU work without visible popping.

## Decisions still open

- Confirm Chrome on Mac/M4 Air as the main performance target, or specify others.
- Choose the realism limit: current faceted look with better proportions, or
  somewhat smoother silhouettes nearby.
- Which route should be the first in-world trial, and which biker/car references
  best match the intended setting?
- Are cyclists exclusively road riders, or should commuter, gravel and other
  body/bike types be represented?

Only the standalone workshop and compact example are implemented here. The
broader rider, placement, LOD and lighting changes above remain proposals.

## Workshop validation

- All 17 Node test files passed, including the compact's geometry/budget check.
- Route manifest regenerated; `npm run routes:check` passed for all 11 routes.
- Chromium with software WebGL rendered all 15 examples without console or page
  errors; also checked fir distant mesh, wireframe, warm light and mobile layout.
- Compact prototype: 346 triangles versus 132 for the current compact. These are
  geometry counts, not an on-device performance claim.

![Proposed compact in the working model viewer](model-study-compact.png)
