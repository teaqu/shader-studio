// Baked 48³ R8 density: every density and shadow lookup samples the volume file.
// Explicit LOD permits volume sampling inside divergent raymarch control flow.
float density(float3 p) { return iChannel0.SampleLevel( p * 0.5 + 0.5, 0.0).r; }
float4 mainImage(float2 fragCoord) {
    float2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
    float angle = iTime * 0.16;
    float3 ro = float3(3.2 * sin(angle), 1.1, 3.2 * cos(angle));
    float3 forward = normalize(-ro);
    float3 right = normalize(cross(forward, float3(0,1,0)));
    float3 up = cross(right, forward);
    float3 rd = normalize(forward * 1.8 + uv.x * right + uv.y * up);
    float3 bg = lerp(float3(0.035,0.07,0.15), float3(0.26,0.43,0.62), clamp(uv.y * 0.3 + 0.5,0.0,1.0));
    float3 accum = float3(0); float trans = 1.0;
    for(int i=0;i<100;i++) {
        float3 p = ro + rd * (1.5 + float(i) * 0.045);
        if(max(max(abs(p.x),abs(p.y)),abs(p.z)) > 1.0) continue;
        float d = max(density(p)-0.12,0.0);
        float3 lightDir = normalize(float3(-0.7,1.0,0.5));
        float shadow = density(clamp(p+lightDir*0.14,float3(-1),float3(1))) + density(clamp(p+lightDir*0.3,float3(-1),float3(1)));
        float3 color = lerp(float3(0.17,0.27,0.42),float3(1.0,0.87,0.66),exp(-shadow*2.3));
        float alpha = 1.0-exp(-d*0.045*9.0);
        accum += trans * alpha * color;
        trans *= 1.0-alpha;
    }
    return float4(pow(accum+trans*bg,float3(0.8)),1);
}
