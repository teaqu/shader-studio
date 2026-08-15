float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float2 drift = float2(0.7, 1.1) / iResolution.xy;
    float3 previous = sampleIChannel0(uv + drift).rgb * 0.975;
    float3 computeColor = sampleIChannel1(uv).rgb;
    float2 emitter = 0.5 + 0.28 * float2(cos(iTime * 0.8), sin(iTime * 1.1));
    float glow = exp(-90.0 * dot(uv - emitter, uv - emitter));
    float3 next = max(previous, computeColor * glow);
    return float4(next, 1.0);
}
