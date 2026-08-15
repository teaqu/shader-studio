[shader("compute")]
[numthreads(8, 8, 1)]
void buildPattern(uint3 dispatchThreadID : SV_DispatchThreadID)
{
    uint2 pixel = dispatchThreadID.xy;
    float2 uv = (float2(pixel) + 0.5) / iResolution.xy;
    float wave = 0.5 + 0.5 * sin(uv.x * 18.0 + uv.y * 11.0 + iTime * 2.0);
    float3 color = lerp(kParityAccent * 0.15, parityPalette(wave), 0.8);
    writeOutput(pixel, float4(color, 1.0));
}
