// Shared GLSL building blocks and individually compiled pattern kernels. Each recipe supplies dimensions,
// colours and structural controls. A program is shared by every finish of the same pattern.
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
`;

// Inputs in every kernel: q (dimensionless seeded metres), u (card UV -1…1), px, nearD,
// st (ratio,joint,density,shape), base/secondary/accent. Outputs c and alpha.
export const CATALOG_PATTERNS = Object.freeze({
  paint: `float grain=catN(q*12.); c*=1.+(grain-.5)*(.04+st.w*.035)*nearD; c=mix(c,accent,pow(max(0.,grain),12.)*.12*nearD);`,
  hammer: `vec3 cell=catCells(q); c*=.87+cell.z*.22; c*=1.-(1.-smoothstep(.0,.2,cell.x))*.12*nearD;`,
  metal: `float lines=catN(vec2(q.x*25.,q.y*.12)); c*=1.+(lines-.5)*.2*nearD; c=mix(c,secondary,smoothstep(.68,.86,catF(q*.5))*st.w*.18);`,
  rubber: `float rib=catStripe(q.x*.65,.06,px); c*=1.-rib*.18*nearD; c*=1.+(catN(q*12.)-.5)*.16*nearD;`,
  tread: `vec2 z=vec2(q.x*st.x,q.y); z.x+=abs(fract(z.y*.5)-.5)*.9; float groove=max(catStripe(z.x,st.y,px),catStripe(z.y*.5,st.y*.6,px)); c=mix(c,secondary,groove*.8*nearD);`,
  glass: `c=mix(c,accent,.12+.06*sin(q.x*.7+q.y*.3)); c*=1.+(catN(q*8.)-.5)*.015*nearD;`,
  lens: `vec2 r=abs(fract(q*vec2(st.x,1.))-.5)*2.; c=mix(secondary,base,(.6+.4*cos(r.x*1.57))*(.6+.4*cos(r.y*1.57))); c=mix(c,accent,pow(max(0.,1.-length(r)),5.)*.4*nearD);`,
  'bark-smooth': `float row=floor(q.y*2.); float scar=(1.-smoothstep(.03,.08+px,abs(fract(q.y*2.)-.5)))*smoothstep(.48,.65,catN(vec2(q.x*4.,row))); c=mix(c,secondary,scar*nearD*(1.-min(st.w,1.)*.7)); c*=1.+(catF(q*vec2(2.,.4))-.5)*.13;`,
  'bark-fissured': `float g=catF(vec2(q.x*2.+catN(q*.3)*.7,q.y*.14*st.x)); float crack=smoothstep(.52,.7,g); c=mix(c,secondary,crack*.8*nearD); c*=1.+(catN(q*vec2(8.,1.))-.5)*.18*nearD;`,
  'bark-scaled': `vec2 z=q; z.x+=mod(floor(z.y),2.)*.5; vec3 cells=catCells(z*vec2(1.,.65)); c=mix(secondary,base,.4+cells.z*.6); c=mix(secondary,c,smoothstep(.02,.08+px,cells.y));`,
  'bark-peeling': `float blotch=catF(q*vec2(2.,.3)); c=mix(secondary,base,smoothstep(.3,.6,blotch)); c=mix(c,accent,smoothstep(.67,.8,blotch)); c*=1.-(1.-smoothstep(.01,.04,abs(blotch-.55)))*.12*nearD;`,
  'bark-diamond': `vec2 z=vec2(q.x+q.y/st.x,q.x-q.y/st.x); float seam=max(catStripe(z.x,st.y,px),catStripe(z.y,st.y,px)); c=mix(c,secondary,seam*.7*nearD); c*=1.+(catN(floor(z))-.5)*.25*nearD;`,
  'leaf-palmate': `float angle=atan(u.x,u.y),r=length(u); float lobe=abs(fract(angle/6.283*st.w+.5)-.5)*2.; float boundary=.9-.43*pow(lobe,.7); boundary-=abs(sin(angle*st.w*5.))*.025; alpha=1.-smoothstep(boundary-.012,boundary+.012,r); float stem=(1.-smoothstep(.012,.025,abs(u.x)))*step(-.95,u.y)*(1.-step(-.4,u.y)); alpha=max(alpha,stem); float vein=pow(abs(cos(angle*st.w)),22.)*r; c=mix(secondary,base,1.-r*.45); c=mix(c,accent,vein*.2);`,
  'leaf-lobed': `float y=u.y*.95; float w=(.23+.14*cos(y*st.w*3.14))*sqrt(max(0.,1.-y*y)); alpha=1.-smoothstep(w-.015,w+.015,abs(u.x)*st.x); float vein=catStripe(abs(u.x)+abs(u.y)*.3,.025,.01); c=mix(c,accent,vein*.18);`,
  'leaf-oval': `float edge=length(u/vec2(st.x,.92)); edge+=sin(atan(u.y,u.x)*24.)*.012*st.w; alpha=1.-smoothstep(.98,1.02,edge); float veins=max(1.-smoothstep(.01,.035,abs(u.x)),catStripe(u.y*5.-abs(u.x)*3.,.025,.03)*.5); c=mix(c,accent,veins*.25);`,
  'leaf-lance': `float width=st.x*pow(max(0.,1.-u.y*u.y),.7); alpha=1.-smoothstep(width-.015,width+.015,abs(u.x)); c=mix(c,accent,(1.-smoothstep(.01,.035,abs(u.x)))*.3);`,
  frond: `float y=(u.y+1.)*.5,n=st.z; float local=fract(y*n); float reach=st.x*sin(y*3.14); float blade=(1.-smoothstep(.06,.15,abs(local-.5-abs(u.x)*.2)))*(1.-smoothstep(reach,reach+.03,abs(u.x))); alpha=max(blade,(1.-smoothstep(.01,.025,abs(u.x)))*step(abs(u.y),.95)); c=mix(secondary,base,y);`,
  needles: `float a=atan(u.x,u.y),r=length(u); float needle=abs(sin(a*st.z)); alpha=(1.-smoothstep(.06,.14,needle*r))*(1.-smoothstep(.78,.95,r)); c=mix(secondary,accent,r*.6);`,
  grass: `float y=(u.y+1.)*.5; float id=floor((u.x+1.)*.5*st.z),h=catH(vec2(id,catParams.y)); float height=(.65+h*.34)*(catDensity<.9?.7:1.); float centre=(id+.5)/st.z*2.-1.; float bend=(h-.5)*.08*y*y; float width=max(0.,1.-y/height)*(.018+st.x*.03); alpha=(1.-smoothstep(width,width+.008,abs(u.x-centre-bend)))*(1.-smoothstep(height-.015,height,y)); c=mix(secondary,base,y); c=mix(c,accent,smoothstep(.5,height,y)*.3);`,
  clover: `alpha=max(catEllipse(u-vec2(-.27,.15),vec2(.32,.4),.02),max(catEllipse(u-vec2(.27,.15),vec2(.32,.4),.02),catEllipse(u-vec2(0.,-.32),vec2(.35,.36),.02))); float ring=1.-smoothstep(.03,.07,abs(length(u)-.35)); c=mix(c,accent,ring*.4);`,
  'flower-radial': `float r=length(u),a=atan(u.y,u.x),petal=.62+.2*cos(a*st.z); alpha=1.-smoothstep(petal-.02,petal+.02,r); c=mix(base,secondary,1.-smoothstep(.18,.26,r)); c=mix(c,accent,pow(max(0.,cos(a*st.z)),4.)*smoothstep(.25,.8,r)*.16);`,
  'flower-cup': `float r=length(u),a=atan(u.y,u.x); float petal=.68+.12*cos(a*st.z); alpha=1.-smoothstep(petal-.02,petal+.02,r); c=mix(secondary,base,smoothstep(.1,.28,r)); c=mix(c,accent,pow(r,2.)*.28); c*=.88+.12*abs(sin(a*st.z*.5));`,
  'flower-spike': `float y=(u.y+1.)*.5; float width=st.x*(1.-y*.8); float row=floor(y*st.z); float side=mod(row,2.)*2.-1.; float b=catEllipse(vec2(u.x-side*width*.45,fract(y*st.z)-.5),vec2(width,.42),.03); alpha=max(b,(1.-smoothstep(.01,.025,abs(u.x)))*.7); c=mix(secondary,base,.5+.5*y); c=mix(c,accent,step(.65,fract(y*st.z))*.3);`,
  'flower-bell': `float y=(u.y+1.)*.5,w=.17+pow(1.-y,2.)*.5; alpha=(1.-smoothstep(w,w+.025,abs(u.x)))*smoothstep(.1,.15,y)*step(y,.95); c=mix(accent,base,smoothstep(.12,.4,y)); c*=.88+.12*cos(u.x*st.z*4.);`,
  plaster: `float blot=catF(q); c=mix(c,secondary,smoothstep(.6,.85,blot)*.3); c*=1.+(catN(q*30.)-.5)*(.1+st.w*.03)*nearD;`,
  boards: `float axis=st.w<.5?q.y:q.x; float f=fract(axis); float board=catH(vec2(floor(axis),3.)); float grain=catF(vec2(q.x*.6,q.y*18.)); c*=.86+board*.28; c*=1.+(grain-.5)*.14*nearD; c=mix(c,secondary,(1.-smoothstep(st.y,st.y+px,min(f,1.-f)))*.75*nearD);`,
  logs: `float f=fract(q.y); float roundness=sin(f*3.14159); c*=.72+roundness*.28; c=mix(c,secondary,(1.-smoothstep(.02,.08+px,min(f,1.-f)))*.8*nearD); c*=1.+(catN(q*vec2(.7,22.))-.5)*.15*nearD;`,
  timberframe: `float frame=max(catStripe(q.x,st.y,px),catStripe(q.y,st.y,px)); float diag=1.-smoothstep(st.y,st.y+px,abs(fract(q.x+q.y)-.5)); c=mix(c,secondary,max(frame,diag*.9)*nearD);`,
  concrete: `vec2 panel=q/vec2(st.x,1.); float seam=max(catStripe(panel.x,.008,px),catStripe(panel.y,.008,px)); c*=1.-seam*.22*nearD; float hole=1.-smoothstep(.018,.035+px,length(fract(q*2.)-.5)); c=mix(c,secondary,hole*.5*nearD); c*=1.+(catF(q*8.)-.5)*.12*nearD;`,
  'glass-block': `vec2 f=abs(fract(q)-.5)*2.; float edge=smoothstep(.8,.95,max(f.x,f.y)); c=mix(c,accent,edge*.6); c*=.8+.2*cos(f.x*2.)*cos(f.y*2.);`,
  brick: `float row=floor(q.y); float lengthB=st.x;
    if(st.w>.5&&st.w<1.5)lengthB=mod(floor(q.x/st.x*2.),3.)<1.?st.x*.5:st.x;
    if(st.w>1.5)lengthB=mod(row,2.)<1.?st.x:st.x*.5;
    float bx=q.x/lengthB+mod(row,2.)*.5; vec2 f=vec2(fract(bx)*lengthB,fract(q.y));
    float e=min(min(f.x,lengthB-f.x),min(f.y,1.-f.y)); float tone=catH(vec2(floor(bx),row));
    c*=.82+tone*.35; c=mix(secondary,c,smoothstep(st.y,st.y+px,e)*nearD+(1.-nearD));`,
  ashlar: `float row=floor(q.y),bx=q.x/st.x+mod(row,2.)*.5; vec2 f=vec2(fract(bx)*st.x,fract(q.y)); float e=min(min(f.x,st.x-f.x),min(f.y,1.-f.y)); c*=.85+catH(vec2(floor(bx),row))*.3; c=mix(secondary,c,smoothstep(st.y,st.y+px,e)*nearD+(1.-nearD)); c*=1.+(catN(q*50.)-.5)*.12*nearD;`,
  rubble: `vec3 cell=catCells(q*vec2(1.,st.x)); c*=.8+cell.z*.4; c=mix(secondary,c,smoothstep(st.y,st.y+px,cell.y)*nearD+(1.-nearD));`,
  gabion: `vec3 cell=catCells(q*3.); c*=.75+cell.z*.5; vec2 z=vec2(q.x+q.y,q.x-q.y); float wire=max(catStripe(z.x,.025,px),catStripe(z.y,.025,px)); c=mix(c,secondary,wire*.8*nearD);`,
  'roof-tile': `float row=floor(q.y/st.x); float x=q.x+(st.w>.5?mod(row,2.)*.5:0.); float ridge=.5+.5*cos(fract(x)*6.283); c*=.7+ridge*.3; float lip=catStripe(q.y/st.x,.045,px); c=mix(c,secondary,lip*.55*nearD); c*=.9+catH(vec2(floor(x),row))*.2;`,
  'roof-shingle': `float row=floor(q.y); float x=q.x/st.x+mod(row,2.)*.5; float seam=max(catStripe(x,.03,px),catStripe(q.y,.04,px)); c*=.82+catH(vec2(floor(x),row))*.35; c=mix(c,secondary,seam*.65*nearD); c*=1.+(catN(q*20.)-.5)*.14*nearD;`,
  'roof-seam': `float f=fract(q.x); float rib=st.w>.5?sin(f*6.283)*.16:catStripe(q.x,st.y,px)*.3; c*=1.-rib*nearD; c*=1.+(catN(q*vec2(12.,.2))-.5)*.08*nearD;`,
  aggregate: `vec3 cell=catCells(q); c=mix(secondary,base,.45+cell.z*.55); c=mix(c,accent,smoothstep(.7,.95,cell.z)*.35*nearD); c*=1.+(catN(q*9.)-.5)*.16*nearD; c=mix(base,c,nearD);`,
  cobbles: `vec3 cell=catCells(q*vec2(1.,st.x)); float joint=1.-smoothstep(st.y,st.y+px,cell.y); c*=.8+cell.z*.4; c*=.78+.22*(1.-smoothstep(.1,.6,cell.x)); c=mix(c,secondary,joint*.8*nearD); c=mix(base,c,nearD);`,
  litter: `vec2 f=fract(q)-.5; float h=catH(floor(q)),a=h*6.28; vec2 leaf=mat2(cos(a),-sin(a),sin(a),cos(a))*f; float mask=catEllipse(leaf,vec2(.35,.14),px); c=mix(c,accent,mask*.5*nearD); c*=1.+(catN(q*5.)-.5)*.2*nearD;`,
  soil: `c*=.84+catF(q*2.)*.32; float crack=1.-smoothstep(.01,.035,catCells(q*.7).y); c=mix(c,secondary,crack*.3*st.w*nearD); c*=1.+(catN(q*25.)-.5)*.15*nearD;`,
  sand: `float wave=sin(q.y*6.283+catN(q*vec2(.2,.05))*2.); c*=1.+wave*.09*nearD; c*=1.+(catN(q*65.)-.5)*.08*nearD;`,
  strata: `float y=q.y+(catN(q*vec2(.35,.1))-.5)*.5; float band=sin(y*6.28); c=mix(secondary,c,.65+band*.2); c*=1.-catStripe(y*.3,.03,px)*.2*nearD;`,
  snow: `c=mix(c,secondary,catF(q*.7)*.15); c=mix(c,accent,pow(catN(q*30.),12.)*.35*nearD);`,
  fabric: `vec2 weave=sin(q*6.283); float thread=(weave.x*weave.y); c*=1.+thread*.16*nearD; c*=.95+catN(floor(q))*.1*nearD;`,
  rope: `float twist=sin(q.y*6.283+q.x*5.); c*=.85+twist*.15*nearD; c*=1.+(catN(q*vec2(25.,2.))-.5)*.14*nearD;`,
});
