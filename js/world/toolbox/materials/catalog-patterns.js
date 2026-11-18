// Shared GLSL building blocks and individually compiled pattern kernels. Each recipe supplies dimensions,
// colours and structural controls. A program is shared by every finish of the same pattern.
import { VEG_GLSL, VEG_PATTERNS } from './catalog-vegetation.js';
import { GP_GLSL, GP_PATTERNS } from './catalog-ground-props.js';
import { HS_GLSL, HS_PATTERNS } from './catalog-hard-surfaces.js';

export const CATALOG_GLSL = /* glsl */`
  float catH(vec2 p) { vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
  float catN(vec2 p) { vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(catH(i),catH(i+vec2(1,0)),f.x),mix(catH(i+vec2(0,1)),catH(i+1.),f.x),f.y); }
  float catF(vec2 p) { return catN(p)*.6+catN(p*2.13+7.1)*.3+catN(p*4.7-3.3)*.1; }
  vec3 catCells(vec2 p) {
    vec2 cell=floor(p),f=fract(p); float d1=10.,d2=10.,id=0.;
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++) {
      vec2 b=vec2(float(i),float(j)); vec2 pt=b+.15+.7*vec2(catH(cell+b),catH(cell+b+17.3));
      float d=length(pt-f); if(d<d1){d2=d1;d1=d;id=catH(cell+b+31.7);}else d2=min(d2,d);
    }
    return vec3(d1,d2-d1,id);
  }
  float catStripe(float x,float width,float px) { float d=min(fract(x),1.-fract(x)); return 1.-smoothstep(width,width+px,d); }
  float catEllipse(vec2 q,vec2 r,float px) { return 1.-smoothstep(1.-px,1.+px,length(q/r)); }
  ${VEG_GLSL}
  ${GP_GLSL}
  ${HS_GLSL}
`;

// Inputs in every kernel: q (dimensionless seeded metres), u (card UV -1…1), px, nearD,
// st (ratio,joint,density,shape), base/secondary/accent. Outputs c and alpha.
export const CATALOG_PATTERNS = Object.freeze({
  ...GP_PATTERNS, // ground, props and vehicles: see catalog-ground-props.js
  ...VEG_PATTERNS, // trees, leaves, grass and flowers: see catalog-vegetation.js
  ...HS_PATTERNS, // buildings, walls, roofs (+ boards/concrete for props): see catalog-hard-surfaces.js
});
