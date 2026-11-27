#!/usr/bin/env python3
"""Matched shots: bikefree rendered from where each reference photo was taken, looking where it looks, through the same
lens (user, 27 Nov 2026: "prove each change with evidence" against the real places).

Reads tools/reference/<map>-views.json (match_view.py: place, heading, field of view, pitch), moves each place onto the
map (a warped map's places move with their piece, tools/citylib/warp.py), and renders it with the snapshot tool at the
photo's aspect, the frame audit (js/world/toolbox/core/frame-audit.js) run on the same view. Writes the renders and
<out>/<map>-shots.json (each shot: photo, render, counters).

  python3 tools/reference/matched_shots.py <map> [--out tools/.cache/ev/shots] [--only file …] [--quality high] [--time afternoon]
"""
import argparse, json, math, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from citylib import warp

ap = argparse.ArgumentParser()
ap.add_argument('map'); ap.add_argument('--out', default=os.path.join(ROOT, 'tools', '.cache', 'ev', 'shots')); ap.add_argument('--only', nargs='*')
ap.add_argument('--quality', default='high'); ap.add_argument('--time', default='afternoon'); ap.add_argument('--width', type=int, default=960)
ap.add_argument('--tag', default=''); ap.add_argument('--probe', default='', help='x,y;x,y in 0–1 screen fractions: what each pixel shows (object, material, land code)'); ap.add_argument('--pre', default='', help='JS run on the world (w, T) before the audit: an experiment'); ap.add_argument('--albedo', action='store_true')
a = ap.parse_args()
views = json.load(open(os.path.join(ROOT, 'tools', 'reference', f'{a.map}-views.json')))
W = warp.load(a.map)
os.makedirs(a.out, exist_ok=True)
graph = f'routes/cities/{a.map}.json'
rows = []
for f, v in views.items():
    if a.only and f not in a.only: continue
    if v.get('skip'): continue
    lat, lon = W.fwd_any(v['lat'], v['lon']) if W else (v['lat'], v['lon'])
    ky, kx = 110540, 111320 * math.cos(math.radians(lat))
    D = 400.0
    h = math.radians(v['heading'])
    tla, tlo = lat + D * math.cos(h) / ky, lon + D * math.sin(h) / kx
    # the target's height: the eye's, plus the pitch over D, as a height above the map's ground there
    if W:
        g0, g1 = W.elevation(lat, lon), W.elevation(tla, tlo)
    else:
        from citylib.warp import Dem
        dem = Dem(); import numpy as np
        g0, g1 = (float(x) for x in dem(np.array([lat, tla]), np.array([lon, tlo])))
    eye = v.get('eyeAboveM', 1.6)
    lu = g0 + eye + D * math.tan(math.radians(v['pitch'])) - g1
    hgt = int(round(a.width / v['aspect'] / 2) * 2)
    stem = re.sub(r'[^A-Za-z0-9]+', '-', os.path.splitext(f)[0]); name = (stem[:28] + '-' + stem[-10:] if len(stem) > 40 else stem) + a.tag
    spec = f'{name}@{lat:.7f},{lon:.7f}@0#{lat:.7f},{lon:.7f},{eye},{tla:.7f},{tlo:.7f},{lu:.2f}'
    ev = (f"(async()=>{{const out0={{}};w.camera.fov={v['vfov']};w.camera.updateProjectionMatrix();w.rider.group.visible=false;if(w.roadRiders){{w.roadRiders.tick=()=>{{}};w.scene.traverse(o=>{{if(/^Road rider/.test(o.name))o.visible=false}})}}"
          f"{a.pre};{{const C=w.city,cp=w.camera.position,TL=400,keys=[];for(let i=Math.floor((cp.x-300)/TL);i<=Math.floor((cp.x+300)/TL);i++)for(let j=Math.floor((cp.z-300)/TL);j<=Math.floor((cp.z+300)/TL);j++)keys.push(i+','+j);for(let it=0;it<400&&C&&!keys.every(k=>(C.tiles.get(k)?.built&&!C.tiles.get(k)?.building));it++){{C.stream(cp.x,cp.z,80);await new Promise(r=>setTimeout(r,20))}}out0.tilesBuilt=C?keys.filter(k=>(C.tiles.get(k)?.built&&!C.tiles.get(k)?.building)).length+'/'+keys.length:null}}const m=await import('/js/world/toolbox/core/frame-audit.js');const out=await {'m.albedoView(w)' if a.albedo else 'm.auditFrame(w)'}||{{}};Object.assign(out,out0);out.groundCover=w.groundCover?.stats||null;{{const F=w.city?.forest,cp=w.camera.position,cnt={{}};let near=0;if(F)for(const L of F.tiles.values())for(const t of L){{const d=Math.hypot(t.x-cp.x,t.z-cp.z);if(d<120){{near++;const n=(t.e?.key||t.sp||'?').split(':')[0];cnt[n]=(cnt[n]||0)+1;const v=new T.Vector3(t.x,t.y,t.z).project(w.camera);if(Math.abs(v.x)<1&&Math.abs(v.y)<1&&v.z<1){{const k='view_tier'+t.tier+'_'+(d<40?'40':d<80?'80':'120');cnt[k]=(cnt[k]||0)+1;if(!cnt.sample)cnt.sample=[t.x-cp.x,t.y-cp.y,t.z-cp.z,t.s,t.tier,t.ik]}}}}}}out.plants120={{near,cnt}}}}const P='{a.probe}';if(P){{const rc=new T.Raycaster();out.probe=P.split(';').map(q=>{{const [x,y]=q.split(',').map(Number);rc.setFromCamera(new T.Vector2(x*2-1,1-y*2),w.camera);const hs=[];w.scene.traverseVisible(o=>{{if(!o.isMesh||o.isInstancedMesh)return;try{{o.raycast(rc,hs)}}catch(e){{}}}});hs.sort((a,b)=>a.distance-b.distance);const h=hs[0];if(!h)return [q,null];const mt=Array.isArray(h.object.material)?h.object.material[0]:h.object.material;return [q,h.object.name||h.object.type,mt.name||mt.type,+h.distance.toFixed(1),w.city?.landAt?.(h.point.x,h.point.z)??w.graphCity?.landAt?.(h.point.x,h.point.z)??null]}})}}return out}})()")
    cmd = ['node', 'tools/snap_pgh.mjs', '--software', '--size', f'{a.width}x{hgt}', '--quality', a.quality, '--out', a.out, '--time', a.time,
           '--graph', graph, spec, '--eval', ev]
    env = {**os.environ, 'SNAP_WAIT': os.environ.get('SNAP_WAIT', '900000')}
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=env, timeout=1800)
    m = re.search(r'eval: (\{.*\})', r.stdout)
    counters = json.loads(m.group(1)) if m else None
    png = os.path.join(a.out, f'pgh-{name}-view.png')
    print(f, '→', png if os.path.exists(png) else 'NO RENDER', (counters or {}).get('calls'), (counters or {}).get('triangles'))
    if not m: print(r.stdout[-800:], r.stderr[-800:])
    if os.environ.get('SNAP_DEBUG'): print('\n'.join(l for l in r.stdout.splitlines() if 'console:' in l and '404' not in l)[:4000])
    rows.append({'photo': f, 'render': png, 'map': a.map, 'view': v, 'counters': counters, 'quality': a.quality, 'time': a.time})
out = os.path.join(a.out, f'{a.map}-shots{a.tag}.json')
prev = json.load(open(out)) if os.path.exists(out) else []
keep = [r for r in prev if r['photo'] not in {x['photo'] for x in rows}]
json.dump(keep + rows, open(out, 'w'), indent=1)
print('wrote', out)
