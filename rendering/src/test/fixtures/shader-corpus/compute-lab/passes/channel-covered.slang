[shader("compute")]
[numthreads(8, 8, 1)]
void transformCoveredChannel(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y)
    {
        return;
    }

    float2 uv = (float2(tid.xy) + 0.5) / iResolution.xy;
    float3 source = sampleIChannel0(uv).rgb;
    writeOutput(tid.xy, float4(source.bgr * float3(1.0, 0.8, 1.2), 1.0));
}
