// gravity.slang — main Image pass: reads gravity sim output
float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float4 tex = sampleIChannel0(uv);
    return tex;
}
