// mainVertex puts cube vertices inside WebGPU clip space; viewer transforms are disabled.
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) { position *= 0.65; }
[shader("fragment")] float4 cameraColor([[vk::location(0)]] float2 uv : TEXCOORD0, [[vk::location(1)]] float3 worldPosition : TEXCOORD1, [[vk::location(2)]] float3 normal : TEXCOORD2) : SV_Target0 {
  float3 unitNormal = normalize(normal);
  float3 faceTint = abs(unitNormal) * 0.6;
  float3 gradient = float3(uv * 0.3, 0.1);
  float3 color = faceTint + gradient;
  return float4(color, 1.0);
}
