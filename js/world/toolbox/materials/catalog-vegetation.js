// Vegetation kernels for the texture catalog: bark (cylindrical), leaf sprigs, needles, fronds, grass clumps,
// clover and flowers (UV alpha cards). Split out of catalog-patterns.js; CATALOG_PATTERNS spreads these in and
// CATALOG_GLSL appends VEG_GLSL, so the kernel contract is unchanged (inputs q, u, px, nearD, st, base,
// secondary, accent; outputs c, alpha and optionally h, relief, rgh).
//
// Art direction: silhouette first. Every card draws a species-readable outline with a few flat tones, a lit
// and a shaded side, and relief only where it reads (midribs, veins, bark plates). Foliage kernels are
// overdraw-heavy, so they use no cell searches: repeated domains (one nearest blade / pinna / needle per
// family) and small bounded loops with an early bounding-circle reject. Thin parts are thickened to about a
// pixel as they shrink (pu = card UV units per pixel) so distant cards keep a clean, non-sparkling edge.
//
// Seasons come from the recipe palette (texture-catalog.js); the kernels add leaf-to-leaf variation: when
// the palette has turned (red > green) each leaf picks late-green, gold or red and colours from the margin.

const G = String.raw;

// Colour literals below are linear (three.js uniforms are linear), i.e. sRGB values raised to 2.2.
export const VEG_GLSL = /* glsl */ G`
  float catVG_cov(float d,float e){ return clamp(.5-d/(2.*e),0.,1.); }
  float catVG_seg(vec2 p,vec2 a,vec2 b){ vec2 pa=p-a,ba=b-a; float t=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*t); }
  // x of a sprig's twig at card height y (card UV -1…1).
  float catVG_twig(float y,float s){ return .07*sin(y*1.6+s*.37)*(y+1.)*.5; }
  // Leaf i of n on a sprig card -> vec4(attach.xy, angle from +y, length). n = 1 is a single leaf on the card.
  vec4 catVG_slot(float i,float n,float s,float lmax,float l1,float spread){
    float hv=catH(vec2(i*3.7+1.,s));
    if(n<1.5) return vec4(0.,-.97,(hv-.5)*.06,l1);
    float last=step(n-.5,i+1.), t=mix(.12+.7*i/max(n-2.,1.),1.,last), y=-1.+t*.98;
    float side=mod(i+floor(s),2.)*2.-1.;
    float ang=mix(side*(spread+(hv-.5)*.3)*(1.-.3*t),(hv-.5)*.3,last);
    return vec4(catVG_twig(y,s),y,ang,lmax*mix(1.-.15*t,.95,last)*(.9+.2*hv));
  }
  // Simple-leaf outline (blade units: y 0 base … 1 tip). W half-width, sk moves the widest point (<1 lower),
  // ex roundness (.4 round … 1 lens), tip the acuminate taper, n/a and n2/a2 two ranks of forward teeth.
  float catVG_blade(vec2 p,float e,float W,float sk,float ex,float tip,float n,float a,float n2,float a2){
    float y=clamp(p.y,0.,1.), g=pow(y,sk);
    float w=min(W*pow(max(4.*g*(1.-g),0.),ex),tip*(1.-y));
    float teeth=a*fract(y*n)*(1.-smoothstep(.2,.6,e*n))+a2*fract(y*n2)*(1.-smoothstep(.2,.6,e*n2));
    w+=W*teeth*smoothstep(.05,.25,y)*smoothstep(1.,.85,y);
    return max(abs(p.x)-w,max(-p.y,p.y-1.));
  }
  // Midrib plus straight, forward-angled secondary veins (n pairs, slope k).
  float catVG_veins(vec2 p,float n,float k,float e){
    float mid=1.-smoothstep(.007,.014+e*2.5,abs(p.x));
    float dd=abs(fract((p.y-abs(p.x)*k)*n+.5)-.5)/n;
    float sec=(1.-smoothstep(.004,.009+e*2.5,dd))*smoothstep(.04,.12,p.y)*(1.-smoothstep(.15,.4,e*n));
    return max(mid,sec*.65);
  }
  vec4 catVG_leafOut(float d,float vein,float lift){ float m=1.-smoothstep(0.,.12,-d); return vec4(d,vein,m,.56+lift*smoothstep(0.,.1,-d)-.22*vein-.08*m); }
  // Sugar maple (sh 5): five pointed lobes (two small basal) with U sinuses and a big shoulder tooth on each
  // lobe. London plane (sh 6): broader, shorter lobes, shallow sinuses, a few coarse teeth.
  vec4 catVG_maple(vec2 p,float e,float hv,float sh){
    float pl=step(5.5,sh);
    vec2 v=p-vec2(0.,.3); float r=length(v), ta=abs(atan(v.x,v.y));
    float k1=step(mix(.5,.45,pl),ta), k2=step(mix(1.42,1.5,pl),ta);
    float ang=mix(mix(0.,mix(.98,.9,pl),k1),mix(1.88,1.85,pl),k2), len=mix(mix(.7,.6,k1),mix(.34,.3,pl),k2)*(.95+.1*hv), wid=mix(mix(.15,.14,k1),.085,k2)*mix(1.,1.45,pl);
    float phi=ta-ang; vec2 lf=r*vec2(sin(phi),cos(phi)); float s=lf.y/len;
    float w=wid*clamp((1.-s)*mix(2.4,1.7,pl),0.,1.)+wid*mix(.8,.3,pl)*max(0.,1.-abs(s-.58)/.13)+wid*.3*max(0.,1.-abs(s-.82)/.06)*(1.-k2);
    float d=min(max(abs(lf.x)-w,lf.y-len),r-mix(mix(.27,.08,smoothstep(2.2,3.1,ta)),mix(.4,.12,smoothstep(2.2,3.1,ta)),pl));
    float vein=(1.-smoothstep(.006,.014+e*2.5,abs(lf.x)))*step(0.,lf.y)*step(s,.92);
    return catVG_leafOut(d,vein,.14);
  }
  // White oak: obovate, rounded finger lobes angled forward, deep sinuses, rounded terminal lobe.
  vec4 catVG_oak(vec2 p,float e,float hv){
    float ax=abs(p.x);
    float body=max(ax-(.07+.09*sin(3.14*p.y))*smoothstep(-.1,.25,p.y),max(-p.y,p.y-.93));
    vec2 dir=normalize(vec2(1.,.62)); float s0=p.y-ax*.62;
    float k=clamp(floor((s0-.14)/.23+.5),0.,2.), yk=.14+k*.23+(hv-.5)*.03;
    float lk=mix(.17,.27,sin(3.14*(k+.7)/3.6))*(.92+.16*fract(hv*9.1+k*.37));
    vec2 a=vec2(0.,yk),b=a+dir*lk; vec2 pa=vec2(ax,p.y)-a; float t=clamp(dot(pa,dir)/lk,0.,1.);
    float lobe=length(pa-dir*lk*t)-(.07+.06*t);
    float tl=catVG_seg(p,vec2(0.,.76),vec2(0.,.9))-.1;
    float d=min(min(body,lobe),tl);
    float vein=max(1.-smoothstep(.007,.014+e,ax),(1.-smoothstep(.005,.011+e,length(pa-dir*lk*t)))*step(t,.85)*.7);
    return catVG_leafOut(d,vein*step(p.y,.9),.14);
  }
  // Beech (0), birch (1), aspen (2): simple leaves from one outline with species parameters.
  vec4 catVG_oval(vec2 p,float e,float hv,float sp){
    float d,v;
    if(sp<.5){ d=catVG_blade(p,e,.29,.95,.62,1.25,9.,.035,0.,0.); v=catVG_veins(p,9.,.85,e); }
    else if(sp<1.5){ d=catVG_blade(p,e,.33,.68,.55,.8,11.,.07,33.,.025); v=catVG_veins(p,8.,.75,e); }
    else if(sp>2.5){ vec2 p2=p*1.35; d=catVG_blade(p2,e*1.35,.4,.92,.45,1.4,5.5,.32,0.,0.)/1.35; v=catVG_veins(p2,5.,.7,e)*.4; }  // coast live oak: holly-like spines
    else { vec2 c=p-vec2(0.,.43); float a=atan(c.x,c.y), r=length(c);
      float R=.43+.13*pow(max(0.,cos(a)),24.)-.04*smoothstep(2.4,3.1,abs(a));
      R+=.012*abs(sin(a*14.))*(1.-smoothstep(.2,.6,e*14.)); d=r-R;
      v=max((1.-smoothstep(.007,.014+e,abs(p.x)))*step(p.y,.9),(1.-smoothstep(.005,.01+e,abs(fract(a*.95+.5)-.5)*r))*.5*step(.12,r)*step(abs(a),2.2)); }
    return catVG_leafOut(d,v,.12);
  }
  // Ginkgo: a fan on a long petiole, wavy outer edge, often a central notch, fine radiating veins.
  vec4 catVG_ginkgo(vec2 p,float e,float hv){
    vec2 v=p-vec2(0.,-.05); float r=length(v), th=atan(v.x,v.y);
    float R=.95-.06*abs(sin(th*7.+hv*5.))-.28*step(.45,hv)*exp(-th*th/.006)-.1*th*th;
    float d=max(r-R,(abs(th)-.92)*r*.8);
    d=max(d,-(r-.04));
    float vein=(1.-smoothstep(.15,.3+e*30.,abs(fract(th*24./1.84+.5)-.5)))*smoothstep(.1,.3,r)*.5*(1.-smoothstep(.3,.9,e*40.));
    return catVG_leafOut(d,vein,.1);
  }
  // Willow: long lanceolate blade, finely serrate, many shallow veins.
  vec4 catVG_willow(vec2 p,float e,float hv){ return catVG_leafOut(catVG_blade(p,e,.1,.88,.75,.5,30.,.05,0.,0.),catVG_veins(p,16.,1.8,e),.1); }
  // Seeded polar coordinates on a grass/flower card.
  float catVG_petal(float a,float n,out float id){ float f=a*n/6.2832; id=floor(f+.5); return (f-id)*6.2832/n; }
`;

