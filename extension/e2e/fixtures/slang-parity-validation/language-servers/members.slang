struct Material
{
    float3 albedo;   // base colour
    float rough;
};

float blend(float2 uv, float2 lo, float2 hi) {
    return uv.x + lo.x + hi.x;
}

float4 mainImage(float2 pixelPosition) {
    Material material;
    material.albedo = float3(0.25, 0.5, 0.75);
    material.rough = 0.5;
    float2 uv = pixelPosition / iResolution.xy;
    float weight = blend(uv, max(uv, float2(0.0, 1.0)), float2(1.0));
    return float4(material.albedo.zyx * weight, material.rough);
}
