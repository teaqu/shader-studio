float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float sum = tex0.SampleLevel(uv, 0).r + tex1.SampleLevel(uv, 0).r + tex2.SampleLevel(uv, 0).r + tex3.SampleLevel(uv, 0).r + tex4.SampleLevel(uv, 0).r + tex5.SampleLevel(uv, 0).r + tex6.SampleLevel(uv, 0).r + tex7.SampleLevel(uv, 0).r + tex8.SampleLevel(uv, 0).r + tex9.SampleLevel(uv, 0).r + tex10.SampleLevel(uv, 0).r + tex11.SampleLevel(uv, 0).r + tex12.SampleLevel(uv, 0).r + tex13.SampleLevel(uv, 0).r + tex14.SampleLevel(uv, 0).r + tex15.SampleLevel(uv, 0).r + tex16.SampleLevel(uv, 0).r + tex17.SampleLevel(uv, 0).r + tex18.SampleLevel(uv, 0).r + tex19.SampleLevel(uv, 0).r + tex20.SampleLevel(uv, 0).r + tex21.SampleLevel(uv, 0).r + tex22.SampleLevel(uv, 0).r + tex23.SampleLevel(uv, 0).r;
    float aliasRed = alias.SampleLevel(uv, 0).r;
    float computedGreen = computed.SampleLevel(uv, 0).g;
    float3 color = float3(sum / 24.0, computedGreen, 1.0 - aliasRed);
    return float4(color, 1.0);
}
