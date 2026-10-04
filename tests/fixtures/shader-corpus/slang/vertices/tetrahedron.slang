// World-space tetrahedron: 12 vertices, lit by iNormal, back faces culled. Drag to orbit.
float4 mainImage(float2 fragCoord) {
    float light = max(dot(iNormal, normalize(float3(0.5, 1.0, 0.3))), 0.0);
    return float4(float3(0.15, 0.2, 0.35) + float3(0.9, 0.7, 0.4) * light, 1.0);
}
