// Three orthogonal planes move through the baked 3D density asset.
// Each panel samples a different axis: XY, YZ, XZ. No density is generated here.
float4 mainImage(float2 fragCoord) {
    float2 uv = fragCoord / iResolution.xy;
    float panel = floor(uv.x*3.0);
    float2 q = float2(frac(uv.x*3.0),uv.y);
    q = (q-0.5)*float2(1.1,1.1)+0.5;
    float slice = 0.5+0.44*sin(iTime*0.55);
    float3 p = panel < 1.0 ? float3(q,slice) : panel < 2.0 ? float3(slice,q) : float3(q.x,slice,q.y);
    float d = iChannel0.SampleLevel(p, 0.0).r;
    float3 color = lerp(float3(0.015,0.025,0.05), float3(0.05,0.75,1.0), smoothstep(0.02,0.4,d));
    color = lerp(color,float3(1.0,0.35,0.12),smoothstep(0.4,0.8,d));
    float contour = 1.0-smoothstep(0.0,0.06,abs(frac(d*12.0)-0.5));
    color += contour * 0.13;
    float border = step(0.01,q.x)*step(q.x,0.99)*step(0.01,q.y)*step(q.y,0.99);
    return float4(color*border,1);
}
