// Clip-space points: 1024 single-pixel points on a swirling 32x32 grid.
float4 mainImage(float2 fragCoord) {
    return float4(fragCoord / iResolution.xy, 1.0, 1.0);
}
