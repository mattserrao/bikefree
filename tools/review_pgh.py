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
CLEAR_M = 9.5         # a river bridge's deck should be about bridgeClearM above the pool (half a metre's slack)
STEP_JUMP = 8         # % grade change where a deck meets the street that reads as a kink


def main():
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'city', 'pgh.json')))
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        nodes, E, jpos, jh, cor = B.build_all(cfg)   # the graph as written (simplified, crossings cleared)
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

    # ---------------------------------------------------------------- dense clusters and what could still go (a dry run of the build's own plan)
    G = B.Graph(E)
    # (on the graph as it is: dead ends stay)
    dense = B.dense_nodes(cfg, E, G.gone)
    plan = B.simplify_plan(cfg, E, G)
    simplify = [(k, w) for k, w in plan if w != 'alley']
    alleys = [(k, w) for k, w in plan if w == 'alley']

    # ---------------------------------------------------------------- disconnected pieces (left out by the build)
    pieces = []
    for es in []:   # (user, 21 Nov: pieces not in the network are removed, not reported — the build already leaves them out)
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
        # (bridge decks: no rules for now — the user, 21 Nov: bridges are fine)
        # streets on the river / dips beside it (not on decks)
        for i in range(n + 1):
            if br[i]: continue
            if is_water(e['lat'][i], e['lon'][i]) and ele[i] < pool + cfg['riverFloorM'] - 0.1:
                add('in-river', e, i, f'street at {ele[i] - pool:.1f} m above the pool where the terrain reads river (a river wall)'); break
        for i in range(3, n - 2):
            if br[i] or not near_water(e['lat'][i], e['lon'][i]): continue
            lo = ele[i]; around = max(min(ele[i - 3:i]), min(ele[i + 1:i + 4]))
            if around - lo > 1.5:
                add('river-dip', e, i, f'dips {around - lo:.1f} m beside the river', 'warn'); break
    # near-level crossings (from the QC on the written graph)
    for ko, so, ku, su, gap in B.find_crossings(E, (), cfg['overpassClearM']):
        eo, eu = E[ko], E[ku]
        i = min(eo['n'], round(so / (eo['L'] / eo['n'])))
        river.append({'kind': 'crossing', 'name': f"{eo['name']} over {eu['name']}", 'lat': round(eo['lat'][i], 6), 'lon': round(eo['lon'][i], 6),
                      'msg': f'only {gap:.1f} m between them (want ≥ {cfg["overpassClearM"]} m), no junction', 'sev': 'fail'})

    # ---------------------------------------------------------------- overlapping roads
    # two ways whose drawn ribbons overlap (centre lines closer than half their widths added up, at about the same height),
    # away from the junctions they share: parallel ways drawn on top of each other
    W = cfg['widths']
    RANK = {'path': 0, 'plaza': 0, 'alley': 1, 'residential': 2, 'tertiary': 3, 'secondary': 4, 'primary': 5}
    kx, ky = cor.kx, 110540
    pts = defaultdict(list)
    for k, e in enumerate(E):
        for i in range(e['n'] + 1): pts[(int(e['lon'][i] * kx / 20), int(e['lat'][i] * ky / 20))].append((k, i))
    pair_hits = defaultdict(list)   # (ka, kb) → [(ia, ib)]
    for k, e in enumerate(E):
        sp = e['L'] / max(1, e['n'])
        for i in range(e['n'] + 1):
            if min(i, e['n'] - i) * sp < 15: continue   # (near its own junctions: ways meet there)
            x, y = e['lon'][i] * kx, e['lat'][i] * ky
            cx, cy = int(x / 20), int(y / 20)
            for a in (-1, 0, 1):
                for b in (-1, 0, 1):
                    for k2, j in pts.get((cx + a, cy + b), ()):
                        if k2 <= k: continue
                        o = E[k2]
                        sp2 = o['L'] / max(1, o['n'])
                        if min(j, o['n'] - j) * sp2 < 15: continue
                        d = math.hypot(o['lon'][j] * kx - x, o['lat'][j] * ky - y)
                        if d < (W.get(e['kind'], 7) + W.get(o['kind'], 7)) / 2 + 0.5 and abs(o['ele'][j] - e['ele'][i]) < 3:
                            pair_hits[(k, k2)].append((i, j))
    Gx = B.Graph(E)
    overlaps = []
    for (ka, kb), hits in pair_hits.items():
        ia = sorted({i for i, _ in hits}); ib = sorted({j for _, j in hits})
        lenm = max(len(ia) * E[ka]['L'] / max(1, E[ka]['n']), len(ib) * E[kb]['L'] / max(1, E[kb]['n']))
        if lenm < 20: continue   # (a crossing, not an overlap)
        ea, eb = E[ka], E[kb]
        minor = min((ka, kb), key=lambda k: (RANK.get(E[k]['kind'], 2), E[k]['L']))
        major = kb if minor == ka else ka
        ok = Gx.can_remove(minor)
        if not ok and Gx.can_remove(major): minor, major, ok = major, minor, True
        overlaps.append({'a': ka, 'b': kb, 'm': round(lenm), 'names': [ea['name'] or ea['kind'], eb['name'] or eb['kind']],
                         'kinds': [ea['kind'], eb['kind']], 'remove': minor, 'removable': ok,
                         'segA': [[round(ea['lat'][i], 6), round(ea['lon'][i], 6)] for i in range(ia[0], ia[-1] + 1)],
                         'segB': [[round(eb['lat'][j], 6), round(eb['lon'][j], 6)] for j in range(ib[0], ib[-1] + 1)],
                         'lat': round(ea['lat'][ia[len(ia) // 2]], 6), 'lon': round(ea['lon'][ia[len(ia) // 2]], 6)})
    # areas: overlaps within 150 m of each other
    par = list(range(len(overlaps)))
    def fo(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    for i, o in enumerate(overlaps):
        for j in range(i):
            if B.hv((o['lat'], o['lon']), (overlaps[j]['lat'], overlaps[j]['lon'])) < 150: par[fo(i)] = fo(j)
    areas = defaultdict(list)
    for i in range(len(overlaps)): areas[fo(i)].append(i)
    overlap_areas = sorted(({'n': len(ix), 'm': sum(overlaps[i]['m'] for i in ix), 'lat': round(sum(overlaps[i]['lat'] for i in ix) / len(ix), 6),
                             'lon': round(sum(overlaps[i]['lon'] for i in ix) / len(ix), 6),
                             'names': list(dict.fromkeys(nm for i in ix for nm in overlaps[i]['names'] if nm))[:6]} for ix in areas.values()), key=lambda a: -a['m'])

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
        'overlaps': {'pairs': len(overlaps), 'areas': len(overlap_areas), 'm': sum(o['m'] for o in overlaps),
                     'removable': sum(1 for o in overlaps if o['removable']), 'byKinds': dict(Counter('+'.join(sorted(o['kinds'])) for o in overlaps))},
        'deadBridges': {'connected': sum(1 for r in B.REVIEW.get('bridges', []) if r['ok']), 'left': sum(1 for r in B.REVIEW.get('bridges', []) if not r['ok']),
                        'worstKinkPct': max((r.get('kinkPct', 0) for r in B.REVIEW.get('bridges', [])), default=0)},
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
           'pieces': pieces, 'river': river, 'bridges': B.REVIEW.get('bridges', []), 'overlaps': overlaps, 'overlapAreas': overlap_areas}
    os.makedirs(os.path.join(ROOT, 'tools', '.cache'), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, 'tools', '.cache', 'pgh-review.json'), 'w'), separators=(',', ':'))
    print(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
