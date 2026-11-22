#!/usr/bin/env python3
"""PGH's city data (user, 21 Nov: "proceed on all phases" of claude/pgh-assets-plan.md): the Pittsburgh map's own
extraction (tools/build_city.py: land use, buildings and their kinds and heights, the map's trees, the street kit's
furniture, shops, car parks and fences) run over PGH's whole network instead of one route — everything within
250 m of a PGH way (towers of 40 m and more anywhere in the box: the skyline) — plus what each PGH edge is made of
(OSM's surface, one-way, lanes, sidewalks), sample by sample.

    python3 tools/pgh_city.py          (after npm run pgh:build: PGH's edges and their ids)

Reads tools/.cache/osm-pgh (the tiles tools/build_pgh.py fetched) and routes/cities/pgh.json; writes
routes/cities/pgh-city.json ("bikefree-pgh-city-1"):
  origin, unit                   coordinates packed as in the city data: [qlat, qlon] Int16 from origin, unit degrees
  land {west, south, east, north, nx, ny, m, rle}
                                 the land-use grid (codes as LAND in js/world/toolbox/city/landscape.js: 0 paved, 1 grass,
                                 2 woods, 3 water, 4 building, 5 sand, 6 plaza, 7 outside, 8 yards)
  buildings {count, h, mh, kind, starts, xy, names}
                                 as the city data's (kinds: 0 rowhouse, 1 house, 2 commercial, 3 industrial, 4 stone tower,
                                 5 glass tower, 6 PPG, 7 church, 8 garage, 11 civic)
  trees                          the map's trees (natural=tree), packed
  streetKit                      tools/citylib/street_kit.py's block
  edges {<id>: {s: [[i0, i1, code], …], ow, lanes, walk}}
                                 per PGH edge: surface runs over its samples (codes SURF), one-way (1, -1: against the
                                 edge's direction), lanes, sidewalks (0 none, 1 one side, 2 both)
Data © OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys, glob, itertools
import xml.etree.ElementTree as ET
import numpy as np
from scipy import ndimage
from collections import Counter, defaultdict
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citylib import street_kit
from build_city import elevation, rings_of, parse_m, simplify, point_in, pack_int16, pack_uint16, pack_uint32, rle, BRICK_SURFACES
UNIT = 3e-6          # coordinate unit (degrees): PGH is bigger than one city scene (±0.098° in Int16)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# the city (user, 22 Nov: CNY, "following the guide used for PGH"): routes/cities/<id>.json and its files; PGH by default
CITY = sys.argv[sys.argv.index('--city') + 1] if '--city' in sys.argv else 'pgh'
REACH = 250          # m from a PGH way: buildings, trees, the street kit
TALL = 40            # towers this tall are kept anywhere in the box
LAND_M = 6
SURF = ['asphalt', 'brick', 'sett', 'concrete', 'paving', 'gravel', 'dirt', 'wood']
SURF_OF = {'asphalt': 0, 'paved': 0, 'chipseal': 0, 'brick': 1, 'bricks': 1, 'sett': 2, 'cobblestone': 2, 'unhewn_cobblestone': 2,
           'concrete': 3, 'concrete:plates': 3, 'concrete:lanes': 3, 'paving_stones': 4, 'gravel': 5, 'fine_gravel': 5, 'compacted': 5,
           'pebblestone': 5, 'dirt': 6, 'ground': 6, 'earth': 6, 'grass': 6, 'unpaved': 6, 'mud': 6, 'wood': 7}


def decode_edges(pgh):
    k = pgh.get('unit', {}).get('latlon', 1e-6), pgh.get('unit', {}).get('ele', 0.1)
    out = []
    for e in pgh['edges']:
        la = list(itertools.accumulate(e['lat'])); lo = list(itertools.accumulate(e['lon']))
        out.append({'id': e['id'], 'name': e.get('name', ''), 'kind': e['kind'], 'lat': [v * k[0] for v in la], 'lon': [v * k[0] for v in lo],
                    'bridges': e.get('bridges', [])})
    return out


def main():
    pgh = json.load(open(os.path.join(ROOT, f'routes/cities/{CITY}.json')))
    E = decode_edges(pgh)
    la_all = [v for e in E for v in e['lat']]; lo_all = [v for e in E for v in e['lon']]
    pad = 0.004
    gs, gn, gw, ge = min(la_all) - pad, max(la_all) + pad, min(lo_all) - pad * 1.3, max(lo_all) + pad * 1.3
    lat0, lon0 = (gs + gn) / 2, (gw + ge) / 2
    kx, ky = 111319.49 * math.cos(math.radians(lat0)), 111319.49
    q = lambda la, lo: (round((la - lat0) / UNIT), round((lo - lon0) / UNIT))
    loc = lambda la, lo: ((lo - lon0) * kx, (la - lat0) * ky)
    assert (gn - gs) / 2 / UNIT < 32000 and (ge - gw) / 2 / UNIT < 32000, 'box too big for Int16 coordinates'

    # distance to PGH's ways: a 50 m grid of their samples (every 10 m)
    cell = 50
    grid = defaultdict(list)
    for e in E:
        for la, lo in zip(e['lat'], e['lon']):
            x, y = loc(la, lo); grid[(int(x // cell), int(y // cell))].append((x, y))
    def way_dist(la, lo, limit):
        x, y = loc(la, lo); r = int(limit // cell) + 1; best = 1e9
        cx, cy = int(x // cell), int(y // cell)
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                for px, py in grid.get((cx + dx, cy + dy), ()):
                    d = (px - x) ** 2 + (py - y) ** 2
                    if d < best: best = d
        return math.sqrt(best)

    # OSM (the tiles are big: parse each one and keep only what's needed)
    nodes, ntags, ways, rels = {}, {}, {}, {}
    files = sorted(glob.glob(os.path.join(ROOT, f'tools/.cache/osm-{CITY}/*.osm')))
    for k, f in enumerate(files):
        for ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == 'node':
                i = el.get('id'); nodes[i] = (float(el.get('lat')), float(el.get('lon')))
                t = {x.get('k'): x.get('v') for x in el.iter('tag')}
                if t: ntags[i] = t
                el.clear()
            elif el.tag == 'way':
                ways[el.get('id')] = ([x.get('ref') for x in el.iter('nd')], {x.get('k'): x.get('v') for x in el.iter('tag')})
                el.clear()
            elif el.tag == 'relation':
                rels[el.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in el.iter('member')], {x.get('k'): x.get('v') for x in el.iter('tag')})
                el.clear()
        if (k + 1) % 50 == 0: print(f'  OSM {k + 1}/{len(files)} tiles')
    print(f'  OSM: {len(nodes)} nodes, {len(ways)} ways, {len(rels)} relations')

    # the Pittsburgh map's settings, gathered from its scenes
    special, res_boxes, drop_b = {}, [], set()
    for f in (glob.glob(os.path.join(ROOT, 'tools/city/pittsburgh*.json')) if CITY == 'pgh' else []):   # (the Pittsburgh map's own settings: PGH only)
        try: c = json.load(open(f))
        except Exception: continue
        special.update(c.get('specialBuildings', {})); res_boxes += c.get('residentialBoxes', [])
        drop_b |= {str(d['way']) for d in c.get('dropBuildings', [])}

    # 1. land use (as build_city.py), at LAND_M
    lx = int((ge - gw) * kx / LAND_M) + 1; ly = int((gn - gs) * ky / LAND_M) + 1
    UNTAGGED = 255   # filled in after the buildings: yards, lots, woods or grass by what stands round it (below)
    img = Image.new('L', (lx, ly), UNTAGGED)
    dr = ImageDraw.Draw(img)
    pix = lambda la, lo: ((lo - gw) / (ge - gw) * (lx - 1), (gn - la) / (gn - gs) * (ly - 1))
    def poly(pts, code):
        if len(pts) > 2: dr.polygon([pix(*p) for p in pts], fill=code)
    green = {'park', 'garden', 'pitch', 'golf_course', 'playground', 'dog_park', 'recreation_ground', 'common'}
    grassy = {'grass', 'meadow', 'village_green', 'cemetery', 'allotments', 'orchard', 'farmland', 'greenfield'}
    woody = {'wood', 'scrub', 'forest', 'heath', 'wetland'}
    layers = {8: [], 9: [], 1: [], 2: [], 5: [], 6: [], 3: []}
    def classify(t):
        if t.get('landuse') == 'residential': return 8
        if t.get('landuse') in ('commercial', 'retail', 'industrial', 'railway', 'construction', 'brownfield') or t.get('amenity') == 'parking': return 9
        if t.get('natural') in woody or t.get('landuse') in ('forest',): return 2
        if t.get('leisure') in green or t.get('landuse') in grassy or t.get('natural') in ('grassland',): return 1
        if t.get('natural') in ('sand', 'bare_rock', 'scree', 'beach'): return 5
        if t.get('highway') == 'pedestrian' and t.get('area') == 'yes' or t.get('place') == 'square': return 6
        if t.get('natural') == 'water' and t.get('water') not in ('river',): return 3
        return None
    for nd, t in ways.values():
        c = classify(t)
        if c and nd and nd[0] == nd[-1]: layers[c].append([nodes[i] for i in nd if i in nodes])
    for rel in rels.values():
        c = classify(rel[1])
        if c and rel[1].get('type') == 'multipolygon':
            try: layers[c] += rings_of(rel, ways, nodes)
            except Exception: pass
    for code in (8, 9, 1, 2, 5, 6, 3):
        for pts in layers[code]: poly(pts, 0 if code == 9 else code)
    # the waterways OSM draws as lines (no area): CNY's Erie Canal, Nine Mile Creek — water at their width (PGH's rivers
    # are areas, under its water plane)
    if CITY != 'pgh':
        WIDE = {'canal': 14, 'river': 16, 'stream': 4}
        nw_ = 0
        for wid, (nd, t) in ways.items():
            w_m = WIDE.get(t.get('waterway')); 
            if not w_m or t.get('tunnel') in ('culvert', 'yes'): continue
            pts = [nodes[r] for r in nd if r in nodes]
            if len(pts) > 1: dr.line([pix(*q) for q in pts], fill=3, width=max(1, round(w_m / LAND_M))); nw_ += 1
        print(f'  waterways drawn as water: {nw_}')

    # 2. buildings (as build_city.py)
    def height_of(t):
        h = parse_m(t.get('height'))
        if h is None and t.get('building:levels'):
            try: h = float(t['building:levels'].split(';')[0]) * 3.4 + 1.2
            except ValueError: h = None
        return h
    def min_h(t):
        h = parse_m(t.get('min_height'))
        if h is None and t.get('building:min_level'):
            try: h = float(t['building:min_level']) * 3.4
            except ValueError: h = None
        return h or 0.0
    outlines, parts = [], []
    for wid, (nd, t) in ways.items():
        if not nd or nd[0] != nd[-1] or len(nd) < 4: continue
        if 'building:part' in t and t['building:part'] not in ('no',): parts.append((wid, [nodes[i] for i in nd if i in nodes], t))
        elif 'building' in t and t['building'] not in ('no', 'roof', 'construction', 'ruins'): outlines.append((wid, [nodes[i] for i in nd if i in nodes], t))
    for rid, rel in rels.items():
        t = rel[1]
        if t.get('type') == 'multipolygon' and 'building' in t and t['building'] not in ('no', 'roof'):
            try:
                for k, ring in enumerate(rings_of(rel, ways, nodes)): outlines.append((f'r{rid}_{k}', ring, t))
            except Exception: pass
    part_centres = [(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) for _, pts, _ in parts if pts]
    pc_grid = defaultdict(list)
    for k, (la, lo) in enumerate(part_centres): pc_grid[(round(la * 500), round(lo * 500))].append(k)
    # PGH's ground ways (not decks): a footprint one runs through is left out (a mapped passage, a mis-drawn outline)
    wgrid = defaultdict(list)
    for e in E:
        deck = set()
        for a, b in e['bridges']: deck |= set(range(a + 1, b))
        for i, (la, lo) in enumerate(zip(e['lat'], e['lon'])):
            if i not in deck: wgrid[(round(la * 2000), round(lo * 2000))].append((la, lo))
    kept, why = [], Counter()
    for wid, pts, t in outlines + parts:
        if len(pts) < 4 or wid in drop_b: continue
        is_part = 'building:part' in t
        clat = sum(p[0] for p in pts) / len(pts); clon = sum(p[1] for p in pts) / len(pts)
        if not is_part and any(point_in([(p[1], p[0]) for p in pts], part_centres[k][1], part_centres[k][0])
                               for a in (-1, 0, 1) for b in (-1, 0, 1) for k in pc_grid.get((round(clat * 500) + a, round(clon * 500) + b), ())):
            continue
        if not (gs < clat < gn and gw < clon < ge): why['box'] += 1; continue
        h = height_of(t); name = t.get('name', '')
        if t.get('building') == 'stadium' or t.get('leisure') == 'stadium': why['stadium'] += 1; continue
        d = way_dist(clat, clon, REACH)
        if d > REACH and not (h and h >= TALL): why['far'] += 1; continue
        ring_ll = [(p[1], p[0]) for p in pts]
        if any(point_in(ring_ll, wlo, wla) for a in (-1, 0, 1) for b in (-1, 0, 1)
               for wla, wlo in wgrid.get((round(clat * 2000) + a, round(clon * 2000) + b), ())):
            why['on a way'] += 1; continue
        b = t.get('building', t.get('building:part', 'yes'))
        if h is None:
            h = {'house': 8.5, 'detached': 8.5, 'semidetached_house': 9, 'terrace': 10, 'residential': 10.5, 'apartments': 14,
                 'garage': 3.2, 'garages': 3.2, 'shed': 3, 'commercial': 9, 'retail': 7.5, 'industrial': 9.5, 'warehouse': 10,
                 'church': 16, 'school': 11, 'hospital': 20, 'office': 18, 'parking': 12, 'hotel': 24}.get(b, 9.5)
            h *= 0.9 + (int(wid.strip('r').split('_')[0]) % 7) * 0.04
        if name in special: kind = special[name]
        elif b in ('church', 'cathedral', 'chapel') or t.get('amenity') == 'place_of_worship': kind = 7
        elif b in ('parking',) or t.get('amenity') == 'parking': kind = 8
        elif h >= 38: kind = 5 if (int(wid.strip('r').split('_')[0]) % 10) < 5 else 4
        elif b in ('industrial', 'warehouse', 'manufacture', 'service', 'shed', 'garage', 'garages'): kind = 3
        elif b in ('house', 'detached', 'semidetached_house', 'bungalow'): kind = 1
        elif b in ('terrace', 'residential', 'apartments'): kind = 0
        elif b in ('commercial', 'retail', 'office', 'hotel', 'school', 'university', 'hospital', 'civic', 'public', 'government'): kind = 2
        else:
            px_, py_ = pix(clat, clon)
            res = 0 <= px_ < lx and 0 <= py_ < ly and img.getpixel((int(px_), int(py_))) in (8, UNTAGGED)
            area_m2 = abs(sum(a[1] * b_[0] - b_[1] * a[0] for a, b_ in zip(pts, pts[1:] + pts[:1])) / 2 * kx * ky)
            if CITY != 'pgh': kind = 1 if res and area_m2 < 400 else 2   # (a suburb: detached houses among the homes, not rowhouses)
            elif res and area_m2 < 220: kind = 0 if (clat < 40.4335 and clon > -79.997) or (int(''.join(ch for ch in wid if ch.isdigit()) or 0) % 3 == 0) else 1
            else: kind = 0 if clat < 40.4335 and clon > -79.997 else 2
        lp = [loc(*p) for p in pts]
        if lp[0] == lp[-1]: lp = lp[:-1]
        far = max(range(len(lp)), key=lambda k: math.hypot(lp[k][0] - lp[0][0], lp[k][1] - lp[0][1]))
        sp = simplify(lp[:far + 1], 0.5)[:-1] + simplify(lp[far:] + [lp[0]], 0.5)[:-1]
        if len(sp) < 3: why['simp'] += 1; continue
        area = sum(sp[i][0] * sp[i - 1][1] - sp[i - 1][0] * sp[i][1] for i in range(len(sp))) / 2
        if abs(area) < 12: why['small'] += 1; continue
        ll = [((y / ky) + lat0, (x / kx) + lon0) for x, y in sp]
        kept.append({'h': h, 'mh': min_h(t), 'kind': kind, 'ring': [q(*p) for p in ll], 'name': name if name in special or h >= TALL else ''})
        poly(ll, 4)
    print(f'  buildings: {len(kept)} kept ({sum(1 for b in kept if b["h"] >= TALL)} tall); left out: {dict(why)}')
    print(f'  kinds: {dict(Counter(b["kind"] for b in kept))}')

    # the land OSM leaves untagged (most of Pittsburgh): yards where houses and rowhouses stand round it, lots and
    # paving among shops and works, woods on the steep ground away from buildings (the city's wooded hillsides),
    # grass elsewhere
    bm = {0: Image.new('L', (lx, ly), 0), 1: Image.new('L', (lx, ly), 0)}
    bd = {k: ImageDraw.Draw(v) for k, v in bm.items()}
    for b in kept:
        ll = [(lat0 + a * UNIT, lon0 + o * UNIT) for a, o in b['ring']]
        bd[0 if b['kind'] in (0, 1) else 1].polygon([pix(*p) for p in ll], fill=1)
    win = int(round(36 / LAND_M)) * 2 + 1
    res_n = ndimage.uniform_filter(np.asarray(bm[0], dtype=np.float32), win)
    com_n = ndimage.uniform_filter(np.asarray(bm[1], dtype=np.float32), win)
    # slope from the terrain tiles on a 24 m lattice
    sx, sy = max(2, int(lx * LAND_M / 24)), max(2, int(ly * LAND_M / 24))
    H = np.array([[elevation(gn - (gn - gs) * j / (sy - 1), gw + (ge - gw) * i / (sx - 1)) for i in range(sx)] for j in range(sy)], dtype=np.float32)
    gy, gx = np.gradient(H, 24.0)
    slope = ndimage.zoom(np.hypot(gx, gy), (ly / sy, lx / sx), order=1)[:ly, :lx]
    L = np.asarray(img).copy()
    un = L == UNTAGGED
    built = (res_n + com_n) > 0.04
    L[un & built & (res_n >= com_n)] = 8
    L[un & built & (res_n < com_n)] = 0
    rest = un & ~built
    L[rest & (slope > 0.16)] = 2
    L[rest & (slope <= 0.16)] = 1
    # beyond the band PGH's buildings reach (no footprints kept there): 7, "outside" — suburbs and hills seen from afar
    wm = Image.new('L', (lx, ly), 0); wd = ImageDraw.Draw(wm)
    for e in E: wd.line([pix(a, o) for a, o in zip(e['lat'], e['lon'])], fill=1, width=1)
    far_ = ndimage.distance_transform_edt(np.asarray(wm) == 0) * LAND_M > REACH + 40
    L[un & far_ & (L == 1)] = 7
    img = Image.fromarray(L)
    print(f'  land (share): ' + ', '.join(f'{n} {np.mean(L == c) * 100:.0f}%' for c, n in [(0, 'paved'), (1, 'grass'), (2, 'woods'), (3, 'water'), (4, 'building'), (6, 'plaza'), (8, 'yards')]))

    # 3. trees, the street kit
    trees = []
    for i, t in ntags.items():
        if t.get('natural') == 'tree' and i in nodes:
            la, lo = nodes[i]
            if gs < la < gn and gw < lo < ge and way_dist(la, lo, REACH) < REACH: trees += q(la, lo)
    kit = street_kit.extract(nodes, ntags, ways, q, way_dist, radius=REACH)

    # 4. what each PGH edge is made of: the nearest OSM highway (same name preferred) at each sample
    seg = defaultdict(list)
    for wid, (nd, t) in ways.items():
        if 'highway' not in t or t.get('area') == 'yes': continue
        pts = [nodes[i] for i in nd if i in nodes]
        for a, b in zip(pts, pts[1:]):
            for la in (a[0], b[0], (a[0] + b[0]) / 2):
                for lo in (a[1], b[1], (a[1] + b[1]) / 2):
                    seg[(round(la * 2000), round(lo * 2000))].append((wid, a, b))
    def nearest_way(la, lo, name):
        x, y = loc(la, lo); best = None
        seen = set()
        for a_ in (-1, 0, 1):
            for b_ in (-1, 0, 1):
                for wid, a, b in seg.get((round(la * 2000) + a_, round(lo * 2000) + b_), ()):
                    if (wid, a, b) in seen: continue
                    seen.add((wid, a, b))
                    ax, ay = loc(*a); bx, by = loc(*b); dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy or 1
                    u = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); d = math.hypot(ax + dx * u - x, ay + dy * u - y)
                    t = ways[wid][1]
                    if t.get('name', '') != name and name: d += 4   # the same street first
                    if best is None or d < best[0]: best = (d, wid, (dx, dy))
        return best if best and best[0] < 12 else None
    edges, scount = {}, Counter()
    for e in E:
        codes, ow, lanes, walk = [], Counter(), Counter(), Counter()
        n = len(e['lat'])
        for i in range(n):
            hit = nearest_way(e['lat'][i], e['lon'][i], e['name'])
            if not hit: codes.append(None); continue
            t = ways[hit[1]][1]
            s = t.get('surface')
            code = SURF_OF.get(s, 0 if e['kind'] != 'path' or not s else 0)
            codes.append(code)
            # one-way, against or along this edge's direction
            if t.get('oneway') in ('yes', '1', '-1') or t.get('highway') in ('motorway', 'motorway_link'):
                i1 = min(n - 1, i + 1); i0 = max(0, i - 1)
                ex, ey = (e['lon'][i1] - e['lon'][i0]) * kx, (e['lat'][i1] - e['lat'][i0]) * ky
                along = ex * hit[2][0] + ey * hit[2][1]
                sgn = (1 if along >= 0 else -1) * (-1 if t.get('oneway') == '-1' else 1)
                ow[sgn] += 1
            else: ow[0] += 1
            try: lanes[int(t.get('lanes', '0').split(';')[0])] += 1
            except ValueError: pass
            sw = t.get('sidewalk') or t.get('sidewalk:both') and 'both'
            walk[{'both': 2, 'left': 1, 'right': 1, 'separate': 2, 'no': 0, 'none': 0}.get(sw, -1)] += 1
        # surface runs (a run under 3 samples takes its neighbours')
        filled = codes[:]
        for i in range(n):
            if filled[i] is None: filled[i] = next((c for c in filled[i::-1] if c is not None), next((c for c in filled[i:] if c is not None), 0))
        runs = []
        for i, c in enumerate(filled):
            if runs and runs[-1][2] == c: runs[-1][1] = i
            else: runs.append([i, i, c])
        for k in range(1, len(runs) - 1):
            if runs[k][1] - runs[k][0] < 2 and runs[k - 1][2] == runs[k + 1][2]: runs[k][2] = runs[k - 1][2]
        merged = []
        for r in runs:
            if merged and merged[-1][2] == r[2]: merged[-1][1] = r[1]
            else: merged.append(r[:])
        for r in merged: scount[SURF[r[2]]] += (r[1] - r[0] + 1) * 10
        rec = {}
        if merged != [[0, n - 1, 0]]: rec['s'] = merged
        o = ow.most_common(1)[0][0] if ow else 0
        if o: rec['ow'] = o
        if lanes: rec['lanes'] = lanes.most_common(1)[0][0]
        w = walk.most_common(1)[0][0] if walk else -1
        if w >= 0: rec['walk'] = w
        if rec: edges[e['id']] = rec
    print(f'  edge surfaces (km): {", ".join(f"{k} {v / 1000:.1f}" for k, v in scount.most_common())}; one-way edges {sum(1 for r in edges.values() if r.get("ow"))}')

    # ---- what each edge is, decided here once (the world used to work it out at start, over every building):
    # a trail's width, a riverwalk, a street's sidewalks, and the Pittsburgh map's brick rule
    pools = [(p['level'], p['box']) for p in pgh.get('pools', [])]
    def pool_at(la, lo):
        for lev, bx in pools:
            if bx[0] <= la <= bx[2] and bx[1] <= lo <= bx[3]: return lev
        return pgh.get('waterLevelM', 216.6)
    wet = lambda la, lo: elevation(la, lo) < pool_at(la, lo) + 0.5
    bgrid = defaultdict(list)
    for bi, bb in enumerate(kept):
        ll = [(lat0 + qa * UNIT, lon0 + qo * UNIT) for qa, qo in bb['ring']]
        cla = sum(p[0] for p in ll) / len(ll); clo = sum(p[1] for p in ll) / len(ll)
        x, y = loc(cla, clo); r = max(math.hypot(*(a - c for a, c in zip(loc(*p), (x, y)))) for p in ll)
        bb['c'] = (x, y, r); bgrid[(int(x // 40), int(y // 40))].append(bi)
    def building_near(x, y, d):
        for i in range(int((x - d - 60) // 40), int((x + d + 60) // 40) + 1):
            for j in range(int((y - d - 60) // 40), int((y + d + 60) // 40) + 1):
                for bi in bgrid.get((i, j), ()):
                    cx, cy, r = kept[bi]['c']
                    if math.hypot(cx - x, cy - y) - r < d: return kept[bi]
        return None
    Larr = np.asarray(img)
    def land_at(la, lo):
        px_, py_ = pix(la, lo); i, j = int(round(px_)), int(round(py_))
        return int(Larr[j, i]) if 0 <= i < lx and 0 <= j < ly else 7
    import re
    MAIN_TRAIL = re.compile(r'Canalway|Heritage|Allegheny Passage|Eliza Furnace|North Shore Trail|South Side Trail|Station Square Trail|Strip District Trail|Hot Metal|Mon Wharf|^Trail$|Riverwalk|Riverfront', re.I)
    widths = pgh.get('widths', {})
    ke = pgh.get('unit', {}).get('ele', 0.1)
    for e, pe in zip(E, pgh['edges']):
        ele = [v * ke for v in itertools.accumulate(pe['ele'])]
        rec = edges.setdefault(e['id'], {})
        n = len(e['lat']) - 1
        nrm = []
        for i in range(n + 1):
            i0, i1 = max(0, i - 1), min(n, i + 1)
            x0, y0 = loc(e['lat'][i0], e['lon'][i0]); x1, y1 = loc(e['lat'][i1], e['lon'][i1]); l = math.hypot(x1 - x0, y1 - y0) or 1
            nrm.append((-(y1 - y0) / l, (x1 - x0) / l))
        off = lambda i, d: ((e['lat'][i] + nrm[i][1] * d / ky), (e['lon'][i] + nrm[i][0] * d / kx))
        runs = rec.get('s') or [[0, n, 0]]
        code = [0] * (n + 1)
        for r0, r1, c in runs:
            for i in range(r0, r1 + 1): code[i] = c
        if e['kind'] == 'path':
            deck = sum(q - p for p, q in e['bridges'])
            river = sum(1 for i in range(0, n + 1, 2) if any(wet(*off(i, d)) for d in (-22, -12, 12, 22)))
            cnt = len(range(0, n + 1, 2))
            paved = sum(1 for i in range(0, n + 1, 2) if code[i] in (3, 4))
            riverside = river / cnt > 0.4 and deck <= n * 0.5
            if riverside and (paved / cnt > 0.5 or re.search(r'Riverwalk|Riverfront', e['name'] or '', re.I)): rec['w'] = 5.5; rec['rw'] = 1
            elif riverside or MAIN_TRAIL.search(e['name'] or ''): rec['w'] = 3.6
            else: rec['w'] = 2.6
            continue
        if e['kind'] in ('plaza', 'alley'): continue
        half = widths.get(e['kind'], 7) / 2
        urban = shops = cnt = 0
        for i in range(0, n + 1, 2):
            for sd in (-1, 1):
                la, lo = off(i, sd * (half + 6)); cnt += 1
                bb = building_near(*loc(la, lo), 18)
                if bb and land_at(la, lo) in (0, 4, 6, 8):
                    urban += 1
                    if bb['kind'] in (2, 4, 5): shops += 1
        long_deck = any(q - p > n * 0.8 for p, q in e['bridges'])
        if rec.get('walk', -1) != 0 and not long_deck and urban / cnt > 0.45:
            rec['walk'] = 1.8 if e['kind'] == 'residential' else 3.2 if shops / cnt > 0.3 else 2.4
        else: rec.pop('walk', None)
        if e['kind'] == 'residential' and CITY == 'pgh':   # (the Pittsburgh map's brick rule: steep side streets)
            run = 0
            for i in range(n + 1):
                i0, i1 = max(0, i - 1), min(n, i + 1)
                g = abs(ele[i1] - ele[i0]) / ((i1 - i0) * 10 or 1)
                run = run + 1 if g >= 0.07 and land_at(e['lat'][i], e['lon'][i]) != 0 else 0
                if run >= 3:
                    for k in range(i - run + 1, i + 1):
                        if code[k] == 0: code[k] = 1
            merged = []
            for i, c in enumerate(code):
                if merged and merged[-1][2] == c: merged[-1][1] = i
                else: merged.append([i, i, c])
            if merged != [[0, n, 0]]: rec['s'] = merged
    for k in [k for k, v in edges.items() if not v]: del edges[k]
    print(f"  edges: {sum(1 for v in edges.values() if v.get('walk'))} with sidewalks, {sum(1 for v in edges.values() if v.get('rw'))} riverwalks, "
          f"{sum(r[1] - r[0] + 1 for v in edges.values() for r in v.get('s', []) if r[2] == 1) * 10 / 1000:.1f} km of brick")

    # ---- by sector (~1.6 km): the world fetches a sector's buildings, trees and furniture as the rider nears it
    DLAT, DLON = 0.0144, 0.019
    sec = lambda la, lo: f'{int((la - gs) // DLAT)}_{int((lo - gw) // DLON)}'
    S = defaultdict(lambda: {'b': [], 't': [], 'p': [], 'l': [], 'n': []})
    for bb in kept:
        ll = [(lat0 + qa * UNIT, lon0 + qo * UNIT) for qa, qo in bb['ring']]
        S[sec(sum(p[0] for p in ll) / len(ll), sum(p[1] for p in ll) / len(ll))]['b'].append(bb)
    for k in range(0, len(trees), 2): S[sec(lat0 + trees[k] * UNIT, lon0 + trees[k + 1] * UNIT)]['t'] += [trees[k], trees[k + 1]]
    un16 = lambda t: list(__import__('struct').unpack(f'<{len(__import__("base64").b64decode(t)) // 2}h', __import__('base64').b64decode(t)))
    un32 = lambda t: list(__import__('struct').unpack(f'<{len(__import__("base64").b64decode(t)) // 4}I', __import__('base64').b64decode(t)))
    if kit.get('points'):
        xy = un16(kit['points']['xy'])
        for i, c in enumerate(kit['points']['kind']): S[sec(lat0 + xy[2 * i] * UNIT, lon0 + xy[2 * i + 1] * UNIT)]['p'] += [c, xy[2 * i], xy[2 * i + 1]]
    if kit.get('lots'):
        st, xy = un32(kit['lots']['starts']), un16(kit['lots']['xy'])
        for k in range(len(st) - 1):
            ring = [(xy[2 * i], xy[2 * i + 1]) for i in range(st[k], st[k + 1])]
            if ring: S[sec(lat0 + sum(p[0] for p in ring) / len(ring) * UNIT, lon0 + sum(p[1] for p in ring) / len(ring) * UNIT)]['l'].append(ring)
    if kit.get('lines'):
        st, xy = un32(kit['lines']['starts']), un16(kit['lines']['xy'])
        for k, c in enumerate(kit['lines']['kind']):
            pts = [(xy[2 * i], xy[2 * i + 1]) for i in range(st[k], st[k + 1])]
            if pts: m = pts[len(pts) // 2]; S[sec(lat0 + m[0] * UNIT, lon0 + m[1] * UNIT)]['n'].append((c, pts))
    folder = os.path.join(ROOT, f'routes/cities/{CITY}-city')
    os.makedirs(folder, exist_ok=True)
    for f in glob.glob(os.path.join(folder, '*.json')): os.remove(f)
    sectors = {}
    for key, d in S.items():
        bl = d['b']
        out_s = {
            'buildings': {'count': len(bl), 'h': pack_uint16([b['h'] * 10 for b in bl]), 'mh': pack_uint16([b['mh'] * 10 for b in bl]), 'kind': [b['kind'] for b in bl],
                          'starts': pack_uint32([0] + list(itertools.accumulate(len(b['ring']) for b in bl))), 'xy': pack_int16([v for b in bl for p in b['ring'] for v in p]),
                          'names': {str(k): b['name'] for k, b in enumerate(bl) if b['name']}},
            'trees': pack_int16(d['t']),
            'points': {'kind': d['p'][0::3], 'xy': pack_int16([v for i in range(0, len(d['p']), 3) for v in d['p'][i + 1:i + 3]])},
            'lots': {'starts': pack_uint32([0] + list(itertools.accumulate(len(r) for r in d['l']))), 'xy': pack_int16([v for r in d['l'] for p in r for v in p])},
            'lines': {'kind': [c for c, _ in d['n']], 'starts': pack_uint32([0] + list(itertools.accumulate(len(p) for _, p in d['n']))), 'xy': pack_int16([v for _, pts in d['n'] for p in pts for v in p])},
        }
        json.dump(out_s, open(os.path.join(folder, f's_{key}.json'), 'w'), separators=(',', ':'))
        sectors[key] = len(bl)
    # the land cover: raw codes, gzipped (the world inflates it: DecompressionStream)
    import gzip
    open(os.path.join(ROOT, f'routes/cities/{CITY}-land.bin.gz'), 'wb').write(gzip.compress(img.tobytes(), 9))
    out = {
        'format': 'bikefree-pgh-city-2',
        'attribution': 'Map data © OpenStreetMap contributors (ODbL)',
        'note': 'tools/pgh_city.py: the Pittsburgh map\'s city data over PGH (within 250 m of its ways), in sectors fetched as the rider nears them',
        'origin': [lat0, lon0], 'unit': UNIT, 'surfaces': SURF,
        'land': {'west': gw, 'south': gs, 'east': ge, 'north': gn, 'nx': lx, 'ny': ly, 'm': LAND_M, 'file': f'routes/cities/{CITY}-land.bin.gz'},
        'sectors': {'south': gs, 'west': gw, 'dlat': DLAT, 'dlon': DLON, 'folder': f'routes/cities/{CITY}-city', 'pointKinds': kit.get('pointKinds', []), 'lineKinds': kit.get('lineKinds', []), 'list': sectors},
        'edges': edges,
    }
    path = os.path.join(ROOT, f'routes/cities/{CITY}-city.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    tot = sum(os.path.getsize(f) for f in glob.glob(os.path.join(folder, '*.json')))
    print(f'  wrote routes/cities/{CITY}-city.json ({os.path.getsize(path) / 1e3:.0f} KB), {len(sectors)} sectors ({tot / 1e6:.1f} MB), '
          f'{CITY}-land.bin.gz ({os.path.getsize(os.path.join(ROOT, f"routes/cities/{CITY}-land.bin.gz")) / 1e3:.0f} KB): {len(kept)} buildings, {len(trees) // 2} trees')


if __name__ == '__main__':
    main()
