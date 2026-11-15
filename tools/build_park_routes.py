#!/usr/bin/env python3
"""Build the scenic-route GPX files in routes/parks/.

Each route is routed on real roads with BRouter (OpenStreetMap data), then its
elevation is re-sampled from the same AWS Terrain Tiles the 3D world uses, so the
road sits exactly on the rendered terrain.

Two kinds:
  loop          waypoints go round and return to the first one
  out-and-back  waypoints run A -> B; the GPX rides there and back (A -> B -> A),
                so it still laps endlessly. The app draws the road once and the
                rider U-turns into the other lane at B.

    python3 tools/build_park_routes.py              # build all
    python3 tools/build_park_routes.py bigsur zion  # build some (index.json is merged)
    python3 tools/build_park_routes.py --prune-existing [ids]   # offline: cut spurs and smooth jogs in existing GPX
"""
import io, json, math, os, sys, urllib.request, urllib.parse
from xml.sax.saxutils import escape
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'routes', 'parks')
CACHE = os.path.join(ROOT, 'tools', '.cache')
DEM_Z = 14

# Waypoints are (lat, lon) in riding order; the loop returns to the first one.
# Routing definitions share the same catalog as GPX imports and the app.
with open(os.path.join(ROOT, 'routes', 'catalog.json')) as catalog_file:
    PARKS = {p['id']: {**p['routing'], 'name': p['name'], 'park': p['park'],
                        'out_and_back': p.get('outAndBack', False)}
             for p in json.load(catalog_file) if p.get('routing')}


