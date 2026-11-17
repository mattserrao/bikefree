#!/usr/bin/env python3
"""Build a city route and its city data from OpenStreetMap and AWS Terrain Tiles.

    python3 tools/build_city.py pittsburgh

Reads tools/city/<id>.json and writes two files:

  <gpx>   the ride (10 m samples, closed loop). Routed on our own graph of OSM
          streets and trails (not BRouter), so each leg can prefer trails or roads
          and the route can follow park paths and bridge sidewalks. Elevation comes
          from the terrain tiles; bridge decks are interpolated between their ends.
  <data>  "bikefree-city-1": a height grid, a land-use grid (water, park, woods,
          paved, buildings), building footprints with heights, nearby streets,
          bridges, rail lines (inclines, light rail) and trees, for
          js/world/toolbox/city/landscape.js and js/world/toolbox/city/city.js.

OSM tiles are cached in tools/.cache/osm-<id>/ (the OSM API is used politely,
one small area at a time). Data © OpenStreetMap contributors, ODbL.
"""
import base64, io, json, math, os, sys, time, heapq, urllib.request
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from collections import Counter
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citylib import road_align   # [road-align]
from citylib import street_kit   # [street-kit]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
UA = {'User-Agent': 'bikefree-city-builder/0.12 (personal project)'}
UNIT = 2e-6          # coordinate unit in the data file (degrees); ±0.065° fits in Int16


def http_get(url, pause=1.0):
    time.sleep(pause)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()


def hv(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


# ---------------------------------------------------------------- OSM
def load_osm(cfg):
    folder = os.path.join(CACHE, f'osm-{cfg["id"]}')
    os.makedirs(folder, exist_ok=True)
    w, s, e, n = cfg['osmBbox']
    dx, dy = cfg.get('osmTile', [0.01, 0.008])
    files = []
    nx, ny = math.ceil((e - w) / dx - 1e-9), math.ceil((n - s) / dy - 1e-9)
    for x in range(nx):
        for y in range(ny):
            path = os.path.join(folder, f't_{x}_{y}.osm')
            if not os.path.exists(path) or os.path.getsize(path) < 200:
                lo, la = round(w + x * dx, 4), round(s + y * dy, 4)
                print(f'  fetching OSM {lo},{la}')
                data = http_get(f'https://api.openstreetmap.org/api/0.6/map?bbox={lo},{la},{round(lo + dx, 4)},{round(la + dy, 4)}')
                open(path, 'wb').write(data)
            files.append(path)
    for rid in cfg.get('waterRelations', []):
        path = os.path.join(folder, f'rel_{rid}.osm')
        if not os.path.exists(path):
            print(f'  fetching relation {rid}')
            open(path, 'wb').write(http_get(f'https://api.openstreetmap.org/api/0.6/relation/{rid}/full'))
        files.append(path)
    nodes, ntags, ways, rels = {}, {}, {}, {}
    for f in files:
        root = ET.parse(f).getroot()
        for nd in root.iter('node'):
            i = nd.get('id'); nodes[i] = (float(nd.get('lat')), float(nd.get('lon')))
            t = {x.get('k'): x.get('v') for x in nd.iter('tag')}
            if t: ntags[i] = t
        for wy in root.iter('way'):
            ways[wy.get('id')] = ([x.get('ref') for x in wy.iter('nd')], {x.get('k'): x.get('v') for x in wy.iter('tag')})
        for r in root.iter('relation'):
            rels[r.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in r.iter('member')],
                                 {x.get('k'): x.get('v') for x in r.iter('tag')})
    print(f'  OSM: {len(nodes)} nodes, {len(ways)} ways, {len(rels)} relations')
    return nodes, ntags, ways, rels


def rings_of(rel, ways, nodes, role='outer'):
    """Assemble closed rings from a multipolygon's member ways."""
    segs = [ways[ref][0][:] for typ, ref, ro in rel[0] if typ == 'way' and ro == role and ref in ways]
    rings = []
    while segs:
        ring = segs.pop(0); changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for k, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]
                elif s[-1] == ring[-1]: ring += s[::-1][1:]
                elif s[-1] == ring[0]: ring = s + ring[1:]
                elif s[0] == ring[0]: ring = s[::-1] + ring[1:]
                else: continue
                segs.pop(k); changed = True; break
        pts = [nodes[i] for i in ring if i in nodes]
        if ring[0] == ring[-1] and len(pts) > 3: rings.append(pts)
    return rings


# ---------------------------------------------------------------- routing
BRICK_SURFACES = {'brick', 'bricks', 'sett', 'paving_stones', 'cobblestone', 'unhewn_cobblestone'}   # [finish]
BAN = {'motorway', 'motorway_link', 'proposed', 'construction', 'steps', 'elevator', 'platform', 'bus_stop', 'corridor', 'raceway', 'abandoned'}
MODES = {
    'road': {'primary': 1, 'secondary': 1, 'tertiary': 1, 'trunk': 1.2, 'unclassified': 1.1, 'residential': 1.3, 'primary_link': 1.5,
             'secondary_link': 1.5, 'tertiary_link': 1.5, 'trunk_link': 1.6, 'living_street': 1.5, 'pedestrian': 1.6, 'cycleway': 1.6,
             'service': 3, 'footway': 4, 'path': 4, 'track': 5},
    'trail': {'cycleway': 1, 'path': 1.2, 'footway': 1.5, 'pedestrian': 1.3, 'living_street': 2, 'residential': 2.5, 'service': 3,
              'unclassified': 2.5, 'tertiary': 3, 'secondary': 3, 'primary': 3, 'track': 3, 'trunk': 6},
    'park': {'footway': 1, 'path': 1, 'cycleway': 1, 'pedestrian': 1, 'service': 2, 'residential': 3, 'tertiary': 3, 'secondary': 3,
             'primary': 3, 'unclassified': 3},
}


