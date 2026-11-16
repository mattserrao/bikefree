# Wave 2 — common rules (coordinator, 16 Nov 2026)

You are one of six wave-2 agents on the Pittsburgh route of "bikefree": a free indoor-cycling Chrome web app with three.js scenery and Python/Node build tools. I'm the coordinator; I merge everyone's branch onto `pittsburgh-detail-test` and open one PR.

**Read first, in your worktree:**
- `docs/pittsburgh/detail/OPEN.md`: the open items and the plan. Your item number is in your prompt.
- `docs/pittsburgh/detail/BRIEF.md`: wave-1 decisions and rules.
- The wave-1 notes for the systems you touch: `s1.md` (baked lighting), `s2.md` (junctions and road meets), `s3.md` (street & facade kit), `s4.md` (road alignment).
- `ROUTES.md`: the tools — `npm run snap`, `snap:cam`, `qc`, `qc:clipping`, and the `--breakdown` option.

**Decisions that still hold:**
- The current hero look, with fixed lighting and baked shadows.
- Golden hour is the one baked time.
- Budget: under 600 draw calls and 2 M triangles at every spot on Balanced and High, 60 fps at 1.5× pixel ratio, no frame over 25 ms.
- Everything you build is route-agnostic and reusable.

**Setup:**
- Your worktree starts at `d6d65d5`: all four wave-1 agents merged. node_modules and the OSM cache are symlinked in.
- The committed `routes/scenes/pittsburgh-city.json` and `routes/cities/pittsburgh.gpx` are stale. Run `python3 tools/build_city.py pittsburgh` first (about 20 s). Never commit those two files, `sw-assets.js`, `js/version.js`, package.json's version, `PLAN.md` or `docs/pittsburgh/REVIEW.md`.
- Set `export CHROME=/opt/pw-browsers/chromium-1255/chrome-linux64/chrome CHROME_PATH=$CHROME`.
- Six agents share 2 CPUs. Run every headless-Chrome job through `flock /tmp/bikefree-chrome.lock <cmd>`. Use `--size 960x540` and short shot lists while iterating, and never keep Chrome jobs running in the background after you finish.
- References: baseline shots in `/home/claude/baseline/`, and integrated shots of the same 18 spots in `/home/claude/after/` (each folder has a `snapshots.json` with draw calls and triangles). Integrated QC: clipping `--no-life` 0 fail, 85 warn (`/home/claude/after-clipping.json`).

**Who owns what** (stay in your lane; anything outside it gets a small edit tagged `// [w2-<you>]`, listed in your report):

| Agent | Owns |
| --- | --- |
| budget (#1) | chunk building and merging in `city.js`; any far-city mesh |
| meets (#2) | `road-meets.js`, `junctions.js`, `junction-mesh.js`, and the deck clearance and deck-end heights in `tools/citylib/road_align.py` |
| clip (#3) | `tools/qc-clipping.js`, `tools/qc_clipping.mjs`, fixes for findings not in another agent's files |
| bake (#5) | `baked-light.js` and its hooks |
| align (#6) | `road-align.js` (runtime), `js/gpx.js` elevation smoothing, the far ground mesh, the curve on other routes |
| polish (#7) | lamps, `city-heroes.js`, the street-kit labels and cars, the time-of-day menu, small data fixes |

**Working rules:**
- Commit in small steps in your worktree. Don't push, and don't touch other worktrees.

**Before you finish:**
- Run `npm test`, `npm run qc -- --strict` (whole catalog) and `npm run qc:clipping -- --no-life`.
- Take before/after shots of what you changed.
- Write `docs/pittsburgh/detail/w2-<you>.md`: what changed, numbers, pictures, how-to, what's left.

**Final message to me (under 350 words):**
- your commits
- what changed, with before/after numbers
- QC results
- every edit outside your lane
- what's still open
