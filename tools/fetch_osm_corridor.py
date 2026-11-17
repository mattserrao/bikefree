#!/usr/bin/env python3
"""Fetch OpenStreetMap features along a route corridor, for the real-place toolbox kits.

  python3 tools/fetch_osm_corridor.py alpedhuez              # corridor from scene "osm.corridorM" (default 1500 m)
  python3 tools/fetch_osm_corridor.py alpedhuez --census     # also print counts per 10 km

Reads   routes/parks/<id>.gpx, routes/scenes/<id>.json ("osm": { corridorM, tileDeg })
Writes  tools/.cache/osm-<id>/t_<lat>_<lon>.osm   raw OSM API tiles (cached; delete to refresh)
        tools/.cache/osm-<id>/features.json      the parsed features every builder reads:
          buildings  [{ id, ring: [[lat, lon], …], tags }]
          areas      landuse / natural / leisure / amenity polygons [{ ring, tags }]  (multipolygon outers too)
          lines      waterways, power lines, aerialways, highways with tunnel/bridge, barriers [{ pts, tags }]
          points     places, worship, peaks, viewpoints, benches, fountains, crosses, signs [{ lat, lon, tags }]
        docs/<id>/osm-census.md                   counts per 10 km of route (with --census)

Source  the OSM API map call (api.openstreetmap.org/api/0.6/map), one tile at a time with a pause, like
        build_city.py. Tiles that hit the 50,000-node limit are split in four. Only tiles that touch the
        corridor are fetched. Data © OpenStreetMap contributors, ODbL.
"""
import json, math, os, re, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'bikefree-route-builder/0.13 (personal project)'}

KEEP_POINT = re.compile(r'^(place|amenity|natural|tourism|historic|man_made|highway|leisure|aerialway|railway)$')


def http_get(url, pause=0.6):
    time.sleep(pause)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()


