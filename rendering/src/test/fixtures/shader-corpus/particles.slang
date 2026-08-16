// particles.slang — main Image pass: reads and renders storage buffer data
float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float4 tex = sampleIChannel0(uv);
    return tex;
}
