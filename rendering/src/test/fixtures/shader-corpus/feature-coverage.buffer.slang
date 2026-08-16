float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 textureColor = samplePatternTex(uv).rgb;
    float pulse = 0.5 + 0.5 * sin(iTime + uFloat);
    return float4(lerp(textureColor, coveragePalette(uv.x * 3.0), pulse * 0.35), 1.0);
}