// A sprig of n simple leaves (st.z) on a twig, or one hero leaf when n = 1. `shape` returns
// vec4(signed distance, vein, margin, relief h) in blade units.
const sprig = ({ shape, args = '', lmax, l1, spread = .95, pet = .14, curl = .25, post = '' }) => G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., aut=smoothstep(-.04,.12,base.r-base.g);
  float N=floor(st.z+.5), frost=fx.w;
  vec3 bark=mix(secondary,vec3(.093,.052,.026),.7);
  alpha=0.; c=bark; h=.5;
  if(N>1.5){ float tw=max(.024-.012*(u.y+1.),pu*.45); alpha=catVG_cov(abs(u.x-catVG_twig(u.y,sd))-tw,pu*.5)*step(u.y,-.01); }
  for(int i=0;i<9;i++){
    float fi=float(i); if(fi>=N) break;
    vec4 S=catVG_slot(fi,N,sd,${lmax},${l1},${spread});
    vec2 dl=u-S.xy; if(dot(dl,dl)>S.w*S.w*1.3) continue;
    float sa=sin(S.z),ca=cos(S.z),hv=catH(vec2(fi*7.1+2.,sd));
    vec2 lp=vec2(dl.x*ca-dl.y*sa,dl.x*sa+dl.y*ca)/S.w; lp.x-=(hv-.5)*${curl}*lp.y*lp.y;
    float e=pu/S.w*.7+.004, eb=e/(1.-${pet});
    vec2 bp=(lp-vec2(0.,${pet}))/(1.-${pet});
    vec4 L=${shape}(bp,eb,hv${args});
    float aB=catVG_cov(L.x,eb), aP=catVG_cov(max(abs(lp.x)-max(.014,e*.5),max(-lp.y,lp.y-${pet}-.3)),e);
    float a=max(aB,aP);
    c*=1.-.3*catVG_cov(L.x-.08,.06)*(1.-a)*alpha;                // contact shadow on what lies behind
    vec3 lc=mix(secondary,base,.55+.45*smoothstep(-.05,.6,bp.y))*(.9+.2*hv)*(1.+.06*sign(bp.x));
    lc=mix(lc,accent,L.y*.16);
    float v3=fract(hv*13.7+fi*.41);                                     // autumn: late-green, gold or red per leaf,
    vec3 hot=base*vec3(1.25,.55,.42), gold=base*vec3(1.1,1.1,.5), late=mix(base,vec3(.133,.218,.029),.72);
    vec3 turn=v3<.25?mix(late,gold,L.z*.8):v3<.62?mix(gold,hot,L.z*.35):mix(hot,hot*.8,L.z);
    lc=mix(lc,turn*(.92+.16*bp.y)*(1.+.05*sign(bp.x)),aut);    // colouring from the margin inwards
    lc=mix(lc,vec3(.681,.793,.852),frost*(.1+.8*L.z*L.z*L.z));              // rime on the margins
    c=mix(c,mix(secondary,bark,.35),aP); c=mix(c,lc,aB); alpha=max(alpha,a); h=mix(h,L.w,aB);
  }
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh=1.-fx.y*.45;
  ${post}
}`;


// Pine (st.w 0): a shoot with needle fascicles fanning forward around a twig, a brown terminal bud.
// Spruce (st.w 1) / subalpine fir (3, needles upturned, longer above the twig) / Monterey cypress (4, thick
// scale-leaf cords instead of needles): a flat spray, side branchlets in a triangle off a rachis.
// Larch (st.w 2): a twig with st.z spur shoots, each a rosette tuft of soft needles; it turns gold.
// Three needle families (fixed slopes) are evaluated with one nearest needle each: no loops over needles.
const needles = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97.;
  float nw=max(.011,pu*.42), aut=smoothstep(-.04,.12,base.r-base.g);
  vec3 bark=mix(secondary,vec3(.106,.052,.023),.75);
  alpha=0.; c=bark; h=.5;
  float nsh=floor(st.w+.5);
  if(nsh<.5){
    float tx=u.x-catVG_twig(u.y,sd)*.7, ax=abs(tx), side=sign(tx), y=u.y;
    alpha=catVG_cov(ax-max(.034-.012*(y+1.),pu*.5),pu*.5)*step(y,.52);
    float bud=length((vec2(tx,y-.55))/vec2(.045,.09))-1.;
    c=mix(c,mix(bark,accent,.35),catVG_cov(bud*.05,pu*.5)); alpha=max(alpha,catVG_cov(bud*.05,pu*.5));
    float sp=.62/st.z;
    for(int j=0;j<3;j++){
      float fj=float(j), k=mix(.42,2.3,fj*.5), sl=sqrt(1.+k*k);
      float off=catH(vec2(fj*3.1,side+sd))*sp, y0=y-ax*k+ax*ax*.35;
      float id=floor((y0-off)/sp+.5), yi=id*sp+off, hv=catH(vec2(id*1.3+fj*17.,side*5.+sd));
      float len=mix(.42,.68,hv)*(1.-.45*smoothstep(.15,.5,yi)), along=ax*sl/len;
      float w=nw*(1.-.55*along);
      float a=catVG_cov(abs(y0-yi)/sl-w,pu*.5)*step(along,1.)*step(-.62,yi)*step(yi,.5);
      vec3 nc=mix(secondary,base,smoothstep(0.,.7,along))*(.86+.28*hv)*(1.+.08*sign(y0-yi));
      nc=mix(nc,accent,smoothstep(.75,1.,along)*.35);
      c=mix(c,nc,a); alpha=max(alpha,a); h=mix(h,.5+.35*(1.-abs(y0-yi)/sl/w),a);
    }
  } else if(nsh<2.5&&nsh>1.5){
    float tx=u.x-catVG_twig(u.y,sd)*.8-.12*(u.y+1.)*.5;
    alpha=catVG_cov(abs(tx)-max(.02-.006*(u.y+1.),pu*.5),pu*.5)*step(u.y,.9);
    float N=floor(st.z+.5);
    for(int i=0;i<9;i++){
      float fi=float(i); if(fi>=N) break;
      float hv=catH(vec2(fi*2.3,sd)), t=(fi+.6)/N, ty=-.9+t*1.75, side=mod(fi,2.)*2.-1.;
      vec2 P=vec2(catVG_twig(ty,sd)*.8+.12*(ty+1.)*.5+side*.03,ty);
      float L=mix(.5,.32,t)*(.85+.3*hv), dir=side*mix(.8,.3,t)+(hv-.5)*.3;
      vec2 v=u-P; float r=length(v); if(r>L*1.05) continue;
      float th=atan(v.x,v.y)-dir, nN=15., fan=1.35;
      float f=th/fan*nN*.5, id=floor(f+.5), hn=catH(vec2(id+fi*17.,sd));
      float dth=th-(id+(hn-.5)*.5)*2.*fan/nN, Li=L*(.65+.35*hn)*(1.-.3*abs(id)/(nN*.5));
      float a=catVG_cov(abs(r*sin(dth))-nw*(1.-.5*r/Li),pu*.5)*step(r,Li)*step(abs(id),nN*.5);
      vec3 nc=mix(secondary,base,smoothstep(0.,.8,r/Li))*(.88+.24*hn);
      nc=mix(nc,accent,smoothstep(.7,1.,r/Li)*.3);
      float knob=catVG_cov(r-.024,pu*.5);
      c=mix(c,nc,a); c=mix(c,bark*1.15,knob); alpha=max(alpha,max(a,knob)); h=mix(h,.65,a);
    }
  } else {
    float fir=step(2.5,nsh)*step(nsh,3.5), cyp=step(3.5,nsh);
    float x=u.x-catVG_twig(u.y,sd)*.5, ax=abs(x), side=sign(x), y=u.y;
    float ln=mix(mix(.085,.1,fir),.13,cyp), kn=mix(mix(.9,.55,fir),.75,cyp), sn=sqrt(1.+kn*kn), spn=mix(mix(.034,.03,fir),.075,cyp);
    nw=max(mix(.011,.024,cyp),pu*.42);
    // rachis and its needles
    alpha=catVG_cov(ax-max(.022-.008*(y+1.),pu*.5),pu*.5)*step(y,.96);
    float s0=y-ax*kn, jn=floor(s0/spn+.5), hn=catH(vec2(jn,side+sd)), al=ax*sn/(ln*(.75+.5*hn));
    float an=catVG_cov(abs(s0-jn*spn)/sn-nw*(1.-.5*al),pu*.5)*step(al,1.)*step(y,.98);
    c=mix(c,mix(secondary,base,al)*(.85+.3*hn),an); alpha=max(alpha,an);
    // branchlets: slope kb, alternate sides, shorter toward the tip
    float kb=.8, sb=sqrt(1.+kb*kb), spb=1.9/st.z, offb=side>0.?0.:spb*.5;
    float y0=y-ax*kb, ib=floor((y0-offb)/spb+.5), yb=ib*spb+offb, hb=catH(vec2(ib,side*3.+sd));
    float Lb=.82*pow(clamp((.92-yb)/1.75,0.,1.),.75)*(.85+.3*hb)*step(-.95,yb);
    float t=(y0-yb)/sb, s=(ax+(y-yb)*kb)/sb, at=abs(t);
    float stem=catVG_cov(at-max(mix(.011,.026*(1.+.2*sin(s*70.)*nearD),cyp),pu*.45),pu*.5)*step(0.,s)*step(s,Lb);
    float b0=s-at*kn, jb=floor(b0/spn+.5), hj=catH(vec2(jb+ib*13.,sign(t)+sd));
    float ab=at*sn/(ln*(.7+.5*hj)*(1.-.4*s/max(Lb,.01))*(t<0.?1.-.45*fir:1.));
    float bump=1.+cyp*(.25*sin(ab*28.+hj*6.)*nearD-.1);
    float nb=catVG_cov(abs(b0-jb*spn)/sn-nw*(1.-mix(.5,.15,cyp)*ab)*bump,pu*.5)*step(ab,1.)*step(0.,jb*spn)*step(jb*spn,Lb);
    c=mix(c,mix(bark*1.1,mix(secondary,base,.6),cyp),stem); alpha=max(alpha,stem);
    vec3 nc=mix(secondary,base,smoothstep(0.,.8,ab))*(.86+.28*hj);
    nc=mix(nc,accent,smoothstep(.2,0.,Lb-s)*.3);                   // pale new growth at the branch tips
    c=mix(c,nc,nb); alpha=max(alpha,nb); h=mix(h,.5+.3*(1.-ab),max(nb,an));
  }
  // far away the needles merge: fill the spray's envelope so it reads as one mass instead of sparkling
  float lod=smoothstep(.02,.07,pu);
  vec2 ev=nsh<.5?(u-vec2(0.,.12))/vec2(.5,.72):nsh<2.5&&nsh>1.5?(u-vec2(.06,0.))/vec2(.45,.9):vec2(u.x/max(.7*pow(clamp((.95-u.y)/1.9,0.,1.),.75),.01),0.);
  float env=nsh<2.5&&abs(nsh-1.)>.5?catVG_cov(length(ev)-1.,pu*1.5+.02)*(nsh>1.5?.6:1.):catVG_cov(abs(ev.x)-1.,.15)*step(u.y,.95)*step(-.9,u.y);
  float fill=env*lod*(1.-alpha)*.85; c=mix(c,mix(secondary,base,.55),fill); alpha=max(alpha,fill);
  c=mix(c,vec3(.699,.793,.852),fx.w*.35);
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh=1.-fx.y*.45;
}`;

