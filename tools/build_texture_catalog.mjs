// Machine-readable discovery artifact. Runtime source remains the authored JS catalog.
import { writeFileSync,readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXTURE_CATALOG,TEXTURE_RECIPES,TEXTURE_FAMILIES } from '../js/world/toolbox/materials/texture-catalog.js';
const counts=Object.fromEntries(Object.keys(TEXTURE_FAMILIES).map(f=>[f,Object.values(TEXTURE_CATALOG).filter(p=>p.family===f).length]));
const result={format:'bikefree-texture-catalog-1',entries:Object.keys(TEXTURE_CATALOG).length,recipes:TEXTURE_RECIPES.length,
  patternKernels:new Set(TEXTURE_RECIPES.map(r=>r.pattern)).size,counts,seedCounted:false,previousAdditions:20,totalAdditions:Object.keys(TEXTURE_CATALOG).length+20,textures:Object.values(TEXTURE_CATALOG)};
const output=JSON.stringify(result,null,2)+'\n',path=fileURLToPath(new URL('../docs/toolbox/texture-catalog.json',import.meta.url));
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==output)throw new Error('Texture catalog manifest is stale: node tools/build_texture_catalog.mjs');}
else writeFileSync(path,output);
console.log(`${result.entries} new presets / ${result.recipes} recipes / ${result.patternKernels} kernels / ${result.totalAdditions} total additions`);
