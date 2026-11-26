# Open items (saved 25 Nov 2026, after the production fix pass)

What's left after the 25 Nov fix pass on every production map ("Perform fix passes on all maps in production"), the QC
tool build and the scenic routes' move to the common scenery suite. None is a break a rider can't miss; each is listed
with where it is and what a fix would take. The defect ids are the QC's (`tools/qc-defects.js`: stable run to run).
Details: the Project docs `claude/production-qc.md` and `claude/qc-tooling-review.md`.

## Maps

### PGH
- [ ] **Floating flags on downtown landmarks (17)** — Frick Building (walls 93 m up), Benedum Center, Andy Warhol
  Museum, Heinz History Center, Allegheny County Jail & Courthouse, Station Square P&LE terminal, the Zoo entrance, the
  Korean War Veterans Memorial. Flagged from sweep sites 1–2 km away; close-ups all look right. Most likely the QC: the
  support meshes aren't built at that distance (see QC below). Confirm with a site at each landmark.
- [ ] **Edge lips (8)**
  - Panther Hollow trail (40.4391,-79.9423; 40.4372,-79.9452; 40.4376,-79.9469): the trail on a 3 m embankment, an
    unnamed mesh ~1 m over it beside the path — identify the mesh (trail bank? fill skirt?).
  - Station Square plaza edge, Terminal Street (40.43046,-79.99651): +0.9–1.0 m.
  - Zoo road (40.48128,-79.91754; 40.4817,-79.91677): +0.25 / +0.52 m.
  - Banksville Road (40.4154,-80.03013): a storefront at a primary road's curb, no sidewalk (+2.3 m).
- [ ] **Sharp corners (7)** — wide 131–138° path/road corners where no curb radius fits the arms (e.g. 40.47838,-80.01955;
  40.44049,-79.99157; 40.43932,-79.97299; 40.39038,-79.93455). Needs a return that may shorten an arm's mouth, or a
  join piece for very short arms.
- [ ] **Blocky land-cover water** at the Zoo (40.4833,-79.9183): water drawn as 4 m cover cells. PGH's water is cover,
  not outlines like NYC's pools.

### NYC
- [ ] **Grass gores between diverging drives** (edgeLip-pk933d at 40.79794,-73.95424, +0.33 m; edgeLip-26p912 at
  40.7682,-73.97073, +0.18 m): two drives at different grades with a raised grass wedge between them. Fix: blend the
  two ways' heights near the fork, or fill the gore to the lower road.
- [ ] **A 41° drive/drive fork** (sharpCorner-rzelyp, 40.76953,-73.97224): arms too short for any return.

### CNY
- [ ] **A 123° path/residential corner** (43.06999,-76.27687) on a very short arm.

### Endless
- [ ] **Edge-ditch threshold**: the gravel shoulder's own drop is 0.3–0.6 m; the check's 0.6 m limit catches near-misses
  (0.6–0.85 m, e.g. 9870 m, 49620 m). Raise to 0.9 m or measure past the shoulder.
- [ ] **A home's roof detail flagged floating** (53070 m, 5.9 m up): the check takes the detail mesh's lowest point; roof
  details (chimneys, dormers) start high by design. Judge detail meshes against the home's walls instead.
- [ ] Lakes that would sit over a metre under their station's level are now left out — check the lake count per biome
  didn't drop too far.

### Alpe d'Huez
- [ ] **The preview spot faces a dark cliff with a few floating rocks** (there before the suite migration; the midday
  baked light makes the north-facing wall darker). Move the preview spot, or lift the cliff's ambient.

## QC tools
- [ ] **Build a landmark's near model before judging it** — the floating check from far sweep sites flags pieces whose
  supports aren't built there (PGH's 17). Prepare landmarks within the check radius, or judge floating only within
  ~600 m of the camera and place sites at the landmarks.
- [ ] **Finer sweeps** — PGH was swept every 3 km and SKAN every 5 km (one evening on a 2-core box). A 600 m overnight
  sweep: PGH 231 sites, SKAN 634, CNY 229 (`npm run qc:map -- <map> --sweep`).
- [ ] **Faster sites** — each site reloads the page and rebuilds the world (~2–5 min on a software GPU). Reuse one page
  and move the rider between sites.
- [ ] **More fixers** — only `viewBlocked` has one. The other faults come from code or generated geometry with no data
  knob to patch: each needs a data field first (a landmark's base offset, a pool's bank inset, a fork's blend).
- [ ] **Clipping checks on graph maps and Endless** — `tools/qc-clipping.js` (rider/camera clipping, z-fighting) still
  runs only on the route scenes.
- [ ] **Not picked yet** (claude/qc-tooling-review.md): pixelmatch in the toolbox guard, deterministic `--frozen` QC runs,
  SARIF output, three.js devtools registration in the preview pages.
- [ ] **Re-record the toolbox guard baselines** — soft cover edges on every map, the new curb returns and bend joins,
  and the scenic routes' suite migration all change shots on purpose.

## Generated data
- [ ] The fixer's view corridors are also written into the generators (`tools/nyc_heroes.py`, `tools/pgh_heroes.mjs`,
  `tools/skan_heroes.py`, `QC_VIEWS`). A future fixer run should add to those lists the same way.