class Router:
    def __init__(self, nodes, ways):
        self.nodes, self.ways = nodes, ways
        adj = {}
        for wid, (nd, t) in ways.items():
            h = t.get('highway')
            if not h or h in BAN or t.get('area') == 'yes': continue
            if t.get('access') in ('private', 'no') and h != 'cycleway': continue
            nd = [i for i in nd if i in nodes]
            for a, b in zip(nd, nd[1:]):
                d = hv(nodes[a], nodes[b])
                adj.setdefault(a, []).append((b, d, wid)); adj.setdefault(b, []).append((a, d, wid))
        comp = {}
        for s0 in adj:
            if s0 in comp: continue
            stack = [s0]; comp[s0] = s0
            while stack:
                u = stack.pop()
                for v, _, _ in adj[u]:
                    if v not in comp: comp[v] = s0; stack.append(v)
        main = Counter(comp.values()).most_common(1)[0][0]
        self.adj, self.main = adj, {n for n, c in comp.items() if c == main}

    def snap(self, p, name=None):
        best = None
        for n in self.main:
            if name and not any(self.ways[w][1].get('name', '') == name for _, _, w in self.adj[n]): continue
            d = hv(p, self.nodes[n])
            if best is None or d < best[0]: best = (d, n)
        return best[1], best[0]

    def link(self, p, q, name):
        a, _ = self.snap(p); b, _ = self.snap(q)
        wid = f'x{a}_{b}'
        self.ways[wid] = ([a, b], {'highway': 'cycleway', 'name': name})
        d = hv(self.nodes[a], self.nodes[b])
        self.adj[a].append((b, d, wid)); self.adj[b].append((a, d, wid))

    def path(self, a, b, mode):
        weights = MODES[mode]; dist = {a: 0}; prev = {}; pq = [(0, a)]
        while pq:
            c, u = heapq.heappop(pq)
            if u == b: break
            if c > dist[u]: continue
            for v, d, w in self.adj[u]:
                nc = c + d * weights.get(self.ways[w][1]['highway'], 8)
                if nc < dist.get(v, 1e18): dist[v] = nc; prev[v] = (u, w); heapq.heappush(pq, (nc, v))
        seq, wl = [b], []
        while seq[-1] != a:
            u, w = prev[seq[-1]]; seq.append(u); wl.append(w)
        return seq[::-1], wl[::-1]

    def build(self, legs):
        pts, wl, marks = [], [], []
        for leg in legs:
            snapped = []
            for wp in leg['waypoints']:
                n, d = self.snap((wp[1], wp[2]), wp[3] if len(wp) > 3 else None)
                if d > 25: print(f'  note: waypoint "{wp[0]}" snapped {d:.0f} m away')
                snapped.append(n)
            if not pts: pts, wl = [snapped[0]], [None]; marks.append((leg['waypoints'][0][0], 0))
            for i in range(1, len(snapped)):
                seq, ws = self.path(pts[-1], snapped[i], leg['mode'])
                pts += seq[1:]; wl += ws
                marks.append((leg['waypoints'][i][0], len(pts) - 1))
        return pts, wl, marks


# ---------------------------------------------------------------- elevation (AWS Terrain Tiles, terrarium)
DEM_Z = 14
_tiles = {}


