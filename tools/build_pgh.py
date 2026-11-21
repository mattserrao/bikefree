#!/usr/bin/env python3
"""Build PGH: a free-ride road graph of Pittsburgh (every street, trail and bridge you can bike; no highways).

    python3 tools/build_pgh.py              # fetch what's missing (cached), build, write
    python3 tools/build_pgh.py --offline    # use the cache only

Reads   tools/city/pgh.json                       the config (corridor, way classes, thresholds)
        routes/cities/pittsburgh*.gpx             the existing areas' lines: the corridor is every street within
                                                  `corridorM` of them (the current network corridor)
Writes  routes/cities/pgh.json                    "bikefree-graph-1": junctions and edges (10 m samples, heights)
        routes/cities/pgh-ground.grid.bin.gz      the ground (a "bikefree-terrain-grid-1" container, coarse only)
        tools/.cache/osm-pgh/                     raw OSM API tiles (delete to refresh)
        tools/.cache/dem-14-*.png                 AWS Terrain Tiles (shared with build_city.py)

The graph: OSM ways that a bike can ride (config "roads" / "paths"), split at every shared node into edges between
junctions. Junctions closer than `mergeM` are merged into one (dual carriageways, offset crossings), parallel
duplicates dropped, degree-2 nodes joined away (a junction is a real choice), short dead-end spurs pruned, and only
the largest connected piece kept: from anywhere you can ride everywhere. Heights: the terrain tiles along each edge (no steeper than `maxGradePct` over 10 m);
bridge decks (and short tunnels) interpolated between their ground ends; smoothed along each edge with its ends
pinned to its junctions' heights, so every way through a junction meets at one height.
Data © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles (USGS 3DEP and others).
"""
import base64, gzip, json, math, os, re, struct, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict, Counter
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
UA = {'User-Agent': 'bikefree-graph-builder/0.1 (personal project)'}
OFFLINE = '--offline' in sys.argv
STEP = 10
REVIEW = {}   # what the build left out, for tools/review_pgh.py


def http_get(url, pause=1.0):
    if OFFLINE: raise RuntimeError(f'offline: {url} is not cached')
    time.sleep(pause)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        return r.read()


