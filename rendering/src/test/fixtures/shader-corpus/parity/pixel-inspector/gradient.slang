float4 mainImage(float2 p)
{
    float2 uv = p / iResolution.xy;
    return float4(uv.x, uv.y, 0.25, 1.0);
}
