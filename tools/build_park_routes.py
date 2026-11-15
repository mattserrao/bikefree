#!/usr/bin/env python3
"""Build the national-park loop GPX files in routes/parks/.

Each loop is routed on real roads with BRouter (OpenStreetMap data), then its
elevation is re-sampled from the same AWS Terrain Tiles the 3D world uses, so the
road sits exactly on the rendered terrain.

    python3 tools/build_park_routes.py            # build all
    python3 tools/build_park_routes.py teton      # build one
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
    pts = park['waypoints'] + [park['waypoints'][0]]
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


def build(key):
    park = PARKS[key]
    raw = route(key, park)
    pts = resample(raw, 10.0)
    pts, removed = prune_spurs(pts)
    if haversine(pts[0], pts[-1]) > 0.5:
        pts.append(pts[0])
    pts = resample(pts, 10.0)
    print(f'{key}: pruned {removed/1000:.1f} km of spurs')
    total = sum(haversine(a, b) for a, b in zip(pts, pts[1:]))
    gap = haversine(pts[0], pts[-1])
    eles = [elevation(lat, lon) for lat, lon in pts]
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
    for i, (lat, lon) in enumerate(pts):
        cell = (round(lat * 2000), round(lon * 2000))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((cell[0] + dx, cell[1] + dy), []):
                    sep = abs(i - j) * 10
                    sep = min(sep, total - sep)
                    if sep > 400 and haversine(pts[i], pts[j]) < 12:
                        spurs += 1
    lo, hi = park['expect_km']
    ok = lo <= total / 1000 <= hi and gap < 150 and spurs == 0
    print(f'{key:11s} {total/1000:6.1f} km ({total/1609.344:5.1f} mi)  climb {ascent:6.0f} m ({ascent*3.28084:5.0f} ft)  '
          f'ele {min(eles):6.0f}–{max(eles):6.0f} m  gap {gap:5.1f} m  points {len(pts)}  overlap {spurs//2} pts  {"OK" if ok else "CHECK"}')
    for name, p in park['pois'].items():
        dmin = min(haversine(p, q) for q in pts)
        print(f'    passes {name:18s} within {dmin:5.0f} m')
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{key}.gpx'), 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<gpx version="1.1" creator="bikefree" xmlns="http://www.topografix.com/GPX/1/1">\n')
        f.write(f'  <metadata><name>{park["name"]}</name><desc>{park["park"]}. Routed with BRouter on '
                'OpenStreetMap data (© OpenStreetMap contributors, ODbL); elevation from AWS Terrain Tiles.</desc></metadata>\n')
        f.write(f'  <trk><name>{park["name"]}</name><trkseg>\n')
        for (lat, lon), e in zip(pts, eles):
            f.write(f'    <trkpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{e:.1f}</ele></trkpt>\n')
        f.write('  </trkseg></trk>\n</gpx>\n')
    return {'id': key, 'name': park['name'], 'park': park['park'], 'km': round(total / 1000, 1),
            'climbM': round(ascent), 'file': f'routes/parks/{key}.gpx', 'ok': ok}


if __name__ == '__main__':
    keys = sys.argv[1:] or list(PARKS)
    results = [build(k) for k in keys]
    if not sys.argv[1:]:
        json.dump([{k: v for k, v in r.items() if k != 'ok'} for r in results],
                  open(os.path.join(OUT, 'index.json'), 'w'), indent=2)
