float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    uint packed = colors[uv.x < 0.5 ? 0 : 1];
    float3 color = float3((packed >> 16) & 255, (packed >> 8) & 255, packed & 255) / 255.0;
    float pulse = net.length > 1 ? float(net.data[1]) / 255.0 : 0.0;
    float stripe = uv.y < weights[1] ? brightness : weights[0];
    return float4(color * (stripe + pulse * 0.2), 1.0);
}
