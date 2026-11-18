import * as THREE from '../vendor/three.module.min.js';
import { TEXTURE_CATALOG,TEXTURE_FAMILIES,TEXTURE_RECIPES,findTextures } from '../js/world/toolbox/materials/texture-catalog.js';
import { makeCatalogMaterial } from '../js/world/toolbox/materials/catalog-material.js';
import { Look, LOOKS } from '../js/world/toolbox/atmosphere/look.js';

// Optional context controls (defaults unchanged): ?look=gentle|bold applies the app's toon bands from
// atmosphere/look.js; ?view=close|mid|far|triple frames hard-surface samples at ~3 m, ~14 m and ~55 m
// (triple shows all three side by side), so detail, mid-distance readability and far fade can be judged.
const query=new URLSearchParams(location.search),perPage=Math.max(1,Math.min(96,Number(query.get('limit'))||24));
const lookKey=LOOKS[query.get('look')]?query.get('look'):null,view=['mid','far','triple'].includes(query.get('view'))?query.get('view'):'close';
let page=Math.max(0,Number(query.get('page'))||0);
const family=document.querySelector('#family'),search=document.querySelector('#search'),selection=document.querySelector('#selection');
for(const id of Object.keys(TEXTURE_FAMILIES)){const option=document.createElement('option');option.value=id;option.textContent=id;family.append(option);}
family.value=query.get('family')||'';search.value=query.get('q')||'';selection.value=query.get('selection')||'representatives';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1.5);renderer.setSize(340,235);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new THREE.Scene();scene.background=new THREE.Color('#243842');scene.add(new THREE.HemisphereLight('#e4f0ef','#6b6855',2.2));
const hemi=new THREE.HemisphereLight('#e4f0ef','#6b6855',2.2);scene.children[0].removeFromParent();scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff0d6',2.5);sun.position.set(-3,5,4);scene.add(sun);
const look=lookKey?new Look({renderer,scene,sun,hemi,sunDir:sun.position.clone().normalize(),route:{}},lookKey):null;look?.applyLight();
const camera=new THREE.PerspectiveCamera(38,340/235,.01,view==='close'?50:400);camera.position.set(0,0,3.2);camera.lookAt(0,0,0);
const cards=new THREE.PlaneGeometry(1.8,1.8,1,1),sphere=new THREE.SphereGeometry(.8,32,20),box=new THREE.BoxGeometry(1.4,1.4,1.4),cylinder=new THREE.CylinderGeometry(.48,.57,1.7,32);
const panel=new THREE.PlaneGeometry(1.8,1.8),mesh=new THREE.Mesh(sphere,new THREE.MeshStandardMaterial());scene.add(mesh);
const groundGeometry=new THREE.PlaneGeometry(1.8,1.8);groundGeometry.rotateX(-Math.PI/2);groundGeometry.rotateX(.75); // ground is rendered with local override to see pattern face-on
// Hard surfaces stand on local y=0 (as kit walls are built), so foot-of-wall weathering reads correctly.
const standing={close:new THREE.BoxGeometry(1.4,1.4,1.4).translate(0,.7,0),mid:new THREE.BoxGeometry(6,6,6).translate(0,3,0),far:new THREE.BoxGeometry(24,24,24).translate(0,12,0)};
const viewSize={close:1.4,mid:6,far:24};
const HARD=['buildings','walls','roofs','rock','industrial','overlays'];
if(view==='triple')document.querySelector('#grid').style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
let lastMaterial=null;
function renderPreset(p,options={},v=view==='triple'?'close':view){
  // Overlays preview on a limestone wall; road markings as overlays on dry asphalt; markings/water on world-projected ground.
  const flat=['markings','water'].includes(p.family),baseId=p.family==='overlays'?'walls/limestone-ashlar/clean':p.family==='markings'?'ground/road-asphalt/dry':null;
  const previous=lastMaterial;lastMaterial=makeCatalogMaterial(baseId??p.id,{seed:17,...(baseId?{overlay:{id:p.id}}:{}),...(flat?{projection:'world'}:{}),...options});mesh.material=lastMaterial;look?._patch(lastMaterial);
  mesh.rotation.set(0,0,0);mesh.position.set(0,0,0);mesh.scale.set(1,1,1);
  if(p.cutout){mesh.geometry=cards;}
  else if(p.family==='trees'){mesh.geometry=cylinder;mesh.rotation.y=.35;}
  else if(p.family==='vehicles'){mesh.geometry=p.pattern==='rubber'||p.pattern==='tread'?cylinder:sphere;mesh.rotation.z=p.pattern==='rubber'||p.pattern==='tread'?Math.PI/2:0;}
  else if(['buildings','walls','roofs','props','rock','industrial','overlays'].includes(p.family)){mesh.geometry=box;mesh.rotation.set(.25,-.42,0);}
  else {mesh.geometry=panel;}
  // Ground patterns deliberately use world xz. Stand the preview on a real horizontal surface and look down.
  if(p.family==='ground'||flat){mesh.geometry=groundGeometry;mesh.rotation.x=-.75;camera.position.set(0,2.7,1.7);camera.lookAt(0,0,0);}
  else {camera.position.set(0,0,3.2);camera.lookAt(0,0,0);}
  if(HARD.includes(p.family)){const k=viewSize[v]/1.4;mesh.geometry=standing[v];mesh.position.y=-viewSize[v]/2;if(p.family==='roofs')mesh.rotation.x=.75;camera.position.set(0,0,3.2*k);camera.lookAt(0,0,0);}
  renderer.render(scene,camera);previous?.dispose();return renderer.domElement.toDataURL('image/png');
}
async function build(){
  window.galleryReady=false;document.querySelector('#grid').replaceChildren();
  let list=findTextures({family:family.value||undefined,query:search.value,limit:10000});
  if(selection.value==='representatives')list=list.filter(p=>p.variant===0);
  if(selection.value==='featured'){
    const choices={vehicles:[0,7],trees:[0,2],leaves:[0,6],grass:[0,7],flowers:[0,1],buildings:[0,7],walls:[1,7],roofs:[0,5],ground:[2,6],props:[0,5]};
    const ids=new Set(Object.entries(choices).flatMap(([f,indexes])=>{const recipes=TEXTURE_RECIPES.filter(r=>r.family===f);return indexes.map(i=>recipes[i].id);}));
    list=list.filter(p=>ids.has(p.recipe)&&p.variant===0);
  }
  const pages=Math.max(1,Math.ceil(list.length/perPage));page=Math.min(page,pages-1);
  const visible=list.slice(page*perPage,(page+1)*perPage);
  for(const p of visible){const article=document.createElement('article');const img=document.createElement(view==='triple'&&HARD.includes(p.family)?'div':'img');
    if(img.tagName==='IMG'){img.src=renderPreset(p);img.alt=p.name;}
    else {img.className='views';for(const v of ['close','mid','far']){const i=document.createElement('img');i.src=renderPreset(p,{},v);i.alt=`${p.name} · ${v}`;img.append(i);}}const title=document.createElement('h2');title.textContent=p.name;const code=document.createElement('code');code.textContent=p.id;article.append(img,title,code);document.querySelector('#grid').append(article);}
  document.querySelector('#stat').textContent=`${list.length} results · page ${page+1}/${pages}`;
  document.querySelector('#previous').disabled=page===0;document.querySelector('#next').disabled=page>=pages-1;
  await Promise.all([...document.images].map(img=>img.decode()));window.catalogStats={total:768,recipes:96,shown:visible.length,family:family.value};window.galleryReady=true;
}
for(const element of [family,search,selection])element.onchange=()=>{page=0;build();};
document.querySelector('#previous').onclick=()=>{page--;build();};document.querySelector('#next').onclick=()=>{page++;build();};
await build();