// Pinnate fronds. Fern (st.w 0): lanceolate outline, alternate pinnae with scalloped pinnules.
// Palm (st.w 1): an arching rachis with long, narrow, drooping leaflets. One pinna per side is evaluated.
// Honey locust (st.w 2): a compound leaf of small oval leaflets in opposite pairs on a thin rachis.
const frond = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., loc=step(1.5,st.w), palm=step(.5,st.w)*(1.-loc);
  float y01=(u.y+1.)*.5;
  float bend=mix(.12,.5,palm)*(catH(vec2(sd,3.))-.35);
  float x=u.x-bend*y01*y01-mix(0.,-.25,palm)*(1.-y01), ax=abs(x), side=sign(x);
  float k=mix(mix(.55,.35,palm),.15,loc), droop=mix(mix(.1,.9,palm),0.,loc), sl=sqrt(1.+k*k);
  float sp=2.1/st.z, off=side>0.||loc>.5?0.:sp*.5;
  float y0=u.y-ax*k+ax*ax*droop, id=floor((y0-off)/sp+.5), yi=id*sp+off, t01=(yi+1.)*.5;
  float hv=catH(vec2(id,side+sd));
  float reach=st.x*mix(pow(max(sin(3.1416*pow(clamp(t01,0.,1.),.7)),0.),.8),smoothstep(0.,.1,t01)*(1.-pow(clamp(t01,0.,1.),3.)),palm)*(.92+.16*hv);
  reach=mix(reach,st.x*smoothstep(-.05,.08,t01)*(1.-.4*t01)*(.9+.2*hv),loc);
  float s=ax*sl/max(reach,.01), dt=(y0-yi)/sl;
  float wp=mix(.5*sp*pow(max(sin(3.1416*pow(clamp(s,0.,1.),.6)),0.),.7)*(.62+.38*pow(abs(sin(s*reach*42.)),.5)),
               .036*pow(max(1.-s,0.),.5)*smoothstep(0.,.06,s),palm);
  wp=mix(wp,.4*sp*sqrt(max(1.-pow(2.*s-1.,2.),0.)),loc);
  float a=catVG_cov(abs(dt)-max(wp,pu*.4),pu*.5)*step(s,1.)*step(-1.,yi)*step(yi,.97);
  float rach=catVG_cov(ax-max(mix(.018,.03,palm)*(1.-.6*y01),pu*.45),pu*.5)*step(u.y,.97);
  vec3 rc=mix(secondary,vec3(.133,.106,.029),.4);
  vec3 pc=mix(secondary,base,smoothstep(0.,.8,s))*(.88+.24*hv)*(1.+.1*sign(dt));
  pc=mix(pc,accent,(1.-smoothstep(.003,.008+pu,abs(dt)))*.3*nearD);
  float aut=smoothstep(-.04,.12,base.r-base.g); pc=mix(pc,pc*vec3(1.1,.9,.6),aut*smoothstep(.4,1.,s+hv*.3));
  c=mix(rc,pc,a); alpha=max(a,rach); h=.5+.3*a*(1.-abs(dt)/max(wp,.001));
  c=mix(c,vec3(.699,.793,.852),fx.w*.5*smoothstep(.5,1.,s));
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh=1.-fx.y*.45;
}`;


// Grass clumps: blades fan out from a narrow base with varied height, width, lean and arch. Two layers of
// blades cross; each layer evaluates only the nearest blade and one neighbour. st.w adds the species detail:
// 0 lawn/fine, 1 meadow seed spikes, 2 airy hairgrass panicles, 3 reed blades + cattail catkin,
// 4 arching sedge with dark spikelets, 5 alpine meadow (short sward with tiny flowers of mixed colour),
// 6 ice plant (fat, blunt, red-tipped succulent fingers and a magenta flower). st.y > .2 scales the height
// (short lawns). Finish "cut" (density < .9) mows it short with no heads.
const grass = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., y=(u.y+1.)*.5, sh=floor(st.w+.5);
  float cut=step(catDensity,.9), Hm=mix(.94,.42,cut)*(st.y>.2?st.y:1.), W=(.012+st.x*.05)*(sh>5.5?1.6:1.);
  float n=max(4.,st.z*1.5*mix(catDensity,1.6,cut)), bw=sh>2.5&&sh<4.5?.3:.42, arc=sh>5.5?2.6:sh>4.5?.8:sh>3.5?2.2:sh>2.5?1.3:1.;
  float dry=smoothstep(-.1,.06,base.r-base.g);
  alpha=0.; c=secondary*.5; h=.5;
  for(int l=0;l<2;l++){
    float fl=float(l), fan=mix(.7,1.5,fl)*(sh>3.5?1.4:1.), sp=4.*bw/n, off=(fl*.5+fract(sd))*sp;
    float x0=u.x/(1.+fan*y), r0=(x0-off)/sp, i0=floor(r0+.5), sg=r0>i0?1.:-1.;
    for(int k=0;k<2;k++){
      float id=i0+float(k)*sg, xb0=id*sp+off;
      float hv=catH(vec2(id*1.7+fl*31.,sd)), hv2=fract(hv*7.13+.3);
      float H=Hm*(.4+.6*hv)*(1.-.45*pow(min(abs(xb0)/bw,1.),2.))*step(abs(xb0),bw), tt=y/max(H,.001);
      float arch=(.05+.22*hv2)*(xb0<0.?-1.:1.)*arc*(1.-.6*cut);
      float xb=xb0*(1.+fan*y)+arch*H*tt*tt, w=W*(.6+.8*hv2)*pow(max(1.-tt,0.),sh>5.5?.22:.65);
      float a=catVG_cov(abs(u.x-xb)-max(w,pu*.45),pu*.5)*step(tt,1.)*step(abs(xb0),bw)*step(.004,y);
      vec3 bc=mix(secondary,base,smoothstep(0.,.7,tt))*(.84+.32*hv);
      bc=mix(bc,accent,sh>5.5?smoothstep(.72,1.,tt)*.65:smoothstep(.5,1.,tt)*(.2+.6*dry*hv2));
      bc*=1.+.08*sign((u.x-xb)*arch);                               // folded blade: lit half and shaded half
      c=mix(c,bc,a); alpha=max(alpha,a); h=mix(h,.5+.3*(1.-abs(u.x-xb)/max(w,.002)),a);
    }
  }
  if(sh>.5&&cut<.5){
    for(int j=0;j<3;j++){
      float fj=float(j), hv=catH(vec2(fj*5.3+2.,sd)); if((sh>2.5&&sh<4.5||sh>5.5)&&fj>1.) break;
      float top=mix(.82,.99,hv)*(sh>4.5?min(Hm*1.3,.95):1.), xs0=(hv-.5)*bw*1.3, lean=(fract(hv*3.7)-.5)*.3;
      float xs=xs0*(1.+.5*y)+lean*y*y, ds=abs(u.x-xs);
      float stem=catVG_cov(ds-max(sh>2.5?.011:.0045,pu*.4),pu*.5)*step(y,top);
      vec3 hc=accent; float head=0.;
      if(sh<1.5){                                          // timothy-like spike
        float hy=(y-top+.2)/.2; head=catVG_cov(ds-.026*(1.-.5*hy*hy)*(.85+.15*sin(y*170.)*nearD),pu*.5)*step(0.,hy)*step(hy,1.);
        hc=mix(accent,secondary,.25)*(.9+.15*sin(y*170.+u.x*90.));
      } else if(sh<2.5){                                   // airy panicle: a haze of tiny spikelets
        vec2 v=(u-vec2(xs0*1.5+lean*1.3,top*2.-1.-.3))/vec2(.17+.08*(top*2.-1.-u.y),.34); float env=1.-dot(v,v)-.4*catN(u*9.+fj);
        vec2 g=u*vec2(40.,30.)+fj*7.; float hd=catH(floor(g)+sd); vec2 f=fract(g)-.5-(vec2(hd,fract(hd*7.1))-.5)*.5;
        float dot1=catVG_cov(length(f*vec2(1.3,.6))-.18-.1*hd,max(pu*20.,.05))*step(.3,hd);
        head=smoothstep(0.,.15,env)*mix(dot1,.5,smoothstep(.02,.06,pu)); hc=mix(accent,vec3(.531,.428,.325),.3)*(.85+.3*hd); stem*=.6;
      } else if(sh<3.5){                                   // cattail: brown velvet catkin and a thin spike
        float hy=(y-top+.36)/.2; head=catVG_cov(ds-.042*sqrt(max(1.-pow(hy*2.-1.,8.),0.)),pu*.5)*step(0.,hy)*step(hy,1.);
        hc=vec3(.052,.018,.005)*(.8+.4*(1.-ds/.042))*(.95+.1*sin(y*90.));
      } else if(sh<4.5){                                   // sedge: three dark spikelets
        float hy=(y-top+.16)/.16, f=fract(hy*3.); vec2 v=vec2(ds-.01*sin(hy*9.),(f-.5)*.16/3.)/vec2(.022,.03);
        head=catVG_cov(length(v)-1.,max(pu*20.,.06))*step(0.,hy)*step(hy,1.); hc=mix(vec3(.043,.029,.011),accent,.25);
      } else {                                             // meadow flowers / ice-plant flower: small rayed heads
        vec2 v=vec2(u.x-xs,(y-top)*2.); float rf=length(v), af=atan(v.y,v.x), ice=step(5.5,sh);
        float R=mix(.065,.13,ice)*(.85+.3*hv), petals=R*(.75+.25*abs(cos(af*mix(2.5,11.,ice))));
        head=catVG_cov(rf-petals,pu*.5+.004);
        float pick=fract(hv*5.7+fj*.37);
        hc=ice>.5?vec3(.68,.07,.36):pick<.33?vec3(.79,.52,.03):pick<.66?vec3(.1,.17,.62):vec3(.9,.87,.8);
        hc=mix(hc,ice>.5?vec3(.9,.8,.3):vec3(.6,.4,.05),1.-smoothstep(.2*R,.35*R,rf));
        stem*=1.-ice*.5;
      }
      c=mix(c,mix(secondary,accent,.4),stem); c=mix(c,hc,head); alpha=max(alpha,max(stem,head));
    }
  }
  c*=.62+.38*smoothstep(0.,.32,y);                          // ground contact darkening
  c=mix(c,vec3(.699,.793,.852),fx.w*smoothstep(.2,.9,y)*.9);
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh=1.-fx.y*.45;
}`;