def hv(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def route_points(rid):
    t = open(os.path.join(ROOT, 'routes', 'parks', f'{rid}.gpx')).read()
    return [(float(a), float(b)) for a, b in re.findall(r'<trkpt lat="([^"]+)" lon="([^"]+)"', t)]


def tiles_for(pts, corridor, deg):
    """OSM tiles (deg × deg·1.4) that touch the corridor around the route."""
    lat0 = sum(p[0] for p in pts) / len(pts)
    dlat, dlon = corridor / 111320, corridor / (111320 * math.cos(math.radians(lat0)))
    tw, th = deg * 1.4, deg
    need = set()
    for la, lo in pts[::5]:
        for y in range(math.floor((la - dlat) / th), math.floor((la + dlat) / th) + 1):
            for x in range(math.floor((lo - dlon) / tw), math.floor((lo + dlon) / tw) + 1):
                need.add((y, x))
    return sorted(need), th, tw


def fetch_box(folder, s, w, n, e, depth=0):
    name = f't_{s:.4f}_{w:.4f}_{depth}.osm'
    path = os.path.join(folder, name)
    if os.path.exists(path) and os.path.getsize(path) > 200:
        return [path]
    try:
        data = http_get(f'https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}')
    except urllib.error.HTTPError as err:
        if err.code in (400, 509) and depth < 4:      # too many nodes: split in four
            ms, mw = (s + n) / 2, (w + e) / 2
            out = []
            for a, b, c, d in ((s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)):
                out += fetch_box(folder, a, b, c, d, depth + 1)
            return out
        raise
    open(path, 'wb').write(data)
    return [path]


def parse(files, pts, corridor):
    nodes, ntags, ways, rels = {}, {}, {}, []
    for f in files:
        root = ET.parse(f).getroot()
        for nd in root.iter('node'):
            i = nd.get('id')
            nodes[i] = (float(nd.get('lat')), float(nd.get('lon')))
            t = {x.get('k'): x.get('v') for x in nd.iter('tag')}
            if t:
                ntags[i] = t
        for wy in root.iter('way'):
            ways[wy.get('id')] = ([x.get('ref') for x in wy.iter('nd')], {x.get('k'): x.get('v') for x in wy.iter('tag')})
        for r in root.iter('relation'):
            t = {x.get('k'): x.get('v') for x in r.iter('tag')}
            if t.get('type') == 'multipolygon':
                rels.append(([m.get('ref') for m in r.iter('member') if m.get('type') == 'way' and m.get('role') in ('outer', '')], t))
    ring = lambda refs: [[round(nodes[r][0], 6), round(nodes[r][1], 6)] for r in refs if r in nodes]
    out = {'buildings': [], 'areas': [], 'lines': [], 'points': []}
    seen_rel_ways = set()
    for refs, t in rels:
        if 'building' in t:
            continue
        if any(k in t for k in ('landuse', 'natural', 'leisure', 'water')):
            for wid in refs:
                if wid in ways:
                    seen_rel_ways.add(wid)
                    r = ring(ways[wid][0])
                    if len(r) >= 4:
                        out['areas'].append({'ring': r, 'tags': {k: v for k, v in t.items() if k in ('landuse', 'natural', 'leisure', 'water', 'wood', 'leaf_type', 'name')}})
    for wid, (refs, t) in ways.items():
        if not t:
            continue
        if 'building' in t:
            r = ring(refs)
            if len(r) >= 4:
                out['buildings'].append({'id': int(wid), 'ring': r, 'tags': {k: v for k, v in t.items() if k in (
                    'building', 'building:levels', 'height', 'roof:shape', 'roof:material', 'roof:colour', 'building:material',
                    'amenity', 'name', 'religion', 'tourism', 'shop')}})
        elif any(k in t for k in ('landuse', 'natural', 'leisure')) or t.get('amenity') == 'parking':
            r = ring(refs)
            if len(r) >= 4 and r[0] == r[-1]:
                out['areas'].append({'ring': r, 'tags': {k: v for k, v in t.items() if k in ('landuse', 'natural', 'leisure', 'amenity', 'wood', 'leaf_type', 'name', 'water')}})
        if any(k in t for k in ('waterway', 'power', 'aerialway', 'barrier')) or ('highway' in t and (t.get('tunnel') or t.get('bridge'))) \
                or t.get('man_made') in ('dam', 'embankment') or t.get('natural') in ('cliff', 'tree_row') or t.get('waterway') == 'dam':
            p = ring(refs)
            if len(p) >= 2:
                out['lines'].append({'pts': p, 'tags': {k: v for k, v in t.items() if k in (
                    'waterway', 'power', 'aerialway', 'barrier', 'highway', 'tunnel', 'bridge', 'name', 'ref', 'man_made', 'natural', 'layer', 'width')}})
    for i, t in ntags.items():
        if any(KEEP_POINT.match(k) for k in t):
            la, lo = nodes[i]
            out['points'].append({'lat': la, 'lon': lo, 'tags': {k: v for k, v in t.items() if k in (
                'place', 'name', 'amenity', 'religion', 'natural', 'ele', 'tourism', 'historic', 'man_made', 'highway', 'leisure', 'aerialway', 'railway', 'population')}})
    # dedupe across tiles (ways come whole in every tile they touch)
    for key in ('buildings',):
        seen, keep = set(), []
        for b in out[key]:
            if b['id'] not in seen:
                seen.add(b['id']); keep.append(b)
        out[key] = keep
    for key in ('areas', 'lines'):
        seen, keep = set(), []
        for a in out[key]:
            pts_ = a['ring'] if 'ring' in a else a['pts']
            sig = (len(pts_), tuple(pts_[0]), tuple(pts_[len(pts_) // 2]))
            if sig not in seen:
                seen.add(sig); keep.append(a)
        out[key] = keep
    seen, keep = set(), []
    for p in out['points']:
        sig = (p['lat'], p['lon'])
        if sig not in seen:
            seen.add(sig); keep.append(p)
    out['points'] = keep
    return out


class RouteIndex:
    """Nearest route distance (m along, m off) for lat/lon, on a 200 m grid."""
    def __init__(self, pts):
        self.pts = pts
        self.lat0 = pts[0][0]
        self.kx = 111320 * math.cos(math.radians(self.lat0))
        self.ky = 110540
        self.cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.cum.append(self.cum[-1] + hv(a, b))
        self.grid = {}
        for i, (la, lo) in enumerate(pts):
            self.grid.setdefault((int(la * self.ky // 200), int(lo * self.kx // 200)), []).append(i)

    def near(self, la, lo, reach=1):
        cy, cx = int(la * self.ky // 200), int(lo * self.kx // 200)
        best = (1e18, -1)
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                for i in self.grid.get((cy + dy, cx + dx), ()):
                    p = self.pts[i]
                    d = ((p[0] - la) * self.ky) ** 2 + ((p[1] - lo) * self.kx) ** 2
                    if d < best[0]:
                        best = (d, i)
        if best[1] < 0:
            return None, None
        return self.cum[best[1]], math.sqrt(best[0])


def census(rid, feat, pts):
    idx = RouteIndex(pts)
    total = idx.cum[-1]
    bins = [{'b': 0, 'places': [], 'worship': 0, 'lifts': 0, 'tunnels': [], 'forest': 0} for _ in range(int(total // 10000) + 1)]
    for b in feat['buildings']:
        la = sum(p[0] for p in b['ring']) / len(b['ring']); lo = sum(p[1] for p in b['ring']) / len(b['ring'])
        s, d = idx.near(la, lo, 2)
        if s is not None and d < 250:
            bins[int(s // 10000)]['b'] += 1
    for p in feat['points']:
        s, d = idx.near(p['lat'], p['lon'], 7)
        if s is None:
            continue
        t = p['tags']
        if t.get('place') in ('town', 'village', 'hamlet', 'suburb') and d < 1200 and t.get('name'):
            bins[int(s // 10000)]['places'].append(t['name'])
        if t.get('amenity') == 'place_of_worship' and d < 400:
            bins[int(s // 10000)]['worship'] += 1
    for l in feat['lines']:
        t = l['tags']
        mid = l['pts'][len(l['pts']) // 2]
        s, d = idx.near(mid[0], mid[1], 12)
        if s is None:
            continue
        if 'aerialway' in t and d < 2500:
            bins[int(s // 10000)]['lifts'] += 1
        if t.get('tunnel') and 'highway' in t and d < 25:
            bins[int(s // 10000)]['tunnels'].append(t.get('name') or t.get('ref') or 'tunnel')
    rows = ['| km | Buildings ≤250 m | Places ≤1.2 km | Worship | Lifts ≤2.5 km | Tunnels on the road |', '| --- | --- | --- | --- | --- | --- |']
    for k, b in enumerate(bins):
        rows.append(f"| {k * 10}–{min(total / 1000, k * 10 + 10):.0f} | {b['b']} | {', '.join(sorted(set(b['places']))) or '–'} | {b['worship']} | {b['lifts']} | {', '.join(sorted(set(b['tunnels']))) or '–'} |")
    os.makedirs(os.path.join(ROOT, 'docs', rid), exist_ok=True)
    with open(os.path.join(ROOT, 'docs', rid, 'osm-census.md'), 'w') as f:
        f.write(f'# {rid} — OpenStreetMap census\n\nFrom `python3 tools/fetch_osm_corridor.py {rid} --census`. Data © OpenStreetMap contributors (ODbL).\n\n'
                f"{len(feat['buildings'])} buildings, {len(feat['areas'])} areas, {len(feat['lines'])} lines, {len(feat['points'])} points in the corridor.\n\n" + '\n'.join(rows) + '\n')
    print('\n'.join(rows))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__)
        sys.exit(1)
    rid = args[0]
    scene = json.load(open(os.path.join(ROOT, 'routes', 'scenes', f'{rid}.json')))
    cfg = {'corridorM': 1500, 'tileDeg': 0.02, **scene.get('osm', {})}
    pts = route_points(rid)
    folder = os.path.join(ROOT, 'tools', '.cache', f'osm-{rid}')
    os.makedirs(folder, exist_ok=True)
    need, th, tw = tiles_for(pts, cfg['corridorM'], cfg['tileDeg'])
    print(f'{rid}: {len(need)} OSM tiles for a {cfg["corridorM"]} m corridor')
    files = []
    for k, (y, x) in enumerate(need):
        s, w = y * th, x * tw
        files += fetch_box(folder, round(s, 4), round(w, 4), round(s + th, 4), round(w + tw, 4))
        if k % 20 == 0:
            print(f'  {k + 1}/{len(need)}')
    feat = parse(files, pts, cfg['corridorM'])
    json.dump(feat, open(os.path.join(folder, 'features.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    print(f"{len(feat['buildings'])} buildings, {len(feat['areas'])} areas, {len(feat['lines'])} lines, {len(feat['points'])} points → {folder}/features.json")
    if '--census' in sys.argv:
        census(rid, feat, pts)


if __name__ == '__main__':
    main()
