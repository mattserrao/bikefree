// One place for how many people are about (user, 27 Nov: "remove all pedestrians. Reduce cyclists by 50%").
//   PEDESTRIANS      false: nobody on foot — no walkers, joggers, dog walkers, strollers, locals at benches or docks,
//                    overlook visitors. (Seated stadium crowds, the players and race-day spectators are not pedestrians.)
//   CYCLIST_SHARE    the share of other cyclists kept (0.5: half as many as before), on every map and route
export const PEDESTRIANS = false;
export const CYCLIST_SHARE = 0.5;

/** A cyclist count scaled by CYCLIST_SHARE (halves round up: 5 → 3, 1 → 1; 0 stays 0). */
export const cyclists = (n) => (n > 0 ? Math.max(1, Math.round(n * CYCLIST_SHARE)) : 0);
/** A pedestrian count: 0 when nobody walks. */
export const pedestrians = (n) => (PEDESTRIANS ? n : 0);