// White clover: trifoliate leaves of heart-shaped leaflets with the pale chevron, on petioles, plus a
// round white flower head (st.w 0). Leaflets come from a 120° polar fold: one leaflet test per leaf.
const clover = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., N=floor(st.z+.5);
  alpha=0.; c=secondary; h=.5;
  vec3 stalk=mix(secondary,accent,.3);
  if(st.w<.5){                                             // flower head on its own stalk, behind the leaves
    vec2 fc=vec2(.42,.5); float sa=catVG_cov(catVG_seg(u,vec2(.18,-1.),fc)-max(.016,pu*.4),pu*.5);
    vec2 v=u-fc; float r=length(v), a=atan(v.x,v.y), R=.28*(1.+.05*cos(a*16.)*nearD);
    float fa=catVG_cov(r-R,pu*.5+.004);
    vec3 fcol=mix(vec3(.893,.852,.718),vec3(.579,.349,.302),smoothstep(-.05,-.28,v.y)*.8);
    vec2 fg=vec2(a*2.6,r*22.); vec2 ff=fract(fg)-.5; fcol*=.8+.2*smoothstep(.45,.15,length(ff))*nearD+.1*(1.-r/R);
    c=mix(c,stalk,sa); c=mix(c,fcol,fa); alpha=max(sa,fa); h=mix(.5,.4+.4*(1.-r/R),fa);
  }
  for(int i=0;i<4;i++){
    float fi=float(i); if(fi>=N) break;
    float hv=catH(vec2(fi*3.3,sd));
    vec2 C=fi<.5?vec2(-.2,.2):fi<1.5?vec2(.32,-.22):fi<2.5?vec2(-.38,-.5):vec2(.1,-.62);
    C+=(vec2(hv,fract(hv*5.3))-.5)*.12; float R=(fi<.5?.5:.38)*(.9+.2*hv);
    float sa=catVG_cov(catVG_seg(u,vec2(C.x*.3,-1.),C)-max(.016,pu*.4),pu*.5);
    c=mix(c,stalk,sa); alpha=max(alpha,sa);
    vec2 v=(u-C)/R; if(dot(v,v)>1.1) continue;
    float rot=hv*6.28, cr=cos(rot), sr=sin(rot); v=vec2(v.x*cr-v.y*sr,v.x*sr+v.y*cr);
    float th=atan(v.x,v.y), lid=floor(th/2.0944+.5), tf=th-lid*2.0944; vec2 p=length(v)*vec2(sin(tf),cos(tf));
    float e=pu/R*.7+.004, ax=abs(p.x);
    float d=min(length(vec2(ax-.2,p.y-.6))-.3,max((ax-.5*p.y)*.9,p.y-.7));
    float a=catVG_cov(d,e);
    c*=1.-.3*catVG_cov(d-.07,.05)*(1.-a)*alpha;
    float chev=(1.-smoothstep(.015,.04+e,abs(p.y-ax*.8-.36)))*smoothstep(.1,.25,p.y)*smoothstep(.0,.06,-d);
    float vein=1.-smoothstep(.008,.016+e,ax);
    vec3 lc=mix(secondary,base,.6+.4*smoothstep(0.,.8,p.y))*(.9+.16*fract(hv*7.+lid*.31))*(1.+.07*sign(p.x));
    lc=mix(lc,mix(base,vec3(.612,.718,.485),.5),chev*.55); lc=mix(lc,accent,vein*.2);
    lc=mix(lc,vec3(.699,.793,.852),fx.w*(1.-smoothstep(0.,.1,-d))*.8);
    c=mix(c,lc,a); alpha=max(alpha,a); h=mix(h,.55+.12*smoothstep(0.,.1,-d)-.2*vein,a);
  }
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh=1.-fx.y*.45;
}`;


// Flower heads, face-on, centred in the upper card with a stem below. The bloom radius is R; petals are
// counted by st.z. Two petal rings (front, and a darker one behind offset by half a petal) keep it full.
// flower-radial st.w: 0 daisy (white rays, domed yellow disc), 1 cornflower (frilled funnel florets,
// dark centre), 2 sunflower (pointed rays, seed spiral disc), 3 edelweiss (felted, pointed bracts of uneven
// length around a cluster of small woolly heads), 4 arnica (sparse ragged three-toothed orange-yellow rays).
const flowerHead = (body) => G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., sh=floor(st.w+.5);
  vec2 C=vec2(0.,.2); float R=.74;
  alpha=catVG_cov(abs(u.x-.03*(u.y+1.))-max(.026,pu*.45),pu*.5)*step(u.y,C.y);
  vec3 stemC=mix(secondary,vec3(.071,.148,.029),.75); c=stemC; h=.5;
  float lf=catVG_cov(length((u-vec2(.16,-.62))*mat2(.8,-.6,.6,.8)/vec2(.07,.22))-1.,max(pu*4.,.08));
  c=mix(c,stemC*1.1,lf); alpha=max(alpha,lf);
  vec2 v=(u-C)/R; float r=length(v), a=atan(v.y,v.x)+sd, e=pu/R*.7+.004;
  ${body}
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh*=1.-fx.y*.45;
}`;
const radial = flowerHead(G`
  float n=st.z, rd=sh<.5?.25:sh<1.5?.2:sh<2.5?.46:sh<3.5?.27:.26;
  float pid, phi=catVG_petal(a,n,pid), hv=catH(vec2(pid,sd));
  if(sh>2.5) phi+=(hv-.5)*.5*6.283/n;                                        // irregular spacing
  float Lp=sh>3.5?.92*(.85+.15*hv):sh>2.5?.6+.38*hv:(sh>1.5?.98:.95)*(.88+.12*hv), along=r*cos(phi), acr=r*sin(phi), t=clamp((along-rd*.7)/(Lp-rd*.7),0.,1.);
  float wp=sh>3.5?6.283/n*.27*(.55+.45*sqrt(t)):sh>2.5?6.283/n*.3*pow(max(sin(3.1416*pow(t,.5)),0.),1.1):sh<.5?.3*6.283/n*(.45+.55*pow(sin(3.1416*min(t*.55+.45,1.)),.5))*mix(.6,1.,t):sh<1.5?6.283/n*(.12+.42*t):6.283/n*.5*pow(max(sin(3.1416*pow(t,.75)),0.),.8);
  float tipT=sh>.5&&sh<1.5?Lp*(1.-.16*abs(sin(acr/max(wp,.01)*4.7))):sh>3.5?Lp*(1.-.09*abs(sin(acr/max(wp,.01)*4.7))):Lp;
  float d=max(abs(acr)-wp,along-tipT);
  if(sh>2.5&&sh<3.5) d+=.016*(catN(vec2(a*30.,r*25.))-.5)*nearD;           // woolly edge
  float pid2, phi2=catVG_petal(a+3.1416/n,n,pid2), hv2=catH(vec2(pid2+40.,sd));
  float d2=max(abs(r*sin(phi2))-wp*1.05,r*cos(phi2)-Lp*(.86+.1*hv2));
  float a1=catVG_cov(d,e), a2=catVG_cov(d2,e)*(sh>3.5?0.:1.);
  vec3 pc=mix(base*(sh<.5?.88:.8),base,smoothstep(rd,rd+.25,r))*(.92+.14*hv);
  pc=mix(pc,accent,(1.-smoothstep(0.,.25*wp+e,abs(acr)))*.25*t);          // petal groove / midline
  if(sh>.5&&sh<1.5) pc=mix(pc,secondary,(1.-smoothstep(.3,.6,t))*.6);   // cornflower: dark florets inward
  if(sh>2.5&&sh<3.5) pc=mix(base,secondary,smoothstep(.55,1.,t)*.55)*(.9+.18*catN(vec2(a*20.,r*18.)));  // felt, green tips
  c=mix(c,pc*.78,a2); c=mix(c,pc,a1); alpha=max(alpha,max(a1,a2));
  c*=1.-.25*catVG_cov(d-.05,.04)*(1.-a1)*a2;
  float dk=catVG_cov(r-rd,e), ln=log(max(r,.01));
  if(sh>2.5&&sh<3.5){ float cid, cph=catVG_petal(a,6.,cid); vec2 cl=r*vec2(cos(cph),sin(cph))-vec2(.16,0.);
    dk=catVG_cov(min(length(cl)-.08,r-.085)+.01*(catN(vec2(a*40.,r*40.))-.5),e); }
  float spiral=sh>1.5?smoothstep(.2,.8,cos(21.*a-28.*ln)*cos(34.*a+28.*ln)+.4):smoothstep(.1,.7,cos(a*13.+r*70.)*cos(r*90.-a*8.)+.3);
  vec3 dc=mix(secondary*.7,secondary*1.15,spiral*nearD+.5*(1.-nearD));
  dc=mix(dc,sh>1.5?accent:secondary*1.25,smoothstep(rd*.75,rd,r)*.6);    // ring of opening florets
  if(sh>2.5&&sh<3.5) dc=mix(accent,base,.35)*(.75+.35*spiral);
  dc*=.8+.25*(1.-r/rd);
  c=mix(c,dc,dk); alpha=max(alpha,dk);
  h=mix(.5,.5+.2*t,a1); h=mix(h,.35+.45*(1.-r/rd)-.15*spiral,dk); rgh=1.;
`);
// flower-cup st.w: 0 poppy (crinkled red petals, black basal blotch, capsule and dark stamens),
// 1 buttercup (glossy cupped yellow petals), 2 wild rose (notched pink petals, pale eye, gold stamens),
// 3 California poppy (four satin orange petals, deeper at the base, a small yellow-green centre).
const cup = flowerHead(G`
  float n=st.z; float pid, phi=catVG_petal(a,n,pid), pidB, phiB=catVG_petal(a-3.1416/n,n,pidB);
  float hv=catH(vec2(pid,sd)), hb=catH(vec2(pidB,sd));
  // nearest petal (a) and the next one round (b); a round petal is a disc pushed out from the centre
  float rk=sh<.5?.6:sh<1.5?.5:sh<2.5?.55:.58, off=sh<.5?.38:sh<1.5?.48:sh<2.5?.42:.4;
  vec2 pa=r*vec2(cos(phi),sin(phi))-vec2(off,0.), pb=r*vec2(cos(phiB+3.1416/n),sin(phiB+3.1416/n))-vec2(off,0.);
  float crA=sh<.5?.035*sin(atan(pa.y,pa.x)*7.+hv*6.):sh>2.5?.015*sin(atan(pa.y,pa.x)*5.):sh>1.5?-.14*(1.-smoothstep(0.,.25,abs(atan(pa.y,pa.x))))*step(0.,pa.x):0.;
  float crB=sh<.5?.035*sin(atan(pb.y,pb.x)*7.+hb*6.):sh>2.5?.015*sin(atan(pb.y,pb.x)*5.):sh>1.5?-.14*(1.-smoothstep(0.,.25,abs(atan(pb.y,pb.x))))*step(0.,pb.x):0.;
  float dA=length(pa)-rk*(.92+.1*hv)-crA, dB=length(pb)-rk*(.92+.1*hb)-crB;
  float top=mod(pid,2.)<.5?1.:0.;                 // alternate petals overlap their neighbours
  float aA=catVG_cov(dA,e), aB=catVG_cov(dB,e);
  vec3 pc=mix(base*.85,mix(base,accent,.35),smoothstep(.3,.95,r))*(.94+.1*hv);
  if(sh>2.5) pc=mix(mix(secondary,base,smoothstep(.08,.45,r)),accent,smoothstep(.55,1.,r)*.45)*(.94+.1*hv);
  pc*=.95+.05*cos(atan(pa.y,pa.x)*14.)*nearD;                            // fine radial veining
  vec3 pcB=pc*.86;
  float under=top>.5?aB*(1.-aA):aB; float over=top>.5?aA:aA*(1.-aB);
  c=mix(c,pcB,under); c=mix(c,pc,over); c=mix(c,pc,aA*aB*top); c=mix(c,pcB,aA*aB*(1.-top));
  float aP=max(aA,aB); alpha=max(alpha,aP);
  c*=1.-.3*catVG_cov(max(dA,-dB)-.0,.06)*aB*(1.-top)*0.;
  if(sh<.5){ c=mix(c,secondary,(1.-smoothstep(.2,.3+.03*sin(a*12.),r))*aP);                  // basal blotch
    float st1=(1.-smoothstep(.11,.13,r)); vec3 cap=mix(vec3(.148,.181,.071),vec3(.013,.006,.009),smoothstep(.6,.95,abs(cos(a*4.5))));
    float stam=step(.11,r)*(1.-smoothstep(.17,.2,r))*smoothstep(.2,.7,sin(a*36.)*.5+.5);
    c=mix(c,vec3(.004,.003,.005),stam); c=mix(c,cap,st1); h=mix(.5,.7,st1); }
  else if(sh<1.5){ float gl=smoothstep(.1,.0,length((pa-vec2(-.1,.08))*vec2(1.,2.2)))*aA;   // gloss crescent
    c=mix(c,vec3(1.,.935,.646),gl*.3); rgh=.45;
    float ctr=1.-smoothstep(.13,.16,r), stam=step(.1,r)*(1.-smoothstep(.17,.2,r))*smoothstep(.3,.8,sin(a*30.)*.5+.5);
    c=mix(c,accent*1.05,stam); c=mix(c,mix(vec3(.268,.325,.047),accent,.4),ctr); h=mix(.5,.7,ctr); }
  else if(sh>2.5){ c*=1.+.12*smoothstep(.5,1.,cos(atan(pa.y,pa.x)*3.+r*6.))*aP;  rgh=.6;              // satin sheen
    float ctr=1.-smoothstep(.09,.11,r), stam=step(.09,r)*(1.-smoothstep(.15,.18,r))*smoothstep(.3,.8,sin(a*26.)*.5+.5);
    c=mix(c,accent*1.1,stam); c=mix(c,vec3(.27,.33,.06),ctr); }
  else { c=mix(c,vec3(.935,.873,.793),(1.-smoothstep(.15,.42,r))*.85*aP);                         // pale eye
    float ring=step(.09,r)*(1.-smoothstep(.22,.26,r)); float dots=smoothstep(.45,.8,sin(a*44.)*sin(r*120.));
    c=mix(c,mix(secondary,vec3(.793,.485,.029),.4)*(.8+.3*dots),ring*(.5+.5*dots)); c=mix(c,vec3(.456,.428,.099),1.-smoothstep(.08,.1,r)); }
  h=mix(.5,.45+.25*smoothstep(.1,.6,r),aP);
`);


