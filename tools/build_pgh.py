#!/usr/bin/env python3
"""Build PGH: a free-ride road graph of Pittsburgh (every street, trail and bridge you can bike; no highways).

    python3 tools/build_pgh.py              # fetch what's missing (cached), build, write
    python3 tools/build_pgh.py --offline    # use the cache only

Reads   tools/city/pgh.json                       the config (corridor, way classes, thresholds)
        routes/cities/pittsburgh*.gpx             the existing areas' lines: the corridor is every street within
                                                  `corridorM` of them (the current network corridor)
Writes  routes/cities/pgh.json                    "bikefree-graph-1": junctions and edges (10 m samples, heights)
        routes/cities/pgh-ground.grid.bin.gz      the ground (a "bikefree-terrain-grid-1" container, coarse only)
        tools/.cache/osm-pgh/                     raw OSM API tiles (delete to refresh)
        tools/.cache/dem-14-*.png                 AWS Terrain Tiles (shared with build_city.py)

The graph: OSM ways that a bike can ride (config "roads" / "paths"), split at every shared node into edges between
junctions. Junctions closer than `mergeM` are merged into one (dual carriageways, offset crossings), parallel
duplicates dropped, degree-2 nodes joined away (a junction is a real choice), short dead-end spurs pruned, and only
the largest connected piece kept: from anywhere you can ride everywhere. Heights: the terrain tiles along each edge (no steeper than `maxGradePct` over 10 m);
bridge decks (and short tunnels) interpolated between their ground ends; smoothed along each edge with its ends
pinned to its junctions' heights, so every way through a junction meets at one height.
Data © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles (USGS 3DEP and others).
"""
PGH_MAP_LABELS = [["Downtown", 40.4413, -79.9985, 1], ["North Side", 40.459, -80.01, 1], ["Strip District", 40.4525, -79.98, 2], ["Lawrenceville", 40.469, -79.96, 1], ["Oakland", 40.442, -79.9555, 1], ["Shadyside", 40.4545, -79.933, 2], ["East Liberty", 40.4625, -79.9245, 2], ["Squirrel Hill", 40.433, -79.9225, 1], ["South Side", 40.4265, -79.974, 1], ["Mt Washington", 40.4265, -80.016, 2], ["Homestead", 40.4045, -79.91, 1]]   # [text, lat, lon, rank: 1 on every map, 2 not on a phone's until zoomed]
import base64, gzip, json, math, os, re, struct, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict, Counter
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
UA = {'User-Agent': 'bikefree-graph-builder/0.1 (personal project)'}
OFFLINE = '--offline' in sys.argv
# (user, 22 Nov: "create a new map CNY following the guide used for PGH") the city: tools/city/<id>.json; PGH by default
CITY = sys.argv[sys.argv.index('--city') + 1] if '--city' in sys.argv else 'pgh'
STEP = 10
REVIEW = {}   # what the build left out, for tools/review_pgh.py


def http_get(url, pause=1.0):
    if OFFLINE: raise RuntimeError(f'offline: {url} is not cached')
    time.sleep(pause)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        return r.read()


