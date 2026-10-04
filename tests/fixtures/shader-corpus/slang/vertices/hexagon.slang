// Clip-space hexagon: six vertices joined as a triangle strip, fixed on screen.
float4 mainImage(float2 fragCoord) {
    float2 uv = fragCoord / iResolution.xy;
    return float4(0.5 + 0.5 * cos(iTime + uv.xyx + float3(0.0, 2.0, 4.0)), 1.0);
}
