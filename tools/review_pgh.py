#!/usr/bin/env python3
"""Review PGH's road graph for problems and what could be removed (nothing is changed).

    python3 tools/review_pgh.py [--offline]

Runs the PGH build (tools/build_pgh.py, from the cache) and reports:
  dead ends      junctions with one way in (a U-turn only), and the dead-end branches behind them: every edge that
                 is not on a loop (iteratively peeling leaves off the graph)
  disconnected   pieces the build already left out because they don't join the main network
  dense          clusters of junctions joined by short edges (< DENSE_M), and the short, minor, non-essential
                 edges in them that could go (turn slips, crosswalk bits, alleys and trail stubs between two
                 junctions that keep other ways)
  river          bridge decks too low over the water, steps where a deck meets the street, streets running on
                 the river (terrain tiles read the water at a river wall), dips beside the river, near-level
                 crossings with no junction (a deck that doesn't clear the way under it)
Writes tools/.cache/pgh-review.json (every finding with its geometry) for tools/review_pgh_map.mjs.
"""
import json, math, os, sys
from collections import defaultdict, Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_pgh as B

ROOT = B.ROOT
DENSE_M = 40          # an edge shorter than this joins two junctions into one cluster
MINOR = {'service', 'footway', 'path', 'cycleway', 'pedestrian', 'track', 'bridleway', 'living_street'}
LINKS = {'primary_link', 'secondary_link', 'tertiary_link', 'trunk', 'trunk_link'}
CLEAR_M = 10          # a river bridge's deck should be at least this far above the pool
STEP_JUMP = 8         # % grade change where a deck meets the street that reads as a kink


