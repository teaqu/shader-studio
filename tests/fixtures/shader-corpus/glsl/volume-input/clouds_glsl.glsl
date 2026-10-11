// Baked 48³ R8 density: every density and shadow lookup samples the volume file.
float density(vec3 p) { return texture(iChannel0, p * 0.5 + 0.5).r; }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
    float angle = iTime * 0.16;
    vec3 ro = vec3(3.2 * sin(angle), 1.1, 3.2 * cos(angle));
    vec3 forward = normalize(-ro);
    vec3 right = normalize(cross(forward, vec3(0,1,0)));
    vec3 up = cross(right, forward);
    vec3 rd = normalize(forward * 1.8 + uv.x * right + uv.y * up);
    vec3 bg = mix(vec3(0.035,0.07,0.15), vec3(0.26,0.43,0.62), clamp(uv.y * 0.3 + 0.5,0.0,1.0));
    vec3 accum = vec3(0); float trans = 1.0;
    for(int i=0;i<100;i++) {
        vec3 p = ro + rd * (1.5 + float(i) * 0.045);
        if(max(max(abs(p.x),abs(p.y)),abs(p.z)) > 1.0) continue;
        float d = max(density(p)-0.12,0.0);
        vec3 lightDir = normalize(vec3(-0.7,1.0,0.5));
        float shadow = density(clamp(p+lightDir*0.14,vec3(-1),vec3(1))) + density(clamp(p+lightDir*0.3,vec3(-1),vec3(1)));
        vec3 color = mix(vec3(0.17,0.27,0.42),vec3(1.0,0.87,0.66),exp(-shadow*2.3));
        float alpha = 1.0-exp(-d*0.045*9.0);
        accum += trans * alpha * color;
        trans *= 1.0-alpha;
    }
    fragColor = vec4(pow(accum+trans*bg,vec3(0.8)),1);
}
