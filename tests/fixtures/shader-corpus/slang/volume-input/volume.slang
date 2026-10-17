// Same coordinates and voxel orientation as the GLSL example.
float4 mainImage(float2 fragCoord) {
    float2 uv = fragCoord / iResolution.xy;
    float3 p = float3(uv, 0.5 + 0.4 * sin(iTime));
    return iChannel0.SampleLevel(p, 0.0);
}
