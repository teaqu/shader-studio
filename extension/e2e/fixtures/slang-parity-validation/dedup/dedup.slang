float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float sum = inputs.tex0.SampleLevel(uv, 0).r + inputs.tex1.SampleLevel(uv, 0).r + inputs.tex2.SampleLevel(uv, 0).r + inputs.tex3.SampleLevel(uv, 0).r + inputs.tex4.SampleLevel(uv, 0).r + inputs.tex5.SampleLevel(uv, 0).r + inputs.tex6.SampleLevel(uv, 0).r + inputs.tex7.SampleLevel(uv, 0).r + inputs.tex8.SampleLevel(uv, 0).r + inputs.tex9.SampleLevel(uv, 0).r + inputs.tex10.SampleLevel(uv, 0).r + inputs.tex11.SampleLevel(uv, 0).r + inputs.tex12.SampleLevel(uv, 0).r + inputs.tex13.SampleLevel(uv, 0).r + inputs.tex14.SampleLevel(uv, 0).r + inputs.tex15.SampleLevel(uv, 0).r + inputs.tex16.SampleLevel(uv, 0).r + inputs.tex17.SampleLevel(uv, 0).r + inputs.tex18.SampleLevel(uv, 0).r + inputs.tex19.SampleLevel(uv, 0).r + inputs.tex20.SampleLevel(uv, 0).r + inputs.tex21.SampleLevel(uv, 0).r + inputs.tex22.SampleLevel(uv, 0).r + inputs.tex23.SampleLevel(uv, 0).r;
    float aliasRed = inputs.alias.SampleLevel(uv, 0).r;
    float computedGreen = inputs.computed.SampleLevel(uv, 0).g;
    float3 color = float3(sum / 24.0, computedGreen, 1.0 - aliasRed);
    return float4(color, 1.0);
}
