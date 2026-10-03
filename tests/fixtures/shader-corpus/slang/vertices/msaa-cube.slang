// A cube with four-sample MSAA. Its silhouette should have partially covered edge pixels.
float4 mainImage(float2 fragCoord) {
    float3 light = normalize(float3(0.4, 1.0, 0.3));
    float shade = 0.25 + 0.75 * max(dot(normalize(iNormal), light), 0.0);
    return float4(float3(0.2, 0.65, 1.0) * shade, 1.0);
}
