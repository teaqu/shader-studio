// Native raster debugging fixture: an inset, projected cube with authored varyings.

struct Varyings {
  float4 position : SV_Position;
  [[vk::location(0)]] float2 uv : TEXCOORD0;
  [[vk::location(1)]] float3 worldPosition : TEXCOORD1;
  [[vk::location(2)]] float3 normal : TEXCOORD2;
};

struct FragmentOutput {
  float4 color : SV_Target0;
  float depth : SV_Depth;
};

// The standard cube mesh supplies position, normal, and UV at locations 0–2.
[shader("vertex")]
Varyings rasterVertex(
  [[vk::location(0)]] float3 position : POSITION,
  [[vk::location(1)]] float3 normal : NORMAL,
  [[vk::location(2)]] float2 uv : TEXCOORD0
) {
  // Apply the same viewer camera used by the built-in mesh vertex shader.
  float4 worldPosition = mul(iModelMatrix, float4(position * 0.65, 1));
  Varyings output;
  output.position = mul(iViewProjectionMatrix, worldPosition);
  output.uv = uv;
  output.worldPosition = worldPosition.xyz;
  output.normal = mul(iNormalMatrix, float4(normal, 0)).xyz;
  return output;
}

[shader("fragment")]
FragmentOutput rasterColor(Varyings input) {
  float3 unitNormal = normalize(input.normal);
  float3 faceTint = float3(0.08)
    + max(unitNormal.x, 0.0) * float3(0.95, 0.16, 0.10)
    + max(-unitNormal.x, 0.0) * float3(0.18, 0.72, 0.22)
    + max(unitNormal.y, 0.0) * float3(0.92, 0.72, 0.12)
    + max(unitNormal.z, 0.0) * float3(0.12, 0.32, 0.95)
    + max(-unitNormal.z, 0.0) * float3(0.12, 0.32, 0.95);
  float light = 0.30 + 0.70 * max(0.0, dot(unitNormal, normalize(float3(0.4, 0.6, 0.7))));
  // Hover or select this value in the editor for inline preview and capture.
  float3 value = (0.20 + 0.80 * input.uv.x) * (faceTint + float3(0.12)) * light;
  FragmentOutput output;
  output.color = float4(value, 1.0);
  output.depth = input.position.z;
  return output;
}
