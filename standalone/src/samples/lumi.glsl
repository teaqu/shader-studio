// LUMI / Rainlight. Illustrated room + live procedural sphere.
// iChannel0: the standalone Lumi Play.webp texture, linear filter, vertical flip.
float cross2(vec2 a, vec2 b) { return a.x*b.y-a.y*b.x; }
float inTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    float x=cross2(b-a,p-a), y=cross2(c-b,p-b), z=cross2(a-c,p-c);
    return float((x>=0.&&y>=0.&&z>=0.)||(x<=0.&&y<=0.&&z<=0.));
}
float hash(float x) { return fract(sin(x*127.1)*43758.5453); }
float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 d=b-a;
    return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.));
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv=fragCoord/iResolution.xy;
    vec2 imageSize=max(iChannelResolution[0].xy,vec2(1.));
    float imageAspect=imageSize.x/imageSize.y;
    float viewAspect=iResolution.x/iResolution.y;
    vec2 fit=vec2(max(1.,imageAspect/viewAspect),max(1.,viewAspect/imageAspect));
    vec2 sceneUV=(uv-.5)*fit+.5;
    float t=iTime;
    if(any(lessThan(sceneUV,vec2(0.)))||any(greaterThan(sceneUV,vec2(1.)))) {
        fragColor=vec4(.025,.023,.045,1.); return;
    }
    // Subpixel breathing entirely inside the hoodie. A bounded polygon keeps
    // the room, her face and the character silhouette fixed.
    vec2 a=vec2(.245,.58), b=vec2(.335,.58), c=vec2(.39,.40), d=vec2(.25,.39);
    float hoodieMask=max(inTriangle(sceneUV,a,b,c),inTriangle(sceneUV,a,c,d));
    float hoodieEdge=min(min(segmentDistance(sceneUV,a,b),segmentDistance(sceneUV,b,c)),
                         min(segmentDistance(sceneUV,c,d),segmentDistance(sceneUV,d,a)));
    hoodieMask*=smoothstep(0.,.025,hoodieEdge);
    vec2 sampleUV=sceneUV;
    sampleUV.x-=.00016*sin(t*.70)*hoodieMask;
    sampleUV.y-=.00056*sin(t*.95)*hoodieMask;
    vec3 col=texture(iChannel0,sampleUV).rgb;
    vec3 cyan=vec3(.15,.85,1.), violet=vec3(.44,.24,1.), rose=vec3(1.,.25,.72);
    // Sliding water beads refract the room texture, with wet trails above them.
    float windowMask=smoothstep(.64,.67,sceneUV.x)*(1.-smoothstep(.91,.94,sceneUV.x));
    windowMask*=smoothstep(.35,.39,sceneUV.y);
    for(int layer=0;layer<2;layer++) {
        float k=float(layer), columns=37.+k*24.;
        float column=floor(sceneUV.x*columns);
        float seed=hash(column+k*81.);
        float lane=fract(sceneUV.x*columns)-(.28+.44*seed);
        float rainY=fract(sceneUV.y*(5.+k*2.)+t*(.055+.08*seed)+hash(column+13.));
        vec2 bead=vec2(lane*8.,(rainY-.18)*24.);
        float beadR=length(bead);
        float beadMask=(1.-smoothstep(.72,1.,beadR))*windowMask;
        vec2 refractUV=sampleUV-bead*vec2(.0022,.0033)*max(0.,1.-beadR*beadR);
        vec3 refracted=texture(iChannel0,clamp(refractUV,vec2(.001),vec2(.999))).rgb;
        float edge=exp(-pow((beadR-.82)*13.,2.));
        float glint=exp(-dot(bead-vec2(-.24,.38),bead-vec2(-.24,.38))*32.);
        col=mix(col,refracted*.92+vec3(.25,.40,.52)*edge*.3+vec3(.6,.8,1.)*glint*.5,beadMask);
        float trail=exp(-lane*lane*2300.)*smoothstep(.20,.24,rainY)*(1.-smoothstep(.24,.65,rainY));
        col+=vec3(.24,.36,.50)*trail*windowMask*.10;
    }
    // Shimmer in the existing triangular hair clip.
    vec2 ca=vec2(.341,.855), cb=vec2(.359,.886), cc=vec2(.364,.854);
    float clip=inTriangle(sampleUV,ca,cb,cc);
    float hue=.5+.5*sin(t*.8+sampleUV.x*160.-sampleUV.y*90.);
    col=mix(col,mix(violet,cyan,hue)*(.65+.2*sin(t*1.4)),clip*.6);
    // A real shader sphere floats just above the illustrated palm.
    vec2 center=vec2(.581,.742)+vec2(.0015*sin(t*.65),.003*sin(t*1.05));
    vec2 q=(sceneUV-center)*vec2(imageAspect,1.)/.077;
    float angle=atan(q.y,q.x);
    float surface=1.+.014*sin(angle*5.+t*1.1)+.008*sin(angle*8.-t*.8);
    q/=surface;
    float r=length(q);
    vec3 glowColor=mix(mix(rose,violet,.18+.08*sin(t*.45)),cyan,.24);
    col+=glowColor*.065*exp(-r*r*.7);
    col+=mix(glowColor,violet,.4)*.20*exp(-pow((r-1.)*10.,2.));
    if(r<1.) {
        float z=sqrt(max(0.,1.-r*r));
        vec2 waves=vec2(sin(q.y*11.+q.x*4.-t*1.3),cos(q.x*10.-q.y*5.+t*1.1));
        vec3 n=normalize(vec3(q+waves*.045,z));
        // Transmit the real room through a moving water lens.
        vec2 bend=(-q*.023*z+waves*.0025*z)/vec2(imageAspect,1.);
        vec3 transmitted=texture(iChannel0,clamp(sampleUV+bend,vec2(.001),vec2(.999))).rgb;
        vec3 color=mix(transmitted,col,.18)*vec3(1.04,.89,1.02);
        float fresnel=.035+.70*pow(1.-z,3.);
        vec3 reflection=mix(vec3(.24,.27,.50),vec3(.82,.84,1.),.5+.5*n.y);
        color=mix(color,reflection,fresnel);
        float ripple=pow(.5+.5*sin(q.y*17.+q.x*5.+sin(q.x*9.-t)*1.3-t*1.5),18.);
        color+=vec3(.85,.36,.69)*ripple*.11*z;
        // Luminous liquid ribbons curl through the transparent water.
        float magicFlow=angle*3.+z*9.+sin(q.y*5.-t*.7)*1.4-t*1.1;
        float caustic=pow(.5+.5*sin(magicFlow),20.);
        float fine=pow(.5+.5*sin(magicFlow*1.6+q.x*5.+t*.5),36.);
        float currentHue=.5+.5*sin(angle+z*2.+t*.25);
        vec3 currentColor=mix(mix(rose,vec3(.72,.43,1.),currentHue*.6),cyan,.22+.18*currentHue);
        color+=currentColor*caustic*.65;
        color+=vec3(.67,.82,1.)*fine*.25;
        // A little prism emblem drifts inside the water, using the app palette.
        float prismAngle=.12*sin(t*.45);
        vec2 prism=mat2(cos(prismAngle),-sin(prismAngle),sin(prismAngle),cos(prismAngle))*q;
        prism.x/=1.+.1*sin(t*.55);
        vec2 top=vec2(0.,.48), left=vec2(-.40,-.25), right=vec2(.40,-.25);
        float triangleEdge=min(segmentDistance(prism,top,left),min(segmentDistance(prism,left,right),segmentDistance(prism,right,top)));
        float prismCut=segmentDistance(prism,vec2(-.20,.10),vec2(.05,-.25));
        float emblem=exp(-triangleEdge*110.)+exp(-prismCut*110.)*.55;
        vec3 prismColor=mix(vec3(.75,.52,1.),rose,clamp(prism.x+.5,0.,1.));
        color+=prismColor*emblem*.43;
        color+=prismColor*exp(-triangleEdge*24.)*.055;
        float shine=pow(max(0.,dot(n,normalize(vec3(-.45,.6,1.2)))),95.);
        color+=vec3(1.,.88,.97)*shine*.85;
        color+=mix(mix(rose,violet,.25+.2*sin(angle+t*.5)),cyan,.32)*pow(1.-z,5.)*.7;
        col=mix(col,color,1.-smoothstep(.98,1.,r));
    }
    for(int i=0;i<5;i++) {
        float f=float(i), a=t*(.25+f*.025)+f*1.2566;
        vec2 mote=vec2(cos(a),sin(a))*(1.2+.13*sin(f*2.+t*.4));
        float dropR=length(q-mote)/(.035+.012*sin(f));
        float light=exp(-dot(q-mote,q-mote)*300.);
        col+=vec3(1.,.40,.78)*light*.20;
        if(dropR<1.) {
            float dropZ=sqrt(1.-dropR*dropR);
            col=mix(col,mix(col,rose,.18)+vec3(1.,.70,.93)*pow(1.-dropZ,3.)*.5,1.-smoothstep(.8,1.,dropR));
        }
    }
    fragColor=vec4(col,1.);
}

