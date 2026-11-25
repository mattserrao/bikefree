#!/usr/bin/env python3
"""Camillus Forest Unique Area on CNY (user, 24 Nov 2026: "Camillus unique area - captured in the understory - riding
through lush meadows … On CNY map add Camillus Forest Unique Area … push the tree engine here"; plan in the bikefree
Project doc claude/camillus-forest.md and PLAN.md "Camillus Forest Unique Area").

Run after the CNY graph, city data and landmarks are built (npm run cny:build runs it before the routes):

    python3 tools/cny_forest.py            # adds the trails, the Thompson Road junction, the land, the hero data
    python3 tools/cny_forest.py --check    # what it would do, writing nothing

What it does:
  1. the Unique Area's numbered trails (#1–#8, OSM; the detours and stubs left out) join the CNY graph as narrow dirt
     singletrack (kind 'path', 0.9 m: city edge data w / s / cf), their heights the ground grid's own (they lie on the
     ground), chained between their junctions;
  2. a junction on Thompson Road at the lot (user: "Ensure this trail starts and ends on the main road so a user could
     turn from a different route and use it"): Thompson Road's edge is split there, the trail runs in past the lot;
     the presets that ride Thompson Road get both halves;
  3. the land inside the Unique Area's boundary (routes/cities/cny-land.bin.gz): 30 old-growth woods (the high
     sugar maple–beech stand, ~150–160 years old, DEC), 31 the other woods, 32 the old fields (tall hay-coloured
     grass), 33 the 1998 Labor Day blowdown (12 acres of the old forest lost their overstory), from ESA WorldCover
     and the terrain;
  4. routes/cities/cny-oldgrowth.json: the boundary, the trail edges, the green tunnel and the old apple trees, for
     the hero area's dressing (js/world/toolbox/vegetation/old-growth.js), named in cny.json as "oldGrowth".

Idempotent: a second run first takes out what the first added (the trails, the junction; Thompson Road joined again).
Data © OpenStreetMap contributors (ODbL); land cover © ESA WorldCover 2021 (CC BY 4.0); elevation AWS Terrain Tiles.
"""
import gzip, json, math, os, struct, sys, urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache', 'cny-forest')
GRAPH = os.path.join(ROOT, 'routes', 'cities', 'cny.json')
CITY = os.path.join(ROOT, 'routes', 'cities', 'cny-city.json')
OUT = 'routes/cities/cny-oldgrowth.json'
BBOX = (-76.292, 43.058, -76.262, 43.082)   # w, s, e, n
STEP = 10
BOUNDARY_WAY = '429408002'                 # Camillus Forest Unique Area (leisure=nature_reserve)
TRAILHEAD = '2256216350'                   # Trail #1 at the DEC lot on Thompson Road
LOT_EXIT = (43.0700714, -76.2770795)       # the lot's aisle toward the road
ROAD_NAME = 'Thompson Road'                # the junction goes on its nearest sample to the lot
SKIP_WAYS = {'739107573', '739107574'}     # "Trail #6 Detour" (two short reroutes)
TRAIL_W = 0.9                              # m: the singletrack's tread (user: "the bike trail is narrow throughout")
# land codes (js/world/graph-city.js LAND: oldGrowth 30, forest 31, meadow 32, blowdown 33)
OLD, FOREST, MEADOW, BLOW = 30, 31, 32, 33
# the 1998 blowdown: 12 acres (4.9 ha) of the old forest, beside Trail #5's run through it (km ~2.2 of the ride)
BLOWDOWN = {'center': (43.0664, -76.2928), 'r': (150, 95), 'rot': 1.35}
# the green tunnel (user's loop, section ⑤: Trail #2 between two rows of trees across the meadow)
TUNNEL = {'trail': '2', 'from': '13112735580', 'to': '1627091229'}
# the god rays' places (user, 24 Nov: "Reduce the number of areas with god rays" → 3–5 hero spots): the blowdown's gap,
# and four openings in the canopy over the ride — up Trail #6 into the old growth, the far west and the east of the north
# woods on #4, and the lower woods on #1. [lat, lon, radius m]
RAYS = [[43.0664, -76.2928, 30], [43.064294, -76.28807, 18], [43.070462, -76.295364, 18], [43.072805, -76.284297, 18], [43.069379, -76.280387, 16]]
# the old apple orchard (DEC: ~100 old apple trees on 5 acres): scattered on the high meadow by Trails #5 / #1
ORCHARD = {'center': (43.0682, -76.2852), 'r': 85, 'n': 26}
CHECK = '--check' in sys.argv

