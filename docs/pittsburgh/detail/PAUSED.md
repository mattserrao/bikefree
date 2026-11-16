# Wave 2: paused 16 Nov 2026, 17:45, and how to resume

All five running wave-2 agents were stopped by request so a PR could go up. Each agent's branch is pushed to `origin`. "In PR" below means the PR includes that branch's verified commits; WIP commits stay on the branch only.

| # | Agent / branch | Head | In PR | Done | Left (to resume) |
| --- | --- | --- | --- | --- | --- |
| 1 | budget · `w2-budget` | `44c635b` | all | Static meshes merged per 960 m sector (buildings with rooftops, streets, walks, paths, lamps, trees). Lamp posts drawn only within 600 m (Balanced; 420 Light, 800 High). Tree trunks 35 → 30 triangles. `snap --breakdown` counts the real frame. | Fill the before/after table in `w2-budget.md` (Balanced at the 18 spots; High at the worst three; night). Confirm every spot ≤ 520 calls. |
| 2 | meets · `w2-meets` | `6106a76` | all (finished) | Issues near the route 82 → 19. `road-meet` warns past 20. Contact sheet re-rendered. | See OPEN.md: Point ramps 2.81–2.84 km, lips at 2.51/15.75 km, a few overlaps and steps. |
| 3 | clip · `w2-clip` | `b452517` | up to `8d814ba` | The z-fight check skips surfaces that cross. Ground-over-street only counts what the ride can see (hidden cases become info). Kit lot stalls lie on the asphalt, walks don't fold back, scatter stays off kit walks and lots. Merged w2-meets. | WIP `b452517` (street-kit changes) is unverified. Next: the ride-visibility filter for ground-over-street, triage of the remaining 39 ground-over-street / 9 post-in-solid / 6 floating, a full life run, then `w2-clip.md` (not written yet). |
| 5 | bake · `w2-bake` | `b7a6330` | all | First bake behind the loader with programs compiled ahead. One frame drawn under the loader. Re-bakes sliced across frames. Bake cost shown in the **I** overlay. `tools/ride_frames.mjs` gives headless ride frame times with a real GPU sync. | It was wiring the `world.js` hooks for the calibration. Next: measured before/after (worst frame, p95, bake ms per frame over 0–3 km and 8–10 km), a check that Route 28 is unchanged, and `w2-bake.md` with the M4 pass criteria (not written yet). |
| 6 | align · `w2-align` | `93fbb91` | **no** | The crest sits on its ground (elevation smoothing per route, profile from the drawn line). The ground mesh stays off steep streets and away from bridges (the jagged edge north of McArdle). Curved centre line on for Going-to-the-Sun, with adaptive ribbon density. Draft notes and pictures in the branch. | **Left out of the PR:** merged on top of w2-meets it fails 3 tests (`junction 740 over the road`, road-meet near-route sites over 20, the strict catalog QC). The new route profile moves the road under the meets builder's deck ends and junctions. Next: rebase `w2-align` onto `pittsburgh-detail-test`, rebuild, re-tune where the profile and deck ends meet, and get `npm test` green. Then finish the Route 28 trial and the notes. |
| 7 | polish · `w2-polish` | `815bc86` | up to `ecbfaec` (+ pictures) | Time menu shows only baked time + night for baked scenes. Neighbouring shop signs differ. Parked cars with wheels, cabin and glass (two LODs, one call). PPG spires are pale two-tone glass. Granite fountain basin with jet. Five-sided Blockhouse. Pictures in `w2-polish/`. | WIP `815bc86` (bridge deck slab faces wound outwards, so lamps on the edge stand on it) is unverified: verify, then keep. Still to do: floating lamps (6 in the clipping QC), the street under the trail at 1.50 km, and `w2-polish.md`. |

Item #4 (kit route-wide + junction corners) was not started.

**State of the PR branch:**
- `npm test` 109/109
- course QC `--strict`: all 12 routes clean
- `routes:check` clean
- clipping `--no-life`: 0 fail, 61 warn (baseline 91, wave 1 85). By category: floating 6, ground-over-street 39 (+12 hidden, info), post-in-solid 9, structure-through-building 1, z-fight 6

**To resume an agent:**
1. Check out its branch from `origin` into a worktree.
2. Symlink `node_modules` and `tools/.cache` into it.
3. Hand it `/home/claude/wave2-common.md` (or this table) and its row here.
