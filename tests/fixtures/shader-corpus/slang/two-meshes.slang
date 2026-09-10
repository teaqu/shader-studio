// Image renders CatBody while BufferA renders CatHead from the same GLB fixture.
float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float light = 0.3 + 0.7 * max(dot(normalize(iNormal), normalize(float3(0.4, 0.8, 0.3))), 0.0);
    float3 body = lerp(float3(0.03, 0.1, 0.28), float3(0.06, 0.7, 1.0), uv.y) * light;
    return float4(body + inputs.iChannel0.Sample(uv).rgb * 0.35, 1.0);
}
