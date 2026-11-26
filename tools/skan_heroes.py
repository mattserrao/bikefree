#!/usr/bin/env python3
"""SKAN's villages (user, 22 Nov: "rework Skaneateles and Marcellus villages by adding landmarks and more real-world
copies … Skaneateles has sidewalks, a long pier etc. Add accuracy. Also for Skaneateles: examples of the mansions, the
golf course and other landmarks"). From OSM (tools/.cache/osm-skan, fetched by bbox from the OSM API) →

  routes/cities/skan-heroes.json     js/world/graph-heroes.js:
    heroes      the churches, by the city's church builder (white clapboard, brick or stone; a front tower and spire)
    buildings   their footprints (the city data's boxes for them hidden)
    landmarks   SKAN's own models (js/world/toolbox/city/skan-landmarks.js): Clift Park's pier and gazebo, the Sherwood
                Inn, lakefront mansions (examples, by type), the country club's clubhouse and docks, the golf course's pin
                flags, the old Crown Mill at Marcellus Falls; Skaneateles Creek and Nine Mile Creek as water ribbons
    shops       the village cores' commercial buildings on their OSM outlines (graph-city: storefront rows)
    styles      historic houses the house engine builds as their real type (Hiram Reed House: Italianate …)
    villages    the village extents (graph-world: sidewalks on every street inside)
  routes/cities/skan-dressing.json   graph-world's dressed ground: the golf course (rough, fairways, greens, tees,
                bunkers), the parks' lawns and paths

    python3 tools/skan_heroes.py
Data © OpenStreetMap contributors (ODbL).
"""
import glob, json, math, os, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KX, KZ = 111320 * math.cos(math.radians(42.96)), 110540

LOOKS = {
    'clapboard': {'wall': '#efece4', 'roof': '#4f5458', 'top': '#efece4', 'eaves': 7, 'ridge': 12, 'towers': 'front', 'towerS': 4.4, 'towerM': 17, 'crown': 'spire', 'crownM': 11},
    'brick': {'wall': '#8f5a45', 'roof': '#4a4644', 'top': '#55504c', 'eaves': 7.5, 'ridge': 13, 'towers': 'front', 'towerS': 4.8, 'towerM': 16, 'crown': 'spire', 'crownM': 9},
    'stone': {'wall': '#8e887c', 'roof': '#3f4347', 'top': '#7f796e', 'eaves': 7, 'ridge': 13, 'towers': 'front', 'towerS': 5, 'towerM': 15, 'crown': 'spire', 'crownM': 10},
}
# churches by their OSM point (the footprint round it is found): (label, lat, lon, look)
CHURCHES = [
    ("St. James' Episcopal Church", 42.9449, -76.4253, 'stone'),
    ('First Presbyterian Church of Skaneateles', 42.9455, -76.4244, 'brick'),
    ("St. Andrew's United Methodist Church", 42.94694, -76.42889, 'brick'),
    ('First Baptist Church', 42.94722, -76.42778, 'brick'),
    ("St. Mary's of the Lake", 42.9509, -76.4312, 'brick'),
    ('Holy Trinity Lutheran Church', 42.9446, -76.4330, 'clapboard'),
    ('First Presbyterian Church of Marcellus', 42.9828, -76.33983, 'clapboard'),   # (1851, Greek Revival, the steeple)
    ("St. Francis Xavier's Church", 42.98201, -76.34083, 'brick'),
    ("St. John's Episcopal Church", 42.9845, -76.3374, 'stone'),
    ('Marcellus United Methodist Church', 42.98223, -76.34203, 'brick'),
]
# the village cores (commercial streets) and extents
CORES = [
    {'name': 'Skaneateles', 'box': (42.9452, 42.9487, -76.4320, -76.4266), 'streets': ('Genesee Street', 'Jordan Street', 'Fennell Street'), 'h': 9.5},
    {'name': 'Marcellus', 'box': (42.9817, 42.9841, -76.3422, -76.3368), 'streets': ('Main Street', 'North Street'), 'h': 8.5},
]
VILLAGES = [{'name': 'Skaneateles', 'center': [42.9482, -76.4290], 'r': 1200}, {'name': 'Marcellus', 'center': [42.9830, -76.3395], 'r': 780}]
# historic houses the house engine builds as their real type: (OSM way, type, note)
STYLES = [
    ('585017266', 'italianate', 'Hiram Reed House, 31 North Street, Marcellus (1853)'),
    ('585017269', 'greek', 'Steadman House, 18 North Street, Marcellus (museum)'),
    ('585010241', 'ihouse', 'Dan Bradley House, 59 South Street, Marcellus (NRHP)'),
    ('584323858', 'italianate', 'Morning Star Lodge (Edward Talbot House), 46 East Main Street, Marcellus: brick, altered Italianate', 'brick'),
]
# lakefront mansions (examples, by the kinds Skaneateles has: Queen Anne with a tower, Shingle style on boulders,
# Classical Revival with a portico, a Second Empire villa) on the large lakeside footprints along East Genesee Street
# and West Lake Street
MANSIONS = [
    ('1064583338', 'shingle'), ('1064583051', 'classical'), ('1064582693', 'queenanne'), ('1064583111', 'secondempire'),
    ('1064583492', 'queenanne'), ('1064582276', 'classical'), ('1064581282', 'shingle'), ('1064583503', 'secondempire'),
    ('1064582783', 'queenanne'),
]


