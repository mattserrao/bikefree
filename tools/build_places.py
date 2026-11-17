#!/usr/bin/env python3
"""Bake the real places along a route from OpenStreetMap, for the real-place toolbox kits.

  python3 tools/fetch_osm_corridor.py <id>      # first: the map data in the corridor
  python3 tools/build_places.py <id>            # then: routes/scenes/<id>-places.bin.gz

Reads   tools/.cache/osm-<id>/features.json, routes/parks/<id>.gpx, routes/scenes/<id>.json ("places": settings)
Writes  routes/scenes/<id>-places.bin.gz ("bikefree-places-1", the BFTG container of js/terrain-grid.js):
  landcover   a 20 m class grid over the mapped corridor (uint8 rows, raw bytes):
                0 unknown · 1 broadleaf wood · 2 conifer wood · 3 mixed wood · 4 meadow/grass · 5 farmland
                6 scrub/heath · 7 bare rock · 8 scree · 9 glacier · 10 built-up · 11 water · 12 orchard · 13 pasture
              read by landscape/real-terrain.js (vegetation: forest where the map has woods, open where it has
              meadows, farmland and rock)
  buildings   footprints within `buildingsM` of the road, sorted along it:
              [lat, lon, [dx, dz, …] (decimetres from the centre, x east, z south), levels, kind, roof, height,
               metres along the route, metres off it, (name: churches, chapels, hotels, public)]
              read by structures/footprints.js
  lifts       aerialways within `liftsM`: { kind, pts: [[lat, lon]…] }, read by structures/resort.js
  power       power lines within `powerM` of the road: { kind, pts }, read by structures/cables.js (poles and wires)
  dams        dams within 1.5 km of the road: { name, pts }, read by structures/dam.js

Settings ("places" in the scene): buildingsM (400), liftsM (3000), powerM (300), landcoverCellM (20).
Data © OpenStreetMap contributors (ODbL).
"""
import base64, gzip, json, math, os, re, struct, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from fetch_osm_corridor import route_points, RouteIndex, hv  # noqa: E402

KINDS = ['house', 'farm', 'barn', 'shed', 'church', 'chapel', 'apartments', 'hotel', 'commercial', 'public', 'garage', 'industrial', 'chalet', 'ruin']
ROOFS = ['gabled', 'hipped', 'flat', 'pyramidal', 'skillion']
LC = {'broadleaved': 1, 'needleleaved': 2, 'mixed': 3}


def kind_of(t):
    b = t.get('building', 'yes')
    if b in ('church', 'cathedral') or (t.get('amenity') == 'place_of_worship' and b != 'chapel'):
        return 'church'
    if b == 'chapel':
        return 'chapel'
    if b in ('apartments', 'residential', 'dormitory'):
        return 'apartments'
    if b == 'hotel' or t.get('tourism') in ('hotel', 'chalet', 'apartment', 'hostel'):
        return 'hotel'
    if b in ('farm', 'farm_auxiliary'):
        return 'farm'
    if b in ('barn', 'stable', 'cowshed', 'sty'):
        return 'barn'
    if b in ('shed', 'hut', 'cabin', 'roof', 'carport', 'kiosk', 'service', 'transformer_tower'):
        return 'shed'
    if b in ('garage', 'garages'):
        return 'garage'
    if b in ('commercial', 'retail', 'supermarket', 'office'):
        return 'commercial'
    if b in ('public', 'school', 'civic', 'government', 'townhall', 'train_station', 'hospital', 'sports_hall', 'gymnasium'):
        return 'public'
    if b in ('industrial', 'warehouse', 'factory'):
        return 'industrial'
    if b == 'ruins':
        return 'ruin'
    return 'house'


def landcover_class(t):
    lu, nat, lei = t.get('landuse'), t.get('natural'), t.get('leisure')
    if lu == 'forest' or nat == 'wood':
        return LC.get(t.get('leaf_type'), 3)
    if nat == 'glacier':
        return 9
    if nat == 'scree' or nat == 'shingle':
        return 8
    if nat in ('bare_rock', 'cliff', 'rock'):
        return 7
    if nat in ('scrub', 'heath'):
        return 6
    if nat == 'water' or t.get('water'):
        return 11
    if lu in ('residential', 'commercial', 'industrial', 'retail', 'construction', 'garages', 'railway') or t.get('amenity') == 'parking':
        return 10
    if lu in ('orchard', 'vineyard'):
        return 12
    if lu in ('meadow', 'grass', 'village_green', 'recreation_ground') or nat == 'grassland' or lei in ('park', 'golf_course', 'pitch'):
        return 4
    if lu == 'farmland':
        return 5
    if lu == 'pasture' or nat == 'fell':
        return 13
    return 0


