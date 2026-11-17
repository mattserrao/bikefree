#!/usr/bin/env python3
"""Place town and col boards along a route from OpenStreetMap, into the scene's "boards" list.

  python3 tools/fetch_osm_corridor.py <id>    # first
  python3 tools/place_boards.py <id>          # rewrites the auto boards in routes/scenes/<id>.json

Town boards: for every named town, village or hamlet within 400 m of the road, the stretch of road where its
buildings line it (buildings within 120 m, gaps under 160 m, at least 6 of them) gets an entry board where it
starts and an end board (red bar) where it stops. Cols: mapped mountain passes and saddles within 80 m of the
road get a summit board with their altitude. Boards with "auto": true are replaced on every run; hand-placed
boards (bends, info) are kept. Data © OpenStreetMap contributors (ODbL).
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from fetch_osm_corridor import route_points, RouteIndex  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    rid = sys.argv[1]
    path = os.path.join(ROOT, 'routes', 'scenes', f'{rid}.json')
    scene = json.load(open(path))
    feat = json.load(open(os.path.join(ROOT, 'tools', '.cache', f'osm-{rid}', 'features.json')))
    pts = route_points(rid)
    idx = RouteIndex(pts)
    total = idx.cum[-1]
    # buildings beside the road, by distance along it
    along = sorted(s for s, d in (idx.near(sum(p[0] for p in b['ring']) / len(b['ring']), sum(p[1] for p in b['ring']) / len(b['ring']), 2) for b in feat['buildings']) if s is not None and d < 120)
    runs = []
    for s in along:
        if runs and s - runs[-1][1] < 160:
            runs[-1][1] = s; runs[-1][2] += 1
        else:
            runs.append([s, s, 1])
    runs = [r for r in runs if r[2] >= 6]
    boards = []
    used = set()
    places = []
    for p in feat['points']:
        t = p['tags']
        if t.get('place') in ('town', 'village', 'hamlet', 'suburb') and t.get('name'):
            s, d = idx.near(p['lat'], p['lon'], 3)
            if s is not None and d < 400:
                places.append((s, t['name'], {'town': 0, 'village': 1, 'suburb': 2, 'hamlet': 3}[t['place']]))
    for r in runs:
        inside = [p for p in places if r[0] - 150 <= p[0] <= r[1] + 150]
        if not inside:
            continue
        name = sorted(inside, key=lambda p: (p[2], abs(p[0] - (r[0] + r[1]) / 2)))[0][1]
        if name in used:
            continue
        used.add(name)
        a, b = max(0, r[0] - 25), min(total - 30, r[1] + 25)
        boards.append({'atM': round(a), 'kind': 'town', 'title': name, 'auto': True})
        if b - a > 120 and b < total - 400:   # no end board at a summit finish
            boards.append({'atM': round(b), 'kind': 'townEnd', 'title': name, 'side': 'left', 'auto': True})
    for p in feat['points']:
        t = p['tags']
        if t.get('mountain_pass') == 'yes' or t.get('natural') == 'saddle':
            s, d = idx.near(p['lat'], p['lon'], 2)
            if s is not None and d < 80 and t.get('name'):
                ele = t.get('ele')
                try:
                    ele = int(round(float(ele)))
                except (TypeError, ValueError):
                    ele = None
                boards.append({'atM': round(max(0, s - 20)), 'kind': 'col', 'title': t['name'], 'alt': ele, 'auto': True})
    keep = [b for b in scene.get('boards', []) if not b.get('auto')]
    scene['boards'] = sorted(keep + boards, key=lambda b: b['atM'])
    json.dump(scene, open(path, 'w'), indent=2, ensure_ascii=False)
    open(path, 'a').write('\n')
    print(f"{rid}: {sum(1 for b in boards if b['kind'] == 'town')} towns, {sum(1 for b in boards if b['kind'] == 'col')} cols, {len(keep)} hand-placed boards kept")
    for b in boards:
        print(f"  {b['atM'] / 1000:7.2f} km  {b['kind']:8s} {b.get('title')}{' ' + str(b.get('alt')) + ' m' if b.get('alt') else ''}")


if __name__ == '__main__':
    main()
