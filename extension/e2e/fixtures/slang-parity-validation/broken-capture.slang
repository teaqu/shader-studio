float4 mainImage(float2 fragCoord)
{
    float2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.xy;

    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));

    float sq = max(abs(uv.x), abs(uv.y));
    float sqs = smoothstep(0.0, 1.0, sq);
    float sqs2 = smoothstep(0.0, 0.9, sq);
    float4 tx = float4(sqs2, sq, sqs, 1.0);
d
    float3 tun = col * sqs;
    return float4(col * sqs * 100.0, 1.0) * tx;
}
