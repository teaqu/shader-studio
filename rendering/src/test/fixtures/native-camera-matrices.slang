struct CameraVaryings {
  float4 position : SV_Position;
  float2 uv : TEXCOORD0;
  float3 normal : TEXCOORD1;
};

[shader("vertex")]
CameraVaryings cameraVertex(
  [[vk::location(0)]] float3 position : POSITION,
  [[vk::location(1)]] float3 normal : NORMAL,
  [[vk::location(2)]] float2 uv : TEXCOORD0
) {
  CameraVaryings output;
  float4 world = mul(iModelMatrix, float4(position, 1));
  output.position = mul(iViewProjectionMatrix, world);
  output.uv = uv;
  output.normal = mul(iNormalMatrix, float4(normal, 0)).xyz;
  return output;
}

[shader("fragment")]
float4 cameraColor(CameraVaryings input) : SV_Target0 {
  float brightness = 0.30 + 0.70 * max(0.0, dot(normalize(input.normal), normalize(float3(0.4, 0.6, 0.7))));
  return float4((0.25 + 0.75 * input.uv.x) * abs(input.normal) * brightness, 1);
}
