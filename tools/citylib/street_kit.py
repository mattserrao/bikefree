"""Street & facade detail kit: the OpenStreetMap details the kit places (js/world/toolbox/city/street-kit.js).

    data['streetKit'] = extract(nodes, ntags, ways, q, route_dist)

Everything is optional for the renderer: without it the kit falls back to its own placement rules.
Output ("bikefree-street-kit-1"), coordinates packed like the buildings ([qlat, qlon] Int16 pairs):
  points  {kind: [code…], xy}       street furniture mapped as nodes (signals, bus stops, benches, hydrants…)
  shops   {cat: [code…], xy}        storefronts mapped as nodes or small areas, by category (no names: no brands)
  lots    {starts, xy}              surface car parks (closed rings)
  lines   {kind: [code…], starts, xy}  fences, walls, hedges, retaining walls, guard rails
"""
import base64, struct

POINT_KINDS = ['signal', 'bus_stop', 'bench', 'hydrant', 'bike_rack', 'waste', 'picnic', 'post_box', 'drinking', 'bollard',
               'shelter', 'stop_sign', 'bike_share']
SHOP_CATS = ['food', 'bar', 'cafe', 'shop', 'service', 'bank', 'pharmacy']
LINE_KINDS = ['fence', 'wall', 'hedge', 'retaining_wall', 'guard_rail', 'jersey_barrier']


def _point_kind(t):
    h, a = t.get('highway'), t.get('amenity')
    if h == 'traffic_signals': return 'signal'
    if h == 'bus_stop' or (t.get('public_transport') == 'platform' and t.get('bus') == 'yes'): return 'bus_stop'
    if h == 'stop': return 'stop_sign'
    if a == 'bench' or t.get('leisure') == 'bench': return 'bench'
    if t.get('emergency') == 'fire_hydrant': return 'hydrant'
    if a == 'bicycle_parking': return 'bike_rack'
    if a == 'bicycle_rental': return 'bike_share'
    if a in ('waste_basket', 'recycling'): return 'waste'
    if t.get('leisure') == 'picnic_table': return 'picnic'
    if a == 'post_box': return 'post_box'
    if a == 'drinking_water': return 'drinking'
    if t.get('barrier') == 'bollard': return 'bollard'
    if a == 'shelter': return 'shelter'
    return None


def _shop_cat(t):
    a = t.get('amenity')
    if a in ('restaurant', 'fast_food', 'ice_cream', 'food_court'): return 'food'
    if a in ('bar', 'pub', 'nightclub', 'biergarten'): return 'bar'
    if a == 'cafe': return 'cafe'
    if a in ('bank', 'atm') and t.get('name'): return 'bank'
    if a == 'pharmacy' or t.get('shop') == 'chemist': return 'pharmacy'
    if t.get('shop'): return 'shop'
    if t.get('craft') or t.get('office') in ('company', 'estate_agent', 'lawyer', 'insurance') or a in ('dentist', 'doctors', 'clinic', 'veterinary'):
        return 'service'
    return None


def _b64(fmt, vals):
    return base64.b64encode(struct.pack(f'<{len(vals)}{fmt}', *vals)).decode()


def extract(nodes, ntags, ways, q, route_dist, radius=350, skip=None):
    """Street furniture, storefronts, car parks and fences within `radius` metres of the route (`skip(lat, lon)`:
    a cleared area — a hero model's footprint, `clearAreas` in the city config — keeps none of them)."""
    near = lambda la, lo: route_dist(la, lo, radius) < radius and not (skip and skip(la, lo))
    pk, pxy, sc, sxy = [], [], [], []
    for i, t in ntags.items():
        if i not in nodes: continue
        la, lo = nodes[i]
        kind, cat = _point_kind(t), _shop_cat(t)
        if not (kind or cat) or not near(la, lo): continue
        if kind: pk.append(POINT_KINDS.index(kind)); pxy += q(la, lo)
        if cat: sc.append(SHOP_CATS.index(cat)); sxy += q(la, lo)
    lots, lines = [], []
    for nd, t in ways.values():
        nd = [i for i in nd if i in nodes]
        if len(nd) < 2: continue
        pts = [nodes[i] for i in nd]
        if not any(near(*p) for p in pts[::max(1, len(pts) // 4)] + [pts[-1]]): continue
        if skip and any(skip(*p) for p in pts): continue
        closed = nd[0] == nd[-1] and len(nd) >= 4
        cat = _shop_cat(t)
        if cat and closed and t.get('building') is None and len(nd) < 40:   # a shop drawn as a small area
            sc.append(SHOP_CATS.index(cat)); sxy += q(sum(p[0] for p in pts[:-1]) / (len(pts) - 1), sum(p[1] for p in pts[:-1]) / (len(pts) - 1))
        if t.get('amenity') == 'parking' and closed and t.get('parking', 'surface') == 'surface' and t.get('building') is None:
            lots.append(pts[:-1])
        b = t.get('barrier')
        if b in LINE_KINDS: lines.append((LINE_KINDS.index(b), pts))
    def pack(rings):
        starts, xy = [0], []
        for r in rings:
            for p in r: xy += q(*p)
            starts.append(len(xy) // 2)
        return {'starts': _b64('I', starts), 'xy': _b64('h', xy)}
    out = {
        'format': 'bikefree-street-kit-1',
        'pointKinds': POINT_KINDS, 'shopCats': SHOP_CATS, 'lineKinds': LINE_KINDS,
        'points': {'kind': pk, 'xy': _b64('h', pxy)},
        'shops': {'cat': sc, 'xy': _b64('h', sxy)},
        'lots': pack(lots),
        'lines': {'kind': [k for k, _ in lines], **pack([p for _, p in lines])},
    }
    print(f'  street kit: {len(pk)} furniture points, {len(sc)} storefronts, {len(lots)} car parks, {len(lines)} fences/walls')
    return out
