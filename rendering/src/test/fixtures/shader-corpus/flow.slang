// Image pass — composites BufferA (sharp paint) + BufferB (half-res glow).
//
// Channels (see flow.sv.json):
//   iChannel0 = BufferA  (sampled — current frame)
//   iChannel1 = BufferB  (sampled — current frame, half resolution)
//   iChannel2 = BufferA  (declared but NEVER sampled — exercises the
//                         explicit bind-group layout with an unused channel;
//                         must produce zero WebGPU validation errors)
//
// Orientation markers: RED bar must appear along the TOP edge and GREEN
// along the LEFT edge. If red shows at the bottom, the v-flip is wrong.

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    // `palette` comes from common.slang — proves common code reaches Image.
    float3 col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;

    float3 sharp = sampleIChannel0(uv).rgb;
    float3 glow = sampleIChannel1(uv).rgb;
    col += sharp + 0.6 * glow * glow;

    if (uv.y > 0.985) col = float3(1.0, 0.0, 0.0); // TOP edge = red
    if (uv.x < 0.008) col = float3(0.0, 1.0, 0.0); // LEFT edge = green

    return float4(col, 1.0);
}