def main():
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', 'pgh.json')))
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        nodes, chains, jpos, cor = B.build(cfg)
        E, jh = B.heights(cfg, nodes, chains, jpos)
    pool = cfg['waterLevelM']
    for k, e in enumerate(E): e['k'] = k
    water_cache = {}
    def is_water(la, lo):
        key = (round(la, 5), round(lo, 5))
        if key not in water_cache: water_cache[key] = B.elevation(la, lo) < pool + 1.2
        return water_cache[key]
    def near_water(la, lo, r=30):
        dl, do = r / 110540, r / cor.kx
        return any(is_water(la + a * dl, lo + b * do) for a, b in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)))

    # ---------------------------------------------------------------- dead ends and dead-end branches
    inc = defaultdict(set)
    for e in E: inc[e['a']].add(e['k']); inc[e['b']].add(e['k'])
    deg = {n: sum(1 for k in ks for end in (E[k]['a'], E[k]['b']) if end == n) for n, ks in inc.items()}
    leaves = [n for n, d in deg.items() if d == 1]
    alive, d2 = set(range(len(E))), dict(deg)
    stack, dead = list(leaves), set()
    while stack:
        n = stack.pop()
        if d2.get(n, 0) != 1: continue
        k = next(k for k in inc[n] if k in alive)
        alive.discard(k); dead.add(k)
        e = E[k]
        for end in (e['a'], e['b']):
            d2[end] -= 1
            if d2[end] == 1: stack.append(end)
    edge_of_corridor = sum(1 for n in leaves if cor.dist(*jpos[n], cfg['corridorM'] + 10) > cfg['corridorM'] - 80)
    # branches: connected groups of dead edges
    br_parent = {}
    def bf(x):
        while br_parent.get(x, x) != x: x = br_parent[x]
        return x
    for k in dead:
        for end in (E[k]['a'], E[k]['b']):
            if d2.get(end, 0) == 0:   # a node inside the dead tree (not on the core): joins the edges at it
                pass
        br_parent.setdefault(k, k)
    by_node = defaultdict(list)
    for k in dead:
        for end in (E[k]['a'], E[k]['b']):
            if d2.get(end, 0) == 0: by_node[end].append(k)
    for ks in by_node.values():
        for k in ks[1:]: br_parent[bf(k)] = bf(ks[0])
    branches = defaultdict(list)
    for k in dead: branches[bf(k)].append(k)
    blen = sorted((sum(E[k]['L'] for k in ks) for ks in branches.values()), reverse=True)

    # ---------------------------------------------------------------- dense clusters and what could go (on the loops)
    core = [E[k] for k in alive]
    cdeg = defaultdict(int)
    for e in core: cdeg[e['a']] += 1; cdeg[e['b']] += 1
    parent = {}
    def f(x):
        while parent.get(x, x) != x: parent[x] = parent.get(parent[x], parent[x]); x = parent[x]
        return x
    for e in core:
        if e['L'] < DENSE_M and e['a'] != e['b']: parent[f(e['a'])] = f(e['b'])
    clusters = defaultdict(set)
    for e in core:
        for n in (e['a'], e['b']): clusters[f(n)].add(n)
    dense = [c for c in clusters.values() if len(c) >= 3]
    in_dense = {n: i for i, c in enumerate(dense) for n in c}

    adj = defaultdict(list)
    for e in core: adj[e['a']].append(e['k']); adj[e['b']].append(e['k'])
    removed = set()
    def still_connected(k):
        e = E[k]
        if e['a'] == e['b']: return True
        seen, st = {e['a']}, [e['a']]
        while st:
            x = st.pop()
            for j in adj[x]:
                if j == k or j in removed: continue
                o = E[j]
                for y in (o['a'], o['b']):
                    if y == e['b']: return True
                    if y not in seen: seen.add(y); st.append(y)
        return False
    def try_remove(k, why, out):
        e = E[k]
        if k in removed: return
        if cdeg[e['a']] < 3 or cdeg[e['b']] < 3: return   # (leaves no new dead end)
        if not still_connected(k): return
        removed.add(k); cdeg[e['a']] -= 1; cdeg[e['b']] -= 1
        out.append((k, why))
    simplify = []
    # 1. turn slips and boulevard crossing pieces (links), short trail / crosswalk bits
    for e in sorted(core, key=lambda e: e['L']):
        if e['hw'] in LINKS and e['L'] < 150: try_remove(e['k'], 'turn slip / link', simplify)
    for e in sorted(core, key=lambda e: e['L']):
        if e['kind'] == 'path' and e['L'] < DENSE_M: try_remove(e['k'], 'short trail or crosswalk piece', simplify)
    # 2. short minor edges inside dense clusters (alleys, service, paths), shortest first
    for e in sorted(core, key=lambda e: e['L']):
        if e['L'] < DENSE_M and (e['hw'] in MINOR or e['kind'] == 'alley') and (e['a'] in in_dense or e['b'] in in_dense):
            try_remove(e['k'], 'short minor way in a dense cluster', simplify)
    # 3. other short edges inside dense clusters (a street stub between two junctions a few metres apart)
    for e in sorted(core, key=lambda e: e['L']):
        if e['L'] < 25 and e['a'] in in_dense and e['b'] in in_dense:
            try_remove(e['k'], 'very short link inside a dense cluster', simplify)
    # 4. optional: every alley still on a loop (a big simplification; Pittsburgh's "Ways")
    alleys = []
    for e in sorted(core, key=lambda e: e['L']):
        if e['kind'] == 'alley': try_remove(e['k'], 'alley', alleys)
    # cascade: removing ways leaves no new dead ends by construction (both ends kept ≥ 2 ways)

    # ---------------------------------------------------------------- disconnected pieces (left out by the build)
    pieces = []
    for es in B.REVIEW.get('pieces', []):
        L = sum(e['len'] for e in es)
        names = Counter(e['name'] for e in es if e['name']).most_common(2)
        pieces.append({'km': round(L / 1000, 2), 'names': [n for n, _ in names], 'kinds': dict(Counter(e['hw'] for e in es)),
                       'lines': [[[round(nodes[r][0], 6), round(nodes[r][1], 6)] for r in e['refs']] for e in es]})

    # ---------------------------------------------------------------- rivers and bridges
    river = []
    def add(kind, e, i, msg, sev='fail'):
        river.append({'kind': kind, 'edge': e['k'], 'name': e['name'], 'lat': round(e['lat'][i], 6), 'lon': round(e['lon'][i], 6), 'msg': msg, 'sev': sev})
    bridge_edges = 0
    for e in E:
        n, ele, br = e['n'], e['ele'], e['br']
        runs, i = [], 0
        while i <= n:
            if br[i]:
                j = i
                while j + 1 <= n and br[j + 1]: j += 1
                runs.append((i, j)); i = j + 1
            else: i += 1
        if runs: bridge_edges += 1
        for a, b in runs:
            over = [i for i in range(a, b + 1) if is_water(e['lat'][i], e['lon'][i])]
            if over:
                clear = min(ele[i] for i in over) - pool
                if clear < CLEAR_M: add('low-deck', e, over[len(over) // 2], f'deck {clear:.1f} m above the river (want ≥ {CLEAR_M} m)')
            for end, inner, outer in ((a, a + 1, a - 1), (b, b - 1, b + 1)):
                if 0 <= outer <= n and 0 <= inner <= n:
                    g_in = (ele[inner] - ele[end]) * (1 if inner > end else -1) * 10
                    g_out = (ele[end] - ele[outer]) * (1 if end > outer else -1) * 10
                    if abs(g_in - g_out) > STEP_JUMP: add('deck-kink', e, end, f'grade changes {abs(g_in - g_out):.0f} % where the deck meets the street')
        # streets on the river / dips beside it (not on decks)
        for i in range(n + 1):
            if br[i]: continue
            if is_water(e['lat'][i], e['lon'][i]) and ele[i] < pool + 4:
                add('in-river', e, i, f'street at {ele[i] - pool:.1f} m above the pool where the terrain reads river (a river wall)'); break
        for i in range(3, n - 2):
            if br[i] or not near_water(e['lat'][i], e['lon'][i]): continue
            lo = ele[i]; around = max(min(ele[i - 3:i]), min(ele[i + 1:i + 4]))
            if around - lo > 1.5:
                add('river-dip', e, i, f'dips {around - lo:.1f} m beside the river', 'warn'); break
    # near-level crossings (from the QC on the written graph)
    js = json.load(open(os.path.join(ROOT, 'routes', 'cities', 'pgh.json')))
    sys.path.insert(0, ROOT)
    import subprocess
    q = subprocess.run(['node', '-e', "import('./tools/qc_pgh.mjs').then(async (m) => { const j = JSON.parse(require('fs').readFileSync('routes/cities/pgh.json', 'utf8')); const r = m.qcGraph(j, { rides: 0 }); console.log(JSON.stringify(r.warns.filter((w) => w.check === 'crossing'))); })"],
                       cwd=ROOT, capture_output=True, text=True)
    crossings = json.loads(q.stdout or '[]')
    for c in crossings: river.append({'kind': 'crossing', 'name': c['name'], 'lat': c['lat'], 'lon': c['lon'], 'msg': c['msg'], 'sev': 'fail'})

    # ---------------------------------------------------------------- summary + geometry
    km = lambda ks: round(sum(E[k]['L'] for k in ks) / 1000, 1)
    by_why = Counter(w for _, w in simplify)
    summary = {
        'network': {'junctions': len(jpos), 'edges': len(E), 'km': km(range(len(E)))},
        'deadEnds': {'junctions': len(leaves), 'atCorridorEdge': edge_of_corridor, 'branches': len(branches), 'edges': len(dead), 'km': km(dead),
                     'branchKm': {'<50 m': sum(1 for x in blen if x < 50), '50–200 m': sum(1 for x in blen if 50 <= x < 200), '200–500 m': sum(1 for x in blen if 200 <= x < 500), '≥500 m': sum(1 for x in blen if x >= 500)}},
        'disconnected': {'pieces': len(pieces), 'km': round(sum(p['km'] for p in pieces), 1), 'largest': sorted(pieces, key=lambda p: -p['km'])[:5] and [{'km': p['km'], 'names': p['names']} for p in sorted(pieces, key=lambda p: -p['km'])[:5]]},
        'dense': {'clusters': len(dense), 'junctionsInClusters': sum(len(c) for c in dense), 'biggest': max((len(c) for c in dense), default=0),
                  'remove': {w: {'edges': n, 'km': km([k for k, x in simplify if x == w])} for w, n in by_why.items()}},
        'alleys': {'edges': len(alleys), 'km': km([k for k, _ in alleys])},
        'river': dict(Counter(r['kind'] for r in river)), 'bridgeEdges': bridge_edges,
    }
    after = set(range(len(E))) - dead - {k for k, _ in simplify}
    deg_after = defaultdict(int)
    for k in after: deg_after[E[k]['a']] += 1; deg_after[E[k]['b']] += 1
    summary['after'] = {'edges': len(after), 'km': km(after), 'junctionsWithChoice': sum(1 for n, d in deg_after.items() if d >= 3),
                        'withAlleysToo': {'edges': len(after) - len(alleys), 'km': round(km(after) - km([k for k, _ in alleys]), 1)}}
    line = lambda e: [[round(a, 6), round(b, 6)] for a, b in zip(e['lat'][::2] + [e['lat'][-1]], e['lon'][::2] + [e['lon'][-1]])]
    status = {}
    for k in dead: status[k] = 'deadend'
    for k, w in simplify: status[k] = 'simplify'
    for k, w in alleys: status[k] = 'alley'
    whys = dict(simplify + alleys)
    out = {'summary': summary, 'pool': pool,
           'edges': [{'k': e['k'], 'name': e['name'], 'kind': e['kind'], 'hw': e['hw'], 'L': round(e['L']), 'status': status.get(e['k'], 'keep'),
                      'why': whys.get(e['k']), 'line': line(e)} for e in E],
           'leaves': [[round(jpos[n][0], 6), round(jpos[n][1], 6)] for n in leaves],
           'dense': [[[round(jpos[n][0], 6), round(jpos[n][1], 6)] for n in c] for c in dense],
           'pieces': pieces, 'river': river}
    os.makedirs(os.path.join(ROOT, 'tools', '.cache'), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, 'tools', '.cache', 'pgh-review.json'), 'w'), separators=(',', ':'))
    print(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
