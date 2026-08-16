// BufferB — glow. Runs at HALF resolution (resolution.scale 0.5 in config).
//   iChannel0 = BufferA (previous frame — cross-buffer read)
//
// 5x5 box blur of BufferA. iResolution here is the half-size buffer's own
// resolution — per-pass resolution test.

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    float3 acc = float3(0.0, 0.0, 0.0);
    for (int i = -2; i <= 2; i++)
    {
        for (int j = -2; j <= 2; j++)
        {
            float2 off = float2(float(i), float(j)) / iResolution.xy * 2.0;
            acc += sampleIChannel0(uv + off).rgb;
        }
    }

    return float4(acc / 25.0, 1.0);
}
