#!/usr/bin/env python3
"""Pittsburgh landmarks on PGH: where each would go (its OSM footprint, else a circle), and what collides — nothing built.

    python3 tools/pgh_landmarks.py

The list: the landmarks already on the Pittsburgh map (routes/cities/pittsburgh-map.json) and the future list in the
bikefree Project doc claude/pittsburgh-landmarks.md (written out below). Each is found in the cached OSM tiles
(tools/.cache/osm-pgh) by name near where it should be; its footprint is the mapped outline (a building, a park, a
memorial's area) or, for a point, a circle sized by its kind. Collisions:
  road         a PGH way runs through a building's or a monument's footprint (open spaces — parks, plazas, overlooks —
               have ways through them on purpose: listed, not a collision)
  landmark     two landmarks' footprints overlap
Writes tools/.cache/pgh-landmarks.json for the review map.
"""
import json, math, os, re, sys
import xml.etree.ElementTree as ET
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')

# (label, names to look for, kind: building | monument | open | structure | underground, area hint [lat, lon] or None)
FUTURE = [
    ('Koppers Tower', ['Koppers Building', 'Koppers Tower'], 'building', None),
    ('Frick Building', ['Frick Building'], 'building', None),
    ('Mellon National Bank Building', ['Mellon National Bank', 'Mellon Bank Building', 'Lord & Taylor'], 'building', None),
    ('Tower at PNC Plaza', ['Tower at PNC Plaza'], 'building', None),
    ('EQT Plaza', ['EQT Plaza'], 'building', None),
    ('Heinz Hall', ['Heinz Hall'], 'building', None),
    ('Benedum Center', ['Benedum Center'], 'building', None),
    ('Allegheny County Jail & Courthouse', ['Allegheny County Courthouse', 'Old Allegheny County Jail'], 'building', None),
    ('Engine Company No. 1', ['Engine Company No. 1', 'Engine Company Number 1', 'Engine Co. No. 1'], 'building', None),
    ('Duquesne Incline upper station', ['Duquesne Incline'], 'building', [40.4380, -80.0177]),
    ('Station Square P&LE terminal', ['Grand Concourse', 'Landmarks Building', 'Pittsburgh and Lake Erie Railroad Complex'], 'building', [40.4340, -80.0058]),
    ('Randyland', ['Randyland'], 'building', None),
    ('National Aviary', ['National Aviary'], 'building', None),
    ('Carnegie Library, Allegheny', ['Carnegie Library of Pittsburgh - Allegheny', 'Allegheny Carnegie Library', 'Carnegie Free Library of Allegheny', 'Allegheny Regional Branch'], 'building', None),
    ('Allegheny Observatory', ['Allegheny Observatory'], 'building', None),
    ("Children's Museum (Buhl Planetarium)", ["Children's Museum of Pittsburgh", 'Buhl Planetarium'], 'building', None),
    ('Andy Warhol Museum', ['Andy Warhol Museum', 'The Andy Warhol Museum'], 'building', None),
    ('Mattress Factory', ['Mattress Factory'], 'building', None),
    ('Soldiers and Sailors Monument (Allegheny Commons)', ['Soldiers and Sailors Monument', "Soldiers' and Sailors' Monument", 'Hampton Battery'], 'monument', [40.4530, -80.0080]),
    ('Willie Stargell statue', ['Willie Stargell'], 'monument', None),
    ('Roberto Clemente statue', ['Roberto Clemente'], 'monument', [40.4475, -80.0050]),
    ('Korean War Veterans Memorial', ['Korean War Memorial', 'Korean War Veterans Memorial'], 'monument', None),
    ('"Point of View" (Washington & Guyasuta)', ['Point of View'], 'monument', None),
    ('The Doughboy', ['Doughboy'], 'monument', None),
    ('Troy Hill WWI Monument', ['Troy Hill', 'World War I Memorial'], 'monument', [40.4590, -79.9840]),
    ('Vietnam Veterans Memorial', ['Vietnam Veterans Memorial'], 'monument', None),
    ('Steelworkers Monument', ['Steelworkers Monument', 'Homestead Steel Strike'], 'monument', [40.4050, -79.9150]),
    ('The Hiker', ['The Hiker', 'Spanish-American War'], 'monument', None),
    ('Christopher Columbus statue', ['Christopher Columbus', 'Columbus'], 'monument', [40.4420, -79.9480]),
    ('Edward Manning Bigelow statue', ['Edward Manning Bigelow', 'Bigelow'], 'monument', [40.4400, -79.9460]),
    ('George Washington memorial', ['George Washington', 'Washington Monument'], 'monument', [40.4530, -80.0080]),
    ('Millennium Panther', ['Panther', 'Millennium Panther'], 'monument', [40.4440, -79.9530]),
    ('Heinz History Center', ['Heinz History Center', 'Senator John Heinz History Center'], 'building', None),
    ('Produce Terminal', ['Produce Terminal', 'Pennsylvania Railroad Fruit Auction'], 'building', None),
    ('Penn Brewery', ['Penn Brewery'], 'building', None),
    ('Hamerschlag Hall', ['Hamerschlag Hall'], 'building', None),
    ('Forbes Field wall', ['Forbes Field'], 'monument', None),
    ('Stephen Foster Memorial', ['Stephen Foster Memorial'], 'building', None),
    ('Mellon Institute', ['Mellon Institute'], 'building', None),
    ('Frick Fine Arts', ['Frick Fine Arts'], 'building', None),
    ('Saint Josaphat', ['Saint Josaphat', 'St. Josaphat', 'St Josaphat'], 'building', None),
    ('Pittsburgh Zoo entrance', ['Pittsburgh Zoo', 'Pittsburgh Zoo & Aquarium', 'Pittsburgh Zoo and PPG Aquarium'], 'open', None),
    ('Union Project', ['Union Project'], 'building', None),
    ('Sandcastle', ['Sandcastle'], 'open', None),
]
# the map's own landmarks: kind from theirs; the towers downtown one by one
KIND = {'city': 'building', 'park': 'open', 'sport': 'building', 'view': 'open', 'culture': 'building', 'church': 'building',
        'steel': 'structure', 'transit': 'underground'}
