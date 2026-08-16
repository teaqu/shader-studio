// Custom Slang vertex shader smoke test.
//
// The configured vertex stage replaces Shader Studio's fullscreen triangle
// with a smaller centered triangle, leaving the cleared background visible.

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    float3 color = float3(uv, 0.35 + 0.25 * sin(iTime));
    float gridX = step(0.92, frac(uv.x * 10.0));
    float gridY = step(0.92, frac(uv.y * 10.0));
    color = lerp(color, float3(1.0), max(gridX, gridY));

    return float4(color, 1.0);
}
