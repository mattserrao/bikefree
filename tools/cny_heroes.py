#!/usr/bin/env python3
"""CNY's landmarks (user, 22 Nov: "Generate a list of landmarks in CNY. Then, work through improving these"): each on
its OSM outline (tools/.cache/osm-cny) → routes/cities/cny-heroes.json, which js/world/graph-heroes.js builds:

  heroes      the churches, by the city's church builder (js/world/toolbox/city/landmark-heroes.js): a white clapboard
              meeting house or a brick church, a front tower and spire, sized and turned from the footprint
  buildings   their footprints (claimed by the builder: the city data's box for them is hidden)
  landmarks   CNY's own models (js/world/toolbox/city/cny-landmarks.js): the Nine Mile Creek Aqueduct, Sims' Store and
              its steam-engine house, the Wilcox Octagon House, the canal boat at the park's dock, the Finger Lakes
              Railway bridge over Genesee Street, the Maxwell Memorial Library, the Warners firehouse

    python3 tools/cny_heroes.py
Data © OpenStreetMap contributors (ODbL).
"""
import glob, json, math, os, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KX = 111320 * math.cos(math.radians(43.06))

# (label, model, OSM way id of the outline or None, extras) — the way ids found by position (tools/cny_heroes.py notes)
LANDMARKS = [
    ('Nine Mile Creek Aqueduct', 'aqueduct', 'w1312426544', {'canal': 'w146999165', 'note': '1841, NRHP: four 30 ft Roman arches of stone, 144 ft, a timber trunk carrying the canal again since 2009, the 12 ft towpath on its side'}),
    ("Sims' Store Museum", 'canalstore', 'w1060870045', {'face': [43.05248, -76.30335], 'note': 'a replica (1977) of an 1850s canal store, at the Erie Canal Park on Devoe Road'}),
    ('Steam engine house', 'enginehouse', 'w1060859265', {'note': 'the park\'s steam engine exhibit, beside the store'}),
    ('Wilcox Octagon House', 'octagon', 'w1060868478', {'note': '1856, NRHP: an octagon house of Orson Fowler\'s kind, with a cupola'}),
    ('Canal boat', 'canalboat', None, {'at': [43.05248, -76.30335], 'note': 'the tour boat at the Camillus Erie Canal Park dock'}),
    ('Finger Lakes Railway bridge', 'railbridge', None, {'rail': 'w52869851', 'note': 'the Auburn Secondary over Genesee Street in the village'}),
    ('Maxwell Memorial Library', 'library', 'w1061140314', {}),
    ('Warners Volunteer Fire Department', 'firehouse', 'w1060864163', {}),
]
# churches: (label, OSM outline, look) — CNY's are a white clapboard meeting house with a steeple, or brick
CHURCHES = [
    ('Camillus First Baptist Church', 'w1061140492', 'clapboard'),
    ('Warners United Methodist Church', 'w1060843112', 'clapboard'),
    ('Our Lady of Good Counsel Church', 'w1060866183', 'brick'),
]
LOOKS = {
    'clapboard': {'wall': '#efece4', 'roof': '#4f5458', 'top': '#efece4', 'eaves': 7, 'ridge': 12, 'towers': 'front', 'towerS': 4.4, 'towerM': 17, 'crown': 'spire', 'crownM': 11},
    'brick': {'wall': '#8f5a45', 'roof': '#4a4644', 'top': '#55504c', 'eaves': 7.5, 'ridge': 13, 'towers': 'front', 'towerS': 4.8, 'towerM': 16, 'crown': 'spire', 'crownM': 9},
}


