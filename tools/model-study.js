import * as THREE from '../vendor/three.module.min.js';
import { loadRider } from '../js/world/rider.js';
import { loadSceneryAssets } from '../js/world/scenery-assets.js';
import { buildTrafficVehicle } from '../js/world/highway-traffic.js';
import { buildStudyCar } from './model-study-assets.js';
import { proposals } from './model-study-proposals.js';
const $ = id => document.getElementById(id);
const stage=$('stage'), scene=new THREE.Scene(); scene.background=new THREE.Color('#dce4da');
const camera=new THREE.PerspectiveCamera(38,1,.01,500);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
const sky=new THREE.HemisphereLight('#ebf3ff','#5c6551',2); scene.add(sky);
const sun=new THREE.DirectionalLight('#fff0d4',3); sun.position.set(8,14,9); sun.castShadow=true; sun.shadow.mapSize.set(1024,1024); scene.add(sun);scene.add(sun.target);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#c1cbb8',roughness:1})); floor.rotation.x=-Math.PI/2; floor.position.y=-.012; floor.receiveShadow=true;scene.add(floor);
const pivot=new THREE.Group();scene.add(pivot);
const clock=new THREE.Clock(), uniforms={uTime:{value:0},bfWind:{value:.15}};
let active, radius=3, target=new THREE.Vector3(), yaw=.7, pitch=.25, zoom=1, elapsed=0;
const count=g=>(g.index?.count??g.attributes.position.count)/3;
function frame(){ pivot.rotation.y=0; pivot.updateMatrixWorld(true); const box=new THREE.Box3().setFromObject(active.group); target=box.getCenter(new THREE.Vector3()); radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.3); zoom=1; yaw=.7;pitch=.25; pivot.rotation.y=0; const d=radius*2; sun.shadow.camera.left=sun.shadow.camera.bottom=-d;sun.shadow.camera.right=sun.shadow.camera.top=d; sun.shadow.camera.updateProjectionMatrix();sun.shadow.needsUpdate=true;sun.target.position.copy(target);sun.position.copy(target).add(new THREE.Vector3(radius*2,radius*3,radius*2)); }
function select(){
 if(!kit)return;
 if(active)pivot.remove(active.group);
 const id=$('asset').value;
 if(id==='rider'||id==='pacer')active=riders[id];
 else if(cars[id])active=cars[id];
 else { const name=id+($('detail').value==='far'&&kit.assets[id+'-lod']?'-lod':''); const a=kit.assets[name];active={group:new THREE.Mesh(a.geometry,a.material),triangles:count(a.geometry)}; }
 pivot.add(active.group);pivot.rotation.y=0;pivot.updateMatrixWorld(true);active.group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 $('detail').disabled=!kit.assets[id+'-lod'];
 $('title').textContent=$('asset').selectedOptions[0].textContent;
 const proposal=proposals[id];
 $('notes').textContent=proposal.baseline;
 $('proposal').replaceChildren(...[
   ['Shape and smoother silhouettes', proposal.shape],
   ['Colour and materials', proposal.finish],
   ['Motion and placement', proposal.behavior],
   ['M4 Air performance budget', proposal.budget],
   ['Acceptance checks', proposal.review]
 ].map(([label, text])=>{const section=document.createElement('section');const heading=document.createElement('h3');heading.textContent=label;const body=document.createElement('p');body.textContent=text;section.append(heading,body);return section;}));
 $('briefLink').href=`../docs/MODEL_STUDY.md#${id}`;
 const box=new THREE.Box3().setFromObject(active.group).getSize(new THREE.Vector3());
 $('stats').textContent=`${active.triangles.toLocaleString()} triangles · ${box.x.toFixed(2)} × ${box.y.toFixed(2)} × ${box.z.toFixed(2)} m`;
 frame();wire(); window.modelStudy={ready:true,asset:id,triangles:active.triangles,renderer};
}
function wire(){scene.traverse(o=>{if(o.isMesh&&o!==floor)for(const m of (Array.isArray(o.material)?o.material:[o.material]))m.wireframe=$('wire').checked;});}
const riders={},cars={};let kit;
try{
 const loaded=await Promise.all([loadRider(),loadRider({jersey:'checker'}),loadSceneryAssets('models/scenery/coastal.json',{extraPaths:['models/scenery/regional.json'],uniforms})]);
 riders.rider=loaded[0];riders.pacer=loaded[1];kit=loaded[2];
 for(const id of ['car','suv','rv','study']){const geometry=id==='study'?buildStudyCar():buildTrafficVehicle(id).geometry();geometry.computeBoundingBox();geometry.translate(0,-geometry.boundingBox.min.y,0);const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7});cars[id]={group:new THREE.Mesh(geometry,material),triangles:count(geometry)};}
 select();
}catch(e){$('stats').textContent=`Could not load examples: ${e.message}`;console.error(e);}
$('asset').addEventListener('change',select);$('detail').addEventListener('change',select);$('reset').addEventListener('click',frame);$('wire').addEventListener('change',wire);
$('light').addEventListener('change',()=>{sun.color.set($('light').value==='golden'?'#ffcf91':'#fff0d4');sky.intensity=$('light').value==='golden'?1.3:2;});
let drag;
stage.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag=[e.clientX,e.clientY];stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{if(!drag)return;yaw-=(e.clientX-drag[0])*.008;pitch=Math.max(-.05,Math.min(1.3,pitch+(e.clientY-drag[1])*.008));drag=[e.clientX,e.clientY];});
for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,()=>drag=null);
stage.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.55,Math.min(4,zoom*Math.exp(e.deltaY*.001)));},{passive:false});
stage.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();$('motion').checked=!$('motion').checked;}});
const observer=new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);});observer.observe(stage);
let crank=0;
renderer.setAnimationLoop(()=>{
 const dt=Math.min(clock.getDelta(),.05);
 if(active){if($('motion').checked){elapsed+=dt;crank+=dt*2*Math.PI*84/60;pivot.rotation.y+=dt*.16;active.update?.(new THREE.Vector3(),new THREE.Vector3(0,0,1),crank,8,dt);} uniforms.uTime.value=elapsed;
 const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov)/2)/Math.min(1,camera.aspect)*zoom;
 camera.position.set(target.x+Math.sin(yaw)*Math.cos(pitch)*distance,target.y+Math.sin(pitch)*distance,target.z+Math.cos(yaw)*Math.cos(pitch)*distance);camera.lookAt(target);}
 renderer.render(scene,camera);
});
window.addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);observer.disconnect();const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of(o.material?(Array.isArray(o.material)?o.material:[o.material]):[])){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});for(const r of Object.values(riders))r.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material){materials.add(o.material);if(o.material.map)textures.add(o.material.map);}});for(const c of Object.values(cars)){geometries.add(c.group.geometry);materials.add(c.group.material);}kit?.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());sun.shadow.dispose();renderer.dispose();},{once:true});
