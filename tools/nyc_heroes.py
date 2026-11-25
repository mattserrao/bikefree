#!/usr/bin/env python3
"""NYC's landmarks (user, 25 Nov: "Ensure high detailed landmarks are made and visible so the park is immediately
familiar"; chose all four groups — the heart of the park, the middle park, the south end, the north and the Reservoir):
routes/cities/nyc-heroes.json, the models' places from OSM (each by its OSM id, so a rebuild finds the same thing),
drawn by js/world/toolbox/city/nyc-landmarks.js. Also the park wall's entrances (where OSM's ways cross the park's
outline: a pair of stone piers and a closed gate — the gates are closed, user 25 Nov) and the lawns where people sit.

  python3 tools/nyc_heroes.py      (after python3 tools/build_pgh.py --city nyc has fetched the OSM tiles)
Data © OpenStreetMap contributors (ODbL)."""
import glob, json, math, os, xml.etree.ElementTree as ET
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
from shapely.geometry import Polygon, LineString, Point

nodes, ntags, ways, rels = {}, {}, {}, {}
for f in glob.glob(os.path.join(ROOT, 'tools/.cache/osm-nyc/*.osm')):
    r = ET.parse(f).getroot()
    for nd in r.iter('node'):
        nodes[nd.get('id')] = (float(nd.get('lat')), float(nd.get('lon')))
        t = {x.get('k'): x.get('v') for x in nd.iter('tag')}
        if t: ntags[nd.get('id')] = t
    for w in r.iter('way'): ways[w.get('id')] = ([x.get('ref') for x in w.iter('nd')], {x.get('k'): x.get('v') for x in w.iter('tag')})
    for rel in r.iter('relation'): rels[rel.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in rel.iter('member')], {x.get('k'): x.get('v') for x in rel.iter('tag')})

R6 = lambda p: [round(p[0], 7), round(p[1], 7)]
def ring_of(kind, oid):
    if kind == 'w':
        nd = ways[oid][0]; return [R6(nodes[i]) for i in nd if i in nodes]
    mem = rels[oid][0]
    parts = [ways[ref][0] for typ, ref, role in mem if typ == 'way' and role == 'outer' and ref in ways]
    cur = list(parts.pop(0))
    while parts and cur[0] != cur[-1]:
        for k, p in enumerate(parts):
            if p[0] == cur[-1]: cur += p[1:]
            elif p[-1] == cur[-1]: cur += p[::-1][1:]
            else: continue
            parts.pop(k); break
        else: break
    return [R6(nodes[i]) for i in cur if i in nodes]
def centre(ring): return [round(sum(p[0] for p in ring) / len(ring), 7), round(sum(p[1] for p in ring) / len(ring), 7)]

# trees kept this far (m) off each landmark's outline, so the landmark is seen (graph-city: a landmark's clearM)
CLEAR = {'bethesda': 40, 'belvedere': 35, 'bowbridge': 10, 'obelisk': 14, 'columbus': 25, 'maine': 12, 'pulitzer': 14, 'reservoir': 0, 'lawn': 0, 'conservatory': 4, 'carousel': 16, 'delacorte': 22, 'dairy': 12, 'boathouse': 14, 'wollman': 12}
# (model, label, OSM object, note)
L = [
    ('bethesda', 'Bethesda Terrace & Fountain', ('w', '958635828'), 'the Angel of the Waters (Emma Stebbins, 1873) over the lower terrace; the arcade under the 72nd St drive, the grand stairs, the Lake beyond'),
    ('bowbridge', 'Bow Bridge', ('w', '580516390'), '1862, cast iron (Vaux and Mould): a low 26 m arch over the Lake, scrolled railings, planting urns'),
    ('boathouse', 'Loeb Boathouse', ('r', '3698871'), '1954: the low brick boathouse and restaurant on the Lake, a green roof, the rowboat dock'),
    ('belvedere', 'Belvedere Castle', ('w', '278363023'), '1869 (Vaux and Mould): a Victorian folly of Manhattan schist on Vista Rock, a tower and turret, over Turtle Pond'),
    ('delacorte', 'Delacorte Theater', ('w', '278363024'), 'the open-air amphitheatre of Shakespeare in the Park, on Turtle Pond'),
    ('obelisk', "Cleopatra's Needle", ('w', '179685272'), 'c. 1450 BC, red granite, 21 m: the obelisk behind the Met, on its bronze crabs'),
    ('gapstow', 'Gapstow Bridge', ('w', '546663191'), '1896: a rough schist arch over the Pond, the Plaza and Midtown behind it'),
    ('wollman', 'Wollman Rink', ('w', '136507647'), 'the ice rink below the south end'),
    ('carousel', 'Friedsam Memorial Carousel', ('w', '585788256'), '1951: an octagonal brick house with a tent roof'),
    ('imagine', 'Strawberry Fields — Imagine', ('w', '958999496'), "the black-and-white mosaic (Italian, 1985) for John Lennon, by the Dakota"),
    ('bandshell', 'Naumburg Bandshell', ('w', '265347581'), '1923: a limestone half-dome at the head of the Mall'),
    ('dairy', 'The Dairy', ('w', '265347588'), '1870: a Victorian Gothic cottage with a painted loggia'),
    ('cottage', 'Swedish Cottage', ('w', '278363049'), 'an 1876 Swedish schoolhouse, now the marionette theatre'),
    ('dana', 'Charles A. Dana Discovery Center', ('w', '278366155'), "a Victorian-style boathouse on the Harlem Meer's north shore"),
    ('blockhouse', 'Blockhouse No. 1', ('w', '39243913'), 'an 1814 stone fort on a rock in the North Woods'),
    ('conservatory', 'Conservatory Garden', ('w', '387351390'), 'six formal acres: hedged parterres, the wisteria pergola, the Untermyer Fountain'),
    ('reservoir', 'Jacqueline Kennedy Onassis Reservoir', ('w', '6678417'), "the 106-acre reservoir, its low iron fence and the cinder running track round it"),
    ('columbus', 'Columbus Monument', ('w', '608947452'), '1892: a granite rostral column with Columbus on top, in the circle'),
    ('maine', 'USS Maine Monument', ('w', '608965023'), "1913: a pylon and fountain with the gilded Columbia Triumphant on top, at Merchants' Gate"),
    ('pulitzer', 'Pulitzer Fountain', ('w', '988718514'), "1916: the tiered basins and Pomona, in Grand Army Plaza before the Plaza Hotel"),
    ('cherryhill', 'Cherry Hill Fountain', ('w', '959007357'), "1860: a gilded fountain on Cherry Hill, by the Lake"),
    ('lawn', 'Sheep Meadow', ('w', '290827260'), 'fifteen acres of open lawn: picnics and sunbathing'),
    ('lawn', 'The Great Lawn', ('w', '255971446'), 'the great oval lawn and its eight ball fields'),
]
STATUES = [('statue', 'Alice in Wonderland', '561950603', 'bronze (1959): Alice on the mushroom, by Conservatory Water'),
           ('statue', 'Hans Christian Andersen', '3892214691', 'bronze (1956), with the Ugly Duckling'),
           ('gate', 'Vanderbilt Gate', '3477246612', 'the wrought-iron gate of the Conservatory Garden on Fifth Avenue (Paris, 1894)')]
