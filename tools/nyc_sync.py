#!/usr/bin/env python3
"""NYC: carry tools/city/nyc.json's look into the built map (routes/cities/nyc.json) without rebuilding its network —
the profile, the pools (tools/nyc_pools.py sets their outlines and levels after the network is built) and the
effects. npm run nyc:build runs it after nyc_pools."""
import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
cfg = json.load(open(os.path.join(ROOT, 'tools/city/nyc.json')))
path = os.path.join(ROOT, 'routes/cities/nyc.json')
net = json.load(open(path))
for k in ('profile', 'pools', 'effects'):
    if k in cfg: net[k] = cfg[k]
hj = os.path.join(ROOT, 'routes/cities/nyc-heroes.json')
if os.path.exists(hj): net['pads'] = json.load(open(hj)).get('pads', [])   # (ground pads the landmarks stand on: Bethesda's terrace)
json.dump(net, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f"synced {', '.join(k for k in ('profile', 'pools', 'effects') if k in cfg)} into routes/cities/nyc.json")
