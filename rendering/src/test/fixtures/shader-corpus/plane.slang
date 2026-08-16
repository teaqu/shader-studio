float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    // Simple lighting based on the displaced normal
    float3 lightDir = normalize(float3(0.5, 1.0, 0.3));
    float3 normal = normalize(iNormal);
    float diffuse = max(dot(normal, lightDir), 0.0);

    // Grid pattern to show the displacement
    float2 grid = abs(frac(uv * 10.0) - 0.5) * 2.0;
    float line = 1.0 - min(grid.x, grid.y);
    line = 1.0 - smoothstep(0.0, 0.1, line);

    float3 col = lerp(float3(0.1, 0.15, 0.3), float3(0.4, 0.6, 1.0), diffuse);
    col = lerp(col, float3(1.0), line * 0.3);

    return float4(col, 1.0);
}
