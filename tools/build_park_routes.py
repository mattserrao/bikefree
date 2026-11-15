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
"""
import io, json, math, os, sys, urllib.request, urllib.parse
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'routes', 'parks')
CACHE = os.path.join(ROOT, 'tools', '.cache')
DEM_Z = 14

# Waypoints are (lat, lon) in riding order; the loop returns to the first one.
PARKS = {
    'yosemite': {
        'name': 'Yosemite Valley Loop',
        'park': 'Yosemite National Park, California',
        'profile': 'fastbike',
        'expect_km': (17, 23),
        'waypoints': [
            (37.7432, -119.5970),  # Yosemite Valley Lodge (Northside Dr)
            (37.7245, -119.6370),  # El Capitan Meadow (Northside Dr)
            (37.7166, -119.6640),  # Pohono Bridge
            (37.7172, -119.6465),  # Bridalveil Fall (Southside Dr)
            (37.7366, -119.6029),  # Swinging Bridge (Southside Dr)
            (37.7376, -119.5717),  # Curry Village
        ],
        'pois': {'El Capitan Meadow': (37.7245, -119.6370), 'Bridalveil Fall': (37.7172, -119.6465)},
    },
    'acadia': {
        'name': 'Acadia Park Loop Road',
        'park': 'Acadia National Park, Maine',
        'profile': 'fastbike',
        'expect_km': (30, 45),
        'waypoints': [
            (44.4096, -68.2470),  # Hulls Cove Visitor Center
            (44.3620, -68.2075),  # Sieur de Monts
            (44.3305, -68.1840),  # Sand Beach
            (44.3210, -68.1890),  # Thunder Hole
            (44.3107, -68.1925),  # Otter Cliffs
            (44.3204, -68.2530),  # Jordan Pond
            (44.3440, -68.2420),  # Bubble Pond
        ],
        'pois': {'Sand Beach': (44.3305, -68.1840), 'Jordan Pond': (44.3204, -68.2530)},
    },
    'teton': {
        'name': 'Grand Teton Loop',
        'park': 'Grand Teton National Park, Wyoming',
        'profile': 'car-fast',
        'expect_km': (62, 75),
        'waypoints': [
            (43.6568, -110.7130),  # Moose Junction (US-89/191 + Teton Park Rd)
            (43.8410, -110.5100),  # Moran Junction
            (43.8750, -110.5770),  # Jackson Lake Junction
            (43.7900, -110.7270),  # North Jenny Lake Junction (Teton Park Rd)
            (43.7520, -110.7240),  # South Jenny Lake
        ],
        'pois': {'Moran Junction': (43.8410, -110.5100), 'South Jenny Lake': (43.7520, -110.7240)},
    },
    'craterlake': {
        'name': 'Crater Lake Rim Drive',
        'park': 'Crater Lake National Park, Oregon',
        'profile': 'car-fast',
        'expect_km': (50, 58),
        'waypoints': [
            (42.9115, -122.1450),  # Rim Village
            (42.8966, -122.1340),  # Park Headquarters / Steel Visitor Center
            (42.9150, -122.0530),  # Kerr Notch
            (42.9810, -122.0830),  # Cleetwood Cove
            (42.9850, -122.1450),  # North Junction
            (42.9470, -122.1680),  # Watchman Overlook
            (42.9230, -122.1530),  # Discovery Point
        ],
        'pois': {'Cleetwood Cove': (42.9810, -122.0830), 'Watchman': (42.9470, -122.1680)},
    },

    # ---- v0.11: out-and-back scenic roads (expect_km is one way) ----
    'monumentvalley': {
        'name': 'Monument Valley · Forrest Gump Point',
        'park': 'US-163, Monument Valley, Utah & Arizona',
        'profile': 'car-fast', 'out_and_back': True,
        'expect_km': (17, 28),
        'waypoints': [
            (37.1012, -109.9898),  # Forrest Gump Point (US-163)
            (37.0010, -110.0950),  # US-163 at the Monument Valley Rd turn
            (36.9833, -110.1120),  # Monument Valley visitor center (The View)
        ],
        'pois': {'Forrest Gump Point': (37.1012, -109.9898), 'Visitor center': (36.9833, -110.1120)},
    },
    'bigsur': {
        'name': 'Big Sur · Bixby Bridge & Hurricane Point',
        'park': 'California Highway 1, Big Sur',
        'profile': 'car-fast', 'out_and_back': True,
        'expect_km': (28, 40),
        'waypoints': [
            (36.4985, -121.9375),  # Carmel Highlands, just south of Point Lobos
            (36.4400, -121.9215),  # Garrapata
            (36.3716, -121.9019),  # Bixby Creek Bridge
            (36.3060, -121.8800),  # Point Sur
            (36.2700, -121.8075),  # Big Sur village
        ],
        'pois': {'Bixby Bridge': (36.3716, -121.9019), 'Hurricane Point': (36.3567, -121.8985), 'Big Sur village': (36.2700, -121.8075)},
    },
    'goingtothesun': {
        'name': 'Going-to-the-Sun Road',
        'park': 'Glacier National Park, Montana',
        'profile': 'fastbike', 'out_and_back': True,
        'expect_km': (30, 42),
        # cliff-cut road on a 30 m DEM: sample the mountain face, so smooth harder (the real road holds ~6%)
        'profile_opts': {'cliff_m': 800, 'bridge_m': 800, 'smooth_m': 600},
        'waypoints': [
            (48.6178, -113.8770),  # Lake McDonald Lodge
            (48.6797, -113.8187),  # Avalanche Creek
            (48.6965, -113.7180),  # Logan Pass visitor center
        ],
        'pois': {'Avalanche Creek': (48.6797, -113.8187), 'Logan Pass': (48.6965, -113.7180)},
    },
    'zion': {
        'name': 'Zion Canyon Scenic Drive',
        'park': 'Zion National Park, Utah',
        'profile': 'fastbike', 'out_and_back': True,
        'expect_km': (10, 16),
        'waypoints': [
            (37.2002, -112.9868),  # Zion Canyon visitor center
            (37.2508, -112.9570),  # Zion Lodge
            (37.2849, -112.9478),  # Temple of Sinawava
        ],
        'pois': {'Zion Lodge': (37.2508, -112.9570), 'Temple of Sinawava': (37.2849, -112.9478)},
    },
    'sevenmile': {
        'name': 'Overseas Highway · Seven Mile Bridge',
        'park': 'Florida Keys (Marathon to Bahia Honda)',
        'profile': 'car-fast', 'out_and_back': True,
        'min_ele': 3.0,  # the DEM includes the sea floor; keep bridges above the water
        'expect_km': (18, 28),
        'waypoints': [
            (24.7120, -81.0880),  # Marathon
            (24.6995, -81.1500),  # Seven Mile Bridge, east end
            (24.6560, -81.2790),  # Bahia Honda State Park
        ],
        'pois': {'Seven Mile Bridge (Pigeon Key)': (24.7040, -81.1550), 'Bahia Honda': (24.6560, -81.2790)},
    },
    'route28': {
        'name': 'Route 28 · Old Forge to Eighth Lake',
        'park': 'Fulton Chain of Lakes, Adirondacks, New York',
        'profile': 'car-fast', 'out_and_back': True,
        'expect_km': (22, 34),
        'waypoints': [
            (43.7108, -74.9733),  # Old Forge
            (43.7585, -74.8260),  # Eagle Bay
            (43.7475, -74.7925),  # Inlet
            (43.7400, -74.7550),  # Seventh Lake
            (43.7690, -74.7100),  # Eighth Lake
        ],
        'pois': {'Inlet': (43.7475, -74.7925), 'Seventh Lake': (43.7400, -74.7550), 'Eighth Lake': (43.7690, -74.7100)},
    },
}


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
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            t += step
        carry = d - (t - step)
    if haversine(out[-1], points[-1]) > 1:
        out.append(points[-1])
    return out


def prune_spurs(pts, max_spur_m=6000, near_m=15):
    """Remove out-and-back spurs and small detours (circular: the route is a loop).

    Wherever the route comes back to a point it already passed within `max_spur_m`
    along the route, everything in between is cut. Waypoints that snapped onto a
    parking lot or side road leave exactly this kind of spur."""
    removed = 0
    while True:
        n = len(pts)
        limit = min(int(max_spur_m / 10), n // 3)
        grid = {}
        for i, (lat, lon) in enumerate(pts):
            grid.setdefault((round(lat * 3000), round(lon * 3000)), []).append(i)
        best = None
        for i, (lat, lon) in enumerate(pts):
            c = (round(lat * 3000), round(lon * 3000))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((c[0] + dx, c[1] + dy), []):
                        k = (j - i) % n
                        if 40 < k <= limit and haversine(pts[i], pts[j]) < near_m and (best is None or k > best[1]):
                            best = (i, k)
        if best is None:
            return pts, removed
        i, k = best
        keep = [(i + m) % n for m in range(k, n + 1)]  # from j around to i
        pts = [pts[x] for x in keep]
        removed += k * 10


def prune_spurs_linear(pts, max_spur_m=4000, near_m=15):
    """Same as prune_spurs for a one-way leg: cut any stretch that leaves the road and comes back."""
    removed = 0
    while True:
        limit = int(max_spur_m / 10)
        grid = {}
        for i, (lat, lon) in enumerate(pts):
            grid.setdefault((round(lat * 3000), round(lon * 3000)), []).append(i)
        best = None
        for i, (lat, lon) in enumerate(pts):
            c = (round(lat * 3000), round(lon * 3000))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((c[0] + dx, c[1] + dy), []):
                        k = j - i
                        if 20 < k <= limit and haversine(pts[i], pts[j]) < near_m and (best is None or k > best[1]):
                            best = (i, k)
        if best is None:
            return pts, removed
        i, k = best
        pts = pts[:i + 1] + pts[i + k + 1:]
        removed += k * 10


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


def build(key):
    park = PARKS[key]
    oab = park.get('out_and_back', False)
    raw = route(key, park)
    pts = resample(raw, 10.0)
    if oab:
        pts, removed = prune_spurs_linear(pts)
        # a waypoint that snapped onto a parking loop at either end leaves a dead-end stub: trim back to the road
        pts = resample(pts, 10.0)
        print(f'{key}: pruned {removed/1000:.1f} km of spurs')
        one_way = sum(haversine(a, b) for a, b in zip(pts, pts[1:]))
        # there and back: the same points in reverse (the turnaround point once)
        pts = pts + pts[-2::-1]
    else:
        pts, removed = prune_spurs(pts)
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
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{key}.gpx'), 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<gpx version="1.1" creator="bikefree" xmlns="http://www.topografix.com/GPX/1/1">\n')
        f.write(f'  <metadata><name>{park["name"]}</name><desc>{park["park"]}.{" Out and back." if oab else ""} Routed with BRouter on '
                'OpenStreetMap data (© OpenStreetMap contributors, ODbL); elevation from AWS Terrain Tiles.</desc></metadata>\n')
        f.write(f'  <trk><name>{park["name"]}</name><trkseg>\n')
        for (lat, lon), e in zip(pts, eles):
            f.write(f'    <trkpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{e:.1f}</ele></trkpt>\n')
        f.write('  </trkseg></trk>\n</gpx>\n')
    out = {'id': key, 'name': park['name'], 'park': park['park'], 'km': round(total / 1000, 1),
           'climbM': round(ascent), 'file': f'routes/parks/{key}.gpx', 'ok': ok}
    if oab:
        out['outAndBack'] = True
    return out


if __name__ == '__main__':
    keys = sys.argv[1:] or list(PARKS)
    results = {r['id']: {k: v for k, v in r.items() if k != 'ok'} for r in (build(k) for k in keys)}
    # merge into index.json, in the order routes are listed above
    path = os.path.join(OUT, 'index.json')
    old = {r['id']: r for r in json.load(open(path))} if os.path.exists(path) else {}
    old.update(results)
    json.dump([old[k] for k in PARKS if k in old], open(path, 'w'), indent=2)
