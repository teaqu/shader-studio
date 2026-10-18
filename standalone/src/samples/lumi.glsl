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
    // Gentle breathing stays inside the hoodie, fading before its silhouette.
    vec2 sampleUV=sceneUV;
    vec2 chest=(sceneUV-vec2(.345,.48))/vec2(.105,.16);
    float breathMask=pow(max(0.,1.-dot(chest,chest)),2.);
    sampleUV.y-=sin(t*1.15)*.0024*breathMask;
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
    // Pearl-lilac water picks up the blue and orchid ends of Lumi's hair.
    vec3 ice=vec3(.32,.64,1.);
    vec3 orchid=vec3(.94,.25,.80);
    vec3 pearl=vec3(.87,.80,1.);
    col+=mix(ice,orchid,.35)*.035*exp(-r*r*1.2);
    if(r<1.) {
        float z=sqrt(max(0.,1.-r*r));
        vec2 flow=vec2(sin(q.y*5.+q.x*2.-t*.65),cos(q.x*6.-q.y*2.+t*.55));
        vec3 n=normalize(vec3(q+flow*.025,z));
        vec2 bend=(-q*.035*z+flow*.0018*z)/vec2(imageAspect,1.);
        vec3 transmitted=texture(iChannel0,clamp(sampleUV+bend,vec2(.001),vec2(.999))).rgb;
        float fresnel=.06+.78*pow(1.-z,3.);
        float hue=smoothstep(-.55,.65,n.x-n.y*.4);
        vec3 tint=mix(ice,orchid,hue);
        vec3 color=transmitted*vec3(.83,.89,1.03);
        color=mix(color,mix(ice,pearl,.45),.15*z);
        color=mix(color,tint*.72+pearl*.16,fresnel);
        // Broad curved reflections and fine caustics, like light on liquid.
        float current=q.y+.23*sin(q.x*3.5+t*.55)+.10*sin(q.x*7.-t*.8);
        float ribbon=exp(-pow((current+.22)*15.,2.));
        float lower=exp(-pow((current+.48)*25.,2.));
        color+=mix(ice,orchid,smoothstep(-.6,.4,q.x))*ribbon*.32*z;
        color+=orchid*lower*.36*z;
        float caustic=sin(q.x*12.+flow.y*2.+t*.4)*sin(q.y*14.+flow.x*2.-t*.5);
        color+=mix(ice,pearl,.55)*pow(max(0.,caustic),8.)*.15*z;
        // Soft window reflection breaks into bright wet glints at the edge.
        float reflection=exp(-pow((q.x+.37+.12*q.y)*12.,2.))*smoothstep(-.25,.15,q.y)*(1.-smoothstep(.65,.90,q.y));
        color+=pearl*reflection*.55;
        float shine=pow(max(0.,dot(n,normalize(vec3(-.5,.65,1.)))),110.);
        color+=vec3(.96,.92,1.)*shine*.85;
        float rim=pow(1.-z,4.);
        color+=mix(ice,orchid,hue)*rim*.45;
        // Small submerged studio prism, softened by the water.
        vec2 top=vec2(0.,.34), left=vec2(-.28,-.18), right=vec2(.28,-.18);
        float edge=min(segmentDistance(q,top,left),min(segmentDistance(q,left,right),segmentDistance(q,right,top)));
        color+=mix(ice,pearl,.6)*exp(-edge*100.)*.13;
        col=mix(col,color,1.-smoothstep(.98,1.,r));
    }
    for(int i=0;i<5;i++) {
        float f=float(i), a=t*(.25+f*.025)+f*1.2566;
        vec2 mote=vec2(cos(a),sin(a))*(1.2+.13*sin(f*2.+t*.4));
        float dropR=length(q-mote)/(.035+.012*sin(f));
        float light=exp(-dot(q-mote,q-mote)*300.);
        vec3 dropColor=mix(cyan,rose,mod(f,2.));
        col+=dropColor*light*.20;
        if(dropR<1.) {
            float dropZ=sqrt(1.-dropR*dropR);
            col=mix(col,mix(col,dropColor,.18)+mix(vec3(.65,.88,1.),vec3(1.,.65,.9),mod(f,2.))*pow(1.-dropZ,3.)*.5,1.-smoothstep(.8,1.,dropR));
        }
    }
    fragColor=vec4(col,1.);
}
