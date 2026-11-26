#!/usr/bin/env python3
"""Out West's hero landmarks (user, 26 Nov 2026: "Moody landscapes and detailed hero structures"; plan in the Project
doc claude/out-west-map.md) → routes/cities/outwest-heroes.json, built in the graph world by
js/world/toolbox/city/outwest-landmarks.js (the red-rock geometry: js/world/toolbox/landscape/redrock.js).

  ow_tunnel     the Kanab Creek tunnel: US 89 bored through a sandstone fin above the East Fork descent, Zion-style
                galleries cut through the downhill wall (the ride goes through it)
  ow_hoodoos    Hoodoo Rim: a Bryce amphitheater of orange-and-white hoodoos on the lower ground below the US 89 summit
  ow_arches     the Arch Garden: a Delicate-style freestanding arch, a double window in a fin, a long thin
                Landscape-style span, on slickrock benches beside Hancock Road
  ow_buttes     Butte Valley: Monument Valley's mittens, Merrick-style buttes and a totem spire round the Eight Mile Gap
                gravel loop and US 89 east
  ow_frontier   the Johnson Canyon movie set: a western street of false fronts, a boardwalk, hitching rails, a water tower

Each is placed against the road graph (routes/cities/outwest.json): set back from every way by its own size, its
ground from the DEM (the same AWS terrain the graph used). A blend map — the real parks are hours apart; their looks
are brought here.

  python3 tools/outwest_heroes.py
"""
import json, math, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.argv = [sys.argv[0], '--city', 'outwest'] + [a for a in sys.argv[1:] if a == '--offline']
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import build_pgh as B   # (elevation: the DEM the graph's heights came from)

G = json.load(open(os.path.join(ROOT, 'routes', 'cities', 'outwest.json')))
LAT0 = 37.1
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540


def dec(a):
    o, s = [], 0
    for v in a: s += v; o.append(s / 1e6)
    return o


EDGES = []
for e in G['edges']:
    la, lo = dec(e['lat']), dec(e['lon'])
    EDGES.append((e, la, lo))