KX = 111320 * math.cos(math.radians(43.07)); KY = 110540
def dist(a, b): return math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX)


def fetch_osm():
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, 'osm.xml')
    if not os.path.exists(path):
        w, s, e, n = BBOX
        url = f'https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}'
        print(f'  fetching {url}')
        data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'bikefree/1.0 (map build)'}), timeout=300).read()
        open(path, 'wb').write(data)
    r = ET.parse(path).getroot()
    nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in r.iter('node')}
    ways = {}
    for w in r.iter('way'):
        ways[w.get('id')] = ([nd.get('ref') for nd in w.iter('nd')], {t.get('k'): t.get('v') for t in w.iter('tag')})
    return nodes, ways


# ---------------------------------------------------------------- ground (the graph's own grid: the trail lies on it)
def ground_sampler():
    raw = gzip.decompress(open(os.path.join(ROOT, 'routes/cities/cny-ground.grid.bin.gz'), 'rb').read())
    L = struct.unpack('<I', raw[4:8])[0]; H = json.loads(raw[8:8 + L]); start = 8 + L + (4 - (8 + L) % 4) % 4
    C = H['coarse']; nx, ny = C['nx'], C['ny']; o, ln = C['h']['$bin']
    d = np.frombuffer(raw[start + o:start + o + ln], dtype='<u2').reshape(ny, nx).astype(np.int64)
    h = (np.cumsum(d, axis=1) & 0xffff) * H['scale'] + H['base']
    N, W_, S, E = H['north'], H['west'], H['south'], H['east']
    def at(lat, lon):
        u = (lon - W_) / (E - W_) * (nx - 1); v = (N - lat) / (N - S) * (ny - 1)
        i, j = int(u), int(v); a, b = u - i, v - j
        return (h[j, i] * (1 - a) + h[j, i + 1] * a) * (1 - b) + (h[j + 1, i] * (1 - a) + h[j + 1, i + 1] * a) * b
    return at


def ease_turns(P, limit=22, rounds=4):
    """No corner sharper than `limit`° a 10 m sample (a ~26 m radius: a hairpin is drawn and ridden as a curve, not a
    kink): a too-sharp sample is drawn toward its neighbours' middle, again and again, then the line is resampled."""
    def turn(P, k):
        a = math.atan2((P[k][1] - P[k - 1][1]) * KX, (P[k][0] - P[k - 1][0]) * KY); b = math.atan2((P[k + 1][1] - P[k][1]) * KX, (P[k + 1][0] - P[k][0]) * KY)
        return abs((b - a + math.pi) % (2 * math.pi) - math.pi) * 180 / math.pi
    for _ in range(rounds):
        P = list(P)
        for _ in range(40):
            moved = False
            for k in range(1, len(P) - 1):
                if turn(P, k) > limit:
                    P[k] = (P[k][0] * .5 + (P[k - 1][0] + P[k + 1][0]) * .25, P[k][1] * .5 + (P[k - 1][1] + P[k + 1][1]) * .25); moved = True
            if not moved: break
        P = resample(P)
    return P


