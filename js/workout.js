// Structured workouts: .zwo (Zwift), .erg (watts) and .mrc (% FTP). Pure functions (tested in Node).
//
// A workout is { name, description, segments: [{ start, duration, from, to, unit, kind, label }] }
//   unit: 'ftp' (fraction of FTP) or 'w' (absolute watts)
//   kind: 'erg' (trainer holds the target) or 'free' (normal shifting)

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : undefined;
};
const num = (tag, name, def) => {
  const v = parseFloat(attr(tag, name));
  return Number.isFinite(v) ? v : def;
};

function finalize(name, description, raw) {
  let t = 0;
  const segments = [];
  for (const s of raw) {
    if (!(s.duration > 0)) continue;
    segments.push({ ...s, start: t });
    t += s.duration;
  }
  if (!segments.length) throw new Error('This workout has no steps');
  return { name: name || 'Workout', description: description || '', segments, duration: t };
}

/** Parse a Zwift .zwo workout. */
export function parseZwo(text) {
  const name = (text.match(/<name>([\s\S]*?)<\/name>/) || [])[1]?.trim();
  const description = (text.match(/<description>([\s\S]*?)<\/description>/) || [])[1]?.trim();
  const body = (text.match(/<workout>([\s\S]*?)<\/workout>/) || [])[1];
  if (!body) throw new Error('No <workout> section found');
  const raw = [];
  const re = /<(Warmup|Cooldown|SteadyState|Ramp|IntervalsT|FreeRide|MaxEffort|SolidState)\b([^>]*?)(\/>|>[\s\S]*?<\/\1>)/gi;
  let m;
  while ((m = re.exec(body))) {
    const type = m[1].toLowerCase();
    const tag = m[2];
    const dur = num(tag, 'Duration', 0);
    if (type === 'warmup' || type === 'cooldown' || type === 'ramp') {
      const lo = num(tag, 'PowerLow', num(tag, 'Power', 0.5));
      const hi = num(tag, 'PowerHigh', num(tag, 'Power', lo));
      const label = type === 'warmup' ? 'Warm up' : type === 'cooldown' ? 'Cool down' : 'Ramp';
      raw.push({ duration: dur, from: lo, to: hi, unit: 'ftp', kind: 'erg', label });
    } else if (type === 'steadystate' || type === 'solidstate') {
      const p = num(tag, 'Power', num(tag, 'PowerLow', 0.6));
      raw.push({ duration: dur, from: p, to: p, unit: 'ftp', kind: 'erg', label: 'Steady' });
    } else if (type === 'intervalst') {
      const reps = Math.max(1, Math.round(num(tag, 'Repeat', 1)));
      const on = num(tag, 'OnDuration', 0), off = num(tag, 'OffDuration', 0);
      const onP = num(tag, 'OnPower', num(tag, 'PowerOnHigh', 1));
      const offP = num(tag, 'OffPower', num(tag, 'PowerOffLow', 0.5));
      for (let i = 1; i <= reps; i++) {
        raw.push({ duration: on, from: onP, to: onP, unit: 'ftp', kind: 'erg', label: `Interval ${i}/${reps}` });
        raw.push({ duration: off, from: offP, to: offP, unit: 'ftp', kind: 'erg', label: `Recover ${i}/${reps}` });
      }
    } else {
      raw.push({ duration: dur, from: 0, to: 0, unit: 'ftp', kind: 'free', label: type === 'maxeffort' ? 'Max effort' : 'Free ride' });
    }
  }
  return finalize(name, description, raw);
}

/** Parse .erg (MINUTES WATTS) or .mrc (MINUTES PERCENT) files. */
export function parseErgMrc(text) {
  const header = (text.match(/\[COURSE HEADER\]([\s\S]*?)\[END COURSE HEADER\]/i) || [])[1] || '';
  const name = (header.match(/^\s*(?:DESCRIPTION|FILE NAME)\s*=\s*(.+)$/im) || [])[1]?.trim();
  const unitsLine = (header.match(/^\s*MINUTES\s+(\w+)/im) || [])[1]?.toUpperCase() || '';
  const percent = unitsLine === 'PERCENT' || /\.mrc\b/i.test(name || '');
  const data = (text.match(/\[COURSE DATA\]([\s\S]*?)\[END COURSE DATA\]/i) || [])[1];
  if (!data) throw new Error('No [COURSE DATA] section found');
  const pts = data.trim().split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((a) => a.length >= 2 && a.every(Number.isFinite));
  if (pts.length < 2) throw new Error('Not enough data points');
  const raw = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [m0, v0] = pts[i];
    const [m1, v1] = pts[i + 1];
    const dur = (m1 - m0) * 60;
    if (dur <= 0) continue;
    raw.push(percent
      ? { duration: dur, from: v0 / 100, to: v1 / 100, unit: 'ftp', kind: 'erg', label: v0 === v1 ? 'Steady' : 'Ramp' }
      : { duration: dur, from: v0, to: v1, unit: 'w', kind: 'erg', label: v0 === v1 ? 'Steady' : 'Ramp' });
  }
  return finalize(name, '', raw);
}

