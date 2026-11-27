#!/usr/bin/env python3
"""The plant census (plants phase 5, 27 Nov 2026): what Out West actually plants round a set of places, as numbers a
botanist would recognise — species present, plants per hectare, and shrub and tree canopy cover — held against
published ranges (tools/reference/measured.json plantCover). The census runs in the page (tools/snap_pgh.mjs --eval):
the tiles round each place are streamed in, then every placed plant within RADIUS m is counted from the tree engine.

  python3 tools/reference/plant_census.py outwest [--out tools/reference/outwest-census.json]
"""
import argparse, json, math, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from citylib import warp

RADIUS = 200
# the places (real lat, lon: moved onto the map through its warp), each with the community expected there
# (most places chosen from the map's own land cover — the middle of the largest stand of each cover: map coordinates,
#  "map": true; the rest real coordinates moved through the warp)
PLACES = {'outwest': [
    {'id': 'sage-flat', 'label': 'the largest sagebrush flat (cover 41)', 'lat': 37.157894, 'lon': -112.394423, 'map': True, 'expect': 'sage', 'cover': 'sagebrush'},
    {'id': 'pj-low', 'label': 'a pinyon-juniper stand below 1,700 m (cover 40, Johnson Canyon)', 'lat': 37.107435, 'lon': -112.393409, 'map': True, 'expect': 'pj', 'cover': 'pinyonJuniperTrees'},
    {'id': 'pj-upper', 'label': 'the largest pinyon-juniper stand (cover 40, ~1,880 m: the upper benches)', 'lat': 37.087053, 'lon': -112.446906, 'map': True, 'expect': 'upper', 'cover': 'pinyonJuniperTrees'},
    {'id': 'creek', 'label': 'the creek with the most open water (Johnson Canyon)', 'lat': 37.104921, 'lon': -112.408726, 'map': True, 'expect': 'riparian'},
    {'id': 'dunes', 'label': 'the Coral Pink dunes (cover 5)', 'lat': 37.039916, 'lon': -112.669002, 'map': True, 'expect': 'dune'},
    {'id': 'hancock-plateau', 'label': 'Hancock Road on the Moquith plateau', 'lat': 37.095, 'lon': -112.61, 'expect': 'ponderosa'},
]}

