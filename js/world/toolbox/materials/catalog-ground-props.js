// Ground, prop and vehicle kernels for the texture catalog (see catalog-patterns.js for the shared contract).
// Every kernel runs in its own { } scope and writes only c, alpha, h, relief and rgh.
//   h: 0 deepest gap … .5 flat … 1 proud crown. cav (local): 0 open/proud … 1 sheltered gap, drives finishes.
// Ground kernels are the cheapest (they cover most of the screen): at most one 3×3 cell search plus a few
// value-noise taps. Detail fades to a matched average colour with px, and large (metre-scale) macro noise
// breaks repetition at 5–30 m, where the per-stone detail is already gone.
export const GP_GLSL = /* glsl */`
  // One 3×3 cell search. x = distance to the nearest feature point, y = d2−d1 (≈ distance to the cell
  // border ×2), z/w = two ids of the nearest cell. rel = offset from the feature point to this pixel.
  vec4 catGP_vor(vec2 p,float jit,out vec2 rel){
    vec2 cell=floor(p),f=fract(p); float d1=9.,d2=9.,id=0.; rel=vec2(0.);
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
      vec2 b=vec2(float(i),float(j)),k=cell+b; vec2 r=f-b-.5-(vec2(catH(k),catH(k+17.3))-.5)*jit; float d=dot(r,r);
      if(d<d1){d2=d1;d1=d;id=catH(k+31.7);rel=r;}else d2=min(d2,d);
    }
    d1=sqrt(d1); return vec4(d1,sqrt(d2)-d1,id,fract(id*57.31+.17));
  }
  // 1 while a feature of 'size' pattern units spans a few pixels, 0 once it is sub-pixel.
  float catGP_fade(float px,float size){ return 1.-smoothstep(.22,.8,px/size); }
  mat2 catGP_rot(float a){ float s=sin(a),k=cos(a); return mat2(k,-s,s,k); }
  // Physically placed ground finishes. cav 0 proud … 1 gap; mac = metre-scale macro noise (low = hollow).
  void catGP_ground(inout vec3 c,inout float h,inout float rgh,float cav,float mac,vec2 m){
    float up=clamp(normalize(vCatWorldNormal).y,0.,1.);
    float wr=catEffects.x,dp=catEffects.y,ds=catEffects.z,fr=catEffects.w;
    c*=.9+.2*catN(m*1.3+11.);                                      // 0.5–1 m patchiness between stones and macro
    float big=catN(m*.03+7.)*.55+catN(m*.09+3.)*.45;                  // 10–35 m tone drift: no flat ground at 15–60 m
    c*=.8+.4*big; c=mix(c,c*vec3(1.04,1.,.94),smoothstep(.55,.8,catN(m*.05+1.))*.6); // warm/cool weathering zones
    h=.5+(h-.5)*clamp(2.2-catDensity*1.2,.55,1.45);             // compacted flattens, loose deepens
    float top=smoothstep(.6,.9,h);
    c=mix(c,c*1.1+.012,top*wr*.55); rgh*=1.-top*wr*.3;           // worn/polished crowns
    c*=1.-dp*(.12+cav*.3); rgh*=1.-dp*.5;                          // damp: fines in the gaps soak first
    float pud=smoothstep(.3,.27,mac+cav*.05)*step(.5,dp)*up;      // puddles only in macro hollows
    c=mix(c,c*.35+vec3(.05,.07,.09),pud); rgh=mix(rgh,.05,pud); h=mix(h,.45,pud);
    c=mix(c,mix(catAccent,vec3(.6,.55,.45),.5),ds*cav*.55);        // dust packs into crevices
    float fm=fr*up*(.3+.7*smoothstep(.4,.8,h))*(.75+.25*catN(m*31.)); // hoar frost: thin film, thick on proud tops
    c=mix(c,vec3(.8,.86,.9),min(fm,1.)*.75); rgh=mix(rgh,1.,fm*.5);
    if(catTreatment>1.5&&catTreatment<2.5){                        // moss: gaps and shady macro patches
      float mo=smoothstep(.5,.72,(1.-mac)*.55+catN(m*2.3)*.45)*(.1+.9*cav)+smoothstep(.75,.95,cav)*.35;
      c=mix(c,vec3(.1,.15,.055)*(.8+.5*catN(m*9.)),min(mo,1.)*.8); h=mix(h,.55,mo*.6);
    }
  }
  // Vehicle/prop finishes placed by geometry: local y for road grime, world-up faces for dust/frost/beads,
  // vertical faces for streaks, surface curvature (fwidth of the normal) for edge rust and wear.
  void catGP_vehicle(inout vec3 c,inout float h,inout float rgh,float cav,vec2 m,float pm){
    // m: metres (seeded), pm: metres per pixel. All finish features are sized in metres, not pattern units.
    vec3 wn=normalize(vCatWorldNormal); float up=clamp(wn.y,0.,1.),side=1.-abs(wn.y);
    float wr=catEffects.x,dp=catEffects.y,ds=catEffects.z,fr=catEffects.w,tr=catTreatment;
    float curv=length(fwidth(normalize(vCatNormal)))/max(length(fwidth(vCatLocal)),1e-5);
    float edge=smoothstep(4.,16.,curv);
    float low=1.-smoothstep(-.35,.35,vCatLocal.y+wn.y*.2);       // sills/arches: below local y≈.3 m
    float n=catN(m*9.);
    // general wear/ageing: dulled, slightly chalky on exposed faces and edges, dirt held in recesses
    float wx=wr*(.35+.45*edge+.3*up)*(.6+.4*n); c=mix(c,c*.8+vec3(.035),min(wx,1.)*.5); rgh=mix(rgh,1.,wx*.3);
    c=mix(c,c*.6,cav*wr*.5);
    if(tr>3.5&&tr<5.5){                                            // scratches: fine bright lines, clustered
      float sl=catStripe(m.x*14.+catN(m*3.)*.6,.02,pm*14.)*smoothstep(.55,.8,catN(m*2.3+5.))*catGP_fade(pm,.004);
      c=mix(c,mix(c,vec3(.75),.45),sl);
    }
    c*=1.-dp*(.12+cav*.15);                                         // damp darkens, recesses first
    if(tr>4.5&&tr<5.5){                                            // road-worn: spray grime low, streaked
      float spray=low*(.45+.55*catN(vec2(m.x*6.,m.y*50.)));
      c=mix(c,vec3(.13,.11,.085),spray*.75); rgh=mix(rgh,1.,spray*.6);
      float chip=step(.985,catH(floor(m*90.)))*low*catGP_fade(pm,.011);
      c=mix(c,vec3(.6,.6,.58),chip*.8); c=mix(c,c*.8,edge*.5);
    }
    if(ds>.3){                                                     // dust on upward faces, thinner on sides
      float settle=ds*(.18+.82*smoothstep(.15,.75,up))*(.7+.3*n);
      c=mix(c,mix(catAccent,vec3(.62,.57,.48),.6),min(settle,.85)); rgh=mix(rgh,1.,settle);
    }
    if(dp>.5){                                                     // rain: beads up top, runs on the sides
      vec2 bq=m*vec2(45.,mix(45.,18.,side)); vec2 cell=floor(bq);
      vec2 fp=fract(bq)-.5-(vec2(catH(cell),catH(cell+7.1))-.5)*.4; float rr=.08+.17*catH(cell+3.3);
      float drop=(1.-smoothstep(rr-.08,rr,length(fp*vec2(1.,mix(1.,.55,side)))))*step(.3,catH(cell+5.9));
      float run=side*(1.-smoothstep(.02,.06,abs(fp.x)))*step(fp.y,0.)*step(.55,catH(cell+2.2));
      float wet=max(drop,run*.7)*catGP_fade(pm,.008);
      c*=1.-wet*.25; rgh=mix(rgh,.04,wet); h=mix(h,.5+.5*sqrt(max(0.,1.-length(fp)/rr)),drop*catGP_fade(pm,.008));
    }
    if(tr>7.5&&tr<8.5){                                            // oxidized: rust from edges, pits, runs
      float rs=smoothstep(.55,.8,edge*.6+cav*.5+catN(m*35.)*.45+wr*.2-.15);
      float runs=side*smoothstep(.6,.85,catN(vec2(m.x*40.,m.y*3.)))*.5;
      vec3 rc=mix(vec3(.3,.11,.035),vec3(.5,.23,.08),catN(m*80.));
      c=mix(c,rc,max(rs,runs)*.85); rgh=mix(rgh,1.,rs); h=mix(h,.35+.3*catN(m*120.),rs);
    }
    if(tr>8.5&&tr<9.5){                                            // muddy: packed in grooves, splashed low
      float mud=max(cav*.95,low*.8*smoothstep(.35,.6,catN(m*20.)));
      c=mix(c,vec3(.16,.11,.065),mud); rgh=mix(rgh,.45,mud); h=mix(h,.42,mud*cav);
    }
    if(tr>9.5&&tr<10.5){                                           // chalked rubber: grey bloom on the open faces
      c=mix(c,vec3(.33,.33,.31),(1.-cav)*(.35+.4*n)); rgh=1.;
    }
    if(fr>.05){                                                    // frost: rime on up faces and edges
      float rime=fr*smoothstep(.1,.6,up+edge*.5)*(.55+.45*catN(m*70.));
      c=mix(c,vec3(.78,.84,.88),rime); rgh=mix(rgh,1.,rime);
    }
  }
  // ── wave 2 helpers ──
  float catGP_sd(vec2 p,vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.))+min(max(d.x,d.y),0.); }
  float catGP_seg(vec2 p,vec2 a,vec2 b){ vec2 pa=p-a,ba=b-a; return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.)); }
  float catGP_cov(float d,float pm){ return 1.-smoothstep(-pm*1.25,pm*1.25,d); }   // coverage from a signed distance (m)
  // pseudo caustics: two warped ridge fields, thin bright network 0…1 (m in metres)
  float catGP_caustic(vec2 m){
    float a=1.-abs(catN(m*1.6+catN(m*.7)*1.4)*2.-1.),b=1.-abs(catN(m*2.3+vec2(4.1,1.7)+catN(m*.9+3.)*1.2)*2.-1.);
    return pow(max(a,b),6.);
  }
  // Painted bicycle (side view). s.x along the bike, s.y up; metres; rider>.5 adds the rider. Signed distance.
  float catGP_bike(vec2 s,float rider){
    if(catGP_sd(s-vec2(0.,.45),vec2(1.,.8))>.1)return 1.;
    vec2 rh=vec2(-.55,0.),fh=vec2(.55,0.),bb=vec2(0.),se=vec2(-.15,.42),hd=vec2(.38,.42);
    float d=min(abs(length(s-rh)-.32)-.05,abs(length(s-fh)-.32)-.05);
    d=min(d,catGP_seg(s,rh,bb)-.045); d=min(d,catGP_seg(s,bb,se)-.045); d=min(d,catGP_seg(s,se,rh)-.04);
    d=min(d,catGP_seg(s,bb,hd)-.045); d=min(d,catGP_seg(s,se,hd)-.045); d=min(d,catGP_seg(s,hd,fh)-.04);
    d=min(d,catGP_seg(s,vec2(-.28,.5),vec2(-.04,.5))-.05); d=min(d,catGP_seg(s,hd,vec2(.3,.56))-.045);
    if(rider>.5){ d=min(d,length(s-vec2(.06,1.08))-.14); d=min(d,catGP_seg(s,se+vec2(0.,.08),vec2(.02,.88))-.08);
      d=min(d,catGP_seg(s,vec2(.04,.84),vec2(.34,.54))-.05); d=min(d,catGP_seg(s,se+vec2(0.,.08),vec2(.14,.22))-.06); }
    return d;
  }
  // Road-paint finishes, by finish index (0 fresh,1 worn,2 faded,3 dusty,4 rain-dark,5 tyre-marked,6 patched,7 frosted).
  // Works inside overlays: uses only its arguments. mm metres, pm metres/pixel, road = standalone asphalt colour.
  void catGP_mark(inout vec3 pc,inout float cov,inout float h,vec2 mm,float pm,float fin,vec3 road){
    // Each finish changes the paint AND lays a thin surface film over the road around it, so it is visible
    // in any frame (overlay alpha = paint coverage max film).
    float f2=catGP_fade(pm,.03),n1=catN(mm*1.7),n2=mix(.5,catN(mm*11.),f2);
    float tr=smoothstep(.5,.8,catN(vec2(mm.x*1.4,mm.y*.04)+3.));                 // wheel paths run along travel (+y)
    vec3 fc=road; float fa=0.,ph=1.;
    if(fin>.5&&fin<1.5){ cov*=smoothstep(.3,.5,n1*.45+n2*.55-tr*.35+.12); fc=road*1.3+.03; fa=.1+.3*tr; }      // worn: polished wheel paths
    if(fin>1.5&&fin<2.5){ pc=mix(pc,road*1.4+.06,.5); cov*=.8*smoothstep(.15,.4,n1*.5+n2*.5+.05); fc=road*1.45+.06; fa=.2+.1*n1; } // faded: sun-bleached
    if(fin>2.5&&fin<3.5){ pc=mix(pc,vec3(.5,.46,.39),.3+.3*n1); fc=vec3(.5,.46,.39); fa=.2+.3*n1*n2; }          // dusty film
    if(fin>3.5&&fin<4.5){ pc*=.72; fc=road*.5; fa=.45+.15*n1; }                                               // rain-dark wet film
    if(fin>4.5&&fin<5.5){ float t=smoothstep(.55,.85,catN(vec2(mm.x*2.2,mm.y*.035)))*(.6+.4*mix(.5,catN(vec2(mm.x*30.,mm.y*.5)),f2));
      fc=vec3(.045,.045,.05); fa=max(t*.75,.1+.08*n1); pc=mix(pc,fc,t*.6); }
    if(fin>5.5&&fin<6.5){ vec2 g=mm/vec2(4.,6.),cl=floor(g); vec2 pp=(fract(g)-vec2(.45,.35))*vec2(4.,6.);
      float on=catGP_cov(catGP_sd(pp,vec2(.9+catH(cl)*.7,1.2+catH(cl+3.)*1.2)),pm)*step(.4,catH(cl+.7));
      float seal=catGP_cov(abs(catN(mm*.9+vec2(4.,2.))-.5)/.6-.035,pm);                                     // sealed cracks
      pc=mix(pc,vec3(.035,.038,.042)*(.9+.2*n2),on); fc=vec3(.03,.032,.035); fa=max(on,seal); ph=1.-on; }
    if(fin>6.5){ fc=vec3(.8,.85,.9); fa=.1+.22*smoothstep(.35,.75,catN(mm*7.+5.)*.6+catN(mm*1.3)*.4); pc=mix(pc,fc,.3+.3*n2); }
    float paint=smoothstep(0.,.3,cov)*ph; pc=mix(fc,pc,paint); h=mix(h,.68,cov*ph); cov=max(cov*ph,fa);
  }
  // Finishes for wet surfaces without a water column (swash, wrack, rock-pool rock), by water finish index.
  void catGP_wetfx(inout vec3 c,inout float rgh,vec2 m,float fin){
    float n=catN(m*.8);
    if(fin>.5&&fin<1.5){ c=mix(c,vec3(.25,.22,.15),.2+.1*n); }                     // murky: silty, muddy film
    if(fin>1.5&&fin<2.5){ c=mix(c,vec3(.55,.68,.7),.18); }                         // glacial: cold milky silt film
    if(fin>2.5&&fin<3.5){ c=mix(c,c*vec3(.75,.55,.35),.45); }                     // tannin: tea-stained
    if(fin>3.5&&fin<4.5){ c*=.72; rgh=mix(rgh,.08,.7); }                           // shallow: thin water sheet
    if(fin>4.5&&fin<5.5){ c=mix(c*.85,vec3(.55,.62,.66),.12); rgh=.05; }           // still: mirror-glazed
    if(fin>5.5&&fin<6.5){ c=c*1.08+.03*n; rgh=mix(rgh,1.,.5); }                   // windy: drier, wind-blown
    if(fin>6.5){ c=mix(c,vec3(.8,.86,.9),.45+.2*n); rgh=1.; }                      // frosted
  }
  // Rock finishes by finish index (0 dry,1 damp,2 wet,3 lichen,4 mossy,5 frosted,6 snow-dusted,7 sun-bleached).
  void catGP_rock(inout vec3 c,inout float h,inout float rgh,float cav,vec2 m,float fin,float up){
    float side=1.-abs(up),upw=clamp(up,0.,1.);
    if(fin>.5&&fin<2.5){ float w=fin<1.5?.55:1.; c*=1.-w*(.16+.24*cav); rgh*=1.-w*.5;
      if(fin>1.5){ float s=smoothstep(.45,.75,catN(vec2(m.x*3.,m.y*.2)))*side; c*=1.-.25*s; rgh=mix(rgh,.12,s*.8+.3); } }
    if(fin>2.5&&fin<3.5){ vec2 g=m*7.,cl=floor(g); float r=.22+.25*catH(cl),k=catH(cl+4.);
      float ros=(1.-smoothstep(r-.06,r,length(fract(g)-.5-(vec2(catH(cl+1.3),catH(cl+2.7))-.5)*(.9-2.*r))*(1.+.25*sin(atan(fract(g).y-.5,fract(g).x-.5)*5.+k*9.))))*step(.45,k)*(1.-cav)*smoothstep(.3,.6,catN(m*.7)+upw*.3);
      vec3 lc=k<.62?vec3(.55,.6,.47):k<.88?vec3(.62,.6,.53):k<.95?vec3(.62,.42,.18):vec3(.1,.1,.09);
      float lf=catGP_fade(length(fwidth(m)),.12),zone=(1.-cav)*smoothstep(.3,.6,catN(m*.7)+upw*.3);
      c=mix(c,lc*(.85+.3*catN(g*1.7)),ros*.85*lf); c=mix(c,vec3(.58,.6,.5),zone*.3*(1.-lf)); h=mix(h,.62,ros*lf); }
    if(fin>3.5&&fin<4.5){ float mo=smoothstep(.5,.75,upw*.55+cav*.55+catN(m*1.8)*.45-.15);
      c=mix(c,vec3(.12,.18,.06)*(.8+.5*catN(m*14.)),mo*.85); h=mix(h,.6,mo*.6); rgh=mix(rgh,1.,mo); }
    if(fin>4.5&&fin<5.5){ float fr=(.3+.6*(1.-cav))*(.7+.3*catN(m*30.))*(.4+.6*upw+.3*side); c=mix(c,vec3(.8,.86,.9),min(fr,1.)*.7); rgh=1.; }
    if(fin>5.5&&fin<6.5){ float sn=smoothstep(.25,.5,upw+cav*.35*side+(catN(m*1.6)-.5)*.35);
      c=mix(c,vec3(.9,.94,.97)*(.92+.08*catN(m*9.)),sn); h=mix(h,.75,sn); rgh=mix(rgh,1.,sn); }
    if(fin>6.5){ c=mix(c,vec3(dot(c,vec3(.3,.59,.11)))*1.25+.05,.45*(1.-cav)); }
  }
  // Water over a bed, by finish index (0 clear,1 murky,2 glacial,3 tannin,4 shallow,5 still,6 windy,7 frosted).
  // depth ≈ 0 (wet film) … 1+ (deep); causK scales sun caustics on the bed (0 for a water surface).
  void catGP_water(inout vec3 c,inout float h,inout float rgh,vec2 m,float fin,float depth,float causK){
    vec3 tint=mix(vec3(.1,.24,.27),catSecondary*.8,.65); float k=.55;
    if(fin>.5&&fin<1.5){tint=vec3(.17,.19,.1);k=.85;}
    if(fin>1.5&&fin<2.5){tint=vec3(.28,.6,.6);k=.8;}
    if(fin>2.5&&fin<3.5){tint=vec3(.2,.1,.035);k=.85;}
    if(fin>3.5&&fin<4.5)k=.2;
    float t=clamp(depth*k,0.,.92);
    float caus=catGP_caustic(m*(fin>5.5&&fin<6.5?1.3:1.))*(fin>4.5&&fin<5.5?.3:fin>5.5&&fin<6.5?1.5:1.)*min(depth*4.,1.)*causK;
    c=mix(c,tint,t)+caus*(.13-.09*t)*(fin>.5&&fin<3.5?.45:1.);
    h=mix(h,.5,clamp(.3+.6*t,0.,1.)*step(.01,depth)); rgh=mix(rgh,fin>5.5&&fin<6.5?.22:.06,min(depth*4.,1.));
    if(fin>6.5){ float cr=1.-smoothstep(.01,.025,abs(catN(m*.45)-.5)); c=mix(c,vec3(.74,.82,.86),.55+.15*catN(m*3.)); c*=1.-cr*.25; rgh=.3; h=.5; }
  }
`;

