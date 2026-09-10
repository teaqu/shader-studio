// Intentionally directive-free: Shader Studio must compile this in legacy mode.
float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 color = float3(0.08, 0.02, 0.02);
    if (uv.x < 0.5 && uv.y > 0.5)
        color = float3(1.0, 0.12, 0.08);
    return float4(color, 1.0);
}
