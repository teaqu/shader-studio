// Legacy hooks may live together in one Slang file. No `vertex` path is needed.
void mainVertex(inout float3 position, inout float3 normal, inout float2 uv)
{
  position.xy *= 0.72;
}

float4 mainImage(float2 coord)
{
  float2 uv = coord / iResolution.xy;
  return float4(uv.x, uv.y, 0.6, 1.0);
}