const ground = 'catGP_ground(c,h,rgh,cav,mac,m); fxOwned=1.;';
const macro = 'vec2 m=q*catParams.x; float mac=catN(m*.11)*.62+catN(m*.43+3.1)*.38;';
const vehicle = 'catGP_vehicle(c,h,rgh,cav,q*catParams.x,px*catParams.x); fxOwned=1.;';

const GP_WAVE1 = {
  // ── ground ────────────────────────────────────────────────────────────────────────────────────────────
  // st.w: 0 asphalt · 1 chip seal · 2 river gravel (round, loose) · 3 crushed limestone · 4 exposed aggregate
  aggregate: `{ ${macro}
    float sh=st.w; vec2 rel; vec4 v=catGP_vor(q,sh>1.5&&sh<2.5?.55:.95,rel);
    float fd=catGP_fade(px,.55),id=v.z,id2=v.w,cav=0.,jw=st.y; vec3 avg;
    float facet=catH(vec2(floor((atan(rel.y,rel.x)+id*6.283)/2.094),id*91.)); // angular chips: 3 facets each
    if(sh<.5){
      float stone=smoothstep(jw,jw+.06+px*2.5,v.y)*step(.3,id); float dome=smoothstep(0.,.3,v.y);
      vec3 chip=mix(base,accent,id2)*(.75+.4*facet), bind=secondary*(.9+.25*catN(q*.37));
      avg=mix(secondary,base,.42); c=mix(avg,mix(bind,chip,stone*(.45+.5*id2)),fd);
      h=mix(.5,.3+stone*(.3+.25*dome),fd); cav=(1.-stone)*.3;
      c*=.8+.4*mac;                                               // fresh black vs oxidised grey, in big patches
      float crack=abs(catN(m*.33+vec2(5.2,1.3))-.5);              // tar snakes: glossy crack sealant
      float snake=(1.-smoothstep(.012,.02,crack))*smoothstep(.42,.55,catN(m*.07+9.))*catGP_fade(px*catParams.x,.1);
      c=mix(c,secondary*.32,snake); rgh*=1.-snake*.6; h=mix(h,.6,snake); cav*=1.-snake;
    } else if(sh<1.5){
      float stone=smoothstep(jw,jw+.05+px*2.5,v.y); float dome=smoothstep(0.,.4,v.y);
      vec3 chip=mix(mix(base,accent,id),secondary*1.5,step(.8,id2)*.7)*(.68+.42*facet);
      avg=mix(base,accent,.3)*.9; c=mix(avg,mix(secondary*.45,chip,stone),fd);
      float bleed=smoothstep(.6,.85,mac);                         // flushed binder: darker, glossy, flat
      c=mix(c,mix(secondary*.6,c,.45),bleed*.45); rgh*=1.-bleed*.4;
      h=mix(.5,mix(.08+stone*(.5+.35*dome),.5,bleed*.7),fd); cav=(1.-stone)*(1.-bleed);
    } else if(sh<2.5){
      float packedM=smoothstep(.45,.75,mac);                       // packed tracks: smaller stones, more fines
      vec2 e=catGP_rot(id*6.283)*rel; float r=(.44+.14*id2)*(1.-.3*packedM);
      float d=length(e*vec2(1.,1.25+.45*id))/r; float peb=1.-smoothstep(.94-px*1.5,1.+px*1.5,d);
      float dome=sqrt(max(0.,1.-d*d));
      vec3 pc=id2<.28?accent:id2<.52?base:id2<.78?mix(secondary,base,.55)*1.15:base*vec3(1.18,.86,.66);
      pc*=.7+.38*dome;
      vec3 fines=secondary*(.55+.45*smoothstep(1.,1.6,d))*(.85+.3*packedM);   // shadowed gaps hug each stone
      avg=mix(mix(base,accent,.4),secondary,.35); c=mix(avg,mix(fines,pc,peb),fd);
      h=mix(.5,mix(.12,.3+.65*dome,peb),fd); cav=1.-peb;
    } else if(sh<3.5){
      float stone=smoothstep(jw,jw+.1+px*2.5,v.y)*step(.4,id);
      vec3 chip=mix(secondary,accent,.2+.8*facet)*mix(1.,.8,step(.85,id2)), fines=mix(base,accent,.45);
      avg=mix(base,secondary,.2); c=mix(avg,mix(fines*.9,chip,stone),fd); c*=.86+.22*mac;
      float lane=smoothstep(.55,.75,mac); c=mix(c,accent,lane*.3); // wheel-polished, powdery lighter patches
      h=mix(.5,.4+stone*(.2+.25*facet)*(1.-lane*.6),fd); cav=(1.-stone)*.6;
    } else {
      vec2 e=catGP_rot(id*6.283)*rel; float r=.34+.1*id2; float d=length(e*vec2(1.,1.2+.4*id))/r;
      float peb=1.-smoothstep(.95-px*1.5,1.+px*1.5,d); float dome=sqrt(max(0.,1.-d*d));
      vec3 pc=(id2<.3?secondary*1.1:id2<.6?accent:base*vec3(1.1,.95,.8))*(.85+.2*dome);
      vec3 matrix=mix(base,accent,.6)*(.92+.12*catH(floor(q*9.)));
      avg=mix(matrix,pc,.5); c=mix(avg,mix(matrix,pc,peb),fd);
      h=mix(.5,mix(.4,.55+.2*dome,peb),fd); cav=(1.-peb)*.4;
    }
    ${ground} }`,
  cobbles: `{ ${macro}
    vec2 rel; vec4 v=catGP_vor(q*vec2(1.,st.x),.7,rel); float fd=catGP_fade(px,.6);
    vec2 e=catGP_rot(v.z*6.283)*rel; float r=.55+.12*v.w; float d=length(e*vec2(1.,1.15+.3*v.z))/r;
    float jw=st.y*(.6+.9*(1.-mac));
    float edge=smoothstep(jw,jw+.05+px*2.5,v.y);
    float round_=1.-smoothstep(.95-px*1.5,1.05+px*1.5,d); float stone=min(edge,mix(1.,round_,.75));
    float dome=sqrt(max(0.,1.-min(d,1.)*min(d,1.)))*smoothstep(jw,jw+.25,v.y);
    vec3 sc=v.w<.3?base:v.w<.55?accent*.9:v.w<.8?mix(base,secondary,.45)*vec3(.95,.97,1.06):base*vec3(1.1,.95,.85);
    sc*=(.88+.24*v.z)*(.7+.36*dome); sc=mix(sc,accent,smoothstep(.8,1.,dome)*.15);   // polished crowns
    vec3 joint=secondary*(.4+.35*catH(floor(q*14.)))*(.6+.4*smoothstep(0.,.25,1.-stone+(1.-edge)));
    c=mix(mix(base,secondary,.32),mix(joint,sc,stone),fd);
    h=mix(.5,mix(.04,.3+.68*dome,stone),fd); rgh*=1.-smoothstep(.7,1.,dome)*.3; float cav=1.-stone;
    ${ground} }`,
  // Granite setts / Belgian block: rows of rectangular blocks, irregular joints, bevelled arrises, speckle.
  setts: `{ ${macro}
    float row=floor(q.y),rl=st.x*(.82+.36*catH(vec2(row,7.)));
    float bx=q.x/rl+catH(vec2(row,3.)),col=floor(bx); float idb=catH(vec2(col,row));
    vec2 f=vec2(fract(bx)*rl,fract(q.y)); vec2 ins=st.y*(.7+vec2(catH(vec2(col,row+.5)),catH(vec2(col+.5,row)))*.9);
    vec2 dd=min(f-ins,vec2(rl,1.)-f-ins*.6); float e=min(dd.x,dd.y),cr=.09;
    e=e>cr?e:cr-length(max(vec2(cr)-dd,0.));
    float block=smoothstep(0.,.02+px*2.5,e),bevel=smoothstep(0.,.16,e),fd=catGP_fade(px,.5);
    float tilt=dot(f/vec2(rl,1.)-.5,vec2(catH(vec2(col,row+.3)),catH(vec2(col,row+.7)))-.5)*.5;
    float gs=catH(floor(q*26.)+idb*91.),sf=catGP_fade(px,.04);
    vec3 sc=base*(.8+.38*idb); sc=mix(sc,secondary*.7,step(.84,gs)*sf*.75); sc=mix(sc,accent*1.15,step(gs,.12)*sf*.6);
    sc*=.72+.32*bevel; sc=mix(sc,accent,smoothstep(.62,.8,mac)*bevel*.2);
    c=mix(mix(base,secondary,.28),mix(secondary*.55,sc,block),fd);
    h=mix(.05,.4+.35*bevel+tilt,block); float cav=1.-block;
    ${ground} }`,
  // Leaf litter: four offset, rotated single-cell leaf layers (no neighbour search). Upper leaves cast a
  // contact shadow onto lower ones; lower layers are older and darker. Ovate, lance and lobed shapes.
  litter: `{ ${macro}
    float fd=catGP_fade(px,.3),hf=catGP_fade(px,.6),cav=1.; vec3 soil=secondary*(.55+.35*catN(q*2.7));
    c=soil; h=.1;
    float cover=.1+.4*(1.-mac)+(1.-catDensity)*.4;
    for(int L=0;L<4;L++){
      float fl=float(L); vec2 p=catGP_rot(fl*1.93)*q*(1.+fl*.11)+fl*vec2(3.7,8.1); vec2 cl=floor(p);
      float r1=catH(cl+fl*13.1),r2=catH(cl+fl*7.7+.5),r3=catH(cl+fl*3.3+9.);
      if(r3<cover*(1.-fl*.15))continue;
      vec2 lp=catGP_rot(r1*6.283)*(fract(p)-.5-(vec2(r1,r2)-.5)*.06);
      float len=.42+.05*r3,x=lp.x/len,ax=abs(x);
      float w=(r2<.7?.5:.2)*len*pow(max(0.,1.-x*x),.6)*(1.-.25*x);         // broad ovate or narrow lance
      if(r2>.45&&r2<.7)w*=.8+.32*sin((x+1.)*9.4);                          // lobed (oak-like) edge
      float sd=abs(lp.y)-w,msk=(1.-smoothstep(-.015-px,0.,sd))*(1.-smoothstep(.97,1.,ax));
      msk=max(msk,(1.-smoothstep(.008,.008+px*2.5,abs(lp.y)))*step(x,-.9)*step(-1.14,x));
      float across=clamp(abs(lp.y)/max(w,.02),0.,1.);
      vec3 lc=r1<.3?accent:r1<.55?base:r1<.75?base*vec3(1.25,.78,.55):r1<.9?mix(accent,base,.5)*vec3(1.05,1.,.65):secondary*2.;
      lc=mix(lc,secondary*1.4,(1.-fl/3.)*.55*r3);                          // older, darker leaves underneath
      lc*=.78+.34*(1.-across); lc*=1.-.3*(1.-smoothstep(.005,.008+px*2.5,abs(lp.y)))*step(ax,.93);
      c*=1.-(1.-smoothstep(0.,.09,sd))*(1.-msk)*.5*fd;                    // contact shadow on the layer below
      c=mix(c,lc,msk); h=mix(h,.3+fl*.17+.08*(1.-across),msk); cav=mix(cav,.25-fl*.08,msk);
    }
    float twig=(1.-smoothstep(.01,.018+px*2.5,abs(catN(q*.45)-.5)))*step(.68,catN(q*.11+5.))*fd;
    c=mix(c,mix(secondary,accent,.3)*.75,twig); h=mix(h,1.,twig);
    float pc=1.-cover*.85; float cov=1.-pow(1.-pc*.42,4.);                               // expected leaf cover
    c=mix(mix(secondary*.62,mix(base,accent,.3)*.92,cov),c,fd); h=mix(.5,h,hf);
    ${ground} }`,
  // st.w 0 loam: crumbly clods, pale grit, trampled packed patches. 1 clay: dried mud plates that crack
  // and curl at the edges where the ground is dry; wet hollows stay smooth and dark.
  soil: `{ ${macro}
    vec2 rel; float cav; float fd=catGP_fade(px,.45);
    if(st.w<.5){
      vec4 v=catGP_vor(q,.9,rel); float clod=smoothstep(.02,.22+px*2.5,v.y),dome=smoothstep(0.,.6,v.y)*(1.-smoothstep(.25,.6,v.x)*.4);
      vec3 cc=base*(.72+.5*v.z)*(.7+.42*dome); float pack=smoothstep(.55,.72,mac);
      float peb=step(.9,v.w)*smoothstep(.12,.2,v.y);                                   // a few stones in the soil
      cc=mix(cc,accent*(.8+.4*dome),peb);
      float fleck=step(.95,catH(floor(q*5.)))*catGP_fade(px,.2);                        // rootlets/organic flecks
      c=mix(base*.85,mix(secondary*.55,cc,clod),fd); c=mix(c,secondary*.6,fleck*.8);
      c=mix(c,base*1.05,pack*.55); c*=.75+.45*mac; rgh*=1.-pack*.25;
      h=mix(.5,mix(.15+.75*clod*dome+peb*.15,.5,pack*.7),fd); cav=(1.-clod)*(1.-pack);
    } else {
      vec4 v=catGP_vor(q,.85,rel); float dry=smoothstep(.3,.55,mac);
      float cw=st.y*(.3+1.4*dry)*(.6+.8*v.w); float crack=(1.-smoothstep(cw,cw+.03+px*2.5,v.y))*smoothstep(.25,.4,mac);
      float lift=1.-smoothstep(cw,cw+.18,v.y);
      vec3 pc=base*(.86+.24*v.z)*(1.+.08*(catN(q*11.)-.5)); pc=mix(pc,accent,lift*dry*.4);
      c=mix(base,mix(pc,secondary*.42,crack),fd);
      float wetc=1.-smoothstep(.15,.4,mac); c=mix(c,secondary*.85,wetc*.4); rgh*=1.-wetc*.5;
      h=mix(.5+.25*lift*dry,.05,crack); cav=crack;
    }
    ${ground} }`,
  // Wind ripples: gentle stoss slope, steep shaded lee face, crests that wander and fork; dark heavy
  // minerals collect in troughs; quartz glints. Flat, firmer sand in macro highs.
  sand: `{ ${macro}
    float y=q.y+catN(q*vec2(.11,.05))*2.4+catN(q*.37)*.35; float t=fract(y);
    float prof=t<.72?t/.72:(1.-t)/.28; float rip=smoothstep(.8,.5,mac)*catGP_fade(px,.7);
    c=base*(.9+.18*mac); c*=1.-smoothstep(.72,.78,t)*.13*rip; c=mix(c,accent,smoothstep(.85,1.,prof)*.25*rip);
    float trough=1.-smoothstep(0.,.3,prof); c=mix(c,secondary*.7,trough*rip*.6*smoothstep(.4,.7,catN(q*vec2(1.,.3))));
    float g=catH(floor(q*42.)),gf=catGP_fade(px,.024); c*=1.+(g-.5)*.12*gf; c=mix(c,accent*1.25,step(.985,g)*gf);
    h=mix(.5,.15+.7*prof,rip); float cav=trough*rip*.6;
    ${ground} }`,
  // Exposed rock shelf/cliff: terraced beds (sloping tread, sharp shadowed riser), joints that break each
  // bed into blocks, per-bed tone (pale hard bands). On vertical faces the beds read as horizontal strata.
  strata: `{ ${macro}
    float y=q.y*st.x*.5; y+=.45*catN(vec2(y*.6,3.))+(catN(q*vec2(.22,.07))-.5)*.9+catN(q*vec2(1.3,.4))*.12;
    float band=floor(y),f=fract(y),bid=catH(vec2(band,4.1));
    float jx=q.x*(.4+.6*bid)+bid*7.+(catN(vec2(q.y*2.,band))-.5)*.35; float jc=floor(jx),jf=fract(jx),blk=catH(vec2(jc,band));
    float joint=(1.-smoothstep(st.y,st.y+px*(.4+.6*bid),min(jf,1.-jf)))*step(.25,blk);
    float fb=f+(catN(q*vec2(2.4,1.1)+band)-.5)*.34;                                    // broken, ragged ledge lips
    float riser=1.-smoothstep(0.,.06+px*2.5,fb); float fd=catGP_fade(px,.25),rough=catN(q*2.2);
    vec3 bc=mix(secondary,base,.45+.55*bid); bc=mix(bc,accent,step(.7,bid)*.6); bc*=.84+.24*blk;
    bc*=1.+(rough-.5)*.4*fd+(catN(q*7.)-.5)*.16*catGP_fade(px,.1);
    bc*=1.-.18*smoothstep(.55,.8,catN(vec2(q.x*2.5,q.y*.35)))*(1.-f);                // weathering stains below lips
    bc*=.92+.12*smoothstep(.0,.6,fb);                                                   // baked: tread lit, foot shaded
    float sub=catStripe(f*3.+catN(q*.8)*.3,.05,px*3.)*fd*.5;                          // fine bedding lines
    c=mix(bc,secondary*.42,max(max(riser,joint)*.9,sub*.35)*catGP_fade(px,.05));
    h=mix(.5,mix(.18+.62*pow(clamp(fb,0.,1.),.5)+(rough-.5)*.25+(blk-.5)*.15,.04,max(joint,riser)),catGP_fade(px,.4)); float cav=max(riser,joint);
    ${ground} }`,
  // Wind crust: elongated sastrugi ridges, cool blue hollows, bright crests, glazed ice in hollows, glints.
  snow: `{ ${macro}
    vec2 z=vec2(q.x*.3,q.y*1.3); z.y+=catN(z*.5)*1.6; float n=catN(z)*.65+catN(z*2.3+4.)*.35;
    float n2=catN(z+vec2(0.,.12))*.65+catN((z+vec2(0.,.12))*2.3+4.)*.35;                // one step upwind
    float ridge=smoothstep(.4,.7,n),slope=clamp((n-n2)*6.,-1.,1.),fd=catGP_fade(px,.5);
    c=mix(secondary,base,mix(.72,.62+.38*slope*.5+.3*ridge,fd));                        // lit windward / blue lee
    c=mix(c,accent,smoothstep(.62,.8,n)*.5*fd);
    float ice=smoothstep(.34,.26,mac); c=mix(c,mix(secondary,base,.6),ice*.55); rgh*=1.-ice*.75;
    c+=step(.993,catH(floor(q*24.)))*catGP_fade(px,.04)*.5;
    h=mix(.5,mix(.25+.55*ridge,.5,ice*.8),fd); float cav=(1.-ridge)*.5;
    ${ground} }`,
  // ── vehicles and props ───────────────────────────────────────────────────────────────────────────────
  // Orange peel in the clear coat; st.w 1 metallic flake, 2 pearl (colour flops toward the accent at
  // grazing view). Primer is patchy and feathered.
  paint: `{ float cav=0.,fl=catGP_fade(px,.06); h=.5+(catN(q*3.1)-.5)*.12;
    if((st.w>.5&&st.w<1.5)||(catTreatment>5.5&&catTreatment<6.5)){ float g=catH(floor(q*16.)); c=mix(c,accent,step(.8,g)*.3*fl); c*=1.+(g-.5)*.12*fl; }
    if(st.w>1.5){ float fr=1.-abs(dot(normalize(vNormal),normalize(vViewPosition))); c=mix(c,accent,fr*fr*.55); c=mix(c,secondary,pow(fr,4.)*.35); }
    if(catTreatment>6.5&&catTreatment<7.5){ float pt=smoothstep(.5,.62,catN(q*.25)); c=mix(c,secondary*1.25,pt*.45); h-=pt*.1; }
    ${vehicle} }`,
  // st.w 0 hammertone: dimples with flake in the hollows. 1 hot-dip galvanising: spangle crystals with flat
  // facets of different sheen and dark grain boundaries; ageing adds powdery white rust.
  hammer: `{ vec2 rel; float cav=0.,fd=catGP_fade(px,.4);
    if(st.w<.5){
      vec4 v=catGP_vor(q,.9,rel); float dim=1.-smoothstep(0.,.55,v.x);
      c*=.88+.18*v.z*fd; c=mix(c,accent,dim*.22*fd); c*=1.-(1.-smoothstep(.0,.12,v.y))*.1*fd;
      h=.3+.4*smoothstep(0.,.6,v.x); cav=dim*.5;
    } else {
      vec4 v=catGP_vor(q,1.,rel); float sheen=.72+.45*v.z+dot(rel,vec2(cos(v.w*6.28),sin(v.w*6.28)))*.25;
      float bnd=1.-smoothstep(0.,.05+px*2.5,v.y);
      float den=catStripe(dot(rel,vec2(cos(v.w*9.),sin(v.w*9.)))*7.,.12,px*7.)*.12;
      c=mix(base,mix(base*sheen,c,.15),fd); c=mix(c,secondary,(bnd*.5+den)*fd); rgh*=mix(1.,.75+.5*v.z,fd);
      h=.5+.06*(v.z-.5)-bnd*.15; cav=bnd;
      float wr=smoothstep(.62,.8,catN(q*.45))*catEffects.x; c=mix(c,vec3(.74,.76,.73),wr*.7); rgh=mix(rgh,1.,wr);
    }
    ${vehicle} }`,
  // st.w 0 brushed (long anisotropic grain, streaky sheen) · 1 chrome (near-mirror, faint polishing swirls)
  // · 2 weathering steel (blotchy patina, pitting, rust runs down local y).
  metal: `{ float cav=0.,fd=catGP_fade(px,.2);
    if(st.w<.5){
      float ln=catN(vec2(q.x*.12,q.y*36.))*.6+catN(vec2(q.x*.5,q.y*95.))*.4;
      c*=1.+(ln-.5)*.24*fd; rgh*=.8+.4*ln; h=.5+(ln-.5)*.25;
    } else if(st.w<1.5){
      float sw=catN(q*.7+catN(q*.2)*2.); c*=.96+.06*sw; rgh*=.45+.1*sw; h=.5;
    } else {
      float pat=catF(q*.55),streak=catN(vec2(q.x*2.5,q.y*.12));
      c=mix(secondary,base,smoothstep(.25,.75,pat)); c=mix(c,accent,smoothstep(.7,.9,pat)*.4); c*=.85+.25*streak;
      vec2 pc=fract(q*1.6)-.5; float pit=(1.-smoothstep(.06,.1+px*2.5,length(pc)))*step(.82,catH(floor(q*1.6)))*fd;
      c=mix(c,secondary*.4,pit); rgh*=1.08; h=mix(.5+(pat-.5)*.4,.1,pit); cav=pit;
    }
    ${vehicle} }`,
  // Tyre sidewall: concentric moulding rings, a raised lettering band with block "glyphs", matte rubber.
  rubber: `{ float r=length(metres)/catParams.x,a=atan(metres.y,metres.x); float cav=0.,fd=catGP_fade(px,.3);
    float ring=catStripe(r*1.3,.06,px*1.3)*fd; float bandf=fract(r/7.);
    float band=step(.5,bandf)*step(bandf,.66);
    float glyph=band*step(.42,catH(vec2(floor(a*r*.9),floor(bandf*28.))))*fd;
    c*=1.+(catN(q*9.)-.5)*.1*fd; c=mix(c,secondary,ring*.6); c=mix(c,accent*.7,glyph*.35);
    h=.5-ring*.25+band*.2+glyph*.25; cav=ring;
    ${vehicle} }`,
  // Directional tread: centre groove, chevron blocks, lateral grooves and sipes; grooves have real depth.
  tread: `{ vec2 z=vec2(q.x*st.x,q.y); float lane=floor(z.x),fx=fract(z.x);
    float cy=z.y+abs(fx-.5)*.9*(mod(lane,2.)*2.-1.);
    float gc=catStripe(z.x,st.y,px*st.x),gl=catStripe(cy*.5,st.y*.7,px*.5),sipe=catStripe(cy*2.,.035,px*2.)*(1.-gc)*(1.-gl);
    float groove=max(gc,gl); float fd=catGP_fade(px,.15);
    c=mix(c*(.95+.1*catN(q*6.)),secondary,groove*.85*fd); c*=1.-sipe*.3*fd;
    float pebble=groove*step(.97,catH(floor(q*2.)))*fd; c=mix(c,vec3(.45,.42,.38),pebble);
    h=1.-groove*.95-sipe*.35; float cav=groove;
    ${vehicle} }`,
  glass: `{ float cav=0.; c=mix(c,accent,.1+.05*sin(q.x*.7+q.y*.3)); h=.5;
    ${vehicle} }`,
  // Tail-light lens: cube-corner reflector cells (three bright/mid/dark facets per hexagon) and optic ribs.
  lens: `{ vec2 p=q*vec2(1.,st.x)*1.2; vec2 s=vec2(1.,1.732),ha=mod(p,s)-s*.5,hb=mod(p-s*.5,s)-s*.5; vec2 g=dot(ha,ha)<dot(hb,hb)?ha:hb;
    float facet=floor((atan(g.y,g.x)+3.1416)/2.0944),fd=catGP_fade(px,.9); float tone=.55+.25*facet;
    float rib=mix(.5,.5+.5*cos(q.x*6.283*1.5),catGP_fade(px,.6)); float zone=step(.5,fract(q.y*.1));
    c=mix(secondary,base,mix(mix(.8,tone,fd),.55+.45*rib,zone)); c=mix(c,accent,(1.-smoothstep(.0,.45,length(g)))*.25*fd*(1.-zone));
    h=mix(.5,mix(.3+.2*facet,rib,zone),fd); float cav=0.;
    ${vehicle} }`,
  // Plain-weave canvas: over/under threads with per-thread tone, slubs and pinhole gaps.
  fabric: `{ vec2 cl=floor(q),f=fract(q)-.5; float over=mod(cl.x+cl.y,2.),fd=catGP_fade(px,1.);
    float warp=cos(f.x*3.1416)*(.7+.3*cos(f.y*3.1416)),weft=cos(f.y*3.1416)*(.7+.3*cos(f.x*3.1416));
    float th=over>.5?warp:weft; float tone=over>.5?catH(vec2(cl.x,1.)):catH(vec2(cl.y,2.));
    float slub=catN(over>.5?vec2(cl.x*3.,q.y*.15):vec2(q.x*.15,cl.y*3.));
    c*=mix(1.,(.78+.28*th)*(.92+.1*tone+.1*slub),fd);
    c*=1.+(catN(q*.03)-.5)*.12; h=mix(.5,.15+.75*th,fd); float cav=(1.-th)*.5;
    ${vehicle} }`,
  // Three-strand rope: helical strands with shadowed lay grooves and counter-twisted fibre lines.
  rope: `{ float s=fract((q.y+q.x*.65)*1.4),prof=sin(s*3.1416),fd=catGP_fade(px,.7);
    float fib=catN(vec2((q.y-q.x*1.3)*12.,s*4.));
    c*=mix(1.,(.6+.45*prof)*(.9+.2*fib),fd); h=mix(.5,.1+.85*prof,fd); float cav=1.-prof;
    ${vehicle} }`,
};

