float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float2 centered = uv - 0.5;
    float angle = 0.15 + uFloat * 0.2;
    float sine = sin(angle);
    float cosine = cos(angle);
    float2 rotated = mul(float2x2(cosine, -sine, sine, cosine), centered) + 0.5;

    float weights[3] = { 0.2, 0.3, 0.5 };
    float weighted = 0.0;
    [unroll]
    for (int index = 0; index < 3; ++index)
    {
        weighted += weights[index];
    }

    CoverageSample sample;
    sample.color = inputs.patternTex.Sample(rotated).rgb;
    sample.energy = dot(sample.color, float3(0.299, 0.587, 0.114));
    float3 history = inputs.historyBuffer.Sample(uv).rgb;
    float edge = saturate(length(float2(ddx(sample.energy), ddy(sample.energy))) * 8.0);
    uint flags = (uint(iFrame) & 1u) | 2u;
    float flagValue = (flags == 2u) ? 1.0 : 0.75;
    float channelReady = inputs.patternTex.size.x > 0 ? 1.0 : 0.0;

    float3 color = lerp(coverageGain(sample.color), history, 0.35);
    color += coveragePalette(uv.y * 4.0 + iTime) * edge * 0.15;
    color *= weighted * flagValue * channelReady;
    color = lerp(color, uVec3, uBool ? 0.08 : 0.0);
    color += float3(uVec2, uVec4.x) * 0.03;
    return float4(saturate(color), 1.0);
}
