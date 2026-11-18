import * as THREE from '../vendor/three.module.min.js';
import { decorateRoad } from '../js/world/toolbox/materials/road-surface.js';
import { ROAD_TEXTURES } from '../js/world/toolbox/materials/road-textures.js';
import { SURFACE_LIBRARY, makeToolboxSurface } from '../js/world/toolbox/materials/surface-library.js';
import { randomSequence } from '../js/world/toolbox/core/random.js';
import { Look, LOOKS } from '../js/world/toolbox/atmosphere/look.js';

const query = new URLSearchParams(location.search);
const standalone = query.get('library') === 'surfaces';
if (standalone) {
  document.querySelector('.eyebrow').textContent = 'Bikefree / shared toolbox / study 02';
  document.querySelector('h1').textContent = 'Surfaces for every kit.';
  document.querySelector('header p').textContent = 'Twelve reusable materials for buildings, masonry, terrain, vegetation and details. World-space patterns with no texture images or UV requirements. Inset: a 75 cm close-up.';
  document.querySelector('footer span').textContent = 'Rendered with makeToolboxSurface · same light for every sample · seed 17';
}
const libraryLink = document.createElement('a');
libraryLink.href = `?library=${standalone ? 'roads' : 'surfaces'}`;
libraryLink.textContent = standalone ? 'Road & path studies →' : 'Building, terrain & detail studies →';
libraryLink.style.marginLeft = '16px'; document.querySelector('nav').append(libraryLink);
const requestedCondition = query.get('condition') || 'midday';
const condition = standalone && requestedCondition === 'wet' ? 'midday' : requestedCondition;
document.querySelector('#condition').value = condition;
document.querySelector('#condition').onchange = (e) => { query.set('condition', e.target.value); location.search = query; };
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1.5); renderer.setSize(440, 235);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#23333d');
const hemi = new THREE.HemisphereLight('#e9f1fa', '#6b6656', 2.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(condition === 'golden' ? '#ffdaa5' : '#fff6df', 2.3);
sun.position.set(-3, condition === 'golden' ? 1.2 : 6, 4); scene.add(sun);
// Optional ?look=gentle|bold: the app's toon bands (atmosphere/look.js) over every sample; default unchanged.
const look = LOOKS[query.get('look')] ? new Look({ renderer, scene, sun, hemi, sunDir: sun.position.clone().normalize(), route: {} }, query.get('look')) : null;
look?.applyLight();
const camera = new THREE.PerspectiveCamera(37, 440 / 235, .01, 100);
const tile = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), new THREE.MeshStandardMaterial());
tile.rotation.x = -Math.PI / 2;
// Match road UVs: u is width fraction, v is distance / 24, not a repeated tile-local coordinate.
const uv = tile.geometry.attributes.uv;
for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 5 / 24 + 80 / 24);
scene.add(tile);
const plinth = new THREE.Mesh(new THREE.BoxGeometry(4.01, .11, 5.01), new THREE.MeshStandardMaterial({ color: '#182731', roughness: 1 }));
plinth.position.y = -.065; scene.add(plinth);

