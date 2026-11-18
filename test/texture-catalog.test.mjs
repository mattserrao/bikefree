import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import { TEXTURE_CATALOG,TEXTURE_RECIPES,TEXTURE_FAMILIES,findTextures,getTexture } from '../js/world/toolbox/materials/texture-catalog.js';
import { CATALOG_PATTERNS } from '../js/world/toolbox/materials/catalog-patterns.js';
import { makeCatalogMaterial,catalogMaterialSpec } from '../js/world/toolbox/materials/catalog-material.js';

test('750+ additional presets represent distinct material settings, with no seed counting',()=>{
  const all=Object.values(TEXTURE_CATALOG);assert.equal(all.length,768);assert.equal(TEXTURE_RECIPES.length,96);
  const signatures=new Set();
  for(const p of all){
    assert.ok(CATALOG_PATTERNS[p.pattern],`${p.id}: missing kernel`);
    assert.ok(p.effects?.every(Number.isFinite),`${p.id}: invalid treatment`);
    assert.ok(p.scaleM>0);assert.equal(p.structure.length,4);assert.ok(p.structure.every(Number.isFinite));
    assert.match(p.id,/^[a-z-]+\/[a-z-]+\/[a-z-]+$/);
    const signature=JSON.stringify([p.pattern,p.scaleM,p.structure,p.colors,p.effects,p.roughness,p.metalness,p.clearcoat,p.density,p.projection]);
    assert.ok(!signatures.has(signature),`${p.id}: duplicate effective preset`);signatures.add(signature);
    assert.equal('seed'in p,false);
  }
  for(const recipe of TEXTURE_RECIPES)assert.equal(findTextures({family:recipe.family,recipe:recipe.id,limit:100}).length,8);
  for(const family of Object.keys(TEXTURE_FAMILIES))assert.ok(findTextures({family}).length>=64);
});
test('every catalog entry creates a disposable material with the intended alpha and physical settings',()=>{
  for(const p of Object.values(TEXTURE_CATALOG)){
    const material=makeCatalogMaterial(p.id,{seed:7});assert.equal(material.userData.textureCatalog.id,p.id);
    assert.equal(material.map,null);assert.equal(material.alphaTest>0,p.cutout);assert.equal(material.transparent,p.pattern==='glass');
    assert.ok(Number.isFinite(material.roughness));material.dispose();
  }
});
test('discovery supports family, recipe, tag, query and pagination without mutating the catalog',()=>{
  assert.equal(findTextures({family:'flowers',recipe:'field-poppy',tags:['cutout']}).length,8);
  const matches=findTextures({query:'oak rain',limit:100});assert.ok(matches.length);assert.ok(matches.every(p=>p.id.includes('oak')&&p.id.includes('rain')));
  assert.deepEqual(findTextures({offset:10,limit:5}),Object.values(TEXTURE_CATALOG).slice(10,15));
  assert.throws(()=>getTexture('toString'),/Unknown/);assert.throws(()=>findTextures({limit:-1}),RangeError);
  assert.ok(Object.isFrozen(getTexture('flowers/field-poppy/fresh')));
});
test('moving objects use local coordinates and cutouts require UV projection',()=>{
  assert.equal(catalogMaterialSpec('vehicles/coach-enamel/factory-gloss').projection,'local');
  assert.equal(catalogMaterialSpec('trees/silver-birch/mature').projection,'cylindrical');
  assert.equal(catalogMaterialSpec('flowers/field-poppy/fresh').projection,'uv');
  for(const options of [{seed:.5},{scale:0},{variation:2},{projection:'bad'},{color:'red'}])assert.throws(()=>catalogMaterialSpec('vehicles/coach-enamel/matte',options),RangeError);
  assert.throws(()=>catalogMaterialSpec('leaves/sugar-maple/summer',{projection:'world'}),/require uv/);
  assert.throws(()=>getTexture('vehicles/rubber-tread/factory-gloss'),/Unknown/);
  assert.equal(makeCatalogMaterial('vehicles/rubber-tread/new-rubber').roughness,.92);
  assert.ok(makeCatalogMaterial('vehicles/automotive-glass/etched').roughness>makeCatalogMaterial('vehicles/automotive-glass/clear-tint').roughness);
});
test('machine-readable catalog mirrors runtime IDs and counts',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../docs/toolbox/texture-catalog.json',import.meta.url)));
  assert.equal(manifest.entries,768);assert.equal(manifest.totalAdditions,788);assert.equal(manifest.seedCounted,false);
  assert.deepEqual(manifest.textures,Object.values(TEXTURE_CATALOG));
});
