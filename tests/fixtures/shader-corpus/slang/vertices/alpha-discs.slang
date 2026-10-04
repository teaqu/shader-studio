// Three see-through discs with alpha blending. uv.x carries disc id + local x, so mainImage can colour each.
float4 mainImage(float2 fragCoord) {
    float t = fragCoord.x / iResolution.x * 3.0;
    float id = floor(t);
    float2 local = float2(frac(t), fragCoord.y / iResolution.y) - 0.5;
    float disc = smoothstep(0.5, 0.47, length(local));
    float3 colour = id < 1.0 ? float3(1.0, 0.2, 0.2) : (id < 2.0 ? float3(0.2, 1.0, 0.2) : float3(0.2, 0.4, 1.0));
    return float4(colour, 0.6 * disc);
}