def hv(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


# ------------------------------------------------------------------ corridor
class Corridor:
    """Points of the areas' lines on a 100 m hash: is a spot within `r` metres of one?"""
    def __init__(self, pts, r):
        self.r, self.cell = r, 100.0
        self.lat0 = sum(p[0] for p in pts) / len(pts)
        self.kx, self.ky = 111320 * math.cos(math.radians(self.lat0)), 110540
        self.grid = defaultdict(list)
        for la, lo in pts[::3]:
            x, y = lo * self.kx, la * self.ky
            self.grid[(int(x // self.cell), int(y // self.cell))].append((x, y))

    def dist(self, la, lo, reach):
        x, y = lo * self.kx, la * self.ky
        cx, cy, k = int(x // self.cell), int(y // self.cell), int(reach // self.cell) + 1
        best = reach * reach
        for i in range(cx - k, cx + k + 1):
            for j in range(cy - k, cy + k + 1):
                for px, py in self.grid.get((i, j), ()):
                    d = (px - x) ** 2 + (py - y) ** 2
                    if d < best: best = d
        return math.sqrt(best)

    def inside(self, la, lo): return self.dist(la, lo, self.r) < self.r


def area_lines():
    pts = []
    for name in sorted(os.listdir(os.path.join(ROOT, 'routes', 'cities'))):
        if re.match(r'^pittsburgh(-[a-z]+)?\.gpx$', name):
            t = open(os.path.join(ROOT, 'routes', 'cities', name)).read()
            pts += [(float(a), float(b)) for a, b in re.findall(r'<trkpt lat="([^"]+)" lon="([^"]+)"', t)]
    return pts


# ------------------------------------------------------------------ OSM
def fetch_box(folder, s, w, n, e, depth=0):
    path = os.path.join(folder, f't_{s:.4f}_{w:.4f}_{depth}.osm')
    if os.path.exists(path) and os.path.getsize(path) > 200: return [path]
    try:
        data = http_get(f'https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}')
    except urllib.error.HTTPError as err:
        if err.code in (400, 509) and depth < 4:   # too many nodes: split in four
            ms, mw = (s + n) / 2, (w + e) / 2
            out = []
            for a, b, c, d in ((s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)):
                out += fetch_box(folder, a, b, c, d, depth + 1)
            return out
        raise
    open(path, 'wb').write(data)
    return [path]


def load_osm(cfg, cor):
    folder = os.path.join(CACHE, 'osm-pgh')
    os.makedirs(folder, exist_ok=True)
    dx, dy = cfg['osmTile']
    w0, s0 = cfg['osmOrigin']
    pts = cor.pts_all
    la0, la1 = min(p[0] for p in pts), max(p[0] for p in pts)
    lo0, lo1 = min(p[1] for p in pts), max(p[1] for p in pts)
    pad_la, pad_lo = cfg['corridorM'] / 110540 + dy, cfg['corridorM'] / cor.kx + dx
    files, tiles = [], []
    for x in range(math.floor((lo0 - pad_lo - w0) / dx), math.ceil((lo1 + pad_lo - w0) / dx)):
        for y in range(math.floor((la0 - pad_la - s0) / dy), math.ceil((la1 + pad_la - s0) / dy)):
            w, s = w0 + x * dx, s0 + y * dy
            half = 0.5 * math.hypot(dx * cor.kx, dy * 110540)
            if cor.dist(s + dy / 2, w + dx / 2, cfg['corridorM'] + half + 50) < cfg['corridorM'] + half: tiles.append((s, w))
    print(f'  OSM: {len(tiles)} tiles of {dx}° × {dy}° touch the corridor')
    for k, (s, w) in enumerate(tiles):
        files += fetch_box(folder, round(s, 4), round(w, 4), round(s + dy, 4), round(w + dx, 4))
        if (k + 1) % 20 == 0: print(f'    {k + 1}/{len(tiles)} tiles')
    nodes, ways = {}, {}
    for f in files:
        root = ET.parse(f).getroot()
        for nd in root.iter('node'): nodes[nd.get('id')] = (float(nd.get('lat')), float(nd.get('lon')))
        for wy in root.iter('way'):
            t = {x.get('k'): x.get('v') for x in wy.iter('tag')}
            if 'highway' in t: ways[wy.get('id')] = ([x.get('ref') for x in wy.iter('nd')], t)
    print(f'  OSM: {len(nodes)} nodes, {len(ways)} highway ways')
    return nodes, ways


def rideable(t, cfg):
    h = t.get('highway')
    yes = ('yes', 'designated', 'permissive')
    if t.get('area') == 'yes' or t.get('indoor') == 'yes': return None
    if t.get('bicycle') in ('no', 'dismount', 'use_sidepath'): return None
    if t.get('access') in ('private', 'no') and t.get('bicycle') not in yes: return None
    if t.get('service') in cfg['skipService'] and t.get('bicycle') not in yes: return None
    if h in cfg['connectors']: return 'connector'   # a boulevard (trunk): only short pieces between streets are kept (crossing it)
    if h in cfg['roads']:
        if h == 'service' and t.get('service') not in cfg['serviceKinds'] and t.get('bicycle') not in yes: return None
        return cfg['roads'][h]
    if h in cfg['paths']:
        if t.get('footway') == 'crossing' or t.get('path') == 'crossing': return 'path'   # a crosswalk: links a trail across a street
        if t.get('footway') in ('sidewalk', 'traffic_island') or t.get('path') == 'sidewalk': return None
        if h in ('footway', 'bridleway', 'pedestrian') and t.get('bicycle') not in yes and h != 'pedestrian': return None
        if t.get('surface') in cfg['skipSurfaces']: return None
        return cfg['paths'][h]
    return None


# ------------------------------------------------------------------ elevation (AWS Terrain Tiles, terrarium)
DEM_Z = 14
_tiles = {}


def dem_px(gx, gy):
    tx, ty = int(gx // 256), int(gy // 256)
    if (tx, ty) not in _tiles:
        path = os.path.join(CACHE, f'dem-{DEM_Z}-{tx}-{ty}.png')
        if not os.path.exists(path): open(path, 'wb').write(http_get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{DEM_Z}/{tx}/{ty}.png', 0.2))
        _tiles[(tx, ty)] = Image.open(path).convert('RGB').load()
    r, g, b = _tiles[(tx, ty)][int(gx % 256), int(gy % 256)]
    return r * 256 + g + b / 256 - 32768


def elevation(lat, lon):
    n = 2 ** DEM_Z
    fx = (lon + 180) / 360 * n * 256
    lr = math.radians(lat)
    fy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n * 256
    x0, y0 = math.floor(fx - .5), math.floor(fy - .5)
    ax, ay = fx - .5 - x0, fy - .5 - y0
    return (dem_px(x0, y0) * (1 - ax) * (1 - ay) + dem_px(x0 + 1, y0) * ax * (1 - ay)
            + dem_px(x0, y0 + 1) * (1 - ax) * ay + dem_px(x0 + 1, y0 + 1) * ax * ay)


# ------------------------------------------------------------------ the graph
def build(cfg):
    cor_pts = area_lines()
    cor = Corridor(cor_pts, cfg['corridorM'])
    cor.pts_all = cor_pts
    nodes, ways = load_osm(cfg, cor)

    # 1. the rideable ways, inside the corridor (a way is kept where its points are; cut at the corridor's edge)
    kept = []   # (refs, tags, kind)
    dropped = defaultdict(int)
    for wid, (refs, t) in ways.items():
        kind = rideable(t, cfg)
        if kind is None: dropped[t.get('highway')] += 1; continue
        refs = [r for r in refs if r in nodes]
        if len(refs) < 2: continue
        if t.get('tunnel') not in (None, 'no') and sum(hv(nodes[a], nodes[b]) for a, b in zip(refs, refs[1:])) > cfg['maxTunnelM']: dropped['tunnel'] += 1; continue
        run = []
        for r in refs:
            if cor.inside(*nodes[r]): run.append(r)
            else:
                if len(run) > 1: kept.append((run, t, kind, wid))
                run = []
        if len(run) > 1: kept.append((run, t, kind, wid))
    print(f'  ways kept: {len(kept)} pieces; not rideable: ' + ', '.join(f'{k} {v}' for k, v in sorted(dropped.items(), key=lambda x: -x[1])[:12]))

    # 2. split at shared nodes → edges (lists of OSM node ids)
    use = defaultdict(int)
    for refs, *_ in kept:
        for r in set(refs): use[r] += 1
        use[refs[0]] += 1; use[refs[-1]] += 1
    edges = []   # dict: a, b (graph node ids = OSM ids for now), refs, name, kind, bridge flags per segment
    for refs, t, kind, wid in kept:
        bridge = t.get('bridge') not in (None, 'no') or t.get('tunnel') not in (None, 'no')
        name = t.get('name') or t.get('bridge:name') or ''
        cur = [refs[0]]
        for r in refs[1:]:
            cur.append(r)
            if use[r] > 1 and r != cur[0] or r == refs[-1]:
                if len(cur) > 1: edges.append({'refs': cur, 'name': name, 'kind': kind, 'bridge': [bridge] * (len(cur) - 1),
                                               'tunnel': t.get('tunnel') not in (None, 'no'), 'hw': t.get('highway'), 'way': wid})
                cur = [r]
    for e in edges: e['len'] = sum(hv(nodes[a], nodes[b]) for a, b in zip(e['refs'], e['refs'][1:]))
    n0 = len(edges)
    edges = [e for e in edges if e['kind'] != 'connector' or e['len'] <= cfg['connectorM']]
    for e in edges:
        if e['kind'] == 'connector': e['kind'] = 'primary'
    print(f'  raw edges: {len(edges)} ({n0 - len(edges)} boulevard stretches longer than {cfg["connectorM"]} m left out)')

    # positions: per OSM node; graph nodes are union-find clusters of OSM junction nodes
    parent = {}
    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x]); x = parent[x]
        return x
    def union(a, b):
        a, b = find(a), find(b)
        if a != b: parent[b] = a

    # 3. merge junctions joined by a very short edge (dual carriageways, offset crossings)
    for e in edges:
        if e['len'] < cfg['mergeM']: union(e['refs'][0], e['refs'][-1])
    # …and junctions of different ways that sit on top of each other without sharing a node (mapped a metre apart)
    ends = defaultdict(list)
    for e in edges:
        for r in (e['refs'][0], e['refs'][-1]):
            la, lo = nodes[r]; ends[(round(la * 2000), round(lo * 1500))].append(r)   # ~55 m × ~55 m buckets
    for bucket in ends.values():
        for i, a in enumerate(bucket):
            for b in bucket[i + 1:]:
                if a != b and hv(nodes[a], nodes[b]) < cfg['snapM']: union(a, b)

    def build_graph(edges):
        g = defaultdict(list)
        for k, e in enumerate(edges):
            g[find(e['refs'][0])].append(k); g[find(e['refs'][-1])].append(k)
        return g

    edges = [e for e in edges if find(e['refs'][0]) != find(e['refs'][-1]) or e['len'] > cfg['minLoopM']]
    # 4. parallel duplicates: the same two junctions, nearly the same length → keep the longer (one per carriageway pair)
    best = {}
    for k, e in enumerate(edges):
        a, b = sorted((find(e['refs'][0]), find(e['refs'][-1])))
        if a == b: continue
        key = (a, b)
        for j in best.get(key, []):
            o = edges[j]
            if abs(o['len'] - e['len']) < max(cfg['dupM'], 0.15 * max(o['len'], e['len'])):
                if e['len'] > o['len']: edges[j] = e
                e = None; break
        if e is not None: best.setdefault(key, []).append(k)
    edges = [edges[k] for ks in best.values() for k in ks] + [e for e in edges if find(e['refs'][0]) == find(e['refs'][-1])]

    # 5/6/7. prune short dead-end spurs, keep the largest connected piece, join degree-2 nodes away
    for _ in range(3):
        g = build_graph(edges)
        drop = set()
        for n, ks in g.items():
            if len(ks) == 1 and edges[ks[0]]['len'] < cfg['spurM']: drop.add(ks[0])
        edges = [e for k, e in enumerate(edges) if k not in drop]
    g = build_graph(edges)
    seen, comps = set(), []
    for n in g:
        if n in seen: continue
        comp, stack = [], [n]
        seen.add(n)
        while stack:
            x = stack.pop(); comp.append(x)
            for k in g[x]:
                e = edges[k]
                for y in (find(e['refs'][0]), find(e['refs'][-1])):
                    if y not in seen: seen.add(y); stack.append(y)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    REVIEW['pieces'] = [[e for e in edges if find(e['refs'][0]) in set(c)] for c in comps[1:]]   # (tools/review_pgh.py)
    main = set(comps[0])
    lost = sum(1 for e in edges if find(e['refs'][0]) not in main)
    edges = [e for e in edges if find(e['refs'][0]) in main]
    print(f'  connected pieces: {len(comps)}; kept the largest ({len(main)} nodes); dropped {lost} edges in {len(comps) - 1} smaller pieces')

    # join through degree-2 nodes (not a choice): walk chains
    g = build_graph(edges)
    def other_end(e, n): return find(e['refs'][-1]) if find(e['refs'][0]) == n else find(e['refs'][0])
    joint = lambda n: len(g[n]) == 2 and g[n][0] != g[n][1]
    used, chains = set(), []
    def oriented(e, start):   # the edge's refs, bridge flags as ridden from cluster `start`
        if find(e['refs'][0]) == start: return e['refs'], e['bridge']
        return e['refs'][::-1], e['bridge'][::-1]
    for k, e in enumerate(edges):
        if k in used: continue
        # walk back to a real junction
        a = find(e['refs'][0]); cur = k
        guard = 0
        while joint(a) and guard < 100000:
            nk = g[a][0] if g[a][1] == cur else g[a][1]
            if nk == k: break   # a ring of degree-2 nodes
            cur = nk; a = other_end(edges[cur], a); guard += 1
        start, k0 = a, cur
        refs, br, parts, n = [], [], [], start
        cur = k0
        while True:
            used.add(cur)
            r, b = oriented(edges[cur], n)
            refs += r if not refs else r[1:]; br += b
            parts.append(edges[cur])
            n = other_end(edges[cur], n)
            if not joint(n): break
            nk = g[n][0] if g[n][1] == cur else g[n][1]
            if nk in used: break
            cur = nk
        named = defaultdict(float)
        for p in parts: named[p['name']] += p['len']
        kind = max(parts, key=lambda p: p['len'])['kind']
        hws = defaultdict(float)
        for p in parts: hws[p['hw']] += p['len']
        chains.append({'a': start, 'b': n, 'refs': refs, 'bridge': br, 'kind': kind, 'hw': max(hws.items(), key=lambda x: x[1])[0],
                       'name': max(named.items(), key=lambda x: x[1])[0], 'names': [k for k, v in sorted(named.items(), key=lambda x: -x[1]) if k]})
    print(f'  graph: {len(chains)} edges after joining through bends')

    # junction positions: the mean of their OSM nodes
    members = defaultdict(set)
    for c in chains:
        members[c['a']].add(c['refs'][0]); members[c['b']].add(c['refs'][-1])
    jpos = {n: (sum(nodes[r][0] for r in ms) / len(ms), sum(nodes[r][1] for r in ms) / len(ms)) for n, ms in members.items()}
    return nodes, chains, jpos, cor


_wet = {}
_wdist = {}


def wet(la, lo, pool):
    key = (round(la, 5), round(lo, 5))
    if key not in _wet: _wet[key] = elevation(la, lo) < pool + 1.2
    return _wet[key]


def water_dist(la, lo, pool, reach):
    """Metres to the nearest river (the terrain at the pool), looking out in 8 directions every 10 m; > reach: none."""
    key = (round(la, 4), round(lo, 4), reach)
    if key in _wdist: return _wdist[key]
    kx = 111320 * math.cos(math.radians(la))
    out = reach + 1
    for d in range(0, int(reach) + 1, 10):
        dirs = [(0, 0)] if d == 0 else [(math.cos(a), math.sin(a)) for a in (k * math.pi / 4 for k in range(8))]
        if any(wet(la + dy * d / 110540, lo + dx * d / kx, pool) for dx, dy in dirs): out = d; break
    _wdist[key] = out
    return out


def heights(cfg, nodes, chains, jpos):
    """Per edge: 10 m samples with heights. Bridges interpolated between their ground ends, at least `bridgeClearM`
    over the river (ramping down at `bridgeRampPct` away from it); streets and trails beside the river at least
    `riverFloorM` above the pool; smoothed (twice as long beside the river); ends pinned."""
    pool = cfg['waterLevelM']
    clear, ramp, rfloor = cfg['bridgeClearM'], cfg['bridgeRampPct'] / 100, cfg['riverFloorM']
    reach = clear / ramp
    def deck_floor(la, lo):
        d = water_dist(la, lo, pool, reach)
        return pool + clear - ramp * d if d <= reach else -1e9
    riverside = lambda la, lo: water_dist(la, lo, pool, cfg['riversideM']) <= cfg['riversideM']
    # bridge chains: OSM nodes on bridge segments, grouped by touching; ground ends get the terrain height
    on_bridge = defaultdict(int); off_bridge = set()
    adj = defaultdict(set)
    for c in chains:
        for (a, b), br in zip(zip(c['refs'], c['refs'][1:]), c['bridge']):
            if br: on_bridge[a] += 1; on_bridge[b] += 1; adj[a].add(b); adj[b].add(a)
            else: off_bridge.add(a); off_bridge.add(b)
    deck, crossing = {}, {}
    seen = set()
    for start in list(adj):
        if start in seen: continue
        comp, stack = [], [start]; seen.add(start)
        while stack:
            x = stack.pop(); comp.append(x)
            for y in adj[x]:
                if y not in seen: seen.add(y); stack.append(y)
        # does this bridge cross the river (≥ 40 m of it over water)? Only those get the clearance (not a boardwalk on the bank)
        wet_m, done = 0, set()
        for x in comp:
            for y in adj[x]:
                if (y, x) in done: continue
                done.add((x, y))
                L = hv(nodes[x], nodes[y]); k = max(1, int(L / 10))
                wet_m += sum(10 for t in range(k + 1) if wet(nodes[x][0] + (nodes[y][0] - nodes[x][0]) * t / k, nodes[x][1] + (nodes[y][1] - nodes[x][1]) * t / k, pool))
        for x in comp: crossing[x] = wet_m >= 40
        grounds = [x for x in comp if x in off_bridge or len(adj[x]) == 1]
        if not grounds: grounds = [comp[0]]
        gh = {}
        for x in grounds:
            la, lo = nodes[x]
            # the abutment: the highest ground within a few metres (a bridge end on a river wall samples the river)
            # (a river bridge's end on a river wall reads the river: look 20 m round for the bank top; others 6 m)
            radii = (6, 20) if crossing.get(x) else (6,)
            ring = [(0, 0)] + [(r * math.sin(a) / 110540, r * math.cos(a) / (111320 * math.cos(math.radians(la)))) for r in radii for a in (k * math.pi / 4 for k in range(8))]
            gh[x] = max(max(elevation(la + dy, lo + dx) for dy, dx in ring), pool + rfloor)
        # inverse-distance (along the deck) blend of the ground ends' heights
        for gx in grounds:
            dist = {gx: 0.0}; heap = [(0.0, gx)]
            import heapq
            while heap:
                d, x = heapq.heappop(heap)
                if d > dist[x]: continue
                for y in adj[x]:
                    nd = d + hv(nodes[x], nodes[y])
                    if nd < dist.get(y, 1e18): dist[y] = nd; heapq.heappush(heap, (nd, y))
            for x, d in dist.items():
                w = 1 / max(d, 1.0) ** 2
                s = deck.setdefault(x, [0.0, 0.0]); s[0] += w * gh[gx]; s[1] += w
    deck = {x: max(s[0] / s[1], deck_floor(*nodes[x]) if crossing.get(x) else pool + rfloor) for x, s in deck.items()}

    def node_h(r):
        if r in deck: return deck[r]
        h = elevation(*nodes[r])
        return max(h, pool + rfloor) if riverside(*nodes[r]) else h
    jh = {}
    for c in chains:
        for end, r in ((c['a'], c['refs'][0]), (c['b'], c['refs'][-1])):
            jh.setdefault(end, []).append(node_h(r))
    jh = {n: sum(v) / len(v) for n, v in jh.items()}

    out = []
    for c in chains:
        P = [nodes[r] for r in c['refs']]
        P[0], P[-1] = jpos[c['a']], jpos[c['b']]
        cum = [0.0]
        for a, b in zip(P, P[1:]): cum.append(cum[-1] + hv(a, b))
        L = cum[-1]
        n = max(1, round(L / STEP))
        lat, lon, ele, brs, rs = [], [], [], [], []
        j = 0
        for i in range(n + 1):
            d = L * i / n
            while j < len(P) - 2 and cum[j + 1] < d: j += 1
            f = 0 if cum[j + 1] == cum[j] else (d - cum[j]) / (cum[j + 1] - cum[j])
            f = min(1, max(0, f))
            la, lo = P[j][0] + (P[j + 1][0] - P[j][0]) * f, P[j][1] + (P[j + 1][1] - P[j][1]) * f
            lat.append(la); lon.append(lo)
            if c['bridge'][j]:
                ha, hb = node_h(c['refs'][j]), node_h(c['refs'][j + 1])
                over = crossing.get(c['refs'][j]) or crossing.get(c['refs'][j + 1])
                ele.append(max(ha + (hb - ha) * f, deck_floor(la, lo) if over else pool + rfloor)); brs.append(1); rs.append(0)
            else:
                h, r = elevation(la, lo), riverside(la, lo)
                ele.append(max(h, pool + rfloor) if r else h); brs.append(0); rs.append(r)
        # smooth (not on bridge decks), ends pinned to the junctions
        w = max(1, round(cfg['smoothM'] / (L / n))) if n > 2 else 0
        sm = ele[:]
        for _ in range(3):
            src = sm[:]
            for i in range(1, n):
                if brs[i]: continue
                ww = 2 * w if rs[i] else w   # (beside the river: twice as long)
                a, b = max(0, i - ww), min(n, i + ww)
                sm[i] = sum(src[a:b + 1]) / (b - a + 1)
        h0, h1 = jh[c['a']], jh[c['b']]
        d0, d1 = h0 - sm[0], h1 - sm[n]
        # pin: blend the offsets at the ends into the profile over its length (no step at a junction)
        sm = [sm[i] + d0 * (1 - i / n) + d1 * (i / n) for i in range(n + 1)]
        # onto and off a deck: the street eases onto the deck's end at ≤ bridgeRampPct for up to 120 m (not the edge's own ends)
        sp, rmp = L / n, cfg['bridgeRampPct'] / 100
        for b in range(n + 1):
            if not brs[b]: continue
            for step in (1, -1):
                if not (0 <= b + step <= n) or brs[b + step]: continue
                for t in range(1, 13):
                    i = b + step * t
                    if i <= 0 or i >= n or brs[i]: break
                    d = t * sp
                    sm[i] = min(max(sm[i], sm[b] - rmp * d), sm[b] + rmp * d)
        # no steeper than maxGradePct over a 10 m step (the terrain tiles sample the hillside beside a street cut
        # into it): clamp forward from the start, then backward from the end (both ends stay on their junctions)
        g = max(cfg['maxGradePct'] / 100 * (L / n), abs(sm[n] - sm[0]) / n * 1.02)   # (an edge steeper on average: even)
        for _ in range(2):
            for i in range(1, n):
                sm[i] = min(max(sm[i], sm[i - 1] - g), sm[i - 1] + g)
            for i in range(n - 1, 0, -1):
                sm[i] = min(max(sm[i], sm[i + 1] - g), sm[i + 1] + g)
        # round the corner where a deck meets the street: a few passes of a 5-sample average across each deck end
        ends = [b for b in range(n) if brs[b] != brs[b + 1]]
        for _ in range(4):
            for b in ends:
                src = sm[:]
                for i in range(max(1, b - 2), min(n - 1, b + 3) + 1):
                    a0, a1 = max(0, i - 2), min(n, i + 2)
                    sm[i] = sum(src[a0:a1 + 1]) / (a1 - a0 + 1)
        for _ in range(2):   # (and the grade cap again)
            for i in range(1, n):
                sm[i] = min(max(sm[i], sm[i - 1] - g), sm[i - 1] + g)
            for i in range(n - 1, 0, -1):
                sm[i] = min(max(sm[i], sm[i + 1] - g), sm[i + 1] + g)
        out.append({**c, 'lat': lat, 'lon': lon, 'ele': sm, 'br': brs, 'n': n, 'L': L})
    return out, jh


# ------------------------------------------------------------------ simplify (after heights: on the edges themselves)
LINKS = {'primary_link', 'secondary_link', 'tertiary_link', 'trunk', 'trunk_link'}
MINOR = {'service', 'footway', 'path', 'cycleway', 'pedestrian', 'track', 'bridleway', 'living_street'}


class Graph:
    """Edges by index with live degrees; removal keeps every junction on ≥ 2 ways and the network in one piece."""
    def __init__(self, E):
        self.E, self.gone = E, set()
        self.adj, self.deg = defaultdict(list), defaultdict(int)
        for k, e in enumerate(E):
            self.adj[e['a']].append(k); self.adj[e['b']].append(k)
            if e['a'] != e['b']: self.deg[e['a']] += 1; self.deg[e['b']] += 1   # (a loop back to the same junction is no way on)

    def connected_without(self, k):
        e = self.E[k]
        if e['a'] == e['b']: return True
        seen, st = {e['a']}, [e['a']]
        while st:
            x = st.pop()
            for j in self.adj[x]:
                if j == k or j in self.gone: continue
                o = self.E[j]
                for y in (o['a'], o['b']):
                    if y == e['b']: return True
                    if y not in seen: seen.add(y); st.append(y)
        return False

    def can_remove(self, k):
        e = self.E[k]
        return k not in self.gone and self.deg[e['a']] >= 3 and self.deg[e['b']] >= 3 and self.connected_without(k)

    def remove(self, k):
        e = self.E[k]
        self.gone.add(k)
        if e['a'] != e['b']: self.deg[e['a']] -= 1; self.deg[e['b']] -= 1


def dense_nodes(cfg, E, gone=()):
    parent = {}
    def f(x):
        while parent.get(x, x) != x: parent[x] = parent.get(parent[x], parent[x]); x = parent[x]
        return x
    for k, e in enumerate(E):
        if k not in gone and e['L'] < cfg['denseM'] and e['a'] != e['b']: parent[f(e['a'])] = f(e['b'])
    clusters = defaultdict(set)
    for k, e in enumerate(E):
        if k in gone: continue
        for n in (e['a'], e['b']): clusters[f(n)].add(n)
    return [c for c in clusters.values() if len(c) >= 3]


def simplify_plan(cfg, E, G=None):
    """The ways that can go, in order (turn slips, short trail and crosswalk bits, short minor ways and very short links in
    dense clusters, trails on a bridge beside its road, then alleys), each only if no junction is left with < 2 ways and
    the network stays in one piece. Returns [(k, why)] and removes them from G (a dry run makes its own)."""
    G = G or Graph(E)
    dense = dense_nodes(cfg, E, G.gone)
    in_dense = {n for c in dense for n in c}
    order = sorted(range(len(E)), key=lambda k: E[k]['L'])
    # bridge decks of roads (not trails), on a 30 m hash: a trail deck beside one is the same bridge's walkway
    decks = defaultdict(list)
    for k, e in enumerate(E):
        if e['kind'] == 'path' or not any(e['br']): continue
        for i in range(e['n'] + 1):
            if e['br'][i]: decks[(int(e['lat'][i] * 3700), int(e['lon'][i] * 2800))].append(k)
    def beside_road_deck(e):
        hits = total = 0
        for i in range(e['n'] + 1):
            if not e['br'][i]: continue
            total += 1
            ky = (int(e['lat'][i] * 3700), int(e['lon'][i] * 2800))
            if any(decks.get((ky[0] + a, ky[1] + b)) for a in (-1, 0, 1) for b in (-1, 0, 1)): hits += 1
        return total >= 3 and hits >= 0.7 * total
    rules = [
        ('turn slip / link', lambda e: e['hw'] in LINKS and e['L'] < 150),
        ('short trail or crosswalk piece', lambda e: e['kind'] == 'path' and e['L'] < cfg['denseM']),
        ('short minor way in a dense cluster', lambda e: e['L'] < cfg['denseM'] and (e['hw'] in MINOR or e['kind'] == 'alley') and (e['a'] in in_dense or e['b'] in in_dense)),
        ('very short link inside a dense cluster', lambda e: e['L'] < 25 and e['a'] in in_dense and e['b'] in in_dense),
        ('trail on a bridge beside its road', lambda e: e['kind'] == 'path' and any(e['br']) and beside_road_deck(e)),
    ]
    if cfg.get('removeAlleys'): rules.append(('alley', lambda e: e['kind'] == 'alley'))
    out = []
    for why, rule in rules:
        for k in order:
            if k in G.gone or not rule(E[k]): continue
            if G.can_remove(k): G.remove(k); out.append((k, why))
    return out


def find_crossings(E, gone=(), clear=4.5):
    """Two ways crossing (not at a junction) less than `clear` apart in height: [(k_over, t_over, k_under, t_under, gap)]
    with t = metres along each edge; the over-way is the one on a bridge deck there (else the higher)."""
    lat0 = sum(E[0]['lat']) / len(E[0]['lat'])
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    grid = defaultdict(list)
    for k, e in enumerate(E):
        if k in gone: continue
        for i in range(e['n']):
            x0, y0, x1, y1 = e['lon'][i] * kx, e['lat'][i] * ky, e['lon'][i + 1] * kx, e['lat'][i + 1] * ky
            grid[(int((x0 + x1) / 80), int((y0 + y1) / 80))].append((k, i, x0, y0, x1, y1))
    out, seen = [], set()
    for (cx, cy), segs in grid.items():
        near = [s for a in (-1, 0, 1) for b in (-1, 0, 1) for s in grid.get((cx + a, cy + b), ())]
        for A in segs:
            for Bs in near:
                ka, kb = A[0], Bs[0]
                if ka >= kb: continue
                ea, eb = E[ka], E[kb]
                if {ea['a'], ea['b']} & {eb['a'], eb['b']}: continue
                (_, i, ax0, ay0, ax1, ay1), (_, j, bx0, by0, bx1, by1) = A, Bs
                d = (bx1 - bx0) * (ay1 - ay0) - (by1 - by0) * (ax1 - ax0)
                if abs(d) < 1e-9: continue
                t = ((bx0 - ax0) * (by1 - by0) - (by0 - ay0) * (bx1 - bx0)) / -d
                u = ((bx0 - ax0) * (ay1 - ay0) - (by0 - ay0) * (ax1 - ax0)) / -d
                if not (0.02 < t < 0.98 and 0.02 < u < 0.98) or (ka, kb) in seen: continue
                ha = ea['ele'][i] + (ea['ele'][i + 1] - ea['ele'][i]) * t
                hb = eb['ele'][j] + (eb['ele'][j + 1] - eb['ele'][j]) * u
                if abs(ha - hb) >= clear: continue
                seen.add((ka, kb))
                ba, bb = ea['br'][i] or ea['br'][i + 1], eb['br'][j] or eb['br'][j + 1]
                over_a = ba if ba != bb else ha >= hb
                sa, sb = (i + t) * ea['L'] / ea['n'], (j + u) * eb['L'] / eb['n']
                out.append((ka, sa, kb, sb, abs(ha - hb)) if over_a else (kb, sb, ka, sa, abs(ha - hb)))
    return out


def bump(e, at, dh, R):
    """Raise (dh > 0) or lower an edge's profile by dh at `at` metres, easing out over R metres either side."""
    sp = e['L'] / e['n']
    for i in range(e['n'] + 1):
        d = abs(i * sp - at)
        if d < R: e['ele'][i] += dh * 0.5 * (1 + math.cos(math.pi * d / R))


def fix_crossings(cfg, E, G):
    """Every near-level crossing clears by `overpassClearM`: dip the way under (not on a deck) with 8 % easings, else lift
    the deck over it, else remove the minor of the two (when it can go), else report it."""
    need_c, fixed, removed, left = cfg['overpassClearM'], 0, [], []
    for _ in range(3):
        xs = find_crossings(E, G.gone, need_c)
        if not xs: break
        for ko, so, ku, su, gap in xs:
            if ko in G.gone or ku in G.gone: continue
            eo, eu = E[ko], E[ku]
            need = need_c + 0.3 - (_h(eo, so) - _h(eu, su))   # (a little over: the crossing falls between samples)
            if need <= 0: continue
            iu = min(eu['n'], round(su / (eu['L'] / eu['n'])))
            io = min(eo['n'], round(so / (eo['L'] / eo['n'])))
            room_u = min(su, eu['L'] - su) - 5 if not eu['br'][iu] else -1   # metres the dip can ease out over
            room_o = min(so, eo['L'] - so) - 5 if eo['br'][io] else -1       # …and the lift (only a deck is lifted)
            done = False
            # easings from 8 % up to 16 %; the way under alone, the deck alone, or half each
            for slope in (0.08, 0.12, 0.16):
                R = max(12.0, need / slope)
                if room_u >= R: bump(eu, su, -need, R); done = True
                elif room_o >= R: bump(eo, so, need, R); done = True
                elif min(room_u, room_o) >= max(12.0, need / 2 / slope):
                    r = max(12.0, need / 2 / slope); bump(eu, su, -need / 2, r); bump(eo, so, need / 2, r); done = True
                if done: break
            if done: fixed += 1
            else:
                cand = sorted((ko, ku), key=lambda k: (E[k]['kind'] not in ('path', 'alley'), E[k]['L']))
                k = next((k for k in cand if G.can_remove(k)), None)
                if k is not None: G.remove(k); removed.append((k, 'way under or over a crossing that cannot clear'))
                else: left.append((ko, ku))
    return fixed, removed, left


def _h(e, s):
    sp = e['L'] / e['n']; i = min(e['n'] - 1, int(s / sp)); f = s / sp - i
    return e['ele'][i] + (e['ele'][i + 1] - e['ele'][i]) * f


def merge_through(E):
    """Join edges through junctions left with two ways (not a choice any more): one edge, samples end to end."""
    E = list(E)
    flip = lambda e: {**e, 'a': e['b'], 'b': e['a'], 'lat': e['lat'][::-1], 'lon': e['lon'][::-1], 'ele': e['ele'][::-1], 'br': e['br'][::-1]}
    while True:
        ends = defaultdict(list)
        for k, e in enumerate(E):
            ends[e['a']].append((k, 0)); ends[e['b']].append((k, 1))
        used, merged = set(), []
        for n, l in ends.items():
            if len(l) != 2 or l[0][0] == l[1][0]: continue
            (k1, s1), (k2, s2) = l
            if k1 in used or k2 in used: continue
            used.update((k1, k2))
            e1, e2 = E[k1], E[k2]
            if s1 == 0: e1 = flip(e1)   # e1 now ends at n
            if s2 == 1: e2 = flip(e2)   # e2 now starts at n
            big = e1 if e1['L'] >= e2['L'] else e2
            merged.append({**big, 'a': e1['a'], 'b': e2['b'], 'lat': e1['lat'] + e2['lat'][1:], 'lon': e1['lon'] + e2['lon'][1:],
                           'ele': e1['ele'] + e2['ele'][1:], 'br': e1['br'] + e2['br'][1:], 'n': e1['n'] + e2['n'], 'L': e1['L'] + e2['L']})
        if not merged: return E
        E = [e for k, e in enumerate(E) if k not in used] + merged


def finish(cfg, E):
    """After heights: simplify, clear the crossings, join through two-way junctions."""
    by = defaultdict(lambda: [0, 0.0])
    for _ in range(6):   # (joining through two-way junctions makes new candidates: again until nothing more goes)
        G = Graph(E)
        plan = simplify_plan(cfg, E, G)
        for k, w in plan: by[w][0] += 1; by[w][1] += E[k]['L']
        E = merge_through([e for k, e in enumerate(E) if k not in G.gone])
        if not plan: break
    G = Graph(E)
    fixed, removed, left = fix_crossings(cfg, E, G)
    for k, w in removed: by[w][0] += 1; by[w][1] += E[k]['L']
    for w, (n, L) in by.items(): print(f'    removed {n} ({L / 1000:.1f} km): {w}')
    print(f'  crossings: {fixed} cleared by a dip or a lifted deck, {len(removed)} by removing a way, {len(left)} left')
    E = merge_through([e for k, e in enumerate(E) if k not in G.gone])
    return E


def drop_unrideable(cfg, E):
    """Edges steeper on average than maxAvgGradePct (a staircase street, a junction height that can't be met) are not
    rideable: drop them, then keep only the largest connected piece again."""
    lim = cfg['maxAvgGradePct'] / 100
    bad = [e for e in E if abs(e['ele'][-1] - e['ele'][0]) > lim * max(e['L'], 1)]
    for e in bad: print(f'    too steep to ride: {e["name"] or e["kind"]} ({abs(e["ele"][-1] - e["ele"][0]) / max(e["L"], 1) * 100:.0f} % over {e["L"]:.0f} m)')
    E = [e for e in E if e not in bad]
    adj = defaultdict(list)
    for e in E: adj[e['a']].append(e['b']); adj[e['b']].append(e['a'])
    best = set()
    seen = set()
    for n in adj:
        if n in seen: continue
        comp, stack = {n}, [n]; seen.add(n)
        while stack:
            for y in adj[stack.pop()]:
                if y not in seen: seen.add(y); comp.add(y); stack.append(y)
        if len(comp) > len(best): best = comp
    out = [e for e in E if e['a'] in best]
    print(f'  dropped {len(bad)} edges too steep to ride, and {len(E) - len(out)} cut off by them')
    return out


def junction_name(names):
    uniq = []
    for x in names:
        if x and x not in uniq: uniq.append(x)
    if len(uniq) >= 2: return f'{uniq[0]} & {uniq[1]}'
    if uniq: return uniq[0]
    return 'Trail junction'


def write(cfg, E, jpos, jh, cor):
    ids = {n: f'n{i}' for i, n in enumerate(sorted(jpos, key=lambda n: (jpos[n][0], jpos[n][1])))}
    names = defaultdict(list)
    for e in E:
        names[e['a']].append(e['name']); names[e['b']].append(e['name'])
    lat0 = sum(p[0] for p in jpos.values()) / len(jpos); lon0 = sum(p[1] for p in jpos.values()) / len(jpos)
    nodes_out = []
    for n in sorted(jpos, key=lambda n: ids[n][1:] and int(ids[n][1:])):
        nodes_out.append({'id': ids[n], 'name': junction_name(sorted(names[n], key=lambda x: (x == '', names[n].count(x) * -1))),
                          'lat': round(jpos[n][0], 6), 'lon': round(jpos[n][1], 6), 'ele': round(jh[n], 1)})
    edges_out = []
    for i, e in enumerate(sorted(E, key=lambda e: (ids[e['a']], ids[e['b']]))):
        la = [round(v * 1e6) for v in e['lat']]; lo = [round(v * 1e6) for v in e['lon']]; el = [round(v * 10) for v in e['ele']]
        # first value absolute, then deltas (compact JSON)
        d = lambda a: [a[0]] + [a[k] - a[k - 1] for k in range(1, len(a))]
        rec = {'id': f'e{i}', 'from': ids[e['a']], 'to': ids[e['b']], 'name': e['name'] or ('Trail' if e['kind'] == 'path' else 'Alley' if e['kind'] == 'alley' else 'Street'),
               'kind': e['kind'], 'lat': d(la), 'lon': d(lo), 'ele': d(el)}
        if any(e['br']):
            runs, k = [], 0
            while k <= e['n']:
                if e['br'][k]:
                    j = k
                    while j + 1 <= e['n'] and e['br'][j + 1]: j += 1
                    runs.append([max(0, k - 1), min(e['n'], j + 1)]); k = j + 1
                else: k += 1
            rec['bridges'] = runs
        edges_out.append(rec)
    out = {'format': 'bikefree-graph-1', 'id': 'pgh', 'name': 'PGH', 'city': 'Pittsburgh, PA',
           'attribution': 'Map data © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles (USGS 3DEP)',
           'origin': {'lat': round(lat0, 6), 'lon': round(lon0, 6)}, 'unit': {'latlon': 1e-6, 'ele': 0.1},
           'widths': cfg['widths'], 'waterLevelM': cfg['waterLevelM'], 'map': 'routes/cities/pittsburgh-map.json',
           'ground': 'routes/cities/pgh-ground.grid.bin.gz', 'start': cfg.get('start'),
           'nodes': nodes_out, 'edges': edges_out}
    path = os.path.join(ROOT, 'routes', 'cities', 'pgh.json')
    open(path, 'w').write(json.dumps(out, separators=(',', ':')))
    km = sum(e['n'] * STEP for e in E) / 1000
    print(f'  wrote {os.path.relpath(path, ROOT)}: {len(nodes_out)} junctions, {len(edges_out)} edges, {km:.0f} km of rideable way, {os.path.getsize(path) / 1e6:.1f} MB')
    return out


def write_ground(cfg, E):
    """The ground: terrain heights on a `groundCellM` grid over the graph's box (+ margin), as a terrain-grid container."""
    la = [v for e in E for v in e['lat']]; lo = [v for e in E for v in e['lon']]
    m = cfg['groundMarginM']
    lat0 = (min(la) + max(la)) / 2
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    north, south = max(la) + m / ky, min(la) - m / ky
    west, east = min(lo) - m / kx, max(lo) + m / kx
    cell = cfg['groundCellM']
    nx = int(math.ceil((east - west) * kx / cell)) + 1
    ny = int(math.ceil((north - south) * ky / cell)) + 1
    east = west + (nx - 1) * cell / kx; south = north - (ny - 1) * cell / ky
    base, scale = 100.0, 0.1
    rows = bytearray()
    for j in range(ny):
        acc = 0
        for i in range(nx):
            h = elevation(north - j * cell / ky, west + i * cell / kx)
            v = max(0, min(65535, round((h - base) / scale)))
            rows += struct.pack('<H', (v - acc) & 0xffff); acc = v
    header = {'format': 'bikefree-terrain-grid-1', 'rowDelta': True, 'attribution': 'Elevation: AWS Terrain Tiles (USGS 3DEP, NOAA and others)',
              'north': north, 'west': west, 'south': south, 'east': east, 'base': base, 'scale': scale, 'cellM': cell,
              'coarse': {'nx': nx, 'ny': ny, 'step': 1, 'h': {'$bin': [0, len(rows)]}},
              'fine': {'cellM': cell, 'block': 64, 'bnx': 1, 'bny': 1, 'nx': nx, 'ny': ny, 'blocks': [], 'h': {'$bin': [len(rows), 0]}}}
    js = json.dumps(header, separators=(',', ':')).encode()
    pad = (4 - (8 + len(js)) % 4) % 4
    blob = b'BFTG' + struct.pack('<I', len(js)) + js + b'\0' * pad + bytes(rows)
    path = os.path.join(ROOT, cfg['groundFile'])
    open(path, 'wb').write(gzip.compress(blob, 9))
    print(f'  wrote {cfg["groundFile"]}: {nx} × {ny} at {cell} m, {os.path.getsize(path) / 1e6:.2f} MB')


def build_all(cfg):
    """The whole graph as written: built, heights, simplified, crossings cleared, joined, too-steep edges dropped."""
    nodes, chains, jpos, cor = build(cfg)
    E, jh = heights(cfg, nodes, chains, jpos)
    E = finish(cfg, E)
    E = drop_unrideable(cfg, E)
    E = merge_through(E)
    used = {e['a'] for e in E} | {e['b'] for e in E}
    jpos = {n: p for n, p in jpos.items() if n in used}
    return nodes, E, jpos, jh, cor


def main():
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', 'pgh.json')))
    nodes, E, jpos, jh, cor = build_all(cfg)
    write(cfg, E, jpos, jh, cor)
    if '--no-ground' not in sys.argv: write_ground(cfg, E)


if __name__ == '__main__':
    main()
