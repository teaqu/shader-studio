float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    // The config selects the blurred second output layer.
    return inputs.iChannel0.Sample(uv);
}
