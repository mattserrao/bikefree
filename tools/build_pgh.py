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
from collections import defaultdict
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
UA = {'User-Agent': 'bikefree-graph-builder/0.1 (personal project)'}
OFFLINE = '--offline' in sys.argv
STEP = 10


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
        chains.append({'a': start, 'b': n, 'refs': refs, 'bridge': br, 'kind': kind,
                       'name': max(named.items(), key=lambda x: x[1])[0], 'names': [k for k, v in sorted(named.items(), key=lambda x: -x[1]) if k]})
    print(f'  graph: {len(chains)} edges after joining through bends')

    # junction positions: the mean of their OSM nodes
    members = defaultdict(set)
    for c in chains:
        members[c['a']].add(c['refs'][0]); members[c['b']].add(c['refs'][-1])
    jpos = {n: (sum(nodes[r][0] for r in ms) / len(ms), sum(nodes[r][1] for r in ms) / len(ms)) for n, ms in members.items()}
    return nodes, chains, jpos, cor


def heights(cfg, nodes, chains, jpos):
    """Per edge: 10 m samples with heights. Bridges interpolated between their ground ends; smoothed; ends pinned."""
    # bridge chains: OSM nodes on bridge segments, grouped by touching; ground ends get the terrain height
    on_bridge = defaultdict(int); off_bridge = set()
    adj = defaultdict(set)
    for c in chains:
        for (a, b), br in zip(zip(c['refs'], c['refs'][1:]), c['bridge']):
            if br: on_bridge[a] += 1; on_bridge[b] += 1; adj[a].add(b); adj[b].add(a)
            else: off_bridge.add(a); off_bridge.add(b)
    deck = {}
    seen = set()
    for start in list(adj):
        if start in seen: continue
        comp, stack = [], [start]; seen.add(start)
        while stack:
            x = stack.pop(); comp.append(x)
            for y in adj[x]:
                if y not in seen: seen.add(y); stack.append(y)
        grounds = [x for x in comp if x in off_bridge or len(adj[x]) == 1]
        if not grounds: grounds = [comp[0]]
        gh = {}
        for x in grounds:
            la, lo = nodes[x]
            # the abutment: the highest ground within a few metres (a bridge end on a river wall samples the river)
            gh[x] = max(elevation(la + dy, lo + dx) for dy, dx in ((0, 0), (5e-5, 0), (-5e-5, 0), (0, 6.5e-5), (0, -6.5e-5)))
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
    deck = {x: s[0] / s[1] for x, s in deck.items()}

    def node_h(r):
        return deck[r] if r in deck else elevation(*nodes[r])
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
        lat, lon, ele, brs = [], [], [], []
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
                ele.append(ha + (hb - ha) * f); brs.append(1)
            else:
                ele.append(elevation(la, lo)); brs.append(0)
        # smooth (not on bridge decks), ends pinned to the junctions
        w = max(1, round(cfg['smoothM'] / (L / n))) if n > 2 else 0
        sm = ele[:]
        for _ in range(3):
            src = sm[:]
            for i in range(1, n):
                if brs[i]: continue
                a, b = max(0, i - w), min(n, i + w)
                sm[i] = sum(src[a:b + 1]) / (b - a + 1)
        h0, h1 = jh[c['a']], jh[c['b']]
        d0, d1 = h0 - sm[0], h1 - sm[n]
        # pin: blend the offsets at the ends into the profile over its length (no step at a junction)
        sm = [sm[i] + d0 * (1 - i / n) + d1 * (i / n) for i in range(n + 1)]
        # no steeper than maxGradePct over a 10 m step (the terrain tiles sample the hillside beside a street cut
        # into it): clamp forward from the start, then backward from the end (both ends stay on their junctions)
        g = max(cfg['maxGradePct'] / 100 * (L / n), abs(sm[n] - sm[0]) / n * 1.02)   # (an edge steeper on average: even)
        for _ in range(2):
            for i in range(1, n):
                sm[i] = min(max(sm[i], sm[i - 1] - g), sm[i - 1] + g)
            for i in range(n - 1, 0, -1):
                sm[i] = min(max(sm[i], sm[i + 1] - g), sm[i + 1] + g)
        out.append({**c, 'lat': lat, 'lon': lon, 'ele': sm, 'br': brs, 'n': n, 'L': L})
    return out, jh


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


def main():
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', 'pgh.json')))
    nodes, chains, jpos, cor = build(cfg)
    E, jh = heights(cfg, nodes, chains, jpos)
    E = drop_unrideable(cfg, E)
    used = {e['a'] for e in E} | {e['b'] for e in E}
    jpos = {n: p for n, p in jpos.items() if n in used}
    write(cfg, E, jpos, jh, cor)
    if '--no-ground' not in sys.argv: write_ground(cfg, E)


if __name__ == '__main__':
    main()