// Upright racemes. st.w: 0 lavender (three stems, interrupted whorls of tiny florets), 1 lupine (one dense
// conical spike of two-tone pea flowers over a palmate leaf), 2 fireweed (open four-petal flowers low,
// nodding buds high, narrow leaves). Rows of florets are repeated domains: one row (two florets) per pixel.
const spike = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., sh=floor(st.w+.5), y=u.y;
  alpha=0.; c=secondary; h=.5; float e=pu*.5+.003;
  vec3 stemC=mix(vec3(.082,.148,.043),secondary,.35);
  if(sh<.5){
    for(int j=0;j<3;j++){
      float fj=float(j), hv=catH(vec2(fj*4.1,sd)), lean=(fj-1.)*.22+(hv-.5)*.1, top=.92-.12*abs(fj-1.)-.08*hv;
      float x=u.x-lean*(y+1.)*.5*(1.+.3*(y+1.)), ax=abs(x);
      float sa=catVG_cov(ax-max(.012,pu*.45),pu*.5)*step(y,top);
      c=mix(c,stemC,sa); alpha=max(alpha,sa);
      float y0=top-.62, yy=(y-y0)/(top-y0); if(yy<0.||yy>1.04) continue;
      float rows=st.z*1.1, f=yy*rows, row=floor(f), fr=fract(f)-.5;
      float gap=step(row,1.5)*(.35-abs(fr))*0.;       // lowest whorls stand apart
      float wq=st.x*.17*(1.-.55*yy)*(row<2.?.8:1.), off=mod(row,2.)*.5-.25;
      float fl1=length(vec2((ax-wq*.5)/wq,fr/.42))-1., fl2=length(vec2(x/wq*1.4+off,fr/.5))-1.;
      float squeeze=row<2.?.7:1.;
      float a=catVG_cov(min(fl1,fl2)*wq*squeeze,e)*step(yy,1.)+catVG_cov(length(vec2(x,(yy-1.)*.62*1.2))-wq*.6,e);
      a=min(a,1.);
      vec3 fc=mix(base*.75,base*1.08,smoothstep(-.4,.4,fr))*(1.-.18*step(row,1.5));
      fc=mix(fc,secondary*.8,(1.-smoothstep(-.6,-.1,min(fl1,fl2)))*0.)*(.9+.2*catH(vec2(row,fj+sd)));
      fc=mix(fc,accent,smoothstep(.2,0.,abs(fl2+.3))*.25);
      c=mix(c,fc,a); alpha=max(alpha,a); h=mix(h,.65,a);
    }
  } else if(sh<1.5){
    // palmate leaf at the foot of the spike: 7 narrow leaflets
    vec2 lv=u-vec2(.05,-.62); float lr=length(lv), la=atan(lv.x,lv.y), lid, lphi=catVG_petal(la+.45,7.,lid);
    float lfd=max(abs(lr*sin(lphi))-.07*sin(3.1416*min(lr/.36,1.)),lr-.36*(.85+.15*cos(lid)));
    float lfa=catVG_cov(lfd,e)*step(-.25,lv.y+.25);
    vec3 lc=mix(vec3(.071,.148,.047),vec3(.148,.237,.082),step(0.,lr*sin(lphi)))*(.9+.1*cos(lid*2.));
    float sa=catVG_cov(abs(u.x-.04*y)-max(.02,pu*.45),pu*.5)*step(y,.95)*step(-.62,y);
    c=mix(c,lc,lfa); c=mix(c,stemC,sa); alpha=max(lfa,sa);
    float x=u.x-.04*y, ax=abs(x), y0=-.45, top=.96, yy=(y-y0)/(top-y0);
    if(yy>0.&&yy<1.05){
      float rows=st.z*1.4, f=yy*rows, row=floor(f), fr=fract(f)-.5, wq=st.x*.33*(1.-.62*yy);
      float bud=smoothstep(.72,.95,yy);
      float o1=length(vec2((ax-wq*.55)/(wq*.55),fr/.6))-1., o2=length(vec2(x/(wq*.5),(fr-.5)/.6))-1.;
      vec2 fq=vec2(ax-wq*.55,fr); float o=min(o1,o2)*wq*.5;
      float a=catVG_cov(o,e)*step(yy,1.)+catVG_cov(length(vec2(x,(yy-1.)*(top-y0)))-wq*.5,e);
      a=min(a,1.);
      vec3 fc=mix(base,base*.72,smoothstep(.1,-.4,o1<o2?fr:fr-.5));
      fc=mix(fc,mix(accent,vec3(.914,.893,.935),.55),smoothstep(.05,.35,o1<o2?fr:fr-.5)*(1.-bud));   // pale banner petal
      fc=mix(fc,mix(base,vec3(.173,.218,.071),.45),bud)*(.92+.16*catH(vec2(row,sd)));
      c=mix(c,fc,a); alpha=max(alpha,a); h=mix(h,.5+.25*(1.-abs(fr)*2.),a);
    }
  } else {
    float x=u.x-.03*y-.06*y*y, ax=abs(x);
    float sa=catVG_cov(ax-max(.017,pu*.45),pu*.5)*step(y,.97);
    vec3 stemR=mix(stemC,vec3(.268,.047,.071),.45); c=stemR; alpha=sa;
    // narrow leaves on the lower stem
    float ly=y+ax*.9, lid=floor(ly/.2+.5), ld=abs(ly-lid*.2)-.035*sin(3.1416*min(ax/.42,1.))*step(ax,.42);
    float lfa=catVG_cov(ld,e)*step(ly,-.15)*step(-.9,ly)*step(.012,ax);
    c=mix(c,vec3(.061,.133,.036)*(1.+.1*sign(ly-lid*.2)),lfa); alpha=max(alpha,lfa);
    float N=st.z;
    for(int k=0;k<12;k++){
      float fk=float(k); if(fk>=N) break;
      float tt=fk/(N-1.), hv=catH(vec2(fk,sd)), side=mod(fk,2.)*2.-1.;
      float fy=mix(-.25,.9,tt), fxc=.03*fy+.06*fy*fy+side*mix(.2,.05,tt);
      vec2 v=u-vec2(fxc,fy); float R=mix(.17,.06,tt)*(.9+.2*hv); if(dot(v,v)>R*R*1.6) continue;
      float open=1.-smoothstep(.55,.72,tt);
      float ped=catVG_cov(catVG_seg(u,vec2(.03*fy+.06*fy*fy,fy-.06),vec2(fxc,fy))-max(.008,pu*.4),pu*.5);
      c=mix(c,stemR,ped); alpha=max(alpha,ped);
      float fr2=length(v), fa=atan(v.y,v.x)+hv*1.5+.785, pid, ph=catVG_petal(fa,4.,pid);
      float pd=length(fr2*vec2(cos(ph),sin(ph))-vec2(R*.52,0.))-R*.46;
      float bd=length(v/vec2(.45*R,R))-1.;
      float a=catVG_cov(mix(bd*R,pd,open),e);
      vec3 pc=mix(base*.82,base*1.1,smoothstep(0.,R,fr2))*(.92+.16*catH(vec2(pid,fk+sd)));
      pc=mix(secondary*.85,pc,open);
      pc=mix(pc,vec3(.893,.793,.832),(1.-smoothstep(.0,.02+e,fr2))*.8*open);
      c=mix(c,pc,a); alpha=max(alpha,a); h=mix(h,.6,a);
    }
  }
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh=1.-fx.y*.45;
}`;

// Bluebells: an arching stem nodding at the top with bells hanging from one side, buds toward the tip,
// and two strap leaves. Each bell is tested only inside its bounding circle (st.z bells, at most 8).
// st.w 1: trumpet gentian (see below).
const bell = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., e=pu*.5+.003;
  alpha=0.; c=secondary; h=.5;
  vec3 stemC=mix(vec3(.082,.164,.052),secondary,.25);
  if(st.w>.5){
    // trumpet gentian: one big upright deep-blue trumpet over a low rosette; five pointed mouth lobes,
    // dark stripes, green-spotted throat at the rim, green calyx.
    for(int l=0;l<5;l++){ float fl=float(l), la=-1.2+fl*.6; vec2 lv=u-vec2(0.,-.82); float lc=cos(la),ls=sin(la);
      vec2 lp=vec2(lv.x*lc-lv.y*ls,lv.x*ls+lv.y*lc); float ld=length(lp/vec2(.13,.32)-vec2(0.,.9))-1.;
      float lfa=catVG_cov(ld*.13,e); c=mix(c,vec3(.04,.11,.03)*(1.+.12*sign(lp.x)),lfa); alpha=max(alpha,lfa); }
    float stem=catVG_cov(abs(u.x)-max(.035,pu*.45),pu*.5)*step(u.y,-.4)*step(-.85,u.y); c=mix(c,vec3(.06,.13,.04),stem); alpha=max(alpha,stem);
    float ty=(u.y+.5)/1.25, w=.1+.32*pow(clamp(ty,0.,1.),2.2);
    float lob=abs(sin(u.x/max(w,.05)*3.1416*1.25+.0)), lip=.75+.12*(1.-lob)-.04*(1.-abs(u.x)/max(w,.05));
    float d=max(abs(u.x)-w*(1.+.08*smoothstep(.85,1.,ty)),max(-ty,u.y-lip));
    float a=catVG_cov(d,e);
    vec3 tc=mix(base*.7,base*1.1,smoothstep(0.,1.,ty))*(1.+.1*sign(u.x));
    tc*=.88+.12*cos(u.x/max(w,.05)*9.42)*nearD;                                     // pleats
    tc=mix(tc,vec3(.05,.2,.08),smoothstep(.8,1.,ty)*step(.6,catH(floor(u*vec2(26.,30.))))*.7*(1.-abs(u.x)/max(w,.05))*nearD);
    float caly=catVG_cov(max(abs(u.x)-w*1.05,max(-ty,ty-.22-.06*abs(sin(u.x*30.)))),e);
    tc=mix(tc,vec3(.06,.15,.04),caly);
    c=mix(c,tc,a); alpha=max(alpha,a); h=mix(h,.5+.3*(1.-abs(u.x)/max(w,.05)),a);
  } else {
  // strap leaves
  for(int l=0;l<2;l++){ float fl=float(l)*2.-1.; float yy=(u.y+1.)/1.3; float lx=u.x-fl*(.08+.35*yy*yy);
    float la=catVG_cov(abs(lx)-max(.05*(1.-yy),pu*.4),e)*step(yy,1.);
    c=mix(c,vec3(.056,.148,.043)*(1.+.08*fl),la); alpha=max(alpha,la); }
  // stem: rises, then arches over to the right
  float t=clamp((u.y+1.)/1.85,0.,1.), sx=-.25+.5*t*t*t;
  float sa=catVG_cov(abs(u.x-sx)-max(.018,pu*.45),pu*.5)*step(u.y,.85);
  vec2 tipC=vec2(.25,.85); float arc=catVG_cov(abs(length(u-vec2(.32,.68))-.18)-max(.016,pu*.45),pu*.5)*step(.68,u.y)*step(u.x,.42);
  c=mix(c,stemC,max(sa,arc)); alpha=max(alpha,max(sa,arc));
  float N=min(st.z,8.);
  for(int i=0;i<8;i++){
    float fi=float(i); if(fi>=N) break;
    float tt=fi/(N-1.), hv=catH(vec2(fi,sd));
    float ty=mix(.12,.82,tt); float tx=-.25+.5*pow(clamp((ty+1.)/1.85,0.,1.),3.);
    if(ty>.66) { tx=.32+.18*cos(1.57*(ty-.66)/.16+1.57); }
    vec2 P=vec2(tx+.03,ty); float sz=mix(.38,.18,tt)*(.9+.2*hv);
    vec2 A=P+vec2(.12+.04*tt,-.1);                   // bell hangs on a short pedicel, mouth down-right
    vec2 dl=u-A; if(dot(dl,dl)>sz*sz*4.) { continue; }
    float ped=catVG_cov(catVG_seg(u,P,A)-max(.008,pu*.4),pu*.5); c=mix(c,stemC,ped); alpha=max(alpha,ped);
    float ang=-.35-.3*hv*(1.-tt), ca=cos(ang), sa2=sin(ang);
    vec2 b=vec2(dl.x*ca-dl.y*sa2,dl.x*sa2+dl.y*ca)/sz; b.y=-b.y;     // b.y 0 at the top of the bell, 1 at the mouth
    float wv=.2+.22*pow(clamp(b.y,0.,1.),1.6);
    float lip=b.y-1.-.12*abs(sin(b.x/max(wv,.05)*4.7))+.18*smoothstep(.7,1.2,abs(b.x)/wv);
    float flare=smoothstep(.8,1.05,b.y)*.12;
    float d=max(abs(b.x)-wv-flare,max(-b.y,lip))*sz;
    float a=catVG_cov(d,e);
    vec3 bc=mix(base*.75,base*1.08,smoothstep(0.,1.,b.y))*(1.+.12*sign(b.x))*(.95+.1*cos(b.x/wv*6.));
    bc=mix(bc,accent,smoothstep(.85,1.05,b.y)*.45);
    bc=mix(vec3(dot(bc,vec3(.33))),bc,1.45); bc=mix(bc,mix(base,vec3(.133,.218,.071),.5),smoothstep(.6,.95,tt));       // buds still green-tinged
    c=mix(c,bc,a); alpha=max(alpha,a); h=mix(h,.5+.3*(1.-abs(b.x)/wv),a);
  }
  }
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.6); rgh=1.-fx.y*.45;
}`;


