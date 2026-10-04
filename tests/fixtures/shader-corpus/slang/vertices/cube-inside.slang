// A cube with "cull": "front": the near faces are skipped, so you see the inside walls. Drag to orbit.
float4 mainImage(float2 fragCoord) {
    float3 grid = step(0.94, frac((iWorldPosition + 0.5) * 4.0));
    float lines = max(max(grid.x, grid.y), grid.z);
    float3 colour = abs(iNormal) * 0.7 + 0.1;
    return float4(lerp(colour, float3(1.0), lines), 1.0);
}
