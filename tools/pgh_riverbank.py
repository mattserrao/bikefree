"""PGH's riverbanks: the real shore (OSM's river areas) against the land the world draws (the terrain, cut to the river
bed within 1.2 m of the pool, water at pool + 0.35 m) — user, 21 Nov: "the Point is built up and smoothed with
stone; compare the map". Shape only (no textures).

Every 20 m along the real shore (within 600 m of a PGH way): a profile across it, from 60 m out in the river to 60 m
inland, on the terrain tiles. Per spot:
  shift    where the drawn water's edge is, from the real shore (+ inland: the land drawn under water; − out: land
           drawn in the river)
  bank     the land's height 25 m in, over the pool; spread: how far in the bank reaches 80 % of it (a stone wall is
           ~0 m; the terrain tiles smear one over 15–30 m)
  walled   OSM has a wall, retaining wall, embankment, quay, pier or cliff within 15 m of the shore
  way      the nearest PGH way within 60 m of the shore: its gap to the water and its height over the pool
Classes (a spot can have several): walled-smeared, flooded (shift > 12 m), land-in-river (shift < −12 m), low-bank
(bank < 2.5 m: a muddy ramp at the waterline), way-at-water (a way < 2 m over the pool), way-on-slope (a way whose
edge is within the smeared bank: it rides on the slope, not on the bank top).

  python3 tools/pgh_riverbank.py   → tools/.cache/pgh-riverbank.json (spots + stretches)
"""
import glob, json, math, os, sys, xml.etree.ElementTree as ET
from collections import defaultdict
sys.argv.append('--offline')
sys.path.insert(0, os.path.dirname(__file__))
import build_pgh as B

ROOT = B.ROOT
cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', 'pgh.json')))
POOL = cfg['waterLevelM']
WET = POOL + 1.2          # graph-world.js BED_BELOW: ground this close to the pool is river bed
POOLS = cfg.get('pools', [])
def pool_at(la, lo):
    for p in POOLS:
        s_, w_, n_, e_ = p['box']
        if s_ <= la <= n_ and w_ <= lo <= e_: return p['level']
    return cfg['waterLevelM']
KX, KY = 111320 * math.cos(math.radians(40.44)), 110540
X = lambda lo: (lo + 80) * KX
Y = lambda la: (la - 40.44) * KY
LL = lambda x, y: (y / KY + 40.44, x / KX - 80)

# OSM: river areas (outer + inner = islands) and shore structures
nodes, wayrefs, rings, walls = {}, {}, [], []
WALLS = {('barrier', 'wall'), ('barrier', 'retaining_wall'), ('man_made', 'embankment'), ('man_made', 'quay'), ('man_made', 'pier'), ('natural', 'cliff'), ('man_made', 'breakwater')}
river_members = set()
for f in glob.glob(os.path.join(ROOT, 'tools', '.cache', 'osm-pgh', '*.osm')):
    r = ET.parse(f).getroot()
    for nd in r.iter('node'): nodes[nd.get('id')] = (float(nd.get('lat')), float(nd.get('lon')))
    for w in r.iter('way'):
        refs = [x.get('ref') for x in w.iter('nd')]
        wayrefs[w.get('id')] = refs
        t = {x.get('k'): x.get('v') for x in w.iter('tag')}
        if t.get('natural') == 'water' and t.get('water') == 'river': river_members.add(w.get('id'))
        kind = next((f'{k}={v}' for k, v in WALLS if t.get(k) == v), None)
        if kind: walls.append((kind, refs))
    for rel in r.iter('relation'):
        t = {x.get('k'): x.get('v') for x in rel.iter('tag')}
        if t.get('natural') == 'water' and t.get('water') == 'river' or t.get('waterway') == 'riverbank':
            for m in rel.iter('member'):
                if m.get('type') == 'way' and m.get('role') in ('outer', 'inner', ''): river_members.add(m.get('ref'))