# draw order: broad covers first, then the specific (a meadow inside a wood, a village inside farmland)
ORDER = [3, 1, 2, 13, 5, 4, 12, 6, 8, 7, 9, 10, 11]


def simplify(ring, tol):
    """Douglas–Peucker on a closed ring of (x, z) metres (first point repeated at the end). Returns the open ring."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    if len(pts) <= 4:
        return pts
    def dp(chain):
        if len(chain) < 3:
            return chain
        (ax, az), (bx, bz) = chain[0], chain[-1]
        L = math.hypot(bx - ax, bz - az) or 1e-9
        best, bi = -1, 0
        for i in range(1, len(chain) - 1):
            px, pz = chain[i]
            d = abs((bx - ax) * (pz - az) - (bz - az) * (px - ax)) / L
            if d > best:
                best, bi = d, i
        if best < tol:
            return [chain[0], chain[-1]]
        return dp(chain[:bi + 1])[:-1] + dp(chain[bi:])
    # split the ring at the point farthest from the first
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = dp(pts[:far + 1])
    b = dp(pts[far:] + [pts[0]])
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else pts


def main():
    rid = sys.argv[1]
    scene = json.load(open(os.path.join(ROOT, 'routes', 'scenes', f'{rid}.json')))
    cfg = {'buildingsM': 400, 'liftsM': 3000, 'powerM': 300, 'landcoverCellM': 20, **scene.get('places', {})}
    feat = json.load(open(os.path.join(ROOT, 'tools', '.cache', f'osm-{rid}', 'features.json')))
    pts = route_points(rid)
    idx = RouteIndex(pts)
    lat0 = sum(p[0] for p in pts) / len(pts)
    mlat, mlon = 110540.0, 111320.0 * math.cos(math.radians(lat0))

    # ---- land cover: a 20 m grid over the corridor box
    corridor = scene.get('osm', {}).get('corridorM', 1500)
    north = max(p[0] for p in pts) + corridor / mlat
    south = min(p[0] for p in pts) - corridor / mlat
    west = min(p[1] for p in pts) - corridor / mlon
    east = max(p[1] for p in pts) + corridor / mlon
    cell = cfg['landcoverCellM']
    nx, ny = int((east - west) * mlon / cell) + 1, int((north - south) * mlat / cell) + 1
    img = Image.new('L', (nx, ny), 0)
    draw = ImageDraw.Draw(img)
    to_px = lambda la, lo: ((lo - west) * mlon / cell, (north - la) * mlat / cell)
    by_class = {}
    for a in feat['areas']:
        c = landcover_class(a['tags'])
        if c:
            by_class.setdefault(c, []).append(a['ring'])
    for c in ORDER:
        for ring in by_class.get(c, []):
            draw.polygon([to_px(la, lo) for la, lo in ring], fill=c)
    # built-up under every building too (hamlets without a mapped residential area)
    for b in feat['buildings']:
        draw.polygon([to_px(la, lo) for la, lo in b['ring']], fill=10)
    lc = np.asarray(img, dtype=np.uint8)
    # outside the fetched corridor the map says nothing: unknown
    mask = Image.new('L', (nx, ny), 0)
    md = ImageDraw.Draw(mask)
    r = corridor / cell
    for la, lo in pts[::20]:
        x, y = to_px(la, lo)
        md.ellipse([x - r, y - r, x + r, y + r], fill=1)
    lc = np.where(np.asarray(mask) > 0, lc, 0).astype(np.uint8)
    counts = np.bincount(lc.ravel(), minlength=14)
    names = ['unknown', 'broadleaf', 'conifer', 'mixed', 'meadow', 'farmland', 'scrub', 'rock', 'scree', 'glacier', 'built', 'water', 'orchard', 'pasture']
    known = counts[1:].sum() or 1
    print(f'{rid}: land cover {nx}×{ny} @ {cell} m; ' + ', '.join(f'{names[i]} {counts[i] / known * 100:.0f}%' for i in range(1, 14) if counts[i]))

    # ---- buildings near the road
    buildings = []
    for b in feat['buildings']:
        ring = b['ring']
        la = sum(p[0] for p in ring[:-1]) / max(1, len(ring) - 1)
        lo = sum(p[1] for p in ring[:-1]) / max(1, len(ring) - 1)
        s, d = idx.near(la, lo, 3)
        if s is None or d > cfg['buildingsM']:
            continue
        xy = [((p[1] - lo) * mlon, (la - p[0]) * mlat) for p in ring]   # x east, z south
        area = 0.5 * abs(sum(x0 * z1 - x1 * z0 for (x0, z0), (x1, z1) in zip(xy, xy[1:])))
        if area < 6:
            continue
        poly = simplify(xy, .6 if area < 400 else 1.2)
        t = b['tags']
        kind = kind_of(t)
        lv = t.get('building:levels')
        try:
            lv = max(1, min(20, int(float(lv))))
        except (TypeError, ValueError):
            lv = 0
        hgt = t.get('height')
        try:
            hgt = round(float(str(hgt).replace('m', '').strip()), 1)
        except (TypeError, ValueError):
            hgt = 0
        roof = t.get('roof:shape')
        roof = ROOFS.index(roof) if roof in ROOFS else -1
        entry = [round(la, 6), round(lo, 6), [round(c * 10) for xz in poly for c in xz], lv, KINDS.index(kind), roof, hgt, round(s), round(d)]
        if t.get('name') and kind in ('church', 'chapel', 'hotel', 'public'):
            entry.append(t['name'])
        buildings.append(entry)
    buildings.sort(key=lambda e: e[7])
    print(f'  {len(buildings)} buildings within {cfg["buildingsM"]} m of the road; kinds ' +
          ', '.join(f'{k} {sum(1 for e in buildings if e[4] == i)}' for i, k in enumerate(KINDS) if any(e[4] == i for e in buildings)))

    # ---- lifts and power lines
    lifts, power = [], []
    for l in feat['lines']:
        t = l['tags']
        p = l['pts']
        if 'aerialway' in t and t['aerialway'] not in ('station', 'pylon', 'zip_line', 'goods'):
            near = min(idx.near(a, b, 16)[1] or 1e9 for a, b in p[::max(1, len(p) // 6)])
            if near < cfg['liftsM']:
                lifts.append({'kind': t['aerialway'], 'name': t.get('name', ''), 'pts': [[round(a, 6), round(b, 6)] for a, b in p]})
        if t.get('power') in ('line', 'minor_line'):
            near = min(idx.near(a, b, 3)[1] or 1e9 for a, b in p[::max(1, len(p) // 8)])
            if near < cfg['powerM']:
                power.append({'kind': t['power'], 'pts': [[round(a, 6), round(b, 6)] for a, b in p]})
    dams = []
    for l in feat['lines']:
        t = l['tags']
        if t.get('waterway') == 'dam' or t.get('man_made') == 'dam':
            p = l['pts']
            near = min(idx.near(a, b, 16)[1] or 1e9 for a, b in p)
            if near < 1500 and len(p) >= 2:
                dams.append({'name': t.get('name', ''), 'pts': [[round(a, 6), round(b, 6)] for a, b in p]})
    print(f'  {len(lifts)} lifts, {len(power)} power lines, {len(dams)} dams')

    header = {
        'format': 'bikefree-places-1', 'attribution': 'Data © OpenStreetMap contributors (ODbL)',
        'kinds': KINDS, 'roofs': ROOFS, 'landcoverClasses': names,
        'landcover': {'north': north, 'south': south, 'west': west, 'east': east, 'cellM': cell, 'nx': nx, 'ny': ny, 'mlat': mlat, 'mlon': mlon,
                      'h': base64.b64encode(lc.tobytes()).decode()},
        'buildings': buildings, 'lifts': lifts, 'power': power, 'dams': dams,
    }
    blob = base64.b64decode(header['landcover']['h'])
    header['landcover']['h'] = {'$bin': [0, len(blob)]}
    js = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
    pad = (4 - (8 + len(js)) % 4) % 4
    data = gzip.compress(b'BFTG' + struct.pack('<I', len(js)) + js + b'\0' * pad + blob, 9)
    out = os.path.join(ROOT, 'routes', 'scenes', f'{rid}-places.bin.gz')
    open(out, 'wb').write(data)
    print(f'  wrote {os.path.relpath(out, ROOT)} ({len(data) / 1e6:.2f} MB)')


if __name__ == '__main__':
    main()