// Bark finishes are placed physically (fxOwned): moss climbs from the base, the north side (-z) and the
// fissures; lichen rosettes sit on proud faces; frost rimes ridges and up-facing parts; rain darkens in
// streaks running down and turns glossy; weathering silvers the ridges; dry dusts the crevices.
// Inputs: crev (1 deep fissure … 0 proud face), ht = height on the mesh (m). Trees: catFinish
// young 0, mature 1, dry 2, rain-dark 3, lichen 4, mossy 5, weathered 6, frosted 7.
const barkFinish = G`
  {
    vec3 wn=normalize(vCatWorldNormal); float fin=catFinish;
    float north=clamp(-wn.z*.6+.5,0.,1.), low=1.-smoothstep(-.6,.9,ht), nz=catF(q*vec2(.8,.3)+3.7);
    if(fin<.5) c=mix(c,c*1.06,1.-crev);                                           // young: cleaner, brighter
    c=mix(c,mix(c,accent*.95,.45),fx.z*(.3+.7*crev));                              // dry: dust in fissures
    float streak=smoothstep(.45,.75,catN(vec2(q.x*2.3,q.y*.1)));
    c*=1.-fx.y*(.18+.22*streak+.15*crev); rgh*=1.-fx.y*(.3+.35*streak);           // rain-dark streaks, sheen
    if(abs(fin-4.)<.5){                                                            // lichen rosettes
      vec2 g=q*vec2(.8,.6)+.5, id=floor(g), f=fract(g)-.5-(vec2(catH(id),catH(id+7.))-.5)*.45;
      float r=length(f)/(.16+.24*catH(id+3.))+(catN(g*9.)-.5)*.5*nearD;
      float ros=step(.5-.35*north,catH(id+11.))*(1.-smoothstep(.85,1.,r))*(1.-crev*.7);
      c=mix(c,mix(vec3(.268,.349,.218),vec3(.485,.547,.375),smoothstep(.45,.95,r)),ros*.85); h=mix(h,h+.06,ros);
    }
    if(abs(fin-5.)<.5){                                                            // moss
      float m=smoothstep(.2,.45,low*.9+north*.45+crev*.45+(nz-.5)*1.2-.55);
      vec3 moss=mix(vec3(.011,.036,.003),vec3(.052,.106,.009),smoothstep(.3,.8,catF(q*2.5))*nearD+.35*(1.-nearD)); moss=mix(vec3(dot(moss,vec3(.36))),moss,.7);
      c=mix(c,moss,m); h=mix(h,.62+.2*catN(q*8.),m*.8);
    }
    if(abs(fin-6.)<.5) c=mix(c,vec3(dot(c,vec3(.36,.4,.24)))*1.15,.45*(1.-crev));    // silvered ridges
    float rime=clamp((1.-crev)*.35+clamp(wn.y,0.,1.)+north*.4+(nz-.5)*1.1-.4,0.,1.);
    c=mix(c,vec3(.681,.774,.832),fx.w*smoothstep(.15,.55,rime));                     // frost
    fxOwned=1.;
  }`;

// Smooth bark, st.w: 0 silver birch (chalk white, dark lenticel dashes, black chevron scars, papery
// bands, dark fissured foot), 1 beech (smooth grey, soft blotches, ring wrinkles, branch-scar "eyes"),
// 2 aspen (green-white, dark diamond eye scars, few lenticels).
const barkSmooth = G`{
  float sh=floor(st.w+.5), ht=metres.y;
  float rows=sh<.5?3.:sh<1.5?2.5:3.5;
  vec2 g=vec2(q.x*(sh<.5?1.3:.8),q.y*rows); float row=floor(g.y), gx=g.x+catH(vec2(row,7.))*5.;
  float cl=floor(gx), ch=catH(vec2(cl,row)), fxp=fract(gx), len=mix(.15,.9,fract(ch*7.3));
  float ey=px*rows*2.5+.04;
  float dash=step(sh<.5?.52:sh<1.5?.94:.72,ch)*(1.-smoothstep(len*.5-.06,len*.5,abs(fxp-.5)))*(1.-smoothstep(.1,.1+ey,abs(fract(g.y)-.5)*(1.+abs(fxp-.5)*2.)));
  float tone=catF(q*vec2(.35,1.2));
  c=base*(.94+.12*tone);
  float crev=0.;
  if(sh<.5){
    float band=smoothstep(.56,.62,catN(vec2(q.x*.25,q.y*1.4)));                         // papery peeling band
    c=mix(c,mix(base,vec3(.718,.547,.428),.55),band*.8); c*=1.-.25*(1.-smoothstep(.0,.04,abs(catN(vec2(q.x*.25,q.y*1.4))-.6)))*nearD;
    float foot=1.-smoothstep(-1.,.3,ht+(catN(q*.5)-.5)*.8);                           // dark rough foot
    float fis=smoothstep(.45,.7,catF(vec2(q.x*1.5,q.y*.25)));
    c=mix(c,mix(secondary,base*.6,fis),foot); crev=foot*(1.-fis);
  } else if(sh<1.5){
    c=mix(c,mix(base,accent,.6),smoothstep(.5,.72,catF(q*.6+9.))*.7);                // pale blotches
    c=mix(c,secondary*.9,smoothstep(.5,.75,catF(q*vec2(.5,.3)+2.))*.65);              // darker mottles
    c=mix(c,mix(c,vec3(.12,.2,.06),.5),smoothstep(.4,.9,clamp(-normalize(vCatWorldNormal).z,0.,1.)+catN(q*.4)*.5-.3)*.6); // green algae, north
    crev=.35*(1.-catF(q*vec2(.3,.6)));                                               // soft bulges
    float ring=(1.-smoothstep(.0,.05+px*2.,abs(fract(q.y*.7+catN(q*.3)*.4)-.5)))*step(.42,catN(vec2(q.x*.5,floor(q.y*.7))));
    c*=1.-ring*.25*nearD; crev=ring*.4;
  } else {
    c=mix(c,mix(base,vec3(.456,.531,.325),.4),smoothstep(.4,.8,catF(q*.5+4.))*.5);
  }
  c=mix(c,secondary*.9,dash*nearD); crev=max(crev,dash*.7);
  // branch scars: black chevron (birch), "eye" with moustache (beech), dark diamond eyes (aspen)
  vec2 sg=q*vec2(sh<.5?.32:sh<1.5?.22:.5,sh<.5?.2:sh<1.5?.16:.3)+vec2(0.,.5), sid=floor(sg), sf=fract(sg)-.5;
  sf+=(vec2(catH(sid+1.),catH(sid+2.))-.5)*.3; sf*=vec2(1.,1.4);
  float on=step(sh<.5?.55:sh<1.5?.5:.45,catH(sid+5.)), es=px*3.+.02;
  float chev=sh<.5?1.-smoothstep(.06,.06+es,abs(sf.y+.12-abs(sf.x)*.9)+max(abs(sf.x)-.3,0.)*2.):
            sh<1.5?(1.-smoothstep(.02,.02+es,abs(sf.y+.05-sf.x*sf.x*2.5)))*step(abs(sf.x),.28)*.6+(1.-smoothstep(.05,.05+es,length(sf*vec2(1.,2.))-.03)):
            1.-smoothstep(.0,es,abs(sf.x)*1.2+abs(sf.y)*2.2-.16);
  c=mix(c,secondary*.55,on*chev); crev=max(crev,on*chev);
  h=.6-.45*crev+(tone-.5)*.1;
  ${barkFinish}
  rgh*=1.-.1*(1.-crev);
}`;

// Fissured bark: warped vertical ridges separated by dark fissures. st.w 0 oak (wide ridges broken into
// blocks), 1 cedar (narrow stringy strips, shallow), 2 redwood (long, rounded, deep fibrous ridges),
// 3 willow (interlacing ridges), 4 Monterey cypress (shaggy: fibrous strips with loose hanging strands).
// Oak: ridge width wanders so fissures merge and split, with diagonal connectors and rare cross-cracks.
// st.x stretches the ridges vertically.
const barkFissured = G`{
  float sh=floor(st.w+.5), ht=metres.y;
  float warp=sh<.5?1.1:sh<1.5?.5:sh<2.5?.35:.8;
  float wx=q.x*(sh>2.5?1.7:1.)+(catN(vec2(q.x*.45,q.y*(sh>2.5?.2:.13)/st.x))-.5)*warp*2.;
  float rid=floor(wx), f=fract(wx), hr=catH(vec2(rid,3.));
  float rw=mix(sh<.5?.2:sh<1.5?.3:sh<2.5?.34:.3,sh<.5?.38:sh<1.5?.44:sh<2.5?.46:.44,catN(vec2(rid*3.1,q.y*.22/st.x)));
  bool stringy=sh>.5&&sh<1.5||sh>3.5;
  if(stringy) rw=mix(sh>3.5?.2:.25,.42,catN(vec2(rid*2.3,q.y*.5)));
  float dr=abs(f-.5), e=px*2.5+.02;
  float crev=smoothstep(rw-.04,rw+e,dr);
  float bk=fract(q.y*.6/st.x+hr*9.+catN(vec2(rid,q.y*.2))*.6), brk=sh<.5?(1.-smoothstep(.0,.06+px*2.5,min(bk,1.-bk)))*step(.7,catH(vec2(rid,floor(q.y*.6/st.x+hr*9.)))):0.;
  if(sh>2.5){ float dg=fract(q.y*.5/st.x+wx*.45*(mod(rid,2.)*2.-1.)); brk=(1.-smoothstep(.0,.04+px*2.5,min(dg,1.-dg)))*step(.45,catH(vec2(rid,floor(q.y*.5/st.x+wx*.45)))); }
  crev=max(crev,brk*.85);
  float prof=sh>1.5?cos(min(dr/rw,1.)*1.5708):1.-pow(dr/rw,3.);
  if(sh<.5){                                                                  // oak: ridges that split and merge
    rw=mix(.12,.4,catN(vec2(rid*3.1,q.y*.38/st.x)));
    crev=smoothstep(rw-.04,rw+e,dr);
    float dg=fract(q.y*.35/st.x+wx*.5*(mod(rid,2.)*2.-1.)+hr*3.);
    float con=(1.-smoothstep(.0,.035+px*2.5,min(dg,1.-dg)))*step(.6,catH(vec2(rid,floor(q.y*.35/st.x+wx*.5*(mod(rid,2.)*2.-1.)+hr*3.))));
    crev=max(crev,con*.9); prof=1.-pow(min(dr/max(rw,.01),1.),3.);
  }
  h=mix(.25+.7*prof,.02,crev);
  float fib=catN(vec2(q.x*(sh>.5?18.:9.),q.y*(sh>.5?.9:1.6)));
  c=mix(secondary*.62,base*(.82+.36*catH(vec2(rid,sh<.5?1.:floor(q.y*.6/st.x+hr*9.)))),1.-crev);
  c=mix(c,accent,(1.-crev)*pow(max(prof,0.),3.)*.32);                                   // light on the ridge crowns
  c*=1.+(fib-.5)*(sh>.5?.34:.2)*nearD;
  if(stringy) c=mix(c,vec3(dot(c,vec3(.33)))*1.1,smoothstep(.55,.8,catN(q*vec2(1.,.15)))*.4);  // grey weathered strips
  if(sh>3.5){ float lo=catN(vec2(q.x*4.+q.y*.35,q.y*.4)); float strand=(1.-smoothstep(.0,.06+px*2.,abs(fract(q.x*2.2+q.y*.12+lo)-.5)-.38))*step(.55,lo);
    c=mix(c,accent*.95,strand*.6); h=max(h,.8*strand); crev*=1.-strand; }          // loose hanging strands
  ${barkFinish}
}`;

// Scots pine: grey-brown flaking plates with deep dark gaps; layered flake edges show cinnamon orange,
// which takes over higher up the trunk (ht 1.5 → 6 m) as plates get thin and papery.
// st.w 1: European larch, smaller scaly pink-brown plates with red-purple inner bark in the fissures.
const barkScaled = G`{
  float ht=metres.y, lar=step(.5,st.w); float upT=smoothstep(1.5,6.,ht)*(1.-lar);
  vec2 z=q*vec2(1.3,.8/st.x); vec3 cells=catCells(z*mix(1.,1.8,upT)*mix(1.,1.5,lar));
  float e=px*2.5+.02;
  float gap=1.-smoothstep(st.y*.6,st.y*.6+e,cells.y);
  float layer=fract(cells.y*6.+cells.z*3.);
  vec3 orange=mix(base,vec3(.579,.133,.029),.5), grey=mix(base*.6,vec3(.071,.061,.052),.65);
  c=mix(orange,grey,smoothstep(.04,.14,cells.y+(catN(q*6.)-.5)*.08)*(.7+.3*cells.z)*(1.-upT*.85));
  c*=.9+.15*cells.z; c*=1.-(1.-smoothstep(.0,.12,abs(layer-.5)))*.12*nearD*(1.-upT);
  c=mix(c,mix(secondary*.55,mix(secondary,vec3(.25,.05,.06),.22),lar),gap);
  float crev=gap;
  h=mix(.45+.4*smoothstep(.0,.25,cells.y)+.1*cells.z,.0,gap);
  ${barkFinish}
}`;

