// Authored recipes + named, material-specific treatments. No random seeds are counted as entries.
// Pure data: agents and build tools can discover the library without importing Three.js.
const treatments = {
  vehicles: ['factory-gloss','metallic','matte','sun-faded','dusty','road-worn','rain-dark','primer'],
  trees: ['young','mature','dry','rain-dark','lichen','mossy','weathered','frosted'],
  leaves: ['spring','summer','late-summer','autumn-gold','autumn-rust','dry','rain-dark','frosted'],
  grass: ['spring','summer','dry','autumn','damp','cut','rough','frosted'],
  flowers: ['fresh','sunlit','pale','deep','late-season','dry','rain-dark','frosted'],
  buildings: ['clean','aged','sun-faded','damp','dusty','mossy','sooty','patched'],
  walls: ['clean','aged','sun-faded','damp','dusty','mossy','sooty','patched'],
  roofs: ['clean','aged','sun-faded','damp','dusty','mossy','sooty','snow-dusted'],
  ground: ['dry','damp','compacted','loose','mossy','dusty','frosted','worn'],
  props: ['clean','aged','sun-faded','damp','dusty','worn','scratched','frosted'],
};
export const TEXTURE_FAMILIES = Object.freeze(Object.fromEntries(Object.entries(treatments).map(([id, finishes]) => [id, Object.freeze({ id, finishes: Object.freeze(finishes) })])));
// family | recipe | pattern | primary | secondary | accent | size(m) | structural controls (ratio,joint,density,shape)
const authored = `
vehicles|coach-enamel|paint|#31566c|#193444|#b7ccd1|.035|1,.02,1,0
vehicles|metallic-flake|paint|#7e2335|#421524|#d8a4a9|.008|1,.02,1,1
vehicles|pearl-lacquer|paint|#d4d1bb|#8d9c9f|#f1e4d0|.012|1,.02,1,2
vehicles|utility-hammered|hammer|#727b6c|#3e4a43|#a6b0a0|.025|1,.03,1,0
vehicles|brushed-aluminium|metal|#a4afb3|#66757c|#e2e5df|.06|1,.02,1,0
vehicles|chromed-trim|metal|#c9d1d2|#858e95|#ffffff|.025|1,.01,1,1
vehicles|rubber-sidewall|rubber|#292b2b|#121516|#535957|.045|1,.02,1,0
vehicles|rubber-tread|tread|#272a29|#0f1414|#555b56|.09|1.7,.12,1,0
vehicles|automotive-glass|glass|#7d9da7|#304d5e|#c7dedb|.8|1,.02,1,0
vehicles|tail-light-lens|lens|#bf3026|#571917|#ffb772|.025|1.5,.08,1,0
trees|silver-birch|bark-smooth|#d5d2bd|#343a32|#91a076|.16|1,.03,1,0
trees|english-oak|bark-fissured|#74674e|#37372a|#a69b76|.14|1,.12,1,0
trees|scots-pine|bark-scaled|#9e7055|#423e32|#c29c74|.24|1.4,.08,1,0
trees|western-cedar|bark-fissured|#876b51|#493b2d|#ba9873|.09|.6,.07,1,1
trees|european-beech|bark-smooth|#929c8c|#535c51|#bcc4ac|.28|1,.02,1,1
trees|quaking-aspen|bark-smooth|#c2c8ac|#3f4b37|#8a9b68|.22|1.4,.04,1,2
trees|willow-bark|bark-fissured|#7b8063|#3d4735|#a2a88b|.19|1.6,.16,1,0
trees|eucalyptus-bark|bark-peeling|#b5ac8b|#697a65|#d6c6a0|.32|.6,.05,1,0
trees|coastal-redwood|bark-fissured|#89614b|#3e352a|#bd9270|.13|.4,.1,1,2
trees|palm-trunk|bark-diamond|#978563|#554d36|#c9b48b|.3|1.4,.08,1,0
leaves|sugar-maple|leaf-palmate|#5a823c|#2d572e|#c0c77b|.18|1,.03,1,5
leaves|white-oak|leaf-lobed|#698449|#3d5e32|#bdc38a|.2|.55,.03,1,5
leaves|beech-leaf|leaf-oval|#6d8b42|#3a612f|#bdc97a|.12|.65,.03,1,0
leaves|birch-leaf|leaf-oval|#75994b|#426b36|#c6d18b|.1|.8,.03,1,1
leaves|aspen-leaf|leaf-oval|#7b994b|#3e6b38|#c5ce8f|.1|1,.03,1,2
leaves|willow-leaf|leaf-lance|#899a64|#4c6b45|#cad2a3|.15|.24,.03,1,0
leaves|fern-frond|frond|#61874a|#345e37|#a6be76|.45|.55,.03,12,0
leaves|pine-needles|needles|#4b7050|#284c38|#91a77a|.18|.7,.02,9,0
leaves|spruce-needles|needles|#668477|#365e51|#b4c1a2|.12|.5,.02,15,1
leaves|palm-frond|frond|#648b4a|#365e36|#b1c27a|.8|.8,.02,18,1
grass|fine-fescue|grass|#839b52|#4e6c3f|#c0bd78|.12|.35,.02,12,0
grass|broad-meadow|grass|#7d944a|#496b34|#b7b66b|.2|.7,.03,7,1
grass|perennial-rye|grass|#638b40|#37652e|#abc275|.18|.5,.02,9,0
grass|bluegrass|grass|#6b927b|#3e6e59|#adbea0|.14|.4,.02,11,0
grass|tufted-hairgrass|grass|#8e9b63|#586f47|#d1c993|.28|.35,.03,15,2
grass|river-reed|grass|#829566|#4a6b47|#bfc391|.6|.7,.04,5,2
grass|alpine-sedge|grass|#82904e|#4e6638|#b9b77a|.22|.55,.03,8,2
grass|white-clover|clover|#678c43|#386333|#bbc77d|.09|1,.02,3,0
flowers|oxeye-daisy|flower-radial|#eee6cd|#d3a43e|#a77926|.1|1,.03,16,0
flowers|field-poppy|flower-cup|#c55340|#3b3330|#e18b63|.12|1,.03,4,0
flowers|buttercup|flower-cup|#e1c34a|#a18830|#f0da7b|.055|1,.03,5,0
flowers|cornflower|flower-radial|#7c8fbe|#434970|#b2bdd6|.075|1,.03,12,1
flowers|lavender|flower-spike|#9b91b6|#5a526e|#c2b5d0|.18|.35,.03,8,0
flowers|bluebell|flower-bell|#8799be|#4e5f90|#c1cbe1|.09|.7,.03,5,0
flowers|lupine|flower-spike|#8b83b4|#4f4d7c|#beb4d6|.24|.5,.03,11,1
flowers|sunflower|flower-radial|#d9b849|#695034|#edcf71|.24|1,.03,22,0
flowers|wild-rose|flower-cup|#cf9caa|#ba9b4e|#e9bdc6|.1|1,.03,5,1
flowers|fireweed|flower-radial|#bd7698|#84516e|#e0aac5|.065|1,.03,4,1
buildings|mineral-limewash|plaster|#d9ccb0|#ac9b7d|#ebe2ca|.8|1,.02,1,0
buildings|ochre-stucco|plaster|#c5a278|#8e7656|#e1c59c|.3|1,.02,1,1
buildings|roughcast-render|plaster|#b4b4a0|#7b8172|#d5d5bc|.065|1,.02,1,2
buildings|earthen-adobe|plaster|#bfa17e|#8c7356|#d8bf9d|.45|1,.04,1,3
buildings|painted-clapboard|boards|#b2bfae|#6e8476|#e2e3cc|.16|1.4,.03,1,0
buildings|board-and-batten|boards|#8c8170|#504b40|#baa58a|.24|1,.06,1,1
buildings|log-cabin|logs|#977f5c|#564932|#c2a875|.28|1,.05,1,0
buildings|timber-frame|timberframe|#d0bfa0|#65533d|#e7d9bb|1.6|1.4,.09,1,0
buildings|cast-concrete|concrete|#afb1a5|#7f887d|#d1d1bf|1.2|1.5,.02,1,0
buildings|glass-blocks|glass-block|#a6bcba|#637d80|#d5e2d3|.22|1,.05,1,0
walls|running-bond-brick|brick|#a16f55|#594c3e|#c4ae8b|.075|2.8,.06,1,0
walls|flemish-bond-brick|brick|#9a6353|#514437|#bba78d|.075|2.8,.07,1,1
walls|english-bond-brick|brick|#a77b5c|#5e5041|#c3b599|.075|2.8,.06,1,2
walls|limestone-ashlar|ashlar|#c1b89c|#7e7c68|#dbd3b9|.3|2.1,.03,1,0
walls|granite-ashlar|ashlar|#9da39b|#5c6863|#c5c9bb|.38|1.8,.025,1,1
walls|sandstone-ashlar|ashlar|#bca581|#7e7059|#d8c4a0|.33|2.4,.035,1,2
walls|rubble-mortar|rubble|#99937c|#555c4d|#c2bba0|.3|1.5,.08,1,0
walls|dry-stone|rubble|#9a9d88|#424c3e|#c1c6ac|.28|1.7,.035,1,1
walls|flint-wall|rubble|#74786c|#3f4943|#b3b5a1|.17|1.2,.09,1,2
walls|gabion-wall|gabion|#909a8e|#48574f|#bec5b0|.12|1,.035,1,0
roofs|canal-clay-tile|roof-tile|#ae7956|#6f4d39|#cea16d|.22|1.8,.04,1,0
roofs|interlock-clay-tile|roof-tile|#987056|#604936|#c29970|.26|1.4,.05,1,1
roofs|blue-slate|roof-shingle|#77838b|#414f58|#a4b0b1|.28|.75,.035,1,0
roofs|stone-lauze|roof-shingle|#9c9d85|#5a6252|#c3c1a5|.42|1.2,.045,1,1
roofs|cedar-shingle|roof-shingle|#988a6e|#5c5948|#c4b28a|.16|.8,.04,1,2
roofs|standing-seam|roof-seam|#7f918c|#4e6561|#b5c0ac|.45|1,.03,1,0
roofs|corrugated-sheet|roof-seam|#a3aaa1|#69766e|#d1d3c1|.09|1,.03,1,1
roofs|asphalt-shingle|roof-shingle|#797b70|#424c43|#a9ab96|.2|2.8,.035,1,3
ground|road-asphalt|aggregate|#666b68|#3b4542|#a5ab99|.022|1,.02,1,0
ground|road-chipseal|aggregate|#818271|#4c5848|#b9b79a|.038|1,.03,1,1
ground|rounded-cobbles|cobbles|#929b8e|#4b5b50|#c3c8b2|.19|1.3,.08,1,0
ground|granite-setts|brick|#939b94|#4f5d56|#c4c9b8|.17|1.5,.055,1,0
ground|river-gravel|aggregate|#a69c80|#686b54|#d1c4a0|.055|1,.04,1,2
ground|crushed-limestone|aggregate|#c4bea4|#868d75|#e0d7b5|.035|1,.04,1,3
ground|woodland-litter|litter|#776a4a|#424d32|#b29a5e|.07|1,.03,1,0
ground|loamy-earth|soil|#8d7955|#51523b|#b5a375|.13|1,.03,1,0
ground|red-clay|soil|#a17b5c|#654c39|#cda47b|.18|1,.05,1,1
ground|beach-sand|sand|#c4b48b|#938769|#e2d1a3|.22|1,.03,1,0
ground|layered-rock|strata|#a49c83|#656d5a|#c9c3a8|.3|2.4,.04,1,0
ground|snow-crust|snow|#d4dfd9|#93abae|#f0f0df|.08|1,.03,1,0
props|zinc-galvanized|hammer|#a2b2ae|#677e79|#cdd8c9|.055|1,.03,1,1
props|oxidized-steel|metal|#927b5e|#505449|#b9a17a|.08|1,.03,1,2
props|painted-rail|paint|#6f8c80|#3d5d52|#acc1a6|.08|1,.03,1,0
props|utility-concrete|concrete|#a8afa0|#727e6d|#cbd1b7|.6|1.5,.025,1,1
props|bench-planks|boards|#a08b66|#62563b|#c8b78b|.13|1,.04,1,0
props|woven-canvas|fabric|#b5a47b|#7c795a|#d8c9a0|.009|1,.04,1,0
props|hemp-rope|rope|#b3a478|#78774e|#d5c795|.035|1,.04,1,0
props|pebble-aggregate|aggregate|#a6aa96|#667663|#d0ceb0|.045|1,.03,1,2
`.trim();