ap = argparse.ArgumentParser(); ap.add_argument('map'); ap.add_argument('--out', default=None); ap.add_argument('--only', nargs='*')
a = ap.parse_args()
W = warp.load(a.map)
EV = """(async()=>{const C=w.city,F=C?.forest,cp=w.camera.position,TL=400,keys=[];
for(let i=Math.floor((cp.x-%(R)d)/TL);i<=Math.floor((cp.x+%(R)d)/TL);i++)for(let j=Math.floor((cp.z-%(R)d)/TL);j<=Math.floor((cp.z+%(R)d)/TL);j++)keys.push(i+','+j);
for(let it=0;it<600&&!keys.every(k=>(C.tiles.get(k)?.built&&!C.tiles.get(k)?.building));it++){C.stream(cp.x,cp.z,80);await new Promise(r=>setTimeout(r,20))}
const sp={};let shrubA=0,treeA=0,n=0;
for(const L of F.tiles.values())for(const t of L){const d=Math.hypot(t.x-cp.x,t.z-cp.z);if(d>%(R)d)continue;n++;
 const b=t.e.box,r=Math.max(b.max.x-b.min.x,b.max.z-b.min.z)*.5*t.s,A=Math.PI*r*r,name=t.e.key.split(':')[0];
 sp[name]=(sp[name]||0)+1;if(t.e.nearOnly)shrubA+=A;else treeA+=A}
const area=Math.PI*%(R)d*%(R)d;
let nearA=0,nearShrubA=0;const G=w.groundCover,GR=G?.radius||48;
if(G)for(let x=-GR;x<=GR;x+=1)for(let z=-GR;z<=GR;z+=1){if(x*x+z*z>GR*GR)continue;nearA++;const o=G.isGrass(cp.x+x,cp.z+z);if(o&&typeof o==='object'&&o.cell===4)nearShrubA+=G.density*Math.min(1,o.d)*Math.PI*Math.pow(.25*(o.w||1),2)*1.03}
for(const L of F.tiles.values())for(const t of L){const d=Math.hypot(t.x-cp.x,t.z-cp.z);if(d>GR||!t.e.nearOnly)continue;const b=t.e.box,r=Math.max(b.max.x-b.min.x,b.max.z-b.min.z)*.5*t.s;nearShrubA+=Math.PI*r*r}
return {shrubCoverNear:nearA?+(100*nearShrubA/nearA).toFixed(1):null,tiles:keys.filter(k=>(C.tiles.get(k)?.built&&!C.tiles.get(k)?.building)).length+'/'+keys.length,plants:n,perHa:+(n/area*1e4).toFixed(1),shrubCover:+(100*shrubA/area).toFixed(1),treeCover:+(100*treeA/area).toFixed(1),species:sp,ground:+(w._groundH(cp.x,cp.z)).toFixed(0),land:C.landAt(cp.x,cp.z)}})()""" % {'R': RADIUS}
measured = json.load(open(os.path.join(ROOT, 'tools', 'reference', 'measured.json'))).get('plantCover', {})
rows = []
for p in PLACES[a.map]:
    if a.only and p['id'] not in a.only: continue
    lat, lon = (p['lat'], p['lon']) if p.get('map') or not W else W.fwd_any(p['lat'], p['lon'])
    tla = lat + 400 / 110540
    spec = f"census-{p['id']}@{lat:.7f},{lon:.7f}@0#{lat:.7f},{lon:.7f},30,{tla:.7f},{lon:.7f},0"
    cmd = ['node', 'tools/snap_pgh.mjs', '--software', '--size', '640x360', '--quality', 'high', '--out', os.path.join(ROOT, 'tools', '.cache', 'census'), '--graph', f'routes/cities/{a.map}.json', spec, '--eval', EV]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env={**os.environ, 'SNAP_WAIT': os.environ.get('SNAP_WAIT', '900000')}, timeout=1800)
    m = re.search(r'eval: (\{.*\})', r.stdout)
    res = json.loads(m.group(1)) if m else {'error': (r.stdout + r.stderr)[-400:]}
    tgt = measured.get(p.get('cover') or '', {}).get('range')
    if tgt and 'shrubCover' in res:
        # (shrubs: the cover the rider rides through — within the ground cover's reach, where the near-field shrubs fill
        #  it; farther out the 3D shrubs alone, sparser: reported as shrubCover)
        got = res['treeCover'] if p['cover'] == 'pinyonJuniperTrees' else res.get('shrubCoverNear') or res['shrubCover']
        res['target'] = {'what': p['cover'], 'range': tgt, 'got': got, 'within': tgt[0] <= got <= tgt[1]}
    rows.append({**p, **res})
    print(p['id'], json.dumps(res)[:400], flush=True)
out = a.out or os.path.join(ROOT, 'tools', 'reference', f'{a.map}-census.json')
if a.only and os.path.exists(out):   # (a partial run keeps the other places' last numbers)
    keep = [r for r in json.load(open(out))['places'] if r['id'] not in {x['id'] for x in rows}]
    rows = sorted(keep + rows, key=lambda r: [p['id'] for p in PLACES[a.map]].index(r['id']) if r['id'] in [p['id'] for p in PLACES[a.map]] else 99)
json.dump({'note': 'GENERATED by tools/reference/plant_census.py: plants within %d m of each place (the tree engine: trees and shrubs); shrubCoverNear: within the ground cover reach (48 m), its shrub cards included' % RADIUS, 'places': rows}, open(out, 'w'), indent=1)
print('wrote', os.path.relpath(out, ROOT))