# a 50 m hash of every way's points (x, y in metres)
GRID = {}
for e, la, lo in EDGES:
    for a, o in zip(la, lo):
        GRID.setdefault((int(o * KX // 50), int(a * KY // 50)), []).append((o * KX, a * KY))


def way_dist(lat, lon, cap=600):
    x, y = lon * KX, lat * KY
    k = int(cap // 50) + 1
    best = cap
    cx, cy = int(x // 50), int(y // 50)
    for i in range(-k, k + 1):
        for j in range(-k, k + 1):
            for px, py in GRID.get((cx + i, cy + j), ()):
                d = math.hypot(px - x, py - y)
                if d < best: best = d
    return best


def edge(name, lat, lon):
    """The edge named `name` passing nearest (lat, lon) (by place, not id: ids change when the graph is rebuilt)."""
    best = None
    for e, la, lo in EDGES:
        if e['name'] != name: continue
        d = min((a - lat) ** 2 + ((o - lon) * .8) ** 2 for a, o in zip(la, lo))
        if best is None or d < best[0]: best = (d, e, la, lo)
    if not best: raise KeyError(name)
    return best[1:]


def off(lat, lon, dx, dy):
    """(lat, lon) moved dx m east, dy m north."""
    return lat + dy / KY, lon + dx / KX


def along(la, lo, s):
    """The point s m along a polyline, with its unit direction (east, north)."""
    acc = 0
    for i in range(len(la) - 1):
        dx, dy = (lo[i + 1] - lo[i]) * KX, (la[i + 1] - la[i]) * KY
        L = math.hypot(dx, dy)
        if acc + L >= s and L > 0:
            t = (s - acc) / L
            return la[i] + (la[i + 1] - la[i]) * t, lo[i] + (lo[i + 1] - lo[i]) * t, dx / L, dy / L
        acc += L
    return la[-1], lo[-1], 0, 1


def length(la, lo):
    return sum(math.hypot((lo[i + 1] - lo[i]) * KX, (la[i + 1] - la[i]) * KY) for i in range(len(la) - 1))


def place(lat, lon, need, tries=40, step=25, seed=1):
    """(lat, lon) nudged outward until every way is at least `need` m off (a spiral search), else None."""
    if way_dist(lat, lon) >= need: return lat, lon
    for k in range(1, tries):
        a, r = k * 2.399 + seed, step * math.sqrt(k)
        q = off(lat, lon, math.cos(a) * r, math.sin(a) * r)
        if way_dist(*q) >= need: return q
    return None


landmarks = []

# ---- the tunnel: e583, US 89 descending from the summit to Mt Carmel (the hillside rises on the left going down)
e, la, lo = edge('US 89', 37.2015, -112.675)
L = length(la, lo)
# (the stretch between 37.1995 and 37.2035 — the steepest side slope — measured along the edge)
ss = [s for s in range(0, int(L), 5) if 37.1995 <= along(la, lo, s)[0] <= 37.2035]
s0, s1 = ss[0], min(ss[-1], ss[0] + 380)
pts = []
s = s0
while s <= s1:
    a, o, ux, uy = along(la, lo, s)
    pts.append([round(a, 7), round(o, 7)])
    s += 4
# which side the hill is: compare the ground 60 m each side at the middle
a, o, ux, uy = along(la, lo, (s0 + s1) / 2)
left = B.elevation(*off(a, o, -uy * 60, ux * 60)) - B.elevation(*off(a, o, uy * 60, -ux * 60))
landmarks.append({'label': 'Kanab Creek Tunnel', 'model': 'ow_tunnel', 'edge': e['id'], 'path': pts, 'hill': 1 if left > 0 else -1,
                  'galleries': [0.32, 0.5, 0.68], 'center': pts[len(pts) // 2],
                  'note': 'US 89 bored through a sandstone fin, Zion-Mt Carmel style: a 12 m bore, three galleries cut through the downhill wall'})

# ---- Hoodoo Rim: the lower ground round the summit stretch of e583's start (37.183–37.192)
hoods = []
for k in range(260):
    h1 = (math.sin(k * 12.9898) * 43758.5453) % 1
    h2 = (math.sin(k * 78.233) * 12345.678) % 1
    lat, lon = 37.1835 + h1 * .0095, -112.6555 + h2 * .0135
    d = way_dist(lat, lon)
    if d < 22 or d > 420: continue
    g = B.elevation(lat, lon)
    hoods.append([round(lat, 6), round(lon, 6), round(g, 1)])
landmarks.append({'label': 'Hoodoo Rim', 'model': 'ow_hoodoos', 'center': [37.1878, -112.6488], 'points': hoods,
                  'note': "Bryce's hoodoos: orange spires banded pink and white, a hard white caprock on each; the tallest away from the road"})

# ---- the Arch Garden on Hancock Road (e354, between the dunes and Kanab Creek)
e, la, lo = edge('Hancock Road', 37.086, -112.672)
arches = []
for s, kind, side, need in ((300, 'delicate', 1, 34), (620, 'window', -1, 40), (960, 'landscape', 1, 46)):
    a, o, ux, uy = along(la, lo, s)
    c = off(a, o, -uy * side * (need + 6), ux * side * (need + 6))
    c = place(*c, need, step=10, seed=s)
    if not c: continue
    # the span turned to face the road
    yaw = math.degrees(math.atan2(ux, uy))
    arches.append({'kind': kind, 'center': [round(c[0], 7), round(c[1], 7)], 'faceDeg': round(yaw, 1)})
landmarks.append({'label': 'Arch Garden', 'model': 'ow_arches', 'center': arches[0]['center'] if arches else [37.085, -112.67], 'arches': arches,
                  'note': "Arches NP's forms: Delicate (freestanding on a slickrock bowl's rim), a double window in a fin, Landscape's long thin span"})

# ---- Butte Valley round the Eight Mile Gap loop (e551) and US 89 east
buttes = []
for name, lat, lon, kind, R, H in (('West Mitten', 37.0105, -112.4485, 'mitten', 95, 160),
                                    ('East Mitten', 37.0072, -112.4205, 'mitten', 90, 150),
                                    ('Merrick Butte', 37.0315, -112.4115, 'butte', 120, 120),
                                    ('Sentinel Mesa', 36.9985, -112.3935, 'mesa', 170, 105),
                                    ('Totem Spire', 37.0175, -112.4045, 'spire', 22, 95),
                                    ('Three Sisters', 37.0245, -112.4535, 'sisters', 40, 80)):
    c = place(lat, lon, R * 2.2 + 30, step=40, seed=R)
    if not c: print(f'  {name}: no room'); continue
    buttes.append({'name': name, 'kind': kind, 'center': [round(c[0], 6), round(c[1], 6)], 'R': R, 'H': H})
landmarks.append({'label': 'Butte Valley', 'model': 'ow_buttes', 'center': [37.017, -112.425], 'buttes': buttes,
                  'note': "Monument Valley's forms: two mittens, a butte, a long mesa, a totem spire and three sisters, on talus skirts"})

# ---- the Johnson Canyon movie set: a western street off the canyon road (e513, ~2.6 km up)
e, la, lo = edge('Johnson Canyon Road', 37.10, -112.38)
a, o, ux, uy = along(la, lo, length(la, lo) - 2600)
side = 1
c = place(*off(a, o, -uy * side * 70, ux * side * 70), 45, seed=3)
landmarks.append({'label': 'Johnson Canyon Movie Set', 'model': 'ow_frontier', 'center': [round(c[0], 7), round(c[1], 7)],
                  'axisDeg': round(math.degrees(math.atan2(ux, uy)), 1),
                  'note': "Kanab's 'Little Hollywood': a western street of false fronts on a boardwalk, hitching rails, a water tower"})

out = {'format': 'bikefree-heroes-1', 'note': __doc__.split('\n\n')[0], 'heroes': [], 'buildings': [], 'landmarks': landmarks,
       'stadiums': [], 'inclines': [], 'overlooks': [], 'stations': [], 'shops': [], 'styles': [], 'villages': [{'name': 'Kanab', 'center': [37.0475, -112.5263], 'r': 1800}]}
path = os.path.join(ROOT, 'routes', 'cities', 'outwest-heroes.json')
json.dump(out, open(path, 'w'), separators=(',', ':'))
print(f'wrote {os.path.relpath(path, ROOT)}: ' + ', '.join(f"{l['label']} ({len(l.get('points') or l.get('arches') or l.get('buttes') or l.get('path') or [])})" for l in landmarks))