def gauss_smooth(P, sigma=7.0):
    """The mapped line's wiggles (GPS traces zig-zag every few metres) taken out: a Gaussian along the line (σ in m;
    P evenly spaced), the ends held — so on the 10 m samples a singletrack turns a few degrees a sample, not 20–40°
    (user, 24 Nov: "Bike is sliding. Ensure turns on the bike path are smoother and not jagged")."""
    n = len(P)
    if n < 5: return P
    step = dist(P[0], P[1]) or 2.0
    r = max(1, int(round(3 * sigma / step))); w = [math.exp(-0.5 * (k * step / sigma) ** 2) for k in range(-r, r + 1)]
    out = [P[0]]
    for i in range(1, n - 1):
        # the window shrinks toward the ends (symmetric), so an end and its tangent stay put
        rr = min(r, i, n - 1 - i); ws = w[r - rr:r + rr + 1]; t = sum(ws)
        out.append((sum(P[i + k][0] * ws[k + rr] for k in range(-rr, rr + 1)) / t, sum(P[i + k][1] * ws[k + rr] for k in range(-rr, rr + 1)) / t))
    out.append(P[-1])
    return out


def resample(P, step=None):
    STEP_ = step or STEP
    cum = [0.0]
    for a, b in zip(P, P[1:]): cum.append(cum[-1] + dist(a, b))
    L = cum[-1]; n = max(1, round(L / STEP_)); out, j = [], 0
    for i in range(n + 1):
        d = L * i / n
        while j < len(P) - 2 and cum[j + 1] < d: j += 1
        f = 0 if cum[j + 1] == cum[j] else min(1, max(0, (d - cum[j]) / (cum[j + 1] - cum[j])))
        out.append((P[j][0] + (P[j + 1][0] - P[j][0]) * f, P[j][1] + (P[j + 1][1] - P[j][1]) * f))
    return out


def chaikin(P, n=2):
    """Round a polyline's corners (the mapped trail's 2–5 m kinks), its ends kept."""
    for _ in range(n):
        Q = [P[0]]
        for a, b in zip(P, P[1:]): Q += [(a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25), (a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75)]
        Q.append(P[-1]); P = Q
    return P


def smooth_ele(h, w=3, cap=.16):
    """The trail's heights: the ground's, smoothed over ±w samples (the 20 m grid's facets and a gully's lip) and held
    to ≤ cap a sample step either way (a singletrack winds up a bank rather than straight at it), ends kept."""
    n = len(h); out = list(h)
    if n > 2:
        for k in range(1, n - 1):
            a, b = max(0, k - w), min(n, k + w + 1); out[k] = sum(h[a:b]) / (b - a)
        for _ in range(8):
            for k in range(1, n):
                d = out[k] - out[k - 1]
                if abs(d) > cap * STEP: out[k] = out[k - 1] + math.copysign(cap * STEP, d)
            out[-1] = h[-1]
            for k in range(n - 2, -1, -1):
                d = out[k] - out[k + 1]
                if abs(d) > cap * STEP: out[k] = out[k + 1] + math.copysign(cap * STEP, d)
            out[0] = h[0]
    return out


def undelta(a, k):
    out, acc = [], 0
    for v in a: acc += v; out.append(acc * k)
    return out


def delta(vals, k):
    out, prev = [], 0
    for v in vals:
        q = int(round(v / k)); out.append(q - prev); prev = q
    return out


def encode_edge(eid, a, b, name, kind, P, ele, bridges=None):
    return {'id': eid, 'from': a, 'to': b, 'name': name, 'kind': kind, 'lat': delta([p[0] for p in P], 1e-6), 'lon': delta([p[1] for p in P], 1e-6),
            'ele': delta(ele, .1), **({'bridges': bridges} if bridges else {})}