shore_lines = [[nodes[n] for n in wayrefs[w] if n in nodes] for w in river_members if w in wayrefs]
shore_lines = [l for l in shore_lines if len(l) > 1]
wgrid = defaultdict(list)
for kind, refs in walls:
    pts = [nodes[n] for n in refs if n in nodes]
    for (a, b) in zip(pts, pts[1:]):
        L = math.hypot(X(b[1]) - X(a[1]), Y(b[0]) - Y(a[0])); k = max(1, int(L / 5))
        for j in range(k + 1):
            x, y = X(a[1] + (b[1] - a[1]) * j / k), Y(a[0] + (b[0] - a[0]) * j / k)
            wgrid[(int(x // 20), int(y // 20))].append((x, y, kind))

# PGH ways
pgh = json.load(open(os.path.join(ROOT, 'routes', 'cities', 'pgh.json')))
egrid = defaultdict(list)
for e in pgh['edges']:
    la = lo = el = 0
    for a, b, c in zip(e['lat'], e['lon'], e['ele']):
        la += a; lo += b; el += c
        x, y = X(lo * 1e-6), Y(la * 1e-6)
        egrid[(int(x // 30), int(y // 30))].append((x, y, el * 0.1, e['name'], e['kind'], (pgh['widths'].get(e['kind'], 7)) / 2))
near_net = lambda x, y, r: any(math.hypot(px - x, py - y) < r for i in range(-r // 30 - 1, r // 30 + 2) for j in range(-r // 30 - 1, r // 30 + 2) for px, py, *_ in egrid.get((int(x // 30) + i, int(y // 30) + j), ()))

ele = lambda x, y: B.elevation(*LL(x, y))
spots = []
for line in shore_lines:
    P = [(X(lo), Y(la)) for la, lo in line]
    acc = 0.0
    for (x0, y0), (x1, y1) in zip(P, P[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-6: continue
        tx, ty = (x1 - x0) / L, (y1 - y0) / L
        s = (20 - acc) % 20
        while s <= L:
            x, y = x0 + tx * s, y0 + ty * s
            s += 20
            if not near_net(x, y, 600): continue
            POOL_ = pool_at(*LL(x, y)); WET_ = POOL_ + 1.2
            nx, ny = -ty, tx
            # which side is land: higher terrain 40 m out
            if ele(x + nx * 40, y + ny * 40) < ele(x - nx * 40, y - ny * 40): nx, ny = -nx, -ny
            prof = [(d, ele(x + nx * d, y + ny * d)) for d in range(-60, 61, 5)]
            # the drawn water's edge: the last wet point from the river side before the land stays dry
            edge = None
            for (d0, h0), (d1, h1) in zip(prof, prof[1:]):
                if h0 < WET_ <= h1: edge = d0 + (WET_ - h0) / (h1 - h0) * (d1 - d0); break
            if edge is None: edge = 60 if all(h < WET_ for _, h in prof) else -60
            hb = ele(x + nx * 25, y + ny * 25) - POOL_
            h0 = max(ele(x + nx * max(edge, 0), y + ny * max(edge, 0)) - POOL_, 0)
            spread = next((d - max(edge, 0) for d, h in prof if d >= max(edge, 0) and h - POOL_ >= h0 + 0.8 * (hb - h0)), 60)
            walled = sorted({k for i in (-1, 0, 1) for j in (-1, 0, 1) for wx, wy, k in wgrid.get((int(x // 20) + i, int(y // 20) + j), ()) if math.hypot(wx - x, wy - y) < 15})
            # nearest way inland within 60 m
            best = None
            for i in range(-3, 4):
                for j in range(-3, 4):
                    for px, py, pe, pn, pk, half in egrid.get((int(x // 30) + i, int(y // 30) + j), ()):
                        d = math.hypot(px - x, py - y)
                        if d < 60 and (best is None or d < best[0]) and ((px - x) * nx + (py - y) * ny) > -10: best = (d, pe - POOL_, pn, pk, half)
            la, lo = LL(x, y)
            spot = {'lat': round(la, 6), 'lon': round(lo, 6), 'shift': round(edge, 1), 'bank': round(hb, 1), 'spread': spread, 'walled': walled,
                    'way': None if not best else {'name': best[2], 'kind': best[3], 'gap': round(best[0] - best[4], 1), 'over': round(best[1], 1)}}
            cls = []
            if walled and spread > 8 and hb > 2: cls.append('walled-smeared')
            if edge > 12: cls.append('flooded')
            if edge < -12: cls.append('land-in-river')
            if hb < 2.5: cls.append('low-bank')
            if best and best[1] < 2: cls.append('way-at-water')
            if best and not walled and 0 < best[0] - best[4] < max(edge, 0) + spread and best[1] < hb - 1.5: cls.append('way-on-slope')
            spot['cls'] = cls
            spots.append(spot)

# name stretches by the nearest PGH junction
jn = [(X(n['lon']), Y(n['lat']), n['name']) for n in pgh['nodes']]
def place(la, lo):
    x, y = X(lo), Y(la)
    return min(jn, key=lambda j: (j[0] - x) ** 2 + (j[1] - y) ** 2)[2]
AREAS = [('The Point', 40.4417, -80.0125, 500), ('North Shore', 40.4465, -80.0050, 900), ('Downtown — Mon Wharf', 40.4375, -80.0010, 700),
         ('Downtown — Allegheny side', 40.4455, -79.9960, 700), ('Strip District', 40.4560, -79.9810, 1300), ('Lawrenceville', 40.4700, -79.9640, 1500),
         ('Station Square', 40.4335, -80.0040, 800), ('South Side', 40.4280, -79.9750, 1600), ('Hazelwood / Glenwood', 40.4050, -79.9440, 1500),
         ('Homestead', 40.4060, -79.9150, 1700), ('West End / Chateau', 40.4520, -80.0300, 1400), ('Herrs Island / Troy Hill', 40.4640, -79.9800, 900)]
def area(la, lo):
    best = min(AREAS, key=lambda a: math.hypot((a[2] - lo) * KX, (a[1] - la) * KY) / a[3])
    return best[0] if math.hypot((best[2] - lo) * KX, (best[1] - la) * KY) < best[3] * 1.6 else 'Elsewhere'
summary = defaultdict(lambda: defaultdict(int))
for s in spots:
    s['area'] = area(s['lat'], s['lon'])
    summary[s['area']]['spots'] += 1
    for c in s['cls']: summary[s['area']][c] += 1
    if s['walled']: summary[s['area']]['walled'] += 1
    summary[s['area']]['spread'] += s['spread']; summary[s['area']]['bank'] += s['bank']
out = {'pool': POOL, 'spots': spots, 'areas': {a: dict(v) for a, v in summary.items()}}
json.dump(out, open(os.path.join(ROOT, 'tools', '.cache', 'pgh-riverbank.json'), 'w'))
tot = defaultdict(int)
for s in spots:
    for c in s['cls']: tot[c] += 1
print(f'riverbank: {len(spots)} spots every 20 m ({len(spots) * 20 / 1000:.1f} km of shore within 600 m of PGH); OSM shore structures: {len(walls)}')
print('  ' + ', '.join(f'{k} {v}' for k, v in sorted(tot.items(), key=lambda x: -x[1])))
print(f'  {"area":28} {"km":>5} {"walled":>7} {"smeared":>8} {"flood":>6} {"in-riv":>6} {"low":>5} {"way@water":>9} {"on-slope":>8} {"bank m":>7} {"spread m":>8}')
for a, v in sorted(summary.items(), key=lambda x: -x[1]['spots']):
    n = v['spots']
    print(f'  {a:28} {n * 0.02:5.1f} {v.get("walled", 0):7} {v.get("walled-smeared", 0):8} {v.get("flooded", 0):6} {v.get("land-in-river", 0):6} {v.get("low-bank", 0):5} {v.get("way-at-water", 0):9} {v.get("way-on-slope", 0):8} {v["bank"] / n:7.1f} {v["spread"] / n:8.1f}')
