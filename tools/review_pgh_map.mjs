// The PGH review as a map page (tools/review_pgh.py → tools/.cache/pgh-review.json).
//
//   node tools/review_pgh_map.mjs [--out <folder>]     (default tools/.cache/pgh-review-map/: index.html + data.json)
//
// Layers: kept network, dead-end branches, ways to simplify away, alleys (optional), pieces not connected to the
// network, dense junction clusters, river and bridge problems. Pan and zoom (drag, pinch, wheel); tap a way or a
// marker for what it is.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const out = resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'tools/.cache/pgh-review-map');
const R = JSON.parse(readFileSync(resolve(root, 'tools/.cache/pgh-review.json'), 'utf8'));
const lat0 = 40.44, lon0 = -79.98, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
const P = ([la, lo]) => [Math.round((lo - lon0) * kx), Math.round((la - lat0) * ky)];
const enc = (pts) => { const o = []; let px = 0, py = 0; for (const p of pts) { const [x, y] = P(p); o.push(x - px, y - py); px = x; py = y; } return o; };
const S = { keep: 0, deadend: 1, simplify: 2, alley: 3 };
const data = {
  summary: R.summary,
  ways: R.edges.map((e) => [S[e.status], e.name || '', e.why || '', e.L, enc(e.line), e.hw]),
  pieces: R.pieces.map((p) => [p.km, p.names.join(', '), p.lines.map(enc)]),
  dense: R.dense.map((c) => { const xs = c.map(P); const cx = xs.reduce((s, p) => s + p[0], 0) / xs.length, cy = xs.reduce((s, p) => s + p[1], 0) / xs.length; return [Math.round(cx), Math.round(cy), c.length, Math.round(Math.max(...xs.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) + 12)]; }),
  river: R.river.map((r) => [...P([r.lat, r.lon]), r.kind, r.name || '', r.msg]),
  leaves: R.leaves.map(P),
};
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'data.json'), JSON.stringify(data));

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>PGH road review — what to remove</title>
<style>
:root{--bg:#f6f5f1;--fg:#1d1f23;--mut:#6b6f76;--card:#fffffffa;--line:#e3e1da}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#eceae4;--mut:#9aa0a8;--card:#1f2226f5;--line:#33373d}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden}
canvas{position:fixed;inset:0;width:100%;height:100%;touch-action:none;display:block}
.panel{position:fixed;left:10px;top:10px;max-width:min(360px,calc(100% - 20px));background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;box-shadow:0 4px 18px #0002}
.panel h1{font-size:15px;margin:0 0 2px}.panel .sub{color:var(--mut);font-size:12px;margin-bottom:6px}
.lg{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;user-select:none}
.lg input{margin:0}.sw{width:22px;height:5px;border-radius:3px;flex:none}.dot{width:11px;height:11px;border-radius:50%;flex:none;margin:0 5px}
.lg b{font-weight:600}.lg span.n{color:var(--mut);margin-left:auto;font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}
#tog{position:absolute;right:8px;top:8px;border:0;background:none;color:var(--mut);font-size:13px;cursor:pointer}
#info{position:fixed;left:10px;right:10px;bottom:10px;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;box-shadow:0 4px 18px #0002;display:none}
#info b{display:block;margin-bottom:2px}#info .m{color:var(--mut)}
.tot{border-top:1px solid var(--line);margin-top:6px;padding-top:6px;font-size:12px;color:var(--mut)}
.collapsed .body{display:none}
</style></head><body>
<canvas id="c"></canvas>
<div class="panel" id="panel"><button id="tog">Hide</button>
<h1>PGH review — what to remove</h1><div class="sub">Nothing changed yet. Tap a way or marker for details.</div>
<div class="body" id="legend"></div></div>
<div id="info"></div>
<script>
const COL = { keep:'#9aa1ab', deadend:'#e0332f', simplify:'#f08a00', alley:'#d9b300', piece:'#8b3fd1', dense:'#ff4fa3', river:'#1673e6', leaf:'#e0332f' };
const KIND = { 'low-deck':'Bridge deck too low over the river', 'deck-kink':'Kink where a deck meets the street', 'in-river':'Street on the river (river wall read as water)', 'crossing':'Ways cross at nearly the same height, no junction', 'river-dip':'Dip beside the river' };
let D, cam = { x: 0, y: 0, s: 0.08 }, sel = null;
const on = { keep:true, deadend:true, simplify:true, alley:false, piece:true, dense:true, river:true };
const c = document.getElementById('c'), g = c.getContext('2d');
function lines(arr){ const out=[]; let x=0,y=0; for(let i=0;i<arr.length;i+=2){ x+=arr[i]; y+=arr[i+1]; out.push(x,y);} return out; }
fetch('data.json').then(r=>r.json()).then(d=>{
  D=d; const ST=['keep','deadend','simplify','alley'];
  D.W = d.ways.map(w=>({ st:ST[w[0]], name:w[1], why:w[2], L:w[3], p:lines(w[4]), hw:w[5] }));
  D.P = d.pieces.map(p=>({ km:p[0], name:p[1], ls:p[2].map(lines) }));
  for (const o of [...D.W, ...D.P.flatMap(p=>p.ls.map(l=>({p:l,piece:p})))]) { let a=1e9,b=1e9,cc=-1e9,dd=-1e9; for(let i=0;i<o.p.length;i+=2){a=Math.min(a,o.p[i]);cc=Math.max(cc,o.p[i]);b=Math.min(b,o.p[i+1]);dd=Math.max(dd,o.p[i+1]);} o.bb=[a,b,cc,dd]; }
  D.PL = D.P.flatMap(p=>p.ls.map(l=>({p:l,piece:p})));
  for (const o of D.PL) { let a=1e9,b=1e9,cc=-1e9,dd=-1e9; for(let i=0;i<o.p.length;i+=2){a=Math.min(a,o.p[i]);cc=Math.max(cc,o.p[i]);b=Math.min(b,o.p[i+1]);dd=Math.max(dd,o.p[i+1]);} o.bb=[a,b,cc,dd]; }
  legend(); fit(); draw();
});
function km(st){ return (D.W.filter(w=>w.st===st).reduce((s,w)=>s+w.L,0)/1000).toFixed(1); }
function legend(){
  const S=D.summary, rv=D.river.length, cnt=(st)=>D.W.filter(w=>w.st===st).length;
  const rows=[
    ['keep','sw','Kept (after every cut, alleys included)', km('keep')+' km'],
    ['deadend','sw','<b>Dead-end branches</b> (U-turn only)', cnt('deadend')+' ways · '+km('deadend')+' km'],
    ['simplify','sw','<b>Simplify</b>: slips, crosswalk bits, short ways in tight clusters', cnt('simplify')+' · '+km('simplify')+' km'],
    ['alley','sw','Alleys (optional extra cut)', cnt('alley')+' · '+km('alley')+' km'],
    ['piece','sw','<b>Not connected</b> to the network', D.P.length+' pieces · '+S.disconnected.km+' km'],
    ['dense','dot','Dense junction clusters', S.dense.clusters+''],
    ['river','dot','<b>River &amp; bridge problems</b>', rv+''],
  ];
  document.getElementById('legend').innerHTML = rows.map(([k,t,l,n])=>'<label class="lg"><input type="checkbox" data-k="'+k+'" '+(on[k]?'checked':'')+'><span class="'+t+'" style="background:'+COL[k]+'"></span><span>'+l+'</span><span class="n">'+n+'</span></label>').join('')
    + '<div class="tot">Removing dead ends + simplify: '+S.after.edges.toLocaleString()+' ways, '+S.after.km+' km left; with alleys too: '+S.after.withAlleysToo.km+' km.</div>';
  for (const i of document.querySelectorAll('#legend input')) i.onchange=()=>{ on[i.dataset.k]=i.checked; draw(); };
}
document.getElementById('tog').onclick=()=>{ const p=document.getElementById('panel'); p.classList.toggle('collapsed'); document.getElementById('tog').textContent=p.classList.contains('collapsed')?'Show':'Hide'; };
function fit(){ let a=1e9,b=1e9,cc=-1e9,dd=-1e9; for(const w of D.W){a=Math.min(a,w.bb[0]);b=Math.min(b,w.bb[1]);cc=Math.max(cc,w.bb[2]);dd=Math.max(dd,w.bb[3]);} cam.x=(a+cc)/2; cam.y=(b+dd)/2; cam.s=Math.min(innerWidth/(cc-a),innerHeight/(dd-b))*0.95; }
function sx(x){ return (x-cam.x)*cam.s+innerWidth/2; } function sy(y){ return -(y-cam.y)*cam.s+innerHeight/2; }
function view(){ const hw=innerWidth/2/cam.s, hh=innerHeight/2/cam.s; return [cam.x-hw-50,cam.y-hh-50,cam.x+hw+50,cam.y+hh+50]; }
const vis=(bb,v)=>!(bb[2]<v[0]||bb[0]>v[2]||bb[3]<v[1]||bb[1]>v[3]);
function path(p){ g.beginPath(); g.moveTo(sx(p[0]),sy(p[1])); for(let i=2;i<p.length;i+=2) g.lineTo(sx(p[i]),sy(p[i+1])); g.stroke(); }
function draw(){
  if(!D) return;
  const dpr=devicePixelRatio||1; c.width=innerWidth*dpr; c.height=innerHeight*dpr; g.setTransform(dpr,0,0,dpr,0,0);
  const dark=matchMedia('(prefers-color-scheme:dark)').matches; g.fillStyle=dark?'#15171a':'#f6f5f1'; g.fillRect(0,0,innerWidth,innerHeight);
  const v=view(), z=Math.max(0.6,Math.min(4,cam.s*12)); g.lineCap='round'; g.lineJoin='round';
  if(on.dense){ g.fillStyle=COL.dense+'33'; g.strokeStyle=COL.dense; g.lineWidth=1; for(const d of D.dense){ const r=Math.max(4,d[3]*cam.s); g.beginPath(); g.arc(sx(d[0]),sy(d[1]),r,0,7); g.fill(); g.stroke(); } }
  for (const st of ['keep','alley','simplify','deadend']) { if(!on[st]) continue; g.strokeStyle=COL[st]; g.lineWidth=st==='keep'?Math.max(0.6,z*0.5):z*1.4; for(const w of D.W) if(w.st===st&&vis(w.bb,v)) path(w.p); }
  if(on.piece){ g.strokeStyle=COL.piece; g.lineWidth=z*1.4; for(const o of D.PL) if(vis(o.bb,v)) path(o.p); }
  if(on.deadend&&cam.s>0.25){ g.fillStyle=COL.leaf; for(const l of D.leaves){ g.beginPath(); g.arc(sx(l[0]),sy(l[1]),2.2,0,7); g.fill(); } }
  if(on.river){ for(const r of D.river){ g.beginPath(); g.arc(sx(r[0]),sy(r[1]),5,0,7); g.fillStyle=COL.river; g.fill(); g.lineWidth=1.5; g.strokeStyle='#fff'; g.stroke(); } }
  if(sel){ g.strokeStyle=dark?'#fff':'#000'; g.lineWidth=z*2.6; g.globalAlpha=.5; if(sel.p) path(sel.p); else if(sel.ls) sel.ls.forEach(path); g.globalAlpha=1; }
}
function segd(px,py,ax,ay,bx,by){ const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy||1; let t=((px-ax)*dx+(py-ay)*dy)/l; t=Math.max(0,Math.min(1,t)); return Math.hypot(px-ax-t*dx,py-ay-t*dy); }
function pick(px,py){
  const x=(px-innerWidth/2)/cam.s+cam.x, y=-(py-innerHeight/2)/cam.s+cam.y, tol=14/cam.s; let best=null,bd=tol;
  if(on.river) for(const r of D.river){ const d=Math.hypot(r[0]-x,r[1]-y); if(d<bd*1.2){bd=d; best={t:'river',r};} }
  if(best) return best;
  const test=(o,t)=>{ if(o.bb[0]-tol>x||o.bb[2]+tol<x||o.bb[1]-tol>y||o.bb[3]+tol<y) return; for(let i=2;i<o.p.length;i+=2){ const d=segd(x,y,o.p[i-2],o.p[i-1],o.p[i],o.p[i+1]); if(d<bd){bd=d;best={t,o};} } };
  if(on.piece) for(const o of D.PL) test(o,'piece');
  for(const st of ['deadend','simplify','alley','keep']) if(on[st]) for(const w of D.W) if(w.st===st) test(w,'way');
  return best;
}
function show(h){
  const el=document.getElementById('info'); sel=null;
  if(!h){ el.style.display='none'; draw(); return; }
  let t='';
  if(h.t==='river'){ t='<b>'+(KIND[h.r[2]]||h.r[2])+'</b>'+(h.r[3]?h.r[3]+' · ':'')+'<span class="m">'+h.r[4]+'</span>'; }
  else if(h.t==='piece'){ sel=h.o.piece; t='<b>Not connected to the network</b>'+(h.o.piece.name||'Unnamed ways')+' · <span class="m">'+h.o.piece.km+' km, left out of PGH</span>'; }
  else { const w=h.o; sel=w; const lab={keep:'Kept',deadend:'Dead-end branch — remove',simplify:'Simplify — remove',alley:'Alley — optional remove'}[w.st];
    t='<b>'+lab+'</b>'+(w.name||'Unnamed')+' <span class="m">('+(w.hw||'')+', '+w.L+' m)'+(w.why?' · '+w.why:'')+'</span>'; }
  el.innerHTML=t; el.style.display='block'; draw();
}
// pan / zoom
const pts=new Map(); let moved=false, last=null;
c.addEventListener('pointerdown',e=>{ c.setPointerCapture(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]); moved=false; last=null; });
c.addEventListener('pointermove',e=>{ if(!pts.has(e.pointerId)) return; const p=pts.get(e.pointerId); const nx=e.clientX, ny=e.clientY;
  if(pts.size===1){ const dx=nx-p[0], dy=ny-p[1]; if(Math.abs(dx)+Math.abs(dy)>3) moved=true; cam.x-=dx/cam.s; cam.y+=dy/cam.s; }
  else if(pts.size===2){ const [a,b]=[...pts.values()]; const d0=Math.hypot(a[0]-b[0],a[1]-b[1]); pts.set(e.pointerId,[nx,ny]); const [a2,b2]=[...pts.values()]; const d1=Math.hypot(a2[0]-b2[0],a2[1]-b2[1]); zoomAt((a2[0]+b2[0])/2,(a2[1]+b2[1])/2,d1/(d0||1)); moved=true; draw(); return; }
  pts.set(e.pointerId,[nx,ny]); draw(); });
c.addEventListener('pointerup',e=>{ if(pts.size===1&&!moved) show(pick(e.clientX,e.clientY)); pts.delete(e.pointerId); });
c.addEventListener('pointercancel',e=>pts.delete(e.pointerId));
function zoomAt(px,py,f){ const x=(px-innerWidth/2)/cam.s+cam.x, y=-(py-innerHeight/2)/cam.s+cam.y; cam.s=Math.max(0.01,Math.min(30,cam.s*f)); cam.x=x-(px-innerWidth/2)/cam.s; cam.y=y+(py-innerHeight/2)/cam.s; }
c.addEventListener('wheel',e=>{ e.preventDefault(); zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*0.0015)); draw(); },{passive:false});
addEventListener('resize',draw);
</script></body></html>`;
writeFileSync(resolve(out, 'index.html'), html);
console.log(`wrote ${out}/index.html + data.json (${(JSON.stringify(data).length / 1e6).toFixed(2)} MB)`);
