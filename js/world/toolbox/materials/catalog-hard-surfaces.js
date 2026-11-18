// Hard-surface kernels for the texture catalog: buildings, walls and roofs (plus the shared boards/concrete
// kernels used by props). Spread into CATALOG_PATTERNS by catalog-patterns.js; helpers join CATALOG_GLSL.
//
// Every kernel writes colour (c), a height profile (h: 0 deep joint … 1 proud face; depth comes from the
// recipe's relief column) and a roughness multiplier (rgh). It sets fxOwned=1 and calls catHS_weather() so a
// finish lands where it physically would: grime and rising damp at the foot (local y = 0 is the foot of the
// wall, as kit walls are built), moss in joints and on top faces, soot runs from above, dust on ledges, fresh
// re-pointing in patches, snow in recesses and on up-facing faces.
//
// Toon-friendly shape: joints and arrises also carry a small *baked* edge light (upper arris lighter, lower
// arris and the joint below a unit darker), because the gentle look's three light bands flatten fine bump
// lighting. Height ramps are kept ≥ ~2.5 px wide (catHS_bev) so the derivative bump never spikes into
// dashed ticks along joints.
// Distance: joints converge to their area mean (catHS_aa); per-unit tone and fine detail fade with nearD
// and `fine`, so far walls settle to a stable average instead of shimmering. One cell search at most.
export const HS_GLSL = /* glsl */`
  // Sharp mask → its area mean once the feature (width w, pattern units) is under ~a pixel.
  float catHS_aa(float sharp,float mean,float px,float w){ return mix(sharp,mean,smoothstep(.5*w,2.*w,px)); }
  // Height bevel: 0 in the joint (edge distance e < j) rising to 1 over w, never sharper than ~2.5 px.
  float catHS_bev(float e,float j,float w,float px){ return smoothstep(j-px,j+w+2.5*px,e); }
  // Inner distance of a rounded rectangle from its two edge distances; r = corner radius.
  float catHS_round(float ex,float ey,float r){ return min(min(ex,ey),r-length(max(vec2(r)-vec2(ex,ey),0.))); }
  // Random-length units along a course (x in nominal unit lengths, jit ≤ 1). Returns local x, length, id.
  vec3 catHS_course(float x,float row,float jit){
    float i=floor(x),b0=i+(catH(vec2(i,row))-.5)*jit,b1=i+1.+(catH(vec2(i+1.,row))-.5)*jit;
    float bm=i-1.+(catH(vec2(i-1.,row))-.5)*jit,b2=i+2.+(catH(vec2(i+2.,row))-.5)*jit;
    float s=step(b0,x),s1=step(b1,x),lo=mix(mix(bm,b0,s),b1,s1),hi=mix(mix(b0,b1,s),b2,s1);
    return vec3(x-lo,hi-lo,i-1.+s+s1);
  }
  // Jittered cells with per-axis jitter (coursed stone). Returns centre distance, half edge distance, id.
  vec3 catHS_cells(vec2 p,vec2 jit){
    vec2 cell=floor(p),f=fract(p); float d1=10.,d2=10.,id=0.;
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
      vec2 b=vec2(float(i),float(j)),pt=b+.5+(vec2(catH(cell+b),catH(cell+b+17.3))-.5)*jit; float d=length(pt-f);
      if(d<d1){d2=d1;d1=d;id=catH(cell+b+31.7);}else d2=min(d2,d);
    }
    return vec3(d1,(d2-d1)*.5,id);
  }
  // Baked arris light for a unit: dTop/dBot = distance (pattern units) from its upper/lower edge.
  float catHS_arris(float dTop,float dBot,float w,float k){ return 1.+((1.-smoothstep(0.,w,dTop))*.6-(1.-smoothstep(0.,w,dBot)))*k; }
  // Exact finish match by effect vector (finish names map to unique (wear,damp,dust,frost) sets).
  float catHS_fin(vec4 e){ vec4 d=abs(catEffects-e); return 1.-step(.02,max(max(d.x,d.y),max(d.z,d.w))); }
  // Smooth box mask (lo..hi) with a w-wide edge.
  float catHS_box(vec2 p,vec2 lo,vec2 hi,float w){ vec2 a=smoothstep(lo-w,lo+w,p)*(1.-smoothstep(hi-w,hi+w,p)); return a.x*a.y; }
  // Stylised graffiti tags (no words): loopy outlined strokes in 1.8 m cells, 0.3–2.1 m above the foot.
  // Returns ink colour and coverage. m: seeded metres, y: height (m), pxm: metres per pixel.
  vec4 catHS_tag(vec2 m,float y,float pxm){
    float cid=floor(m.x/1.8); vec2 f=vec2(fract(m.x/1.8)*1.8-.9,y-1.2);
    float s1=catH(vec2(cid,2.)),s2=catH(vec2(cid,3.)),present=step(.3,catH(vec2(cid,1.)));
    float xx=f.x/(.55+.2*s1),span=1.-smoothstep(.9,1.,abs(xx));
    float y1=.18*sin(xx*(5.+4.*s1)+s2*6.)+.08*sin(xx*13.+s1*9.),y2=-.28+.13*sin(xx*(7.+3.*s2)+1.)+.05*sin(xx*21.);
    float w=.035+.02*s2,d=min(abs(f.y-y1),abs(f.y-y2)+step(.5,s2)*9.);
    float vb=abs(fract(xx*2.2+s1)-.5)/2.2*(.55+.2*s1),vert=(1.-smoothstep(w*.8,w*.8+pxm,vb))*step(abs(f.y-y1+.05),.22)*step(.4,s1);
    float stroke=max((1.-smoothstep(w,w+pxm,d)),vert)*span,outline=max((1.-smoothstep(w+.025,w+.025+pxm,d)),vert)*span;
    vec3 ink=s1<.3?vec3(.86,.26,.47):s1<.55?vec3(.25,.7,.78):s1<.8?vec3(.93,.9,.84):vec3(.95,.78,.2);
    return vec4(mix(vec3(.06),ink,stroke),outline*present*step(abs(f.y),.9));
  }
  // Cap course on a parapet/guard wall of height capH (m): slabs .25 m thick on vertical faces, and on any
  // up-facing face. Returns mask, edge distance (m) to slab joints, slab id, and the drip shadow below the cap.
  vec4 catHS_cap(vec2 m,float y,float capH,float upY,float pxm){
    float top=step(.7,upY),band=max(smoothstep(capH-.25-pxm,capH-.25+pxm,y)*(1.-smoothstep(capH-pxm,capH+pxm,y))*(1.-top),top);
    vec3 b=catHS_course(m.x/.9,7.,.6); float ex=min(b.x,b.y-b.x)*.9;
    float ey=top>.5?1.:min(y-(capH-.25),capH-y);
    float shadow=(1.-top)*(1.-smoothstep(0.,.07,capH-.25-y))*step(y,capH-.25);
    return vec4(band,min(ex,ey),b.z,shadow);
  }
  // Overlay finish controls from the overlay's own catFinish: amount, old, damp(+1)/dry(-1), frost.
  vec4 catHS_ovk(float f){ return vec4(f<.5?.45:f<1.5?.72:f<2.5?1.:.8,step(3.5,f)*step(f,4.5),step(4.5,f)*step(f,5.5)-step(5.5,f)*step(f,6.5),step(6.5,f)); }
  vec3 catHS_ovTone(vec3 c,vec4 k){ c=mix(c,mix(vec3(dot(c,vec3(.33))),vec3(.62,.6,.56),.3),k.y*.45); c*=1.-k.z*.25; return mix(c,vec3(.88,.91,.94),k.w*.5); }
  // Physically placed finishes. wm: seeded metres; y: local height (m); top: 1 on up-facing faces;
  // cav: 1 in joints/grooves (anti-aliased); footK: 1 for walls, 0 for roofs (no splash zone).
  void catHS_weather(inout vec3 c,inout float rgh,vec2 wm,float y,float top,float cav,float footK,vec3 accent){
    float wear=catEffects.x,damp=catEffects.y,dust=catEffects.z,frost=catEffects.w,side=1.-top;
    float n=catN(wm*1.6),n2=catN(wm*vec2(3.5,.28)+17.3);
    float foot=side*footK*(1.-smoothstep(0.,.3+.6*n,y));
    float streak=side*smoothstep(.5,.85,n2)*(.5+.5*n);
    cav=clamp(cav,0.,1.); c*=1.+(catN(wm*.35+5.)-.5)*.1;
    c*=1.-(foot*.26+cav*.1+streak*.12)*(.25+wear*.9);
    float soot=catHS_fin(vec4(.6,.12,.08,0.));
    c=mix(c,vec3(.075,.075,.07),soot*clamp(.12+streak*.8+cav*.35+top*.3,0.,1.)*.6);
    float rise=smoothstep(.15,.9+.6*n,y),wet=min(max(side*footK*(1.-rise),top*.8)+cav*.3,1.);
    c*=1.-damp*.42*wet; rgh*=1.-damp*.5*wet;
    c+=damp*side*footK*rise*(1.-rise)*.1;
    float dm=dust*clamp(top*.9+cav*.55+foot*.7,0.,1.)*(.55+.45*n);
    c=mix(c,mix(accent,vec3(.74,.67,.55),.55),dm*.75); rgh=mix(rgh,1.,dm);
    float moss=step(1.5,catTreatment)*step(catTreatment,2.5)*smoothstep(.7,.86,n*.55+cav*.5+top*.45+foot*.4+catN(wm*7.)*.2);
    c=mix(c,mix(vec3(.17,.23,.09),vec3(.3,.36,.14),n2),moss*.85); rgh=mix(rgh,1.,moss);
    vec2 pg=wm*vec2(.7,1.1),pf=fract(pg);
    float pr=max(abs(pf.x-.48)/.33,abs(pf.y-.52)/.32)+(catN(wm*9.)-.5)*.25;
    float patchM=step(2.5,catTreatment)*step(catTreatment,3.5)*step(.6,catH(floor(pg)+3.1))*(1.-step(1.,pr));
    c=mix(c,mix(c*1.06+.015,accent*1.05,cav),patchM*.65);
    float snow=frost*smoothstep(.45,.7,top*.8+cav*.5+n*.45-.1);
    c=mix(c,vec3(.9,.93,.96),snow); rgh=mix(rgh,1.,snow);
    // Industrial finishes (grimy, rusty, oily, graffitied), matched by their effect vectors.
    float grimy=catHS_fin(vec4(.7,.1,.35,0.)),rusty=catHS_fin(vec4(.75,.05,.1,0.)),oily=catHS_fin(vec4(.5,.4,.15,0.)),graf=catHS_fin(vec4(.45,0.,.05,0.));
    c*=1.-grimy*(.16+cav*.25+foot*.2+streak*.18); c=mix(c,vec3(.15,.14,.12),grimy*clamp(n*.3+cav*.35+foot*.3,0.,1.));
    float rm=smoothstep(.55,.8,n*.55+cav*.45+catN(wm*5.)*.3+streak*.25);
    c=mix(c,mix(vec3(.4,.19,.08),vec3(.6,.33,.13),n2),rusty*rm*.8); rgh=mix(rgh,1.,rusty*rm);
    float om=oily*smoothstep(.5,.78,n*.6+foot*.6+top*.35+cav*.2);
    c=mix(c,vec3(.05,.05,.05),om*.7); rgh*=1.-om*.65;
    vec4 tag=catHS_tag(wm,y,max(length(dFdx(wm)),length(dFdy(wm))));
    c=mix(c,tag.rgb,graf*tag.a*side*.92);
  }
`;

