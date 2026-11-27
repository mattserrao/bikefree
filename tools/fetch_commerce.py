#!/usr/bin/env python3
"""Roadside businesses for the graph maps (business pass, user 26 Nov: gas stations, fast food, strip malls).

  python3 tools/fetch_commerce.py pgh            # one map
  python3 tools/fetch_commerce.py all            # every graph map

Reads   routes/cities/<id>.json (the graph: its edges' polylines decide which tiles are fetched)
Writes  tools/.cache/osm-commerce-<id>/t_<lat>_<lon>.osm   raw OSM API tiles (cached; delete to refresh)
        routes/cities/<id>-commerce.json                   {format, attribution, places: [{kind, lat, lon, name, ring?}]}
          kind  fuel        a filling station (amenity=fuel): its canopy's footprint when mapped (building=roof)
                fast_food   amenity=fast_food (or a restaurant whose cuisine is burger/pizza/chicken/sandwich)
                strip       shop=* clusters: a retail building with three or more shops mapped in it (a strip mall)
Source  the OSM API map call, 0.02° tiles along the map's roads, one at a time with a pause (as build_city.py).
        Data © OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'bikefree-route-builder/0.13 (personal project)'}
TILE = 0.02
MAPS = ['pgh', 'nyc', 'cny', 'skan', 'outwest']
QUICK = {'burger', 'pizza', 'chicken', 'sandwich', 'hot_dog', 'fried_chicken', 'donut', 'ice_cream', 'mexican'}


def unpack(s, scale=1e-6):
    a = json.loads(s) if isinstance(s, str) else s
    out, v = [], 0
    for i, d in enumerate(a):
        v = d if i == 0 else v + d
        out.append(v * scale)
    return out


def tiles_for(graph):
    t = set()
    for e in graph['edges']:
        la, lo = unpack(e['lat']), unpack(e['lon'])
        for y, x in zip(la, lo):
            t.add((math.floor(y / TILE), math.floor(x / TILE)))
    return sorted(t)


def fetch_box(d, s, w, size):
    """One tile's file(s): a tile over the API's node limit (HTTP 400) is split in four, down to 0.005°."""
    f = os.path.join(d, f't_{s:.4f}_{w:.4f}_{size:.4f}.osm')
    if os.path.exists(f): return [f]
    url = f'https://api.openstreetmap.org/api/0.6/map?bbox={w:.4f},{s:.4f},{w + size:.4f},{s + size:.4f}'
    for attempt in range(3):
        time.sleep(0.6)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r: data = r.read()
            open(f, 'wb').write(data); return [f]
        except urllib.error.HTTPError as err:
            if err.code == 400 and size > .006:
                h = size / 2
                return [x for (a, b) in ((s, w), (s + h, w), (s, w + h), (s + h, w + h)) for x in fetch_box(d, a, b, h)]
            if attempt == 2: print('  skip', url, err); return []
        except Exception as err:
            if attempt == 2: print('  skip', url, err); return []
            time.sleep(3)
    return []


def fetch(mid, ty, tx):
    d = os.path.join(ROOT, 'tools', '.cache', f'osm-commerce-{mid}')
    os.makedirs(d, exist_ok=True)
    old = os.path.join(d, f't_{ty * TILE:.4f}_{tx * TILE:.4f}.osm')
    if os.path.exists(old): return [old]
    return fetch_box(d, ty * TILE, tx * TILE, TILE)


def parse(files):
    nodes, places, shops, bldgs, allb = {}, [], [], [], []
    for f in files:
        try: root = ET.parse(f).getroot()
        except ET.ParseError: continue
        for n in root.iter('node'):
            nodes[n.get('id')] = (float(n.get('lat')), float(n.get('lon')))
        for el in list(root.iter('node')) + list(root.iter('way')):
            tags = {t.get('k'): t.get('v') for t in el.iter('tag')}
            if not tags: continue
            if el.tag == 'node': pts = [nodes[el.get('id')]]
            else: pts = [nodes[r.get('ref')] for r in el.iter('nd') if r.get('ref') in nodes]
            if not pts: continue
            lat, lon = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            a, cuisine = tags.get('amenity'), set((tags.get('cuisine') or '').split(';'))
            name = tags.get('name') or tags.get('brand') or ''
            ring = [[round(p[0], 6), round(p[1], 6)] for p in pts] if el.tag == 'way' and len(pts) > 3 else None
            if a == 'fuel': places.append({'kind': 'fuel', 'lat': round(lat, 6), 'lon': round(lon, 6), 'name': name, **({'ring': ring} if ring else {})})
            elif a == 'fast_food' or (a == 'restaurant' and cuisine & QUICK):
                places.append({'kind': 'fast_food', 'lat': round(lat, 6), 'lon': round(lon, 6), 'name': name, 'cuisine': sorted(cuisine - {''})[:2], **({'ring': ring} if ring else {})})
            elif tags.get('shop') and el.tag == 'node': shops.append((lat, lon))
            if el.tag == 'way' and tags.get('building') and ring:
                allb.append(ring)
                if tags.get('building') in ('retail', 'commercial'): bldgs.append(ring)
    # a fast-food place mapped as a point inside a building: that building's footprint (its roof gets the chain's look)
    for p in places:
        if p['kind'] == 'fast_food' and 'ring' not in p:
            for ring in allb:
                if inside(ring, p['lat'], p['lon']) and len(ring) < 40: p['ring'] = ring; break
    # strip malls: a single-storey-ish retail building with three or more shops mapped inside it
    for ring in bldgs:
        n = sum(1 for (y, x) in shops if inside(ring, y, x))
        if n >= 3:
            places.append({'kind': 'strip', 'lat': round(sum(p[0] for p in ring) / len(ring), 6), 'lon': round(sum(p[1] for p in ring) / len(ring), 6), 'name': '', 'shops': n, 'ring': ring})
    # one entry per place (the same station mapped as a node and its canopy)
    out = []
    for p in places:
        if any(q['kind'] == p['kind'] and abs(q['lat'] - p['lat']) < 3e-4 and abs(q['lon'] - p['lon']) < 4e-4 for q in out):
            if p.get('ring'):
                for q in out:
                    if q['kind'] == p['kind'] and abs(q['lat'] - p['lat']) < 3e-4: q.setdefault('ring', p['ring'])
            continue
        out.append(p)
    return out


def inside(ring, y, x):
    c = False
    for i in range(len(ring)):
        a, b = ring[i], ring[i - 1]
        if (a[0] > y) != (b[0] > y) and x < (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0] + 1e-12) + a[1]: c = not c
    return c


def main(mid):
    graph = json.load(open(os.path.join(ROOT, 'routes', 'cities', f'{mid}.json')))
    tl = tiles_for(graph)
    print(f'{mid}: {len(tl)} tiles')
    files = [f for ty, tx in tl for f in fetch(mid, ty, tx)]
    places = parse(files)
    out = {'format': 'bikefree-commerce-1', 'attribution': 'Map data © OpenStreetMap contributors (ODbL)', 'places': places}
    json.dump(out, open(os.path.join(ROOT, 'routes', 'cities', f'{mid}-commerce.json'), 'w'), separators=(',', ':'))
    kinds = {}
    for p in places: kinds[p['kind']] = kinds.get(p['kind'], 0) + 1
    print(f'  {kinds}')


if __name__ == '__main__':
    for m in (MAPS if sys.argv[1:] == ['all'] else sys.argv[1:]): main(m)
