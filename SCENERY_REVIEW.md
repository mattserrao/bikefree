# v0.11.1 scenery review

The ten scenic routes now use the selected stylized 3D direction. The GPX controls
the riding surface and elevation profile; the surrounding terrain is an artistic
interpretation, as requested. Scene definitions live in `routes/scenes/`.

| Route | Review and resulting treatment | Next visual refinement |
| --- | --- | --- |
| Big Sur | The bridge needed a readable structure and the coast needed close detail. Added a fitted arch bridge, creek, cliff strata, coastal groves, flowers, signs, viewpoints and sea stacks. | More individually authored coves and landmark silhouettes. |
| Yosemite | A generic green landscape did not convey a granite valley. Added steep valley walls, dome formations, the Merced River, fitted crossings and mixed forest. | Refine the El Capitan and Half Dome silhouettes with dedicated meshes. |
| Acadia | The coastal forest needed a distinct identity. Added an eastern shoreline, granite headland, ponds, mixed canopy and woodland cover. | More irregular pond margins and denser forest pockets away from the road. |
| Grand Teton | The road needed a strong alpine backdrop. Added peak formations, elevation-dependent snow, lakes, river crossings and fir groves. | Sharper individual summit profiles and richer distant mountain layers. |
| Crater Lake | Water and the caldera should dominate the view. Added a large blue basin, rim relief, Wizard Island and sparse alpine vegetation. | Replace the elliptical basin with a hand-shaped shoreline. |
| Monument Valley | Repeated grassy hills did not suit the route. Added sandstone mesas, desert ground, sage and yucca with an open horizon. | Individually modeled mitten spires and more varied erosion shapes. |
| Going-to-the-Sun | Alpine scale and vegetation changes needed emphasis. Added mountain formations, high-elevation snow, a treeline and Lake McDonald. | More detailed ridge silhouettes and named roadside landmarks. |
| Zion | The canyon needed enclosure and warmer material detail. Added steep sandstone walls, layered stone, the Virgin River and broadleaf pockets. | More irregular canyon-wall profiles and stronger riparian grouping. |
| Seven Mile Bridge | A road floating above water was insufficient. Added repeated fitted pier spans, railings, a parallel old bridge, turquoise water, islands and palms. Corrected terrain grading so it does not create land beside bridge spans. | A dedicated old-bridge asset and individually shaped island shorelines. |
| Route 28 | The route needed a forest-and-lake character. Added six lake basins, mixed fir/broadleaf canopy, flower verges and destination signs. | More densely grouped forest and smaller roadside buildings. |

These are complete first regional passes using the shared system. Bespoke
landmark meshes and irregular shorelines would be the most useful next art pass.

## Validation

- All ten route previews rendered in Chromium with bundled assets and no scenery or shader errors.
- Automated tests cover GPX lengths, grades, lap/turnaround behavior, road clearance,
  water levels, bridge fitting, model vertex streams, and cheaper distant tree meshes.
- Light, Balanced and High settings were checked in the preview; the app persists the selection.
- The app and standalone preview loaded without external scenery requests. The
  service-worker cache contains 60 files and supports offline reload.
- The main app displays v0.11.1 and starts a demo ride with the selected detail setting.

Browser rendering here uses a software GPU. Sustained frame rate, temperature,
Retina display load and trainer/handlebar Bluetooth still require an M4 Air ride.
Balanced is the initial setting; Light lowers density and disables cast shadows.

See [ROUTES.md](ROUTES.md) for the GPX-plus-configuration workflow and Blender build commands.

## v0.11.2 — real horizon

Beyond ~1.5 km the real elevation and USGS aerial photos now replace the stylized
ground, colour-matched to each route's palette (needs internet; offline stays fully
stylized). Up close nothing changes. Reviewed from the road on Monument Valley (real
mesas south of the visitor center), Going-to-the-Sun (Glacier peaks) and Big Sur
(coastal hills and ocean).