// Eucalyptus: shedding bark in jigsaw layers, fresh cream under grey-green under tan with dark ribbon strips;
// each older layer stands proud with a thin shadow line at its edge.
// st.w 1: London plane, rounder camouflage patches (cream, khaki, olive, grey-brown), little ribboning.
const barkPeeling = G`{
  float ht=metres.y, pl=step(.5,st.w); float n=catF(q*mix(vec2(1.8,.45),vec2(1.3,.95),pl)+catN(q*.3)*mix(.8,.4,pl)), e=px*1.2+.004;
  float l1=smoothstep(.36-e,.36+e,n), l2=smoothstep(.52-e,.52+e,n), l3=smoothstep(.68-e,.68+e,n);
  c=mix(accent*1.08,mix(secondary,base,.2),l1); c=mix(c,mix(base,vec3(.485,.349,.302),.4),l2); c=mix(c,mix(base,vec3(.173,.106,.061),.6),l3);
  float edge=max(max(1.-smoothstep(0.,.02+px,abs(n-.36)),1.-smoothstep(0.,.02+px,abs(n-.52))),1.-smoothstep(0.,.02+px,abs(n-.68)));
  c*=1.-edge*.4*nearD;
  float rib=l3*smoothstep(.5,.8,catN(vec2(q.x*5.,q.y*.15)))*(1.-pl);
  c=mix(c,c*.75,rib*.5); c*=1.+(catN(vec2(q.x*20.,q.y*2.))-.5)*.1*nearD;
  h=.25+.17*(l1+l2+l3)+.08*rib;
  float crev=edge*.5;
  ${barkFinish}
}`;

// Palm trunk: staggered rows of overlapping leaf-base boots; each boot has a proud lower lip catching the
// light, a recessed fibrous pocket above, dark gaps between.
const barkDiamond = G`{
  float ht=metres.y; float row=floor(q.y*st.x); vec2 g=vec2(q.x+mod(row,2.)*.5,q.y*st.x);
  vec2 f=fract(g)-.5; f.x+=(catH(floor(g))-.5)*.12; float dia=abs(f.x)+abs(f.y)*.85+(catN(q*3.)-.5)*.08;
  float e=px*2.5+.02;
  float gap=smoothstep(.5-st.y-e,.5-st.y+e,dia);
  float lip=smoothstep(.0,-.35,f.y);
  float fib=catN(vec2(q.x*3.,q.y*st.x*14.));
  c=mix(secondary*.85,base*(.9+.2*catH(floor(g))),.55+.45*lip); c=mix(c,accent,lip*lip*.2);
  c*=1.+(fib-.5)*.25*nearD*(1.-lip);
  c=mix(c,secondary*.6,gap);
  float crev=max(gap,(1.-lip)*.4);
  h=mix(.3+.6*lip,.0,gap);
  ${barkFinish}
}`;


// Shrub card: a dense mound with leaves on its skin, woody stems at the foot. Two offset leaf grids (one
// cell each, no neighbour search). st.w 0 coastal sage scrub (narrow grey-green leaves, dry flower stalks),
// 1 alpenrose (dark glossy leaves, clusters of pink-red bells at the top). accent = flowers.
const shrub = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., sh=floor(st.w+.5), y=(u.y+1.)*.5, e=pu*.5+.003;
  alpha=0.; c=secondary*.5; h=.5;
  vec3 wood=mix(secondary,vec3(.093,.052,.026),.6);
  for(int j=0;j<4;j++){ float fj=float(j), hv=catH(vec2(fj,sd+1.)); vec2 tip=vec2((fj-1.5)*.3+(hv-.5)*.15,-.3+.2*hv);
    float sa=catVG_cov(catVG_seg(u,vec2((fj-1.5)*.06,-1.),tip)-max(.02*(1.2-y),pu*.45),pu*.5); c=mix(c,wood,sa); alpha=max(alpha,sa); }
  float topY=-.78+1.55*sqrt(max(1.-pow(u.x/.92,2.),0.))*(.8+.3*catN(vec2(u.x*3.5+sd,1.)));
  float body=catVG_cov(u.y-(topY-.16),.08)*step(-.86,u.y);                      // dense interior
  c=mix(c,mix(secondary,base,.45)*.8,body); alpha=max(alpha,body*.95);
  if(sh<.5){ for(int j=0;j<2;j++){ float fj=float(j), hv=catH(vec2(fj+7.,sd)); vec2 b0=vec2((hv-.5)*.9,.0), t0=b0+vec2((fj-.5)*.2,.9);
      float sa=catVG_cov(catVG_seg(u,b0,t0)-max(.008,pu*.4),pu*.5); float tt=clamp((u.y-b0.y)/.9,0.,1.);
      float knot=catVG_cov(abs(fract(tt*4.)-.5)*.225-.035,e)*step(.45,tt)*catVG_cov(abs(u.x-mix(b0.x,t0.x,tt))-.04,e);
      c=mix(c,mix(wood,vec3(.2,.13,.08),.5),max(sa,knot)); alpha=max(alpha,max(sa,knot)); } }
  for(int g=0;g<2;g++){
    float fg=float(g); vec2 o=fg*vec2(.5,.37)+sd, gp=u*7.+o, id=floor(gp); float hv=catH(id+fg*13.), hv2=fract(hv*7.31);
    vec2 jit=(vec2(hv,hv2)-.5)*.35, ctr=(id+.5+jit-o)/7.;
    float topC=-.78+1.55*sqrt(max(1.-pow(ctr.x/.92,2.),0.))*(.8+.3*catN(vec2(ctr.x*3.5+sd,1.)));
    if(ctr.y>topC||ctr.y<-.84) continue;
    vec2 v=fract(gp)-.5-jit; float ang=atan(ctr.x,ctr.y+1.3)*.9+(hv-.5)*1.4, ca=cos(ang), sa=sin(ang);
    v=vec2(v.x*ca-v.y*sa,v.x*sa+v.y*ca);
    bool fl=sh>.5&&ctr.y>topC-.32&&hv2>.35;
    float d, ee=pu*3.5+.03;
    if(fl){ float th=atan(v.x,v.y), fid, fph=catVG_petal(th,5.,fid); vec2 fv=length(v)*vec2(cos(fph),sin(fph))-vec2(.2,0.); d=min(length(fv/vec2(1.,.75))-.13,length(v)-.12); }
    else d=length(v/vec2(sh>.5?.17:.1,.42))-1.; if(!fl) d*=sh>.5?.17:.1;
    float a=catVG_cov(d,ee);
    vec3 lc=mix(secondary,base,.6+.4*smoothstep(-.4,.4,v.y))*(.85+.3*hv)*(1.+.1*sign(v.x));
    if(sh<.5) lc=mix(lc,accent,step(.7,hv2)*.35);                                  // pale undersides
    if(fl) lc=mix(accent*.7,accent*1.1,smoothstep(-.1,.25,length(v)))*(.9+.2*hv);
    c*=1.-.25*catVG_cov(d-.05,.05)*(1.-a)*alpha;
    c=mix(c,lc,a); alpha=max(alpha,a); h=mix(h,.65,a);
  }
  float lod=smoothstep(.03,.08,pu), fill=catVG_cov(u.y-topY,.06)*step(-.9,u.y)*lod*(1.-alpha);
  c=mix(c,mix(secondary,base,.5),fill); alpha=max(alpha,fill);
  c=mix(c,vec3(.699,.793,.852),fx.w*smoothstep(-.4,.8,u.y)*.55);
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.3); rgh=(1.-fx.y*.45)*(sh>.5?.6:1.);
}`;

// Ruderal crack weeds (industrial lots, verges): a dandelion rosette of runcinate leaves, a yellow head
// and a seed clock, wiry chicory with sky-blue flowers, a few grass blades. accent = dandelion yellow.
const weeds = G`{
  float pu=px*2., sd=fract(catParams.y*.618034)*97., e=pu*.5+.003;
  alpha=0.; c=secondary; h=.5;
  vec3 stemC=mix(secondary,vec3(.12,.2,.06),.5);
  for(int i=0;i<3;i++){ float fi=float(i), hv=catH(vec2(fi+20.,sd)); float xb=.12+fi*.12, tt=(u.y+1.)/(.8+.5*hv);
    float xc=xb+(hv-.5)*.5*tt*tt, w=.03*(1.-tt); float a=catVG_cov(abs(u.x-xc)-max(w,pu*.4),pu*.5)*step(tt,1.)*step(0.,tt);
    c=mix(c,mix(secondary,base,tt),a); alpha=max(alpha,a); }
  // chicory: wiry stem with a side branch and three blue rayed flowers
  float cs=catVG_cov(min(catVG_seg(u,vec2(.28,-.98),vec2(.36,.8)),catVG_seg(u,vec2(.32,-.1),vec2(.6,.38)))-max(.012,pu*.45),pu*.5);
  c=mix(c,stemC,cs); alpha=max(alpha,cs);
  for(int i=0;i<3;i++){ float fi=float(i); vec2 P=fi<.5?vec2(.36,.8):fi<1.5?vec2(.6,.38):vec2(.33,.32);
    vec2 v=u-P; float r=length(v); if(r>.14) continue; float a0=atan(v.y,v.x), pid, ph=catVG_petal(a0,15.,pid);
    float Rr=.12*(.85+.15*catH(vec2(pid,fi)))*(1.-.08*abs(sin(r*sin(ph)/.012*1.5)));
    float a=catVG_cov(max(abs(r*sin(ph))-.016*(.5+r/.12),r-Rr),e);
    vec3 fc=mix(vec3(.12,.25,.75),vec3(.25,.4,.85),smoothstep(.03,.12,r)); fc=mix(fc,vec3(.04,.08,.4),1.-smoothstep(.015,.03,r));
    c=mix(c,fc,a); alpha=max(alpha,a); h=mix(h,.6,a); }
  // dandelion rosette: runcinate leaves (teeth point back toward the base), spreading low
  vec2 B=vec2(-.18,-.94);
  for(int i=0;i<6;i++){ float fi=float(i), hv=catH(vec2(fi,sd)); float ang=(fi-2.5)*.5+(hv-.5)*.25, L=.5+.25*hv;
    vec2 dl=u-B; if(dot(dl,dl)>L*L) continue; float ca=cos(ang),sa=sin(ang); vec2 lp=vec2(dl.x*ca-dl.y*sa,dl.x*sa+dl.y*ca);
    float t=lp.y/L, w=.1*pow(max(sin(3.1416*pow(clamp(t,0.,1.),.75)),0.),.8)*(.45+.55*fract(-t*5.+hv));
    float d=max(abs(lp.x)-w,max(-lp.y,lp.y-L)); float a=catVG_cov(d,e);
    vec3 lc=mix(secondary,base,.5+.5*t)*(.9+.2*hv)*(1.+.08*sign(lp.x)); lc=mix(lc,mix(base,vec3(.4,.15,.12),.3),(1.-smoothstep(.006,.014+e,abs(lp.x)))*.6);
    c*=1.-.25*catVG_cov(d-.04,.04)*(1.-a)*alpha; c=mix(c,lc,a); alpha=max(alpha,a); h=mix(h,.6,a); }
  // dandelion flower and seed clock on hollow pale stems
  float ds=catVG_cov(min(catVG_seg(u,B,vec2(-.08,.28)),catVG_seg(u,B,vec2(-.4,.55)))-max(.016,pu*.45),pu*.5);
  c=mix(c,mix(base,vec3(.45,.5,.25),.4),ds); alpha=max(alpha,ds);
  vec2 v=(u-vec2(-.08,.32))/vec2(1.,.75); float r=length(v), a0=atan(v.y,v.x);
  float fa=catVG_cov(r-.17*(.82+.18*abs(cos(a0*14.))),e);
  c=mix(c,mix(accent*.75,accent*1.08,smoothstep(.02,.15,r)),fa); alpha=max(alpha,fa);
  vec2 sv=u-vec2(-.4,.6); float sr=length(sv), sa0=atan(sv.y,sv.x);
  float puff=catVG_cov(sr-.16,e+.01)*(.55+.45*smoothstep(.3,.9,cos(sa0*34.)))*mix(1.,.8,smoothstep(.02,.06,pu));
  c=mix(c,vec3(.85,.85,.8),puff); c=mix(c,vec3(.25,.2,.12),catVG_cov(sr-.025,e)); alpha=max(alpha,max(puff,catVG_cov(sr-.025,e)));
  c*=.7+.3*smoothstep(-1.,-.6,u.y);
  c=mix(c,vec3(.699,.793,.852),fx.w*.35);
  fxOwned=1.; c*=1.-fx.y*.2; c=mix(c,mix(c,accent*.9,.4),fx.z*.3); rgh=1.-fx.y*.45;
}`;

// ---------- overlays: layered on another preset (walls, rock, bark), output COVERAGE in alpha ----------
// Finish (catFinish): light 0, medium 1, heavy 2, fresh 3, old 4, damp 5, dry 6, frosted 7 -> amount + state.
// Placement uses ly (height in the projection, m), up (world normal y) and metres (local projection, m).
const ovHead = G`
  float amt=catFinish<.5?.35:catFinish<1.5?.62:catFinish<2.5?.92:catFinish<3.5?.6:catFinish<4.5?.75:catFinish<5.5?.7:catFinish<6.5?.5:.6;
  float isFresh=step(2.5,catFinish)*step(catFinish,3.5), isOld=step(3.5,catFinish)*step(catFinish,4.5), isDamp=step(4.5,catFinish)*step(catFinish,5.5),
        isDry=step(5.5,catFinish)*step(catFinish,6.5), isFrost=step(6.5,catFinish);
  float sd=fract(catParams.y*.618034)*97., S=fwidth(metres.x+metres.y)/max(fwidth(q.x+q.y),1e-5);
  alpha=0.; h=.5; fxOwned=1.; c=vec3(.22,.21,.19);              // c shows only when previewed alone`;

