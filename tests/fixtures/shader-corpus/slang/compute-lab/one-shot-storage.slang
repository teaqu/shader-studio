float4 mainImage(float2 fragCoord)
{
    float2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    float radius = length(p - seed[0].xy);
    float ring = smoothstep(0.025, 0.0, abs(radius - 0.45));
    return float4(float3(0.015, 0.025, 0.05) + ring * float3(0.2, 0.8, 1.0), 1.0);
}
