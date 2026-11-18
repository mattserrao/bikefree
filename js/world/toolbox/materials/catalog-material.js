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
  const material=new THREE.MeshPhysicalMaterial({ color:'#ffffff', roughness:Math.max(.08,spec.roughness-spec.effects[1]*.3),
    metalness:spec.metalness,clearcoat:spec.clearcoat,clearcoatRoughness:.3,
    side:spec.cutout?THREE.DoubleSide:THREE.FrontSide,alphaTest:spec.cutout?.4:0,alphaToCoverage:spec.cutout,
    transparent:isGlass,opacity:isGlass?.55:1,depthWrite:!isGlass,
    emissive:spec.pattern==='lens'?spec.colors[0]:'#000000',emissiveIntensity:.2,
  });
  const uniforms={ catParams:{value:new THREE.Vector4(spec.scaleM*spec.scale,spec.seed,spec.variation,PROJECTIONS[spec.projection])},
    catBase:{value:new THREE.Color(spec.colors[0])},catSecondary:{value:new THREE.Color(spec.colors[1])},catAccent:{value:new THREE.Color(spec.colors[2])},
    catStructure:{value:new THREE.Vector4(...spec.structure)},catEffects:{value:new THREE.Vector4(...spec.effects)},catDensity:{value:spec.density},catTreatment:{value:spec.treatment} };
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
      uniform vec4 catStructure; uniform vec4 catEffects; uniform float catDensity; uniform float catTreatment;
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
        vec3 base=catBase,secondary=catSecondary,accent=catAccent;
        vec3 c=base*(1.+(catF(q*.37)-.5)*.15*catParams.z); float alpha=1.;
        ${CATALOG_PATTERNS[spec.pattern]}
        float wear=catEffects.x, damp=catEffects.y, dust=catEffects.z, frost=catEffects.w;
        float mottling=catF(q*.7);
        c=mix(c,c*.78+secondary*.12,smoothstep(.5,.8,mottling)*wear*catParams.z);
        c=mix(c,accent*.75+vec3(.08,.065,.035),dust*(.5+mottling*.4));
        c*=1.-damp*(.2+mottling*.15);
        c=mix(c,vec3(.7,.78,.76),frost*smoothstep(.35,.8,mottling));
        if(catTreatment>.5&&catTreatment<2.5){
          vec3 growth=catTreatment<1.5?vec3(.4,.46,.28):vec3(.12,.22,.065);
          c=mix(c,growth,smoothstep(.5,.72,mottling)*.65);
        }
        if(catTreatment>2.5&&catTreatment<3.5){
          vec2 repair=fract(q*.2);float mask=step(.55,catH(floor(q*.2)))*step(.12,repair.x)*step(repair.x,.8)*step(.1,repair.y)*step(repair.y,.85);
          c=mix(c,base*.87,mask*.65);
        }
        if(catTreatment>3.5&&catTreatment<5.5){
          float scratch=catStripe(q.x*.7+catN(q*.2)*.06,.008,px)*smoothstep(.55,.8,catN(q*.17));
          c=mix(c,secondary,scratch*.4*nearD);
        }
        if(catTreatment>7.5&&catTreatment<9.5)c=mix(c,vec3(.2,.1,.035),smoothstep(.45,.72,mottling)*.55);
        diffuseColor.rgb*=c; diffuseColor.a*=alpha;`);
  };
  material.customProgramCacheKey=()=>`catalog-material-1-${spec.pattern}-${spec.cutout}`;
  material.userData.textureCatalog={id,recipe:spec.recipe,family:spec.family,finish:spec.finish,seed:spec.seed,projection:spec.projection};
  return material;
}