def main():
    G = json.load(open(GRAPH)); C = json.load(open(CITY))
    at = ground_sampler()
    # ---- 0. a second run: take out the first run's trails and junction, join Thompson Road again
    old = [e for e in G['edges'] if C['edges'].get(e['id'], {}).get('cf')]
    if old:
        drop = {e['id'] for e in old}
        G['edges'] = [e for e in G['edges'] if e['id'] not in drop]
        for k in drop: C['edges'].pop(k, None)
        jn = next((n for n in G['nodes'] if n.get('cf') == 'junction'), None)
        if jn:
            a = next(e for e in G['edges'] if e['to'] == jn['id']); b = next(e for e in G['edges'] if e['from'] == jn['id'])
            ROAD_EDGE = a['id']
            la, lo, el = undelta(a['lat'], 1e-6), undelta(a['lon'], 1e-6), undelta(a['ele'], .1)
            lb, ob, eb = undelta(b['lat'], 1e-6), undelta(b['lon'], 1e-6), undelta(b['ele'], .1)
            n_a = len(la) - 1
            a.update(lat=delta(la + lb[1:], 1e-6), lon=delta(lo + ob[1:], 1e-6), ele=delta(el + eb[1:], .1), to=b['to'])
            if b.get('bridges'): a['bridges'] = (a.get('bridges') or []) + [[p + n_a, q + n_a] for p, q in b['bridges']]
            G['edges'] = [e for e in G['edges'] if e['id'] != b['id']]
            sa = C['edges'].get(ROAD_EDGE, {}); sb = C['edges'].pop(b['id'], {})
            if sb.get('s'): sa['s'] = (sa.get('s') or []) + [[p + n_a, q + n_a, c] for p, q, c in sb['s']]
            for p in G.get('presets', []): p['path'] = [x for x in p['path'] if x[:-1] != b['id']]
        G['nodes'] = [n for n in G['nodes'] if not n.get('cf')]
        print(f'  took out the last run: {len(drop)} trail edges' + (', the Thompson Road junction' if jn else ''))

    nodes, ways = fetch_osm()
    # ---- 1. the trails: the numbered ways, cut at their junctions, chained between nodes of degree ≠ 2
    trails = []
    for wid, (refs, t) in ways.items():
        nm = t.get('name', '')
        if wid in SKIP_WAYS or t.get('highway') not in ('footway', 'path') or 'Unique Area' not in nm: continue
        trails.append((nm.split('#')[-1].strip(), [r for r in refs if r in nodes]))
    use = Counter(r for _, refs in trails for r in refs)
    ends = Counter(refs[i] for _, refs in trails for i in (0, -1))
    J = {r for r, c in use.items() if c > 1} | set(ends)
    segs = []
    for num, refs in trails:
        cur = [refs[0]]
        for r in refs[1:]:
            cur.append(r)
            if r in J: segs.append((num, cur)); cur = [r]
    adj = defaultdict(list)
    for k, (num, s) in enumerate(segs): adj[s[0]].append(k); adj[s[-1]].append(k)
    # (drop dead-end stubs: a segment with a free end, other than at the trailhead, peeled until none is left)
    gone = set()
    while True:
        deg = Counter(); [deg.update([segs[k][1][0], segs[k][1][-1]]) for k in range(len(segs)) if k not in gone]
        peel = [k for k in range(len(segs)) if k not in gone and any(deg[x] == 1 and x != TRAILHEAD for x in (segs[k][1][0], segs[k][1][-1]))]
        if not peel: break
        gone.update(peel)
    deg = Counter(); [deg.update([segs[k][1][0], segs[k][1][-1]]) for k in range(len(segs)) if k not in gone]
    junctions = {x for x, d in deg.items() if d != 2} | {TRAILHEAD}
    used, chains = set(), []
    for k in range(len(segs)):
        if k in gone or k in used: continue
        # walk both ways to the chain's junctions
        num, s = segs[k]; used.add(k); refs, nums = list(s), [(num, len(s))]
        for forward in (True, False):
            while True:
                end = refs[-1] if forward else refs[0]
                if end in junctions: break
                nxt = [q for q in adj[end] if q not in used and q not in gone]
                if not nxt: break
                q = nxt[0]; used.add(q); n2, s2 = segs[q]
                nums.append((n2, len(s2)))
                if forward: refs = refs + (s2 if s2[0] == end else s2[::-1])[1:]
                else: refs = (s2 if s2[-1] == end else s2[::-1])[:-1] + refs
        cnt = Counter()
        for n_, l_ in nums: cnt[n_] += l_
        chains.append((refs, cnt))
    print(f'  (deg: {Counter(deg.values())})')
    print(f'  trails: {len(segs) - len(gone)} segments ({len(gone)} stubs left out) → {len(chains)} edges between {len(junctions)} junctions')

    # ---- 2. Thompson Road: split at the lot
    best = None
    for e in G['edges']:
        if e['name'] != ROAD_NAME: continue
        la_, lo_ = undelta(e['lat'], 1e-6), undelta(e['lon'], 1e-6)
        for k in range(3, len(la_) - 3):
            dd = dist((la_[k], lo_[k]), LOT_EXIT)
            if not best or dd < best[0]: best = (dd, e, k)
    _, road, i = best
    ROAD_EDGE = road['id']
    rla, rlo, rel = undelta(road['lat'], 1e-6), undelta(road['lon'], 1e-6), undelta(road['ele'], .1)
    jid = f'n{max(int(n["id"][1:]) for n in G["nodes"]) + 1}'
    eids = iter(f'e{k}' for k in range(max(int(e['id'][1:]) for e in G['edges']) + 1, 10 ** 6))
    road_b = next(eids)
    jn = {'id': jid, 'name': 'Thompson Road & Camillus Forest', 'lat': round(rla[i], 6), 'lon': round(rlo[i], 6), 'ele': round(rel[i], 1), 'cf': 'junction'}
    eb = encode_edge(road_b, jid, road['to'], road['name'], road['kind'], list(zip(rla[i:], rlo[i:])), rel[i:],
                     [[p - i, q - i] for p, q in road.get('bridges', []) if p >= i])
    road.update(lat=delta(rla[:i + 1], 1e-6), lon=delta(rlo[:i + 1], 1e-6), ele=delta(rel[:i + 1], .1), to=jid)
    if road.get('bridges'): road['bridges'] = [[p, min(q, i)] for p, q in road['bridges'] if p < i]
    sd = C['edges'].get(ROAD_EDGE, {})
    if sd.get('s'):
        runs = sd['s']; sd['s'] = [[p, min(q, i), c] for p, q, c in runs if p <= i]
        C['edges'][road_b] = {**{k: v for k, v in sd.items() if k != 's'}, 's': [[max(0, p - i), q - i, c] for p, q, c in runs if q >= i]}
    else: C['edges'][road_b] = dict(sd)
    for p in G.get('presets', []):
        out = []
        for x in p['path']:
            if x == ROAD_EDGE + '+': out += [x, road_b + '+']
            elif x == ROAD_EDGE + '-': out += [road_b + '-', x]
            else: out.append(x)
        p['path'] = out
    print(f'  Thompson Road ({ROAD_EDGE}) split at sample {i} of {len(rla) - 1}: junction {jid}, second half {road_b}')

    # ---- the trail edges (the trailhead's runs in from the road junction past the lot)
    nid = {}
    def node_for(ref):
        if ref not in nid:
            k = f'n{max(int(n["id"][1:]) for n in G["nodes"] + [jn]) + 1 + len(nid)}'
            nid[ref] = k
        return nid[ref]
    new_nodes, new_edges, cf_edges = [], [], []
    lot = [(rla[i], rlo[i]), LOT_EXIT]
    for refs, nums in chains:
        P = [nodes[r] for r in refs]
        if refs[-1] == TRAILHEAD: refs, P = refs[::-1], P[::-1]
        a = jid if refs[0] == TRAILHEAD else node_for(refs[0]); b = node_for(refs[-1])
        if refs[0] == TRAILHEAD: P = lot + P
        P = ease_turns(resample(gauss_smooth(resample(chaikin(P), 2.0), sigma=7.0)))
        ele = smooth_ele([at(la, lo) for la, lo in P])
        num = nums.most_common(1)[0][0]
        eid = next(eids)
        new_edges.append(encode_edge(eid, a, b, f'Camillus Forest Trail #{num}', 'path', P, ele))
        n = len(P) - 1
        C['edges'][eid] = {'lanes': 0, 'walk': 0, 'w': TRAIL_W, 's': [[0, n, C['surfaces'].index('dirt')]], 'cf': 1}
        g = max(abs(ele[k + 1] - ele[k]) / STEP for k in range(n)) * 100
        cf_edges.append({'id': eid, 'trail': num, 'len': n * STEP, 'maxGrade': round(g, 1)})
        hd = [math.atan2((P[k + 1][1] - P[k][1]) * KX, (P[k + 1][0] - P[k][0]) * KY) for k in range(n)]
        turn = max([abs((hd[k + 1] - hd[k] + math.pi) % (2 * math.pi) - math.pi) for k in range(n - 1)] or [0]) * 180 / math.pi
        cf_edges[-1]['maxTurn'] = round(turn, 1)
        if '-v' in sys.argv: print(f'    {eid} #{num} {a}→{b} {n * STEP} m, sharpest {turn:.0f}°/sample, {ele[0]:.0f}→{ele[-1]:.0f} m, steepest {g:.1f} %, max off ground {max(abs(x - at(*q)) for x, q in zip(ele, P)):.1f} m')
    for ref, k in nid.items():
        la, lo = nodes[ref]
        new_nodes.append({'id': k, 'name': 'Camillus Forest trail junction', 'lat': round(la, 6), 'lon': round(lo, 6), 'ele': round(at(la, lo), 1), 'cf': 'trail'})
    # (the graph's nodes get no extra fields beyond these: decodeGraph keeps what it needs)
    G['nodes'] += [jn] + new_nodes
    G['edges'] += [eb] + new_edges
    print(f'  {len(new_edges)} trail edges, {sum(e["len"] for e in cf_edges) / 1000:.2f} km, steepest {max(e["maxGrade"] for e in cf_edges)} %, sharpest turn {max(e["maxTurn"] for e in cf_edges)}°/10 m')

    # ---- 3. the land inside the boundary
    land = C['land']; lx, ly = land['nx'], land['ny']
    L = np.frombuffer(gzip.decompress(open(os.path.join(ROOT, land['file']), 'rb').read()), np.uint8).reshape(ly, lx).copy()
    bref, _ = ways[BOUNDARY_WAY]; ring = [nodes[r] for r in bref]
    from PIL import Image, ImageDraw
    pix = lambda la, lo: ((lo - land['west']) / (land['east'] - land['west']) * (lx - 1), (land['north'] - la) / (land['north'] - land['south']) * (ly - 1))
    im = Image.new('L', (lx, ly), 0); ImageDraw.Draw(im).polygon([pix(*p) for p in ring], fill=1)
    inside = np.asarray(im) > 0
    from citylib.landcover import worldcover_window
    w_, s_, e_, n_ = BBOX
    _, wc = worldcover_window(s_, w_, n_, e_)
    jj, ii = np.nonzero(inside)
    lat = land['north'] - jj / (ly - 1) * (land['north'] - land['south']); lon = land['west'] + ii / (lx - 1) * (land['east'] - land['west'])
    c = wc(lat, lon)
    hgt = np.array([at(a, b) for a, b in zip(lat, lon)])
    keep = np.isin(L[jj, ii], (3, 4))   # water and buildings stay
    code = np.where(c == 10, FOREST, np.where(np.isin(c, (20, 30, 40, 60)), MEADOW, L[jj, ii]))
    # the old forest: the high woods to the west (DEC: ~700 ft, the sugar maple–beech stand)
    code = np.where((code == FOREST) & (hgt > 203) & (lon < -76.2835), OLD, code)
    bc, (ra, rb), rot = BLOWDOWN['center'], BLOWDOWN['r'], BLOWDOWN['rot']
    dx, dy = (lon - bc[1]) * KX, (lat - bc[0]) * KY
    u, v = dx * math.cos(rot) + dy * math.sin(rot), -dx * math.sin(rot) + dy * math.cos(rot)
    wob = 1 + .18 * np.sin(np.arctan2(v, u) * 3 + 1.3) + .1 * np.sin(np.arctan2(v, u) * 7)
    code = np.where(((u / ra) ** 2 + (v / rb) ** 2 < wob ** 2) & np.isin(code, (OLD, FOREST)), BLOW, code)
    code = np.where(keep, L[jj, ii], code)
    L[jj, ii] = code
    m2 = (land['m']) ** 2
    print('  land: ' + ', '.join(f'{nm} {np.sum(code == k) * m2 / 4047:.0f} ac' for nm, k in (('old growth', OLD), ('woods', FOREST), ('meadow', MEADOW), ('blowdown', BLOW))))

    # ---- 4. the hero data
    tun_edge = None
    ref_of = {v: k for k, v in nid.items()}
    for e in new_edges:
        ends = {ref_of.get(e['from']), ref_of.get(e['to'])}
        if ends == {TUNNEL['from'], TUNNEL['to']}: tun_edge = e['id']
    import random
    rnd = random.Random(1926)   # (the year New York bought the land)
    oc, orr = ORCHARD['center'], ORCHARD['r']
    apples = []
    while len(apples) < ORCHARD['n']:
        a, d = rnd.random() * 6.283, orr * math.sqrt(rnd.random())
        p = (oc[0] + math.sin(a) * d / KY, oc[1] + math.cos(a) * d / KX)
        if all(dist(p, q) > 9 for q in apples): apples.append((round(p[0], 6), round(p[1], 6)))
    og = {'format': 'bikefree-oldgrowth-1', 'note': 'tools/cny_forest.py: Camillus Forest Unique Area (DEC) — the hero area\'s trails, boundary, green tunnel and orchard (js/world/toolbox/vegetation/old-growth.js)',
          'name': 'Camillus Forest Unique Area', 'boundary': [[round(a, 6), round(b, 6)] for a, b in ring], 'trails': [e['id'] for e in new_edges],
          'junction': jid, 'tunnel': {'edge': tun_edge}, 'apples': apples, 'rays': RAYS,
          'blowdown': {'center': BLOWDOWN['center'], 'r': BLOWDOWN['r'], 'rot': BLOWDOWN['rot']},
          'codes': {'oldGrowth': OLD, 'forest': FOREST, 'meadow': MEADOW, 'blowdown': BLOW},
          'sources': ['DEC Camillus Forest Unique Area Unit Management Plan', 'OpenStreetMap (ODbL)', 'ESA WorldCover 2021 (CC BY 4.0)']}
    G['oldGrowth'] = OUT
    lbl = ['Camillus Forest', 43.0695, -76.2860, 2]
    if not any(m.get('text') == lbl[0] for m in G.get('mapLabels', [])): G.setdefault('mapLabels', []).append({'text': lbl[0], 'lat': lbl[1], 'lon': lbl[2], 'kind': 'area', 'rank': lbl[3]})
    print(f'  green tunnel on {tun_edge}; {len(apples)} old apple trees')
    if CHECK: print('  (--check: nothing written)'); return
    json.dump(G, open(GRAPH, 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(C, open(CITY, 'w'), separators=(',', ':'))
    open(os.path.join(ROOT, land['file']), 'wb').write(gzip.compress(L.tobytes(), 9))
    json.dump(og, open(os.path.join(ROOT, OUT), 'w'), separators=(',', ':'))
    print(f'  wrote routes/cities/cny.json, cny-city.json, cny-land.bin.gz, {OUT}')


if __name__ == '__main__':
    main()
