#!/usr/bin/env python3
"""Record a before/after pair of matched-shot runs as the map's evidence (committed; test/visual-evidence.test.mjs
holds it to tools/reference/budgets.json).

  python3 tools/reference/compare.py <before>/outwest-shots.json
  python3 tools/reference/compare.py <after>/outwest-shots.json
  python3 tools/reference/evidence.py outwest <before>/outwest-shots.json <after>/outwest-shots.json [--note "…"] [--name evidence]

Writes tools/reference/<map>-evidence.json: per photo, the view, the photo's licence, and the before and after
numbers (land and sky stats from compare.py, the frame counters from frame-audit.js). The renders themselves stay out
of the repository (tools/.cache); re-render with matched_shots.py to see them.
"""
import json, os, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COUNTERS = ['calls', 'triangles', 'programs', 'fragmentChars', 'geometryMB', 'textureMB', 'textures', 'overdraw', 'cpuMs', 'shadow', 'bigTextures']


def slim(s):
    c = s.get('counters') or {}
    return {'stats': s.get('stats'), 'counters': {k: c[k] for k in COUNTERS if k in c}, 'quality': s.get('quality'), 'time': s.get('time')}


if __name__ == '__main__':
    city, before, after = sys.argv[1:4]
    note = sys.argv[sys.argv.index('--note') + 1] if '--note' in sys.argv else ''
    B = {s['photo']: s for s in json.load(open(before))}
    A = {s['photo']: s for s in json.load(open(after))}
    rows = []
    for photo in sorted(set(B) & set(A)):
        v = A[photo]['view']
        rows.append({'photo': photo, 'page': v.get('page'), 'license': v.get('license'),
                     'view': {k: v[k] for k in ('lat', 'lon', 'heading', 'hfov', 'pitch', 'fitPx') if k in v},
                     'before': slim(B[photo]), 'after': slim(A[photo])})
    out = {'format': 'bikefree-visual-evidence-1', 'map': city, 'date': datetime.date.today().isoformat(), 'note': note, 'shots': rows}
    name = sys.argv[sys.argv.index('--name') + 1] if '--name' in sys.argv else 'evidence'
    path = os.path.join(ROOT, 'tools', 'reference', f'{city}-{name}.json')
    json.dump(out, open(path, 'w'), indent=1)
    print(f'wrote {os.path.relpath(path, ROOT)}: {len(rows)} shots')