def main():
    nodes, ways = {}, {}
    for f in glob.glob(os.path.join(ROOT, 'tools/.cache/osm-skan/*.osm')):
        for ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == 'node': nodes[el.get('id')] = (float(el.get('lat')), float(el.get('lon'))); el.clear()
            elif el.tag == 'way':
                ways[el.get('id')] = ([x.get('ref') for x in el.iter('nd')], {x.get('k'): x.get('v') for x in el.iter('tag')}); el.clear()
    pts = lambda wid: [[round(nodes[r][0], 7), round(nodes[r][1], 7)] for r in ways[wid][0] if r in nodes]
    ring = lambda wid: (lambda P: P[:-1] if len(P) > 2 and P[0] == P[-1] else P)(pts(wid))
    centre = lambda R: [round(sum(p[0] for p in R) / len(R), 7), round(sum(p[1] for p in R) / len(R), 7)]
    xy = lambda la, lo: ((lo + 76.4) * KX, -(la - 42.95) * KZ)
    def area(R):
        P = [xy(*p) for p in R]; return abs(sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))) / 2
    def inside(R, la, lo):
        c = False
        for i in range(len(R)):
            (y0, x0), (y1, x1) = R[i], R[i - 1]
            if (y0 > la) != (y1 > la) and lo < (x1 - x0) * (la - y0) / (y1 - y0) + x0: c = not c
        return c
    def frame(R):
        P = [xy(*p) for p in R]; best = None
        for i in range(len(P)):
            (x0, z0), (x1, z1) = P[i], P[(i + 1) % len(P)]; L = math.hypot(x1 - x0, z1 - z0)
            if L < .5: continue
            ux, uz = (x1 - x0) / L, (z1 - z0) / L
            a = [x * ux + z * uz for x, z in P]; b = [-x * uz + z * ux for x, z in P]
            ar = (max(a) - min(a)) * (max(b) - min(b))
            if not best or ar < best[0]: best = (ar, ux, uz, max(a) - min(a), max(b) - min(b))
        _, ux, uz, la_, lb_ = best
        if lb_ > la_: ux, uz, la_, lb_ = -uz, ux, lb_, la_
        return la_, lb_, math.degrees(math.atan2(ux, -uz)) % 360
    buildings = {wid: ring(wid) for wid, (nd, t) in ways.items() if t.get('building') and len(nd) >= 4}
    out = {'format': 'bikefree-heroes-1', 'note': "tools/skan_heroes.py: Skaneateles and Marcellus — landmarks on their OSM outlines (js/world/graph-heroes.js, js/world/toolbox/city/skan-landmarks.js)",
           'heroes': [], 'buildings': [], 'landmarks': [], 'stadiums': [], 'inclines': [], 'overlooks': [], 'stations': [],
           'shops': [], 'styles': [], 'villages': VILLAGES}

    # churches: the footprint the point stands in (else the nearest big one within 30 m)
    for label, la, lo, look in CHURCHES:
        wid = next((w for w, R in buildings.items() if len(R) >= 3 and inside(R, la, lo)), None)
        if not wid:
            near = sorted(((math.dist(xy(la, lo), xy(*centre(R))), w) for w, R in buildings.items() if area(R) > 150), key=lambda q: q[0])
            wid = near[0][1] if near and near[0][0] < 30 else None
        if not wid: print('  (no footprint for', label, ')'); continue
        R = buildings[wid]; L, W, ax = frame(R); c = centre(R); st = LOOKS[look]
        out['heroes'].append({'model': 'church', 'name': label, 'look': 'holyname', 'style': {**st, 'apse': False, 'lancets': look == 'stone'},
                              'lat': c[0], 'lon': c[1], 'lengthM': round(L, 1), 'widthM': round(W, 1), 'axisDeg': round(ax, 1)})
        out['buildings'].append({'ring': R, 'h': st['ridge'], 'mh': 0, 'kind': 7, 'name': label})

    # Clift Park: the pier (its shore end first) and the gazebo on the lawn beside its root
    pier = pts('192179566')
    lake = ring('27181601')
    if pier[0][0] < pier[-1][0]: pier = pier[::-1]   # (the lake is south of the village: the shore end is the northern one)
    root = pier[0]
    out['landmarks'].append({'label': 'Clift Park pier', 'model': 'pier', 'path': pier, 'widthM': 3.6, 'note': 'the long pier into Skaneateles Lake from Clift Park, across Genesee Street from the Sherwood Inn'})
    # (the gazebo: on the park lawn west of the pier's root, between the water and Genesee Street)
    gaz = [root[0] + 15 / KZ, root[1] - 24 / KX]
    out['landmarks'].append({'label': 'Clift Park gazebo', 'model': 'gazebo', 'center': [round(gaz[0], 7), round(gaz[1], 7)]})
    # the Sherwood Inn (1807): its OSM outline
    R = ring('132232736')
    out['landmarks'].append({'label': 'Sherwood Inn', 'model': 'sherwood', 'ring': R, 'center': centre(R), 'face': root, 'note': '1807 stagecoach tavern, blue clapboard, a long two-storey porch facing the lake'})
    # lakefront mansions (examples)
    for wid, kind in MANSIONS:
        if wid not in buildings: continue
        R = buildings[wid]
        out['landmarks'].append({'label': f'Lakefront mansion ({kind})', 'model': 'mansion', 'kind': kind, 'ring': R, 'center': centre(R)})
    # the country club: the clubhouse, its docks, the course's pins
    R = ring('1064578187')
    out['landmarks'].append({'label': 'Skaneateles Country Club', 'model': 'clubhouse', 'ring': R, 'center': centre(R), 'note': 'founded 1915; the clubhouse on the lake, West Lake Street'})
    for wid in ('330586383', '330586384', '1121706079'):
        if wid in ways: out['landmarks'].append({'label': 'Country club dock', 'model': 'dock', 'ring': ring(wid), 'center': centre(ring(wid))})
    pins = []
    for wid, (nd, t) in ways.items():
        if t.get('golf') == 'hole':
            P = pts(wid)
            if len(P) >= 2: pins.append(P[-1])
    out['landmarks'].append({'label': 'Golf pins', 'model': 'golfpins', 'pts': pins})
    # the old Crown Mill at Marcellus Falls (Nine Mile Creek's mills)
    R = ring('1064586797')
    out['landmarks'].append({'label': 'Crown Mill, Marcellus Falls', 'model': 'mill', 'ring': R, 'center': centre(R), 'note': 'the old woollen mill on Nine Mile Creek'})
    # the creeks through the villages: Skaneateles Creek (the lake's outlet) and Nine Mile Creek
    for wid, (nd, t) in ways.items():
        if t.get('waterway') in ('stream', 'river') and t.get('name') in ('Skaneateles Creek', 'Nine Mile Creek'):
            P = pts(wid)
            if len(P) >= 2: out['landmarks'].append({'label': t['name'], 'model': 'canal', 'path': P, 'widthM': 7 if t['name'] == 'Skaneateles Creek' else 6, 'creek': 1})

    # the cores' commercial buildings: storefront rows on their outlines
    streets = {}
    for wid, (nd, t) in ways.items():
        if t.get('highway') and t.get('name'): streets.setdefault(t['name'], []).append(pts(wid))
    def near_street(la, lo, names, r):
        p = xy(la, lo)
        for nm, lines in streets.items():
            if not any(nm.endswith(s) or nm == s for s in names): continue
            for L in lines:
                for i in range(len(L) - 1):
                    a, b = xy(*L[i]), xy(*L[i + 1]); dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz or 1
                    t_ = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
                    if math.hypot(a[0] + dx * t_ - p[0], a[1] + dz * t_ - p[1]) < r: return True
        return False
    church_rings = [b['ring'] for b in out['buildings']]
    for core in CORES:
        s, n_, w, e = core['box']
        for wid, R in buildings.items():
            t = ways[wid][1]; c = centre(R)
            if not (s < c[0] < n_ and w < c[1] < e): continue
            if t.get('building') in ('house', 'residential', 'detached', 'garage', 'garages', 'shed', 'church', 'apartments', 'roof'): continue
            A = area(R)
            if A < 80 or A > 1700 or R in church_rings: continue
            if not near_street(c[0], c[1], core['streets'], 34): continue
            lv = t.get('building:levels')
            h = float(lv) * 3.7 + 1.2 if lv and lv.replace('.', '').isdigit() else core['h']
            out['shops'].append({'ring': R, 'h': round(h, 1), 'name': t.get('name', ''), 'village': core['name']})
    for s_ in STYLES:
        wid, typ, note = s_[:3]
        if wid in buildings: out['styles'].append({'center': centre(buildings[wid]), 'type': typ, 'note': note, **({'wall': s_[3]} if len(s_) > 3 else {})})

    # the dressed ground: the golf course and the parks
    areas, lines = [], []
    KIND = {'fairway': 'fairway', 'green': 'green', 'tee': 'green', 'bunker': 'sand', 'driving_range': 'fairway'}
    for wid, (nd, t) in ways.items():
        R = ring(wid)
        if len(R) < 3: continue
        if t.get('leisure') == 'golf_course': areas.append({'kind': 'lawn', 'name': t.get('name', ''), 'pts': R})
        elif t.get('golf') in KIND: areas.append({'kind': KIND[t['golf']], 'pts': R})
        elif t.get('leisure') == 'park' and t.get('name'): areas.append({'kind': 'park', 'name': t['name'], 'pts': R})
    for wid, (nd, t) in ways.items():
        if t.get('highway') in ('footway', 'path') and not t.get('footway') == 'sidewalk':
            P = pts(wid)
            c = P[len(P) // 2] if P else None
            if c and any(inside(a['pts'], *c) for a in areas if a['kind'] == 'park'): lines.append({'kind': 'walk', 'width': 2, 'pts': P})
    # view corridors the QC fixer added (tools/qc_fix.mjs viewBlocked, verified by a re-run, 25 Nov): kept on a rebuild
    QC_VIEWS = {'Crown Mill, Marcellus Falls': [[43.00488, -76.33812]]}
    for l in out['landmarks']:
        for v in QC_VIEWS.get(l['label'], []):
            if v not in l.get('views', []): l.setdefault('views', []).append(v)
    json.dump(out, open(os.path.join(ROOT, 'routes/cities/skan-heroes.json'), 'w'), separators=(',', ':'))
    json.dump({'format': 'bikefree-dressing-1', 'areas': areas, 'lines': lines, 'trees': []}, open(os.path.join(ROOT, 'routes/cities/skan-dressing.json'), 'w'), separators=(',', ':'))
    print(f"  skan-heroes.json: {len(out['heroes'])} churches, {len(out['landmarks'])} landmarks, {len(out['shops'])} shops, {len(out['styles'])} styled houses")
    print(f"  skan-dressing.json: {len(areas)} areas ({sum(a['kind'] != 'park' and a['kind'] != 'lawn' for a in areas)} golf), {len(lines)} paths")


if __name__ == '__main__':
    main()
