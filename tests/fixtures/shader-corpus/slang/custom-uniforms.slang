float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    float r = uRed;
    float g = uGreen;
    float b = 0.5 + 0.5 * sin(iTime + uOffset);

    return float4(r, g, b, 1.0);
}