// Deterministic neutral road map with the same colour/paint conventions used by world.js.
const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
const ctx = canvas.getContext('2d'), rand = randomSequence(17);
ctx.fillStyle = '#555c60'; ctx.fillRect(0, 0, 256, 512);
for (let i = 0; i < 13000; i++) { const g = 69 + rand() * 24; ctx.fillStyle = `rgba(${g},${g + 3},${g + 5},.3)`; ctx.fillRect(rand() * 256, rand() * 512, .6, 1); }
ctx.fillStyle = '#e8e4d0'; ctx.fillRect(8, 0, 3, 512); ctx.fillRect(245, 0, 3, 512);
ctx.fillStyle = '#e4c36a'; ctx.fillRect(124, 0, 2, 512); ctx.fillRect(130, 0, 2, 512);
const map = new THREE.CanvasTexture(canvas); map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
const materials = standalone ? Object.entries(SURFACE_LIBRARY).map(([id, p]) => [id,p.name,p.description]) : [
  ['worn', 'Existing · worn asphalt', 'Original wear, repairs and painted lines.'],
  ['fresh', 'Existing · fresh asphalt', 'Original darker overlay and cleaner paint.'],
  ['brick', 'Existing · brick paving', 'Original red-brown running bond.'],
  ...Object.entries(ROAD_TEXTURES).map(([id, p]) => [id, p.name, p.description]),
  ['transition', 'Zoned material transition', 'Compacted gravel blends into stone setts; existing 40 m zone blend.'],
];
window.textureStats = [];
for (const [id, name, description] of materials) {
  const surface = id === 'transition' ? 'gravel-compacted' : id;
  const road = { surface, texture: { seed: 17 }, zones: id === 'transition' ? [{ fromM: 81, toM: 200, surface: 'stone-setts' }] : [] };
  if (condition === 'wet') {
    road.zones.forEach((zone) => { zone.wet = .85; });
    road.zones.unshift({ fromM: -1000, toM: 10000, surface, wet: .85 });
  }
  const material = standalone ? makeToolboxSurface(id, { seed: 17 }) : decorateRoad(new THREE.MeshStandardMaterial({ map, roughness: condition === 'wet' ? .76 : .94 }), road, { widthM: 4 });
  // The standalone library does not implement water or dampness; only road studies offer that condition.
  if (standalone) document.querySelector('#condition option[value="wet"]').disabled = true;
  tile.material = material; look?._patch(material);
  camera.position.set(5, 6.5, 7.5); camera.lookAt(0, 0, 0);
  renderer.setSize(440, 235); camera.aspect = 440 / 235; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const hero = renderer.domElement.toDataURL('image/png');
  const calls = renderer.info.render.calls;
  // Close-up samples the same production mesh/shader. Move off the centre paint.
  renderer.setSize(160, 160); camera.aspect = 1;
  camera.position.set(-.8, 1.12, .5); camera.lookAt(-.8, 0, .5); camera.up.set(0, 0, -1); camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const detail = renderer.domElement.toDataURL('image/png'); camera.up.set(0, 1, 0);
  const card = document.createElement('article'); card.className = standalone || ROAD_TEXTURES[id] || id === 'transition' ? '' : 'legacy';
  card.innerHTML = `<div class="label"><h2>${name}</h2><span class="tag">${standalone ? SURFACE_LIBRARY[id].family.toUpperCase() : ROAD_TEXTURES[id] ? 'NEW' : id === 'transition' ? 'ZONED' : 'EXISTING'}</span></div><div class="images"><img class="hero" src="${hero}" alt="${name} on a four by five metre surface"><img class="detail" src="${detail}" alt="75 centimetre close-up"></div><div class="caption"><code>${id}</code><span>${description}</span></div>`;
  document.querySelector('#grid').append(card);
  window.textureStats.push({ id, calls, programs: renderer.info.programs.length });
  material.dispose();
}
await Promise.all([...document.images].map((img) => img.decode()));
window.galleryReady = true;

// Optional browser verification uses real WebGL draws, including branches not visible in the contact sheet.
window.verifyTextures = () => {
  const signature = (material) => { tile.material = material; renderer.render(scene,camera); const url = renderer.domElement.toDataURL(); material.dispose(); return url; };
  const roadMaterial = (id, texture = {}) => decorateRoad(new THREE.MeshStandardMaterial({ map }), { surface: id, texture }, { widthM: 4 });
  const sameSeed = signature(roadMaterial('gravel-compacted', { seed: 17 }));
  if (sameSeed !== signature(roadMaterial('gravel-compacted', { seed: 17 }))) throw new Error('road seed is unstable');
  if (sameSeed === signature(roadMaterial('gravel-compacted', { seed: 18 }))) throw new Error('road seed does not vary the result');
  if (sameSeed === signature(roadMaterial('gravel-compacted', { seed: 17, scale: 2 }))) throw new Error('road scale does not vary the result');
  const surfaceSeed = signature(makeToolboxSurface('granite-blocks', { seed: 17 }));
  if (surfaceSeed !== signature(makeToolboxSurface('granite-blocks', { seed: 17 }))) throw new Error('surface seed is unstable');
  if (surfaceSeed === signature(makeToolboxSurface('granite-blocks', { seed: 18 }))) throw new Error('surface seed does not vary the result');
  const marks = new THREE.DataTexture(new Uint8Array([200,200,0,255]),1,1); marks.needsUpdate = true;
  for (const id of Object.keys(ROAD_TEXTURES)) signature(decorateRoad(new THREE.MeshStandardMaterial({ map }), { surface: id }, { widthM:4, marks: { texture:marks, dims:new THREE.Vector3(1,1,1000) } }));
  signature(decorateRoad(new THREE.MeshStandardMaterial({ map }), { surface:'worn', zones:[{ fromM:0,toM:1000,surface:'stone-setts',wet:.8 }] }, { widthM:4 }));
  const box = new THREE.BoxGeometry(1,1,1);
  tile.visible = false;
  for (const id of Object.keys(SURFACE_LIBRARY)) {
    const material = makeToolboxSurface(id), mesh = new THREE.InstancedMesh(box,material,2);
    mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-.8,.6,.5));
    mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(.5,.6,.5));
    scene.add(mesh); renderer.render(scene,camera); scene.remove(mesh); material.dispose();
  }
  box.dispose(); marks.dispose(); tile.visible = true;
  return 'seed repeatability, seed/scale variation, 8 French road patterns, wet zone-only selection, 12 instanced materials';
};