out = []
for model, label, (kind, oid), note in L:
    try: ring = ring_of(kind, oid)
    except KeyError: print(f'  (not in the tiles: {label})'); continue
    if len(ring) < 3: continue
    out.append({'label': label, 'model': f'nyc_{model}', 'osm': f'{kind}{oid}', 'note': note, 'ring': ring, 'center': centre(ring), 'clearM': CLEAR.get(model, 10)})
for model, label, nid, note in STATUES:
    if nid in nodes: out.append({'label': label, 'model': f'nyc_{model}', 'osm': f'n{nid}', 'note': note, 'center': R6(nodes[nid]), 'clearM': 8})

# views: ground kept clear of trees so a landmark is seen across the water (Belvedere over Turtle Pond); no model
cfg = json.load(open(os.path.join(ROOT, 'tools/city/nyc.json')))
for name, m in [('Turtle Pond', 9)]:
    p = next((q for q in cfg.get('pools', []) if q['name'] == name and q.get('ring')), None)
    if p: out.append({'label': f'{name} (view)', 'model': 'nyc_view', 'note': 'trees kept off its banks', 'ring': p['ring'], 'center': centre(p['ring']), 'clearM': m})

# the park wall's entrances: where a highway way crosses the park's outline
poly = json.load(open(os.path.join(ROOT, 'tools/city/nyc-area.json')))['polygon']
P = Polygon([(lo, la) for la, lo in poly]); edge = P.exterior
gates = []
for nd, t in ways.values():
    if t.get('highway') not in ('footway', 'pedestrian', 'path', 'cycleway', 'service', 'unclassified', 'bridleway', 'steps') or t.get('footway') == 'sidewalk': continue
    pts = [nodes[i] for i in nd if i in nodes]
    if len(pts) < 2: continue
    x = LineString([(lo, la) for la, lo in pts]).intersection(edge)
    for g in getattr(x, 'geoms', [x]):
        if g.geom_type == 'Point':
            q = [round(g.y, 7), round(g.x, 7)]
            if all(math.hypot((q[0] - o[0]) * 110540, (q[1] - o[1]) * 84300) > 12 for o, _ in gates):
                gates.append((q, 'drive' if 'Drive' in t.get('name', '') or t.get('highway') in ('service', 'unclassified') else 'path'))
gates_out = [{'at': q, 'kind': k} for q, k in gates]
print(f'  landmarks: {len(out)}; entrances in the wall: {len(gates_out)}')
json.dump({'format': 'bikefree-heroes-1', 'note': 'NYC landmarks (tools/nyc_heroes.py from OSM; models js/world/toolbox/city/nyc-landmarks.js). Data © OpenStreetMap contributors (ODbL).',
           'heroes': [], 'buildings': [], 'landmarks': out, 'stadiums': [], 'inclines': [], 'overlooks': [], 'stations': [],
           'park': {'outline': poly, 'gates': gates_out}},
          open(os.path.join(ROOT, 'routes/cities/nyc-heroes.json'), 'w'), separators=(',', ':'))
print('wrote routes/cities/nyc-heroes.json')
