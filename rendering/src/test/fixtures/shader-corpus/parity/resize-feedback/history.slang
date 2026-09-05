float4 mainImage(float2 p)
{
    float2 uv = p / iResolution.xy;
    float4 previous = inputs.iChannel0.Sample(uv);
    // Fixed pixel coordinates make the resize contract unambiguous: feedback
    // preserves its absolute position relative to the bottom-left corner.
    float seed = iFrame < 8 && length(p - float2(64.0, 64.0)) < 18.0 ? 1.0 : 0.0;
    return max(previous, float4(seed, seed, seed, 1.0));
}