// English ivy (st.w 0): a dense mat of dark glossy five-lobed leaves with pale veins, hanging tip-down,
// climbing from the foot of the wall (higher in places), over the top when heavy; woody vines show where
// sparse. Boston ivy (st.w 1): three-lobed toothed leaves lying flat, crimson in the "old" finish.
const ivy = G`{
  ${ovHead}
  float bos=step(.5,st.w);
  float reach=(.4+3.4*amt)*(.35+.9*catF(vec2(metres.x*.45+sd,2.)));
  float topOn=step(.6,up)*smoothstep(.5,.8,amt+(catN(q*.3)-.5)*.6);
  float e=px*.8+.02;
  // vines
  float vx=q.x*.3+catN(vec2(q.x*.3,q.y*.12))*1.4, vine=(1.-smoothstep(.025,.025+e*.5,abs(fract(vx)-.5)))*step(ly,reach)*step(.7,catH(vec2(floor(vx),sd)));
  c=mix(secondary,vec3(.13,.09,.05),.6); alpha=vine*.95; h=mix(h,.62,vine);
  float under=step(ly,reach-.2)*smoothstep(.55,.9,amt); c=mix(c,secondary*.7,under*(1.-vine)); alpha=max(alpha,under*.95);
  for(int g=0;g<2;g++){
    float fg=float(g); vec2 o=fg*vec2(.5,.31)+sd, gp=q+o, id=floor(gp); float hv=catH(id+fg*7.), hv2=fract(hv*9.13);
    vec2 jit=(vec2(hv,hv2)-.5)*.3, f=fract(gp)-.5;
    float lyC=ly+(jit.y-f.y)*S;
    float on=max(step(lyC,reach),topOn)*step(1.-amt*1.1,fract(hv*3.7)+.25);
    if(on<.5) continue;
    vec2 v=f-jit; float ang=mix(3.1416+(hv-.5)*1.8,(hv-.5)*6.28,bos), ca=cos(ang), sa=sin(ang);
    v=(vec2(v.x*ca-v.y*sa,v.x*sa+v.y*ca)+vec2(0.,.2))/1.35;
    float r=length(v), th=atan(v.x,v.y);
    float Rl=bos>.5?.38*(.58+.42*pow(abs(cos(th*1.5)),3.))+.025*sin(th*22.)*nearD:.36*(.66+.34*pow(abs(cos(th*2.5)),2.5));
    Rl*=1.-.35*smoothstep(2.5,3.14,abs(th));
    float d=r-Rl, a=catVG_cov(d,e);
    float vein=(1.-smoothstep(.01,.03+e,r*abs(sin(th*(bos>.5?1.5:2.5)))))*step(abs(th),2.6)*smoothstep(.05,.15,r);
    vec3 lc=mix(secondary,base,.55+.45*smoothstep(-.3,.4,v.y))*(.82+.36*hv)*(1.+.08*sign(v.x));
    lc=mix(lc,accent,vein*(bos>.5?.12:.45));
    vec3 red=mix(vec3(.42,.02,.03),vec3(.6,.15,.03),hv2);
    lc=mix(lc,bos>.5?red:lc*vec3(.9,.65,.75),isOld*(bos>.5?.5+.5*hv:.35));
    lc=mix(lc,mix(lc,vec3(.22,.12,.04),.6),isDry*(.3+.5*hv2));
    lc=mix(lc,lc*1.15+vec3(.02,.04,0.),isFresh*.5);
    lc=mix(lc,vec3(.75,.82,.86),isFrost*(1.-smoothstep(.0,.07,-d))*.8);
    c*=1.-.3*catVG_cov(d-.06,.06)*(1.-a)*alpha;
    c=mix(c,lc,a); alpha=max(alpha,a); h=mix(h,.8+.1*(1.-r/Rl),a);
  }
  rgh=mix(1.,bos>.5?.75:.55,alpha)*(1.-isDamp*.4); c*=1.-isDamp*.15;
}`;

// Moss cushions: on up-facing tops and the damp foot of a wall, patchy; bumpy domes with bright tips.
const mossCushion = G`{
  ${ovHead}
  float topF=smoothstep(.3,.8,up), foot=1.-smoothstep(.0,.3+1.6*amt,ly), north=clamp(-normalize(vCatWorldNormal).z,0.,1.);
  float b=catN(q*1.6)*.6+catN(q*4.3+3.)*.4, n=catF(q*.18+sd);
  float field=topF*(.55+.45*amt)+foot*(.5+.5*amt)+north*.2*amt+(n-.5)*.9+(b-.5)*.25+amt*.3-.35;
  alpha=smoothstep(.45,.55+px*.05,field);
  vec3 m0=mix(secondary,base,smoothstep(.25,.75,b)); m0=mix(m0,accent,smoothstep(.65,.9,b)*.5*nearD);
  m0=mix(vec3(dot(m0,vec3(.33))),m0,.8);
  m0=mix(m0,m0*vec3(1.3,1.1,.55),isDry*.7); m0=mix(m0,m0*vec3(.8,.75,.6),isOld*.5); m0=mix(m0,m0*1.15,isFresh*.5);
  m0=mix(m0,vec3(.72,.8,.85),isFrost*smoothstep(.55,.85,b));
  c=m0*(.85+.15*smoothstep(.45,.75,field)); h=.55+.4*b;
  rgh=1.-isDamp*.35; c*=1.-isDamp*.18;
}`;

// Crustose lichen: round rosettes with lobed rims and cracked (areolate) centres, grey-green, some orange
// (accent, Xanthoria); denser on up-facing and north faces.
const lichenCrust = G`{
  ${ovHead}
  float pref=clamp(.55+.45*up,0.,1.)*(.8+.3*clamp(-normalize(vCatWorldNormal).z,0.,1.));
  for(int g=0;g<2;g++){
    float fg=float(g); vec2 o=fg*vec2(.5,.29)+sd, gp=q*mix(1.,1.7,fg)+o, id=floor(gp); float hv=catH(id+fg*5.), hv2=fract(hv*11.3);
    if(hv2>amt*pref*1.1) continue;
    vec2 v=fract(gp)-.5-(vec2(hv,fract(hv*3.1))-.5)*.3; float r=length(v), th=atan(v.y,v.x);
    float Rr=(.18+.24*hv)*(1.+.12*sin(th*9.+hv*20.)*nearD);
    float a=catVG_cov(r-Rr,px*.8+.015);
    float orange=step(.75,fract(hv*5.9));
    vec3 lc=mix(secondary,base,smoothstep(.2,.95,r/Rr)); lc=mix(lc,accent,orange*.85);
    lc*=.85+.15*smoothstep(.0,.08,abs(fract(catN(v*14.+hv*9.)*3.)-.5))*nearD;     // areolate cracks
    lc=mix(lc,lc*1.15,smoothstep(.8,1.,r/Rr));                                     // bright growing rim
    lc=mix(lc,lc*vec3(.8,.85,.75),isDamp*.4); lc=mix(lc,lc*1.1,isDry*.3); lc=mix(lc,vec3(.75,.8,.84),isFrost*.4);
    c=mix(c,lc,a); alpha=max(alpha,a); h=mix(h,.58,a);
  }
  float speck=step(1.-.02*amt*pref,catH(floor(q*9.)+sd))*nearD; c=mix(c,base,speck*(1.-alpha)); alpha=max(alpha,speck*.9);
}`;

// Green algae: dark streaks running down from heights along the wall (under sills and ledges), a damp
// splash band at the foot, and green on up-facing ledges and soffits. A translucent stain: no relief.
const algaeStreaks = G`{
  ${ovHead}
  float start=.8+2.8*catN(vec2(metres.x*.8,sd));
  float streak=smoothstep(.45,.72,catN(vec2(metres.x*7.,ly*.2+sd))*.7+catN(vec2(metres.x*1.1,sd+4.))*.45);
  float run=smoothstep(start+.05,start-.3,ly)*(1.-.75*smoothstep(start-.3,start-.4-2.5*amt,ly))*smoothstep(.35,.55,catN(vec2(metres.x*.6,sd+9.)));
  float splash=1.-smoothstep(.05,.2+.6*amt,ly+(catN(vec2(metres.x*3.,1.))-.5)*.2);
  float flatM=max(smoothstep(.6,.9,up),smoothstep(-.6,-.9,up))*smoothstep(.3,.6,catN(q*.8)+amt*.4);
  float cov=clamp(max(max(streak*run,splash*(.6+.4*catN(q*2.))),flatM),0.,1.);
  c=mix(secondary,base,catN(q*1.5)); c=mix(c,accent,smoothstep(.6,.9,catN(q*3.))*.3*(1.-isDry));
  c=mix(c,mix(c,vec3(.12,.1,.06),.6),isDry*.5); c=mix(c,c*.7,isOld*.6);
  alpha=cov*mix(.45,.85,amt)*(1.-isFrost*.2); c=mix(c,vec3(.6,.68,.72),isFrost*.3);
  rgh=1.-.4*cov*(isDamp+.3);
}`;

export const VEG_PATTERNS = Object.freeze({
  // ---------- bark (cylindrical: q.x around the trunk, q.y up; metres.y = height on the mesh) ----------
  'bark-smooth': barkSmooth,
  'bark-fissured': barkFissured,
  'bark-scaled': barkScaled,
  'bark-peeling': barkPeeling,
  'bark-diamond': barkDiamond,
  // ---------- leaves ----------
  'leaf-palmate': sprig({ shape: 'catVG_maple', args: ',st.w', lmax: 1.02, l1: 1.5, spread: 1.05, pet: .2 }),
  'leaf-lobed': sprig({ shape: 'catVG_oak', lmax: .95, l1: 1.75, spread: .85, pet: .1 }),
  'leaf-oval': sprig({ shape: 'catVG_oval', args: ',st.w', lmax: .8, l1: 1.75, spread: .9, pet: '(st.w>1.5&&st.w<2.5?.28:.12)', post: 'if(st.w>2.5) rgh*=.55;' }),
  'leaf-fan': sprig({ shape: 'catVG_ginkgo', lmax: .78, l1: 1.6, spread: '1.', pet: .38, curl: .1 }),
  'leaf-lance': sprig({ shape: 'catVG_willow', lmax: .9, l1: 1.85, spread: .55, pet: .06, curl: .6 }),
  frond,
  needles,
  grass,
  clover,
  'flower-radial': radial,
  'flower-cup': cup,
  'flower-spike': spike,
  'flower-bell': bell,
  shrub,
  weeds,
  ivy,
  'moss-cushion': mossCushion,
  'lichen-crust': lichenCrust,
  'algae-streaks': algaeStreaks,
});
