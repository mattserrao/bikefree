// PGH as a map page (the "PGH road review" artifact): the network by route use, the Pittsburgh routes, the landmarks,
// and the junction ideas (tools/pgh_junctions.mjs). Replaces the cluttered review map (tools/review_pgh_map.mjs).
//
//   node tools/pgh_map_page.mjs [--out <folder>]     (default tools/.cache/pgh-review-map/: index.html + data.json)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeUse } from './pgh_usage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const out = resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'tools/.cache/pgh-review-map');
const load = (f) => { try { return JSON.parse(readFileSync(resolve(root, f), 'utf8')); } catch { return []; } };
const PGH = load('routes/cities/pgh.json'), ROUTES = load('tools/.cache/pgh-routes.json'), MARKS = load('tools/.cache/pgh-landmarks.json');
const JUNC = load('tools/.cache/pgh-junctions.json');
const USE = routeUse(PGH, ROUTES.map((r) => r.line));
const lat0 = 40.44, lon0 = -79.98, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
const P = ([la, lo]) => [Math.round((lo - lon0) * kx), Math.round((la - lat0) * ky)];
const enc = (pts) => { const o = []; let px = 0, py = 0; for (const p of pts) { const [x, y] = P(p); o.push(x - px, y - py); px = x; py = y; } return o; };
const eline = (e) => { const p = []; for (let i = 0; i <= e.n; i++) p.push([e.lat[i], e.lon[i]]); return enc(p); };
const byId = USE.G.byId;
const data = {
  net: USE.G.edges.map((e) => [USE.use.get(e.id), e.name, e.n * 10, eline(e), e.kind, USE.stub.has(e.id) ? 1 : 0]),
  routes: ROUTES.map((r) => [r.name, r.followPct, Math.round(r.pghM / 100) / 10, enc(r.oldLine), enc(r.line)]),
  marks: MARKS.filter((m) => m.found).map((m) => [m.label, m.type, enc(m.poly), ...P(m.center), m.resolution || '']),
  junc: JUNC.map((j) => [j.kind, ...P(j.at), j.msg, j.fix, j.route ? 1 : 0, j.edges.map((id) => eline(byId.get(id))), j.cut ? j.edges.indexOf(j.cut) : -1,
    j.cut && !j.edges.includes(j.cut) ? eline(byId.get(j.cut)) : null]),
};
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'data.json'), JSON.stringify(data));

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>PGH road review</title>
<style>
:root{--bg:#f6f5f1;--fg:#1d1f23;--mut:#6b6f76;--card:#fffffffa;--line:#e3e1da}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#eceae4;--mut:#9aa0a8;--card:#1f2226f5;--line:#33373d}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,system-ui,sans-serif;overflow:hidden}
canvas{position:fixed;inset:0;touch-action:none}
.panel{position:fixed;left:10px;top:10px;width:min(330px,calc(100vw - 20px));background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;box-shadow:0 4px 18px #0002;max-height:calc(100vh - 20px);overflow:auto}
h1{font-size:15px;margin:0 0 2px}.sub{color:var(--mut);font-size:12px;margin-bottom:6px}
.lg{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;user-select:none}.lg .n{margin-left:auto;color:var(--mut);font-size:12px;white-space:nowrap}
.sw{width:18px;height:4px;border-radius:2px;flex:none}.dot{width:10px;height:10px;border-radius:50%;flex:none}
.grp{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:8px 0 2px}
select{width:100%;margin:2px 0 4px;font:inherit;padding:3px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
#info{position:fixed;left:10px;right:10px;bottom:10px;max-width:520px;margin:auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:none;box-shadow:0 4px 18px #0003}
#info b{display:block}#info .m{color:var(--mut);font-size:12.5px}#info .fix{margin-top:4px}
#tog{position:fixed;right:10px;top:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font:inherit;color:var(--fg)}
</style></head><body>
<canvas id="c"></canvas>
<div class="panel" id="panel"><h1>PGH — junctions within the routes</h1><div class="sub">Neatened 21 Nov: the markers are what is left. Tap one for the idea. Blue = ridden by a route, grey = the rest (dashed = dead end).</div><div id="legend"></div></div>
<button id="tog">Layers</button>
<div id="info"></div>
<script>
const COL={ridden:'#1673e6',road:'#9aa1ab',rold:'#e0332f',rnew:'#1673e6',mark:'#12a150',short:'#e0332f',cluster:'#7a3fe0',acute:'#f08a00',busy:'#d6249f',triangle:'#0aa5c2',cut:'#f08a00'};
const KINDS=[['short','Short links','under 25 m between junctions: merge them'],['cluster','Clusters','3+ junctions within 40 m: collapse to one'],['acute','Sharp forks','ways under 25° apart: drop the minor'],['busy','Busy junctions','5+ ways: drop minor ways to 4'],['triangle','Small triangles','under 200 m round: drop the minor side']];
const on={net:true,routes:false,marks:false,short:true,cluster:true,acute:true,busy:true,triangle:true};
let D, cam={x:0,y:0,s:0.08}, sel=null, cur=-1;
const c=document.getElementById('c'), g=c.getContext('2d');
const lines=(a)=>{ const o=new Float32Array(a.length); let x=0,y=0; for(let i=0;i<a.length;i+=2){ x+=a[i]; y+=a[i+1]; o[i]=x; o[i+1]=y; } return o; };
const bbx=(p)=>{ let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(let i=0;i<p.length;i+=2){x0=Math.min(x0,p[i]);x1=Math.max(x1,p[i]);y0=Math.min(y0,p[i+1]);y1=Math.max(y1,p[i+1]);} return [x0,y0,x1,y1]; };
fetch('data.json').then(r=>r.json()).then(d=>{
  D={};
  D.N=d.net.map(w=>{ const r={u:w[0],name:w[1],L:w[2],p:lines(w[3]),kind:w[4],stub:!!w[5]}; r.bb=bbx(r.p); return r; });
  D.RT=d.routes.map(r=>({name:r[0],follow:r[1],km:r[2],old:lines(r[3]),line:lines(r[4])}));
  D.M=d.marks.map(m=>({label:m[0],type:m[1],poly:lines(m[2]),x:m[3],y:m[4],res:m[5]}));
  D.J=d.junc.map(j=>({kind:j[0],x:j[1],y:j[2],msg:j[3],fix:j[4],route:!!j[5],ls:j[6].map(lines),cut:j[7],cutp:j[8]?lines(j[8]):null}));
  legend(); fit(); draw();
});
function legend(){
  const kmOf=(f)=>(D.N.filter(f).reduce((s,w)=>s+w.L,0)/1000).toFixed(0);
  const row=(k,t,col,l,n)=>'<label class="lg"><input type="checkbox" data-k="'+k+'" '+(on[k]?'checked':'')+'><span class="'+t+'" style="background:'+col+'"></span><span>'+l+'</span><span class="n">'+n+'</span></label>';
  let h='<div class="grp">Junction ideas</div>'+KINDS.map(([k,l,f])=>{ const L=D.J.filter(j=>j.kind===k); return row(k,'dot',COL[k],'<b>'+l+'</b> <span class="n" style="margin:0">'+f+'</span>', L.length+''); }).join('');
  h+='<div class="grp">Map</div>'+row('net','sw',COL.ridden,'PGH ('+D.N.length+' ways)',kmOf(()=>true)+' km · '+D.N.filter(w=>w.stub).length+' dead ends');
  h+=row('routes','sw',COL.rold,'Pittsburgh routes (red = old, blue = on PGH)',D.RT.length+'');
  h+='<select id="rsel"><option value="-1">All routes</option>'+D.RT.map((r,i)=>'<option value="'+i+'">'+r.name+' · '+r.km+' km · '+r.follow+' %</option>').join('')+'</select>';
  h+=row('marks','dot',COL.mark,'Landmarks (locations only)',D.M.length+'');
  document.getElementById('legend').innerHTML=h;
  for(const i of document.querySelectorAll('#legend input')) i.onchange=()=>{ on[i.dataset.k]=i.checked; draw(); };
  const rs=document.getElementById('rsel'); rs.value=String(cur); rs.onchange=()=>{ cur=+rs.value; on.routes=true; legend(); if(cur>=0) fitTo(D.RT[cur].line); draw(); };
}
document.getElementById('tog').onclick=()=>{ const p=document.getElementById('panel'); p.style.display=p.style.display==='none'?'block':'none'; };
function fitTo(p){ const [a,b,cc,dd]=bbx(p); cam.x=(a+cc)/2; cam.y=(b+dd)/2; cam.s=Math.min(innerWidth/(cc-a+300),innerHeight/(dd-b+300))*0.9; }
function fit(){ let a=1e9,b=1e9,cc=-1e9,dd=-1e9; for(const w of D.N){a=Math.min(a,w.bb[0]);b=Math.min(b,w.bb[1]);cc=Math.max(cc,w.bb[2]);dd=Math.max(dd,w.bb[3]);} cam.x=(a+cc)/2; cam.y=(b+dd)/2; cam.s=Math.min(innerWidth/(cc-a),innerHeight/(dd-b))*0.95; }
const sx=(x)=>(x-cam.x)*cam.s+innerWidth/2, sy=(y)=>-(y-cam.y)*cam.s+innerHeight/2;
function view(){ const hw=innerWidth/2/cam.s, hh=innerHeight/2/cam.s; return [cam.x-hw-50,cam.y-hh-50,cam.x+hw+50,cam.y+hh+50]; }
const vis=(bb,v)=>!(bb[2]<v[0]||bb[0]>v[2]||bb[3]<v[1]||bb[1]>v[3]);
function path(p){ g.beginPath(); g.moveTo(sx(p[0]),sy(p[1])); for(let i=2;i<p.length;i+=2) g.lineTo(sx(p[i]),sy(p[i+1])); g.stroke(); }
function draw(){
  if(!D) return;
  const dpr=devicePixelRatio||1; c.width=innerWidth*dpr; c.height=innerHeight*dpr; g.setTransform(dpr,0,0,dpr,0,0);
  const dark=matchMedia('(prefers-color-scheme:dark)').matches; g.fillStyle=dark?'#15171a':'#f6f5f1'; g.fillRect(0,0,innerWidth,innerHeight);
  const v=view(), z=Math.max(0.6,Math.min(4,cam.s*12)); g.lineCap='round'; g.lineJoin='round';
  if(on.net){ for(const pass of [1,0]){ g.strokeStyle=pass?COL.road:COL.ridden; g.lineWidth=z*(pass?0.9:1.5); for(const w of D.N) if((w.u===0)!==!!pass&&vis(w.bb,v)){ if(w.stub) g.setLineDash([4,3]); path(w.p); g.setLineDash([]); } } }
  if(on.routes){ const rs=cur<0?D.RT:[D.RT[cur]]; g.lineWidth=z*3; g.strokeStyle=COL.rold; g.globalAlpha=cur<0?.25:.5; for(const r of rs) path(r.old); g.globalAlpha=cur<0?.5:1; g.lineWidth=z*2; g.strokeStyle=COL.rnew; for(const r of rs) path(r.line); g.globalAlpha=1; }
  if(on.marks) for(const m of D.M){ g.fillStyle=COL.mark+'55'; g.strokeStyle=COL.mark; g.lineWidth=1.2; g.beginPath(); for(let i=0;i<m.poly.length;i+=2){ const X=sx(m.poly[i]),Y=sy(m.poly[i+1]); i?g.lineTo(X,Y):g.moveTo(X,Y);} g.closePath(); g.fill(); g.stroke(); }
  if(sel){ g.globalAlpha=.85; g.lineWidth=z*3; g.strokeStyle=dark?'#fff':'#000'; sel.ls.forEach(path); if(sel.cut>=0||sel.cutp){ g.strokeStyle=COL.cut; g.lineWidth=z*3.4; path(sel.cutp||sel.ls[sel.cut]); } g.globalAlpha=1; }
  const r=Math.max(3,Math.min(7,cam.s*40));
  for(const [k] of KINDS) if(on[k]) for(const j of D.J) if(j.kind===k){ g.beginPath(); g.arc(sx(j.x),sy(j.y),j===sel?r+3:r,0,7); g.fillStyle=COL[k]; g.fill(); g.lineWidth=1.5; g.strokeStyle='#fff'; g.stroke(); }
}
function hit(px,py){
  const x=(px-innerWidth/2)/cam.s+cam.x, y=-(py-innerHeight/2)/cam.s+cam.y; let best=null, bd=14/cam.s;
  for(const [k] of KINDS) if(on[k]) for(const j of D.J) if(j.kind===k){ const d=Math.hypot(j.x-x,j.y-y); if(d<bd){bd=d;best=j;} }
  return best;
}
function show(j){
  const el=document.getElementById('info'); sel=j||null;
  if(!j){ el.style.display='none'; draw(); return; }
  const name={short:'Short link',cluster:'Cluster',acute:'Sharp fork',busy:'Busy junction',triangle:'Small triangle'}[j.kind];
  el.innerHTML='<b>'+name+(j.route?' · on a route':'')+'</b><span class="m">'+j.msg+'</span><div class="fix">Idea: '+j.fix+(j.cut>=0||j.cutp?' <span class="m">(orange)</span>':'')+'</div>';
  el.style.display='block'; draw();
}
const pts=new Map(); let moved=false, last=null;
c.addEventListener('pointerdown',e=>{ c.setPointerCapture(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]); moved=false; last=null; });
c.addEventListener('pointermove',e=>{ if(!pts.has(e.pointerId)) return; const p=pts.get(e.pointerId);
  if(pts.size===1){ const dx=e.clientX-p[0], dy=e.clientY-p[1]; if(Math.abs(dx)+Math.abs(dy)>3) moved=true; cam.x-=dx/cam.s; cam.y+=dy/cam.s; }
  pts.set(e.pointerId,[e.clientX,e.clientY]);
  if(pts.size===2){ const [a,b]=[...pts.values()]; const d=Math.hypot(a[0]-b[0],a[1]-b[1]); if(last) zoomAt((a[0]+b[0])/2,(a[1]+b[1])/2,d/last); last=d; moved=true; }
  draw(); });
c.addEventListener('pointerup',e=>{ pts.delete(e.pointerId); if(!pts.size) last=null; if(!moved&&!pts.size) show(hit(e.clientX,e.clientY)); });
c.addEventListener('pointercancel',e=>{ pts.delete(e.pointerId); last=null; });
function zoomAt(px,py,f){ const x=(px-innerWidth/2)/cam.s+cam.x, y=-(py-innerHeight/2)/cam.s+cam.y; cam.s=Math.max(0.01,Math.min(20,cam.s*f)); cam.x=x-(px-innerWidth/2)/cam.s; cam.y=y+(py-innerHeight/2)/cam.s; }
c.addEventListener('wheel',e=>{ e.preventDefault(); zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*0.0015)); draw(); },{passive:false});
addEventListener('resize',draw);
</script></body></html>`;
writeFileSync(resolve(out, 'index.html'), html);
console.log(`wrote ${resolve(out, 'index.html')} + data.json (${(JSON.stringify(data).length / 1e6).toFixed(2)} MB)`);
