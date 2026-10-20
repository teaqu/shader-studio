#define SHADER_STUDIO_VR_INPUTS
// CONTROLLER LAB — disable VR > Enable headset navigation before entering.
// Head tracking stays active. Hold buttons; release to restore the sculpture.
// Left stick: move sculpture / click: wireframe. Right stick: twist & hue / click: negative.
// Left trigger: fire. Right trigger: lightning. Left grip: inflate. Right grip: cube morph.
// X: rainbow. Y: halo rings. A: orbiting satellites. B: ripple floor.
// Point either controller: coloured aim beam. Touch controls: cyan/pink aura.
// Desktop overview animates a short showcase when no headset is active.
float lt, rt, lg, rg, bx, by, ba, bb, lc, rc;
vec2 ls, rs;
void controls() {
    lt=iVRControllerButtons[0].x; rt=iVRControllerButtons[1].x;
    lg=iVRControllerButtons[0].y; rg=iVRControllerButtons[1].y;
    lc=iVRControllerButtons[0].w; rc=iVRControllerButtons[1].w;
    bx=iVRControllerFaceButtons[0].x; by=iVRControllerFaceButtons[0].y;
    ba=iVRControllerFaceButtons[1].x; bb=iVRControllerFaceButtons[1].y;
    ls=iVRControllerAxes[0].zw; rs=iVRControllerAxes[1].zw;
    if (!iVRActive) {
        float phase=mod(iTime*0.45,8.0);
        lt=float(phase<1.0); rt=float(phase>=1.0 && phase<2.0);
        lg=float(phase>=2.0 && phase<3.0); rg=float(phase>=3.0 && phase<4.0);
        bx=float(phase>=4.0 && phase<5.0); by=float(phase>=5.0 && phase<6.0);
        ba=float(phase>=6.0 && phase<7.0); bb=float(phase>=7.0);
    }
}
mat2 rot(float a) { return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec3 palette(float t) { return 0.55+0.45*cos(6.28318*(t+vec3(0.0,0.33,0.67))); }
vec3 centre() { return vec3(ls.x*1.2, 0.2-ls.y, -3.8); }
float sculpture(vec3 p) {
    vec3 q=p-centre();
    q.xz=rot(iTime*0.18+rs.x*3.0+q.y*rs.y*2.0)*q.xz;
    float radius=0.8+lg*0.55;
    float sphere=length(q)-radius+abs(rs.x)*0.10*sin(q.y*9.0+atan(q.z,q.x)*4.0+rs.x*3.0);
    vec3 b=abs(q)-vec3(radius*0.74);
    float cube=length(max(b,0.0))+min(max(b.x,max(b.y,b.z)),0.0)-0.06;
    float d=mix(sphere,cube,rg);
    d+=lt*0.055*sin(q.x*12.0+iTime*6.0)*sin(q.y*15.0-iTime*4.0)*sin(q.z*11.0);
    return d;
}
vec3 normalAt(vec3 p) {
    vec2 e=vec2(0.002,0.0);
    return normalize(vec3(sculpture(p+e.xyy)-sculpture(p-e.xyy),
                          sculpture(p+e.yxy)-sculpture(p-e.yxy),
                          sculpture(p+e.yyx)-sculpture(p-e.yyx)));
}
float satelliteDistance(vec3 p) {
    float d=50.0;
    for(int j=0;j<5;j++) {
        float a=iTime*0.8+float(j)*1.2566;
        vec3 c=centre()+vec3(cos(a)*1.6,sin(a*1.7)*0.65,sin(a)*1.2);
        d=min(d,length(p-c)-0.13);
    }
    return d;
}
vec3 renderLab(vec3 ro, vec3 rd) {
    controls();
    vec3 col=mix(vec3(0.012,0.018,0.055),vec3(0.06,0.015,0.10),max(rd.y,0.0));
    float travel=0.0, glow=0.0;
    vec3 beams=vec3(0);
    bool hit=false;
    for(int j=0;j<96;j++) {
        vec3 p=ro+rd*travel;
        float d=sculpture(p);
        for(int hand=0;hand<2;hand++) {
            if(iVRControllerPosition[hand].w>0.5 && iVRControllerDirection[hand].w>0.5) {
                vec3 offset=p-iVRControllerPosition[hand].xyz;
                vec3 aim=iVRControllerDirection[hand].xyz;
                float along=dot(offset,aim);
                float beam=length(offset-aim*max(along,0.0));
                beams+=exp(-beam*45.0)*0.04*(hand==0 ? vec3(0.0,0.6,1.0) : vec3(1.0,0.15,0.6));
            }
        }
        if(ba>0.0) d=min(d,satelliteDistance(p));
        if(by>0.0) {
            vec3 q=p-centre(); q.xy=rot(0.45)*q.xy;
            d=min(d,length(vec2(length(q.xz)-1.55,q.y))-0.035);
        }
        glow+=exp(-abs(d)*16.0)*0.018;
        if(d<0.002) { hit=true; break; }
        travel+=max(d*0.75,0.004);
        if(travel>18.0) break;
    }
    if(hit) {
        vec3 p=ro+rd*travel, q=p-centre(), n=normalAt(p);
        vec3 base=mix(vec3(0.05,0.55,0.85),palette(q.y*0.3+iTime*0.1+rs.y),bx);
        base=mix(base,vec3(1.0,0.18,0.015),lt);
        float light=0.25+0.75*max(dot(n,normalize(vec3(-2,3,2))),0.0);
        float rim=pow(1.0-abs(dot(n,-rd)),2.0);
        float fire=pow(0.5+0.5*sin(q.y*19.0-iTime*10.0+sin(q.x*13.0)),3.0);
        float bolt=pow(max(0.0,1.0-abs(sin(atan(q.z,q.x)*7.0+q.y*5.0+sin(q.y*23.0+iTime*9.0)*0.8))),12.0);
        float wire=1.0-smoothstep(0.03,0.08,min(abs(sin(q.x*15.0)),abs(sin(q.y*15.0))));
        col=base*(light+rim*0.9)+lt*fire*vec3(2.0,0.55,0.03)+rt*bolt*vec3(1.0,2.0,3.0);
        col=mix(col*0.1,col+vec3(0.1,0.8,1.0)*wire,1.0-lc+lc*wire);
    }
    // Floor depth cue and a separate radial wave effect on B.
    if(rd.y< -0.01) {
        float ground=(-1.45-ro.y)/rd.y;
        if(ground>0.0 && (!hit || ground<travel)) {
            vec3 p=ro+rd*ground;
            vec2 g=abs(fract(p.xz)-0.5);
            float grid=1.0-smoothstep(0.015,0.04,min(g.x,g.y));
            float waves=pow(0.5+0.5*sin(length(p.xz-centre().xz)*10.0-iTime*5.0),6.0);
            col=vec3(0.015,0.03,0.05)+grid*vec3(0.03,0.15,0.2)+bb*waves*vec3(0.3,0.08,0.7);
            col*=exp(-ground*0.045);
        }
    }
    col+=glow*mix(vec3(0.05,0.3,0.6),vec3(0.9,0.18,0.01),lt);
    col+=beams;
    for(int hand=0;hand<2;hand++) {
        float touch=dot(iVRControllerTouches[hand],vec4(1,2,0,4))+dot(iVRControllerFaceTouches[hand],vec4(8,16,0,0));
        col+=(touch/31.0)*(hand==0 ? vec3(0.0,0.5,0.7) : vec3(0.7,0.05,0.4));
    }
    col=palette(rs.y*0.25)*col*2.0;
    col=1.0-exp(-col);
    col=mix(col,1.0-col,rc);
    return pow(max(col,0.0),vec3(0.4545));
}
void mainImage(out vec4 c,in vec2 p) {
    vec2 uv=(2.0*p-iResolution.xy)/iResolution.y;
    c=vec4(renderLab(vec3(0,0.15,0.8),normalize(vec3(uv,-1.5))),1);
}
void mainVR(out vec4 c,in vec2 p,in vec3 ro,in vec3 rd) {
    c=vec4(renderLab(ro,normalize(rd)),1);
}
