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
  // Gap families (wave 2). Kernels in these families are expected to place their own finishes (fxOwned / catFinish).
  rock: ['dry','damp','wet','lichen','mossy','frosted','snow-dusted','sun-bleached'],
  markings: ['fresh','worn','faded','dusty','rain-dark','tyre-marked','patched','frosted'],
  water: ['clear','murky','glacial','tannin','shallow','still','windy','frosted'],
  industrial: ['clean','aged','grimy','rusty','sooty','oily','patched','graffitied'],
  // Overlays are layered onto another preset: makeCatalogMaterial(base, { overlay: { id, amount } }). Their kernels
  // output coverage in alpha (0 = show the base). Finish = how much / what state.
  overlays: ['light','medium','heavy','fresh','old','damp','dry','frosted'],
};
const EVERGREEN = new Set(['pine-needles','spruce-needles','palm-frond','subalpine-fir','monterey-cypress','coast-live-oak']); // extend as evergreen recipes are added
export const TEXTURE_FAMILIES = Object.freeze(Object.fromEntries(Object.entries(treatments).map(([id, finishes]) => [id, Object.freeze({ id, finishes: Object.freeze(finishes) })])));
// family | recipe | pattern | primary | secondary | accent | size(m) | structural controls (ratio,joint,density,shape) | relief(m, optional, default .004)
const authored = `
vehicles|coach-enamel|paint|#31566c|#193444|#b7ccd1|.035|1,.02,1,0|.0002
vehicles|metallic-flake|paint|#7e2335|#421524|#d8a4a9|.008|1,.02,1,1|.0002
vehicles|pearl-lacquer|paint|#d4d1bb|#8d9c9f|#f1e4d0|.012|1,.02,1,2|.0002
vehicles|utility-hammered|hammer|#727b6c|#3e4a43|#a6b0a0|.02|1,.03,1,0|.0008
vehicles|brushed-aluminium|metal|#a4afb3|#66757c|#e2e5df|.06|1,.02,1,0|.0002
vehicles|chromed-trim|metal|#c9d1d2|#858e95|#ffffff|.025|1,.01,1,1|.0001
vehicles|rubber-sidewall|rubber|#292b2b|#121516|#535957|.045|1,.02,1,0|.0015
vehicles|rubber-tread|tread|#34373a|#0b0d0e|#5c625e|.03|1.4,.12,1,0|.006
vehicles|automotive-glass|glass|#7d9da7|#304d5e|#c7dedb|.05|1,.02,1,0|.0002
vehicles|tail-light-lens|lens|#bf3026|#571917|#ffb772|.012|1,.08,1,0|.0015
trees|silver-birch|bark-smooth|#d5d2bd|#343a32|#91a076|.16|1,.03,1,0
trees|english-oak|bark-fissured|#74674e|#37372a|#a69b76|.14|1,.12,1,0
trees|scots-pine|bark-scaled|#9e7055|#423e32|#c29c74|.24|1.4,.08,1,0
trees|western-cedar|bark-fissured|#876b51|#493b2d|#ba9873|.09|.6,.07,1,1
trees|european-beech|bark-smooth|#929c8c|#535c51|#bcc4ac|.28|1,.02,1,1
trees|quaking-aspen|bark-smooth|#c2c8ac|#3f4b37|#8a9b68|.22|1.4,.04,1,2
trees|willow-bark|bark-fissured|#7b8063|#3d4735|#a2a88b|.19|1.6,.16,1,3
trees|eucalyptus-bark|bark-peeling|#b5ac8b|#697a65|#d6c6a0|.32|.6,.05,1,0
trees|coastal-redwood|bark-fissured|#89614b|#3e352a|#bd9270|.13|.4,.1,1,2
trees|palm-trunk|bark-diamond|#978563|#554d36|#c9b48b|.3|1.4,.08,1,0
trees|european-larch-bark|bark-scaled|#866a5c|#3d302c|#bf917c|.16|1.6,.06,1,1|.012
trees|monterey-cypress-bark|bark-fissured|#7e6a5a|#3b3330|#b3a291|.1|.5,.08,1,4|.014
trees|london-plane-bark|bark-peeling|#a9a27f|#6f7458|#d9d2b0|.24|.8,.05,1,1|.003
leaves|sugar-maple|leaf-palmate|#5a823c|#2d572e|#c0c77b|.18|1,.03,3,5
leaves|white-oak|leaf-lobed|#698449|#3d5e32|#bdc38a|.2|.55,.03,3,5
leaves|beech-leaf|leaf-oval|#6d8b42|#3a612f|#bdc97a|.12|.65,.03,5,0
leaves|birch-leaf|leaf-oval|#75994b|#426b36|#c6d18b|.1|.8,.03,5,1
leaves|aspen-leaf|leaf-oval|#7b994b|#3e6b38|#c5ce8f|.1|1,.03,4,2
leaves|willow-leaf|leaf-lance|#899a64|#4c6b45|#cad2a3|.15|.24,.03,7,0
leaves|fern-frond|frond|#61874a|#345e37|#a6be76|.45|.55,.03,12,0
leaves|pine-needles|needles|#4b7050|#284c38|#91a77a|.18|.7,.02,9,0
leaves|spruce-needles|needles|#668477|#365e51|#b4c1a2|.12|.5,.02,15,1
leaves|palm-frond|frond|#648b4a|#365e36|#b1c27a|.8|.8,.02,18,1
leaves|european-larch|needles|#7a9e4e|#46683a|#b8cc7a|.14|.6,.02,7,2
leaves|subalpine-fir|needles|#3f6157|#223f38|#9fb3a6|.13|.5,.02,15,3
leaves|monterey-cypress|needles|#4a6a3c|#2a4426|#8ea56a|.16|.5,.02,12,4
leaves|coast-live-oak|leaf-oval|#3f5f2e|#24401f|#9aae6e|.08|.8,.03,7,3
leaves|london-plane|leaf-palmate|#6c8a45|#3c5e2f|#b8c47c|.24|1,.03,3,6
leaves|honey-locust|frond|#7f9e48|#4c6c34|#c4cf80|.25|.34,.02,18,2
leaves|ginkgo|leaf-fan|#7da152|#4b7238|#c5d28c|.08|1,.03,5,0
grass|fine-fescue|grass|#839b52|#4e6c3f|#c0bd78|.12|.35,.02,12,0
grass|broad-meadow|grass|#7d944a|#496b34|#b7b66b|.2|.7,.03,7,1
grass|perennial-rye|grass|#638b40|#37652e|#abc275|.18|.5,.02,9,0
grass|bluegrass|grass|#6b927b|#3e6e59|#adbea0|.14|.4,.02,11,0
grass|tufted-hairgrass|grass|#8e9b63|#586f47|#d1c993|.28|.35,.03,15,2
grass|river-reed|grass|#829566|#4a6b47|#bfc391|.6|.7,.04,5,3
grass|alpine-sedge|grass|#82904e|#4e6638|#b9b77a|.22|.55,.03,8,4
grass|white-clover|clover|#678c43|#386333|#bbc77d|.09|1,.02,3,0
grass|alpine-meadow|grass|#7a9a4c|#466b35|#c2c27a|.16|.4,.45,14,5
grass|coastal-sage-scrub|shrub|#8a9a82|#55644f|#c3c6a8|.6|1,.03,1,0
grass|ice-plant|grass|#6f9450|#3f6a3a|#c0603f|.2|1,.55,8,6
grass|mown-park-lawn|grass|#5f8e3c|#35652b|#a5c06c|.08|.4,.3,26,0
grass|ruderal-weeds|weeds|#6d8a45|#3f5f2f|#e2c23a|.3|1,.03,1,0
flowers|oxeye-daisy|flower-radial|#eee6cd|#d3a43e|#a77926|.1|1,.03,21,0
flowers|field-poppy|flower-cup|#c55340|#3b3330|#e18b63|.12|1,.03,4,0
flowers|buttercup|flower-cup|#e1c34a|#a18830|#f0da7b|.055|1,.03,5,1
flowers|cornflower|flower-radial|#7c8fbe|#434970|#b2bdd6|.075|1,.03,9,1
flowers|lavender|flower-spike|#9b91b6|#5a526e|#c2b5d0|.18|.35,.03,8,0
flowers|bluebell|flower-bell|#8799be|#4e5f90|#c1cbe1|.09|.7,.03,5,0
flowers|lupine|flower-spike|#8b83b4|#4f4d7c|#beb4d6|.24|.5,.03,11,1
flowers|sunflower|flower-radial|#d9b849|#695034|#edcf71|.24|1,.03,22,2
flowers|wild-rose|flower-cup|#cf9caa|#ba9b4e|#e9bdc6|.1|1,.03,5,2
flowers|fireweed|flower-spike|#bd7698|#84516e|#e0aac5|.3|1,.03,9,2
flowers|trumpet-gentian|flower-bell|#2f4fb0|#1b2a6e|#6aa0d8|.07|1,.03,5,1
flowers|edelweiss|flower-radial|#e3e3d6|#a3ab8e|#d8c98a|.05|1,.03,9,3
flowers|alpenrose|shrub|#3d5a32|#23361f|#c93a5c|.4|1,.03,1,1
flowers|arnica|flower-radial|#e9a531|#b86a1c|#f2c75a|.07|1,.03,13,4
flowers|california-poppy|flower-cup|#ec8a1e|#d3561a|#f6c04a|.07|1,.03,4,3
buildings|mineral-limewash|plaster|#ddd1b6|#a39a86|#efe8d4|.8|1,.02,1,0|.006
buildings|ochre-stucco|plaster|#cfa673|#8a7458|#e6c99a|.3|1,.02,1,1|.002
buildings|roughcast-render|plaster|#bcbaa8|#7d8072|#dcdac6|.065|1,.02,1,2|.004
buildings|earthen-adobe|plaster|#c4a27c|#a8875f|#d9c08a|.45|1,.04,1,3|.015
buildings|painted-clapboard|boards|#b4c4b2|#6e8476|#e4e6d2|.15|1,.03,1,2|.02
buildings|board-and-batten|boards|#8c7f6c|#504b40|#baa58a|.24|1,.06,1,1|.025
buildings|log-cabin|logs|#9a7d58|#564932|#d6ccb4|.28|1,.07,1,0|.1
buildings|timber-frame|timberframe|#e2d6bd|#4f3d2c|#efe6d2|2.6|1,.05,1,0|.03
buildings|cast-concrete|concrete|#b1b2a8|#6f756d|#d8d8cc|1.2|1.5,.02,1,0|.008
buildings|glass-blocks|glass-block|#9fc0c4|#3e5a63|#e6f0ea|.2|1,.05,1,0|.015
buildings|pastel-crepi|plaster|#e8cbb2|#f4eee2|#c99f62|1|1,.02,1,4|.004
buildings|larch-chalet-boards|boards|#6e5038|#2a1e16|#b08a5c|.2|1,.02,1,3|.012
walls|running-bond-brick|brick|#a8604a|#9a9384|#c99a7a|.075|3,.065,1,0|.008
walls|flemish-bond-brick|brick|#94503f|#c2b59c|#b97e64|.075|3,.065,1,1|.008
walls|english-bond-brick|brick|#b48a5e|#a49a86|#cfae80|.075|3,.065,1,2|.008
walls|limestone-ashlar|ashlar|#cdc4a8|#b4ab92|#e6dfca|.3|2.2,.02,1,0|.006
walls|granite-ashlar|ashlar|#9a9f9a|#74776f|#d6d4cc|.38|1.6,.03,1,1|.03
walls|sandstone-ashlar|ashlar|#bba27f|#a89478|#d9b98a|.33|2.4,.03,1,2|.012
walls|rubble-mortar|rubble|#9c9480|#6b675a|#c7bda2|.3|1.4,.045,1,0|.03
walls|dry-stone|rubble|#9a9d88|#5a6052|#c1c6ac|.28|2.2,.05,1,1|.05
walls|flint-wall|rubble|#4d5357|#c4baa0|#e3ddcc|.13|1,.04,1,2|.02
walls|gabion-wall|gabion|#9a9a8c|#3e4640|#c8c2ae|.12|.85,.035,1,0|.06
walls|mountain-stone-lime|rubble|#8d887c|#6a6458|#d9d2c0|.34|1.15,.075,1,3|.035
walls|hairpin-parapet|ashlar|#8f8a80|#a29b8c|#bdb7a9|.3|1.8,.035,1,3|.02
walls|ccc-rubble-guardwall|rubble|#6e5148|#57524c|#5f6a58|.22|2.4,.05,1,4|.04
roofs|canal-clay-tile|roof-tile|#b36f4c|#6e3f2b|#d29a6c|.22|1.8,.04,1,0|.06
roofs|interlock-clay-tile|roof-tile|#9c5a3e|#5e3426|#bf8462|.26|1.4,.05,1,1|.025
roofs|blue-slate|roof-shingle|#5f6b74|#3a434b|#8a8f9e|.26|.8,.035,1,0|.012
roofs|stone-lauze|roof-shingle|#8f8b78|#4f5246|#c9c3a3|.42|1.3,.045,1,1|.04
roofs|cedar-shingle|roof-shingle|#a07a52|#5a4a38|#c69a68|.14|.9,.04,1,2|.015
roofs|standing-seam|roof-seam|#4f6a6a|#344646|#9fb0aa|.45|1,.025,1,0|.03
roofs|corrugated-sheet|roof-seam|#a3aaa1|#69766e|#d1d3c1|.076|1,.03,1,1|.018
roofs|asphalt-shingle|roof-shingle|#6c6a64|#3c3b38|#9a958a|.14|6.5,.035,1,3|.006
roofs|larch-shingle|roof-shingle|#8a7c6a|#46403a|#b9aa8e|.1|.55,.03,1,2|.012
roofs|zinc-snow-stop|roof-seam|#8c9499|#5a6267|#5d6266|.5|1,.02,1,2|.03
ground|road-asphalt|aggregate|#5a5e5f|#26292b|#a3a39a|.02|1,.06,1,0|.003
ground|road-chipseal|aggregate|#7d7c77|#383836|#b4b1a6|.04|1,.04,1,1|.006
ground|rounded-cobbles|cobbles|#8b8a82|#4a4538|#b9b5a6|.19|1.3,.06,1,0|.03
ground|granite-setts|setts|#7d8286|#3c3d3b|#c0bfb6|.13|1.7,.05,1,0|.02
ground|river-gravel|aggregate|#9c8a70|#4f473c|#cfc6b4|.05|1,.04,1,2|.012
ground|crushed-limestone|aggregate|#c2bdab|#8d8878|#e6e1d1|.035|1,.06,1,3|.005
ground|woodland-litter|litter|#7a5838|#2e271d|#b08a4a|.12|1,.03,1,0|.008
ground|loamy-earth|soil|#5f4934|#2f251c|#a39274|.07|1,.03,1,0|.012
ground|red-clay|soil|#9b5d43|#57301f|#c99a7a|.22|1,.025,1,1|.006
ground|beach-sand|sand|#dcc9a0|#9e8d6f|#f2e6c8|.12|1,.03,1,0|.012
ground|layered-rock|strata|#958c7e|#56514a|#c9bfa8|.35|2.4,.035,1,0|.05
ground|snow-crust|snow|#edf2f5|#a2b9d0|#ffffff|.3|1,.03,1,0|.025
props|zinc-galvanized|hammer|#a7b1b1|#6f7a7a|#d3dad6|.04|1,.03,1,1|.0004
props|oxidized-steel|metal|#77462b|#3f2b1f|#a2683e|.08|1,.03,1,2|.002
props|painted-rail|paint|#2f6b55|#1d4537|#9cc1a7|.08|1,.03,1,0|.0003
props|utility-concrete|concrete|#a8afa0|#727e6d|#cbd1b7|.6|1.5,.025,1,1
props|bench-planks|boards|#a08b66|#62563b|#c8b78b|.13|1,.04,1,0
props|woven-canvas|fabric|#a99c76|#6f6c52|#d0c39c|.008|1,.04,1,0|.0012
props|hemp-rope|rope|#b19c6c|#6f6343|#d5c795|.03|1,.04,1,0|.008
props|pebble-aggregate|aggregate|#b9b7aa|#5d5b55|#d8d2c0|.03|1,.03,1,4|.003
overlays|english-ivy|ivy|#3c5a2c|#22361b|#9fb07a|.12|1,.03,1,0|.012
overlays|boston-ivy|ivy|#52733a|#2f4a24|#b8463a|.16|1,.03,1,1|.01
overlays|moss-cushion|moss-cushion|#5f7a32|#34481f|#a3b05a|.05|1,.03,1,0|.008
overlays|crustose-lichen|lichen-crust|#a9ae94|#6e7363|#d9a441|.16|1,.03,1,0|.0015
overlays|green-algae-streaks|algae-streaks|#3c4a2a|#232b1a|#6f7f45|.3|1,.03,1,0|.0005
overlays|soot-streaks|ov-soot|#1b1a18|#3a3732|#5a554c|.3|2.6,.03,1,0|.0005
overlays|rust-bleed|ov-rust|#7a3a14|#3e1e0e|#b0622a|.3|1.2,.03,1,0|.0005
overlays|efflorescence|ov-efflor|#e6e2d6|#cfc9b8|#f6f4ee|.2|1,.03,1,0|.001
overlays|graffiti-tags|ov-graffiti|#d8417a|#1c1c1e|#3fb7c9|.3|1,.03,1,0|.0003
overlays|flyposting|ov-posters|#e6dcc4|#2a2a2a|#c8492c|.3|1,.03,1,0|.0008
overlays|water-stain-runs|ov-water|#5a5242|#2e2a22|#6a6250|.3|2.6,.03,1,0|.0003
ground|pine-needle-duff|duff|#6b4a30|#33271d|#9c6c42|.09|1,.03,1,0|.006
ground|summer-litter|litter|#5c7a38|#2f2a1e|#9aae58|.12|1,.03,1,1|.008
ground|brick-pavers|pavers|#8e4a36|#3d3530|#b87458|.1|2,.05,1,0|.012
props|w-beam-guardrail|wbeam|#a9b2b1|#5f6968|#d5dbd8|.31|1,.03,1,0|.012
props|jersey-barrier|barrier|#b5b2a8|#5e5c58|#d4d1c6|.2|1,.03,1,0|.002
props|reflective-sheeting|sheeting|#2f7a52|#1e4e34|#e8efe8|.012|1,.03,1,0|.0002
industrial|riveted-bridge-steel|riveted-steel|#ad9446|#9a3b24|#4e2e1c|.5|2,.03,1,0|.006
industrial|mill-corrugated-siding|sheet-metal|#767c79|#4a504e|#7a4a26|.076|1,.03,1,0|.018
industrial|weathering-steel-sheet|sheet-metal|#8a4826|#4a2618|#b06630|1.2|1.5,.01,1,1|.003
industrial|sooty-industrial-brick|brick|#6a3a2e|#4a463f|#a39b8b|.075|3,.065,1,3|.008
industrial|concrete-retaining-wall|concrete|#a19f96|#4a463e|#e6e2d6|1.2|1.5,.02,1,2|.01
industrial|steel-grate-deck|sheet-metal|#62676a|#2b2e30|#8a8e8c|.05|1,.2,1,2|.02
industrial|cast-iron-storefront|cast-iron|#2e3e34|#151916|#6a5a32|.6|1,.04,1,0|.012
industrial|concrete-sidewalk|concrete|#b6b3aa|#5d5a54|#d6d3ca|1.5|1,.01,1,3|.004
industrial|belgian-block-alley-wall|ashlar|#6e6a63|#58534b|#9a948a|.16|1.6,.045,1,1|.02
industrial|ghost-sign-brick|brick|#8a4a36|#8c8476|#e6dab6|.075|3,.065,1,4|.008
industrial|city-steps|concrete|#b0ada4|#5a5852|#8c9194|1|1,.02,1,4|.006
rock|adirondack-granite|granite|#9a8f86|#4a4642|#c9a99a|.25|1,.08,1,0|.03
rock|alpine-limestone|karst|#b9b8b0|#6d7174|#d8d6cc|.3|1,.05,1,0|.04
rock|argillite-strata|beds|#8c4a3c|#3b302c|#6f8466|.12|1,.04,1,0|.02
rock|sandstone-road-cut|beds|#b3967a|#66564a|#d2c1a8|.45|1,.03,1,1|.04
rock|serpentine-sea-cliff|serpentine|#5e6c5c|#252b27|#c3cab6|.5|1,.03,1,0|.02
rock|scree-talus|talus|#9c9a92|#3e3d3a|#c4c1b6|.18|1,.04,1,0|.04
rock|firn-snowfield|firn|#eef2f4|#a9bed2|#8a7d6c|.35|1,.03,1,0|.04
rock|glacier-ice|ice|#8fc8dc|#2c5e7c|#dcecf2|.6|1,.02,1,0|.03
rock|seep-wet-rock|seep|#6b6a63|#2b2b28|#c9c2a8|.3|1,.03,1,0|.02
rock|granite-riprap|talus|#8f8e88|#2f2f2d|#bdbab0|.5|1,.03,1,1|.08
markings|centre-edge-lines-us|lines|#f1efe6|#3e4144|#e7bf55|.2|7.2,.12,1,0|.001
markings|dashed-lines-fr|lines|#f3f2ec|#45484a|#f3f2ec|.2|6.5,.15,1,1|.001
markings|lane-skip-lines|lines|#eeece2|#404346|#e9c35a|.2|7.2,.12,1,2|.001
markings|tour-road-graffiti|lettering|#f2f0e8|#45474a|#e8c84a|.3|1,.06,1,0|.001
markings|zebra-crosswalk|crossing|#f0eee6|#404346|#f0eee6|.2|12,.5,1,0|.001
markings|green-bike-lane|bikelane|#3f8f55|#404346|#f2f0e8|.2|7.2,.12,1,0|.001
markings|sharrow|bikelane|#f1efe6|#3e4144|#f1efe6|.2|7.2,.12,1,1|.001
markings|tar-snake-sealant|crackseal|#0e0f10|#46494b|#1c1d1f|.3|7.2,.05,1,0|.002
markings|tyre-skid-marks|skid|#121314|#45484a|#2a2b2c|.25|7.2,.2,1,0|.0005
markings|utility-cut-patch|cutpatch|#2a2c2e|#4a4d4f|#0d0e0f|.03|7.2,.08,1,0|.003
markings|manhole-storm-grate|castiron|#57524b|#45484a|#9a9388|.05|7.2,.05,1,0|.01
markings|painted-kerb|kerbpaint|#c23a2e|#a9aaa2|#f0eee6|.05|1,.02,1,0|.001
water|sandy-lake-bed|waterbed|#c8b48a|#6b6248|#e0d2ae|.12|1,.03,.8,0|.008
water|river-cobble-bed|waterbed|#8e8a7c|#3d3a33|#b8ad94|.12|1,.03,.6,1|.03
water|glacial-silt|waterbed|#9cc6c2|#4f8a8c|#cfe6e2|.3|1,.03,1,2|.004
water|tannin-bog-bed|waterbed|#3c2a1c|#1d150e|#8a5a2e|.1|1,.03,.9,3|.006
water|shoreline-wet-band|shore|#b9a888|#5b5242|#d6c8aa|.06|1,.03,1,0|.01
water|wet-sand-swash|shore|#cdb990|#7d6e52|#f4f1e8|.5|1,.03,1,1|.006
water|kelp-wrack|wrack|#3f3a1c|#cbb994|#6e6026|.18|1,.03,1,0|.015
water|tidal-rock-pool|rockpool|#5c5a55|#22262a|#3b6a78|.25|1,.03,1,0|.03
water|lake-surface|surface|#3f6a78|#1e3a46|#a9c7cf|.4|1,.03,1,0|.004
`.trim();

