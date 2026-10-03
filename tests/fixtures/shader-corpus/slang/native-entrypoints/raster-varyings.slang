// Native raster debugging fixture: authored varyings plus structured color/depth output.

struct Varyings {
  float4 position : SV_Position;
  float2 uv : TEXCOORD0;
  float3 tint : TEXCOORD1;
};

struct FragmentOutput {
  float4 color : SV_Target0;
  float depth : SV_Depth;
};

// Cube mesh layout supplies position at location 0 (the complete stride is 32 bytes).
[shader("vertex")]
Varyings rasterVertex([[vk::location(0)]] float3 position : POSITION) {
  float2 point = position.xy * 2.0;
  float depth = position.z * 0.25 + 0.5;
  Varyings output;
  output.position = float4(point, depth, 1);
  output.uv = point * 0.5 + 0.5;
  output.tint = float3(0.20, 0.55, 0.95);
  return output;
}

[shader("fragment")]
FragmentOutput rasterColor(Varyings input) {
  // Hover or select this value in the editor for inline preview and capture.
  float3 value = input.uv.x * input.tint;
  float depth = input.position.z;
  FragmentOutput output;
  output.color = float4(value, 1.0);
  output.depth = depth;
  return output;
}