def http_get(url):
    import time
    time.sleep(3)  # be polite to the free public services
    req = urllib.request.Request(url, headers={'User-Agent': 'bikefree-route-builder/0.6 (personal project)'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def haversine(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


_tiles = {}


def dem_tile(x, y):
    key = (x, y)
    if key not in _tiles:
        os.makedirs(CACHE, exist_ok=True)
        path = os.path.join(CACHE, f'dem-{DEM_Z}-{x}-{y}.png')
        if not os.path.exists(path):
            data = http_get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{DEM_Z}/{x}/{y}.png')
            open(path, 'wb').write(data)
        _tiles[key] = Image.open(path).convert('RGB').load()
    return _tiles[key]


def elevation(lat, lon):
    n = 2 ** DEM_Z
    fx = (lon + 180) / 360 * n * 256
    lr = math.radians(lat)
    fy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n * 256

    def px(gx, gy):
        tx, ty = int(gx // 256), int(gy // 256)
        r, g, b = dem_tile(tx, ty)[int(gx % 256), int(gy % 256)]
        return r * 256 + g + b / 256 - 32768

    x0, y0 = math.floor(fx - 0.5), math.floor(fy - 0.5)
    ax, ay = fx - 0.5 - x0, fy - 0.5 - y0
    return (px(x0, y0) * (1 - ax) * (1 - ay) + px(x0 + 1, y0) * ax * (1 - ay)
            + px(x0, y0 + 1) * (1 - ax) * ay + px(x0 + 1, y0 + 1) * ax * ay)


def route(key, park):
    os.makedirs(CACHE, exist_ok=True)
    pts = park['waypoints'] + ([] if park.get('out_and_back') else [park['waypoints'][0]])
    lonlats = '|'.join(f'{lon:.5f},{lat:.5f}' for lat, lon in pts)
    url = 'https://brouter.de/brouter?' + urllib.parse.urlencode(
        {'lonlats': lonlats, 'profile': park['profile'], 'alternativeidx': 0, 'format': 'geojson'}, safe='|,')
    cache = os.path.join(CACHE, f'brouter-{key}.json')
    raw = open(cache, 'rb').read() if os.path.exists(cache) and json.load(open(cache)).get('_url') == url else None
    if raw is None:
        data = json.loads(http_get(url))
        data['_url'] = url
        json.dump(data, open(cache, 'w'))
    else:
        data = json.loads(raw)
    coords = data['features'][0]['geometry']['coordinates']
    return [(c[1], c[0]) for c in coords]


def resample(points, step=10.0):
    out = [points[0]]
    carry = 0.0
    for a, b in zip(points, points[1:]):
        d = haversine(a, b)
        if d == 0:
            continue
        t = step - carry
        while t <= d:
            f = t / d
            out.append(tuple(a[m] + (b[m] - a[m]) * f for m in range(len(a))))   # (lat, lon[, ele])
            t += step
        carry = d - (t - step)
    if haversine(out[-1], points[-1]) > 1:
        out.append(points[-1])
    return out


SHORT_SPUR = (3, 40, 5)   # a 30–400 m stretch (3–40 points) that returns to within 5 m: a dead-end stub


def _is_spur(k, d, long_min, near_m):
    """k points apart along the route, d metres apart on the ground."""
    lo, hi, near_short = SHORT_SPUR
    return (k > long_min and d < near_m) or (lo <= k <= hi and d < near_short)


def prune_spurs(pts, max_spur_m=6000, near_m=15, spans=None):
    """Remove out-and-back spurs and small detours (circular: the route is a loop).

    Wherever the route comes back to a point it already passed within `max_spur_m`
    along the route, everything in between is cut. Waypoints that snapped onto a
    parking lot or side road leave exactly this kind of spur — long ones, and short
    stubs that run a few dozen metres up a side road and straight back.
    `spans`, if given, collects (index, points removed) for each cut, in the original numbering."""
    removed = 0
    while True:
        n = len(pts)
        limit = min(int(max_spur_m / 10), n // 3)
        grid = {}
        for i, p in enumerate(pts):
            grid.setdefault((round(p[0] * 3000), round(p[1] * 3000)), []).append(i)
        best = None
        for i, p in enumerate(pts):
            c = (round(p[0] * 3000), round(p[1] * 3000))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((c[0] + dx, c[1] + dy), []):
                        k = (j - i) % n
                        if k <= limit and _is_spur(k, haversine(pts[i], pts[j]), 40, near_m) and (best is None or k > best[1]):
                            best = (i, k)
        if best is None:
            return pts, removed
        i, k = best
        if i + k < n:   # cut in place, the start stays where it is
            if spans is not None:
                spans.append((i, k))
            pts = pts[:i + 1] + pts[i + k + 1:]
        else:           # the stretch wraps past the start: restart the loop at j
            keep = [(i + m) % n for m in range(k, n + 1)]
            pts = [pts[x] for x in keep]
        removed += k * 10


def prune_spurs_linear(pts, max_spur_m=4000, near_m=15, spans=None):
    """Same as prune_spurs for a one-way leg: cut any stretch that leaves the road and comes back."""
    removed = 0
    while True:
        limit = int(max_spur_m / 10)
        grid = {}
        for i, p in enumerate(pts):
            grid.setdefault((round(p[0] * 3000), round(p[1] * 3000)), []).append(i)
        best = None
        for i, p in enumerate(pts):
            c = (round(p[0] * 3000), round(p[1] * 3000))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((c[0] + dx, c[1] + dy), []):
                        k = j - i
                        if k <= limit and _is_spur(k, haversine(pts[i], pts[j]), 20, near_m) and (best is None or k > best[1]):
                            best = (i, k)
        if best is None:
            return pts, removed
        i, k = best
        if spans is not None:
            spans.append((i, k))
        pts = pts[:i + 1] + pts[i + k + 1:]
        removed += k * 10


def _turn(a, b, c):
    """Signed turn in degrees at b (flat-earth, fine over 10 m)."""
    k = math.cos(math.radians(b[0]))
    t1 = math.atan2(b[0] - a[0], (b[1] - a[1]) * k)
    t2 = math.atan2(c[0] - b[0], (c[1] - b[1]) * k)
    return (math.degrees(t2 - t1) + 540) % 360 - 180


def _jogs(pts, min_turn):
    out = []
    for i in range(2, len(pts) - 3):
        a, b = _turn(*pts[i - 1:i + 2]), _turn(*pts[i:i + 3])
        if a * b < 0 and min(abs(a), abs(b)) > min_turn:
            out.append(i)
    return out


def fair_jogs(pts, min_turn=8.0, reach=3, rounds=20):
    """Smooth sideways jogs: opposite turns of more than `min_turn` degrees on consecutive 10 m segments.

    Real roads don't zig-zag like that within 20 m; it is where a cut spur's way in and way out met a few
    metres apart, or where BRouter stepped across a junction. The points around each jog are relaxed
    toward their neighbours (lat/lon only; elevation stays as it was), then the line is resampled to
    10 m — what the app draws — and checked again. Returns (points at 10 m, jogs fixed)."""
    pts = resample(list(pts), 10.0)
    fixed = 0
    for _ in range(rounds):
        jogs = _jogs(pts, min_turn)
        if not jogs:
            break
        for i in jogs:
            lo, hi = max(1, i - reach), min(len(pts) - 2, i + reach + 1)
            for _ in range(4):
                for j in range(lo, hi + 1):
                    a, b, c = pts[j - 1], pts[j], pts[j + 1]
                    pts[j] = ((a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4) + tuple(b[2:])
        fixed += len(jogs)
        pts = resample(pts, 10.0)
    return pts, fixed


def _window(vals, w, fn):
    n = len(vals)
    return [fn(vals[max(0, i - w):min(n, i + w + 1)]) for i in range(n)]


def road_profile(eles, bridge_m=400, cliff_m=200, smooth_m=60, step=10):
    """Turn raw terrain samples into a rideable road profile.

    A 30 m elevation model doesn't know about bridges or cliff-cut roads: at Bixby Bridge it
    follows the canyon floor 80 m below the deck, and on a hairpin it picks up the cliff face.
    An 'opening' (min then max) shaves spikes narrower than cliff_m; a 'closing' (max then min)
    fills dips narrower than bridge_m — exactly where bridges are. Then a light smoothing."""
    c = cliff_m // step // 2
    e = _window(_window(eles, c, min), c, max)
    b = bridge_m // step // 2
    e = _window(_window(e, b, max), b, min)
    s = max(1, smooth_m // step // 2)
    return _window(e, s, lambda v: sum(v) / len(v))


def write_gpx(key, park, pts, eles, oab):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{key}.gpx'), 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<gpx version="1.1" creator="bikefree" xmlns="http://www.topografix.com/GPX/1/1">\n')
        f.write(f'  <metadata><name>{escape(park["name"])}</name><desc>{escape(park["park"])}.{" Out and back." if oab else ""} Routed with BRouter on '
                'OpenStreetMap data (© OpenStreetMap contributors, ODbL); elevation from AWS Terrain Tiles.</desc></metadata>\n')
        f.write(f'  <trk><name>{escape(park["name"])}</name><trkseg>\n')
        for (lat, lon), e in zip(pts, eles):
            f.write(f'    <trkpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{e:.1f}</ele></trkpt>\n')
        f.write('  </trkseg></trk>\n</gpx>\n')


# Scene fields that are distances along the outbound route (metres)
SCENE_DISTANCE_KEYS = ('atM', 'fromM', 'toM', 'positionM')


def prune_existing(key):
    """Prune spurs and smooth jogs in an already-built GPX without re-routing (no network).

    Keeps the points and elevations as they are, cuts each spur, and moves the scene's
    distance-based placements (signs, lookouts, roadside rails, preview) that lie after a cut."""
    import re
    park = PARKS[key]
    oab = park.get('out_and_back', False)
    path = os.path.join(OUT, f'{key}.gpx')
    text = open(path).read()
    rows = [(float(a), float(b), float(c)) for a, b, c in
            re.findall(r'<trkpt lat="([^"]+)" lon="([^"]+)"><ele>([^<]+)</ele></trkpt>', text)]
    half = (len(rows) + 1) // 2 if oab else len(rows)
    pts = resample(rows[:half], 10.0)   # the app works on exact 10 m steps: fair the same polyline it draws
    spans = []
    pts, removed = (prune_spurs_linear if oab else prune_spurs)(pts, spans=spans)
    pts, jogs = fair_jogs(pts)
    if not spans and not jogs:
        print(f'{key}: no spurs or jogs')
        return []
    # cuts in original distances: each cut removes k points (k × 10 m) after point i of the leg as it was then
    cuts, offset = [], []
    for i, k in spans:
        start = i
        for (pi, pk) in offset:          # map back to the original numbering
            if start > pi:
                start += pk
        offset.append((start, k))
        cuts.append((start * 10.0, k * 10.0))
    eles = [p[2] for p in pts]
    pts = [(p[0], p[1]) for p in pts]
    if oab:
        pts, eles = pts + pts[-2::-1], eles + eles[-2::-1]
    if jogs:
        print(f'{key}: smoothed {jogs} sideways jog(s)')
    write_gpx(key, park, pts, eles, oab)
    scene_path = os.path.join(ROOT, 'routes', 'scenes', f'{key}.json')
    if cuts and os.path.exists(scene_path):   # only cuts move distances
        scene = json.load(open(scene_path))
        def shift(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in SCENE_DISTANCE_KEYS and isinstance(v, (int, float)):
                        # past a cut: move back by its length; on a cut (on the stub itself): move to the junction
                        o[k] = round(v - sum(min(length, v - at) for at, length in cuts if v > at), 1)
                    else:
                        shift(v)
            elif isinstance(o, list):
                for v in o:
                    shift(v)
        shift(scene)
        with open(scene_path, 'w') as f:
            f.write(json.dumps(scene, indent=2, ensure_ascii=False) + '\n')
    for at, length in cuts:
        print(f'{key}: cut a {length:.0f} m spur at {at/1000:.2f} km')
    return cuts


def build(key):
    park = PARKS[key]
    oab = park.get('out_and_back', False)
    raw = route(key, park)
    pts = resample(raw, 10.0)
    if oab:
        pts, removed = prune_spurs_linear(pts)
        pts, _ = fair_jogs(pts)
        # a waypoint that snapped onto a parking loop at either end leaves a dead-end stub: trim back to the road
        pts = resample(pts, 10.0)
        print(f'{key}: pruned {removed/1000:.1f} km of spurs')
        one_way = sum(haversine(a, b) for a, b in zip(pts, pts[1:]))
        # there and back: the same points in reverse (the turnaround point once)
        pts = pts + pts[-2::-1]
    else:
        pts, removed = prune_spurs(pts)
        pts, _ = fair_jogs(pts)
        if haversine(pts[0], pts[-1]) > 0.5:
            pts.append(pts[0])
        pts = resample(pts, 10.0)
        print(f'{key}: pruned {removed/1000:.1f} km of spurs')
    total = sum(haversine(a, b) for a, b in zip(pts, pts[1:]))
    gap = haversine(pts[0], pts[-1])
    if oab:
        # road profile on the outbound leg, mirrored for the way back (both legs identical)
        half = (len(pts) + 1) // 2
        out = road_profile([max(park.get('min_ele', -1e9), elevation(lat, lon)) for lat, lon in pts[:half]], **park.get('profile_opts', {}))
        eles = out + out[-2::-1]
    else:
        eles = [max(park.get('min_ele', -1e9), elevation(lat, lon)) for lat, lon in pts]
    ascent = 0.0
    # light smoothing for the ascent estimate only
    sm = [sum(eles[max(0, i - 4):i + 5]) / len(eles[max(0, i - 4):i + 5]) for i in range(len(eles))]
    for a, b in zip(sm, sm[1:]):
        if b > a:
            ascent += b - a
    # Out-and-back spurs: two points far apart along the route but close on the ground.
    spurs = 0
    grid = {}
    for i, (lat, lon) in enumerate(pts):
        grid.setdefault((round(lat * 2000), round(lon * 2000)), []).append(i)
    half = (len(pts) + 1) // 2 if oab else len(pts)   # check only the outbound leg of an out-and-back
    for i, (lat, lon) in enumerate(pts[:half]):
        cell = (round(lat * 2000), round(lon * 2000))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((cell[0] + dx, cell[1] + dy), []):
                    if j >= half:
                        continue
                    sep = abs(i - j) * 10
                    sep = min(sep, total - sep)
                    if sep > 400 and haversine(pts[i], pts[j]) < 12:
                        spurs += 1
    lo, hi = park['expect_km']
    ok = lo <= (one_way if oab else total) / 1000 <= hi and gap < 150 and spurs == 0
    if oab:
        print(f'{key}: out and back, {one_way/1000:.1f} km ({one_way/1609.344:.1f} mi) each way')
    print(f'{key:11s} {total/1000:6.1f} km ({total/1609.344:5.1f} mi)  climb {ascent:6.0f} m ({ascent*3.28084:5.0f} ft)  '
          f'ele {min(eles):6.0f}–{max(eles):6.0f} m  gap {gap:5.1f} m  points {len(pts)}  overlap {spurs//2} pts  {"OK" if ok else "CHECK"}')
    for name, p in park['pois'].items():
        dmin = min(haversine(p, q) for q in pts)
        print(f'    passes {name:18s} within {dmin:5.0f} m')
    write_gpx(key, park, pts, eles, oab)
    out = {'id': key, 'name': park['name'], 'park': park['park'], 'km': round(total / 1000, 1),
           'climbM': round(ascent), 'file': f'routes/parks/{key}.gpx', 'ok': ok}
    if oab:
        out['outAndBack'] = True
    return out


if __name__ == '__main__':
    if '--prune-existing' in sys.argv:
        # offline: cut spurs from the GPX files already in routes/parks/ (no routing, no elevation download)
        for key in [k for k in sys.argv[1:] if not k.startswith('--')] or list(PARKS):
            prune_existing(key)
        sys.exit(0)
    keys = sys.argv[1:] or list(PARKS)
    results = {r['id']: {k: v for k, v in r.items() if k != 'ok'} for r in (build(k) for k in keys)}
    # merge into index.json, in the order routes are listed above
    path = os.path.join(OUT, 'index.json')
    old = {r['id']: r for r in json.load(open(path))} if os.path.exists(path) else {}
    old.update(results)
    json.dump([old[k] for k in PARKS if k in old], open(path, 'w'), indent=2)
