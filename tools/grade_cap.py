#!/usr/bin/env python3
"""Caps a road graph's grades to what real roads have (user, 23 Nov: "smooth to real grades" — CNY / SKAN had 40 %+
spots on Glen Haven Road, Moon Hill Road and the Cherry Valley Turnpike: the elevation tiles sample the hillside or
the gully beside a road cut into it, and a junction's height comes with them).

  python3 tools/grade_cap.py routes/cities/skan.json [--max 18] [--step 20]

1. Junction heights relaxed: wherever an edge's two ends differ by more than --max % of its length, both move toward
   each other (half the excess each, a junction of many edges a little less), repeated until none does.
2. Each edge: its profile shifted onto the new junction heights (the offsets blended along it, no step at a junction),
   then no steeper than --max % between samples --step m apart (forward from the start, back from the end).
Bridge decks keep their own heights. Prints the steepest spots before and after. Writes the file in place.
"""
import json, math, sys
from itertools import accumulate

args = sys.argv[1:]
path = args[0]
opt = lambda k, d: float(args[args.index(k) + 1]) if k in args else d
CAP, STEP = opt('--max', 18) / 100, opt('--step', 20)

d = json.load(open(path))
U = d['unit']; ul, ue = U['latlon'], U['ele']
nodes = {n['id']: n for n in d['nodes']}


def decode(e):
    la = [v * ul for v in accumulate(e['lat'])]; lo = [v * ul for v in accumulate(e['lon'])]; el = [v * ue for v in accumulate(e['ele'])]
    kx = 111320 * math.cos(math.radians(la[0])); s = [0.0]
    for i in range(1, len(la)): s.append(s[-1] + math.hypot((lo[i] - lo[i - 1]) * kx, (la[i] - la[i - 1]) * 110540))
    return la, lo, el, s


def deck(e, i):
    return any(a <= i <= b for a, b in e.get('bridges') or [])


def worst(E):
    out = []
    for e, (la, lo, el, s) in E:
        j = 0
        for i in range(len(s)):
            while s[i] - s[j] > 100: j += 1
            if s[i] - s[j] >= 60: out.append((abs(el[i] - el[j]) / (s[i] - s[j]), e.get('name') or e['kind'], round(la[i], 4), round(lo[i], 4)))
    out.sort(reverse=True)
    seen, top = set(), []
    for g, n, a, b in out:
        if n in seen: continue
        seen.add(n); top.append(f'{n} {g * 100:.0f}% ({a}, {b})')
        if len(top) == 6: break
    return top


E = [(e, decode(e)) for e in d['edges']]
print('steepest (over 60-100 m) before:', '; '.join(worst(E)))
deg = {}
for e, _ in E: deg[e['from']] = deg.get(e['from'], 0) + 1; deg[e['to']] = deg.get(e['to'], 0) + 1
h = {k: float(n['ele']) for k, n in nodes.items()}
for it in range(200):
    moved = 0
    for e, (la, lo, el, s) in E:
        a, b, L = e['from'], e['to'], max(s[-1], 1)
        if a == b: continue
        ex = abs(h[b] - h[a]) - CAP * L
        if ex <= 0.05: continue
        sg = 1 if h[b] > h[a] else -1
        wa, wb = 1 / deg[a], 1 / deg[b]
        h[a] += sg * ex * wa / (wa + wb); h[b] -= sg * ex * wb / (wa + wb); moved += 1
    if not moved: break
print(f'junctions relaxed in {it + 1} passes; moved {sum(1 for k in h if abs(h[k] - nodes[k]["ele"]) > .5)} by over 0.5 m (most {max(abs(h[k] - nodes[k]["ele"]) for k in h):.1f} m)')
for k, n in nodes.items(): n['ele'] = round(h[k], 1)

for e, (la, lo, el, s) in E:
    n = len(el) - 1
    if n < 1: continue
    d0, d1, L = h[e['from']] - el[0], h[e['to']] - el[-1], max(s[-1], 1e-6)
    sm = [el[i] + d0 * (1 - s[i] / L) + d1 * (s[i] / L) for i in range(n + 1)]
    sm[0], sm[n] = h[e['from']], h[e['to']]
    for _ in range(3):
        for i in range(1, n):   # forward: from the start
            if deck(e, i): continue
            j = i - 1
            while j > 0 and s[i] - s[j] < STEP: j -= 1
            g = CAP * max(s[i] - s[j], 1)
            sm[i] = min(max(sm[i], sm[j] - g), sm[j] + g)
        for i in range(n - 1, 0, -1):   # back: from the end
            if deck(e, i): continue
            j = i + 1
            while j < n and s[j] - s[i] < STEP: j += 1
            g = CAP * max(s[j] - s[i], 1)
            sm[i] = min(max(sm[i], sm[j] - g), sm[j] + g)
    q = [round(v / ue) for v in sm]
    e['ele'] = [q[0]] + [q[i] - q[i - 1] for i in range(1, len(q))]

E = [(e, decode(e)) for e in d['edges']]
print('steepest after:', '; '.join(worst(E)))
text = json.dumps(d, separators=(',', ':'))
open(path, 'w').write(text)
