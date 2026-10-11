// One Slang module powers a compute pass, a buffer pass, and Image.

[shader("vertex")]
float4 fullscreenVertex(uint index : SV_VertexID) : SV_Position {
  float2 triangle[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
  return float4(triangle[index], 0, 1);
}

[shader("compute")]
[numthreads(1, 1, 1)]
void advance(uint3 id : SV_DispatchThreadID) {
  if (id.x == 0) { samples[0] = 0.35 + 0.15 * sin(iTime); }
}

[shader("fragment")]
float4 bufferWarm() : SV_Target { return float4(samples[0], 0.12, 0.04, 1); }

[shader("fragment")]
float4 bufferCool() : SV_Target { return float4(0.04, samples[0], 0.38, 1); }

[shader("fragment")]
float4 present(float4 coord : SV_Position) : SV_Target {
  float2 uv = coord.xy / iResolution.xy;
  float4 buffer = iChannel0.Sample(uv);
  return float4(buffer.z, buffer.y, buffer.x, 1);
}