def dem_px(gx, gy):
    tx, ty = int(gx // 256), int(gy // 256)
    if (tx, ty) not in _tiles:
        path = os.path.join(CACHE, f'dem-{DEM_Z}-{tx}-{ty}.png')
        if not os.path.exists(path):
            open(path, 'wb').write(http_get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{DEM_Z}/{tx}/{ty}.png', 0.2))
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


def circular(vals, w, fn):
    n = len(vals)
    return [fn([vals[(i + k) % n] for k in range(-w, w + 1)]) for i in range(n)]


# ---------------------------------------------------------------- helpers
def b64(arr_bytes):
    return base64.b64encode(arr_bytes).decode('ascii')


def pack_int16(vals):
    import array
    a = array.array('h', [max(-32768, min(32767, int(round(v)))) for v in vals])
    if sys.byteorder != 'little': a.byteswap()
    return b64(a.tobytes())


def pack_uint16(vals):
    import array
    a = array.array('H', [max(0, min(65535, int(round(v)))) for v in vals])
    if sys.byteorder != 'little': a.byteswap()
    return b64(a.tobytes())


def pack_uint32(vals):
    import array
    a = array.array('I', [int(v) for v in vals])
    if sys.byteorder != 'little': a.byteswap()
    return b64(a.tobytes())


def rle(codes):
    """[value, run, value, run, …] — the land grid is mostly long runs."""
    out, prev, run = [], None, 0
    for c in codes:
        if c == prev and run < 65535: run += 1
        else:
            if prev is not None: out += [prev, run]
            prev, run = c, 1
    out += [prev, run]
    return out


def simplify(pts, tol):
    if len(pts) < 4: return pts
    def rdp(a, b):
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        best, k = 0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs((px - ax) * dy - (py - ay) * dx) / L
            if d > best: best, k = d, i
        if best > tol: return rdp(a, k)[:-1] + rdp(k, b)
        return [pts[a], pts[b]]
    return rdp(0, len(pts) - 1)


def parse_m(v):
    if not v: return None
    v = v.strip().lower().replace(',', '.')
    try:
        if v.endswith('ft') or v.endswith("'"): return float(v.rstrip("ft' ")) * 0.3048
        return float(v.split()[0].rstrip('m'))
    except ValueError:
        return None


def point_in(poly, x, y):
    inside = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: inside = not inside
    return inside


# ---------------------------------------------------------------- main build
def build(cid):
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', f'{cid}.json')))
    nodes, ntags, ways, rels = load_osm(cfg)

    # 1. Route ------------------------------------------------------------------
    router = Router(nodes, ways)
    for lk in cfg.get('links', []): router.link(tuple(lk['from']), tuple(lk['to']), lk['name'])
    pts, wl, marks = router.build(cfg['legs'])
    # waypoints that sit just off the line leave tiny out-and-back stubs (A B C B A): fold them away
    changed = True
    while changed:
        changed = False
        for i in range(1, len(pts) - 1):
            if pts[i - 1] == pts[i + 1]:
                del pts[i:i + 2]; del wl[i:i + 2]
                marks = [(n, k if k < i else max(i - 1, k - 2)) for n, k in marks]
                changed = True; break
    P = [nodes[n] for n in pts]
    cum = [0.0]
    for a, b in zip(P, P[1:]): cum.append(cum[-1] + hv(a, b))
    raw = [elevation(*p) for p in P]
    on_bridge = [bool(w and ways[w][1].get('bridge') not in (None, 'no')) for w in wl]
    E = raw[:]
    route_bridges = []
    i = 1
    while i < len(P):
        if on_bridge[i]:
            j = i
            while j + 1 < len(P) and on_bridge[j + 1]: j += 1
            a, b = i - 1, j
            for k in range(a + 1, b): E[k] = E[a] + (E[b] - E[a]) * (cum[k] - cum[a]) / max(1e-6, cum[b] - cum[a])
            t = ways[wl[i]][1]
            name = t.get('bridge:name') or next((ways[wl[k]][1].get('bridge:name') or ways[wl[k]][1].get('name') for k in range(i, j + 1)
                                                 if ways[wl[k]][1].get('bridge:name') or 'Bridge' in ways[wl[k]][1].get('name', '')), None) or t.get('name', '')
            if cum[b] - cum[a] > 30: route_bridges.append({'name': name, 'fromM': round(cum[a]), 'toM': round(cum[b])})
            i = j + 1
        else: i += 1
    # what each stretch of the route is: a street (cars may pass) or a trail/park path
    kinds = []
    for k in range(1, len(P)):
        h = ways[wl[k]][1].get('highway', '') if wl[k] else ''
        kind = 'trail' if h in ('cycleway', 'path', 'footway', 'pedestrian', 'track', 'service', 'living_street') else 'road'
        if kinds and kinds[-1][0] == kind: kinds[-1][2] = cum[k]
        else: kinds.append([kind, cum[k - 1], cum[k]])
    merged = []
    for kind, a, b in kinds:
        if merged and (b - a < 40 or merged[-1][0] == kind): merged[-1][2] = b
        else: merged.append([kind, a, b])
    route_kinds = [{'kind': k, 'fromM': round(a), 'toM': round(b)} for k, a, b in merged]
    # Round the corners: city streets meet at right angles and OSM paths jog sideways where they join;
    # a rider (and the camera) needs curves. Resample every 2 m, then average positions over ±12 m twice
    # (corner radius ≥ ~8 m, sideways jogs gone). The loop wraps, so the start/finish is smooth too.
    raw_total = cum[-1]
    n2 = int(raw_total // 2)
    r2, e2, j = [], [], 0
    for k in range(n2):
        sd = k * 2
        while j < len(cum) - 2 and cum[j + 1] < sd: j += 1
        f = (sd - cum[j]) / max(1e-9, cum[j + 1] - cum[j])
        r2.append(((P[j][1] + (P[j + 1][1] - P[j][1]) * f - P[0][1]) * 111319.49 * math.cos(math.radians(P[0][0])),
                   (P[j][0] + (P[j + 1][0] - P[j][0]) * f - P[0][0]) * 111319.49))
        e2.append(E[j] + (E[j + 1] - E[j]) * f)
    # never stray more than `maxDrift` m from the mapped line: corners round inside the street, not through buildings
    drift = cfg.get('maxDriftM', 8.0)
    kx0, ky0 = 111319.49 * math.cos(math.radians(P[0][0])), 111319.49
    to_xy = lambda la, lo: ((lo - P[0][1]) * kx0, (la - P[0][0]) * ky0)
    bgrid = {}
    for wid_, (nd, t) in ways.items():
        if not ('building' in t or 'building:part' in t) or not nd or nd[0] != nd[-1]: continue
        poly = [to_xy(*nodes[i]) for i in nd if i in nodes]
        if len(poly) < 4: continue
        xs_, ys_ = [q[0] for q in poly], [q[1] for q in poly]
        for gx in range(int(min(xs_) // 50), int(max(xs_) // 50) + 1):
            for gy in range(int(min(ys_) // 50), int(max(ys_) // 50) + 1):
                bgrid.setdefault((gx, gy), []).append((wid_, poly))
    def in_building(x, y, hit=None):
        for a_ in (0,):
            for b_ in (0,):
                for wid_, poly in bgrid.get((int(x // 50) + a_, int(y // 50) + b_), []):
                    if point_in(poly, x, y):
                        if hit is None: return True
                        hit.add(wid_)
        return bool(hit)
    # buildings the mapped path itself runs through (a trail under a canopy, a mis-drawn footprint) are left out
    route_buildings = set()
    for q in r2: in_building(q[0], q[1], route_buildings)
    print('  left out (on the route):', len(route_buildings), sorted(Counter(ways[w][1].get('building', ways[w][1].get('building:part', '')) for w in route_buildings).items()))
    # [road-align] plan: round corners, ease tight spots and fair the line inside the mapped corridor, clear of
    # buildings (tools/citylib/road_align.py)
    polys = list({wid_: poly for cell_ in bgrid.values() for wid_, poly in cell_ if wid_ not in route_buildings}.values())
    sm = [tuple(q_) for q_ in road_align.align_plan(
        r2, clear=road_align.Clearance(polys, cfg.get('clearM', 3.2)), drift=drift, loop=True,
        corner_passes=cfg.get('cornerPasses', 2), corner_half_window=cfg.get('cornerHalfWindow', 6),
        fair_iters=cfg.get('fairIters', 240)).tolist()]
    sm.append(sm[0]); e2.append(e2[0])
    scum = [0.0]
    for a_, b_ in zip(sm, sm[1:]): scum.append(scum[-1] + math.hypot(b_[0] - a_[0], b_[1] - a_[1]))
    to_ll = lambda x, y: (P[0][0] + y / 111319.49, P[0][1] + x / (111319.49 * math.cos(math.radians(P[0][0]))))
    total = scum[-1]
    rs, re_, j = [], [], 0
    for k in range(int(total // 10) + 1):
        sd = k * 10
        while j < len(scum) - 2 and scum[j + 1] < sd: j += 1
        f = (sd - scum[j]) / max(1e-9, scum[j + 1] - scum[j])
        rs.append(to_ll(sm[j][0] + (sm[j + 1][0] - sm[j][0]) * f, sm[j][1] + (sm[j + 1][1] - sm[j][1]) * f))
        re_.append(e2[j] + (e2[j + 1] - e2[j]) * f)
    if hv(rs[-1], rs[0]) > 1: rs.append(rs[0]); re_.append(re_[0])
    # The app measures the route along the GPX samples (chords): express every distance (bridges, kinds,
    # waypoints — found along the raw OSM nodes) in that measure so they land where they should.
    chord = [0.0]
    for a_, b_ in zip(rs, rs[1:]): chord.append(chord[-1] + hv(a_, b_))
    def app_s(d):
        k2 = max(0.0, min(len(scum) - 1.001, d / 2)); i2 = int(k2)
        sd = scum[i2] + (scum[i2 + 1] - scum[i2]) * (k2 - i2)
        k = max(0.0, min(len(chord) - 1.001, sd / 10)); i = int(k)
        return chord[i] + (chord[i + 1] - chord[i]) * (k - i)
    for b in route_bridges: b['fromM'], b['toM'] = round(app_s(b['fromM'])), round(app_s(b['toM']))
    for k in route_kinds: k['fromM'], k['toM'] = round(app_s(k['fromM'])), round(app_s(k['toM']))
    route_kinds[-1]['toM'] = round(chord[-1]) + 10
    # rideable profile
    # [w2-align] the ground under the line as drawn: the elevation at each 10 m sample of the aligned line (the same
    # z14 terrain the app's ground grid comes from), not the mapped nodes' heights interpolated along the way (nodes
    # are 30–80 m apart on a straight street, so a crest or a dip between them was cut or filled by up to 2 m).
    # Bridge decks (+20 m) keep their straight interpolation and trails (riverfront walks on walls and ramps, where
    # the line drifts towards the water) their nodes' heights, easing to the ground over 30 m beyond.
    # `profileFromLine`: true (default) everywhere but the decks, "roads" also keeps the trails, false: off.
    from_line = cfg.get('profileFromLine', True)
    if from_line:
        keep = [{**b, 'padM': 20} for b in route_bridges] + [k for k in route_kinds if from_line == 'roads' and k['kind'] == 'trail']
        keep += [{'fromM': a_, 'toM': b_} for a_, b_ in cfg.get('profileKeep', [])]   # ramps and walls the ground grid can't see
        re_ = road_align.line_elevation(re_, [elevation(a_, b_) for a_, b_ in rs], keep, step=10)
    # [road-align] profile: shave spikes, fill only narrow notches (real dips and crests stay on the ground),
    # limit grade and grade change, light averaging
    e = road_align.align_profile(re_, step=10, loop=True, **cfg.get('profile', {})).tolist()
    asc = sum(max(0, b - a) for a, b in zip(e, e[1:]))
    grades = [(e[(k + 1) % len(e)] - e[k - 1]) / 20 * 100 for k in range(len(e))]
    total = chord[-1]
    print(f'{cid}: {total / 1000:.2f} km ({total / 1609.344:.1f} mi), climb {asc:.0f} m ({asc * 3.28084:.0f} ft), '
          f'ele {min(e):.0f}–{max(e):.0f} m, grade {min(grades):.1f}…{max(grades):.1f} %')
    for name, idx in marks: print(f'    {app_s(cum[idx]) / 1000:6.2f} km  {name}')
    for b in route_bridges: print(f'    bridge {b["fromM"] / 1000:.2f}–{b["toM"] / 1000:.2f} km  {b["name"]}')
    gpx = os.path.join(ROOT, cfg['gpx'])
    os.makedirs(os.path.dirname(gpx), exist_ok=True)
    with open(gpx, 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="bikefree" xmlns="http://www.topografix.com/GPX/1/1">\n')
        f.write(f'  <metadata><name>{escape(cfg["name"])}</name><desc>{escape(cfg["park"])}. Routed on OpenStreetMap data '
                '(© OpenStreetMap contributors, ODbL); elevation from AWS Terrain Tiles.</desc></metadata>\n')
        f.write(f'  <trk><name>{escape(cfg["name"])}</name><trkseg>\n')
        for (lat, lon), z in zip(rs, e):
            f.write(f'    <trkpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{z:.1f}</ele></trkpt>\n')
        f.write('  </trkseg></trk>\n</gpx>\n')

    # 2. City data ----------------------------------------------------------------
    gw, gs, ge, gn = cfg['gridBbox']
    lat0, lon0 = (gs + gn) / 2, (gw + ge) / 2
    kx = 111319.49 * math.cos(math.radians(lat0)); ky = 111319.49
    q = lambda lat, lon: (round((lat - lat0) / UNIT), round((lon - lon0) / UNIT))
    # route sample index for distance tests (metres, local)
    loc = lambda lat, lon: ((lon - lon0) * kx, (lat - lat0) * ky)
    rxy = [loc(*p) for p in rs]
    cell = 100
    rgrid = {}
    for k, (x, y) in enumerate(rxy): rgrid.setdefault((int(x // cell), int(y // cell)), []).append(k)

    def route_dist(lat, lon, limit):
        x, y = loc(lat, lon); r = int(limit // cell) + 1; best = 1e9
        cx, cy = int(x // cell), int(y // cell)
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                for k in rgrid.get((cx + dx, cy + dy), []):
                    best = min(best, math.hypot(rxy[k][0] - x, rxy[k][1] - y))
        return best

    # height grid
    gm = cfg['gridM']
    nx = int((ge - gw) * kx / gm) + 1; ny = int((gn - gs) * ky / gm) + 1
    dlon, dlat = (ge - gw) / (nx - 1), (gn - gs) / (ny - 1)
    H = [elevation(gn - r * dlat, gw + c * dlon) for r in range(ny) for c in range(nx)]
    print(f'  height grid {nx}×{ny} @ {gm} m, {min(H):.0f}–{max(H):.0f} m')

    # land-use grid (finer): 0 paved/urban, 1 grass/park, 2 woods, 3 water, 4 building, 5 sand/bare, 6 plaza
    lm = cfg['landM']
    lx = int((ge - gw) * kx / lm) + 1; ly = int((gn - gs) * ky / lm) + 1
    img = Image.new('L', (lx, ly), 7)    # 7: outside the OSM area (wooded hills and suburbs, seen from afar)
    dr = ImageDraw.Draw(img)
    pix = lambda lat, lon: ((lon - gw) / (ge - gw) * (lx - 1), (gn - lat) / (gn - gs) * (ly - 1))
    ow, os_, oe, on = cfg['osmBbox']
    dr.rectangle([pix(on, ow), pix(os_, oe)], fill=0)
    # [s4-section] hillside neighbourhoods the map leaves without land use: yards (and small untagged footprints
    # there become houses and rowhouses, not shop blocks with water tanks)
    for bs, bw, bn, be in cfg.get('residentialBoxes', []): dr.rectangle([pix(bn, bw), pix(bs, be)], fill=8)

    def poly(pts, code):
        if len(pts) > 2: dr.polygon([pix(*p) for p in pts], fill=code)

    green = {'park', 'garden', 'pitch', 'golf_course', 'playground', 'dog_park', 'recreation_ground', 'common'}
    grassy = {'grass', 'meadow', 'village_green', 'cemetery', 'allotments', 'orchard', 'farmland', 'greenfield'}
    woody = {'wood', 'scrub', 'forest', 'heath', 'wetland'}
    layers = {8: [], 9: [], 1: [], 2: [], 5: [], 6: []}
    def classify(t):
        if t.get('landuse') == 'residential': return 8
        if t.get('landuse') in ('commercial', 'retail', 'industrial', 'railway', 'construction', 'brownfield') or t.get('amenity') == 'parking': return 9
        if t.get('natural') in woody or t.get('landuse') in ('forest',): return 2
        if t.get('leisure') in green or t.get('landuse') in grassy or t.get('natural') in ('grassland',): return 1
        if t.get('natural') in ('sand', 'bare_rock', 'scree', 'beach'): return 5
        if t.get('highway') == 'pedestrian' and t.get('area') == 'yes' or t.get('place') == 'square': return 6
        return None
    for nd, t in ways.values():
        c = classify(t)
        if c and nd and nd[0] == nd[-1]: layers[c].append([nodes[i] for i in nd if i in nodes])
    for rel in rels.values():
        c = classify(rel[1])
        if c and rel[1].get('type') == 'multipolygon':
            layers[c] += rings_of(rel, ways, nodes)
    for code in (8, 9, 1, 2, 5, 6):
        for pts in layers[code]: poly(pts, 0 if code == 9 else code)
    # water: outer rings, then islands back to land
    for rid in cfg.get('waterRelations', []):
        rel = rels.get(str(rid))
        if not rel: continue
        for pts in rings_of(rel, ways, nodes, 'outer'): poly(pts, 3)
        for pts in rings_of(rel, ways, nodes, 'inner'): poly(pts, 1)
    for nd, t in ways.values():
        if (t.get('natural') == 'water' or t.get('waterway') == 'riverbank') and nd and nd[0] == nd[-1]:
            poly([nodes[i] for i in nd if i in nodes], 3)

    # 3. Buildings --------------------------------------------------------------
    brad, tall = cfg['buildingRadiusM'], cfg['tallBuildingM']
    def height_of(t):
        h = parse_m(t.get('height'))
        if h is None and t.get('building:levels'):
            try: h = float(t['building:levels'].split(';')[0]) * 3.4 + 1.2
            except ValueError: h = None
        return h
    def min_h(t):
        h = parse_m(t.get('min_height'))
        if h is None and t.get('building:min_level'):
            try: h = float(t['building:min_level']) * 3.4
            except ValueError: h = None
        return h or 0.0
    outlines, parts = [], []
    for wid, (nd, t) in ways.items():
        if not nd or nd[0] != nd[-1] or len(nd) < 4: continue
        if 'building:part' in t and t['building:part'] not in ('no',): parts.append((wid, [nodes[i] for i in nd if i in nodes], t))
        elif 'building' in t and t['building'] not in ('no', 'roof', 'construction', 'ruins'):
            outlines.append((wid, [nodes[i] for i in nd if i in nodes], t))
    stadium_rings = {}
    for wid, (nd, t) in ways.items():
        if t.get('leisure') == 'stadium' and t.get('name') in cfg.get('stadiums', {}) and nd and nd[0] == nd[-1]:
            stadium_rings[t['name']] = [nodes[i] for i in nd if i in nodes]
    for rid, rel in rels.items():
        t = rel[1]
        if t.get('type') == 'multipolygon' and t.get('leisure') == 'stadium' and t.get('name') in cfg.get('stadiums', {}):
            rings = rings_of(rel, ways, nodes)
            if rings: stadium_rings[t['name']] = max(rings, key=len)
        if t.get('type') == 'multipolygon' and 'building' in t and t['building'] not in ('no', 'roof'):
            for k, ring in enumerate(rings_of(rel, ways, nodes)): outlines.append((f'r{rid}_{k}', ring, t))
    # an outline whose area holds building:parts is drawn by its parts
    part_centres = [(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) for _, pts, _ in parts]
    pc_grid = {}
    for k, (la, lo) in enumerate(part_centres): pc_grid.setdefault((round(la * 500), round(lo * 500)), []).append(k)
    stadiums, kept = [], []; why = []
    special = cfg.get('specialBuildings', {})
    for wid, pts, t in outlines + parts:
        if len(pts) < 4 or wid in route_buildings: continue
        is_part = 'building:part' in t and wid not in [o[0] for o in outlines[:0]]
        if not is_part and any(k for (la, lo) in [(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))]
                               for dk in [(a, b) for a in (-1, 0, 1) for b in (-1, 0, 1)]
                               for k in pc_grid.get((round(la * 500) + dk[0], round(lo * 500) + dk[1]), [])
                               if point_in([(p[1], p[0]) for p in pts], part_centres[k][1], part_centres[k][0])):
            continue
        clat = sum(p[0] for p in pts) / len(pts); clon = sum(p[1] for p in pts) / len(pts)
        h = height_of(t)
        name = t.get('name', '')
        if t.get('building') == 'stadium' or t.get('leisure') == 'stadium' or name in cfg.get('stadiums', {}):
            if name in cfg.get('stadiums', {}):
                stadiums.append({'name': name, **cfg['stadiums'][name], 'ring': [q(*p) for p in pts]})
            continue
        if not (gs < clat < gn and gw < clon < ge): why.append('bbox'); continue
        d = route_dist(clat, clon, brad)
        if d > brad and not (h and h >= tall): why.append('far'); continue
        b = t.get('building', t.get('building:part', 'yes'))
        if h is None:
            h = {'house': 8.5, 'detached': 8.5, 'semidetached_house': 9, 'terrace': 10, 'residential': 10.5, 'apartments': 14,
                 'garage': 3.2, 'garages': 3.2, 'shed': 3, 'commercial': 9, 'retail': 7.5, 'industrial': 9.5, 'warehouse': 10,
                 'church': 16, 'school': 11, 'hospital': 20, 'office': 18, 'parking': 12, 'hotel': 24}.get(b, 9.5)
            h *= 0.9 + (int(wid.strip('r').split('_')[0]) % 7) * 0.04
        nm = name.lower()
        if name in special: kind = special[name]
        elif b in ('church', 'cathedral', 'chapel') or t.get('amenity') == 'place_of_worship': kind = 7
        elif b in ('parking',) or t.get('amenity') == 'parking': kind = 8
        elif h >= 38: kind = 5 if (int(wid.strip('r').split('_')[0]) % 10) < 5 else 4
        elif b in ('industrial', 'warehouse', 'manufacture', 'service', 'shed', 'garage', 'garages'): kind = 3
        elif b in ('house', 'detached', 'semidetached_house', 'bungalow'): kind = 1
        elif b in ('terrace', 'residential', 'apartments'): kind = 0
        elif b in ('commercial', 'retail', 'office', 'hotel', 'school', 'university', 'hospital', 'civic', 'public', 'government'): kind = 2
        else:
            # untagged: small footprints in residential areas are houses or brick rowhouses
            px_, py_ = pix(clat, clon)
            res = 0 <= px_ < lx and 0 <= py_ < ly and img.getpixel((int(px_), int(py_))) == 8
            area_m2 = abs(sum(a[1] * b[0] - b[1] * a[0] for a, b in zip(pts, pts[1:] + pts[:1])) / 2 * kx * ky)
            if res and area_m2 < 220: kind = 0 if (clat < 40.4335 and clon > -79.997) or (int(''.join(ch for ch in wid if ch.isdigit()) or 0) % 3 == 0) else 1
            else: kind = 0 if clat < 40.4335 and clon > -79.997 else 2
        lp = [loc(*p) for p in pts]
        if lp[0] == lp[-1]: lp = lp[:-1]
        far = max(range(len(lp)), key=lambda k: math.hypot(lp[k][0] - lp[0][0], lp[k][1] - lp[0][1]))
        sp = simplify(lp[:far + 1], 0.5)[:-1] + simplify(lp[far:] + [lp[0]], 0.5)[:-1]
        if len(sp) < 3: why.append('simp'); continue
        area = sum(sp[i][0] * sp[i - 1][1] - sp[i - 1][0] * sp[i][1] for i in range(len(sp))) / 2
        if abs(area) < 12: why.append('small'); continue
        ll = [((y / ky) + lat0, (x / kx) + lon0) for x, y in sp]
        kept.append({'h': h, 'mh': min_h(t), 'kind': kind, 'ring': [q(*p) for p in ll], 'name': name if name in special or h >= tall else ''})
        poly(ll, 4)
    for name, ring in stadium_rings.items():
        stadiums.append({'name': name, **cfg['stadiums'][name], 'ring': [q(*p) for p in simplify(ring, 0.00001)]})
    print(f'  buildings: {len(kept)} kept ({sum(1 for b in kept if b["h"] >= tall)} tall), {len(stadiums)} stadiums')

    # land grid → codes (water over everything; buildings don't hide water)
    land = list(img.tobytes())

    # 4. Streets, paths and bridges ------------------------------------------------
    route_edges = set()
    for a, b in zip(pts, pts[1:]): route_edges.add((a, b)); route_edges.add((b, a))
    CLS = {'motorway': 0, 'trunk': 0, 'motorway_link': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 3, 'secondary': 3,
           'secondary_link': 4, 'tertiary': 4, 'tertiary_link': 5, 'residential': 5, 'unclassified': 5, 'living_street': 5,
           'pedestrian': 6, 'service': 7, 'cycleway': 8, 'path': 8}
    srad = cfg['streetRadiusM']
    streets = []
    bridge_ways = []
    for wid, (nd, t) in ways.items():
        h = t.get('highway')
        if h not in CLS or t.get('area') == 'yes' or t.get('tunnel') in ('yes', 'building_passage'): continue
        if h == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through'): continue
        nd = [i for i in nd if i in nodes]
        if len(nd) < 2: continue
        if min(route_dist(*nodes[i], srad) for i in nd[::max(1, len(nd) // 6)] + [nd[-1]]) > srad: continue
        bridge = t.get('bridge') not in (None, 'no')
        run = [nd[0]]
        def flush():
            if len(run) >= 2:
                rec = {'cls': CLS[h], 'nodes': run[:], 'bridge': bridge, 'layer': int(parse_m(t.get('layer')) or 0),
                       'oneway': 1 if t.get('oneway') in ('yes', '1') or h in ('motorway', 'motorway_link') else -1 if t.get('oneway') == '-1' else 0,
                       'name': t.get('bridge:name') or t.get('name', '')}
                if t.get('surface') in BRICK_SURFACES and CLS[h] <= 6: rec['surface'] = 'brick'   # [finish] brick / sett streets (OSM)
                streets.append(rec)
                if bridge: bridge_ways.append(rec)
        for a, b in zip(nd, nd[1:]):
            if (a, b) in route_edges:
                flush(); run[:] = [b]
            else: run.append(b)
        flush()
    # bridge decks: chain bridge segments that touch, interpolate deck height between the chain's ground ends
    ends = {}
    for k, rec in enumerate(bridge_ways):
        for n in (rec['nodes'][0], rec['nodes'][-1]): ends.setdefault(n, []).append(k)
    seen = set(); chains = []
    for k in range(len(bridge_ways)):
        if k in seen: continue
        group, stack = [], [k]; seen.add(k)
        while stack:
            u = stack.pop(); group.append(u)
            for n in (bridge_ways[u]['nodes'][0], bridge_ways[u]['nodes'][-1]):
                for v in ends.get(n, []):
                    if v not in seen and bridge_ways[v]['layer'] == bridge_ways[u]['layer']: seen.add(v); stack.append(v)
        chains.append(group)
    deck = {}
    for group in chains:
        # ground ends: nodes of the chain that touch a non-bridge street (or appear once)
        count = Counter(n for u in group for n in (bridge_ways[u]['nodes'][0], bridge_ways[u]['nodes'][-1]))
        anchors = [n for n, c in count.items() if c == 1] or [bridge_ways[group[0]]['nodes'][0]]
        anchor_h = {n: elevation(*nodes[n]) for n in anchors}
        # [road-align] straight along the deck between its ground ends (was inverse-distance: flat ends, steep middle)
        edges_ = [(a_, b_, hv(nodes[a_], nodes[b_])) for u in group for a_, b_ in zip(bridge_ways[u]['nodes'], bridge_ways[u]['nodes'][1:])]
        hts = road_align.deck_heights(edges_, anchor_h)
        # [w2-meets] deck ends at the route take its height; decks crossing over it clear the rider (re-solved twice)
        nxy = {n_: loc(*nodes[n_]) for u in group for n_ in bridge_ways[u]['nodes']}
        extra = road_align.deck_route_anchors(None, edges_, nxy, hts, anchor_h, rxy, e)
        ends_ = {n_: h_ for n_, h_ in extra.items() if n_ in anchor_h}   # deck ends at the route: its height
        if ends_:
            anchor_h = {**anchor_h, **ends_}
            hts = road_align.deck_heights(edges_, anchor_h)
        needs_ = {n_: h_ for n_, h_ in road_align.deck_route_anchors(None, edges_, nxy, hts, anchor_h, rxy, e).items() if n_ not in anchor_h}
        if needs_: hts = road_align.lift_over_route(edges_, hts, anchor_h, needs_)   # over the route: clear, smoothly
        for n, h_ in hts.items(): deck.setdefault(n, h_)
    # pack streets: coords + optional deck heights (0 = on the ground)
    st_coords, st_starts, st_meta, st_deck = [], [], [], []
    # [road-align] ground streets: OSM jitter dropped and free corners rounded; junction nodes (shared by two or
    # more ways, or by the route) and the ends never move, so the street graph stays connected
    used = Counter(n for rec in streets for n in rec['nodes']); used.update(set(pts))
    to_q = lambda x, y: (round(y / ky / UNIT), round(x / kx / UNIT))
    for rec in streets:
        st_starts.append(len(st_coords) // 2)
        nd = rec['nodes']
        if rec['bridge'] or not cfg.get('roundStreets', True) or len(nd) < 3:
            for n in nd:
                st_coords += q(*nodes[n])
                st_deck.append(round((deck[n] - 150) * 10) if rec['bridge'] and n in deck else 0)
        else:
            fixed = [k in (0, len(nd) - 1) or used[n] > 1 for k, n in enumerate(nd)]
            locs = [loc(*nodes[n]) for n in nd]
            src = {id(t): n for t, n in zip(locs, nd)}
            xy, _ = road_align.round_street(locs, fixed, max_shift=cfg.get('streetShiftM', 1.5))
            for t in xy:
                # kept vertices (junctions, ends) are stored exactly as before: identical across streets
                st_coords += q(*nodes[src[id(t)]]) if id(t) in src else to_q(*t)
                st_deck.append(0)
        st_meta += [rec['cls'], (1 if rec['bridge'] else 0) | ((rec['oneway'] + 1) << 1) | (8 if rec.get('surface') == 'brick' else 0), rec['layer'] + 8]   # [finish] bit 3: brick
    st_starts.append(len(st_coords) // 2)
    named_bridges = {}
    for rec in bridge_ways:
        if rec['name']: named_bridges.setdefault(rec['name'], []).append(rec)
    bridges = []
    for name, recs in named_bridges.items():
        style = cfg.get('bridgeStyles', {}).get(name)
        if not style: continue
        longest = max(recs, key=lambda r: sum(hv(nodes[a], nodes[b]) for a, b in zip(r['nodes'], r['nodes'][1:])))
        bridges.append({'name': name, 'style': style, 'path': [[*q(*nodes[n]), round(deck.get(n, elevation(*nodes[n])), 1)] for n in longest['nodes']]})

    # 5. Rails (inclines, light rail), trees, points of interest -----------------------
    rails = []
    for wid, (nd, t) in ways.items():
        r = t.get('railway')
        if r in ('funicular', 'light_rail', 'tram', 'rail') and t.get('tunnel') not in ('yes',):
            nd = [i for i in nd if i in nodes]
            if len(nd) < 2 or min(route_dist(*nodes[i], 900) for i in nd[::max(1, len(nd) // 5)]) > 900: continue
            rails.append({'kind': r, 'name': t.get('name', ''), 'path': [q(*nodes[i]) for i in nd], 'bridge': t.get('bridge') not in (None, 'no')})
    trees = []
    for i, t in ntags.items():
        if t.get('natural') == 'tree' and i in nodes:
            la, lo = nodes[i]
            if gs < la < gn and gw < lo < ge and route_dist(la, lo, 700) < 700: trees += q(la, lo)

    out = {
        'format': 'bikefree-city-1',
        'attribution': 'Map data © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles',
        'origin': [lat0, lon0], 'unit': UNIT, 'waterLevelM': cfg['waterLevelM'],
        'grid': {'north': gn, 'west': gw, 'south': gs, 'east': ge, 'nx': nx, 'ny': ny, 'base': 150, 'scale': 0.1, 'h': pack_uint16([(h - 150) * 10 for h in H])},
        'land': {'nx': lx, 'ny': ly, 'rle': rle(land)},
        'routeKinds': route_kinds,
        'routeBridges': [{**b, 'style': cfg.get('bridgeStyles', {}).get(b['name'], 'girder')} for b in route_bridges],
        'buildings': {
            'count': len(kept),
            'h': pack_uint16([b['h'] * 10 for b in kept]), 'mh': pack_uint16([b['mh'] * 10 for b in kept]),
            'kind': list(b['kind'] for b in kept),
            'starts': pack_uint32([0] + list(__import__('itertools').accumulate(len(b['ring']) for b in kept))),
            'xy': pack_int16([v for b in kept for p in b['ring'] for v in p]),
            'names': {str(k): b['name'] for k, b in enumerate(kept) if b['name']},
        },
        'stadiums': stadiums,
        'streets': {'count': len(streets), 'meta': st_meta, 'starts': pack_uint32(st_starts), 'xy': pack_int16(st_coords), 'deck': pack_uint16(st_deck)},
        'bridges': bridges,
        'rails': rails,
        'trees': pack_int16(trees),
    }
    out['streetKit'] = street_kit.extract(nodes, ntags, ways, q, route_dist)   # [street-kit]
    path = os.path.join(ROOT, cfg['data'])
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(f'  wrote {cfg["data"]} ({os.path.getsize(path) / 1e6:.2f} MB): {len(streets)} streets, {len(bridges)} styled bridges, '
          f'{len(rails)} rail lines, {len(trees) // 2} trees')


if __name__ == '__main__':
    for cid in sys.argv[1:] or [f[:-5] for f in os.listdir(os.path.join(ROOT, 'tools', 'city')) if f.endswith('.json')]:
        build(cid)
