#!/usr/bin/env python3
"""Bake a city ride network's map (the city card's thumbnail and its panel, js/views.js drawCityMap): the rivers'
outline from the OSM water relations the city's areas are built with, clipped round the network and simplified to
~15 m, and the labels (rivers, places; areas are labelled by the app at their own segments, with the short names
given here). PLAN F101.

    python3 tools/build_city_map.py pittsburgh

Reads   tools/city/<city>-map.spec.json (settings: the OSM cache and water relations to use, the margin, the labels;
        the relation files carry their own ways, so no map tiles are read), routes/cities/<city>-network.json (the network: the box)
Writes  routes/cities/<city>-map.json ("bikefree-city-map-1": water [{name, rings: [[[lat, lon], …], …]}] — outer
        rings and islands, even-odd —, labels [{text, lat, lon, kind, angle?}], areaLabels {areaId: text},
        landmarks [{name, label, kind, rank, lat, lon}]: the panel map's markers, PLAN 7.9 — kind: city | park | sport |
        view | culture | church | steel | transit (the marker's colour), rank 1–3: which labels show first)
Data © OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_city as B

ROOT = B.ROOT
LANDMARK_KINDS = ('city', 'park', 'sport', 'view', 'culture', 'church', 'steel', 'transit')


def clip(ring, box):
    """Sutherland–Hodgman: a ring ([lat, lon]) clipped to box (s, w, n, e)."""
    s, w, n, e = box
    edges = [(lambda p: p[0] >= s, lambda a, b: (s, a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]))),
             (lambda p: p[0] <= n, lambda a, b: (n, a[1] + (b[1] - a[1]) * (n - a[0]) / (b[0] - a[0]))),
             (lambda p: p[1] >= w, lambda a, b: (a[0] + (b[0] - a[0]) * (w - a[1]) / (b[1] - a[1]), w)),
             (lambda p: p[1] <= e, lambda a, b: (a[0] + (b[0] - a[0]) * (e - a[1]) / (b[1] - a[1]), e))]
    out = list(ring)
    for inside, cut in edges:
        src, out = out, []
        if not src: break
        prev = src[-1]
        for cur in src:
            if inside(cur):
                if not inside(prev): out.append(cut(prev, cur))
                out.append(cur)
            elif inside(prev): out.append(cut(prev, cur))
            prev = cur
    return out


def build(city):
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', f'{city}-map.spec.json')))
    src = {'id': city, 'osmCache': cfg['osmCache'], 'osmBbox': [0, 0, 0, 0], 'waterRelations': cfg['waterRelations']}
    nodes, _, ways, rels = B.load_osm(src)
    net = json.load(open(os.path.join(ROOT, 'routes', 'cities', f'{city}-network.json')))
    # the box: every area's line, and the margin round it
    import re
    lats, lons = [], []
    for a in net['areas']:
        for la, lo in re.findall(r'lat="([\d.-]+)" lon="([\d.-]+)"', open(os.path.join(ROOT, a['base'])).read()):
            lats.append(float(la)); lons.append(float(lo))
    m = cfg.get('marginM', 1500)
    lat0 = (min(lats) + max(lats)) / 2
    dlat, dlon = m / 111319.49, m / (111319.49 * math.cos(math.radians(lat0)))
    box = (min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon)
    kx = 111319.49 * math.cos(math.radians(lat0))
    to_xy = lambda p: ((p[1] - box[1]) * kx, (p[0] - box[0]) * 111319.49)
    tol = cfg.get('simplifyM', 15)
    water = []
    for rid in src.get('waterRelations', []):
        rel = rels.get(str(rid))
        if not rel: continue
        name = rel[1].get('waterway:name') or rel[1].get('name') or ''
        rings = []
        for role in ('outer', 'inner'):
            for ring in B.rings_of(rel, ways, nodes, role):
                c = clip(ring, box)
                if len(c) < 3: continue
                xy = [to_xy(p) for p in c]
                far = max(range(len(xy)), key=lambda k: math.hypot(xy[k][0] - xy[0][0], xy[k][1] - xy[0][1]))
                keep = B.simplify(xy[:far + 1], tol)[:-1] + B.simplify(xy[far:] + [xy[0]], tol)[:-1]   # (a closed ring: in two halves)
                if len(keep) < 3: continue
                area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(keep, keep[1:] + keep[:1]))) / 2
                if area < cfg.get('minAreaM2', 2000): continue
                rings.append([[round(box[0] + y / 111319.49, 5), round(box[1] + x / kx, 5)] for x, y in keep])
        if rings: water.append({'name': name, 'rings': rings})
    lms = []
    for lm in cfg.get('landmarks', []):
        if lm.get('kind') not in LANDMARK_KINDS or lm.get('rank') not in (1, 2, 3) or not lm.get('name') or not lm.get('label'):
            sys.exit(f'{city}: landmark {lm!r}: needs a name, a label, a kind of {LANDMARK_KINDS} and a rank 1–3')
        if not (box[0] <= lm['lat'] <= box[2] and box[1] <= lm['lon'] <= box[3]):
            print(f'{city}: landmark {lm["label"]} is off the map, left out'); continue
        lms.append({k: lm[k] for k in ('name', 'label', 'kind', 'rank', 'lat', 'lon')})
    out = {'format': 'bikefree-city-map-1', 'attribution': 'Map data © OpenStreetMap contributors (ODbL)',
           'box': [round(v, 5) for v in box], 'water': water, 'labels': cfg.get('labels', []), 'areaLabels': cfg.get('areaLabels', {}),
           'landmarks': lms}
    path = os.path.join(ROOT, 'routes', 'cities', f'{city}-map.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(f'{city}: wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1e3:.1f} kB): '
          + ', '.join(f'{w["name"]} {len(w["rings"])} rings / {sum(len(r) for r in w["rings"])} points' for w in water)
          + f'; {len(lms)} landmarks')


if __name__ == '__main__':
    for c in sys.argv[1:] or ['pittsburgh']: build(c)
