float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float sum = tex0.SampleLevel(uv, 0).r;
    float aliasRed = alias.SampleLevel(uv, 0).r;
    float computedGreen = computed.SampleLevel(uv, 0).g;
    float3 color = float3(sum, computedGreen, 1.0 - aliasRed);
    return float4(color, 1.0);
}