def main():
    nodes, ways = {}, {}
    for f in glob.glob(os.path.join(ROOT, 'tools/.cache/osm-cny/*.osm')):
        for ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == 'node': nodes[el.get('id')] = (float(el.get('lat')), float(el.get('lon'))); el.clear()
            elif el.tag == 'way': ways['w' + el.get('id')] = [x.get('ref') for x in el.iter('nd')]; el.clear()
    ring = lambda wid: [[round(nodes[r][0], 7), round(nodes[r][1], 7)] for r in ways[wid] if r in nodes][:-1] if ways[wid][0] == ways[wid][-1] else [[round(nodes[r][0], 7), round(nodes[r][1], 7)] for r in ways[wid] if r in nodes]
    centre = lambda R: [round(sum(p[0] for p in R) / len(R), 7), round(sum(p[1] for p in R) / len(R), 7)]
    out = {'format': 'bikefree-heroes-1', 'note': 'tools/cny_heroes.py: CNY\'s landmarks on their OSM outlines (js/world/graph-heroes.js, js/world/toolbox/city/cny-landmarks.js)',
           'heroes': [], 'buildings': [], 'landmarks': [], 'stadiums': [], 'inclines': [], 'overlooks': [], 'stations': []}
    for label, model, wid, extra in LANDMARKS:
        l = {'label': label, 'model': model, **{k: v for k, v in extra.items() if k not in ('canal', 'rail', 'at')}}
        if wid: R = ring(wid); l['ring'] = R; l['center'] = centre(R)
        if 'at' in extra: l['center'] = extra['at']
        for k in ('canal', 'rail'):
            if k in extra: l['path'] = ring(extra[k]) if False else [[round(nodes[r][0], 7), round(nodes[r][1], 7)] for r in ways[extra[k]] if r in nodes]
        if model == 'railbridge': l['center'] = centre(l['path'])
        out['landmarks'].append(l)
    for label, wid, look in CHURCHES:
        R = ring(wid)
        # the footprint's frame: length, width and axis (its longest side), for the church builder
        xy = [((lo - R[0][1]) * KX, -(la - R[0][0]) * 110540) for la, lo in R]
        best = None
        for i in range(len(xy)):
            (x0, z0), (x1, z1) = xy[i], xy[(i + 1) % len(xy)]; L = math.hypot(x1 - x0, z1 - z0)
            if L < .5: continue
            ux, uz = (x1 - x0) / L, (z1 - z0) / L
            a = [x * ux + z * uz for x, z in xy]; b = [-x * uz + z * ux for x, z in xy]
            area = (max(a) - min(a)) * (max(b) - min(b))
            if not best or area < best[0]: best = (area, ux, uz, max(a) - min(a), max(b) - min(b))
        _, ux, uz, la_, lb_ = best
        if lb_ > la_: ux, uz, la_, lb_ = -uz, ux, lb_, la_
        axis = math.degrees(math.atan2(ux, -uz)) % 360   # (axisDeg: compass bearing of the long axis)
        c = centre(R)
        st = LOOKS[look]
        out['heroes'].append({'model': 'church', 'name': label, 'look': 'holyname', 'style': {**st, 'apse': False, 'lancets': False},
                              'lat': c[0], 'lon': c[1], 'lengthM': round(la_, 1), 'widthM': round(lb_, 1), 'axisDeg': round(axis, 1)})
        out['buildings'].append({'ring': R, 'h': st['ridge'], 'mh': 0, 'kind': 7, 'name': label})
    # the Erie Canal's water (user, 22 Nov: "the water in the canal … is cutting out"): OSM's canal ways as ribbons of
    # water on the ground (js/world/toolbox/city/cny-landmarks.js canal) — not the aqueduct (its trunk has its own)
    tags = {}
    for f in glob.glob(os.path.join(ROOT, 'tools/.cache/osm-cny/*.osm')):
        for ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == 'way':
                t = {x.get('k'): x.get('v') for x in el.iter('tag')}
                if t.get('waterway') == 'canal': tags['w' + el.get('id')] = t
                el.clear()
            elif el.tag == 'node': el.clear()
    lat0, lon0, R0 = 43.0643, -76.3210, 6300
    nc = 0
    for wid, t in tags.items():
        if t.get('bridge') == 'aqueduct' or t.get('tunnel'): continue
        P = [[round(nodes[r][0], 7), round(nodes[r][1], 7)] for r in ways[wid] if r in nodes]
        if len(P) < 2 or not any(math.hypot((lo - lon0) * KX, (la - lat0) * 110540) < R0 for la, lo in P): continue
        out['landmarks'].append({'label': t.get('name') or 'Erie Canal', 'model': 'canal', 'path': P, 'widthM': 12}); nc += 1
    print(f'  canal: {nc} ways of water')
    path = os.path.join(ROOT, 'routes/cities/cny-heroes.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(f"  wrote routes/cities/cny-heroes.json: {len(out['landmarks'])} landmarks, {len(out['heroes'])} churches")


if __name__ == '__main__':
    main()