EXTRA = [('U.S. Steel Tower', ['U.S. Steel Tower', 'US Steel Tower'], 'building', None), ('BNY Mellon Center', ['BNY Mellon Center', 'One Mellon Center'], 'building', None),
         ('Gulf Tower', ['Gulf Tower'], 'building', None), ('Fifth Avenue Place', ['Fifth Avenue Place'], 'building', None),
         ('Grant Building', ['Grant Building'], 'building', None), ('Fort Pitt Blockhouse', ['Fort Pitt Block House', 'Blockhouse'], 'building', [40.4410, -80.0100]),
         ('Fort Pitt Museum', ['Fort Pitt Museum'], 'building', None), ('Point State Park fountain', ['Point State Park Fountain', 'Fountain'], 'open', [40.4417, -80.0125])]
RADIUS = {'building': 22, 'monument': 6, 'open': 60, 'structure': 25, 'underground': 25}
ROAD_COLLIDES = {'building', 'monument', 'structure'}


def norm(s):
    return re.sub(r'[^a-z0-9 ]', '', s.lower().replace('&', 'and').replace('saint ', 'st ').replace('st. ', 'st '))


def hv(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def point_in(poly, x, y):
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi: inside = not inside
        j = i
    return inside


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay; l = dx * dx + dy * dy or 1
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def main():
    mp = json.load(open(os.path.join(ROOT, 'routes', 'cities', 'pittsburgh-map.json')))
    items = []
    for l in mp['landmarks']:
        if l['label'] == 'Downtown': continue   # (the towers one by one, below)
        names = [l['label'], l['name'].split(' (')[0].split(',')[0]]
        typ = 'monument' if l['label'] == 'Mister Rogers' else 'structure' if 'Incline' in l['label'] else KIND.get(l['kind'], 'building')
        items.append({'label': l['label'], 'names': names, 'type': typ, 'hint': [l['lat'], l['lon']], 'list': 'on the map'})
    have = {norm(i['label']) for i in items}
    for label, names, typ, hint in EXTRA + FUTURE:
        if norm(label) in have: continue
        items.append({'label': label, 'names': names, 'type': typ, 'hint': hint, 'list': 'on the map' if (label, names, typ, hint) in EXTRA else 'future list'})
    # named features in the cached OSM tiles
    folder = os.path.join(CACHE, 'osm-pgh')
    nodes, feats = {}, []
    keys = ('building', 'historic', 'tourism', 'memorial', 'artwork_type', 'amenity', 'leisure', 'man_made', 'landuse', 'railway', 'aerialway', 'shop', 'office')
    wayrefs = {}
    for f in sorted(os.listdir(folder)):
        if not f.endswith('.osm'): continue
        root = ET.parse(os.path.join(folder, f)).getroot()
        for nd in root.iter('node'):
            nodes[nd.get('id')] = (float(nd.get('lat')), float(nd.get('lon')))
            t = {x.get('k'): x.get('v') for x in nd.iter('tag')}
            if t.get('name') and any(k in t for k in keys): feats.append({'name': t['name'], 'tags': t, 'pt': nodes[nd.get('id')]})
        for wy in root.iter('way'):
            refs = [x.get('ref') for x in wy.iter('nd')]
            wayrefs[wy.get('id')] = refs
            t = {x.get('k'): x.get('v') for x in wy.iter('tag')}
            if t.get('name') and any(k in t for k in keys) and 'highway' not in t: feats.append({'name': t['name'], 'tags': t, 'refs': refs})
        for rel in root.iter('relation'):
            t = {x.get('k'): x.get('v') for x in rel.iter('tag')}
            if t.get('name') and any(k in t for k in keys) and t.get('type') in ('multipolygon', 'building'):
                feats.append({'name': t['name'], 'tags': t, 'members': [m.get('ref') for m in rel.iter('member') if m.get('type') == 'way' and m.get('role') in ('outer', '')]})
    for ft in feats:
        if 'refs' in ft: ft['poly'] = [nodes[r] for r in ft['refs'] if r in nodes]
        elif 'members' in ft:
            pts = [nodes[r] for w in ft['members'] for r in wayrefs.get(w, []) if r in nodes]
            ft['poly'] = pts
        if ft.get('poly'):
            ft['pt'] = (sum(p[0] for p in ft['poly']) / len(ft['poly']), sum(p[1] for p in ft['poly']) / len(ft['poly']))
    feats = [f for f in feats if f.get('pt')]
    print(f'  OSM: {len(feats)} named features')
    # PGH ways
    pgh = json.load(open(os.path.join(ROOT, 'routes', 'cities', 'pgh.json')))
    W = pgh['widths']
    lat0 = pgh['origin']['lat']; kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    XY = lambda p: ((p[1] - pgh['origin']['lon']) * kx, (p[0] - lat0) * ky)
    edges = []
    for e in pgh['edges']:
        la = lo = 0; pts = []
        for a, b in zip(e['lat'], e['lon']): la += a; lo += b; pts.append(XY((la * 1e-6, lo * 1e-6)))
        edges.append({'id': e['id'], 'name': e['name'], 'kind': e['kind'], 'pts': pts, 'half': W.get(e['kind'], 7) / 2})
    egrid = defaultdict(list)
    for k, e in enumerate(edges):
        for i, (x, y) in enumerate(e['pts']): egrid[(int(x // 50), int(y // 50))].append((k, i))
    out = []
    for it in items:
        want = [norm(n) for n in it['names'] if n]
        best, bs = None, 0
        for ft in feats:
            nm = norm(ft['name'])
            s = max((3 if nm == w else 2 if (w in nm or nm in w) and len(min(w, nm, key=len)) >= 5 else 0) for w in want)
            if not s: continue
            d = hv(ft['pt'], it['hint']) if it['hint'] else 0
            if it['hint'] and d > 900: continue
            s += (1 if ft.get('poly') and len(ft['poly']) > 3 else 0) - d / 2000
            if it['type'] == 'monument' and ('memorial' in ft['tags'] or ft['tags'].get('historic') in ('memorial', 'monument') or 'artwork_type' in ft['tags']): s += 1
            if s > bs: bs, best = s, ft
        rec = {'label': it['label'], 'type': it['type'], 'list': it['list']}
        if best:
            rec['osm'] = best['name']
            c = best['pt']
            poly = best.get('poly') if best.get('poly') and len(best['poly']) > 3 else None
            if poly and it['type'] == 'monument' and hv(poly[0], c) > 40: poly = None   # (a monument matched to its whole park)
            if poly and it['type'] in ('structure', 'building') and max(hv(p, c) for p in poly) > 160: poly = None   # (matched to a whole district: a point)
        elif it['hint']:
            c, poly, rec['osm'] = tuple(it['hint']), None, None
        else:
            rec['found'] = False; out.append(rec); continue
        rec['found'] = True
        cx, cy = XY(c)
        inside = cor_ok = any(abs(x - cx) < 1500 and abs(y - cy) < 1500 for e in edges[::50] for x, y in e['pts'][:1])
        if poly: P = [XY(p) for p in poly]
        else:
            r = RADIUS[it['type']]; P = [(cx + r * math.cos(a * math.pi / 12), cy + r * math.sin(a * math.pi / 12)) for a in range(24)]
        rec['poly'] = [[round(lat0 + y / ky, 6), round(pgh['origin']['lon'] + x / kx, 6)] for x, y in P]
        rec['center'] = [round(c[0], 6), round(c[1], 6)]
        rec['footprint'] = 'OSM outline' if poly else f'circle {RADIUS[it["type"]]} m'
        # nearest road and the ways through the footprint
        xs, ys = [p[0] for p in P], [p[1] for p in P]
        bx0, bx1, by0, by1 = min(xs) - 10, max(xs) + 10, min(ys) - 10, max(ys) + 10
        hits, near_d, near_name = {}, 1e9, None
        for gx in range(int(bx0 // 50) - 4, int(bx1 // 50) + 5):
            for gy in range(int(by0 // 50) - 4, int(by1 // 50) + 5):
                for k, i in egrid.get((gx, gy), ()):
                    e = edges[k]; x, y = e['pts'][i]
                    if i + 1 < len(e['pts']):
                        d = seg_dist(cx, cy, x, y, *e['pts'][i + 1])
                        if d < near_d: near_d, near_name = d, e['name']
                    if bx0 <= x <= bx1 and by0 <= y <= by1:
                        # the road's edge inside the footprint: its centre point, or a point half its width to either side
                        if point_in(P, x, y) or any(point_in(P, x + ox, y + oy) for ox, oy in ((e['half'], 0), (-e['half'], 0), (0, e['half']), (0, -e['half']))):
                            hits.setdefault(k, 0); hits[k] += 1
        rec['nearestRoad'] = {'name': near_name, 'm': round(near_d)}
        rec['ways'] = [{'name': edges[k]['name'], 'kind': edges[k]['kind'], 'm': n * 10, 'edge': edges[k]['id']} for k, n in sorted(hits.items(), key=lambda x: -x[1])]
        rec['collides'] = it['type'] in ROAD_COLLIDES and bool(hits)
        out.append(rec)
    # landmark ↔ landmark overlaps
    for i, a in enumerate(out):
        a.setdefault('overlaps', [])
        if not a.get('poly') or a['type'] == 'underground': continue
        PA = [XY(p) for p in a['poly']]
        for b in out[:i]:
            if not b.get('poly') or b['type'] == 'underground': continue
            if a['type'] == 'open' or b['type'] == 'open': continue   # (a park holds its buildings: not a clash)
            PB = [XY(p) for p in b['poly']]
            if any(point_in(PA, *p) for p in PB) or any(point_in(PB, *p) for p in PA):
                a['overlaps'].append(b['label']); b.setdefault('overlaps', []).append(a['label'])
    json.dump(out, open(os.path.join(CACHE, 'pgh-landmarks.json'), 'w'))
    found = [r for r in out if r['found']]
    print(f'  {len(out)} landmarks: {len(found)} placed ({sum(1 for r in found if r["footprint"] == "OSM outline")} with an OSM outline), {len(out) - len(found)} not found')
    for r in out:
        if not r['found']: print(f'    ? {r["label"]}: not found'); continue
        flag = 'COLLIDES' if r['collides'] else ('ways through (open)' if r['ways'] else '')
        ov = f' · overlaps {", ".join(r["overlaps"])}' if r['overlaps'] else ''
        ways = ', '.join(f'{w["name"]} {w["m"]} m' for w in r['ways'][:3])
        print(f'    {r["label"][:40]:40} {r["type"]:11} {r["footprint"]:14} near {r["nearestRoad"]["name"]} {r["nearestRoad"]["m"]} m  {flag} {ways}{ov}')


if __name__ == '__main__':
    main()
