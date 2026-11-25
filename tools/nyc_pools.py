#!/usr/bin/env python3
"""NYC: Central Park's water bodies as the graph world's pools (tools/city/nyc.json "pools"): each OSM water area inside
the park (natural=water) gets its level from the elevation tiles (the lowest tenth of the DEM over it: 3DEP draws a lake
as its flat surface) plus 0.3 m, its box and its outline (ring: the graph world draws and tests the water by it). Run once after the OSM tiles are fetched (python3 tools/build_pgh.py --city
nyc), then build again. Data © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles."""
import glob, json, math, os, sys, xml.etree.ElementTree as ET
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.argv = [sys.argv[0], '--city', 'nyc']
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import build_pgh as B
from shapely.geometry import Polygon, Point

cfg_path = os.path.join(ROOT, 'tools/city/nyc.json')
cfg = json.load(open(cfg_path))
park = Polygon([(p[1], p[0]) for p in json.load(open(os.path.join(ROOT, 'tools/city/nyc-area.json')))['polygon']])
nodes, ways, rels = {}, {}, {}
for f in glob.glob(os.path.join(ROOT, 'tools/.cache/osm-nyc/*.osm')):
    r = ET.parse(f).getroot()
    for nd in r.iter('node'): nodes[nd.get('id')] = (float(nd.get('lat')), float(nd.get('lon')))
    for w in r.iter('way'): ways[w.get('id')] = ([x.get('ref') for x in w.iter('nd')], {x.get('k'): x.get('v') for x in w.iter('tag')})
    for rel in r.iter('relation'): rels[rel.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in rel.iter('member')], {x.get('k'): x.get('v') for x in rel.iter('tag')})
def join_rings(parts):
    """Outer ways joined end to end into closed rings (node id lists)."""
    parts, out = [list(p) for p in parts if p], []
    while parts:
        cur = parts.pop(0)
        while cur[0] != cur[-1]:
            for k, p in enumerate(parts):
                if p[0] == cur[-1]: cur += p[1:]
                elif p[-1] == cur[-1]: cur += p[::-1][1:]
                elif p[-1] == cur[0]: cur = p[:-1] + cur
                elif p[0] == cur[0]: cur = p[::-1][:-1] + cur
                else: continue
                parts.pop(k); break
            else: break
        if cur[0] == cur[-1]: out.append(cur)
    return out
rings = []
for wid, (nd, t) in ways.items():
    if t.get('natural') == 'water' and nd[0] == nd[-1]: rings.append((t.get('name', ''), [nodes[i] for i in nd if i in nodes]))
for rid, (mem, t) in rels.items():
    if t.get('natural') == 'water' and t.get('type') == 'multipolygon':
        for ring in join_rings([ways[ref][0] for typ, ref, role in mem if typ == 'way' and role == 'outer' and ref in ways]):
            rings.append((t.get('name', ''), [nodes[i] for i in ring if i in nodes]))
pools = []
for name, pts in rings:
    if len(pts) < 4: continue
    P = Polygon([(lo, la) for la, lo in pts])
    if not P.is_valid or not park.contains(P.representative_point()): continue
    kx = 111320 * math.cos(math.radians(40.78))
    area = P.area * kx * 110540
    if area < 300 or 'Fountain' in name: continue   # (fountain basins and small pools: the landmarks draw those)
    w, s, e, n = P.bounds
    hs = []
    for i in range(12):
        for j in range(12):
            lo, la = w + (e - w) * (i + .5) / 12, s + (n - s) * (j + .5) / 12
            if P.contains(Point(lo, la)): hs.append(B.elevation(la, lo))
    if not hs: hs = [B.elevation(*P.representative_point().coords[0][::-1])]
    hs.sort()
    level = round(hs[len(hs) // 10] + 0.3, 2)
    ring = [[round(la, 6), round(lo, 6)] for lo, la in P.simplify(1.2 / 111320).exterior.coords][:-1]
    pools.append({'name': name or 'water', 'level': level, 'box': [round(s, 6), round(w, 6), round(n, 6), round(e, 6)], 'dam': False, 'areaM2': round(area), 'ring': ring})
    print(f'  {name or "(unnamed)":36s} {area / 1e4:6.2f} ha  level {level:5.1f} m')
# a pool's level under the ways along its shore: the Reservoir's DEM surface stood above its running track (the water
# would flood the path — the review, 25 Nov); its water 0.9 m under the lowest way within 6 m of its outline
net_path = os.path.join(ROOT, 'routes/cities/nyc.json')
if os.path.exists(net_path):
    net = json.load(open(net_path)); u = net['unit']['latlon']; ue = net['unit']['ele']; o = net['origin']
    def B_way_samples(net):
        import itertools
        for e in net['edges']:
            la, lo, el = itertools.accumulate(e['lat']), itertools.accumulate(e['lon']), itertools.accumulate(e['ele'])
            for a_, o_, h_ in zip(la, lo, el): yield a_ * u, o_ * u, h_ * ue
    for p in pools:
        P = Polygon([(lo, la) for la, lo in p['ring']]); ring = P.exterior
        low = None
        for la, lo, el in B_way_samples(net):
            if abs(la - (p['box'][0] + p['box'][2]) / 2) > 0.01: continue
            d = ring.distance(Point(lo, la)) * 100000
            if d < 6 and not P.contains(Point(lo, la)) and (low is None or el < low): low = el
        if low is not None and p['level'] > low - 0.9:
            print(f"  {p['name']}: level {p['level']} → {round(low - 0.9, 2)} (under the way along its shore)"); p['level'] = round(low - 0.9, 2)
pools.sort(key=lambda p: -p['areaM2'])
cfg['pools'] = pools
json.dump(cfg, open(cfg_path, 'w'), indent=1)
print(f'wrote {len(pools)} pools to tools/city/nyc.json')