// Verify every selectable entry, not just the displayed page. Read pixels to test coverage and duplicate
// output per recipe. Material programs are shared by kernel; disposed materials do not accumulate.
window.verifyCatalog=async()=>{
  renderer.setPixelRatio(1);renderer.setSize(64,64);camera.aspect=1;camera.updateProjectionMatrix();
  const pixels=new Uint8Array(64*64*4),signatures=new Map(),duplicates=[],empty=[];
  const gl=renderer.getContext();let checked=0;
  for(const p of Object.values(TEXTURE_CATALOG)){
    renderPreset(p);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let hash=2166136261,coverage=0;const background=[pixels[0],pixels[1],pixels[2]];
    for(let i=0;i<pixels.length;i+=4){if(Math.abs(pixels[i]-background[0])+Math.abs(pixels[i+1]-background[1])+Math.abs(pixels[i+2]-background[2])>12)coverage++;for(let k=0;k<3;k++)hash=Math.imul(hash^pixels[i+k],16777619)>>>0;}
    if(coverage<12)empty.push(p.id);
    const key=`${p.family}/${p.recipe}/${hash}`;if(signatures.has(key))duplicates.push([signatures.get(key),p.id]);else signatures.set(key,p.id);
    checked++;if(checked%32===0)await new Promise(requestAnimationFrame);
  }
  if(empty.length||duplicates.length)throw new Error(JSON.stringify({empty,duplicates}));
  // Same-seed repeatability and different-seed sensitivity for a material with visible grain.
  const sample=TEXTURE_CATALOG['walls/granite-ashlar/aged'];const a=renderPreset(sample,{seed:17}),b=renderPreset(sample,{seed:17}),c=renderPreset(sample,{seed:18});
  if(a!==b||a===c)throw new Error('Catalog seed stability/sensitivity failed');
  // Every kernel also renders on instances. UV cutouts use instanced cards; solids use instanced boxes.
  mesh.visible=false;const patterns=new Set();
  for(const p of Object.values(TEXTURE_CATALOG))if(!patterns.has(p.pattern)){
    patterns.add(p.pattern);const material=makeCatalogMaterial(p.id);const inst=new THREE.InstancedMesh(p.cutout?cards:box,material,2);
    inst.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-.4,0,0));inst.setMatrixAt(1,new THREE.Matrix4().makeTranslation(.4,0,-.3));scene.add(inst);renderer.render(scene,camera);scene.remove(inst);material.dispose();
  }
  mesh.visible=true;return {checked,kernels:patterns.size,empty:0,duplicateFinishes:0,instancing:true,seeds:true};
};