// Shared epilogue: own the finish, weather with the kernel's cavity mask and foot factor.
// Roofs (foot 0) count pitched faces (≥ ~20°) as up-facing so snow, dust and moss settle on the slope.
const W = (cav, foot = '1.') => `fxOwned=1.; catHS_weather(c,rgh,q*catParams.x,point.y,smoothstep(${foot === '0.' ? '.3,.75' : '.6,.85'},normalize(vCatWorldNormal).y),${cav},${foot},accent);`;

export const HS_PATTERNS = Object.freeze({
  // Plaster, by st.w: 0 limewash over lumpy rubble (stones ghost through, wash thins on high spots),
  // 1 trowelled stucco (soft trowel sweeps, hairline cracks, darker plinth band below ~.55 m),
  // 2 roughcast/pebbledash (visible aggregate bumps), 3 adobe mud plaster eroding to mud-brick courses.
  plaster: `{ float uD=1.-smoothstep(.12,.6,px);
    float fine=1.-smoothstep(.02,.12,px),blot=catF(q*.6),jm=0.; c*=1.+(blot-.5)*.12*catParams.z;
    if(st.w<.5){
      vec3 s=catHS_cells(q*2.2,vec2(.9,.55)); float lump=smoothstep(.0,.16,s.y)*(1.-s.x*.45);
      h=.3+lump*.5+(catN(q*vec2(3.,30.))-.5)*.06*fine; jm=catHS_aa(1.-smoothstep(.0,.09,s.y),.2,px*2.2,.09);
      float thin=smoothstep(.66,.92,lump*.7+catN(q*5.)*.5)*(.15+catEffects.x*.85);
      c=mix(c,secondary,thin*.55); c*=1.-jm*.045*uD; c*=1.+(catN(vec2(q.x*4.,q.y*28.))-.5)*.05*fine;
    } else if(st.w<1.5){
      vec3 s=catHS_cells(q*1.6,vec2(.9)); float arc=sin(s.x*14.+s.z*6.283)*fine;
      h=.5+arc*.05+(blot-.5)*.25; c*=1.+arc*.012;
      float crack=(1.-smoothstep(.004,.004+px*.6,abs(catN(q*1.7+catN(q*6.)*.3)-.5)))*smoothstep(.58,.75,catN(q*.9+5.))*(.3+catEffects.x);
      crack*=fine; c*=1.-crack*.35; h-=crack*.3;
      float py=.55-point.y,plinth=smoothstep(-.004-px*catParams.x,.004+px*catParams.x,py)*(1.-smoothstep(.6,.85,norm.y));
      c=mix(c,secondary*.92,plinth*.8); c*=1.-(1.-smoothstep(0.,.05,abs(py)))*.12*uD; h=mix(h,.85,plinth); jm=max(crack,plinth*.3);
    } else if(st.w<2.5){
      float a=catN(q*2.6),b=catN(q*6.1+3.),pf=1.-smoothstep(.04,.3,px); float peb=smoothstep(.42,.78,a*.55+b*.45);
      h=mix(.5,.2+peb*.8,pf); jm=mix(.25,(1.-peb)*.5,pf);
      c=mix(c,mix(secondary,accent,step(.5,catH(floor(q*6.1)))),smoothstep(.7,.88,b)*.4*pf); c*=1.+(peb-.5)*.16*pf;
    } else if(st.w>3.5){
      // Alpine crépi: fine sprayed pastel render; painted (trompe-l'œil) window surrounds on a 3.2 m × 2.9 m
      // storey grid and a painted band under each floor line. Uses projected metres, so it lines up across walls.
      float grit=catN(q*85.)*.6+catN(q*190.)*.4,gf=1.-smoothstep(.002,.012,px);
      c*=1.+(grit-.5)*.12*gf; h=.5+(grit-.5)*.6*gf; jm=(1.-grit)*.2*gf;
      float pxm=px*catParams.x,side=1.-smoothstep(.6,.85,normalize(vCatWorldNormal).y);
      vec2 sp=vec2(mod(metres.x,3.2),mod(point.y,2.9));
      float win=catHS_box(sp,vec2(1.,.95),vec2(2.2,2.35),pxm),outer=catHS_box(sp,vec2(.84,.79),vec2(2.36,2.51),pxm);
      float frame=(outer-win)*side,band=catHS_box(vec2(0.,sp.y),vec2(-1.,2.68),vec2(1.,2.8),pxm)*side;
      float shade=(catHS_box(sp,vec2(.84,.75),vec2(2.4,.79),pxm)+catHS_box(sp,vec2(2.36,.75),vec2(2.4,2.51),pxm))*side;
      c=mix(c,secondary*(1.+(grit-.5)*.04*gf),frame*.92); c=mix(c,accent,band*.85); c*=1.-shade*.18*uD;
      c=mix(c,c*vec3(.93,.95,1.),win*side*.4);
      h=mix(h,.7,max(frame,band)); jm=max(jm,shade*.5);
    } else {
      float ero=smoothstep(.62,.82,catF(q*.4)+(1.-smoothstep(0.,1.,point.y))*.3+catEffects.x*.12);
      float row=floor(q.y*3.6),bx=q.x*1.1+mod(row,2.)*.5; vec2 f=vec2(fract(bx)/1.1,fract(q.y*3.6)/3.6);
      float e=min(min(f.x,1./1.1-f.x),min(f.y,1./3.6-f.y)),bj=catHS_aa(1.-smoothstep(.02,.03+px,e),.25,px,.03);
      vec3 brick=secondary*(.92+catH(vec2(floor(bx),row))*.16*uD); brick=mix(brick,secondary*.72,bj);
      c=mix(c,brick,ero*.85); jm=bj*ero;
      h=.55+(catF(q*1.3)-.5)*.6-ero*.25-(1.-catHS_bev(e,.02,.02,px))*ero*.25;
      float straw=smoothstep(.82,.9,catN(vec2(q.x*9.,q.y*60.)))*fine*(1.-ero); c=mix(c,accent,straw*.4);
    }
    ${W('jm')}
  }`,
  // Boards, by st.w: 0 horizontal planks with gaps (props/bench), 1 board-and-batten (rough-sawn vertical
  // boards, proud paler battens with nails and side shadows), 2 clapboard (tapered lapped profile, shadow
  // line under each lap, random butt joints, peeling paint showing grey wood).
  boards: `{ float uD=1.-smoothstep(.12,.6,px);
    float fine=1.-smoothstep(.02,.1,px),jm=0.;
    if(st.w>2.5){
      // Larch chalet boards: vertical, narrow dark gaps, cupped; sun-darkened to brown-black on faces turned
      // toward +z/−x (the sun side of the toolbox's default light), honey where sheltered, grey at the splash zone.
      float f=fract(q.x),col=floor(q.x),d=min(f,1.-f),g=st.y;
      float gap=catHS_aa(1.-smoothstep(g-px*.5,g+px*.5,d),2.*g,px,g);
      vec3 n=normalize(vCatWorldNormal); float sun=smoothstep(-.3,.8,dot(n,normalize(vec3(-.35,.25,.9))));
      float id=catH(vec2(col,3.)),eave=0.;
      vec3 wood=mix(accent,mix(base,secondary,.55),clamp(sun*(.75+.3*id)-eave*.25,0.,1.));
      wood*=(.88+id*.22*uD+.11*(1.-uD))*(1.+(catN(vec2(q.x*22.,q.y*1.1)+id*7.)-.5)*.2*fine);
      wood=mix(wood,vec3(.55,.53,.5),(1.-smoothstep(.05,.45,point.y))*.22*(1.-smoothstep(.6,.85,n.y)));
      c=mix(wood*(1.-(1.-smoothstep(g,g+.08,d))*.2*uD),secondary*.4,gap); jm=gap;
      h=(.75+.15*sin(f*3.14159))*catHS_bev(d,g,.03,px);
    } else if(st.w>1.5){
      float f=fract(q.y),row=floor(q.y); vec3 b=catHS_course(q.x/22.,row,.8);
      float bd=min(b.x,b.y-b.x)*22.,butt=catHS_aa(1.-smoothstep(.03,.03+px,bd),.0,px,.03);
      float lap=catHS_aa(1.-smoothstep(.0,.16,f),.08,px,.16);
      h=mix(.2,1.,pow(1.-f,.6))*smoothstep(0.,.03+2.5*px,f)*catHS_bev(bd,.0,.02,px); jm=lap;
      c*=.97+catH(vec2(b.z,row))*.06*uD; c*=(1.-lap*.38)*(1.+(1.-smoothstep(.0,.2,1.-f))*.08*uD); c*=1.-butt*.25;
      float peel=smoothstep(.66,.74,catF(q*vec2(1.2,3.)+3.)+catEffects.x*.25-.12)*fine;
      c=mix(c,mix(vec3(.55,.53,.48),secondary,.3)*(.9+(catN(vec2(q.x*2.,q.y*40.))-.5)*.3),peel); h-=peel*.08;
      c*=1.+(catN(vec2(q.x*.7,q.y*45.))-.5)*.04*fine;
    } else if(st.w>.5){
      float f=fract(q.x),col=floor(q.x),d=min(f,1.-f),bw=.1;
      float bat=catHS_aa(1.-smoothstep(bw-px*.5,bw+px*.5,d),bw*2.,px,bw);
      float ao=catHS_aa(1.-smoothstep(bw,bw+.14,d),.12,px,.1)*(1.-bat);
      float id=catH(vec2(col,3.)),bid=catH(vec2(floor(q.x+.5),11.));
      h=mix(.3+.06*sin(f*3.14159),1.,catHS_bev(-d,-bw-.03,.03,px)); jm=ao;
      vec3 board=c*(.86+id*.24*uD+.12*(1.-uD))*(1.+(catN(vec2(q.x*20.,q.y*1.2))-.5)*.16*fine);
      vec3 batten=c*1.12*(.95+bid*.1*uD);
      c=mix(board*(1.-ao*.4),batten*(1.-(1.-smoothstep(.0,.03,bw-d))*.15*uD),bat);
      float kx=fract(q.x)-.3-catH(vec2(col,9.))*.4,ky=q.y*.6+catH(vec2(col,5.));
      float knot=catEllipse(vec2(kx,(fract(ky)-.5)*2.4),vec2(.035,.08),px)*step(.55,catH(vec2(col,floor(ky))))*fine*(1.-bat);
      c=mix(c,secondary*.75,knot); h-=knot*.1;
      float nail=catEllipse(vec2(d,(fract(q.y*1.8)-.5)/1.8),vec2(.02),px)*bat*fine; c=mix(c,vec3(.2,.19,.18),nail*.8);
    } else {
      float f=fract(q.y),row=floor(q.y),g=st.y,gd=min(f,1.-f),gap=catHS_aa(1.-smoothstep(g-px*.5,g+px*.5,gd),2.*g,px,g);
      float id=catH(vec2(row,3.)); h=.3+.7*catHS_bev(gd,g,.1,px); jm=gap;
      c*=.86+id*.26*uD+.13*(1.-uD); c*=1.+(catF(vec2(q.x*.6+id*9.,q.y*18.))-.5)*.16*fine;
      c*=catHS_arris(1.-f-g,f-g,.08,.15*uD); c=mix(c,secondary*.6,gap*.85);
    }
    ${W('jm')}
  }`,
  // Round logs: baked round shading (lit crown, dark underside), narrow pale chinking, per-log tone,
  // long checking cracks. At distance the courses settle to their mean tone (no moiré).
  logs: `{ float uD=1.-smoothstep(.12,.6,px);
    float f=fract(q.y),row=floor(q.y),id=catH(vec2(row,7.)),fine=1.-smoothstep(.02,.1,px);
    float prof=sqrt(max(0.,1.-pow(f*2.-1.,2.)));
    float chink=catHS_aa(1.-smoothstep(st.y-px*.5,st.y+px*.5,min(f,1.-f)),2.*st.y,px,st.y);
    h=mix(.1,prof,catHS_bev(min(f,1.-f),st.y,.0,px));
    float shade=mix(.62+.5*smoothstep(.05,.75,f)-.12*smoothstep(.8,1.,f),.86,1.-uD);
    c*=(.86+id*.26*uD+.13*(1.-uD))*shade; c*=1.+(catN(vec2(q.x*1.2,q.y*24.))-.5)*.14*fine;
    float cy=.45+catH(vec2(row,2.))*.3,crack=(1.-smoothstep(.006,.012+px,abs(f-cy-(catN(vec2(q.x*.6,row))-.5)*.12)))*smoothstep(.45,.6,catN(vec2(q.x*.3,row*3.)))*fine;
    c*=1.-crack*.5; h-=crack*.25;
    c=mix(c,accent*.92*(.92+(catN(q*30.)-.5)*.1*fine),chink);
    ${W('chink+(1.-prof)*.3*uD')}
  }`,
  // Timber framing (1 unit = a storey): sill/plate, posts at bay spacing, mid-rails, per-bay braces or
  // St Andrew's crosses; proud oak members with grain and baked arris light, recessed limewashed infill with
  // shrinkage gaps along the timber.
  timberframe: `{ float uD=1.-smoothstep(.12,.6,px);
    float bw=.45,w=st.y,bay=floor(q.x/bw),lx=fract(q.x/bw)*bw,tly=fract(q.y),k=catH(vec2(bay,floor(q.y)));
    float dPost=min(lx,bw-lx),dRail=min(tly,1.-tly)*.8,dMid=abs(tly-.5)*1.15;
    vec2 pp=vec2(lx,mod(tly,.5)); float tup=step(.5,tly);
    float dir=step(.5,k)*2.-1.,len=length(vec2(bw,.5));
    float dA=abs((pp.y*bw-(dir>0.?pp.x:bw-pp.x)*.5))/len,dB=abs((pp.y*bw-(dir>0.?bw-pp.x:pp.x)*.5))/len;
    float brace=mix(mix(dA,10.,step(.35,abs(k-.5)*2.)),min(dA,dB),tup*step(.8,k));
    float d=min(min(dPost,dRail),min(dMid,brace));
    float t=catHS_aa(1.-smoothstep(w-px*.5,w+px*.5,d),.3,px,w);
    float gapL=(1.-smoothstep(.0,.006+px,abs(d-w-.004)))*(1.-t)*uD;
    float mid=catH(vec2(bay,floor(q.y*2.)+step(dPost,min(dRail,dMid))*9.)),fine=1.-smoothstep(.01,.06,px);
    vec3 oak=secondary*(.82+mid*.3*uD+.15*(1.-uD))*(1.+(catN(vec2(q.x*40.,q.y*3.)+mid*9.)-.5)*.22*fine);
    oak*=1.+(1.-smoothstep(.0,.25*w,w-d))*.18*uD;
    vec3 infill=base*(1.+(catF(q*3.)-.5)*.08);
    c=mix(infill,oak,t)*(1.-gapL*.45);
    h=mix(.3+(catN(q*4.)-.5)*.12,1.,catHS_bev(-d,-w,.012,px))-gapL*.25;
    ${W('gapL+(1.-t)*.12')}
  }`,
  // Concrete, by st.w: 0 board-formed cast walls (per-lift tone, board imprint, recessed form-tie cones,
  // efflorescence runs below ties); 1 plain utility concrete with panel seams and bug holes.
  concrete: `{ float uD=1.-smoothstep(.12,.6,px);
    float fine=1.-smoothstep(.01,.05,px); vec2 pn=q/vec2(st.x,1.),pf=fract(pn),pid=floor(pn);
    float e=min(min(pf.x,1.-pf.x)*st.x,min(pf.y,1.-pf.y));
    float seam=catHS_aa(1.-smoothstep(.006,.006+px,e),.02,px,.006);
    c*=1.+(catH(pid)-.5)*.1*catParams.z; c*=1.-seam*.3;
    c*=1.+(catN(q*vec2(5.,1.5))-.5)*.08; h=.6-(1.-catHS_bev(e,.006,.01,px))*.5;
    float pits=smoothstep(.86,.95,catN(q*38.))*fine; c*=1.-pits*.2; h-=pits*.3;
    float jm=seam;
    if(st.w<.5){
      c*=.94+.08*smoothstep(0.,1.,pf.y);
      float board=fract(q.y*9.),bl=catHS_aa(1.-smoothstep(.02,.02+px*9.,min(board,1.-board)),.04,px*9.,.02);
      c*=1.+(catH(vec2(floor(q.x*.7),floor(q.y*9.)))-.5)*.06*fine; c*=1.-bl*.08*fine; h-=bl*.12*fine;
      c*=1.+(catN(vec2(q.x*30.,q.y*3.))-.5)*.05*fine;
      vec2 tie=vec2(fract(pf.x*3.)-.5,fract(pf.y*2.)-.5)*vec2(st.x/3.,.5);
      float tr=length(tie),cone=catHS_aa(1.-smoothstep(.03-px*.5,.03+px*.5,tr),.01,px,.03);
      c=mix(c,secondary*.6,cone*.85); h-=(1.-smoothstep(.02,.04+2.5*px,tr))*.5*uD; jm=max(jm,cone);
      float run=(1.-smoothstep(.006,.025+px,abs(tie.x)))*step(tie.y,0.)*smoothstep(-.25,-.0,tie.y)*(.3+catEffects.x);
      c=mix(c,accent*1.05,run*.4*uD);
    } else if(st.w<2.5){
      // Retaining wall: board marks, weep holes low in each panel with rust-brown runs and white bloom below.
      float board=fract(q.y*7.),bl=catHS_aa(1.-smoothstep(.03,.03+px*7.,min(board,1.-board)),.06,px*7.,.03);
      c*=1.+(catH(vec2(floor(q.x*.5),floor(q.y*7.)))-.5)*.08*uD; c*=1.-bl*.1*fine; h-=bl*.15*fine;
      vec2 wh=vec2((fract(pf.x*2.)-.5)*st.x*.5,(point.y-.45)/catParams.x); float wr=length(wh);
      float weep=catHS_aa(1.-smoothstep(.05-px*.5,.05+px*.5,wr),.006,px,.05);
      c=mix(c,secondary*.3,weep); h-=(1.-smoothstep(.04,.06+2.5*px,wr))*.5*uD; jm=max(jm,weep);
      float wx=abs(wh.x+(catN(vec2(q.y*4.,pf.x*9.))-.5)*.04),below=step(wh.y,-.04);
      float run=(1.-smoothstep(.02,.05+px,wx))*below*(1.-smoothstep(.0,.3,-wh.y));
      float bloom=(1.-smoothstep(.04,.14+px,wx))*below*(1.-smoothstep(.0,.2,-wh.y))*(1.-run);
      c=mix(c,vec3(.33,.25,.17),run*.6*uD); c=mix(c,accent,bloom*(.25+catEffects.x*.4)*uD);
      c*=1.-smoothstep(.6,.85,catN(vec2(q.x*4.,q.y*.3)))*.12;
    } else if(st.w<3.5){
      // Sidewalk: tooled joints with smooth margins, expansion joints every 3rd panel, broom texture, stains, gum.
      float pxm=px*catParams.x; vec2 wm=q*catParams.x;
      float ed=min(fract(pn.x/3.),1.-fract(pn.x/3.))*3.*st.x;
      float exj=catHS_aa(1.-smoothstep(.01,.01+px,ed),.02,px,.01);
      float margin=1.-smoothstep(.03,.035+px,e);
      c*=1.+(catN(vec2(q.x*3.,q.y*160.))-.5)*.07*fine*(1.-margin); c*=1.+margin*.04*uD;
      c=mix(c,vec3(.12),exj*.85); h=min(h,1.-exj); jm=max(jm,exj);
      c*=1.-smoothstep(.62,.85,catF(q*1.3+7.))*.16;
      vec2 gc=floor(wm*2.5),gf=fract(wm*2.5)-.5-(vec2(catH(gc+1.),catH(gc+2.))-.5)*.6;
      float gum=step(.88,catH(gc))*catEllipse(gf,vec2(.04+.02*catH(gc+3.)),pxm*2.5+.01)*fine;
      c=mix(c,vec3(.24,.24,.23)*(.9+catH(gc+4.)*.3),gum*.85); h+=gum*.15;
    } else {
      // City steps: treads (0.3 m) with steel nosing at the front edge, worn polish behind it; risers (0.17 m)
      // with drip stains under each nosing.
      float pxm=px*catParams.x,tread=smoothstep(.6,.85,abs(normalize(vCatWorldNormal).y));
      float ft=fract(metres.y/(tread>.5?.3:.17)),nose=(tread>.5?1.-smoothstep(.07,.07+pxm/.3,ft):smoothstep(.86,.86+pxm/.17,ft));
      c=mix(c,accent*(1.+(catN(q*vec2(40.,4.))-.5)*.15*fine),nose); rgh=mix(rgh,.45,nose);
      c=mix(c,c*1.07,tread*(1.-nose)*smoothstep(.5,.75,catN(vec2(metres.x*1.2,0.)))*.8);
      c*=1.-(1.-tread)*(1.-smoothstep(.55,.85,ft))*smoothstep(.4,.86,ft)*smoothstep(.55,.75,catN(vec2(metres.x*6.,floor(metres.y/.17))))*.25;
      h=mix(h,.9,nose); jm=max(jm,(1.-nose)*(tread>.5?smoothstep(.85,1.,ft):1.-smoothstep(.0,.12,ft))*.6);
    }
    ${W('jm')}
  }`,
  // Glass blocks: light mortar grid, bevelled rims catching light, rippled faces over a darker interior;
  // per-block refraction tint. All block-scale variation fades with uD (no far moiré).
  'glass-block': `{ float uD=1.-smoothstep(.12,.6,px);
    vec2 f=fract(q)-.5,id=floor(q); float e=.5-max(abs(f.x),abs(f.y)),j=st.y;
    float jm=catHS_aa(1.-smoothstep(j-px*.5,j+px*.5,e),.19,px,j);
    float gD=1.-smoothstep(.03,.12,px),rim=smoothstep(j,j+.04,e)*(1.-smoothstep(j+.06,j+.12,e))*gD;
    float rip=sin(length(f)*38.-catH(id)*6.283)*(1.-smoothstep(.01,.04,px));
    vec3 inside=mix(secondary*.6,base,mix(.6,.45+.35*(f.x+f.y)*gD+catH(id)*.2*uD,uD));
    c=mix(inside*(1.+rip*.06),accent,rim*.55+(1.-gD)*.1); c=mix(c,vec3(.8,.8,.76)*accent,jm);
    h=mix(.7+rip*.06+rim*.3,0.,1.-catHS_bev(e,j,.04,px)); rgh=mix(.2,1.,jm);
    ${W('jm')}
  }`,
  // Brick bonds, by st.w: 0 running (stretchers, half lap), 1 Flemish (stretcher+header in every course,
  // headers centred on stretchers, burnt dark headers), 2 English (alternating stretcher and header courses;
  // header courses read as a finer, slightly darker band). st.x = stretcher length in course heights,
  // st.y = half mortar joint. Recessed mortar, chipped arrises, baked arris light, sand-faced speckle.
  brick: `{ float uD=1.-smoothstep(.06,.25,px);
    float L=st.x,j=st.y,row=floor(q.y),fy=fract(q.y),odd=mod(row,2.),xx,ulen=L,isH=0.,uid,bxl;
    if(st.w<.5){xx=q.x+odd*.5*L;bxl=mod(xx,L);uid=floor(xx/L);}
    else if(st.w<1.5){xx=q.x+odd*.75*L;float pp=mod(xx,1.5*L);isH=step(L,pp);ulen=mix(L,.5*L,isH);bxl=pp-isH*L;uid=floor(xx/(1.5*L))*2.+isH;}
    else{isH=odd;ulen=mix(L,.5*L,odd);xx=q.x+odd*.25*L;bxl=mod(xx,ulen);uid=floor(xx/ulen);}
    float ex=min(bxl,ulen-bxl),ey=min(fy,1.-fy),fine=1.-smoothstep(.02,.1,px);
    float chip=smoothstep(.65,.9,catN(q*vec2(3.,5.)+uid*3.7))*(.015+.07*catEffects.x)*fine;
    float e=catHS_round(ex,ey,j+.05)-chip;
    // Joints: sharp → a soft course rhythm (bed-joint sinusoid) at mid range → their area mean far away.
    float jmean=1.-(1.-2.*j/ulen)*(1.-2.*j);
    float jm=mix(mix(1.-smoothstep(j-px*.5,j+px*.5,e),jmean*(1.+.9*cos(6.283*fy)),smoothstep(.5*j,2.*j,px)),jmean,smoothstep(.25,.5,px));
    float t=catH(vec2(uid,row)),t2=catH(vec2(uid,row)+9.1);
    vec3 b=c*(.88+t*.24*uD+.12*(1.-uD));
    b=mix(b,accent,step(.86,t2)*.25*uD); b=mix(b,b*.7,step(t2,.07)*uD);
    float hF=mix(.33,isH,uD),hE=mix(.5,isH,uD);
    b=mix(b,b*vec3(.6,.56,.64),hF*step(.5,st.w)*step(st.w,1.5)*(.65+.25*mix(.5,t,uD)));
    b=mix(b,b*vec3(.82,.76,.74),hE*step(1.5,st.w));
    b*=1.+(catN(q*vec2(14.,24.))-.5)*.14*fine; float pit=smoothstep(.8,.92,catN(q*31.+t*5.))*fine; b*=1.-pit*.22;
    b*=catHS_arris(1.-fy-j,fy-j,.12,.16*(1.-smoothstep(.05,.2,px)));
    vec3 m=secondary*(1.+(catN(q*40.)-.5)*.2*fine)*(1.-(1.-smoothstep(.0,j*1.6,fy))*.25*uD);
    c=mix(b,m,jm);
    h=mix(.05,.85+.15*t-pit*.25,catHS_bev(e,j,.08,px));
    float pxm=px*catParams.x,side=1.-smoothstep(.6,.85,normalize(vCatWorldNormal).y); vec2 wm=q*catParams.x;
    if(st.w>2.5&&st.w<3.5){
      // Industrial: dressed-stone lintel/sill band at 2.55–2.8 m of every 3.2 m storey.
      float sy=mod(point.y,3.2),band=smoothstep(2.55-pxm,2.55+pxm,sy)*(1.-smoothstep(2.8-pxm,2.8+pxm,sy))*side;
      float sx=fract(wm.x/.9),se=min(min(sx,1.-sx)*.9,min(sy-2.55,2.8-sy));
      float sj=catHS_aa(1.-smoothstep(.006,.006+pxm,se),.02,pxm,.006);
      vec3 stone=accent*(.9+catH(vec2(floor(wm.x/.9),floor(point.y/3.2)))*.12*uD)*(1.+(catN(wm*20.)-.5)*.1*fine);
      stone*=1.-(1.-smoothstep(0.,.05,2.8-sy))*.0+(1.-smoothstep(0.,.04,2.8-sy))*.1*uD;
      c=mix(c,mix(stone,secondary,sj),band); h=mix(h,mix(.05,1.,smoothstep(.006,.02+2.5*pxm,se)),band); jm=mix(jm,sj,band);
      c*=1.-(1.-smoothstep(0.,.08,2.55-sy))*step(sy,2.55)*.25*side*uD;
    } else if(st.w>3.5){
      // Ghost sign: a faded painted panel of block 'letters' (abstract glyphs, no words) 0.3–3.3 m in every 4 m.
      float gy=mod(point.y,4.),gx=mod(wm.x,9.);
      float panel=catHS_box(vec2(gx,gy),vec2(.5,.3),vec2(8.5,3.3),pxm)*side;
      float ry=(gy-.45)/.95,row=floor(ry),fr=fract(ry),li=floor(gx/.55),lh=catH(vec2(li,row+floor(wm.x/9.)*7.));
      vec2 g=vec2(fract(gx/.55),(fr-.08)/.72); float sw=.22;
      float letter=catHS_box(g,vec2(.08,0.),vec2(.85,1.),pxm*2.)*step(.15,lh)*step(row,2.)*step(0.,row);
      letter*=1.-catHS_box(g,vec2(.08+sw,sw),vec2(.85-sw,.5-sw*.4),pxm*2.)*step(.3,lh);
      letter*=1.-catHS_box(g,vec2(.08+sw,.5+sw*.4),vec2(.85-sw,1.-sw),pxm*2.)*step(lh,.75);
      letter*=1.-catHS_box(g,vec2(.5,.32),vec2(1.,.68),pxm*2.)*step(.55,lh)*step(lh,.85);
      vec3 ground=vec3(.16,.19,.24),ink=mod(row,2.)<.5?accent:vec3(.82,.62,.3);
      float paint=panel*(.46-catEffects.x*.2)*(.55+.45*catN(wm*1.3))*(1.-.45*jm)*(1.-smoothstep(.62,.8,catN(wm*4.))*.6);
      c=mix(c,mix(mix(ground,c,.35),ink,letter),paint);
    }
    ${W('jm')}
  }`,
  // Ashlar, by st.w: 0 limestone (regular courses, crisp sawn faces, fine lime joints close to the stone,
  // shelly speckle); 1 granite (random course heights and lengths, rock-faced domed centres inside a flat
  // drafted margin, baked dome light, salt-and-pepper flecks); 2 sandstone (alternating thick/thin courses,
  // per-block tone and faint bedding, diagonal batted tooling, soft eroded arrises).
  ashlar: `{ float uD=1.-smoothstep(.06,.25,px);
    float capOn=step(2.5,st.w),row,fy,ch=1.,shape=capOn>.5?1.:st.w,fine=1.-smoothstep(.01,.06,px);
    if(shape<.5){row=floor(q.y);fy=fract(q.y);}
    else{float per=floor(q.y*.5),r=q.y-per*2.,a=shape<1.5?.6+.8*catH(vec2(per,5.)):1.3,s=step(a,r);
      row=per*2.+s;ch=mix(a,2.-a,s);fy=(r-s*a)/ch;}
    vec3 b=catHS_course(q.x/st.x+catH(vec2(row,1.))*.5,row,shape<.5?.2:shape<1.5?.7:.45);
    float len=b.y*st.x,lx=b.x*st.x,ex=min(lx,len-lx),ey=min(fy,1.-fy)*ch,j=st.y;
    float r=shape<.5?.02:shape<1.5?.03:.06+.05*catEffects.x;
    float ero=shape>1.5?(catN(q*7.+b.z)-.5)*.04*fine:0.;
    float e=catHS_round(ex,ey,j+r)+ero;
    float jmean=1.-(1.-2.*j/len)*(1.-2.*j/ch);
    float jm=mix(mix(1.-smoothstep(j-px*.5,j+px*.5,e),jmean*(1.+.9*cos(6.283*fy)),smoothstep(.5*j,2.*j,px)),jmean,smoothstep(.25,.5,px));
    float t=catH(vec2(b.z,row)); vec3 s=c*(.9+t*.2*uD+.1*(1.-uD));
    float face,dTop=(1.-fy)*ch-j,dBot=fy*ch-j;
    if(shape<.5){
      face=.92+(catN(q*3.+t*7.)-.5)*.1; s*=1.+(catN(q*60.)-.5)*.08*fine;
      s=mix(s,accent,smoothstep(.8,.9,catN(q*45.+t*3.))*.35*fine); s*=catHS_arris(dTop,dBot,.05,.14*uD);
    } else if(shape<1.5){
      vec2 d=vec2(lx/len,fy)*2.-1.; float draft=smoothstep(.05,.1+2.*px,e);
      float dome=(1.-max(pow(abs(d.x),4.),pow(abs(d.y),4.)))*.55+(catF(q*4.+t*9.)-.5)*.5*uD;
      face=mix(.75,.7+dome*.6,draft);
      float g=catN(q*70.+t*4.),g2=catN(q*53.+7.);
      s=mix(s,vec3(.14,.15,.15),smoothstep(.72,.82,g)*.6*fine); s=mix(s,accent*1.08,smoothstep(.74,.84,g2)*.5*fine);
      s*=1.+(dome-.3)*.18*uD*draft+d.y*.1*draft*uD; s*=1.+(1.-draft)*.08*uD;
      s*=catHS_arris(dTop,dBot,.04,.12*uD);
    } else {
      float bed=fy*ch+(catN(vec2(q.x*.8,row+t*9.))-.5)*.2;
      s=mix(s,mix(accent,vec3(.62,.4,.22),.5),smoothstep(.6,.95,sin(bed*(3.+t*3.)+t*20.))*.16*uD);
      s*=1.-(1.-smoothstep(.0,.03+px,abs(fract(bed*2.3+t)-.5)))*.06*fine;
      float tool=sin((lx+ey)*90.)*fine; s*=1.+tool*.02; s*=1.+(catN(q*vec2(9.,26.))-.5)*.1*fine;
      face=.85+tool*.04+(catN(q*2.)-.5)*.15; s*=catHS_arris(dTop,dBot,.1,.18*uD);
    }
    vec3 m=secondary*(1.+(catN(q*35.)-.5)*.16*fine)*(1.-(1.-smoothstep(.0,j*1.6,dBot+j))*.2*uD);
    c=mix(s,m,jm);
    h=mix(.02,face-(1.-smoothstep(j,j+r+.04,e))*.2,catHS_bev(e,j,r*.5,px));
    if(capOn>.5){
      // Hairpin parapet: rough coursed stone under a cap course at st.z metres.
      float pxm=px*catParams.x; vec4 cp=catHS_cap(q*catParams.x,point.y,st.z,normalize(vCatWorldNormal).y,pxm);
      float cj=catHS_aa(1.-smoothstep(.012,.012+pxm,cp.y),.04,pxm,.012);
      vec3 cap=accent*(.92+catH(vec2(cp.z,3.))*.12*uD)*(1.+(catN(q*catParams.x*12.)-.5)*.1*fine);
      cap*=1.+(1.-smoothstep(0.,.05,st.z-point.y))*.1*uD;
      c=mix(c*(1.-cp.w*.3),mix(cap,secondary,cj),cp.x); h=mix(h,mix(.05,1.,smoothstep(.012,.03+2.5*pxm,cp.y)),cp.x); jm=mix(jm,cj,cp.x);
    }
    ${W('jm')}
  }`,
  // Random stone, by st.w: 0 rubble in pale lime mortar (domed stones, flush pointing); 1 dry stone (flat
  // coursed slabs, no mortar, deep dark voids, lichen spots); 2 knapped flint (tightly packed irregular
  // nodules: glossy blue-black cores, grey/white cortex patches, narrow lime joints).
  // st.x stretches stones horizontally, st.y = joint/void half-width (cell units).
  rubble: `{ float uD=1.-smoothstep(.1,.45,px);
    float shape=st.w,fine=1.-smoothstep(.01,.06,px),j=st.y,jm,t,bev,dome,e; vec3 stone;
    if(shape>.5&&shape<1.5||shape>3.5){
      // Coursed slabs (dry stone, guard walls): random course heights, random lengths, ragged outlines.
      vec2 w=q+(vec2(catN(q*2.3),catN(q*2.3+5.))-.5)*.16;
      vec3 cy=catHS_course(w.y/.5,3.7,.7); float row=cy.z,hgt=cy.y*.5,ly2=cy.x*.5;
      vec3 cx=catHS_course(w.x/(1.1+catH(vec2(row,8.))*.9)+catH(vec2(row,2.)),row,.85);
      float len=cx.y*(1.1+catH(vec2(row,8.))*.9),lx=cx.x*(1.1+catH(vec2(row,8.))*.9);
      float ex=min(lx,len-lx),ey=min(ly2,hgt-ly2); e=catHS_round(ex,ey,.09)+(catN(q*7.)-.5)*.04*fine;
      t=mix(.5,catH(vec2(cx.z,row)),uD); dome=1.-pow(max(abs(lx/len*2.-1.),abs(ly2/hgt*2.-1.)),3.)*.8;
      float cpx=px; jm=mix(1.-smoothstep(j-cpx*.5,j+cpx*.5,e),.3*(1.+.8*cos(6.283*ly2/hgt)),smoothstep(.5*j,2.*j,cpx));
      jm=mix(jm,.3,smoothstep(.15,.3,cpx)); bev=catHS_bev(e,j,.06,cpx);
    } else {
      // Irregular stones: domain-warped cells with spatially varying size (no equal convex cells).
      vec2 p=q*vec2(1.,st.x);
      p+=(vec2(catN(p*.9),catN(p*.9+9.))-.5)*.5+(vec2(catN(p*2.7+4.),catN(p*2.7+1.))-.5)*.16;
      vec3 c3=catHS_cells(p,shape<.5?vec2(.95):shape<2.5?vec2(.8):vec2(.95,.7));
      float cpx=px*max(1.,st.x)*1.3; e=c3.y+(catN(q*6.)-.5)*.03*fine;
      jm=catHS_aa(1.-smoothstep(j-cpx*.5,j+cpx*.5,e),shape>2.5?.38:shape<2.5&&shape>1.5?.22:.3,cpx,j);
      t=mix(.5,c3.z,uD); bev=catHS_bev(e,j,.06,cpx); dome=1.-c3.x*c3.x*.9;
    }
    stone=mix(mix(secondary,base,.55+t*.45),accent,smoothstep(.75,1.,t)*.5)*(.94+catN(q*5.+t*9.)*.12);
    stone*=1.+(catN(q*30.+t*7.)-.5)*.14*fine; stone*=1.+(dome-.5)*.14*uD;
    if(shape<.5){
      vec3 m=mix(accent,vec3(.8,.77,.7),.4)*(1.+(catN(q*35.)-.5)*.15*fine);
      c=mix(stone,m,jm); h=mix(.35,.45+dome*.5,bev);
    } else if(shape<1.5){
      stone*=1.-(1.-smoothstep(j,j+.1,e))*.22*uD;
      c=mix(stone,secondary*.25,jm*(1.-.55*smoothstep(.03,.15,px))); h=mix(0.,.75+dome*.2+(catN(q*6.)-.5)*.15,bev);
      c=mix(c,accent*1.08,smoothstep(.88,.93,catN(q*13.+t*5.))*.3*fine*(1.-jm));
    } else if(shape<2.5){
      float pat=catN(q*2.2+t*9.);
      vec3 core=mix(base*.75,base*1.25,mix(.5,pat,uD))*(1.+sin(dome*12.+t*20.)*.05*fine);
      vec3 flint=mix(core,accent,smoothstep(.72,.86,catN(q*3.+t*5.))*.6*uD+(1.-smoothstep(.0,.06,e-j))*.4*uD);
      vec3 m=mix(secondary,vec3(.83,.8,.72),.3)*(1.+(catN(q*30.)-.5)*.18*fine);
      c=mix(flint,m,jm); h=mix(.25,.65+dome*.35,bev); rgh=mix(.45,1.,jm);
    } else if(shape<3.5){
      // Mountain stone: grey/brown field stone, wide lime joints smeared over the stone edges.
      stone*=mix(vec3(1.),vec3(1.08,1.,.9),step(.6,t)*uD);
      float smear=jm+(1.-smoothstep(j,j+.1,e+(catN(q*5.)-.5)*.12))*.55*uD;
      vec3 m=accent*(1.+(catN(q*30.)-.5)*.14*fine);
      c=mix(stone,m,clamp(smear,0.,1.)); h=mix(.4,.45+dome*.55,bev)-smear*.05;
    } else {
      // CCC guard wall (Going-to-the-Sun): flat red/green argillite slabs in grey mortar, cap course at st.z m.
      stone=mix(base,accent,step(.62,t))*(.86+t*.24*uD)*(1.+(catN(vec2(q.x*2.,q.y*14.)+t*5.)-.5)*.14*fine);
      c=mix(stone,secondary*1.6,jm); h=mix(.2,.7+dome*.3,bev);
      float pxm=px*catParams.x; vec4 cp=catHS_cap(q*catParams.x,point.y,st.z,normalize(vCatWorldNormal).y,pxm);
      float cj=catHS_aa(1.-smoothstep(.02,.02+pxm,cp.y),.06,pxm,.02);
      vec3 cap=mix(base,accent,step(.5,catH(vec2(cp.z,4.))))*1.08*(1.+(catN(q*catParams.x*6.)-.5)*.12*fine);
      c=mix(c*(1.-cp.w*.3),mix(cap,secondary*1.6,cj),cp.x); h=mix(h,mix(.1,1.,smoothstep(.02,.05+2.5*pxm,cp.y)),cp.x); jm=mix(jm,cj,cp.x);
    }
    ${W('jm')}
  }`,
  // Gabion: rounded/angular stones packed behind a square welded mesh (st.x = mesh pitch in stone sizes,
  // st.y = wire half-width); wire is proud, bright and casts a fine shadow; 1 m basket frames.
  gabion: `{ float uD=1.-smoothstep(.12,.6,px);
    vec3 s=catHS_cells(q,vec2(.85)); float fine=1.-smoothstep(.01,.06,px),t=mix(.5,s.z,uD);
    float gap=catHS_aa(1.-smoothstep(.04-px*.5,.1+px*.5,s.y),.25,px,.08);
    vec3 stone=mix(base,accent,t*.6)*(.85+t*.25)*(1.+(catN(q*20.+t*8.)-.5)*.12*fine);
    float dome=1.-s.x*s.x;
    c=mix(stone*(.78+dome*.3*uD+.15*(1.-uD)),secondary*.3,gap); h=mix(0.,.3+dome*.45,catHS_bev(s.y,.04,.08,px));
    vec2 g=q/st.x,gs=g+vec2(.04,-.04); float w=st.y/st.x;
    float wire=max(catStripe(g.x,w,px/st.x),catStripe(g.y,w,px/st.x));
    float sh=max(catStripe(gs.x,w*1.4,px/st.x),catStripe(gs.y,w*1.4,px/st.x))*(1.-wire);
    vec2 fm=q*catParams.x; float frame=max(catStripe(fm.x,.006,px*catParams.x),catStripe(fm.y,.006,px*catParams.x));
    wire=max(wire,frame); float wf=1.-smoothstep(.3*w,2.*w,px/st.x);
    c*=1.-sh*.4*wf; c=mix(c,vec3(.78,.8,.78),wire*wf+frame*(1.-wf)*.3); h=mix(h,1.,wire*wf); rgh=mix(rgh,.45,wire*wf);
    ${W('gap')}
  }`,
  // Riveted bridge steel (Pittsburgh 'Aztec gold' girders): staggered plates (st.x long) with lap shadows,
  // rivet rows along every edge, paint chipping to red primer and then rust around rivets and edges.
  'riveted-steel': `{ float uD=1.-smoothstep(.12,.6,px),fine=1.-smoothstep(.01,.06,px);
    float row=floor(q.y),xs=q.x/st.x+mod(row,2.)*.5; vec2 pf=vec2(fract(xs)*st.x,fract(q.y));
    float e=min(min(pf.x,st.x-pf.x),min(pf.y,1.-pf.y));
    float seam=catHS_aa(1.-smoothstep(.008,.008+px,e),.02,px,.008),lap=catHS_aa(smoothstep(.9,1.,pf.y),.05,px,.1);
    float rx=(fract(pf.x/.16)-.5)*.16,ry=(fract(pf.y/.16)-.5)*.16;
    float r=min(min(length(vec2(rx,pf.y-.08)),length(vec2(rx,pf.y-.92))),min(length(vec2(pf.x-.08,ry)),length(vec2(st.x-pf.x-.08,ry))));
    float rv=catHS_aa(1.-smoothstep(.03-px*.5,.03+px*.5,r),.06,px,.03);
    float wear=catEffects.x,k=catN(q*5.+row*3.)*.55+(1.-smoothstep(0.,.08,e))*.25+(1.-smoothstep(.02,.06,r))*.3+wear*.25+catN(q*17.)*.15;
    float primer=smoothstep(.7,.75,k)*fine,rust=smoothstep(.78,.83,k)*fine;
    c*=.95+catH(vec2(floor(xs),row))*.1*uD; c*=1.-lap*.3-seam*.35;
    c=mix(c,secondary,primer); c=mix(c,accent*(.9+catN(q*30.)*.2),rust);
    c*=1.+rv*(.14-step(0.,ry)*0.)*uD; rgh=mix(.6,1.,max(primer,rust));
    h=mix(.6-lap*.35,1.,rv)-seam*.4-primer*.08-rust*.05; float jm=max(seam,lap);
    ${W('jm')}
  }`,
  // Industrial sheet metal, by st.w: 0 mill corrugated siding (vertical sine ribs, horizontal laps every 3 m,
  // fastener rows, rust rising from the foot and along laps); 1 weathering steel (flat panels, mottled orange
  // to purple-brown patina, dark runs); 2 steel bar-grate deck (bearing bars, cross bars, dark openings).
  'sheet-metal': `{ float uD=1.-smoothstep(.12,.6,px),fine=1.-smoothstep(.01,.06,px),jm; vec2 wm=q*catParams.x; float pxm=px*catParams.x;
    if(st.w<.5){
      float sn=sin(q.x*6.283),cs=cos(q.x*6.283),cf=1.-smoothstep(.15,.5,px);
      float ly3=mod(point.y,3.),lapL=catHS_aa(1.-smoothstep(.0,.03+pxm,3.-ly3),.01,pxm,.03);
      vec2 sc=vec2((fract(q.x/4.)*4.-.25)*catParams.x,(fract(point.y/1.5)-.5)*1.5); float screw=(1.-smoothstep(.006,.006+pxm,length(sc)))*fine;
      c*=1.+cs*.14*cf; c*=1.+(catH(vec2(floor(q.x/12.),floor(point.y/3.)))-.5)*.1*uD;
      float rb=smoothstep(.45,.8,(1.-smoothstep(.0,.8+.6*catN(wm*1.3),point.y))+lapL*.6+catN(wm*vec2(.6,3.))*.35)*(.3+catEffects.x);
      c=mix(c,mix(vec3(.4,.2,.09),vec3(.58,.32,.13),catN(wm*7.)),clamp(rb,0.,1.)*.85);
      c*=1.-smoothstep(.55,.85,catN(vec2(wm.x*3.,wm.y*.25)))*.14; c=mix(c,vec3(.22),screw*.6); c*=1.-lapL*.35;
      h=mix(.5,.5+.5*sn,cf)*(1.-lapL*.4)+screw*.2; jm=(.5-.5*sn)*.5*cf+lapL; rgh=.65;
    } else if(st.w<1.5){
      vec2 pn=q/vec2(st.x,1.),pf=fract(pn); float e=min(min(pf.x,1.-pf.x)*st.x,min(pf.y,1.-pf.y));
      float seam=catHS_aa(1.-smoothstep(.004,.004+px,e),.01,px,.004);
      float pat=catF(wm*1.2)*.6+catN(wm*6.)*.4*fine;
      c=mix(mix(secondary,base,smoothstep(.3,.7,pat)),accent,smoothstep(.72,.9,pat)*.6);
      c*=1.-smoothstep(.55,.85,catN(vec2(wm.x*5.,wm.y*.3)))*.22;
      float pit=smoothstep(.82,.92,catN(wm*90.))*fine; c*=1.-pit*.25;
      c*=1.-seam*.4; h=.6-seam*.5-pit*.2; jm=seam; rgh=1.;
    } else {
      float bx=fract(q.x),by=fract(q.y/3.),bd=min(bx,1.-bx),cd=min(by,1.-by)*3.;
      float bar=catHS_aa(1.-smoothstep(st.y-px*.5,st.y+px*.5,bd),2.*st.y,px,st.y),under=.5+.5*catN(q*.4);
      float cross=catHS_aa(1.-smoothstep(.06-px*.5,.06+px*.5,cd),.04,px,.06);
      float metal=max(bar,cross);
      c=mix(secondary*(.8+.4*under),base*(.9+catN(wm*20.)*.2*fine)*(1.+cross*.06),metal);
      c=mix(c,vec3(.4,.22,.1),smoothstep(.7,.9,catN(wm*2.))*catEffects.x*.5*metal);
      h=metal*(.8+cross*.2); jm=1.-metal; rgh=mix(1.,.55,metal);
    }
    ${W('jm')}
  }`,
  // Cast-iron storefront panels: raised moulded frames, a petalled boss in each panel, deep panel seams;
  // dark green paint chipped to black iron, rust in the seams; baked light on the moulding tops.
  'cast-iron': `{ float uD=1.-smoothstep(.12,.6,px),fine=1.-smoothstep(.01,.06,px);
    vec2 pn=q/vec2(.7,1.),pf=fract(pn); vec2 dd=min(pf,1.-pf)*vec2(.7,1.); float e=min(dd.x,dd.y);
    float seam=catHS_aa(1.-smoothstep(.012-px*.5,.012+px*.5,e),.04,px,.012);
    float frame=smoothstep(.07-px,.075+px,e)*(1.-smoothstep(.125-px,.13+px,e));
    vec2 cc=(pf-.5)*vec2(.7,1.); float r=length(cc),a=atan(cc.y,cc.x),rr=.1+.03*cos(a*8.);
    float boss=catHS_aa(1.-smoothstep(rr-px,rr+px,r),.06,px,.03);
    float topL=(1.-smoothstep(0.,.02,abs(e-.13)))*step(.5,pf.y)*frame;
    c*=.95+catH(floor(pn))*.08*uD; c*=1.+frame*.1*uD+boss*.08*uD+topL*.1*uD-(1.-smoothstep(.0,.03,abs(e-.06)))*.12*uD;
    float chip=smoothstep(.8,.86,catN(q*9.)*.7+max(frame,boss)*.2+catEffects.x*.3)*fine;
    c=mix(c,secondary*(1.+(catN(q*40.)-.5)*.3),chip); c=mix(c,secondary*.55,seam*.85); c*=1.+boss*clamp(cc.y/rr,-1.,1.)*.22*uD;
    h=.45+frame*.4+boss*.5-seam*.45-(1.-smoothstep(.0,.025,abs(e-.06)))*.15; rgh=mix(.55,1.,max(chip,seam));
    ${W('seam')}
  }`,
  // ---- Overlays (alpha = coverage; 0 shows the base). Placement uses ly (height, m) and up; the base's height
  // catHBelow lets salts and grime gather in its joints. Finish: light/medium/heavy amount, fresh, old (faded),
  // damp (darker), dry (paler), frosted.
  // Soot streaks hanging from ledges every st.x metres (storey lines), densest right under each ledge.
  'ov-soot': `{ vec4 k=catHS_ovk(catFinish); vec2 m=q*catParams.x; float L=st.x,lev=floor(ly/L),below=L-mod(ly,L);
    float src=catN(vec2(m.x*2.2,lev*3.)),len=.5+2.*catN(vec2(m.x*1.1,7.+lev));
    float run=smoothstep(.35,.75,src)*(1.-smoothstep(len*.3,len,below))*(.75+(catN(vec2(m.x*9.,ly*.5))-.5)*.5);
    float under=(1.-smoothstep(0.,.3,below))*smoothstep(0.,.03,below);
    alpha=clamp(max(run,under*.85)*(1.+(1.-catHBelow)*.4),0.,1.)*(1.-smoothstep(.6,.85,up))*k.x;
    c=catHS_ovTone(mix(base,secondary,catN(m*3.)),k); h=.5; rgh=1.;
  }`,
  // Rust bleed: fixings on a st.x m grid (rows every 1.6 m) with tapering rust runs of varied length below.
  'ov-rust': `{ vec4 k=catHS_ovk(catFinish); vec2 m=q*catParams.x; float L=st.x,pxm=px*catParams.x;
    vec2 g=vec2(m.x/L,ly/1.6),cid=floor(g),f=(fract(g)-vec2(.5,.85))*vec2(L,1.6);
    float present=step(.3,catH(cid)),len=.3+1.*catH(cid+3.),below=-f.y,w=.015+.05*smoothstep(0.,len,below);
    float wx=abs(f.x+(catN(vec2(ly*3.,cid.x))-.5)*.03);
    float run=(1.-smoothstep(w,w+.02+pxm,wx))*step(0.,below)*(1.-smoothstep(len*.5,len,below));
    float fix=1.-smoothstep(.018,.022+pxm,length(f));
    alpha=max(run*(.85-.3*smoothstep(0.,len,below)),fix)*present*k.x;
    c=catHS_ovTone(mix(mix(accent,base,smoothstep(0.,len,below)),secondary*.6,fix),k); h=.5+fix*.5;
  }`,
  // Efflorescence: white salt bloom rising from the foot with a ragged tide line, and in the base's joints.
  'ov-efflor': `{ vec4 k=catHS_ovk(catFinish); vec2 m=q*catParams.x; float pxm=px*catParams.x;
    float n=catN(m*2.5),n2=catN(m*9.),top=.5+.7*n;
    float band=1.-smoothstep(top-.3,top,ly),joint=(1.-smoothstep(.2,.45,catHBelow))*(1.-smoothstep(.8,1.8,ly)),bloom=smoothstep(.45,.75,catF(m*3.)*.7+n*.3);
    alpha=clamp(band*(.35+bloom*.6)+joint*bloom*.55,0.,1.);
    alpha=max(alpha,(1.-smoothstep(0.,.025+pxm,abs(ly-top)))*.55*step(.3,n));
    alpha*=(1.-smoothstep(.6,.85,up))*k.x*(1.-k.z*.3);
    c=catHS_ovTone(mix(base,accent,n2),k); h=.5+alpha*.15;
  }`,
  // Graffiti tags: stylised outlined loops and strokes (no words) between 0.3 and 2.1 m.
  'ov-graffiti': `{ vec4 k=catHS_ovk(catFinish); vec4 tg=catHS_tag(q*catParams.x,ly,px*catParams.x);
    alpha=tg.a*(1.-smoothstep(.6,.85,up))*k.x*(1.-k.y*.35*catN(q*catParams.x*4.)); c=catHS_ovTone(tg.rgb,k); h=.5; rgh=mix(1.,.7,alpha);
  }`,
  // Fly-posting: A2 posters pasted in a band 0.9–2.3 m, overlapping, with title bars, text lines and a
  // picture block; torn and faded when old, curling at the corners.
  'ov-posters': `{ vec4 k=catHS_ovk(catFinish); vec2 m=q*catParams.x; float pxm=px*catParams.x,fine=1.-smoothstep(.003,.012,pxm);
    vec2 g=vec2(m.x/.5,(ly-.9)/.72),cid=floor(g),f=fract(g)*vec2(.5,.72);
    vec2 jo=(vec2(catH(cid),catH(cid+5.))-.5)*vec2(.06,.08),sz=vec2(.42,.6)*(.85+.15*catH(cid+9.)),pp=f-vec2(.04,.05)-jo,u2=pp/sz;
    float inside=catHS_box(pp,vec2(0.),sz,pxm),present=step(.2,catH(cid+2.))*step(0.,g.y)*step(g.y,2.);
    float torn=smoothstep(.66,.72,catN(m*6.+cid*3.)+k.y*.3+(1.-smoothstep(0.,.08,min(min(u2.x,1.-u2.x),min(u2.y,1.-u2.y))))*.2);
    float hue=catH(cid+4.); vec3 bg=hue<.3?vec3(.9,.86,.74):hue<.55?vec3(.92,.78,.3):hue<.8?accent:vec3(.3,.45,.65);
    float title=catHS_box(u2,vec2(.08,.78),vec2(.92,.93),pxm*2.),lines=catHS_box(u2,vec2(.08,.1),vec2(.92,.45),pxm*2.)*step(.5,fract(u2.y*14.))*fine;
    float pic=catHS_box(u2,vec2(.15,.5),vec2(.85,.74),pxm*2.);
    c=mix(bg,secondary,max(title,lines*.7)); c=mix(c,mix(bg,base,.6),pic*.85); c*=1.-(1.-smoothstep(0.,.03,min(min(u2.x,1.-u2.x),min(u2.y,1.-u2.y))))*.15;
    alpha=inside*present*(1.-torn)*(1.-smoothstep(.6,.85,up))*k.x; c=catHS_ovTone(c,k); h=.5+alpha*.35; rgh=mix(1.,.85,alpha);
  }`,
  // Water-stain runs: broad, tide-edged brown-grey runs from ledges every st.x metres.
  'ov-water': `{ vec4 k=catHS_ovk(catFinish); vec2 m=q*catParams.x; float L=st.x,lev=floor(ly/L),below=L-mod(ly,L);
    float src=catN(vec2(m.x*1.4,lev*5.)),len=.8+2.2*catN(vec2(m.x*.7,3.+lev)),run=smoothstep(.42,.6,src)*(1.-smoothstep(len*.55,len,below))*smoothstep(0.,.1,below);
    float edge=run*(1.-smoothstep(.0,.06,src-.45));
    alpha=clamp(run*.55+edge*.35,0.,1.)*(1.-smoothstep(.6,.85,up))*k.x*(1.+k.z*.4);
    c=catHS_ovTone(mix(base,secondary,edge),k); h=.5; rgh=mix(1.,.8,run*max(k.z,0.));
  }`,
  // Clay tiles, by st.w: 0 canal/barrel (alternating convex caps and concave pans with baked roll light,
  // tapered tiles, slightly irregular hand-laid courses, terracotta mix); 1 interlocking Marseille (flat
  // machine tiles with twin ribs and a side roll, aligned courses, even colour). st.x = exposed course
  // length in tile widths. y runs up the slope.
  'roof-tile': `{ float uD=1.-smoothstep(.12,.6,px);
    float col=floor(q.x),tx=fract(q.x),cap=mod(col,2.),fine=1.-smoothstep(.01,.06,px);
    float yy=q.y/st.x+(st.w<.5?catH(vec2(col,4.))*.15:0.),row=floor(yy),fy=fract(yy);
    float t=catH(vec2(col,row)),prof,jm;
    float shade=catHS_aa(smoothstep(.8,1.,fy),.1,px/st.x,.15);
    if(st.w<.5){
      float taper=mix(1.,.86,fy),x=(tx-.5)/taper+.5,sx=sin(3.14159*clamp(x,0.,1.)),cx=cos(3.14159*clamp(x,0.,1.));
      prof=mix(.35-.25*sx,.55+.45*sx,cap);
      jm=(1.-cap)*sx*.5+shade;
      float roll=mix(.72+.36*sx-.14*cx,.66+.18*(1.-sx)+.1*cx,1.-cap);
      c*=mix(roll,.86,smoothstep(.1,.45,px))*(.86+t*.28*uD+.14*(1.-uD));
      c=mix(c,accent,step(.82,t)*.3*uD); c=mix(c,secondary,step(t,.1)*.4*uD);
    } else {
      float rib=max(catStripe(tx-.28,.035,px),catStripe(tx-.42,.035,px))*fine,roll=smoothstep(.82,.9,tx)*(1.-smoothstep(.97,1.,tx));
      float edge=1.-smoothstep(.0,.05,tx);
      prof=.5+rib*.25+roll*.4-edge*.3;
      jm=shade+edge*.5;
      c*=.92+t*.1*uD; c*=1.-edge*.28*uD+rib*.08-(1.-smoothstep(.0,.06,abs(tx-.8)))*.12*uD+roll*.1*uD;
    }
    float butt=1.-smoothstep(.0,.06,fy); prof+=butt*.25*uD;
    c*=(1.-shade*.38)*(1.+butt*.1*uD); c*=1.+(catN(q*vec2(9.,5.)+t*7.)-.5)*.1*fine;
    h=prof*(1.-shade*.5)*smoothstep(0.,.04+2.5*px/st.x,fy);
    ${W('jm', '0.')}
  }`,
  // Shingles and slabs, by st.w: 0 slate (thin rectangular, half-lap stagger, cool tonal mix, the odd
  // clipped corner, faint cleavage); 1 stone lauze (thick irregular slabs, wavy butts, random widths, small
  // lichen rosettes); 2 cedar (narrow random widths, vertical grain, keyways, splits, honey-to-brown mix);
  // 3 asphalt three-tab (strips of 3 tabs with slots, granule speckle, per-strip blend).
  // st.x = unit width in course heights. y runs up the slope.
  'roof-shingle': `{ float uD=1.-smoothstep(.12,.6,px);
    float shape=st.w,fine=1.-smoothstep(.01,.06,px),jm,face=.6,t,lx,len;
    float wav=shape>.5&&shape<1.5?(catN(vec2(q.x*1.2,floor(q.y)*3.))-.5)*.25:0.;
    float yy=q.y+wav,fy=fract(yy),row=floor(yy);
    if(shape<.5||shape>2.5){
      float L=shape>2.5?st.x/3.:st.x,x=q.x/L+(shape>2.5?mod(row,2.)*.5+catH(vec2(row,2.))*.3:mod(row,2.)*.5);
      lx=fract(x)*L;len=L;t=catH(vec2(floor(x),row));
    } else {
      vec3 b=catHS_course(q.x/st.x,row,shape<1.5?.75:.85); lx=b.x*st.x;len=b.y*st.x;t=catH(vec2(b.z,row));
    }
    float gw=shape<.5?.012:shape<1.5?.025:shape<2.5?.02:.025,gd=min(lx,len-lx);
    float slotH=shape>2.5?1.-smoothstep(.6,.64,fy):1.;
    float gap=catHS_aa((1.-smoothstep(gw-px*.5,gw+px*.5,gd))*slotH,2.*gw/len,px,gw);
    float shade=catHS_aa(smoothstep(shape<.5?.84:.78,1.,fy),.1,px,.16);
    float butt=1.-smoothstep(.0,shape>.5&&shape<1.5?.12:.05,fy);
    vec3 u=c; float tv=uD;
    if(shape<.5){
      u*=.92+t*.16*tv; u=mix(u,mix(secondary,accent,step(.5,t)),step(.88,catH(vec2(t,7.)))*.3*tv);
      float corner=step(gd+fy,.07*step(.75,catH(vec2(t,3.))))*fine;
      u=mix(u,secondary*.6,corner); face=.75-fy*.2-corner*.4; rgh=.75; u*=1.+(catN(vec2(q.x*3.,q.y*40.))-.5)*.05*fine;
    } else if(shape<1.5){
      u*=.84+t*.26*tv; u*=1.+(catF(q*3.+t*9.)-.5)*.16*tv;
      u=mix(u,mix(accent,vec3(.86,.83,.6),.4),smoothstep(.86,.9,catN(q*14.+t*4.))*.3*fine);
      face=.95-fy*.45+(catN(q*4.)-.5)*.2;
    } else if(shape<2.5){
      u*=.82+t*.3*tv; u*=1.+(catN(vec2(q.x*48.,q.y*2.)+t*9.)-.5)*.2*fine;
      float split=(1.-smoothstep(.006,.012+px,abs(lx/len-.3-.4*catH(vec2(t,5.)))))*step(.6,catH(vec2(t,8.)))*step(.2,fy)*fine;
      u*=1.-split*.5; face=.8-fy*.3-split*.3; gap=max(gap,split*.6);
    } else {
      u*=.93+catH(vec2(row,6.))*.14*tv;
      float gr=catN(q*48.); u=mix(u,mix(secondary,accent,step(.5,catH(floor(q*48.)))),smoothstep(.62,.8,gr)*.5*fine);
      face=.7-fy*.1;
    }
    u*=(1.-shade*.4)*(1.+butt*.1*tv);
    c=mix(u,secondary*.38,gap); jm=max(gap,shade);
    h=mix(0.,face+butt*.25,catHS_bev(gd,gw,.02,px))*(1.-shade*.5)*smoothstep(0.,.03+2.5*px,fy);
    ${W('jm', '0.')}
  }`,
  // Sheet metal, by st.w: 0 standing seam (tall narrow seams with baked side light, pencil ribs,
  // oil-canning, per-pan tone); 1 corrugated (sine profile with baked side light, side and end laps,
  // screw rows on crests, rust runs below screws and along laps when aged).
  'roof-seam': `{ float uD=1.-smoothstep(.12,.6,px);
    float fine=1.-smoothstep(.01,.06,px),jm;
    if(st.w<.5||st.w>1.5){
      float f=fract(q.x),d=min(f,1.-f),pan=floor(q.x);
      float seam=catHS_aa(1.-smoothstep(st.y-px*.5,st.y+px*.5,d),2.*st.y,px,st.y);
      float pencil=max(catStripe(f-.333,.008,px),catStripe(f-.667,.008,px))*fine;
      float oil=(catN(vec2(q.x*3.,q.y*.8)+pan*5.)-.5)*.25;
      c*=.95+catH(vec2(pan,1.))*.08*uD; c*=1.+oil*.12*uD;
      c*=1.+(1.-smoothstep(.0,.05,f-st.y))*.12*uD-(1.-smoothstep(.0,.08,1.-f-st.y))*.14*uD+pencil*.06;
      h=mix(.45+oil+pencil*.12,1.,catHS_bev(-d,-st.y,.004,px)); jm=(1.-smoothstep(st.y,st.y+.08,d))*(1.-seam)*.5;
      c=mix(c,c*1.1,seam); rgh=.55;
      if(st.w>1.5){
        // Zinc: dull blue-grey patina, plus snow-stop rails every 1.6 m with brackets on each seam.
        c*=1.+(catN(q*vec2(1.5,.4))-.5)*.08*uD; rgh=.7;
        float pxm=px*catParams.x,ry=(fract(q.y*catParams.x/1.6)-.5)*1.6;
        float rail=catHS_aa(1.-smoothstep(.014-pxm*.5,.014+pxm*.5,abs(ry)),.02,pxm,.014);
        float brk=(1.-smoothstep(.03,.03+pxm,abs(ry+.02)))*(1.-smoothstep(.03,.03+px,d))*fine;
        float sh=(1.-smoothstep(.0,.05,-ry-.014))*step(ry,-.014)*uD;
        c=mix(c*(1.-sh*.25),accent*.8,max(rail,brk)); h=mix(h,1.,max(rail,brk)); jm=max(jm,sh);
      }
    } else {
      float s=sin(q.x*6.283),cs=cos(q.x*6.283),sheet=floor(q.x/9.),lap=floor(q.y*catParams.x/2.4);
      float cf=1.-smoothstep(.15,.5,px);
      c*=1.+cs*.13*cf; c*=1.+(catH(vec2(sheet,lap))-.5)*.08*uD;
      float sly=fract(q.y*catParams.x/2.4),endLap=catHS_aa(smoothstep(.97,1.,sly),.03,px*catParams.x/2.4,.02);
      vec2 sc=vec2(fract(q.x/3.)*3.-.25,fract(q.y/10.)-.5); float screw=catEllipse(sc*vec2(1.,10.),vec2(.1),px)*fine;
      float rust=(1.-smoothstep(.04,.12+px,abs(sc.x)))*step(sc.y,0.)*smoothstep(-.3,0.,sc.y)*smoothstep(.3,.7,catEffects.x)*uD;
      c=mix(c,vec3(.45,.24,.11),max(rust*.55,smoothstep(.75,.9,catN(q*vec2(.5,.08)))*catEffects.x*.4));
      c=mix(c,vec3(.25),screw*.6); c*=1.-endLap*.35;
      h=mix(.5,.5+.5*s,cf)*(1.-endLap*.4)+screw*.2; jm=(.5-.5*s)*.5*cf+endLap; rgh=.6;
    }
    ${W('jm', '0.')}
  }`,
});
