import * as THREE from '../../../../vendor/three.module.min.js';
import { getTexture } from './texture-catalog.js';
import { CATALOG_GLSL, CATALOG_PATTERNS } from './catalog-patterns.js';

const PROJECTIONS = { local:0, world:1, uv:2, cylindrical:3 };
export function catalogMaterialSpec(id, options = {}) {
  const preset = getTexture(id), seed = options.seed ?? 1, scale = options.scale ?? 1, variation = options.variation ?? .65;
  if (!Number.isInteger(seed) || seed<0 || seed>65535) throw new RangeError('seed must be an integer 0…65535');
  if (!Number.isFinite(scale) || scale<.25 || scale>4) throw new RangeError('scale must be .25…4');
  if (!Number.isFinite(variation) || variation<0 || variation>1) throw new RangeError('variation must be 0…1');
  const projection=options.projection??preset.projection;
  if (!Object.hasOwn(PROJECTIONS,projection)) throw new RangeError('projection must be local, world, uv or cylindrical');
  if (preset.cutout && projection!=='uv') throw new RangeError('leaf, grass and flower cutouts require uv projection');
  if (options.color!==undefined && !/^#[0-9a-f]{6}$/i.test(options.color)) throw new RangeError('color must be #rrggbb');
  return { ...preset,seed,scale,variation,projection,colors:options.color?[options.color,...preset.colors.slice(1)]:preset.colors };
}

/** One material slot per surface. Local/cylindrical patterns follow moving meshes and instances.
 * Cutouts require UVs; they add no geometry. Existing wind, facade windows and baked-light hooks are
 * not silently replaced. Explicit kit adapters must compose those behaviours when needed. */
export function makeCatalogMaterial(id, options = {}) {
  const spec=catalogMaterialSpec(id,options), isGlass=spec.pattern==='glass';
  // Optional overlay layer (ivy, moss, grime, posters, paint…): a second catalog preset whose kernel runs after
  // the base and is mixed in by its alpha × amount. Same projection as the base; no extra draw call.
  const ov=options.overlay?(typeof options.overlay==='string'?{id:options.overlay}:options.overlay):null;
  const ovSpec=ov?catalogMaterialSpec(ov.id,{seed:ov.seed??spec.seed,scale:ov.scale??1,variation:ov.variation??.65,projection:spec.projection}):null;
  if(ov&&!(Number.isFinite(ov.amount??1)&&(ov.amount??1)>=0&&(ov.amount??1)<=1))throw new RangeError('overlay amount must be 0…1');
  if(ovSpec?.cutout)throw new RangeError('overlay presets must be surface (non-cutout) presets');
  const material=new THREE.MeshPhysicalMaterial({ color:'#ffffff', roughness:Math.max(.08,spec.roughness-spec.effects[1]*.3),
    metalness:spec.metalness,clearcoat:spec.clearcoat,clearcoatRoughness:.3,
    side:spec.cutout?THREE.DoubleSide:THREE.FrontSide,alphaTest:spec.cutout?.4:0,alphaToCoverage:spec.cutout,
    transparent:isGlass,opacity:isGlass?.55:1,depthWrite:!isGlass,
    emissive:spec.pattern==='lens'?spec.colors[0]:'#000000',emissiveIntensity:.2,
  });
  const uniforms={ catParams:{value:new THREE.Vector4(spec.scaleM*spec.scale,spec.seed,spec.variation,PROJECTIONS[spec.projection])},
    catBase:{value:new THREE.Color(spec.colors[0])},catSecondary:{value:new THREE.Color(spec.colors[1])},catAccent:{value:new THREE.Color(spec.colors[2])},
    catStructure:{value:new THREE.Vector4(...spec.structure)},catEffects:{value:new THREE.Vector4(...spec.effects)},catDensity:{value:spec.density},catTreatment:{value:spec.treatment},catRelief:{value:spec.relief??.004},catFinish:{value:spec.variant??0} };
  if(ovSpec)Object.assign(uniforms,{ catOParams:{value:new THREE.Vector4(ovSpec.scaleM*ovSpec.scale,ovSpec.seed+101,ovSpec.variation,ov.amount??1)},
    catOBase:{value:new THREE.Color(ovSpec.colors[0])},catOSecondary:{value:new THREE.Color(ovSpec.colors[1])},catOAccent:{value:new THREE.Color(ovSpec.colors[2])},
    catOStructure:{value:new THREE.Vector4(...ovSpec.structure)},catOEffects:{value:new THREE.Vector4(...ovSpec.effects)},catODensity:{value:ovSpec.density},
    catORelief:{value:ovSpec.relief??.004},catOFinish:{value:ovSpec.variant??0} });
  material.onBeforeCompile=(shader)=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec3 vCatLocal; varying vec3 vCatWorld; varying vec3 vCatNormal; varying vec3 vCatWorldNormal; varying vec2 vCatUV;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vCatLocal=position; vCatNormal=normal;
        vCatUV=vec2(0.);
        #ifdef USE_UV
          vCatUV=uv;
        #endif
        vec4 catP=vec4(position,1.); vec3 catNorm=normal;
        #ifdef USE_INSTANCING
          catP=instanceMatrix*catP;
          catNorm=transpose(inverse(mat3(instanceMatrix)))*catNorm;
        #endif
        vCatWorld=(modelMatrix*catP).xyz; vCatWorldNormal=transpose(inverse(mat3(modelMatrix)))*catNorm;`);
    // Three only defines USE_UV when a UV-dependent map is present. Force the attribute for cutout cards.
    if(spec.cutout) shader.vertexShader=shader.vertexShader.replace('vCatUV=vec2(0.);','vCatUV=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vCatLocal; varying vec3 vCatWorld; varying vec3 vCatNormal; varying vec3 vCatWorldNormal; varying vec2 vCatUV;
      uniform vec4 catParams; uniform vec3 catBase; uniform vec3 catSecondary; uniform vec3 catAccent;
      uniform vec4 catStructure; uniform vec4 catEffects; uniform float catDensity; uniform float catTreatment; uniform float catRelief; uniform float catFinish;
      ${ovSpec?'uniform vec4 catOParams; uniform vec3 catOBase; uniform vec3 catOSecondary; uniform vec3 catOAccent; uniform vec4 catOStructure; uniform vec4 catOEffects; uniform float catODensity; uniform float catORelief; uniform float catOFinish;':''}
      ${CATALOG_GLSL}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec3 point=catParams.w>.5&&catParams.w<1.5?vCatWorld:vCatLocal;
        vec3 norm=abs(normalize(catParams.w>.5&&catParams.w<1.5?vCatWorldNormal:vCatNormal));
        vec2 metres=norm.y>.7?point.xz:norm.x>norm.z?point.zy:point.xy;
        if(catParams.w>1.5&&catParams.w<2.5)metres=vCatUV*catParams.x;
        if(catParams.w>2.5)metres=vec2(atan(point.z,point.x)*length(point.xz),point.y);
        float px=max(length(dFdx(metres)),length(dFdy(metres)))/catParams.x+1e-5;
        float nearD=1.-smoothstep(.3,1.5,px);
        vec2 offset=vec2(mod(catParams.y,251.),floor(catParams.y/251.))*7.13;
        vec2 q=metres/catParams.x+offset,u=vCatUV*2.-1.;
        vec4 st=catStructure; st.z*=catDensity;
        float ly=point.y, up=normalize(vCatWorldNormal).y; // height (m, in the projection's space) and world up-ness for placement
        vec3 base=catBase,secondary=catSecondary,accent=catAccent;
        vec3 c=base*(1.+(catF(q*.37)-.5)*.15*catParams.z); float alpha=1.;
        // Relief contract: a kernel may write h (0 = deepest joint, 1 = proud face, .5 = flat), relief (metres
        // of depth for h 0→1; default from the recipe) and rgh (roughness multiplier). The core turns h into a
        // bump normal (no extra textures, no geometry) and fades it out with distance via nearD.
        float h=.5, relief=catRelief, rgh=1.;
        // Finish contract: fx starts as the preset's (wear,damp,dust,frost); catFinish is the finish's index in
        // its family list. cav>=0 (0 open/proud → 1 deep crevice) places the generic finish physically instead of
        // by mottling (dust/moss/damp to crevices, wear/frost to proud faces, frost also to up-facing).
        // fxOwned=1 switches the generic finish block off for kernels that place their own finishes.
        vec4 fx=catEffects; float cav=-1., fxOwned=0.;
        float catHBelow=.5; // overlay kernels see the base layer's h here (.5 when used standalone)
        ${CATALOG_PATTERNS[spec.pattern]}
        float catOn=1.-clamp(fxOwned,0.,1.);
        float wear=fx.x*catOn, damp=fx.y*catOn, dust=fx.z*catOn, frost=fx.w*catOn;
        float mottling=catF(q*.7);
        float deep=cav>=0.?cav:mottling, proud=cav>=0.?1.-cav:mottling;
        float upF=cav>=0.?clamp(normalize(vCatWorldNormal).y*.5+.5,0.,1.):1.;
        c=mix(c,c*.78+secondary*.12,smoothstep(.5,.8,proud)*wear*catParams.z);
        c=mix(c,accent*.75+vec3(.08,.065,.035),dust*(.5+deep*.4));
        c*=1.-damp*(.2+deep*.15);
        c=mix(c,vec3(.7,.78,.76),frost*smoothstep(.35,.8,proud)*upF);
        if(catOn>.5&&catTreatment>.5&&catTreatment<2.5){
          vec3 growth=catTreatment<1.5?vec3(.4,.46,.28):vec3(.12,.22,.065);
          c=mix(c,growth,smoothstep(.5,.72,deep)*.65);
        }
        if(catOn>.5&&catTreatment>2.5&&catTreatment<3.5){
          vec2 repair=fract(q*.2);float mask=step(.55,catH(floor(q*.2)))*step(.12,repair.x)*step(repair.x,.8)*step(.1,repair.y)*step(repair.y,.85);
          c=mix(c,base*.87,mask*.65);
        }
        if(catOn>.5&&catTreatment>3.5&&catTreatment<5.5){
          float scratch=catStripe(q.x*.7+catN(q*.2)*.06,.008,px)*smoothstep(.55,.8,catN(q*.17));
          c=mix(c,secondary,scratch*.4*nearD);
        }
        if(catOn>.5&&catTreatment>7.5&&catTreatment<9.5)c=mix(c,vec3(.2,.1,.035),smoothstep(.45,.72,mottling)*.55);
        ${ovSpec?`{
          // Overlay layer: its kernel sees the same variables, shadowed with the overlay preset's values.
          vec3 catBelow=c; catHBelow=h;
          vec3 catOC; float catOA, catOH, catORgh;
          {
            vec2 q=metres/catOParams.x+vec2(mod(catOParams.y,251.),floor(catOParams.y/251.))*7.13;
            float px=max(length(dFdx(metres)),length(dFdy(metres)))/catOParams.x+1e-5, nearD=1.-smoothstep(.3,1.5,px);
            vec4 st=catOStructure; st.z*=catODensity; vec3 base=catOBase,secondary=catOSecondary,accent=catOAccent;
            vec3 c=base*(1.+(catF(q*.37)-.5)*.15*catOParams.z); float alpha=1.;
            float h=.5, relief=catORelief, rgh=1.; vec4 fx=catOEffects; float cav=-1., fxOwned=0.;
            float catFinish=catOFinish; vec4 catEffects=catOEffects; float catDensity=catODensity, catTreatment=0.;
            vec4 catParams=vec4(catOParams.xyz,catParams.w); // initializer still reads the base's projection
            ${CATALOG_PATTERNS[ovSpec.pattern]}
            catOC=c; catOA=clamp(alpha,0.,1.)*catOParams.w; catOH=h; catORgh=rgh;
          }
          c=mix(catBelow,catOC,catOA); h=mix(catHBelow,max(catHBelow,catOH),catOA); rgh=mix(rgh,catORgh,catOA);
        }`:''}
        diffuseColor.rgb*=c; diffuseColor.a*=alpha;
        float catHm=(h-.5)*relief*nearD; float catRgh=rgh;`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n        roughnessFactor=clamp(roughnessFactor*catRgh,.04,1.);')
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        {
          vec3 sx=dFdx(-vViewPosition), sy=dFdy(-vViewPosition);
          vec3 r1=cross(sy,normal), r2=cross(normal,sx); float det=dot(sx,r1)*faceDirection;
          vec3 grad=sign(det)*(dFdx(catHm)*r1+dFdy(catHm)*r2);
          grad*=min(1.,.6*abs(det)/max(length(grad),1e-6)); // cap tilt ≈30° so 1px joint steps don't tick under toon bands
          normal=normalize(abs(det)*normal-grad);
        }`);
  };
  material.customProgramCacheKey=()=>`catalog-material-3-${spec.pattern}-${spec.cutout}-${ovSpec?.pattern??''}`;
  material.userData.textureCatalog={id,overlay:ovSpec?.id??null,recipe:spec.recipe,family:spec.family,finish:spec.finish,seed:spec.seed,projection:spec.projection};
  return material;
}
