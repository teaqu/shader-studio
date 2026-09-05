float4 mainImage(float2 fragCoord)
{
    float actual = inputs.iChannel0.Sample(float2(0.5)).r;
    float expected = float(iFrame & 1);
    return actual == expected ? float4(0.0, 0.8, 0.1, 1.0) : float4(0.9, 0.0, 0.0, 1.0);
}
