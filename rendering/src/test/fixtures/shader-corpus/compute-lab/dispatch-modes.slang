// Dispatch mode gallery. Clockwise from top-left:
// texel, count, explicit workgroups, storage cover.
float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float2 localUv = frac(uv * 2.0);
    float4 texel = sampleIChannel0(localUv);
    float4 count = sampleIChannel1(localUv);
    float4 workgroups = sampleIChannel2(localUv);
    float4 storageCover = sampleIChannel3(localUv);
    if (uv.x < 0.5 && uv.y >= 0.5) return texel;
    if (uv.x >= 0.5 && uv.y >= 0.5) return count;
    if (uv.x < 0.5) return workgroups;
    return storageCover;
}