// ── wave 2: rock, markings, water and extras ────────────────────────────────────────────────────────────
const rockEnd = 'catGP_rock(c,h,rgh,cav,m,catFinish,up); fxOwned=1.;';
// Markings work standalone and as overlays (alpha = paint coverage). Placement is in metres (exact line
// positions; travel runs along +y of the projection), randomness from q. Only overlay-safe variables are used.
const mk = 'vec2 mm=metres; float pm=max(length(dFdx(metres)),length(dFdy(metres)))+1e-5; vec3 pc=base,road=secondary*(.92+.16*catN(q*.5)); float cov=0.;';
const mkEnd = 'rgh=min(rgh,.85); catGP_mark(pc,cov,h,mm,pm,catFinish,secondary); if(catFinish>3.5&&catFinish<4.5)rgh*=.35; c=mix(road,pc,smoothstep(0.,.35,cov)); alpha=cov; fxOwned=1.;';
const across = 'float W=st.x,x=mod(mm.x+W*.5,W)-W*.5,y=mm.y;';
const GP_WAVE2 = {
  // Adirondack granite/anorthosite outcrop: rounded weathered bosses, curved exfoliation sheets, sparse
  // vertical joints, coarse feldspar/biotite speckle, dark run-off streaks on steep faces.
  granite: `{ vec2 m=q*catParams.x; float side=1.-abs(up),fd=catGP_fade(px,.3);
    // exfoliation slabs (~1.2 m): wavy, own tone each, lit face and a shaded foot under the next lip, so they
    // still read at 10–30 m after the joint lines themselves are sub-pixel
    float yw=q.y*.21+catN(q*vec2(.06,.05))*1.4+catN(q*.2)*.15; float slab=floor(yw),sf=fract(yw),sid=catH(vec2(slab,2.3));
    float sheet=(1.-smoothstep(st.y*.21,st.y*.21+px*.21*2.5,sf))*smoothstep(.2,.4,catN(vec2(q.x*.12,slab*3.)));
    float xv=q.x*.15+catN(q*vec2(.05,.13)+4.)*.9+sid*3.; float vj=catStripe(xv,st.y*.15,px*.15*2.5)*step(.6,catH(vec2(floor(xv),slab)));
    float joint=max(sheet,vj)*catGP_fade(px,.04);
    float knob=catN(q*.45)*.65+catN(q*1.3+2.)*.35;
    float g=catH(floor(q*9.)),gf=catGP_fade(px,.11);
    c=base*(.84+.26*knob)*(.86+.26*sid); c=mix(c,accent,step(.75,g)*gf*.3); c=mix(c,secondary*.7,step(g,.07)*gf*.4);
    c*=.78+.3*smoothstep(0.,.4,sf);
    float lz=smoothstep(.5,.72,catN(m*.35+3.)*.7+catN(m*1.2)*.3);                 // crustose lichen tone patches
    c=mix(c,mix(vec3(.6,.62,.55),vec3(.3,.31,.28),step(.55,catN(m*.15+8.))),lz*.38);
    c*=1.-side*smoothstep(.6,.85,catN(vec2(q.x*.5,q.y*.05)))*.18;
    c=mix(c,secondary*.35,joint);
    h=mix(.5,mix(.3+.3*knob+.3*smoothstep(0.,.4,sf),.02,joint),fd); float cav=max(joint,(1.-smoothstep(0.,.3,sf))*.5);
    ${rockEnd} }`,
  // Alpine limestone: karren flutes on steep faces, clints and grikes on flat tops, bedding planes and the
  // dark vertical "ink streaks" of Alpine cliffs.
  karst: `{ vec2 m=q*catParams.x; float side=1.-abs(up),fd=catGP_fade(px,.25);
    float flute=sin(q.x*6.283*1.3+catN(vec2(q.x*.4,q.y*.12))*5.)*.5+.5; float fl=smoothstep(.3,.8,side)*catGP_fade(px,.35)*smoothstep(.4,.65,catN(vec2(q.x*.15,q.y*.08)+7.));
    vec2 gq=q*.35+vec2(catN(q*.2),catN(q*.2+5.))*.6; vec2 gf=abs(fract(gq)-.5);
    float grike=(1.-smoothstep(st.y,st.y+px*.35*2.5,.5-max(gf.x,gf.y)))*(1.-fl);
    float bed=catStripe(q.y*.25+catN(q*vec2(.1,.3))*.4,.03,px*.25*2.5)*side;
    float ink=side*smoothstep(.5,.75,catN(vec2(q.x*1.1,q.y*.07)+2.));
    float tone=catN(q*.3)*.6+catN(m*.08)*.4;
    c=mix(base,accent,smoothstep(.45,.8,tone)*.6)*(.9+.14*mix(.5,flute,fl));
    c=mix(c,secondary*.5,ink*.6); float cut=max(grike,bed)*catGP_fade(px,.15); c=mix(c,secondary*.4,cut);
    h=mix(.5,mix(.5+(flute-.5)*.7*fl+(tone-.5)*.3,.05,cut),fd); float cav=cut+(1.-flute)*fl*.4;
    ${rockEnd} }`,
  // Bedded sedimentary rock. st.w 0: thin red/green argillite beds with laminae and ripple-marked tops
  // (Going-to-the-Sun). 1: cross-bedded sandstone with iron bands and blast-drill half-pipes (road cuts).
  beds: `{ vec2 m=q*catParams.x; float side=1.-abs(up),fd=catGP_fade(px,.2);
    float y=q.y+(catN(q*vec2(.08,.04))-.5)*2.; y+=.45*catN(vec2(y*.8,2.));
    float band=floor(y),f=fract(y),bid=catH(vec2(band,1.7)),hard=step(.4,bid); vec3 bc; float lam,drill=0.;
    if(st.w<.5){
      bc=(bid<.55?base:accent)*(.85+.25*catH(vec2(band,5.)));
      lam=catStripe(f*4.+catN(q*.6)*.3,.06,px*4.*2.5)*.4;
      bc*=1.+(sin((q.x+catN(q*.5)*.8)*6.283*1.6)*.5)*.12*(1.-side)*fd;
    } else {
      // cross-bedded sandstone: wavy truncating set boundaries, curved laminae dipping per set (read by tone,
      // not lines), iron bands, rounded weathered ledges, sparse subtle drill half-pipes
      float y2=q.y*.45+catN(vec2(q.x*.1,q.y*.2))*1.3+catN(q*.5)*.12; y2+=.4*catN(vec2(y2*.7,6.)); band=floor(y2); f=fract(y2); bid=catH(vec2(band,4.7)); hard=step(.45,bid);
      float ang=(bid<.5?-1.:1.)*(.9+bid*1.2); float lamc=(q.x*ang*.55+f*1.6)*(1.6+bid)+catN(q*.6)*.35+catN(vec2(q.x*.2,band))*.5+f*f*.8;
      bc=mix(base,accent,.25+.5*bid)*(.9+.14*mix(.5,catH(vec2(floor(lamc),band)),fd));
      bc=mix(bc,secondary*1.15,smoothstep(.62,.82,catN(vec2(q.x*.25,y2*2.)))*.22);
      bc*=.84+.2*smoothstep(0.,.3,f); lam=0.;
      bc*=1.-side*smoothstep(.55,.8,catN(vec2(q.x*.6,q.y*.06)+2.))*.2;               // varnish streaks down the cut
      bc*=1.-smoothstep(.68,.8,catN(q*.9+5.))*smoothstep(.5,.7,catN(m*.3))*.25*side;     // honeycomb weathering pits
      float dq=q.x*.5,dfr=fract(dq)-.5; drill=side*step(.88,catH(vec2(floor(dq),3.)))*(1.-smoothstep(.08,.08+px*.5*2.5,abs(dfr)))*smoothstep(.3,.6,catN(vec2(dq,q.y*.1)));
      bc*=1.-drill*(.06+.18*smoothstep(-.08,.08,dfr));
    }
    float jx=q.x*(st.w<.5?.7:.25)+bid*5.; float joint=catStripe(jx,st.y,px*.7*2.5)*step(st.w<.5?.35:.92,catH(vec2(floor(jx),band)));
    float lip=(1.-smoothstep(0.,.05+px*2.5,f))*(st.w<.5?1.:.3);
    c=bc*(1.-lam*.25*fd)*(.9+.12*smoothstep(0.,.5,f));
    float cut=max(joint,lip*(1.-hard*.5))*catGP_fade(px,.08); c=mix(c,secondary*.4,cut);
    h=mix(.5,mix(.3+.4*hard+(st.w<.5?.2*smoothstep(0.,.3,f):.25*sin(f*3.1416)),.05,max(cut,drill*.4)),fd); float cav=max(cut,drill*.4);
    ${rockEnd} }`,
  // Serpentinite: dark green polished (slickensided) facets that each catch the light differently, fine
  // striations, pale veins.
  serpentine: `{ vec2 m=q*catParams.x; vec2 sq=catGP_rot(.6)*q*vec2(.45,1.1)+vec2(catN(q*.25),catN(q*.25+3.))*1.2;
    vec2 rel; vec4 v=catGP_vor(sq,1.,rel); float fd=catGP_fade(px,.3);                 // sheared lenses, not tiles
    vec2 dir=normalize(vec2(1.,(v.z-.5)*.6));
    float lin=mix(.5,catN(vec2(dot(q,dir)*14.,dot(q,vec2(-dir.y,dir.x))*.6)),catGP_fade(px,.06));
    float sheen=clamp(.7+.3*v.w+dot(rel,dir)*.22,0.,1.2),mott=catN(q*.8)*.6+catN(q*2.3)*.4;
    float vein=max(1.-smoothstep(.012,.012+px*.45*2.5,abs(catN(q*.45+v.z)-.5)),(1.-smoothstep(.006,.006+px*1.1*2.5,abs(catN(q*1.1+7.)-.5)))*.55)*catGP_fade(px,.1);
    float crack=(1.-smoothstep(.02,.02+px*2.5,v.y))*fd*smoothstep(.55,.72,catN(q*1.3+v.z*5.));
    c=mix(secondary,base,clamp(sheen*(.6+.55*mott),0.,1.1))*(1.+(lin-.5)*.18); c=mix(c,accent,vein*.6); c=mix(c,secondary*.35,crack);
    rgh*=mix(1.,.5+.3*v.w,fd); h=mix(.5,mix(.5+(sheen-.85)*.25+(mott-.5)*.15,.05,crack),fd); float cav=crack;
    ${rockEnd} }`,
  // Angular blocks with flat fracture faces (baked light per face). st.w 0 scree/talus: mixed sizes with
  // chips between. 1 riprap: big quarried blocks, deep voids, occasional drill marks.
  talus: `{ vec2 m=q*catParams.x; vec2 rel; float sh=st.w; vec4 v=catGP_vor(q,.9,rel); float fd=catGP_fade(px,.4);
    float jw=st.y*(sh<.5?(.5+2.4*v.w*v.w):1.),e=v.y; float stone=smoothstep(jw,jw+.04+px*2.5,e);
    float facet=catH(vec2(floor((atan(rel.y,rel.x)+v.z*6.283)/1.5708),v.z*91.));
    float lit=.68+.36*facet+.2*clamp(-rel.y*1.5,-.5,.5);
    vec3 sc=mix(base,accent,v.z*.7); sc=v.w>.86?secondary*1.5:sc; sc*=lit;
    vec3 gap=mix(secondary*.3,base*.6,step(.7,catH(floor(q*6.)))*.6*catGP_fade(px,.1)*(1.-sh));
    if(sh>.5)sc*=1.-catStripe(dot(rel,vec2(.8,.6))*5.,.08,px*5.*2.5)*step(.8,v.w)*.3*fd;
    c=mix(mix(base,secondary,.4)*(.85+.3*catN(m*.2)),mix(gap,sc,stone),fd);
    h=mix(.5,mix(.02,.4+.35*facet+.2*smoothstep(jw,.5,e),stone),fd); float cav=1.-stone;
    ${rockEnd} }`,
  // Old snowfield: sun cups (dishes with a lit and a blue wall), dirt on the ridges, dirty bands, a hint of
  // pink snow algae.
  firn: `{ vec2 m=q*catParams.x; float fd=catGP_fade(px,.6);
    // sun cups from a ridged noise field: irregular basins of varying size separated by soft ridges; light is
    // baked from the field's slope (one-step offset), dirt collects on ridge crests
    vec2 w=q*(1.+.3*catN(m*.12))+vec2(catN(q*.3),catN(q*.3+4.))*.9,w2=w+vec2(-.06,.08);
    float n=catN(w)*.65+catN(w*2.3+3.)*.35,n2=catN(w2)*.65+catN(w2*2.3+3.)*.35;
    float r=1.-abs(n*2.-1.),r2=1.-abs(n2*2.-1.); float lit=clamp(.55+(r-r2)*4.,0.,1.);
    float band=smoothstep(.62,.85,catN(m*.06)); float dirt=smoothstep(.8,.97,r)*(.2+.5*smoothstep(.45,.75,catN(m*.25)))+band*.3;
    c=mix(secondary,base,mix(.82,.5+.5*lit,fd)); c=mix(c,accent,clamp(dirt*fd*.55+band*.3*(1.-fd),0.,1.));
    c=mix(c,vec3(.85,.62,.62),smoothstep(.72,.9,catN(m*.15+9.))*.2*(1.-r));
    h=mix(.5,.3+.4*r,fd); float cav=(1.-r)*.3;
    ${rockEnd} }`,
  // Glacier ice: blue and bubbly-white ice, crevasse lines with bright broken lips, ogive dirt bands,
  // foliation, cryoconite holes; glossy where clear.
  ice: `{ vec2 m=q*catParams.x; float fd=catGP_fade(px,.2);
    float y=q.y*.3+catN(q*vec2(.05,.12))*2.5+catN(q*.3)*.15,acf=abs(fract(y)-.5);
    float open=step(.35,catN(vec2(floor(y)*3.1,q.x*.08))),w=st.y*(.6+.9*catN(vec2(q.x*.1,floor(y))));
    float crev=(1.-smoothstep(w,w+.02+px*.3*2.5,acf))*open,wall=clamp(acf/max(w,1e-3),0.,1.);
    float lip=(1.-smoothstep(w,w+.07,acf))*(1.-crev)*open;                             // rounded snowy lip
    float fb=catN(vec2(q.x*.12,q.y*1.6)+catN(q*.15)*1.5),band=smoothstep(.45,.62,fb);  // foliation bands along flow
    float frl=(1.-smoothstep(.005,.005+px*.9*2.5,abs(catN(q*.9+3.)-.5)))*catGP_fade(px,.08);    // fracture traces
    float og=smoothstep(.55,.8,sin(q.y*.08*6.283+catN(q*.05)*3.)*.5+.5);
    c=mix(base,accent,band*(.75+.25*catN(vec2(q.x*.5,q.y*6.)))); c=mix(c,c*.72+vec3(.04,.035,.03),og*.5); c=mix(c,secondary*1.15,frl*.3);
    c=mix(c,vec3(.94,.96,.98),lip*.75); c=mix(c,mix(secondary*.22,base*.85,wall*wall),crev);
    float cry=step(.97,catH(floor(q*3.)))*(1.-smoothstep(.12,.2,length(fract(q*3.)-.5)))*catGP_fade(px,.15); c=mix(c,vec3(.12,.1,.08),cry*.8);
    rgh*=.35+.5*band; h=mix(.5,mix(.5+band*.08+lip*.2,wall*.4,crev),fd); float cav=crev+cry;
    ${rockEnd} }`,
  // Seep-wet rock: jointed dark rock with glossy wet streaks running down from the joints, algae and iron
  // stain in the wet, pale mineral rinds at the streak edges.
  seep: `{ vec2 m=q*catParams.x; float side=1.-abs(up),fd=catGP_fade(px,.25);
    float jt=catStripe(q.y*.4+catN(q*.15)*1.2,st.y,px*.4*2.5);
    jt=max(jt*smoothstep(.35,.55,catN(vec2(q.x*.3,q.y))),catStripe(q.x*.3+catN(q*.15+3.)*.9,st.y*.8,px*.3*2.5)*smoothstep(.45,.6,catN(vec2(q.y*.25,q.x*.3))))*catGP_fade(px,.1);
    float knob=catN(q*.6),sn=catN(vec2(q.x*1.2,q.y*.09));
    float wet=smoothstep(.42,.6,sn+jt*.2)*(.4+.6*side),rind=smoothstep(.3,.42,sn)*(1.-wet);
    c=base*(.8+.3*knob); c=mix(c,accent,rind*.35); c=mix(c,c*.45,wet);
    float stain=smoothstep(.5,.8,catN(vec2(q.x*2.2,q.y*.07)+4.))*smoothstep(.2,.6,sn); c=mix(c,mix(vec3(.16,.21,.1),vec3(.33,.19,.09),catN(vec2(q.x*1.5,q.y*.1)+9.)),stain*wet*.4);
    c=mix(c,secondary*.35,jt); rgh=mix(rgh,.12,wet);
    h=mix(.5,mix(.3+.5*knob,.05,jt),fd); float cav=max(jt,wet*.5);
    ${rockEnd} }`,

  // ── markings ──
  // st.x road width (m), st.y line width (m). st.w 0 US: double yellow centre + white edges; 1 France: white
  // centre dashes 3 m/10 m and edge dashes 3 m/3.5 m; 2 white lane skip lines 3 m/9 m + solid edges.
  lines: `{ ${mk} ${across} float lw=st.y; float bead=.92+.12*mix(.5,catH(floor(mm*90.)),catGP_fade(pm,.02));
    float de=max(abs(abs(x)-(W*.5-.35))-lw*.6,st.w>.5&&st.w<1.5?abs(mod(y,6.5)-1.5)-1.5:-1.);
    float dc=st.w<.5?abs(abs(x)-lw*1.1)-lw*.5:st.w<1.5?max(abs(x)-lw*.5,abs(mod(y,13.)-1.5)-1.5):max(abs(x)-lw*.5,abs(mod(y,12.)-1.5)-1.5);
    float ce=catGP_cov(de,pm),cc=catGP_cov(dc,pm); pc=(cc>ce?(st.w<.5?accent:base):base)*bead; cov=max(ce,cc);
    ${mkEnd} }`,
  // Fans' painted lettering on mountain-pass asphalt: words of blocky, stretched (anamorphic) glyphs in
  // spray paint with overspray, across the lane. Glyphs are random strokes, not real names.
  lettering: `{ ${mk} vec2 cs=vec2(3.6,5.5),cl=floor(mm/cs),f=mm-cl*cs; float r=catH(cl+.3),r2=catH(cl+5.1),r3=catH(cl+9.7);
    float n=floor(3.+r2*5.),lwd=.44,lh=1.1+r3*.5; vec2 o=vec2(.2+(cs.x-.4-n*lwd)*r3,.6+(cs.y-lh-1.2)*r);
    vec2 p=f-o; p.x-=p.y*(r2-.5)*.25; float li=floor(p.x/lwd); vec2 s=vec2(p.x-li*lwd,p.y);
    float d=1.;
    if(r<.55*st.z+.15&&li>=0.&&li<n&&s.y>-.1&&s.y<lh+.1){
      float g=catH(cl*7.+li),x0=.05,x1=lwd-.12,y1=lh-.05,ym=lh*(.45+.1*fract(g*31.));
      d=catGP_seg(s,vec2(x0,.05),vec2(x0,y1));
      if(fract(g*2.)>.4)d=min(d,catGP_seg(s,vec2(x0,y1),vec2(x1,y1)));
      if(fract(g*4.)>.5)d=min(d,catGP_seg(s,vec2(x0,ym),vec2(x1,ym)));
      if(fract(g*8.)>.5)d=min(d,catGP_seg(s,vec2(x0,.05),vec2(x1,.05)));
      if(fract(g*16.)>.45)d=min(d,catGP_seg(s,vec2(x1,ym),vec2(x1,y1)));
      if(fract(g*32.)>.45)d=min(d,catGP_seg(s,vec2(x1,.05),vec2(x1,ym)));
      if(fract(g*64.)>.75)d=min(d,catGP_seg(s,vec2(x0,y1),vec2(x1,.05)));
      d-=.055;
    }
    float k=fract(r2*7.3); pc=k<.45?base:k<.7?accent:k<.85?vec3(.6,.08,.05):vec3(.08,.2,.55);
    cov=max(catGP_cov(d,pm+.012),(1.-smoothstep(0.,.14,d))*.22)*catGP_fade(pm,.25);
    ${mkEnd} }`,
  // Continental zebra crossing: 0.5 m bars parallel to traffic, 3.5 m deep, every st.x metres of road.
  crossing: `{ ${mk} float P=st.x,y=mod(mm.y+P*.5,P)-P*.5; float bx=abs(mod(mm.x,1.1)-.55)-st.y*.5;
    cov=catGP_cov(max(abs(y)-1.75,bx),pm);
    pc=base*(.93+.1*mix(.5,catH(floor(mm*90.)),catGP_fade(pm,.02)));
    ${mkEnd} }`,
  // Cycle infrastructure. st.w 0: green surfaced lane on the right of each road with a white edge line and a
  // bike-and-rider symbol every 25 m. 1: sharrow (bike + double chevron) in the lane every 25 m.
  bikelane: `{ ${mk} ${across} float yc=mod(y+6.,12.)-6.;
    if(st.w<.5){
      float lane=catGP_cov(abs(x-(W*.5-1.15))-.8,pm); float edge=catGP_cov(abs(x-(W*.5-1.95))-st.y*.5,pm);
      float sym=catGP_cov(catGP_bike(vec2(x-(W*.5-1.15),yc/2.2)*vec2(1.,1.)*1.15,1.),pm*1.15);
      pc=mix(base*(.9+.15*catN(mm*2.)),accent,max(edge,sym)); cov=max(lane,edge);
    } else {
      vec2 s=vec2(x-W*.25,yc/2.3); float d=catGP_bike(s,0.);
      for(int k=0;k<2;k++){ float y0=1.55+float(k)*.4; d=min(d,max(abs(s.y-y0+abs(s.x)*.75)-.07,abs(s.x)-.5)); }
      cov=catGP_cov(d,pm); pc=base;
    }
    ${mkEnd} }`,
  // Crack sealant ("tar snakes"): glossy black bands over a meandering crack network, a wobbly
  // longitudinal joint and transverse cracks.
  crackseal: `{ ${mk} ${across}
    float f1=abs(catN(mm*.28+vec2(1.3,7.))-.5)/.42*step(.42,catN(mm*.05+2.));
    float f2=abs(x-(catN(vec2(y*.08,3.))-.5)*1.2)+(1.-step(.35,catN(vec2(y*.02,9.))))*9.;
    float ty=mod(y,9.)-4.5+(catN(vec2(x*.4,floor(y/9.)))-.5)*1.2; float f3=abs(ty)+(1.-step(.5,catH(vec2(floor(y/9.),4.))))*9.;
    float d=min(f1,min(f2,f3))-st.y*(.8+.6*catN(mm*3.));
    cov=catGP_cov(d,pm); pc=mix(base,accent,catN(mm*4.)); rgh=.45;
    ${mkEnd} }`,
  // Tyre skid marks: paired dark rubber streaks 1.5 m apart, curving slightly, fading in and out.
  skid: `{ ${mk} ${across} float L=12.,cy=floor(y/L),r=catH(vec2(cy,1.)),r2=catH(vec2(cy,2.)); float len=4.+6.*r2,y0=fract(r*7.)*(L-len),t=(mod(y,L)-y0)/len;
    float xc=(r-.5)*W*.5+sin(t*2.+r*6.)*.35*r2; float a=smoothstep(0.,.12,t)*(1.-smoothstep(.75,1.,t))*step(.12,r)*step(0.,t)*step(t,1.);
    float tr=min(abs(x-xc-.75),abs(x-xc+.75))-st.y*.5; float streak=.6+.4*mix(.5,catN(vec2((x-xc)*40.,y*.3)),catGP_fade(pm,.02));
    cov=catGP_cov(tr,pm)*a*streak; pc=base; rgh=.75;
    ${mkEnd} }`,
  // Utility cut: rectangular trench reinstatements of fresher, finer asphalt with black seal bands.
  cutpatch: `{ ${mk} vec2 cs=vec2(st.x*1.1,9.),cl=floor(mm/cs); vec2 f=mm-cl*cs-cs*.5; float r=catH(cl),r2=catH(cl+2.),r3=catH(cl+5.);
    vec2 b=r2>.6?vec2(.45+.2*r3,cs.y*.42):vec2(.6+1.2*r3,1.+2.5*r2); vec2 o=(vec2(catH(cl+7.),catH(cl+8.))-.5)*(cs*.5-b);
    float sd=catGP_sd(f-o,b)+(catN(mm*3.)-.5)*.03; float on=step(.25,r);
    float fill=catGP_cov(sd,pm)*on,seal=catGP_cov(abs(sd)-st.y*(.6+.8*catN(mm*5.)),pm)*on;
    pc=mix(base*(.9+.18*mix(.5,catH(floor(mm*60.)),catGP_fade(pm,.02))),accent,seal); cov=max(fill,seal);
    ${mkEnd} }`,
  // Cast iron in the road: round manhole covers (diamond-boss grid, rim) in the lane and bike-safe
  // rectangular storm grates at the kerb; worn bosses shine.
  castiron: `{ ${mk} ${across} float P=11.,cy=floor((y+3.)/P),yy=mod(y+3.,P);
    vec2 pm1=vec2(x-(-W*.25+(catH(vec2(cy,3.))-.5)*1.2),yy-3.); float rr=length(pm1);
    vec2 dg=abs(fract(mat2(.7071,-.7071,.7071,.7071)*pm1*11.)-.5); float boss=1.-smoothstep(.22,.3,max(dg.x,dg.y));
    float manhole=catGP_cov(rr-.34,pm),rim=catGP_cov(abs(rr-.32)-.025,pm);
    vec2 pg=vec2(x-(W*.5-.45),yy-P*.6); float grate=catGP_cov(catGP_sd(pg,vec2(.3,.5)),pm);
    float frame=catGP_cov(abs(catGP_sd(pg,vec2(.27,.47)))-.03,pm); float slot=(1.-catStripe(pg.y*7.,.32,pm*7.*2.5))*(1.-frame);
    float top=manhole*mix(boss,1.,rim)+grate*(1.-slot);
    pc=mix(base*.8,accent,top*.6*catGP_fade(pm,.01)+rim*.35); pc=mix(pc,base*.25,grate*slot); rgh=mix(1.,.55,top);
    cov=max(manhole,grate); h=mix(h,mix(.35,.7,top)-.3*grate*slot,cov);
    ${mkEnd} }`,
  // Painted kerb: alternating colour blocks along local x (build kerbs along x); st.w 1 = single colour.
  // Painted kerb: alternating colour blocks (st.w 1 = single colour). On vertical faces (kerb front, built along
  // local x) it fills the face; on horizontal surfaces it is a 0.3 m band at each road edge, along travel (+y).
  kerbpaint: `{ ${mk} float hz=step(.7,abs(up)),W=7.2,x=mod(mm.x+W*.5,W)-W*.5,along=mix(mm.x,mm.y,hz);
    float blk=floor(along/st.x),alt=st.w<.5?mod(blk,2.):0.;
    float brush=.92+.1*catN(hz>.5?vec2(mm.y*3.,mm.x*40.):vec2(mm.x*3.,mm.y*40.)); pc=mix(base,accent,alt)*brush;
    float chip=smoothstep(.76,.8,catN(mm*6.)*.8+catN(mm*23.)*.2);
    cov=(1.-chip*.9)*mix(1.,catGP_cov(abs(abs(x)-(W*.5-.15))-.15,pm),hz);
    ${mkEnd} }`,

  // ── water (opaque beds and wet bands; no simulation) ──
  // Beds under water. st.z = depth (0 wet film … 1 deep). st.w 0 rippled sandy lake bed, 1 river cobbles
  // with algae film, 2 glacial silt with flow streaks, 3 peaty tannin bed with sunken leaves and twigs.
  waterbed: `{ vec2 m=q*catParams.x; vec2 rel; float fd=catGP_fade(px,.4),sh=st.w; vec3 bc; float bh=.5;
    if(sh<.5){ float rip=sin((q.y+catN(q*.15)*2.)*6.283)*.5+.5; bc=base*(.88+.2*mix(.5,rip,fd)); bh=mix(.5,.3+.4*rip,fd);
      bc=mix(bc,secondary,step(.97,catH(floor(q*3.)))*catGP_fade(px,.1)*.7); }
    else if(sh<1.5){ vec4 v=catGP_vor(q+catN(q*.3)*.6,.9,rel); float d=length((catGP_rot(v.w*6.283)*rel)*vec2(1.,1.1+.5*v.z))/(.45+.3*v.w*v.w+.1*v.z);
      float stn=1.-smoothstep(.95-px*2.,1.05+px*2.,d),dome=sqrt(max(0.,1.-min(d*d,1.)));
      vec3 sc=mix(mix(base,accent,v.z),secondary*1.6,step(.8,v.w)*.6)*(.62+.45*dome); sc=mix(sc,vec3(.22,.26,.1),smoothstep(.4,.9,dome)*.3);
      bc=mix(mix(base,secondary,.45),mix(mix(base,secondary,.6)*.65,sc,stn),fd); bh=mix(.5,mix(.1,.3+.6*dome,stn),fd); }
    else if(sh<2.5){ float fl=catN(vec2(q.x*.15,q.y*1.2)+catN(q*.2)); bc=base*(.92+.14*fl); bh=.45+.1*fl; }
    else { vec2 p=catGP_rot(.7)*q,cl=floor(p); vec2 lp=catGP_rot(catH(cl)*6.28)*(fract(p)-.5);
      float lw=.18*pow(max(0.,1.-pow(lp.x/.42,2.)),.6);
      float leaf=(1.-smoothstep(-.01,.01+px*2.5,abs(lp.y)-lw))*step(abs(lp.x),.42)*step(.35,catH(cl+3.))*fd;
      float twig=(1.-smoothstep(.01,.01+px*2.5,abs(catN(q*.4)-.5)))*step(.6,catN(q*.1))*fd;
      bc=base*(.8+.3*catN(q*.7)); bc=mix(bc,accent*(.7+.4*catH(cl+1.)),leaf); bc=mix(bc,secondary*1.3,twig); bh=.4+.2*max(leaf,twig); }
    c=bc; h=bh; catGP_water(c,h,rgh,m,catFinish,st.z,catGP_fade(px*catParams.x,.2)); fxOwned=1.; }`,
  // st.w 0: lake/river shore keyed to height — water at projection y = 0, a dark wet band up to ~0.45 m,
  // drift line of scum/pollen, green slime at the waterline, sand and gravel. 1: coastal wet sand with
  // lacy swash lines, foam bubbles, backwash rills and glassy wet sheets.
  shore: `{ vec2 m=q*catParams.x; float fd=catGP_fade(px,.4); float sand=catN(q*3.)*.5+catN(q*9.)*.5; float cav=0.;
    if(st.w<.5){
      float wl=ly+(catN(vec2(m.x*.6,1.))-.5)*.12; float under=1.-smoothstep(-.02,.02,wl),wet=1.-smoothstep(0.,.45,wl);
      float scum=(1.-smoothstep(0.,.04,abs(wl-.12)))*(.5+.5*catN(m*3.)),algae=1.-smoothstep(0.,.08,abs(wl+.03));
      vec2 rel; vec4 v=catGP_vor(q,.8,rel); float peb=smoothstep(.06,.06+px*2.5,v.y)*step(.45,v.z);
      c=mix(base*(.9+.2*sand*fd),mix(base,accent,v.w)*(.75+.35*smoothstep(.06,.4,v.y)),peb*fd);
      c*=1.-wet*.4; c=mix(c,vec3(.72,.68,.52),scum*.6*(1.-under)); c=mix(c,vec3(.15,.22,.09),algae*.55);
      rgh=mix(rgh,.12,wet); h=mix(.5,.35+.4*peb,fd); cav=1.-peb;
      catGP_water(c,h,rgh,m,catFinish,under*(.3+clamp(-ly*2.,0.,1.)),catGP_fade(px*catParams.x,.2));
    } else {
      float y=q.y/6.+catN(vec2(q.x*.08,q.y*.03))*.9+catN(q*.3)*.06,sf=fract(y);
      float swl=1.-smoothstep(0.,.006+px/6.*2.5,min(sf,1.-sf)); float wet=.25+.75*(1.-sf);
      vec2 bq=q*3.,bc=floor(bq); float bub=(1.-smoothstep(.15,.3,length(fract(bq)-.5)))*step(.55,catH(bc))*smoothstep(.92,1.,sf)*catGP_fade(px,.1);
      float rill=(1.-smoothstep(.03,.03+px*.8*2.5,abs(catN(vec2(q.x*.8,q.y*.15)+catN(q*.4))-.5)))*wet*catGP_fade(px,.15);
      c=base*(.92+.12*sand*fd)*(1.-.38*wet); c=mix(c,secondary*.8,rill*.5);
      c=mix(c,vec3(.62,.7,.74),smoothstep(.8,.95,wet)*.35); c=mix(c,accent,max(swl*.85,bub*.9));
      rgh=mix(rgh,.07,smoothstep(.4,.9,wet)); h=mix(.5,.5-rill*.25+swl*.15+bub*.2,fd); cav=rill;
      catGP_wetfx(c,rgh,m,catFinish);
    }
    fxOwned=1.; }`,
  // Kelp wrack on sand: tangled glossy ribbons in two layers, float bulbs, wet sand halo.
  wrack: `{ vec2 m=q*catParams.x; float fd=catGP_fade(px,.3); vec3 kc=base; float cov=0.,hh=.3;
    for(int L=0;L<2;L++){ float fl=float(L); vec2 p=catGP_rot(fl*1.3+.4)*q*(1.+fl*.3)+fl*7.;
      float d=abs(catN(p*vec2(.35,1.2)+catN(p*.3)*1.5)-.5),w=.025+.03*catN(p*.5);
      float rib=(1.-smoothstep(w,w+.01+px*2.5,d))*step(.42,catN(p*.18+fl*3.));
      vec3 col=mix(base,accent,catN(p*.7))*(.7+.4*(1.-d/w)); kc=mix(kc,col,rib); cov=max(cov,rib); hh=mix(hh,.6+fl*.2,rib); }
    float bulb=step(.9,catH(floor(q*2.5)))*(1.-smoothstep(.12,.18,length(fract(q*2.5)-.5)))*cov; kc=mix(kc,accent*.85+.05,bulb);
    float damp=smoothstep(.35,.6,catN(q*.18)); vec3 sand=secondary*(.9+.15*catN(q*4.))*(1.-.15*damp);
    c=mix(mix(sand,base,.35*smoothstep(.3,.6,catN(q*.18))),mix(sand,kc,cov),fd);
    rgh=mix(rgh,.3,cov*fd+damp*.3); h=mix(.5,mix(.3,hh+bulb*.2,cov),fd); catGP_wetfx(c,rgh,m,catFinish); fxOwned=1.; }`,
  // Tidal rock pool: rounded dark rock knobs, glassy pools in the hollows with caustics, green algae
  // fringe, barnacles above the pools, mussel beds.
  rockpool: `{ vec2 m=q*catParams.x; vec2 rel; vec4 v=catGP_vor(q,.85,rel); float fd=catGP_fade(px,.35);
    float knob=smoothstep(0.,.5,v.y),pn=catN(m*.4)*.7+catN(m*1.3)*.3;
    float pool=smoothstep(.36,.33,pn),rim=smoothstep(.45,.37,pn)*(1.-pool);
    float barn=step(.75,catH(floor(q*7.)))*(1.-smoothstep(.15,.3,length(fract(q*7.)-.5)))*catGP_fade(px,.08)*(1.-pool)*smoothstep(.4,.7,knob);
    float mus=smoothstep(.6,.75,catN(q*.5+3.))*(1.-pool)*(1.-rim);
    c=base*(.75+.35*knob); c=mix(c,secondary*.6*(.7+.3*catH(floor(q*5.))),mus*.85); c=mix(c,vec3(.82,.8,.72),barn);
    c=mix(c,vec3(.24,.28,.17),rim*.6); c=mix(c,secondary*.25,(1.-smoothstep(.02,.02+px*2.5,v.y))*fd*(1.-pool));
    rgh=mix(rgh,.35,rim+mus*.5); h=mix(.5,.2+.6*knob,fd); catGP_wetfx(c,rgh,m,catFinish);
    vec3 pc=mix(c*.5,accent*.6,.6); float hp=h,rp=rgh; catGP_water(pc,hp,rp,m,catFinish,1.,catGP_fade(px*catParams.x,.2));
    c=mix(c,pc,pool); h=mix(h,.45,pool); rgh=mix(rgh,rp*.5,pool); fxOwned=1.; }`,
  // Stylised opaque lake/river surface: depth colour drift, wind lanes (calm slicks vs rippled bands),
  // lit ripple faces, sparse glints. still = calm, windy = choppy, frosted = skim ice.
  surface: `{ vec2 m=q*catParams.x; float fd=catGP_fade(px,.25);
    float wind=catFinish>5.5&&catFinish<6.5?1.6:catFinish>4.5&&catFinish<5.5?.2:1.;
    float lane=catN(vec2(m.x*.04,m.y*.15)),rip=catN(vec2(q.x*.6,q.y*2.2)+catN(q*.3)*1.2)*.6+catN(vec2(q.x*1.5,q.y*5.))*.4;
    float rough=smoothstep(.35,.65,lane)*wind;
    c=mix(base,secondary,.35+.3*catN(m*.03));
    c=mix(c,accent,smoothstep(.62,.8,rip)*rough*.45*fd); c=mix(c,secondary*.8,smoothstep(.4,.25,rip)*rough*.3*fd);
    vec2 gq=q*vec2(2.,6.); c+=step(.97-.02*rough,catH(floor(gq)))*(1.-smoothstep(.06,.14,length((fract(gq)-.5)*vec2(1.,.35))))*rough*catGP_fade(px,.12)*.6;
    h=mix(.5,.5+(rip-.5)*min(rough,1.)*.8,fd); rgh=mix(.04,.22,min(rough,1.));
    float hh=h,rr=rgh; catGP_water(c,hh,rr,m,catFinish,.6,0.); if(catFinish>6.5){h=.5;rgh=rr;} fxOwned=1.; }`,

  // ── ground extras ──
  // Pine-needle duff: four layers of paired needles (bundles of two, splayed) over decomposed duff,
  // contact shadows, the odd cone.
  duff: `{ ${macro}
    float fd=catGP_fade(px,.25),cav=1.; c=secondary*(.6+.35*catN(vec2(q.x*3.,q.y*.8))); h=.1;
    for(int L=0;L<4;L++){ float fl=float(L); vec2 p=catGP_rot(fl*2.1)*q*(1.6+fl*.25)+fl*vec2(5.3,1.9); vec2 cl=floor(p);
      float r1=catH(cl+fl*3.1),r2=catH(cl+fl*5.7+.5); vec2 lp=catGP_rot(r1*6.283)*(fract(p)-.5-(vec2(r1,r2)-.5)*.08);
      float dn=min(catGP_seg(lp,vec2(-.42,0.),vec2(.42,0.)),catGP_seg(lp,vec2(-.42,0.),vec2(.38,.22+.12*r2)));
      float w=.03; float msk=(1.-smoothstep(w,w+px*1.8*2.5,dn))*step(.2,r2);
      vec3 nc=r2<.45?accent:r2<.8?base:secondary*1.9; nc=mix(nc,secondary*1.3,(1.-fl/3.)*.4);
      c*=1.-(1.-smoothstep(w,w+.08,dn))*(1.-msk)*.35*fd; c=mix(c,nc*(.85+.25*catN(lp*9.)),msk);
      h=mix(h,.3+fl*.17,msk); cav=mix(cav,.3-fl*.08,msk); }
    vec2 cq=q*.22,cc=floor(cq); vec2 cp=catGP_rot(catH(cc)*6.28)*(fract(cq)-.5); float cone=(1.-smoothstep(.95,1.,length(cp/vec2(.3,.17))))*step(.9,catH(cc+2.));
    c=mix(c,base*(.6+.5*step(.5,fract(cp.x*14.))),cone*fd); h=mix(h,.9,cone);
    c=mix(mix(secondary*.7,mix(base,accent,.35),.65)*(.8+.35*mac),c,fd); h=mix(.5,h,catGP_fade(px,.5));
    ${ground} }`,
  // Brick street pavers (Pittsburgh): running-bond bricks laid across, pillowed worn arrises, varied firing
  // (some burnt purple, some pale), the odd sunken brick, dark sand/tar joints.
  pavers: `{ ${macro}
    float row=floor(q.y),bx=q.x/st.x+mod(row,2.)*.5,col=floor(bx); vec2 f=vec2(fract(bx)*st.x,fract(q.y));
    float id=catH(vec2(col,row)),id2=catH(vec2(col,row)+.5); vec2 dd=min(f,vec2(st.x,1.)-f)-st.y;
    float e=min(dd.x,dd.y),blk=smoothstep(0.,.02+px*2.5,e),bev=smoothstep(0.,.28,e),fd=catGP_fade(px,.5);
    float sunk=step(.965,id2);
    vec3 bc=id<.15?secondary*1.5:id>.86?accent:base*(.82+.3*id2); bc*=(.7+.36*bev)*(1.-sunk*.2);
    bc*=1.+(mix(.5,catH(floor(q*14.)),catGP_fade(px,.07))-.5)*.12; rgh*=1.-step(.8,id)*.3*blk;
    c=mix(mix(base,secondary,.3)*(.85+.3*mac),mix(secondary*.5,bc,blk),fd);
    h=mix(.5,mix(.05,(.35+.55*bev)*(1.-sunk*.4),blk),fd); float cav=max(1.-blk,sunk*.5);
    ${ground} }`,

  // ── props extras ──
  // Galvanised W-beam guardrail (scale = beam height .31 m): two-ridge profile with baked light, spangle,
  // splice laps every 3.81 m, bolt heads at posts, road grime along the bottom.
  wbeam: `{ float f=fract(q.y),prof=.5-.5*cos(f*12.566),lit=.5+.5*sin(f*12.566+.8);
    float sp=mix(.5,catH(floor(q*18.)),catGP_fade(px,.05)); c=base*(.78+.3*lit)*(1.+(sp-.5)*.12);
    float lap=1.-smoothstep(0.,.02+px*2.5,abs(fract(q.x/12.3)-.5)*12.3-6.1);
    vec2 bp=vec2((fract(q.x/6.15)-.5)*6.15,f-.5); float bolt=1.-smoothstep(.05,.05+px*2.5,length(bp));
    float grime=(1.-smoothstep(.0,.35,f))*(.5+.5*catN(vec2(q.x*.3,q.y*3.)))*.35;
    c=mix(c,secondary,lap*.6); c=mix(c,secondary*.7+.08*lit,bolt); c=mix(c,vec3(.2,.18,.15),grime);
    h=mix(.5,.25+.5*prof+.2*bolt,catGP_fade(px,.4)); float cav=(1.-prof)*.4;
    ${vehicle} }`,
  // Concrete jersey barrier (origin at ground): segment joints every 3.05 m, form line, drainage scuppers,
  // black tyre rub low down, road grime fading upward, pores.
  barrier: `{ vec2 m=q*catParams.x; float side=1.-abs(up),fd=catGP_fade(px,.3); float pm=px*catParams.x;
    c=base*(.9+.15*catN(q*.7)); c=mix(c,secondary*.8,step(.96,catH(floor(q*14.)))*catGP_fade(px,.07));
    float jx=abs(mod(m.x,3.05)-1.525)-1.51; float joint=1.-smoothstep(0.,pm*2.5,-jx);
    float form=catStripe(ly/.6,.01,pm/.6*2.5)*side*.5;
    float scup=catGP_cov(max(abs(mod(m.x,3.05)-1.5)-.3,ly-.1),pm)*side;
    float rub=(1.-smoothstep(.05,.35,ly))*smoothstep(.5,.75,catN(vec2(m.x*.5,ly*6.)))*side;
    float grime=(1.-smoothstep(0.,.55,ly))*(.6+.4*catN(vec2(m.x*1.5,ly*4.)))*side;
    c*=1.-grime*.3; c=mix(c,vec3(.05),rub*.75); c=mix(c,secondary*.35,max(joint,scup)); c*=1.-form*.15;
    h=mix(.5,.5-.45*max(joint,scup)-form*.1,fd); float cav=max(joint,scup);
    ${vehicle} }`,
  // Micro-prismatic retroreflective sign sheeting: honeycomb seal cells with faint prism sparkle.
  sheeting: `{ vec2 p=q*1.15; vec2 s=vec2(1.,1.732),ha=mod(p,s)-s*.5,hb=mod(p-s*.5,s)-s*.5; vec2 g=dot(ha,ha)<dot(hb,hb)?ha:hb;
    float edge=1.-smoothstep(.0,.06+px*2.5,.45-max(abs(g.x)*.866+abs(g.y)*.5,abs(g.y))); float fd=catGP_fade(px,.6);
    float facet=floor((atan(g.y,g.x)+3.1416)/1.0472); float tone=catH(vec2(facet,floor(p.x)+floor(p.y)*7.));
    c=base*(.95+.08*tone*fd); c=mix(c,secondary,edge*.35*fd); rgh*=.6; h=mix(.5,.5-edge*.2,fd); float cav=edge*.3;
    ${vehicle} }`,
};

export const GP_PATTERNS = Object.freeze({ ...GP_WAVE1, ...GP_WAVE2 });
