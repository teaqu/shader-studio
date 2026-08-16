float3 source(float2 uv)
{
    float2 center = 0.5 + 0.22 * float2(cos(iTime), sin(iTime * 1.4));
    float disc = smoothstep(0.18, 0.14, length(uv - center));
    return lerp(float3(0.025, 0.04, 0.11), float3(1.0, 0.22, 0.06), uv.y) + disc * float3(0.1, 0.9, 1.3);
}

[shader("compute")]
[numthreads(8, 8, 1)]
void writeLayers(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y)
    {
        return;
    }

    uint2 coord = tid.xy;
    float2 uv = (float2(coord) + 0.5) / iResolution.xy;
    float2 texel = 1.0 / iResolution.xy;
    float3 blur = (source(uv) + source(uv + float2(texel.x, 0.0)) + source(uv - float2(texel.x, 0.0)) + source(uv + float2(0.0, texel.y)) + source(uv - float2(0.0, texel.y))) / 5.0;
    writeOutput(coord, 0u, float4(source(uv), 1.0));
    writeOutput(coord, 1u, float4(blur, 1.0));
}
