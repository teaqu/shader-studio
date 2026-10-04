// Each instance gets its own hue from iInstanceIndex / iInstanceCount. Drag to orbit.
float4 mainImage(float2 fragCoord) {
    float t = float(iInstanceIndex) / float(iInstanceCount);
    float3 hue = 0.5 + 0.5 * cos(6.2831853 * (t + float3(0.0, 0.33, 0.67)));
    float light = 0.35 + 0.65 * max(dot(normalize(iNormal), normalize(float3(0.4, 1.0, 0.3))), 0.0);
    return float4(hue * light, 1.0);
}
