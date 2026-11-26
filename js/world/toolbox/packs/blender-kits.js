import * as THREE from '../../../../vendor/three.js';
import { decorateSceneryMaterial } from '../materials/surfaces.js';
import { MOUNTAIN_BUILDERS } from './northern-rockies.js';

const unpack = (text, Type) => {
  const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  return new Type(bytes.buffer);
};

/** Load the vertex-colour Blender kit once per scene. Shared by all instances. */
export async function loadSceneryAssets(path, opts = {}) {
  const packs = await Promise.all([path, ...(opts.extraPaths || [])].map(async (source) => {
    const response = await fetch(new URL(`../../../../${source}`, import.meta.url));
    if (!response.ok) throw new Error(`Scenery assets could not load (${response.status})`);
    const data = await response.json();
    if (data.format !== 'bikefree-scenery-1' || data.positionScale !== 100) throw new Error('Unsupported scenery asset format');
    return data;
  }));
  const data = { positionScale: 100, assets: Object.assign({}, ...packs.map((p) => p.assets)) };
  const uniforms = opts.uniforms || { uTime: { value: 0 } };
  const materials = {};
  const materialFor = (name) => {
    const category = ['bridge', 'viaduct'].includes(name) ? 'concrete' : ['grass', 'flowers', 'poppy', 'lupine', 'succulent', 'fern', 'sage', 'yucca', 'alpineflowers'].includes(name) ? 'groundcover'
      : /^(cypress|pine|fir|broadleaf|palm|shrub)/.test(name) ? 'foliage' : 'solid';
    if (!materials[category]) materials[category] = decorateSceneryMaterial(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: category === 'concrete' ? .88 : .98,
        side: category === 'groundcover' ? THREE.DoubleSide : THREE.FrontSide }), category, uniforms);
    return materials[category];
  };
  const assets = {};
  for (const [name, part] of Object.entries(data.assets)) {
    const compact = unpack(part.position, Int16Array);
    const colors = unpack(part.color, Uint8Array);
    const linearColors = new Float32Array(colors.length);
    const tint = new THREE.Color();
    for (let i = 0; i < colors.length; i += 3) {
      tint.setRGB(colors[i] / 255, colors[i + 1] / 255, colors[i + 2] / 255, THREE.SRGBColorSpace);
      linearColors.set([tint.r, tint.g, tint.b], i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(compact, (v) => v / data.positionScale), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(unpack(part.normal, Int8Array), 3, true));
    geometry.setAttribute('color', new THREE.BufferAttribute(linearColors, 3));
    geometry.computeBoundingSphere();
    assets[name] = { geometry, material: materialFor(name) };
  }
  // the kit's old lupine (stacked octahedra) and poppy (flat discs on sticks) read as toys: grown the way the
  // mountain packs grow their flowers — silver bush lupine's purple spikes, California poppies' orange cups
  const swap = (name, geo) => { if (!assets[name]) return; assets[name].geometry.dispose(); geo.computeBoundingSphere(); assets[name].geometry = geo; };
  swap('lupine', MOUNTAIN_BUILDERS.spikes(4401, 14, .45, '#6f8a5a', '#7a68c8', '#9a8ee0', .32));
  swap('poppy', MOUNTAIN_BUILDERS.daisies(4411, 7, .3, '#f08a1c', '#e8b020'));
  return { assets, dispose() { for (const a of Object.values(assets)) a.geometry.dispose(); Object.values(materials).forEach((m) => m.dispose()); } };
}
