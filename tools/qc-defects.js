// Defect evidence for the map QC (tools/qc-map.js, tools/qc-endless.js, tools/qc_map.mjs): each fault a check finds
// becomes a defect with a stable id — the check and the 4 m cell it falls in, hashed — so the same fault keeps its id
// from run to run (a fix makes it disappear; a new one shows up as new), and a close-up camera for its evidence shot.
//
//   defectId('floating', x, z)          → 'floating-3k9x1a'
//   closeup(defect)                     → a tools/snap_pgh.mjs camera spec: 14 m off, 7 m up, looking at it
//   diffDefects(before, after)          → { fixed: [...ids], added: [...ids], kept: [...ids] }
const CELL = 4;

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(6, '0').slice(-6);
}

/** A defect's stable id: the check and the cell it falls in. */
export function defectId(check, x, z) {
  return `${check}-${hash(`${check}:${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)}`;
}

/** A close-up camera for a defect on a graph map, from its lat/lon alone: the eye `back` m to the south-east and `up` m
 *  over the ground there, looking at the fault 1 m up (snap_pgh's `#eyeLat,eyeLon,up,lookLat,lookLon,up` spec). */
export function closeup(d, { back = 14, up = 7 } = {}) {
  const [la, lo] = d.at, m = 1 / 111320;
  const eLat = la - back * 0.8 * m, eLon = lo + back * 0.6 * m / Math.cos(la * Math.PI / 180);
  return `${eLat.toFixed(6)},${eLon.toFixed(6)},${up},${la},${lo},1`;
}

/** What changed between two runs' defect lists (by id). */
export function diffDefects(before, after) {
  const a = new Set(before.map((d) => d.id)), b = new Set(after.map((d) => d.id));
  return { fixed: [...a].filter((i) => !b.has(i)), added: [...b].filter((i) => !a.has(i)), kept: [...b].filter((i) => a.has(i)) };
}