export function parseWorkout(text, filename = '') {
  if (/<workout_file|<workout>/i.test(text)) return parseZwo(text);
  if (/\[COURSE DATA\]/i.test(text)) {
    const w = parseErgMrc(text);
    if (/\.mrc$/i.test(filename) && w.segments[0].unit === 'w') {
      for (const s of w.segments) { s.unit = 'ftp'; s.from /= 100; s.to /= 100; }
    }
    return w;
  }
  throw new Error('Unrecognized workout file (expected .zwo, .erg or .mrc)');
}

export function segmentIndexAt(workout, t) {
  const segs = workout.segments;
  if (t >= workout.duration) return -1;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Target watts for a segment at time t (null for free segments). */
export function targetWatts(seg, t, ftp, bias = 1) {
  if (!seg || seg.kind !== 'erg') return null;
  const f = Math.max(0, Math.min(1, (t - seg.start) / seg.duration));
  const v = seg.from + (seg.to - seg.from) * f;
  return Math.round((seg.unit === 'ftp' ? v * ftp : v) * bias);
}

/** Intensity as a fraction of FTP (for zone colours). */
export function segIntensity(seg, ftp) {
  const avg = (seg.from + seg.to) / 2;
  return seg.unit === 'ftp' ? avg : avg / ftp;
}

export function zoneColor(pct) {
  if (pct <= 0) return '#5b6275';
  if (pct < 0.6) return '#7f8aa3';   // Z1
  if (pct < 0.76) return '#3b8beb';  // Z2
  if (pct < 0.9) return '#3ccf7a';   // Z3
  if (pct < 1.05) return '#f2c14e';  // Z4
  if (pct < 1.19) return '#ff7a1a';  // Z5
  return '#ff4d4d';                  // Z6+
}

// ---------- Built-in workouts ----------
export const BUILT_IN_WORKOUTS = [
  { id: 'builtin-endurance-45', text: `<workout_file><name>Endurance 45</name>
<description>Steady zone 2 riding with a gentle build.</description><workout>
<Warmup Duration="600" PowerLow="0.45" PowerHigh="0.65"/>
<SteadyState Duration="900" Power="0.68"/>
<SteadyState Duration="600" Power="0.72"/>
<SteadyState Duration="300" Power="0.65"/>
<Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.45"/>
</workout></workout_file>` },
  { id: 'builtin-sweetspot-3x10', text: `<workout_file><name>Sweet Spot 3×10</name>
<description>Three 10-minute blocks at 88–90% FTP.</description><workout>
<Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
<SteadyState Duration="600" Power="0.89"/>
<SteadyState Duration="300" Power="0.55"/>
<SteadyState Duration="600" Power="0.89"/>
<SteadyState Duration="300" Power="0.55"/>
<SteadyState Duration="600" Power="0.89"/>
<Cooldown Duration="480" PowerLow="0.6" PowerHigh="0.4"/>
</workout></workout_file>` },
  { id: 'builtin-vo2-5x3', text: `<workout_file><name>VO2 Max 5×3</name>
<description>Five hard 3-minute efforts at 115% FTP with equal recovery.</description><workout>
<Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
<SteadyState Duration="60" Power="1.0"/>
<SteadyState Duration="120" Power="0.5"/>
<IntervalsT Repeat="5" OnDuration="180" OffDuration="180" OnPower="1.15" OffPower="0.5"/>
<Cooldown Duration="420" PowerLow="0.6" PowerHigh="0.4"/>
</workout></workout_file>` },
  { id: 'builtin-openers-20', text: `<workout_file><name>Quick Spin 20</name>
<description>Short easy spin with a few openers. Good for testing ERG.</description><workout>
<Warmup Duration="300" PowerLow="0.45" PowerHigh="0.65"/>
<IntervalsT Repeat="3" OnDuration="60" OffDuration="120" OnPower="0.95" OffPower="0.55"/>
<FreeRide Duration="180"/>
<Cooldown Duration="240" PowerLow="0.6" PowerHigh="0.45"/>
</workout></workout_file>` },
];
