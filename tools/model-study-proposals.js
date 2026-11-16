// Review proposals, not claims that the displayed geometry has been upgraded.
// Every selectable example has an individual brief; budgets are provisional.
export const proposals = {
  rider: {
    title: 'Road rider', baseline: '26,576 triangles; articulated legs, spinning crank and wheels.',
    shape: 'Round the helmet outline and shoulder caps selectively. Refine elbow bends, glove-to-bar contact and shoe shape. Give the frame readable tube junctions, a saddle nose and a compact drivetrain silhouette; avoid smoothing the whole body or bike.',
    finish: 'Keep broad jersey colour blocks and matte fabric. Use restrained roughness differences for skin, helmet, rubber and frame paint; keep facial detail minimal at riding distance.',
    behavior: 'Preserve pedal IK. Add slight breathing and effort-dependent torso motion with stable hands and hips. Check foot position, knee tracking and tyre contact through a complete pedal cycle and on grades.',
    budget: 'Keep the near rider at or below its current triangle count by removing hidden detail before refining outlines. Prototype a 4,000-triangle cyclist for other nearby riders and a 600-triangle distant silhouette; profile animation separately.',
    review: 'Inspect chase, handlebar and side views at 0, 60 and 100 rpm, including paused and uphill poses. Reject floating hands, knee/frame intersections and exaggerated bobbing.'
  },
  pacer: {
    title: 'Checkered pacer', baseline: '26,576 triangles; same rig as the rider, with a yellow-and-black jersey shader.',
    shape: 'Apply the road rider’s helmet, shoulder, glove and bicycle refinements to the shared mesh. Keep proportions consistent so the pacer reads as a fellow rider; vary helmet or socks for identity rather than duplicating the entire kit.',
    finish: 'Retain the yellow-and-black identity. Reduce distracting checks on narrow sleeves and test a larger chest/back pattern. Fade or simplify the checker pattern with distance to limit shimmering.',
    behavior: 'Preserve independent cadence and road-following pose. Smooth animation during starts, stops and changes of speed; keep visual motion consistent with simulated speed and pedal rate.',
    budget: 'Share source geometry with the rider where palettes allow; keep distinct jersey materials only where needed. Use the same proposed 4,000/600-triangle other-rider tiers and reduce rig updates at distance only if profiling supports it.',
    review: 'Compare side by side with the rider at 5, 20 and 50 m, in daylight and evening. Confirm immediate recognition, stable checks, and no visible animation snapping at LOD transitions.'
  },
  car: {
    title: 'Compact car · current', baseline: '132 triangles; box tyres and a rectangular cabin.',
    shape: 'Replace square wheels with round tyre silhouettes, cut visible wheel arches, slope front and rear glazing, and taper the roof. Add modest bumper corners, mirrors and a readable wheelbase. Preserve the 4.5 m compact body scale.',
    finish: 'Separate muted body paint, dark opaque glass, rubber and lights visually. Keep the windshield distinct from paint when applying instance tints; add broad grille and lamp shapes rather than texture decals.',
    behavior: 'Align the tyres to road grade and use correctly positioned axles. For nearby traffic, rotate wheels in proportion to speed and turn front wheels on bends; retain existing overtaking and lamp behavior.',
    budget: 'Proposed near cap: 600 triangles, with a 150–200-triangle distant version. Keep body parts merged for instancing. Separate wheel draws only if the visual gain and measured total draw cost justify them.',
    review: 'Compare against the prototype during a 5–50 m pass from front, rear and side. Check wheel clearance, glass tint, head/tail lights, road contact and silhouette stability.'
  },
  study: {
    title: 'Compact car · proposed', baseline: '346 triangles; 12-sided tyres, tapered cabin, mirrors and merged vertex colours. Wheels are static.',
    shape: 'Refine this first prototype with actual wheel-arch openings, softer hood corners and a less slab-like lower body. Try 16-sided tyres nearby and a small roof-edge bevel; keep the sloped windows and simple silhouette.',
    finish: 'Add deliberate paint/glass/rubber masks and the production aGlow light attribute. Keep lamps legible in daylight without glowing body panels at night. Retain the restrained blue-grey example paint.',
    behavior: 'Before route integration, add correct axle transforms or a cheap wheel-motion treatment, road pose and traffic tint support. The current workshop model is a static shape study and is not yet a drop-in traffic replacement.',
    budget: 'Allow up to 600 triangles for the next near version; preserve a merged instanced body and a 150–200-triangle far version. Compare the cost of wheel animation strategies before choosing one.',
    review: 'A/B against both the current 132-triangle car and the 346-triangle prototype. Require visible improvement at passing distance, valid night lamps, no paint tint on glass, and no route clipping.'
  },
  suv: {
    title: 'SUV', baseline: '132 triangles; shared box construction with a taller, longer cabin.',
    shape: 'Give it a distinct long roof, upright rear hatch, greater ground clearance and larger round tyres. Model wheel arches, a sloped windshield, short overhangs, mirrors and a small roof rail silhouette. Avoid simply scaling up the compact.',
    finish: 'Use dark lower cladding and a broad window band, with body-colour pillars and separate lamp blocks. Keep roof rails and trim in the shared muted palette; avoid shiny chrome detail.',
    behavior: 'Set wheelbase and body height independently. Fit wheel contact to slopes without exaggerated body lean, steer nearby front wheels, and keep its larger footprint in passing-clearance checks.',
    budget: 'Proposed near cap: 800 triangles; far cap: 200. Share the traffic shader and tyre geometry where practical, with merged static trim and no transparent window layers.',
    review: 'Compare side and rear silhouettes with the compact at 15 and 40 m. Check that tyres stay outside the body, rails do not shimmer, and the larger vehicle clears riders and barriers.'
  },
  rv: {
    title: 'Camper', baseline: '156 triangles; tall box body with a separate cab.',
    shape: 'Refine the cab windshield angle, soften the front roof edge and round the wheels. Make cab/body transition, wheel arches, door, mirrors and a restrained roof vent readable. Keep the large living box broad and simple.',
    finish: 'Use warm off-white body panels, a dark window band and one subdued accent stripe. Add door and storage-panel divisions with colour rather than many inset surfaces. Distinguish glass from paint tint.',
    behavior: 'Place axles and tyre contact correctly; respect the long wheelbase and rear overhang on bends and grades. Check the roof and mirrors against bridge structures and roadside clearance.',
    budget: 'Proposed near cap: 1,000 triangles; far cap: 250. Merge doors, vents and static trim into the body; reuse wheel geometry. No interior, transparent glazing or individual shadow-casting roof accessories.',
    review: 'Inspect uphill, downhill, parked and passing views. Check cab proportions, all four wheel contacts, overhang clearance and daylight/night lamp readability.'
  },
  cypress0: {
    title: 'Cypress', baseline: '1,336 triangles near / 376 distant.',
    shape: 'Create a wind-shaped asymmetric crown with two or three main lobes and a visible forked trunk. Round only the outer canopy arcs; preserve broad internal planes and a recognizably coastal, irregular silhouette.',
    finish: 'Keep muted olive foliage with lighter outer growth and darker inner masses. Add restrained bark colour variation and a slightly flared root base; avoid leaf cards and photographic bark.',
    behavior: 'Place in sheltered groves and wind-exposed coastal groups with consistent prevailing lean. Keep trunk bases anchored; sway upper branches and crown tips more than the trunk, without stretching the whole tree.',
    budget: 'Proposed near cap: 1,600 triangles; far cap: 420. Author three reusable silhouettes and instance them with bounded scale/yaw variation. Preserve major crown gaps in the far mesh.',
    review: 'Compare grove and isolated skyline views on Big Sur at 10, 50 and 150 m. Check crown gaps, root contact, restrained wind and unobtrusive near/far transitions.'
  },
  pine0: {
    title: 'Pine', baseline: '1,752 triangles near / 672 distant.',
    shape: 'Expose a longer trunk, vary the height of branch tiers, and create an open crown with uneven branch ends. Smooth the outer clump profiles selectively, retaining gaps and a silhouette distinct from the denser fir.',
    finish: 'Use warmer bark and slightly cooler needle masses with subtle sun-facing colour variation. Keep needles represented as solid clusters; avoid individual needle geometry and transparent textures.',
    behavior: 'Group mature pines with varied age and spacing on suitable rocky slopes. Anchor the lower trunk and use low-amplitude crown sway; avoid rotating whole trees in synchronization.',
    budget: 'Proposed near cap: 2,000 triangles; far cap: 700. Reuse two or three branch/crown variants and keep the sparse crown silhouette intact when simplifying.',
    review: 'Check road-level trunk visibility and skyline gaps against fir at 20–150 m. Reject repeated tier spacing, overly rounded balloon crowns, and visible LOD changes in open branches.'
  },
  broadleaf0: {
    title: 'Broadleaf', baseline: '960 triangles near / 420 distant.',
    shape: 'Replace a uniform rounded crown with an offset trunk fork and several overlapping canopy lobes of different sizes. Slightly smooth the outside contour while retaining negative spaces and faceted interior shading.',
    finish: 'Use coherent leaf colour families with darker inner lobes and lighter new growth. Preserve regional and seasonal palettes; vary whole trees subtly rather than assigning random colours to every face.',
    behavior: 'Place loose groups around moist valleys, settlements and lake edges. Add younger, narrower variants; use gentle branch-tip sway with different phases per instance and a stationary root base.',
    budget: 'Proposed near cap: 1,200 triangles; far cap: 450. Start with one improved mesh and two crown variants; keep shared materials and preserve the main asymmetry in the distant silhouette.',
    review: 'Check Route 28 road views, fall colours, grouped repetition and the 960/420 baseline versus candidate at 10, 50 and 150 m. Avoid overly smooth spherical crowns.'
  },
  fir0: {
    title: 'Fir', baseline: '1,944 triangles near / 504 distant.',
    shape: 'Keep the narrow tapered crown and pointed leader. Break regular cone stacking into staggered drooping branch skirts, with small edge gaps and a few visible trunk sections. Smooth branch-tip outlines rather than rounding the whole tree.',
    finish: 'Retain deep blue-green needles with slightly lighter tips and darker lower branch undersides. Use broad colour grouping so the tree stays readable in shadow without becoming a black cone.',
    behavior: 'Cluster on cool mountain slopes with smaller, sparser trees near the treeline. Keep the trunk still and limit wind motion to upper branches and tips; preserve the vertical leader.',
    budget: 'Proposed near cap: 2,200 triangles; far cap: 550. Keep current near/far savings near 75%; use a few shared branch-skirt variants and reduce ground-level density before enlarging distant geometry.',
    review: 'Compare dense forest and isolated treeline silhouettes in daylight and evening. Check leader shape, branch gaps, dark-value readability and near/far transitions against the 1,944/504 baseline.'
  },
  palm0: {
    title: 'Palm', baseline: '300 triangles near / 234 distant; current distant savings are modest.',
    shape: 'Give the trunk a gentle lean and taper, a clear crown attachment and longer curved fronds with varied droop. Add a few segments along frond arcs to soften their outlines without modeling individual leaflets.',
    finish: 'Use warm grey-brown trunk bands and green fronds with dry lower tips. Keep opaque broad leaf forms and sparse colour variation; avoid excessive striping or glossy plastic foliage.',
    behavior: 'Place irregular small groups on suitable coastal/island ground. Keep roots fixed and bend fronds from their attachment points, with a shared wind direction and varied phase; do not sway the entire trunk like grass.',
    budget: 'Proposed near cap: 500 triangles; far cap: 180. Preserve the recognizable frond fan while making the distant version cheaper than the existing 234-triangle mesh.',
    review: 'Check Seven Mile Bridge views from below and against the sky. Inspect frond attachment, smoothness, underside visibility, wind deformation and distant silhouette retention.'
  },
  bench: {
    title: 'Bench', baseline: '132 triangles; one merged scenery asset.',
    shape: 'Separate seat and back into readable broad slats, add narrow visible gaps, shape the leg/support brackets and soften only exposed seat/back corners. Keep plausible seat height, depth and back angle.',
    finish: 'Use warm wood faces, darker end grain and muted metal supports. Add a broad sun-faded top colour and darker ground-facing surfaces rather than small scratches, screws or photographic textures.',
    behavior: 'Seat the support feet on the overlook surface, orient the back away from the view and keep an accessible approach. Treat it as static; prevent bench placement in the riding and camera corridor.',
    budget: 'Proposed near cap: 240 triangles; far cap: 80, or cull once slat gaps are subpixel. Merge all static parts into one instanced asset and avoid a separate material for each slat.',
    review: 'Check a bench beside the rider for human scale and inspect oblique views for gaps and supports. Verify all feet touch the ground and that slats do not shimmer at distance.'
  },
  outcrop0: {
    title: 'Rock outcrop', baseline: '99 triangles; intentionally broad faceted stone.',
    shape: 'Create an irregular layered profile with one dominant fracture and a few secondary broken planes. Add modest bevels only on weathered exposed edges. Keep the angular geology and avoid smoothing it into a rounded lump.',
    finish: 'Use route-specific stone colours, darker fissures and a restrained moss/soil band near sheltered bases. Group colour by strata and exposure rather than random per-face noise; retain matte roughness.',
    behavior: 'Bury the base into terrain and align strata consistently with nearby formations. Cluster smaller companion rocks naturally. Keep collision/road-clearance proxies conservative around projections.',
    budget: 'Proposed near cap: 240 triangles; far cap: 100. Author three reusable fracture silhouettes, instance them with bounded transforms, and remove invisible buried faces where useful.',
    review: 'Check low road-camera views, steep slopes and evening light. Reject floating edges, repeated identical fracture patterns, road encroachment and a loss of the current broad-plane style.'
  },
  fern: {
    title: 'Fern', baseline: '210 triangles; small groundcover asset.',
    shape: 'Build a recognizable radial rosette with a few arched fronds of varied lengths, a tighter central growth point and tapered tips. Add segments along the main frond curve; suggest paired leaflets with silhouette cuts only on the closest version.',
    finish: 'Use a dark central stem, fresh lighter tips and restrained underside variation. Keep opaque geometry or limited double-sided leaves; avoid many overlapping transparent layers.',
    behavior: 'Place in shaded moist pockets, around logs and sheltered rock bases. Partly bury the root point, vary orientation and frond spread, and use tiny tip motion rather than making the whole plant wave.',
    budget: 'Proposed near cap: 300 triangles; far cap: 90, then cull when unresolvable. Use shared instanced clumps, cast no individual distant shadows, and watch double-sided fill cost.',
    review: 'Inspect from the normal elevated chase camera as well as close up. Check radial form, undersides, root contact, excessive overlap and whether extra leaflets are visible at riding distance.'
  },
  flowers: {
    title: 'Flowers', baseline: '308 triangles per current flower-clump asset.',
    shape: 'Separate a few prominent blooms from supporting stems and leaves. Use shallow cupped, five- to eight-sided flower heads, varied stem heights and tapered leaves. Keep petal outlines gently rounded without adding fine botanical detail.',
    finish: 'Limit each regional patch to two or three related bloom colours with warm centres and subdued stems. Vary clumps coherently; reserve saturated accents for small areas rather than uniformly bright verges.',
    behavior: 'Plant irregular patches in suitable sunny meadow/verge areas, with clear road edges and occasional gaps. Anchor stems at terrain height and sway heads slightly out of phase, with a stable base.',
    budget: 'Proposed near cap: 400 triangles per clump; far cap: 100, then cull before flowers become flickering points. Instance clumps, disable their cast shadows, and avoid transparent petal stacks.',
    review: 'Compare close and moving verge views in daylight and evening. Check bloom readability, patch colour balance, temporal shimmer and whether the denser proposal improves the image at normal speed.'
  }
};