const title = (s) => s.split('-').map((w) => w[0].toUpperCase()+w.slice(1)).join(' ');
export const TEXTURE_RECIPES = Object.freeze(authored.split('\n').map((line) => {
  const [family,id,pattern,color,secondary,accent,size,params] = line.split('|');
  const cutout = ['leaves','grass','flowers'].includes(family);
  return Object.freeze({ id, family, pattern, color, secondary, accent, scaleM:Number(size), structure:Object.freeze(params.split(',').map(Number)),
    cutout, projection:cutout ? 'uv' : family === 'ground' ? 'world' : family === 'trees' ? 'cylindrical' : 'local',
    usage: family === 'vehicles' ? 'Car/bike body, trim, tyres, lenses and glazing; apply per part.' : cutout ? 'UV-mapped foliage/flower cards; shader supplies the alpha silhouette.' : 'Static or instanced mesh surfaces; select per material slot.',
  });
}));

// wear, damp, dust, frost; seasonal colour changes are additional, deterministic palette transforms.
const finishEffects = {
  'factory-gloss':[0,0,0,0], metallic:[.03,0,0,0], matte:[.06,0,0,0], 'sun-faded':[.3,0,.08,0], dusty:[.1,0,.65,0], 'road-worn':[.65,0,.2,0], 'rain-dark':[.08,.8,0,0], primer:[.12,0,.12,0],
  'new-rubber':[.02,0,0,0],chalked:[.4,0,.3,0],muddy:[.5,.15,.6,0], 'clear-tint':[.01,0,0,0], 'smoke-tint':[.04,0,0,0],etched:[.35,0,.02,0], 'new-lens':[.01,0,0,0],polished:[.01,0,0,0],brushed:[.12,0,.02,0],oxidized:[.7,.1,.05,0],
  young:[.02,0,0,0], mature:[.25,0,0,0], dry:[.12,0,.18,0], lichen:[.6,0,0,0], mossy:[.75,.18,0,0], weathered:[.8,0,.12,0], frosted:[.15,.1,0,.6],
  spring:[.02,0,0,0], summer:[.1,0,0,0], 'late-summer':[.25,0,.05,0], 'autumn-gold':[.3,0,.06,0], 'autumn-rust':[.45,0,.08,0], autumn:[.4,0,.1,0], damp:[.1,.75,0,0], cut:[.05,0,.1,0], rough:[.55,0,.05,0],
  fresh:[0,0,0,0], sunlit:[.02,0,.01,0], pale:[.05,0,.03,0], deep:[.08,.05,0,0], 'late-season':[.5,0,.08,0],
  clean:[0,0,0,0], aged:[.5,0,.08,0], sooty:[.6,.12,.08,0], patched:[.7,0,.05,0], 'snow-dusted':[.2,.12,0,.8], compacted:[.2,.1,.02,0], loose:[.05,0,.06,0], worn:[.65,0,.12,0], scratched:[.4,0,.03,0],
};
const blendHex = (a,b,t) => '#'+[1,3,5].map((i) => Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
function palette(recipe, finish) {
  let colors = [recipe.color, recipe.secondary, recipe.accent];
  const tint = {
    spring:['#a6be67',.22], 'late-summer':['#b4aa61',.2], 'autumn-gold':['#d4ab4c',.68], 'autumn-rust':['#af6840',.7], autumn:['#b2a26a',.45],
    dry:['#b7aa79',.38], 'sun-faded':['#d9ceb2',.25], sunlit:['#f1dda5',.16], pale:['#ece5d7',.35], deep:['#422e61',.2],
    'late-season':['#ac8e73',.28], primer:['#a2a39a',.68], sooty:['#313b37',.32], 'smoke-tint':['#35464c',.4], mossy:['#688150',.18], lichen:['#b1b99c',.12],
  }[finish];
  if (tint) colors = colors.map((c) => blendHex(c,...tint));
  return colors;
}
function recipeFinishes(recipe) {
  if(recipe.family!=='vehicles')return TEXTURE_FAMILIES[recipe.family].finishes;
  if(['rubber','tread'].includes(recipe.pattern))return ['new-rubber','road-worn','dusty','rain-dark','sun-faded','chalked','muddy','frosted'];
  if(recipe.pattern==='glass')return ['clear-tint','smoke-tint','rain-dark','dusty','etched','scratched','frosted','sun-faded'];
  if(recipe.pattern==='lens')return ['new-lens','sun-faded','dusty','rain-dark','scratched','smoke-tint','frosted','road-worn'];
  if(['metal','hammer'].includes(recipe.pattern))return ['polished','brushed','matte','sun-faded','dusty','road-worn','rain-dark','oxidized'];
  return TEXTURE_FAMILIES[recipe.family].finishes;
}
const finishStyle={lichen:1,mossy:2,patched:3,scratched:4,'road-worn':5,metallic:6,primer:7,oxidized:8,muddy:9,chalked:10,etched:11};
export const TEXTURE_CATALOG = Object.freeze(Object.fromEntries(TEXTURE_RECIPES.flatMap((recipe) => recipeFinishes(recipe).map((finish,index) => {
  const id = `${recipe.family}/${recipe.id}/${finish}`, colors = palette(recipe,finish);
  const metal = ['metal','hammer'].includes(recipe.pattern) ? .7 : recipe.pattern === 'paint' ? (finish === 'metallic' ? .55 : .15) : 0;
  const roughness = recipe.pattern === 'glass' ? (finish==='etched'?.65:finish==='frosted'?.8:.15) : recipe.pattern === 'lens' ? .27 : ['rubber','tread'].includes(recipe.pattern)?.92:['factory-gloss','metallic','polished'].includes(finish) ? .24 : finish === 'matte' ? .87 : ['metal','paint'].includes(recipe.pattern) ? .5 : .92;
  return [id,Object.freeze({ ...recipe,id,recipe:recipe.id,name:`${title(recipe.id)} · ${title(finish)}`, finish,
    colors:Object.freeze(colors), effects:Object.freeze(finishEffects[finish]), roughness, metalness:metal,
    clearcoat: recipe.pattern === 'paint' && finish !== 'matte' && finish !== 'primer' ? .65 : 0,
    density: finish === 'cut' ? .7 : finish === 'rough' ? 1.25 : finish === 'compacted' ? 1.2 : finish === 'loose' ? .8 : 1,
    treatment:finishStyle[finish]||0,
    tags:Object.freeze([recipe.family,recipe.id,recipe.pattern,finish,recipe.projection,recipe.cutout ? 'cutout' : 'solid']),
    variant:index, consumer:'makeCatalogMaterial(id, options)',
  })];
}))));

/** All returned presets are named entries. Seed variation is separate and never increases the count. */
export function findTextures({ family, recipe, tags = [], query = '', offset = 0, limit = 100 } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) throw new RangeError('offset and limit must be non-negative integers');
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(TEXTURE_CATALOG).filter((p) => (!family || p.family === family) && (!recipe || p.recipe === recipe) && tags.every((t) => p.tags.includes(t)) && terms.every((t) => `${p.id} ${p.name}`.toLowerCase().includes(t))).slice(offset,offset+limit);
}
export function getTexture(id) {
  if (!Object.hasOwn(TEXTURE_CATALOG,id)) throw new RangeError(`Unknown catalog texture "${id}"; use findTextures() to discover IDs`);
  return TEXTURE_CATALOG[id];
}