const title = (s) => s.split('-').map((w) => w[0].toUpperCase()+w.slice(1)).join(' ');
export const TEXTURE_RECIPES = Object.freeze(authored.split('\n').map((line) => {
  const [family,id,pattern,color,secondary,accent,size,params,reliefM] = line.split('|');
  const cutout = ['leaves','grass','flowers'].includes(family);
  return Object.freeze({ id, family, pattern, color, secondary, accent, scaleM:Number(size), structure:Object.freeze(params.split(',').map(Number)), relief:reliefM===undefined?.004:Number(reliefM), evergreen:EVERGREEN.has(id),
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
  wet:[.05,1,0,0], 'sun-bleached':[.3,0,.05,0], faded:[.55,0,.06,0], 'tyre-marked':[.45,0,.1,0],
  clear:[0,0,0,0], murky:[.2,.3,.3,0], glacial:[0,.1,.15,0], tannin:[.1,.2,.05,0], shallow:[0,.2,0,0], still:[0,.4,0,0], windy:[.1,.4,0,0],
  grimy:[.7,.1,.35,0], rusty:[.75,.05,.1,0], oily:[.5,.4,.15,0], graffitied:[.45,0,.05,0],
  light:[.02,0,0,0], medium:[.08,0,0,0], heavy:[.16,0,0,0], old:[.6,0,.08,0],
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
  // Ground's default finish is 'dry': a strong beige tint there made every ground recipe read alike.
  if (tint && recipe.family === 'ground' && finish === 'dry') tint[1] = .08;
  if (recipe.family === 'rock' && finish === 'dry') return colors; // rock kernels own their look
  // Evergreen recipes keep their colour through autumn finishes (larch etc. are not listed and do turn).
  if (tint && recipe.evergreen && finish.startsWith('autumn')) return colors;
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