def hv(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


# ------------------------------------------------------------------ corridor
class Corridor:
    """Points of the areas' lines on a 100 m hash: is a spot within `r` metres of one?"""
    def __init__(self, pts, r):
        self.r, self.cell = r, 100.0
        self.lat0 = sum(p[0] for p in pts) / len(pts)
        self.kx, self.ky = 111320 * math.cos(math.radians(self.lat0)), 110540
        self.grid = defaultdict(list)
        for la, lo in pts[::3]:
            x, y = lo * self.kx, la * self.ky
            self.grid[(int(x // self.cell), int(y // self.cell))].append((x, y))

    def dist(self, la, lo, reach):
        x, y = lo * self.kx, la * self.ky
        cx, cy, k = int(x // self.cell), int(y // self.cell), int(reach // self.cell) + 1
        best = reach * reach
        for i in range(cx - k, cx + k + 1):
            for j in range(cy - k, cy + k + 1):
                for px, py in self.grid.get((i, j), ()):
                    d = (px - x) ** 2 + (py - y) ** 2
                    if d < best: best = d
        return math.sqrt(best)

    def inside(self, la, lo): return self.dist(la, lo, self.r) < self.r


class CircleArea:
    """A city drawn as a circle (config "area": {"circle": [lat, lon, radiusM]}): the corridor's interface."""
    def __init__(self, lat, lon, r):
        self.lat0, self.lon0, self.r = lat, lon, r
        self.kx, self.ky = 111320 * math.cos(math.radians(lat)), 110540
        self.pts_all = [(lat, lon)]
    def dist(self, la, lo, reach):
        d = max(0.0, math.hypot((lo - self.lon0) * self.kx, (la - self.lat0) * self.ky) - self.r)
        return d if d < reach else reach
    def inside(self, la, lo): return math.hypot((lo - self.lon0) * self.kx, (la - self.lat0) * self.ky) < self.r


class ShapeArea:
    """A city drawn as circles plus corridors along lines (config "area": {"circle": [lat, lon, radiusM], "lines": file,
    "corridorM": m}; SKAN, user 22 Nov: the Skaneateles–Marcellus circle "extend so there is a route down and around
    Skaneateles lake … and a route around Otisco lake"): the corridor's interface, `dist` the metres beyond the shape
    (0 inside it), as CircleArea's — from a 20 m distance raster. `grow` widens it all (the build margin)."""
    CELL = 20.0
    def __init__(self, circles, lines, corridor, grow=0.0):
        import numpy as np
        from scipy import ndimage
        self.circles, self.cm, self.grow = circles, corridor, grow
        self.lat0 = circles[0][0] if circles else lines[0][0][0]
        self.kx, self.ky = 111320 * math.cos(math.radians(self.lat0)), 110540
        self.r = grow + max([c[2] for c in circles] + [corridor])   # (load_osm's pad)
        pts = []
        for ln in lines:   # every 10 m along each line
            for a, b in zip(ln, ln[1:]):
                L = hv(a, b); k = max(1, int(L / 10))
                pts += [(a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k) for i in range(k)]
            pts.append(tuple(ln[-1]))
        self.pts_all = pts + [(la + s_ * r / self.ky, lo + t_ * r / self.kx) for la, lo, r in circles for s_ in (-1, 1) for t_ in (-1, 1)]
        pad = corridor + grow + 6000
        self.s = min(p[0] for p in self.pts_all) - pad / self.ky; self.w = min(p[1] for p in self.pts_all) - pad / self.kx
        n_ = max(p[0] for p in self.pts_all) + pad / self.ky; e_ = max(p[1] for p in self.pts_all) + pad / self.kx
        self.nx, self.ny = int((e_ - self.w) * self.kx / self.CELL) + 1, int((n_ - self.s) * self.ky / self.CELL) + 1
        on = np.ones((self.ny, self.nx), bool)
        for la, lo in pts: on[int((la - self.s) * self.ky / self.CELL), int((lo - self.w) * self.kx / self.CELL)] = False
        d = ndimage.distance_transform_edt(on) * self.CELL - corridor if pts else np.full((self.ny, self.nx), 1e9)
        yy, xx = np.mgrid[0:self.ny, 0:self.nx]
        for la, lo, r in circles:
            cy, cx = (la - self.s) * self.ky / self.CELL, (lo - self.w) * self.kx / self.CELL
            d = np.minimum(d, np.hypot(yy - cy, xx - cx) * self.CELL - r)
        self.d = d - grow
    def dist(self, la, lo, reach):
        i, j = int((la - self.s) * self.ky / self.CELL), int((lo - self.w) * self.kx / self.CELL)
        if not (0 <= i < self.ny and 0 <= j < self.nx): return reach
        return min(reach, max(0.0, float(self.d[i, j])))
    def inside(self, la, lo): return self.dist(la, lo, 1.0) <= 0.0


def shape_of(cfg, grow=0.0):
    """The area's ShapeArea when it has corridor lines (else None: a plain circle)."""
    A = cfg.get('area', {})
    if not A.get('lines'): return None
    lines = json.load(open(os.path.join(ROOT, 'tools', 'city', A['lines'])))
    lines = [ln['pts'] if isinstance(ln, dict) else ln for ln in (lines['lines'] if isinstance(lines, dict) else lines)]
    circles = [tuple(A['circle'])] if A.get('circle') else []
    return ShapeArea(circles, lines, A.get('corridorM', 800), grow)


def area_lines():
    pts = []
    for name in sorted(os.listdir(os.path.join(ROOT, 'routes', 'cities'))):
        if re.match(r'^pittsburgh(-[a-z]+)?\.gpx$', name):
            t = open(os.path.join(ROOT, 'routes', 'cities', name)).read()
            pts += [(float(a), float(b)) for a, b in re.findall(r'<trkpt lat="([^"]+)" lon="([^"]+)"', t)]
    return pts


# ------------------------------------------------------------------ OSM
def fetch_box(folder, s, w, n, e, depth=0):
    path = os.path.join(folder, f't_{s:.4f}_{w:.4f}_{depth}.osm')
    if os.path.exists(path) and os.path.getsize(path) > 200: return [path]
    try:
        data = http_get(f'https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}')
    except urllib.error.HTTPError as err:
        if err.code in (400, 509) and depth < 4:   # too many nodes: split in four
            ms, mw = (s + n) / 2, (w + e) / 2
            out = []
            for a, b, c, d in ((s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)):
                out += fetch_box(folder, a, b, c, d, depth + 1)
            return out
        raise
    open(path, 'wb').write(data)
    return [path]


def load_osm(cfg, cor):
    folder = os.path.join(CACHE, f'osm-{CITY}')
    os.makedirs(folder, exist_ok=True)
    dx, dy = cfg['osmTile']
    w0, s0 = cfg['osmOrigin']
    pts = cor.pts_all
    la0, la1 = min(p[0] for p in pts), max(p[0] for p in pts)
    lo0, lo1 = min(p[1] for p in pts), max(p[1] for p in pts)
    reach = 0 if isinstance(cor, (CircleArea, ShapeArea)) else cfg['corridorM']   # (a circle: its own edge is the reach)
    pad_la, pad_lo = (reach or cor.r) / 110540 + dy, (reach or cor.r) / cor.kx + dx
    files, tiles = [], []
    for x in range(math.floor((lo0 - pad_lo - w0) / dx), math.ceil((lo1 + pad_lo - w0) / dx)):
        for y in range(math.floor((la0 - pad_la - s0) / dy), math.ceil((la1 + pad_la - s0) / dy)):
            w, s = w0 + x * dx, s0 + y * dy
            half = 0.5 * math.hypot(dx * cor.kx, dy * 110540)
            if cor.dist(s + dy / 2, w + dx / 2, reach + half + 50) < reach + half: tiles.append((s, w))
    print(f'  OSM: {len(tiles)} tiles of {dx}° × {dy}° touch the corridor')
    for k, (s, w) in enumerate(tiles):
        files += fetch_box(folder, round(s, 4), round(w, 4), round(s + dy, 4), round(w + dx, 4))
        if (k + 1) % 20 == 0: print(f'    {k + 1}/{len(tiles)} tiles')
    nodes, ways = {}, {}
    for f in files:
        root = ET.parse(f).getroot()
        for nd in root.iter('node'): nodes[nd.get('id')] = (float(nd.get('lat')), float(nd.get('lon')))
        for wy in root.iter('way'):
            t = {x.get('k'): x.get('v') for x in wy.iter('tag')}
            if 'highway' in t: ways[wy.get('id')] = ([x.get('ref') for x in wy.iter('nd')], t)
            elif t.get('railway') in ('abandoned', 'disused'):
                # (an old rail bed is never ridden on its own — only where a Pittsburgh route rode it, as a trail)
                ways[wy.get('id')] = ([x.get('ref') for x in wy.iter('nd')], dict(t, highway='rail_bed'))
    print(f'  OSM: {len(nodes)} nodes, {len(ways)} highway ways')
    return nodes, ways


def rideable(t, cfg):
    h = t.get('highway')
    yes = ('yes', 'designated', 'permissive')
    if t.get('area') == 'yes' or t.get('indoor') == 'yes': return None
    if t.get('bicycle') in ('no', 'dismount', 'use_sidepath'): return None
    if t.get('access') in ('private', 'no') and t.get('bicycle') not in yes: return None
    if t.get('service') in cfg['skipService'] and t.get('bicycle') not in yes: return None
    if h in cfg['connectors']: return 'connector'   # a boulevard (trunk): only short pieces between streets are kept (crossing it)
    if h in cfg['roads']:
        if h == 'service' and t.get('service') not in cfg['serviceKinds'] and t.get('bicycle') not in yes: return None
        return cfg['roads'][h]
    if h in cfg['paths']:
        if t.get('footway') == 'crossing' or t.get('path') == 'crossing': return 'path'   # a crosswalk: links a trail across a street
        if t.get('footway') in ('sidewalk', 'traffic_island') or t.get('path') == 'sidewalk': return None
        if h in ('footway', 'bridleway', 'pedestrian') and t.get('bicycle') not in yes and h != 'pedestrian': return None
        if t.get('surface') in cfg['skipSurfaces']: return None
        return cfg['paths'][h]
    return None


# ------------------------------------------------------------------ elevation (AWS Terrain Tiles, terrarium)
DEM_Z = 14
_tiles = {}


def dem_px(gx, gy):
    tx, ty = int(gx // 256), int(gy // 256)
    if (tx, ty) not in _tiles:
        path = os.path.join(CACHE, f'dem-{DEM_Z}-{tx}-{ty}.png')
        if not os.path.exists(path): open(path, 'wb').write(http_get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{DEM_Z}/{tx}/{ty}.png', 0.2))
        _tiles[(tx, ty)] = Image.open(path).convert('RGB').load()
    r, g, b = _tiles[(tx, ty)][int(gx % 256), int(gy % 256)]
    return r * 256 + g + b / 256 - 32768


def elevation(lat, lon):
    n = 2 ** DEM_Z
    fx = (lon + 180) / 360 * n * 256
    lr = math.radians(lat)
    fy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n * 256
    x0, y0 = math.floor(fx - .5), math.floor(fy - .5)
    ax, ay = fx - .5 - x0, fy - .5 - y0
    return (dem_px(x0, y0) * (1 - ax) * (1 - ay) + dem_px(x0 + 1, y0) * ax * (1 - ay)
            + dem_px(x0, y0 + 1) * (1 - ax) * ay + dem_px(x0 + 1, y0 + 1) * ax * ay)


# ------------------------------------------------------------------ the graph
class RouteLines:
    """The Pittsburgh routes' lines (tools/city/pgh-route-lines.json, from tools/map_pgh_routes.mjs --lines) on a 20 m hash:
    the ways they ride are kept through the cleanup (real mapped ways, never new ones), so the routes map onto PGH."""
    def __init__(self, path, reach):
        self.reach, self.grid = reach, defaultdict(list)
        self.kx, self.ky = 111320 * math.cos(math.radians(40.44)), 110540
        try: lines = json.load(open(path))
        except FileNotFoundError: lines = []
        for r in lines:
            pts = r['line']
            for (a, b), (c, d) in zip(pts, pts[1:]):   # (every ~5 m)
                k = max(1, int(hv((a, b), (c, d)) / 5))
                for i in range(k):
                    la, lo = a + (c - a) * i / k, b + (d - b) * i / k
                    self.grid[(int(lo * self.kx / 20), int(la * self.ky / 20))].append((lo * self.kx, la * self.ky))
        self.n = len(lines)

    def near(self, la, lo):
        x, y = lo * self.kx, la * self.ky
        cx, cy = int(x / 20), int(y / 20)
        return any(math.hypot(px - x, py - y) < self.reach for i in (-1, 0, 1) for j in (-1, 0, 1) for px, py in self.grid.get((cx + i, cy + j), ()))

    def dist(self, la, lo, cap=30):
        x, y = lo * self.kx, la * self.ky
        cx, cy = int(x / 20), int(y / 20)
        best = cap
        for i in (-2, -1, 0, 1, 2):
            for j in (-2, -1, 0, 1, 2):
                for px, py in self.grid.get((cx + i, cy + j), ()):
                    d = math.hypot(px - x, py - y)
                    if d < best: best = d
        return best

    def follows(self, pts, share=0.6):
        """Do the routes ride along this line (≥ share of its points)?"""
        if not self.n or not pts: return False
        step = max(1, len(pts) // 25)
        sample = pts[::step]
        return sum(1 for p in sample if self.near(*p)) >= share * len(sample)


ROUTES = None


def route_share(e):
    """How much of an edge the routes ride (0–1, cached)."""
    if ROUTES is None or not ROUTES.n: return 0.0
    if e.get('rshare') is None:
        # (closeness, not just nearness: two ways 15 m apart are both "near" a route that rides one of them)
        pts = list(zip(e['lat'], e['lon'])); step = max(1, len(pts) // 25); sample = pts[::step]
        e['rshare'] = 1 - sum(ROUTES.dist(*p) for p in sample) / max(1, len(sample)) / 30
    return e['rshare']


def protected(e):
    """An edge the Pittsburgh routes ride: never removed by the cleanup (cached; merged and cut edges are measured again)."""
    if ROUTES is None or not ROUTES.n: return False
    if e.get('prot') is None: e['prot'] = ROUTES.follows(list(zip(e['lat'], e['lon'])))
    return e['prot']


def build(cfg):
    if cfg.get('area', {}).get('lines'):
        cor = shape_of(cfg, cfg['area'].get('marginM', 0))   # (built over the margin too: trim_to_circle)
    elif cfg.get('area', {}).get('circle'):
        la_, lo_, r_ = cfg['area']['circle']
        cor = CircleArea(la_, lo_, r_ + cfg['area'].get('marginM', 0))   # (built over the margin too: trim_to_circle)
    else:
        cor_pts = area_lines()
        cor = Corridor(cor_pts, cfg['corridorM'])
        cor.pts_all = cor_pts
    nodes, ways = load_osm(cfg, cor)
    REVIEW['osm'] = (nodes, ways)   # (every highway way: the dead-end bridges' connectors look through them)

    # 1. the rideable ways, inside the corridor (a way is kept where its points are; cut at the corridor's edge)
    kept = []   # (refs, tags, kind)
    dropped = defaultdict(int)
    global ROUTES
    ROUTES = RouteLines(os.path.join(ROOT, 'tools', 'city', f'{CITY}-route-lines.json'), cfg['routeKeepM'])
    kept_for_routes = 0
    # the rideable ways' points (a way the routes ride is only added where none of these carries the route already)
    rgrid = defaultdict(list)
    kxr = 111320 * math.cos(math.radians(40.44))
    for refs, t in ways.values():
        if rideable(t, cfg) is None: continue
        for a, b in zip(refs, refs[1:]):
            if a not in nodes or b not in nodes: continue
            L = hv(nodes[a], nodes[b]); k = max(1, int(L / 8))
            for i in range(k + 1):
                la = nodes[a][0] + (nodes[b][0] - nodes[a][0]) * i / k; lo = nodes[a][1] + (nodes[b][1] - nodes[a][1]) * i / k
                rgrid[(int(lo * kxr / 15), int(la * 110540 / 15))].append((lo * kxr, la * 110540))
    def carried(la, lo, r=14):
        x, y = lo * kxr, la * 110540; cx, cy = int(x / 15), int(y / 15)
        return any(math.hypot(px - x, py - y) < r for i in (-1, 0, 1) for j in (-1, 0, 1) for px, py in rgrid.get((cx + i, cy + j), ()))
    for wid, (refs, t) in ways.items():
        kind = rideable(t, cfg)
        pieces = [refs]
        if kind is None:
            # the stretches of a way the Pittsburgh routes ride are kept whatever its class (a sidewalk path, a plaza, a
            # boulevard), never a motorway, steps or a way bikes may not use — and not a sidewalk beside the street the
            # route rides (that street carries it)
            h = t.get('highway')
            if h in ('motorway', 'motorway_link', 'steps', 'construction', 'proposed', 'elevator') or t.get('bicycle') == 'no' or t.get('area') == 'yes': dropped[h] += 1; continue
            rr = [r for r in refs if r in nodes]
            pieces, run = [], []
            for r in rr:
                if ROUTES.near(*nodes[r]): run.append(r)
                else:
                    if len(run) > 1: pieces.append(run)
                    run = []
            if len(run) > 1: pieces.append(run)
            good = []
            for pc in pieces:
                pts = [nodes[r] for r in pc]
                wl = sum(hv(p, q) for p, q in zip(pts, pts[1:]))
                step = max(1, len(pts) // 20)
                if wl > 60 and sum(1 for p in pts[::step] if carried(*p)) > 0.4 * len(pts[::step]): continue
                if wl < 8: continue
                good.append(pc)
            if not good: dropped[h] += 1; continue
            pieces = good
            kind = 'primary' if h in ('trunk', 'trunk_link') else cfg['roads'].get(h) or 'path'
            kept_for_routes += len(pieces)
        for refs in pieces:
            refs = [r for r in refs if r in nodes]
            if len(refs) < 2: continue
            if t.get('tunnel') not in (None, 'no') and sum(hv(nodes[a], nodes[b]) for a, b in zip(refs, refs[1:])) > cfg['maxTunnelM']: dropped['tunnel'] += 1; continue
            run = []
            for r in refs:
                if cor.inside(*nodes[r]): run.append(r)
                else:
                    if len(run) > 1: kept.append((run, t, kind, wid))
                    run = []
            if len(run) > 1: kept.append((run, t, kind, wid))
    print(f'  ways kept for the Pittsburgh routes ({ROUTES.n} routes): {kept_for_routes}')
    print(f'  ways kept: {len(kept)} pieces; not rideable: ' + ', '.join(f'{k} {v}' for k, v in sorted(dropped.items(), key=lambda x: -x[1])[:12]))

    # 2. split at shared nodes → edges (lists of OSM node ids)
    use = defaultdict(int)
    for refs, *_ in kept:
        for r in set(refs): use[r] += 1
        use[refs[0]] += 1; use[refs[-1]] += 1
    edges = []   # dict: a, b (graph node ids = OSM ids for now), refs, name, kind, bridge flags per segment
    for refs, t, kind, wid in kept:
        bridge = t.get('bridge') not in (None, 'no') or t.get('tunnel') not in (None, 'no')
        name = t.get('name') or t.get('bridge:name') or ''
        cur = [refs[0]]
        for r in refs[1:]:
            cur.append(r)
            if use[r] > 1 and r != cur[0] or r == refs[-1]:
                if len(cur) > 1: edges.append({'refs': cur, 'name': name, 'kind': kind, 'bridge': [bridge] * (len(cur) - 1),
                                               'tunnel': t.get('tunnel') not in (None, 'no'), 'hw': t.get('highway'), 'way': wid})
                cur = [r]
    for e in edges: e['len'] = sum(hv(nodes[a], nodes[b]) for a, b in zip(e['refs'], e['refs'][1:]))
    n0 = len(edges)
    edges = [e for e in edges if e['kind'] != 'connector' or e['len'] <= cfg['connectorM'] or ROUTES.follows([nodes[r] for r in e['refs']], 0.7)]
    for e in edges:
        if e['kind'] == 'connector': e['kind'] = 'primary'
    print(f'  raw edges: {len(edges)} ({n0 - len(edges)} boulevard stretches longer than {cfg["connectorM"]} m left out)')

    # positions: per OSM node; graph nodes are union-find clusters of OSM junction nodes
    parent = {}
    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x]); x = parent[x]
        return x
    def union(a, b):
        a, b = find(a), find(b)
        if a != b: parent[b] = a

    # 3. merge junctions joined by a very short edge (dual carriageways, offset crossings)
    for e in edges:
        if e['len'] < cfg['mergeM']: union(e['refs'][0], e['refs'][-1])
    # …and junctions of different ways that sit on top of each other without sharing a node (mapped a metre apart)
    ends = defaultdict(list)
    for e in edges:
        for r in (e['refs'][0], e['refs'][-1]):
            la, lo = nodes[r]; ends[(round(la * 2000), round(lo * 1500))].append(r)   # ~55 m × ~55 m buckets
    for bucket in ends.values():
        for i, a in enumerate(bucket):
            for b in bucket[i + 1:]:
                if a != b and hv(nodes[a], nodes[b]) < cfg['snapM']: union(a, b)

    def build_graph(edges):
        g = defaultdict(list)
        for k, e in enumerate(edges):
            g[find(e['refs'][0])].append(k); g[find(e['refs'][-1])].append(k)
        return g

    edges = [e for e in edges if find(e['refs'][0]) != find(e['refs'][-1]) or e['len'] > cfg['minLoopM']]
    # 4. parallel duplicates: the same two junctions, nearly the same length → keep the longer (one per carriageway pair)
    best = {}
    for k, e in enumerate(edges):
        a, b = sorted((find(e['refs'][0]), find(e['refs'][-1])))
        if a == b: continue
        key = (a, b)
        for j in best.get(key, []):
            o = edges[j]
            if abs(o['len'] - e['len']) < max(cfg['dupM'], 0.15 * max(o['len'], e['len'])):
                if e['len'] > o['len']: edges[j] = e
                e = None; break
        if e is not None: best.setdefault(key, []).append(k)
    edges = [edges[k] for ks in best.values() for k in ks] + [e for e in edges if find(e['refs'][0]) == find(e['refs'][-1])]

    # 5/6/7. prune short dead-end spurs, keep the largest connected piece, join degree-2 nodes away
    for _ in range(3):
        g = build_graph(edges)
        drop = set()
        for n, ks in g.items():
            if len(ks) == 1 and edges[ks[0]]['len'] < cfg['spurM'] and not ROUTES.follows([nodes[r] for r in edges[ks[0]]['refs']]): drop.add(ks[0])
        edges = [e for k, e in enumerate(edges) if k not in drop]
    g = build_graph(edges)
    seen, comps = set(), []
    for n in g:
        if n in seen: continue
        comp, stack = [], [n]
        seen.add(n)
        while stack:
            x = stack.pop(); comp.append(x)
            for k in g[x]:
                e = edges[k]
                for y in (find(e['refs'][0]), find(e['refs'][-1])):
                    if y not in seen: seen.add(y); stack.append(y)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    REVIEW['pieces'] = [[e for e in edges if find(e['refs'][0]) in set(c)] for c in comps[1:]]   # (tools/review_pgh.py)
    main = set(comps[0])
    lost = sum(1 for e in edges if find(e['refs'][0]) not in main)
    edges = [e for e in edges if find(e['refs'][0]) in main]
    print(f'  connected pieces: {len(comps)}; kept the largest ({len(main)} nodes); dropped {lost} edges in {len(comps) - 1} smaller pieces')

    # join through degree-2 nodes (not a choice): walk chains
    g = build_graph(edges)
    def other_end(e, n): return find(e['refs'][-1]) if find(e['refs'][0]) == n else find(e['refs'][0])
    joint = lambda n: len(g[n]) == 2 and g[n][0] != g[n][1]
    used, chains = set(), []
    def oriented(e, start):   # the edge's refs, bridge flags as ridden from cluster `start`
        if find(e['refs'][0]) == start: return e['refs'], e['bridge']
        return e['refs'][::-1], e['bridge'][::-1]
    for k, e in enumerate(edges):
        if k in used: continue
        # walk back to a real junction
        a = find(e['refs'][0]); cur = k
        guard = 0
        while joint(a) and guard < 100000:
            nk = g[a][0] if g[a][1] == cur else g[a][1]
            if nk == k: break   # a ring of degree-2 nodes
            cur = nk; a = other_end(edges[cur], a); guard += 1
        start, k0 = a, cur
        refs, br, parts, n = [], [], [], start
        cur = k0
        while True:
            used.add(cur)
            r, b = oriented(edges[cur], n)
            refs += r if not refs else r[1:]; br += b
            parts.append(edges[cur])
            n = other_end(edges[cur], n)
            if not joint(n): break
            nk = g[n][0] if g[n][1] == cur else g[n][1]
            if nk in used: break
            cur = nk
        named = defaultdict(float)
        for p in parts: named[p['name']] += p['len']
        kind = max(parts, key=lambda p: p['len'])['kind']
        hws = defaultdict(float)
        for p in parts: hws[p['hw']] += p['len']
        chains.append({'a': start, 'b': n, 'refs': refs, 'bridge': br, 'kind': kind, 'hw': max(hws.items(), key=lambda x: x[1])[0],
                       'name': max(named.items(), key=lambda x: x[1])[0], 'names': [k for k, v in sorted(named.items(), key=lambda x: -x[1]) if k]})
    print(f'  graph: {len(chains)} edges after joining through bends')

    # junction positions: the mean of their OSM nodes
    members = defaultdict(set)
    for c in chains:
        members[c['a']].add(c['refs'][0]); members[c['b']].add(c['refs'][-1])
    jpos = {n: (sum(nodes[r][0] for r in ms) / len(ms), sum(nodes[r][1] for r in ms) / len(ms)) for n, ms in members.items()}
    return nodes, chains, jpos, cor


_wet = {}
_wdist = {}


def wet(la, lo, pool):
    key = (round(la, 5), round(lo, 5))
    if key not in _wet: _wet[key] = elevation(la, lo) < pool + 1.2
    return _wet[key]


def water_dist(la, lo, pool, reach):
    """Metres to the nearest river (the terrain at the pool), looking out in 8 directions every 10 m; > reach: none."""
    key = (round(la, 4), round(lo, 4), reach)
    if key in _wdist: return _wdist[key]
    kx = 111320 * math.cos(math.radians(la))
    out = reach + 1
    for d in range(0, int(reach) + 1, 10):
        dirs = [(0, 0)] if d == 0 else [(math.cos(a), math.sin(a)) for a in (k * math.pi / 4 for k in range(8))]
        if any(wet(la + dy * d / 110540, lo + dx * d / kx, pool) for dx, dy in dirs): out = d; break
    _wdist[key] = out
    return out


def heights(cfg, nodes, chains, jpos):
    """Per edge: 10 m samples with heights. Bridges interpolated between their ground ends, at least `bridgeClearM`
    over the river (ramping down at `bridgeRampPct` away from it); streets and trails beside the river at least
    `riverFloorM` above the pool; smoothed (twice as long beside the river); ends pinned."""
    pool = cfg['waterLevelM']
    clear, ramp, rfloor = cfg['bridgeClearM'], cfg['bridgeRampPct'] / 100, cfg['riverFloorM']
    reach = clear / ramp
    def deck_floor(la, lo):
        d = water_dist(la, lo, pool, reach)
        return pool + clear - ramp * d if d <= reach else -1e9
    riverside = lambda la, lo: water_dist(la, lo, pool, cfg['riversideM']) <= cfg['riversideM']
    # bridge chains: OSM nodes on bridge segments, grouped by touching; ground ends get the terrain height
    on_bridge = defaultdict(int); off_bridge = set()
    adj = defaultdict(set)
    for c in chains:
        for (a, b), br in zip(zip(c['refs'], c['refs'][1:]), c['bridge']):
            if br: on_bridge[a] += 1; on_bridge[b] += 1; adj[a].add(b); adj[b].add(a)
            else: off_bridge.add(a); off_bridge.add(b)
    deck, crossing = {}, {}
    seen = set()
    for start in list(adj):
        if start in seen: continue
        comp, stack = [], [start]; seen.add(start)
        while stack:
            x = stack.pop(); comp.append(x)
            for y in adj[x]:
                if y not in seen: seen.add(y); stack.append(y)
        # does this bridge cross the river (≥ 40 m of it over water)? Only those get the clearance (not a boardwalk on the bank)
        wet_m, done = 0, set()
        for x in comp:
            for y in adj[x]:
                if (y, x) in done: continue
                done.add((x, y))
                L = hv(nodes[x], nodes[y]); k = max(1, int(L / 10))
                wet_m += sum(10 for t in range(k + 1) if wet(nodes[x][0] + (nodes[y][0] - nodes[x][0]) * t / k, nodes[x][1] + (nodes[y][1] - nodes[x][1]) * t / k, pool))
        for x in comp: crossing[x] = wet_m >= 40
        grounds = [x for x in comp if x in off_bridge or len(adj[x]) == 1]
        if not grounds: grounds = [comp[0]]
        gh = {}
        for x in grounds:
            la, lo = nodes[x]
            # the abutment: the highest ground within a few metres (a bridge end on a river wall samples the river)
            # (a river bridge's end on a river wall reads the river: look 20 m round for the bank top; others 6 m)
            radii = (6, 20) if crossing.get(x) else (6,)
            ring = [(0, 0)] + [(r * math.sin(a) / 110540, r * math.cos(a) / (111320 * math.cos(math.radians(la)))) for r in radii for a in (k * math.pi / 4 for k in range(8))]
            gh[x] = max(max(elevation(la + dy, lo + dx) for dy, dx in ring), pool + rfloor)
        # inverse-distance (along the deck) blend of the ground ends' heights
        for gx in grounds:
            dist = {gx: 0.0}; heap = [(0.0, gx)]
            import heapq
            while heap:
                d, x = heapq.heappop(heap)
                if d > dist[x]: continue
                for y in adj[x]:
                    nd = d + hv(nodes[x], nodes[y])
                    if nd < dist.get(y, 1e18): dist[y] = nd; heapq.heappush(heap, (nd, y))
            for x, d in dist.items():
                w = 1 / max(d, 1.0) ** 2
                s = deck.setdefault(x, [0.0, 0.0]); s[0] += w * gh[gx]; s[1] += w
    deck = {x: max(s[0] / s[1], deck_floor(*nodes[x]) if crossing.get(x) else pool + rfloor) for x, s in deck.items()}

    def node_h(r):
        if r in deck: return deck[r]
        h = elevation(*nodes[r])
        return max(h, pool + rfloor) if riverside(*nodes[r]) else h
    jh = {}
    for c in chains:
        for end, r in ((c['a'], c['refs'][0]), (c['b'], c['refs'][-1])):
            jh.setdefault(end, []).append(node_h(r))
    jh = {n: sum(v) / len(v) for n, v in jh.items()}

    out = []
    for c in chains:
        P = [nodes[r] for r in c['refs']]
        P[0], P[-1] = jpos[c['a']], jpos[c['b']]
        cum = [0.0]
        for a, b in zip(P, P[1:]): cum.append(cum[-1] + hv(a, b))
        L = cum[-1]
        n = max(1, round(L / STEP))
        lat, lon, ele, brs, rs = [], [], [], [], []
        j = 0
        for i in range(n + 1):
            d = L * i / n
            while j < len(P) - 2 and cum[j + 1] < d: j += 1
            f = 0 if cum[j + 1] == cum[j] else (d - cum[j]) / (cum[j + 1] - cum[j])
            f = min(1, max(0, f))
            la, lo = P[j][0] + (P[j + 1][0] - P[j][0]) * f, P[j][1] + (P[j + 1][1] - P[j][1]) * f
            lat.append(la); lon.append(lo)
            if c['bridge'][j]:
                ha, hb = node_h(c['refs'][j]), node_h(c['refs'][j + 1])
                over = crossing.get(c['refs'][j]) or crossing.get(c['refs'][j + 1])
                ele.append(max(ha + (hb - ha) * f, deck_floor(la, lo) if over else pool + rfloor)); brs.append(1); rs.append(0)
            else:
                h, r = elevation(la, lo), riverside(la, lo)
                ele.append(max(h, pool + rfloor) if r else h); brs.append(0); rs.append(r)
        # smooth (not on bridge decks), ends pinned to the junctions
        w = max(1, round(cfg['smoothM'] / (L / n))) if n > 2 else 0
        sm = ele[:]
        for _ in range(3):
            src = sm[:]
            for i in range(1, n):
                if brs[i]: continue
                ww = 2 * w if rs[i] else w   # (beside the river: twice as long)
                a, b = max(0, i - ww), min(n, i + ww)
                sm[i] = sum(src[a:b + 1]) / (b - a + 1)
        h0, h1 = jh[c['a']], jh[c['b']]
        d0, d1 = h0 - sm[0], h1 - sm[n]
        # pin: blend the offsets at the ends into the profile over its length (no step at a junction)
        sm = [sm[i] + d0 * (1 - i / n) + d1 * (i / n) for i in range(n + 1)]
        # onto and off a deck: the street eases onto the deck's end at ≤ bridgeRampPct for up to 120 m (not the edge's own ends)
        sp, rmp = L / n, cfg['bridgeRampPct'] / 100
        for b in range(n + 1):
            if not brs[b]: continue
            for step in (1, -1):
                if not (0 <= b + step <= n) or brs[b + step]: continue
                for t in range(1, 13):
                    i = b + step * t
                    if i <= 0 or i >= n or brs[i]: break
                    d = t * sp
                    sm[i] = min(max(sm[i], sm[b] - rmp * d), sm[b] + rmp * d)
        # no steeper than maxGradePct over a 10 m step (the terrain tiles sample the hillside beside a street cut
        # into it): clamp forward from the start, then backward from the end (both ends stay on their junctions)
        g = max(cfg['maxGradePct'] / 100 * (L / n), abs(sm[n] - sm[0]) / n * 1.02)   # (an edge steeper on average: even)
        for _ in range(2):
            for i in range(1, n):
                sm[i] = min(max(sm[i], sm[i - 1] - g), sm[i - 1] + g)
            for i in range(n - 1, 0, -1):
                sm[i] = min(max(sm[i], sm[i + 1] - g), sm[i + 1] + g)
        # round the corner where a deck meets the street: a few passes of a 5-sample average across each deck end
        ends = [b for b in range(n) if brs[b] != brs[b + 1]]
        for _ in range(4):
            for b in ends:
                src = sm[:]
                for i in range(max(1, b - 2), min(n - 1, b + 3) + 1):
                    a0, a1 = max(0, i - 2), min(n, i + 2)
                    sm[i] = sum(src[a0:a1 + 1]) / (a1 - a0 + 1)
        for _ in range(2):   # (and the grade cap again)
            for i in range(1, n):
                sm[i] = min(max(sm[i], sm[i - 1] - g), sm[i - 1] + g)
            for i in range(n - 1, 0, -1):
                sm[i] = min(max(sm[i], sm[i + 1] - g), sm[i + 1] + g)
        out.append({**c, 'lat': lat, 'lon': lon, 'ele': sm, 'br': brs, 'n': n, 'L': L})
    return out, jh


# ------------------------------------------------------------------ simplify (after heights: on the edges themselves)
LINKS = {'primary_link', 'secondary_link', 'tertiary_link', 'trunk', 'trunk_link'}
MINOR = {'service', 'footway', 'path', 'cycleway', 'pedestrian', 'track', 'bridleway', 'living_street'}


class Graph:
    """Edges by index with live degrees; removal keeps every junction on ≥ 2 ways and the network in one piece."""
    def __init__(self, E):
        self.E, self.gone = E, set()
        self.adj, self.deg = defaultdict(list), defaultdict(int)
        for k, e in enumerate(E):
            self.adj[e['a']].append(k); self.adj[e['b']].append(k)
            if e['a'] != e['b']: self.deg[e['a']] += 1; self.deg[e['b']] += 1   # (a loop back to the same junction is no way on)

    def connected_without(self, k):
        e = self.E[k]
        if e['a'] == e['b']: return True
        seen, st = {e['a']}, [e['a']]
        while st:
            x = st.pop()
            for j in self.adj[x]:
                if j == k or j in self.gone: continue
                o = self.E[j]
                for y in (o['a'], o['b']):
                    if y == e['b']: return True
                    if y not in seen: seen.add(y); st.append(y)
        return False

    def can_remove(self, k, force=False):
        e = self.E[k]
        if protected(e) and not force: return False   # (a way the Pittsburgh routes ride)
        return k not in self.gone and self.deg[e['a']] >= 3 and self.deg[e['b']] >= 3 and self.connected_without(k)

    def remove(self, k):
        e = self.E[k]
        self.gone.add(k)
        if e['a'] != e['b']: self.deg[e['a']] -= 1; self.deg[e['b']] -= 1


def dense_nodes(cfg, E, gone=()):
    parent = {}
    def f(x):
        while parent.get(x, x) != x: parent[x] = parent.get(parent[x], parent[x]); x = parent[x]
        return x
    for k, e in enumerate(E):
        if k not in gone and e['L'] < cfg['denseM'] and e['a'] != e['b']: parent[f(e['a'])] = f(e['b'])
    clusters = defaultdict(set)
    for k, e in enumerate(E):
        if k in gone: continue
        for n in (e['a'], e['b']): clusters[f(n)].add(n)
    return [c for c in clusters.values() if len(c) >= 3]


def simplify_plan(cfg, E, G=None):
    """The ways that can go, in order (turn slips, short trail and crosswalk bits, short minor ways and very short links in
    dense clusters, trails on a bridge beside its road, then alleys), each only if no junction is left with < 2 ways and
    the network stays in one piece. Returns [(k, why)] and removes them from G (a dry run makes its own)."""
    G = G or Graph(E)
    dense = dense_nodes(cfg, E, G.gone)
    in_dense = {n for c in dense for n in c}
    order = sorted(range(len(E)), key=lambda k: E[k]['L'])
    # bridge decks of roads (not trails), on a 30 m hash: a trail deck beside one is the same bridge's walkway
    decks = defaultdict(list)
    for k, e in enumerate(E):
        if e['kind'] == 'path' or not any(e['br']): continue
        for i in range(e['n'] + 1):
            if e['br'][i]: decks[(int(e['lat'][i] * 3700), int(e['lon'][i] * 2800))].append(k)
    def beside_road_deck(e):
        hits = total = 0
        for i in range(e['n'] + 1):
            if not e['br'][i]: continue
            total += 1
            ky = (int(e['lat'][i] * 3700), int(e['lon'][i] * 2800))
            if any(decks.get((ky[0] + a, ky[1] + b)) for a in (-1, 0, 1) for b in (-1, 0, 1)): hits += 1
        return total >= 3 and hits >= 0.7 * total
    rules = [
        # (a trunk road is a link only where the city keeps trunks as crossings — SKAN rides US 20 as its villages' main
        # street, whose short pieces between junctions are not slips)
        ('turn slip / link', lambda e: e['hw'] in LINKS and e['L'] < 150 and (e['hw'] not in ('trunk',) or 'trunk' in cfg['connectors'])),
        ('short trail or crosswalk piece', lambda e: e['kind'] == 'path' and e['L'] < cfg['denseM']),
        ('short minor way in a dense cluster', lambda e: e['L'] < cfg['denseM'] and (e['hw'] in MINOR or e['kind'] == 'alley') and (e['a'] in in_dense or e['b'] in in_dense)),
        ('very short link inside a dense cluster', lambda e: e['L'] < 25 and e['a'] in in_dense and e['b'] in in_dense),
        ('trail on a bridge beside its road', lambda e: e['kind'] == 'path' and any(e['br']) and beside_road_deck(e)),
    ]
    if cfg.get('removeAlleys'): rules.append(('alley', lambda e: e['kind'] == 'alley'))
    out = []
    for why, rule in rules:
        for k in order:
            if k in G.gone or not rule(E[k]): continue
            if G.can_remove(k): G.remove(k); out.append((k, why))
    return out


def find_crossings(E, gone=(), clear=4.5):
    """Two ways crossing (not at a junction) less than `clear` apart in height: [(k_over, t_over, k_under, t_under, gap)]
    with t = metres along each edge; the over-way is the one on a bridge deck there (else the higher)."""
    lat0 = sum(E[0]['lat']) / len(E[0]['lat'])
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    grid = defaultdict(list)
    for k, e in enumerate(E):
        if k in gone: continue
        for i in range(e['n']):
            x0, y0, x1, y1 = e['lon'][i] * kx, e['lat'][i] * ky, e['lon'][i + 1] * kx, e['lat'][i + 1] * ky
            grid[(int((x0 + x1) / 80), int((y0 + y1) / 80))].append((k, i, x0, y0, x1, y1))
    out, seen = [], set()
    for (cx, cy), segs in grid.items():
        near = [s for a in (-1, 0, 1) for b in (-1, 0, 1) for s in grid.get((cx + a, cy + b), ())]
        for A in segs:
            for Bs in near:
                ka, kb = A[0], Bs[0]
                if ka >= kb: continue
                ea, eb = E[ka], E[kb]
                if {ea['a'], ea['b']} & {eb['a'], eb['b']}: continue
                (_, i, ax0, ay0, ax1, ay1), (_, j, bx0, by0, bx1, by1) = A, Bs
                d = (bx1 - bx0) * (ay1 - ay0) - (by1 - by0) * (ax1 - ax0)
                if abs(d) < 1e-9: continue
                t = ((bx0 - ax0) * (by1 - by0) - (by0 - ay0) * (bx1 - bx0)) / -d
                u = ((bx0 - ax0) * (ay1 - ay0) - (by0 - ay0) * (ax1 - ax0)) / -d
                if not (0.02 < t < 0.98 and 0.02 < u < 0.98) or (ka, kb) in seen: continue
                ha = ea['ele'][i] + (ea['ele'][i + 1] - ea['ele'][i]) * t
                hb = eb['ele'][j] + (eb['ele'][j + 1] - eb['ele'][j]) * u
                if abs(ha - hb) >= clear: continue
                seen.add((ka, kb))
                ba, bb = ea['br'][i] or ea['br'][i + 1], eb['br'][j] or eb['br'][j + 1]
                over_a = ba if ba != bb else ha >= hb
                sa, sb = (i + t) * ea['L'] / ea['n'], (j + u) * eb['L'] / eb['n']
                out.append((ka, sa, kb, sb, abs(ha - hb)) if over_a else (kb, sb, ka, sa, abs(ha - hb)))
    return out


def bump(e, at, dh, R):
    """Raise (dh > 0) or lower an edge's profile by dh at `at` metres, easing out over R metres either side."""
    sp = e['L'] / e['n']
    for i in range(e['n'] + 1):
        d = abs(i * sp - at)
        if d < R: e['ele'][i] += dh * 0.5 * (1 + math.cos(math.pi * d / R))


def fix_crossings(cfg, E, G):
    """Every near-level crossing clears by `overpassClearM`: dip the way under (not on a deck) with 8 % easings, else lift
    the deck over it, else remove the minor of the two (when it can go), else report it."""
    need_c, fixed, removed, left = cfg['overpassClearM'], 0, [], []
    for _ in range(3):
        xs = find_crossings(E, G.gone, need_c)
        if not xs: break
        for ko, so, ku, su, gap in xs:
            if ko in G.gone or ku in G.gone: continue
            eo, eu = E[ko], E[ku]
            need = need_c + 0.3 - (_h(eo, so) - _h(eu, su))   # (a little over: the crossing falls between samples)
            if need <= 0: continue
            iu = min(eu['n'], round(su / (eu['L'] / eu['n'])))
            io = min(eo['n'], round(so / (eo['L'] / eo['n'])))
            room_u = min(su, eu['L'] - su) - 5 if not eu['br'][iu] else -1   # metres the dip can ease out over
            room_o = min(so, eo['L'] - so) - 5 if eo['br'][io] else -1       # …and the lift (only a deck is lifted)
            done = False
            # easings from 8 % up to 16 %; the way under alone, the deck alone, or half each
            for slope in (0.08, 0.12, 0.16):
                R = max(12.0, need / slope)
                if room_u >= R: bump(eu, su, -need, R); done = True
                elif room_o >= R: bump(eo, so, need, R); done = True
                elif min(room_u, room_o) >= max(12.0, need / 2 / slope):
                    r = max(12.0, need / 2 / slope); bump(eu, su, -need / 2, r); bump(eo, so, need / 2, r); done = True
                if done: break
            if done: fixed += 1
            else:
                cand = sorted((ko, ku), key=lambda k: (E[k]['kind'] not in ('path', 'alley'), E[k]['L']))
                k = next((k for k in cand if G.can_remove(k)), None)
                if k is not None: G.remove(k); removed.append((k, 'way under or over a crossing that cannot clear'))
                else: left.append((ko, ku))
    return fixed, removed, left


def _h(e, s):
    sp = e['L'] / e['n']; i = min(e['n'] - 1, int(s / sp)); f = s / sp - i
    return e['ele'][i] + (e['ele'][i + 1] - e['ele'][i]) * f


def merge_through(E):
    """Join edges through junctions left with two ways (not a choice any more): one edge, samples end to end."""
    E = list(E)
    flip = lambda e: {**e, 'a': e['b'], 'b': e['a'], 'lat': e['lat'][::-1], 'lon': e['lon'][::-1], 'ele': e['ele'][::-1], 'br': e['br'][::-1]}
    while True:
        ends = defaultdict(list)
        for k, e in enumerate(E):
            ends[e['a']].append((k, 0)); ends[e['b']].append((k, 1))
        used, merged = set(), []
        for n, l in ends.items():
            if len(l) != 2 or l[0][0] == l[1][0]: continue
            (k1, s1), (k2, s2) = l
            if k1 in used or k2 in used: continue
            used.update((k1, k2))
            e1, e2 = E[k1], E[k2]
            if s1 == 0: e1 = flip(e1)   # e1 now ends at n
            if s2 == 1: e2 = flip(e2)   # e2 now starts at n
            big = e1 if e1['L'] >= e2['L'] else e2
            merged.append({**big, 'prot': None, 'rshare': None, 'a': e1['a'], 'b': e2['b'], 'lat': e1['lat'] + e2['lat'][1:], 'lon': e1['lon'] + e2['lon'][1:],
                           'ele': e1['ele'] + e2['ele'][1:], 'br': e1['br'] + e2['br'][1:], 'n': e1['n'] + e2['n'], 'L': e1['L'] + e2['L']})
        if not merged: return E
        E = [e for k, e in enumerate(E) if k not in used] + merged


def finish(cfg, E):
    """After heights: simplify, clear the crossings, join through two-way junctions."""
    by = defaultdict(lambda: [0, 0.0])
    for _ in range(6):   # (joining through two-way junctions makes new candidates: again until nothing more goes)
        G = Graph(E)
        plan = simplify_plan(cfg, E, G)
        for k, w in plan: by[w][0] += 1; by[w][1] += E[k]['L']
        E = merge_through([e for k, e in enumerate(E) if k not in G.gone])
        if not plan: break
    G = Graph(E)
    fixed, removed, left = fix_crossings(cfg, E, G)
    for k, w in removed: by[w][0] += 1; by[w][1] += E[k]['L']
    for w, (n, L) in by.items(): print(f'    removed {n} ({L / 1000:.1f} km): {w}')
    print(f'  crossings: {fixed} cleared by a dip or a lifted deck, {len(removed)} by removing a way, {len(left)} left')
    E = merge_through([e for k, e in enumerate(E) if k not in G.gone])
    return E


def drop_unrideable(cfg, E):
    """Edges steeper on average than maxAvgGradePct (a staircase street, a junction height that can't be met) are not
    rideable: drop them, then keep only the largest connected piece again."""
    lim = cfg['maxAvgGradePct'] / 100
    bad = [e for e in E if abs(e['ele'][-1] - e['ele'][0]) > lim * max(e['L'], 1)]
    for e in bad: print(f'    too steep to ride: {e["name"] or e["kind"]} ({abs(e["ele"][-1] - e["ele"][0]) / max(e["L"], 1) * 100:.0f} % over {e["L"]:.0f} m)')
    E = [e for e in E if e not in bad]
    adj = defaultdict(list)
    for e in E: adj[e['a']].append(e['b']); adj[e['b']].append(e['a'])
    best = set()
    seen = set()
    for n in adj:
        if n in seen: continue
        comp, stack = {n}, [n]; seen.add(n)
        while stack:
            for y in adj[stack.pop()]:
                if y not in seen: seen.add(y); comp.add(y); stack.append(y)
        if len(comp) > len(best): best = comp
    out = [e for e in E if e['a'] in best]
    print(f'  dropped {len(bad)} edges too steep to ride, and {len(E) - len(out)} cut off by them')
    return out


def junction_name(names):
    uniq = []
    for x in names:
        if x and x not in uniq: uniq.append(x)
    if len(uniq) >= 2: return f'{uniq[0]} & {uniq[1]}'
    if uniq: return uniq[0]
    return 'Trail junction'


def write(cfg, E, jpos, jh, cor):
    ids = {n: f'n{i}' for i, n in enumerate(sorted(jpos, key=lambda n: (jpos[n][0], jpos[n][1])))}
    names = defaultdict(list)
    for e in E:
        names[e['a']].append(e['name']); names[e['b']].append(e['name'])
    lat0 = sum(p[0] for p in jpos.values()) / len(jpos); lon0 = sum(p[1] for p in jpos.values()) / len(jpos)
    nodes_out = []
    for n in sorted(jpos, key=lambda n: ids[n][1:] and int(ids[n][1:])):
        nodes_out.append({'id': ids[n], 'name': junction_name(sorted(names[n], key=lambda x: (x == '', names[n].count(x) * -1))),
                          'lat': round(jpos[n][0], 6), 'lon': round(jpos[n][1], 6), 'ele': round(jh[n], 1)})
    edges_out = []
    for i, e in enumerate(sorted(E, key=lambda e: (ids[e['a']], ids[e['b']]))):
        la = [round(v * 1e6) for v in e['lat']]; lo = [round(v * 1e6) for v in e['lon']]; el = [round(v * 10) for v in e['ele']]
        # first value absolute, then deltas (compact JSON)
        d = lambda a: [a[0]] + [a[k] - a[k - 1] for k in range(1, len(a))]
        rec = {'id': f'e{i}', 'from': ids[e['a']], 'to': ids[e['b']], 'name': e['name'] or ('Trail' if e['kind'] == 'path' else 'Alley' if e['kind'] == 'alley' else 'Street'),
               'kind': e['kind'], 'lat': d(la), 'lon': d(lo), 'ele': d(el)}
        if any(e['br']):
            runs, k = [], 0
            while k <= e['n']:
                if e['br'][k]:
                    j = k
                    while j + 1 <= e['n'] and e['br'][j + 1]: j += 1
                    runs.append([max(0, k - 1), min(e['n'], j + 1)]); k = j + 1
                else: k += 1
            rec['bridges'] = runs
        edges_out.append(rec)
    files = cfg.get('files') or {'map': 'routes/cities/pittsburgh-map.json', 'ground': 'routes/cities/pgh-ground.grid.bin.gz', 'shore': 'routes/cities/pgh-shore.json', 'dressing': 'routes/cities/pgh-dressing.json',
             'heroes': 'routes/cities/pgh-heroes.json', 'bridges': 'routes/cities/pgh-bridges.json', 'cityData': 'routes/cities/pgh-city.json'}
    labels = cfg.get('mapLabels') or PGH_MAP_LABELS
    out = {'format': 'bikefree-graph-1', 'id': CITY, 'name': cfg.get('name', 'PGH'), 'city': cfg.get('cityName', 'Pittsburgh, PA'),
           'attribution': 'Map data © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles (USGS 3DEP)',
           'origin': {'lat': round(lat0, 6), 'lon': round(lon0, 6)}, 'unit': {'latlon': 1e-6, 'ele': 0.1},
           'widths': cfg['widths'], 'waterLevelM': cfg['waterLevelM'], **files,
           # the card's map (js/app.js): a few neighbourhoods named, no landmark dots (user, 21 Nov: "greatly simplify")
           'mapLabels': [{'text': t, 'lat': la, 'lon': lo, 'kind': 'area', 'rank': r} for t, la, lo, r in labels], 'pools': cfg.get('pools', []), 'start': cfg.get('start'),
           'nodes': nodes_out, 'edges': edges_out}
    path = os.path.join(ROOT, 'routes', 'cities', f'{CITY}.json')
    open(path, 'w').write(json.dumps(out, separators=(',', ':')))
    km = sum(e['n'] * STEP for e in E) / 1000
    print(f'  wrote {os.path.relpath(path, ROOT)}: {len(nodes_out)} junctions, {len(edges_out)} edges, {km:.0f} km of rideable way, {os.path.getsize(path) / 1e6:.1f} MB')
    return out


def write_ground(cfg, E):
    """The ground: terrain heights on a `groundCellM` grid over the graph's box (+ margin), as a terrain-grid container."""
    la = [v for e in E for v in e['lat']]; lo = [v for e in E for v in e['lon']]
    m = cfg['groundMarginM']
    lat0 = (min(la) + max(la)) / 2
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    north, south = max(la) + m / ky, min(la) - m / ky
    west, east = min(lo) - m / kx, max(lo) + m / kx
    cell = cfg['groundCellM']
    nx = int(math.ceil((east - west) * kx / cell)) + 1
    ny = int(math.ceil((north - south) * ky / cell)) + 1
    east = west + (nx - 1) * cell / kx; south = north - (ny - 1) * cell / ky
    base, scale = 100.0, 0.1
    rows = bytearray()
    for j in range(ny):
        acc = 0
        for i in range(nx):
            h = elevation(north - j * cell / ky, west + i * cell / kx)
            v = max(0, min(65535, round((h - base) / scale)))
            rows += struct.pack('<H', (v - acc) & 0xffff); acc = v
    header = {'format': 'bikefree-terrain-grid-1', 'rowDelta': True, 'attribution': 'Elevation: AWS Terrain Tiles (USGS 3DEP, NOAA and others)',
              'north': north, 'west': west, 'south': south, 'east': east, 'base': base, 'scale': scale, 'cellM': cell,
              'coarse': {'nx': nx, 'ny': ny, 'step': 1, 'h': {'$bin': [0, len(rows)]}},
              'fine': {'cellM': cell, 'block': 64, 'bnx': 1, 'bny': 1, 'nx': nx, 'ny': ny, 'blocks': [], 'h': {'$bin': [len(rows), 0]}}}
    js = json.dumps(header, separators=(',', ':')).encode()
    pad = (4 - (8 + len(js)) % 4) % 4
    blob = b'BFTG' + struct.pack('<I', len(js)) + js + b'\0' * pad + bytes(rows)
    path = os.path.join(ROOT, cfg['groundFile'])
    open(path, 'wb').write(gzip.compress(blob, 9))
    print(f'  wrote {cfg["groundFile"]}: {nx} × {ny} at {cell} m, {os.path.getsize(path) / 1e6:.2f} MB')


def prune_dead_ends(E, keep_bridges=True):
    """Peel every dead-end branch off the graph (a junction with one way in, then the one it leaves, …), except a bridge:
    peeling stops at an edge with a deck on it. Returns (edges kept, removed count, km)."""
    G = Graph(E)
    stack = [n for n, d in G.deg.items() if d == 1]
    removed = 0
    while stack:
        n = stack.pop()
        if G.deg.get(n, 0) != 1: continue
        k = next((k for k in G.adj[n] if k not in G.gone and E[k]['a'] != E[k]['b']), None)
        if k is None or (keep_bridges and any(E[k]['br'])) or protected(E[k]): continue
        G.remove(k); removed += 1
        for end in (E[k]['a'], E[k]['b']):
            if G.deg.get(end, 0) == 1: stack.append(end)
    km = sum(E[k]['L'] for k in G.gone) / 1000
    keep = [e for k, e in enumerate(E) if k not in G.gone]
    # a loop left hanging on its own (a lollipop whose stem went) is dropped with the smaller pieces later
    return keep, removed, km


def trim_to_circle(cfg, E):
    """A city drawn as a circle is built over the circle plus a margin (area.marginM), so a road that leaves it can loop
    back: cut at the circle's edge, every through road would be a dead end, and pruning peels it back to the last junction
    inside — the circle's rim left empty. Here the ways wholly outside the circle go again, farthest first, each only if
    taking it (and peeling the dead ends it leaves) costs no way inside: what's left outside closes a loop that serves
    the inside. Returns (edges, removed, km)."""
    shape = shape_of(cfg)
    if shape:   # (circle + corridors: the metres beyond the shape, 0 inside)
        R = 0.0
        near = lambda e: min(shape.dist(la, lo, 1e9) for la, lo in zip(e['lat'], e['lon']))
    else:
        lat0, lon0, R = cfg['area']['circle']
        kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
        near = lambda e: min(math.hypot((lo - lon0) * kx, (la - lat0) * ky) for la, lo in zip(e['lat'], e['lon']))
    for e in E: e['_in'] = near(e)
    alive = set(range(len(E)))
    adj = defaultdict(set)
    for k, e in enumerate(E): adj[e['a']].add(k); adj[e['b']].add(k)
    def peel(start, alive):
        gone, st = set(), list(start)
        while st:
            n = st.pop()
            live = [k for k in adj[n] if k in alive and k not in gone and E[k]['a'] != E[k]['b']]
            if len(live) != 1: continue
            k = live[0]; gone.add(k)
            st += [E[k]['a'], E[k]['b']]
        return gone
    removed = 0
    for k in sorted((k for k, e in enumerate(E) if e['_in'] > R), key=lambda k: -E[k]['_in']):
        if k not in alive: continue
        trial = alive - {k}
        lost = {k} | peel([E[k]['a'], E[k]['b']], trial)
        if any(E[j]['_in'] <= R for j in lost): continue
        alive -= lost; removed += len(lost)
    out = [e for k, e in enumerate(E) if k in alive]
    km = sum(e['L'] for k, e in enumerate(E) if k not in alive) / 1000
    return out, removed, km


def resample(P, step=STEP):
    cum = [0.0]
    for a, b in zip(P, P[1:]): cum.append(cum[-1] + hv(a, b))
    L = cum[-1]; n = max(1, round(L / step)); out, j = [], 0
    for i in range(n + 1):
        d = L * i / n
        while j < len(P) - 2 and cum[j + 1] < d: j += 1
        f = 0 if cum[j + 1] == cum[j] else min(1, max(0, (d - cum[j]) / (cum[j + 1] - cum[j])))
        out.append((P[j][0] + (P[j + 1][0] - P[j][0]) * f, P[j][1] + (P[j + 1][1] - P[j][1]) * f, j))
    return out, L, n


def connect_dead_bridges(cfg, E, jpos, jh):
    """A bridge left as a dead end gets one connector: the shortest way (≤ connectMaxM) through any mapped highway that a
    bike could use (sidewalks and footways included; no motorways, steps or private ways) from its loose end to the
    nearest other way of the network. The connector's heights run from the deck's end to the way it meets, smoothed and
    capped, and it is joined onto the bridge as one edge with the corner rounded (no kink). Returns (E, report)."""
    import heapq
    nodes, ways = REVIEW['osm']
    pool, rfloor = cfg['waterLevelM'], cfg['riverFloorM']
    G = Graph(E)
    dead = []   # (bridge edge index, loose end node)
    for k, e in enumerate(E):
        if not any(e['br']) or e['a'] == e['b']: continue
        for end in (e['a'], e['b']):
            if G.deg.get(end, 0) == 1: dead.append((k, end))
    # the bikeable highway graph (wider than the ridden one)
    bad = {'motorway', 'motorway_link', 'steps', 'construction', 'proposed', 'raceway', 'elevator', 'bus_stop', 'platform', 'corridor'}
    adj = defaultdict(list)
    for refs, t in ways.values():
        if t.get('highway') in bad or t.get('bicycle') == 'no' or t.get('access') in ('private', 'no') or t.get('area') == 'yes': continue
        refs = [r for r in refs if r in nodes]
        for a, b in zip(refs, refs[1:]):
            d = hv(nodes[a], nodes[b]); adj[a].append((b, d)); adj[b].append((a, d))
    # every sample of the network on a ~40 m hash, to find where a search reaches the network
    hsh = defaultdict(list)
    cell = lambda la, lo: (int(la * 2760), int(lo * 2100))
    for k, e in enumerate(E):
        for i in range(e['n'] + 1): hsh[cell(e['lat'][i], e['lon'][i])].append((k, i))
    def hit(la, lo, skip):
        c, best, bd = cell(la, lo), None, cfg['connectSnapM']
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                for k, i in hsh.get((c[0] + a, c[1] + b), ()):
                    if k in skip: continue
                    d = hv((la, lo), (E[k]['lat'][i], E[k]['lon'][i]))
                    if d < bd: bd, best = d, (k, i)
        return best
    report, connectors, gone_bridges, splits = [], [], set(), defaultdict(list)
    for k, end in dead:
        e = E[k]
        p0 = jpos[end]
        name = e['name'] or 'Unnamed bridge'
        # the OSM node nearest the loose end
        near = min((r for r in adj if abs(nodes[r][0] - p0[0]) < 3e-4 and abs(nodes[r][1] - p0[1]) < 4e-4), key=lambda r: hv(nodes[r], p0), default=None)
        if near is None or hv(nodes[near], p0) > 15:
            report.append({'name': name, 'lat': p0[0], 'lon': p0[1], 'ok': False, 'msg': 'no mapped way at its loose end'}); continue
        h0 = e['ele'][-1] if e['b'] == end else e['ele'][0]   # (the deck's own end, not the junction's average)
        dist, prev, heap, found = {near: 0.0}, {}, [(0.0, near)], None
        while heap:
            d, x = heapq.heappop(heap)
            if d > dist[x] or d > cfg['connectMaxM']: continue
            if d > 12:
                h = hit(*nodes[x], {k})
                # a connector no steeper on average than connectMaxGradePct (else look further: no ramp up a cliff)
                if h and abs(E[h[0]]['ele'][h[1]] - h0) <= cfg['connectMaxGradePct'] / 100 * max(d, 1): found = (x, h); break
            for y, w in adj[x]:
                nd = d + w
                if nd < dist.get(y, 1e18): dist[y] = nd; prev[y] = x; heapq.heappush(heap, (nd, y))
        if not found:
            report.append({'name': name, 'lat': p0[0], 'lon': p0[1], 'ok': False, 'msg': f'no way to the network within {cfg["connectMaxM"]} m'}); continue
        x, (kt, it) = found
        path = [x]
        while path[-1] != near: path.append(prev[path[-1]])
        path = path[::-1]
        et = E[kt]
        P = [p0] + [nodes[r] for r in path[1:-1]] + [(et['lat'][it], et['lon'][it])]
        samples, L, n = resample(P)
        h1 = et['ele'][it]
        ele = []
        for la, lo, _ in samples:
            h = elevation(la, lo)
            ele.append(max(h, pool + rfloor) if water_dist(la, lo, pool, cfg['riversideM']) <= cfg['riversideM'] else h)
        w = max(1, round(cfg['smoothM'] / (L / n))) if n > 2 else 0
        for _ in range(3):
            src = ele[:]
            for i in range(1, n):
                a, b = max(0, i - w), min(n, i + w); ele[i] = sum(src[a:b + 1]) / (b - a + 1)
        d0, d1 = h0 - ele[0], h1 - ele[n]
        ele = [ele[i] + d0 * (1 - i / n) + d1 * (i / n) for i in range(n + 1)]
        # leave the deck at the deck's own grade, easing into the connector's profile over its first ~60 m (no kink)
        spe, sp = e['L'] / e['n'], L / n
        g_d = ((e['ele'][-1] - e['ele'][-2]) if e['b'] == end else (e['ele'][0] - e['ele'][1])) / spe if e['n'] >= 1 else 0
        m = min(10, n - 1)
        for i in range(1, m + 1):
            w = (i / (m + 1)) ** 2 * (3 - 2 * i / (m + 1))
            ele[i] = (h0 + g_d * i * sp) * (1 - w) + ele[i] * w
        connectors.append({'from': end, 'k': k, 'kt': kt, 'it': it, 'lat': [s_[0] for s_ in samples], 'lon': [s_[1] for s_ in samples],
                           'ele': ele, 'n': n, 'L': L, 'name': name})
        report.append({'name': name, 'lat': p0[0], 'lon': p0[1], 'ok': True, 'msg': f'connected to {et["name"] or "a way"} ({L:.0f} m)',
                       'line': [[round(a, 6), round(b, 6)] for a, b, _ in samples]})
    # split the ways the connectors meet (at the sample they meet), then add each connector joined onto its bridge
    for c in connectors: splits[c['kt']].append(c)
    out = []
    for k, e in enumerate(E):
        cs = splits.get(k)
        if not cs: out.append(e); continue
        cuts = sorted({c['it'] for c in cs if 0 < c['it'] < e['n']})
        for c in cs:
            c['to'] = e['a'] if c['it'] == 0 else e['b'] if c['it'] == e['n'] else f'cut:{k}:{c["it"]}'
        bounds = [0] + cuts + [e['n']]
        for a, b in zip(bounds, bounds[1:]):
            na = e['a'] if a == 0 else f'cut:{k}:{a}'; nb = e['b'] if b == e['n'] else f'cut:{k}:{b}'
            for i, nid in ((a, na), (b, nb)):
                if nid.startswith('cut:') if isinstance(nid, str) else False:
                    jpos[nid] = (e['lat'][i], e['lon'][i]); jh[nid] = e['ele'][i]
            out.append({**e, 'prot': None, 'rshare': None, 'a': na, 'b': nb, 'lat': e['lat'][a:b + 1], 'lon': e['lon'][a:b + 1], 'ele': e['ele'][a:b + 1], 'br': e['br'][a:b + 1],
                        'n': b - a, 'L': e['L'] * (b - a) / e['n']})
    g = cfg['maxGradePct'] / 100 * STEP
    bridges = {id(E[c['k']]): c for c in connectors}
    final = []
    for e in out:
        c = bridges.get(id(e))
        if not c: final.append(e); continue
        if e['b'] != c['from']: e = {**e, 'a': e['b'], 'b': e['a'], 'lat': e['lat'][::-1], 'lon': e['lon'][::-1], 'ele': e['ele'][::-1], 'br': e['br'][::-1]}
        j = e['n']
        m = {**e, 'b': c['to'], 'lat': e['lat'] + c['lat'][1:], 'lon': e['lon'] + c['lon'][1:], 'ele': e['ele'] + c['ele'][1:],
             'br': e['br'] + [0] * c['n'], 'n': e['n'] + c['n'], 'L': e['L'] + c['L']}
        sm, n = m['ele'], m['n']
        # round the corner where the bridge meets its connector, then the grade cap (the deck stays where it is)
        for _ in range(8):
            src = sm[:]
            for i in range(max(1, j - 3), min(n - 1, j + 12) + 1):
                if m['br'][i]: continue
                a0, a1 = max(0, i - 2), min(n, i + 2); sm[i] = sum(src[a0:a1 + 1]) / (a1 - a0 + 1)
        gg = max(g, abs(sm[n] - sm[0]) / n * 1.02)
        for _ in range(2):
            for i in range(1, n):
                if not m['br'][i]: sm[i] = min(max(sm[i], sm[i - 1] - gg), sm[i - 1] + gg)
            for i in range(n - 1, 0, -1):
                if not m['br'][i]: sm[i] = min(max(sm[i], sm[i + 1] - gg), sm[i + 1] + gg)
        worst = max((abs((sm[i + 1] - sm[i]) - (sm[i] - sm[i - 1])) / (m['L'] / n) * 100 for i in range(max(1, j), min(n - 1, j + 7))), default=0)   # (from the deck's end on: the connector)
        r = next(r for r in report if r.get('line') and r['name'] == c['name'] and abs(r['lat'] - c['lat'][0]) < 1e-9)
        r['kinkPct'] = round(worst, 1); r['msg'] += f', joins with a {worst:.0f} % grade change'
        final.append(m)
    return final, report


def enforce_grades(cfg, E):
    """Last word on grades: no 10 m step steeper than maxGradePct (or the edge's own average), decks included, ends fixed."""
    for e in E:
        n, sm = e['n'], e['ele']
        if n < 2: continue
        g = max(cfg['maxGradePct'] / 100 * (e['L'] / n), abs(sm[n] - sm[0]) / n * 1.02)
        if all(abs(sm[i] - sm[i - 1]) <= g + 1e-6 for i in range(1, n + 1)): continue
        for _ in range(3):
            for i in range(1, n):
                sm[i] = min(max(sm[i], sm[i - 1] - g), sm[i - 1] + g)
            for i in range(n - 1, 0, -1):
                sm[i] = min(max(sm[i], sm[i + 1] - g), sm[i + 1] + g)
    return E


RANK = {'path': 0, 'plaza': 0, 'alley': 1, 'residential': 2, 'tertiary': 3, 'secondary': 4, 'primary': 5}


def find_overlaps(cfg, E):
    """Ways drawn on top of each other: centre lines closer than half their widths added up (+0.5 m), within 3 m in height,
    for ≥ 20 m, away from their own junctions (15 m). [(ka, kb, metres, [ia…], [ib…])]: both directions of a divided
    road, a trail beside its street."""
    W = cfg['widths']
    lat0 = E[0]['lat'][0]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    pts = defaultdict(list)
    for k, e in enumerate(E):
        for i in range(e['n'] + 1): pts[(int(e['lon'][i] * kx / 20), int(e['lat'][i] * ky / 20))].append((k, i))
    hits = defaultdict(list)
    for k, e in enumerate(E):
        sp = e['L'] / max(1, e['n'])
        for i in range(e['n'] + 1):
            if min(i, e['n'] - i) * sp < 15: continue
            x, y = e['lon'][i] * kx, e['lat'][i] * ky
            cx, cy = int(x / 20), int(y / 20)
            for a in (-1, 0, 1):
                for b in (-1, 0, 1):
                    for k2, j in pts.get((cx + a, cy + b), ()):
                        if k2 <= k: continue
                        o = E[k2]
                        if min(j, o['n'] - j) * o['L'] / max(1, o['n']) < 15: continue
                        d = math.hypot(o['lon'][j] * kx - x, o['lat'][j] * ky - y)
                        if d < (W.get(e['kind'], 7) + W.get(o['kind'], 7)) / 2 + 0.5 and abs(o['ele'][j] - e['ele'][i]) < 3:
                            hits[(k, k2)].append((i, j))
    out = []
    for (ka, kb), h in hits.items():
        ia = sorted({i for i, _ in h}); ib = sorted({j for _, j in h})
        m = max(len(ia) * E[ka]['L'] / max(1, E[ka]['n']), len(ib) * E[kb]['L'] / max(1, E[kb]['n']))
        if m >= 20: out.append((ka, kb, m, ia, ib))
    return out


def overlap_pick(E, G, ka, kb):
    """Which of two overlapping ways goes: the minor one (trail < alley < street < … < primary; then the shorter), else
    the other, so long as no junction is left with < 2 ways and the network stays whole. None: neither can go."""
    a, b = sorted((ka, kb), key=lambda k: (RANK.get(E[k]['kind'], 2), E[k]['L']))
    both = protected(E[ka]) and protected(E[kb])
    sa, sb = route_share(E[ka]), route_share(E[kb])
    # (a route rides near one or both — authored lines sit a few metres off the street: the one farther from it goes)
    if max(sa, sb) > 0.3 and abs(sa - sb) > 0.05:
        a, b = (ka, kb) if sa < sb else (kb, ka)
        return a if G.can_remove(a, both) else None   # (never the closer one instead: both stay)
    return a if G.can_remove(a, both) else b if G.can_remove(b, both) else None


def remove_overlaps(cfg, E):
    """Take one way out of every overlapping pair (biggest overlaps first), join through, again until none can go."""
    total, km = 0, 0.0
    for _ in range(6):
        xs = sorted(find_overlaps(cfg, E), key=lambda x: -x[2])
        G = Graph(E)
        for ka, kb, m, _, _ in xs:
            if ka in G.gone or kb in G.gone: continue
            k = overlap_pick(E, G, ka, kb)
            if k is not None:
                G.remove(k); total += 1; km += E[k]['L'] / 1000
        if not G.gone: break
        E = merge_through([e for k, e in enumerate(E) if k not in G.gone])
    left = len(find_overlaps(cfg, E))
    print(f'  overlapping roads: removed {total} ways ({km:.1f} km), {left} overlaps left')
    return E


def find_parallels(cfg, E):
    """Similar ways close by: running side by side (headings within 20°) ≤ parallelM apart, within 8 m in height, for
    ≥ parallelMinM on both, away from their own junctions (20 m). [(ka, kb, metres)]."""
    PM, kx, ky = cfg['parallelM'], 111320 * math.cos(math.radians(E[0]['lat'][0])), 110540
    def heading(e, i):
        a, b = max(0, i - 1), min(e['n'], i + 1)
        return math.atan2((e['lat'][b] - e['lat'][a]) * ky, (e['lon'][b] - e['lon'][a]) * kx)
    grid = defaultdict(list)
    for k, e in enumerate(E):
        for i in range(e['n'] + 1): grid[(int(e['lon'][i] * kx / PM), int(e['lat'][i] * ky / PM))].append((k, i))
    near = defaultdict(lambda: (set(), set()))
    for k, e in enumerate(E):
        sp = e['L'] / max(1, e['n'])
        for i in range(e['n'] + 1):
            if min(i, e['n'] - i) * sp < 20: continue
            x, y = e['lon'][i] * kx, e['lat'][i] * ky
            cx, cy, ha = int(x / PM), int(y / PM), heading(e, i)
            for a in (-1, 0, 1):
                for b in (-1, 0, 1):
                    for k2, j in grid.get((cx + a, cy + b), ()):
                        if k2 <= k: continue
                        o = E[k2]
                        if min(j, o['n'] - j) * o['L'] / max(1, o['n']) < 20: continue
                        if math.hypot(o['lon'][j] * kx - x, o['lat'][j] * ky - y) > PM or abs(o['ele'][j] - e['ele'][i]) > 8: continue
                        dh = abs((heading(o, j) - ha + math.pi) % (2 * math.pi) - math.pi)
                        if math.radians(20) < dh < math.radians(160): continue
                        r = near[(k, k2)]; r[0].add(i); r[1].add(j)
    out = []
    for (ka, kb), (sa, sb) in near.items():
        m = min(len(sa) * E[ka]['L'] / max(1, E[ka]['n']), len(sb) * E[kb]['L'] / max(1, E[kb]['n']))
        if m >= cfg['parallelMinM']: out.append((ka, kb, m))
    return out


def remove_parallels(cfg, E):
    """Keep one of every pair of similar ways close by (biggest pairs first; the minor way goes, else the other; never
    a dead end or a split network), join through, again until none can go."""
    total, km = 0, 0.0
    for _ in range(6):
        G = Graph(E)
        for ka, kb, m in sorted(find_parallels(cfg, E), key=lambda x: -x[2]):
            if ka in G.gone or kb in G.gone: continue
            # (keepParallelTrails: a trail beside a road is the ride, not a duplicate — CNY's Erie Canalway Trail by Thompson Road)
            if cfg.get('keepParallelTrails') and (E[ka]['kind'] == 'path') != (E[kb]['kind'] == 'path'): continue
            k = overlap_pick(E, G, ka, kb)
            if k is not None:
                G.remove(k); total += 1; km += E[k]['L'] / 1000
        if not G.gone: break
        E = merge_through([e for k, e in enumerate(E) if k not in G.gone])
    print(f'  similar ways close by: removed {total} ways ({km:.1f} km), {len(find_parallels(cfg, E))} pairs left')
    return E


def smooth_lines(cfg, E):
    """Round the bends: a few passes of a 3-point average on every way's inner points (its junction ends stay), each point
    kept within smoothMaxShiftM of where it was mapped; zigzags go, sharp corners round, the last metres into a junction
    straighten. Lengths are measured again."""
    kx, ky = 111320 * math.cos(math.radians(E[0]['lat'][0])), 110540
    lim = cfg['smoothMaxShiftM']
    for e in E:
        n = e['n']
        if n < 2: continue
        la0, lo0 = e['lat'][:], e['lon'][:]
        la, lo = la0[:], lo0[:]
        for _ in range(cfg['smoothPasses']):
            pla, plo = la[:], lo[:]
            for i in range(1, n):
                nla = (pla[i - 1] + 2 * pla[i] + pla[i + 1]) / 4; nlo = (plo[i - 1] + 2 * plo[i] + plo[i + 1]) / 4
                dx, dy = (nlo - lo0[i]) * kx, (nla - la0[i]) * ky
                d = math.hypot(dx, dy)
                if d > lim: nla, nlo = la0[i] + (nla - la0[i]) * lim / d, lo0[i] + (nlo - lo0[i]) * lim / d
                la[i], lo[i] = nla, nlo
        e['lat'], e['lon'] = la, lo
        e['L'] = sum(math.hypot((lo[i + 1] - lo[i]) * kx, (la[i + 1] - la[i]) * ky) for i in range(n))
    return E


def smooth_heights(cfg, E, jh):
    """Junctions as little sloped plates: each junction gets the plane that best fits the first ~30 m of every way into it
    (least squares, its slope capped at maxGradePct); a way follows that plane for its first 20 m out of the junction,
    then eases into its own profile (smoothstep, long enough that the ease bends the grade ≤ ~8 % a step). So every way
    leaves a junction at the grade the ground there has in its direction — no slope break where ways meet. Then a light
    5-point average along each way (not on decks) and the grade cap."""
    kx, ky = 111320 * math.cos(math.radians(E[0]['lat'][0])), 110540
    pts = defaultdict(list)
    for e in E:
        n = e['n']
        for end, idx in ((e['a'], range(1, min(n, 4))), (e['b'], range(n - 1, max(0, n - 4), -1))):
            for i in idx: pts[end].append((e['lon'][i], e['lat'][i], e['ele'][i]))
    gmax = cfg['maxGradePct'] / 100
    planes = {}
    for nd, P in pts.items():
        e0 = next(e for e in E if e['a'] == nd or e['b'] == nd)
        lo0, la0 = (e0['lon'][0], e0['lat'][0]) if e0['a'] == nd else (e0['lon'][-1], e0['lat'][-1])
        # normal equations with a little ridge on the slopes (two ways in a straight line fix only one slope)
        S = [[0.0] * 3 for _ in range(3)]; r = [0.0] * 3
        for lo, la, z in P:
            v = (1.0, (lo - lo0) * kx, (la - la0) * ky)
            for i in range(3):
                r[i] += v[i] * z
                for j in range(3): S[i][j] += v[i] * v[j]
        S[1][1] += 200.0; S[2][2] += 200.0
        try:
            import numpy as np
            a, b, c = np.linalg.solve(np.array(S), np.array(r))
        except Exception:
            a, b, c = sum(p[2] for p in P) / len(P), 0.0, 0.0
        sl = math.hypot(b, c)
        if sl > gmax: b, c = b * gmax / sl, c * gmax / sl
        planes[nd] = (lo0, la0, float(a), float(b), float(c))
        jh[nd] = float(a)
    g = cfg['maxGradePct'] / 100
    for e in E:
        n, sm, br = e['n'], e['ele'], e['br']
        sp = e['L'] / max(1, n)
        orig = sm[:]
        for end in ('a', 'b'):
            pl = planes.get(e[end])
            if not pl: continue
            lo0, la0, a, b, c = pl
            idx = (lambda t: t) if end == 'a' else (lambda t: n - t)
            k = min(2, n // 2)
            d = abs(a - orig[idx(0)])
            m = max(k + 1, min(n // 2, max(round(cfg['junctionEaseM'] / max(sp, 1)), k + math.ceil(math.sqrt(7.5 * d + 1)))))
            for t in range(0, m + 1):
                i = idx(t)
                if br[i] and t > 0: break
                target = a + b * (e['lon'][i] - lo0) * kx + c * (e['lat'][i] - la0) * ky
                w = 0.0 if t <= k else min(1.0, (t - k) / max(1, m - k))
                w = w * w * (3 - 2 * w)
                sm[i] = target * (1 - w) + orig[i] * w
        sm[0], sm[n] = jh[e['a']], jh[e['b']]
        for _ in range(2):
            src = sm[:]
            for i in range(1, n):
                if br[i]: continue
                a_, b_ = max(0, i - 2), min(n, i + 2); sm[i] = sum(src[a_:b_ + 1]) / (b_ - a_ + 1)
        ends = sorted(set(list(range(1, min(n, 6))) + list(range(max(1, n - 5), n))))
        for _ in range(10):   # spread whatever break is left where the way meets its junction over its first ~50 m
            src = sm[:]
            for i in ends:
                if not br[i]: sm[i] = (src[i - 1] + src[i] + src[i + 1]) / 3
        gg = max(g * sp, abs(sm[n] - sm[0]) / max(1, n) * 1.02)
        for _ in range(2):
            for i in range(1, n): sm[i] = min(max(sm[i], sm[i - 1] - gg), sm[i - 1] + gg)
            for i in range(n - 1, 0, -1): sm[i] = min(max(sm[i], sm[i + 1] - gg), sm[i + 1] + gg)
    return E


def route_links(cfg, E, jpos, jh):
    """Where a Pittsburgh route steps from one PGH way straight onto another that PGH doesn't join there (the old map had a
    link: a ramp, a crossing, a gap in the mapping), add the one short link the route rode — only ≤ routeLinkMaxM long,
    no steeper than 12 %, and only where both ways are held by the route for ≥ 30 m either side (not a corner's noise).
    Returns (E, links added, metres)."""
    if not ROUTES or not ROUTES.n: return E, 0, 0
    lines = json.load(open(os.path.join(ROOT, 'tools', 'city', f'{CITY}-route-lines.json')))
    kx, ky = 111320 * math.cos(math.radians(40.44)), 110540
    grid = defaultdict(list)
    for k, e in enumerate(E):
        for i in range(e['n'] + 1): grid[(int(e['lon'][i] * kx / 20), int(e['lat'][i] * ky / 20))].append((k, i))
    def match(la, lo):
        x, y = lo * kx, la * ky; cx, cy = int(x / 20), int(y / 20)
        best, bd = None, 18
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                for k, i in grid.get((cx + a, cy + b), ()):
                    d = math.hypot(E[k]['lon'][i] * kx - x, E[k]['lat'][i] * ky - y)
                    if d < bd: bd, best = d, (k, i)
        return best
    adjn = defaultdict(set)
    for k, e in enumerate(E): adjn[e['a']].add(k); adjn[e['b']].add(k)
    def joined(k1, k2, hops=3):
        """Are two ways joined within a few ways (a junction or two apart)?"""
        e1 = E[k1]; frontier = {e1['a'], e1['b']}; seen = set(frontier)
        for _ in range(hops):
            if any(k2 in adjn[n] for n in frontier): return True
            nxt = set()
            for n in frontier:
                for k in adjn[n]:
                    if E[k]['L'] > 150: continue
                    for m in (E[k]['a'], E[k]['b']):
                        if m not in seen: seen.add(m); nxt.add(m)
            frontier = nxt
        return False
    cands = {}
    for r in lines:
        pts = []
        for (a, b), (c, d) in zip(r['line'], r['line'][1:]):
            k_ = max(1, int(hv((a, b), (c, d)) / 10))
            pts += [(a + (c - a) * t / k_, b + (d - b) * t / k_) for t in range(k_)]
        seq = [match(*p) for p in pts]
        # runs of the same way
        runs = []
        for idx, m in enumerate(seq):
            if m is None: continue
            if runs and runs[-1]['k'] == m[0] and idx - runs[-1]['last'] <= 3: runs[-1]['last'] = idx; runs[-1]['i1'] = m[1]; runs[-1]['n'] += 1
            else: runs.append({'k': m[0], 'first': idx, 'last': idx, 'i0': m[1], 'i1': m[1], 'n': 1})
        runs = [x for x in runs if x['n'] >= 3]
        for r1, r2 in zip(runs, runs[1:]):
            if r1['k'] == r2['k'] or r2['first'] - r1['last'] > 6: continue
            if joined(r1['k'], r2['k']): continue
            e1, e2 = E[r1['k']], E[r2['k']]
            p1, p2 = (e1['lat'][r1['i1']], e1['lon'][r1['i1']]), (e2['lat'][r2['i0']], e2['lon'][r2['i0']])
            L = hv(p1, p2)
            if L > cfg['routeLinkMaxM'] or L < 2: continue
            if abs(e1['ele'][r1['i1']] - e2['ele'][r2['i0']]) > 0.12 * max(L, 10): continue
            key = (round(p1[0], 4), round(p1[1], 4), round(p2[0], 4), round(p2[1], 4))
            cands[key] = (r1['k'], r1['i1'], r2['k'], r2['i0'])
    if not cands: return E, 0, 0
    # cut the ways at the link ends, then add the links
    cuts = defaultdict(set)
    for k1, i1, k2, i2 in cands.values(): cuts[k1].add(i1); cuts[k2].add(i2)
    node_at = {}
    out = []
    for k, e in enumerate(E):
        cs = sorted(i for i in cuts.get(k, ()) if 0 < i < e['n'])
        for i in cuts.get(k, ()):
            node_at[(k, i)] = e['a'] if i == 0 else e['b'] if i == e['n'] else f'link:{k}:{i}'
        if not cs: out.append(e); continue
        bounds = [0] + cs + [e['n']]
        for a, b in zip(bounds, bounds[1:]):
            na = e['a'] if a == 0 else f'link:{k}:{a}'; nb = e['b'] if b == e['n'] else f'link:{k}:{b}'
            for i, nid in ((a, na), (b, nb)):
                if str(nid).startswith('link:'): jpos[nid] = (e['lat'][i], e['lon'][i]); jh[nid] = e['ele'][i]
            out.append({**e, 'prot': None, 'rshare': None, 'a': na, 'b': nb, 'lat': e['lat'][a:b + 1], 'lon': e['lon'][a:b + 1], 'ele': e['ele'][a:b + 1],
                        'br': e['br'][a:b + 1], 'n': b - a, 'L': e['L'] * (b - a) / e['n']})
    total = 0
    for k1, i1, k2, i2 in cands.values():
        a, b = node_at[(k1, i1)], node_at[(k2, i2)]
        if a == b: continue
        p1, p2 = jpos[a], jpos[b]
        samples, L, n = resample([p1, p2])
        h1, h2 = jh[a], jh[b]
        out.append({'a': a, 'b': b, 'lat': [x[0] for x in samples], 'lon': [x[1] for x in samples], 'ele': [h1 + (h2 - h1) * t / n for t in range(n + 1)],
                    'br': [0] * (n + 1), 'n': n, 'L': L, 'name': 'Route link', 'kind': 'path', 'hw': 'path', 'names': [], 'refs': [], 'bridge': [], 'prot': True})
        total += L
    return out, len(cands), total


def build_all(cfg):
    """The whole graph as written: built, heights, simplified, crossings cleared, joined, too-steep edges dropped."""
    nodes, chains, jpos, cor = build(cfg)
    E, jh = heights(cfg, nodes, chains, jpos)
    E, nl, ml = route_links(cfg, E, jpos, jh)
    print(f'  route links: {nl} short links the Pittsburgh routes rode between ways PGH did not join ({ml:.0f} m)')
    E = finish(cfg, E)
    E, n_dead, km_dead = prune_dead_ends(E)
    print(f'  dead ends: removed {n_dead} ways ({km_dead:.1f} km) in dead-end branches (bridges kept)')
    E, rep_ = connect_dead_bridges(cfg, E, jpos, jh)
    REVIEW['bridges'] = rep_
    print(f'  dead-end bridges: {sum(r["ok"] for r in rep_)} connected, {sum(not r["ok"] for r in rep_)} left')
    for r in rep_: print(f'    {"✓" if r["ok"] else "✗"} {r["name"]}: {r["msg"]}')
    E, n_left, km_left = prune_dead_ends(E, keep_bridges=False)   # (user, 21 Nov: the bridges that couldn't be connected go too)
    print(f'  dead-end bridges not connected: removed {n_left} ways ({km_left:.1f} km)')
    for _ in range(4):   # the dead ends gone, a few more short ways can go by the same rules
        G = Graph(E)
        plan = simplify_plan(cfg, E, G)
        E = merge_through([e for k, e in enumerate(E) if k not in G.gone])
        if not plan: break
        print(f'  after the dead ends: removed {len(plan)} more')
    E = remove_overlaps(cfg, E)
    E = remove_parallels(cfg, E)
    E = drop_unrideable(cfg, E)
    E = merge_through(E)
    E = smooth_heights(cfg, smooth_lines(cfg, E), jh)
    E = remove_parallels(cfg, remove_overlaps(cfg, E))   # (rounded bends can bring two ways together: once more)
    G = Graph(E)
    fixed, removed, left = fix_crossings(cfg, E, G)   # (…and new heights can bring a crossing too close: clear them again)
    print(f'  crossings after smoothing: {fixed} cleared, {len(removed)} removed, {len(left)} left')
    E = [e for k, e in enumerate(E) if k not in G.gone]
    E = enforce_grades(cfg, merge_through(drop_unrideable(cfg, E)))
    if cfg.get('area', {}).get('circle') and cfg['area'].get('marginM'):
        E, nt, kt = trim_to_circle(cfg, E)
        E = merge_through(E)
        shape_ = shape_of(cfg)
        if shape_: out_km = sum(STEP for e in E for la, lo in zip(e['lat'], e['lon']) if shape_.dist(la, lo, 50) > 0) / 1000
        else:
            la0_, lo0_, r0_ = cfg['area']['circle']; kx_ = 111320 * math.cos(math.radians(la0_))
            out_km = sum(STEP for e in E for la, lo in zip(e['lat'], e['lon']) if math.hypot((lo - lo0_) * kx_, (la - la0_) * 110540) > r0_) / 1000
        print(f'  outside the circle: removed {nt} ways ({kt:.1f} km); {out_km:.1f} km left outside it, closing loops')
    used = {e['a'] for e in E} | {e['b'] for e in E}
    jpos = {n: p for n, p in jpos.items() if n in used}
    return nodes, E, jpos, jh, cor


def main():
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', f'{CITY}.json')))
    nodes, E, jpos, jh, cor = build_all(cfg)
    write(cfg, E, jpos, jh, cor)
    if '--no-ground' not in sys.argv: write_ground(cfg, E)


if __name__ == '__main__':
    main()
