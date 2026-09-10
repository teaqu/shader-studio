float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(0.0);

    // Sample all 33 channels (well beyond the old 16 limit)
    col += inputs.iChannel0.Sample(uv).rgb;
    col += inputs.iChannel1.Sample(uv).rgb;
    col += inputs.iChannel2.Sample(uv).rgb;
    col += inputs.iChannel3.Sample(uv).rgb;
    col += inputs.iChannel4.Sample(uv).rgb;
    col += inputs.iChannel5.Sample(uv).rgb;
    col += inputs.iChannel6.Sample(uv).rgb;
    col += inputs.iChannel7.Sample(uv).rgb;
    col += inputs.iChannel8.Sample(uv).rgb;
    col += inputs.iChannel9.Sample(uv).rgb;
    col += inputs.iChannel10.Sample(uv).rgb;
    col += inputs.iChannel11.Sample(uv).rgb;
    col += inputs.iChannel12.Sample(uv).rgb;
    col += inputs.iChannel13.Sample(uv).rgb;
    col += inputs.iChannel14.Sample(uv).rgb;
    col += inputs.iChannel15.Sample(uv).rgb;
    col += inputs.iChannel16.Sample(uv).rgb;
    col += inputs.iChannel17.Sample(uv).rgb;
    col += inputs.iChannel18.Sample(uv).rgb;
    col += inputs.iChannel19.Sample(uv).rgb;
    col += inputs.iChannel20.Sample(uv).rgb;
    col += inputs.iChannel21.Sample(uv).rgb;
    col += inputs.iChannel22.Sample(uv).rgb;
    col += inputs.iChannel23.Sample(uv).rgb;
    col += inputs.iChannel24.Sample(uv).rgb;
    col += inputs.iChannel25.Sample(uv).rgb;
    col += inputs.iChannel26.Sample(uv).rgb;
    col += inputs.iChannel27.Sample(uv).rgb;
    col += inputs.iChannel28.Sample(uv).rgb;
    col += inputs.iChannel29.Sample(uv).rgb;
    col += inputs.iChannel30.Sample(uv).rgb;

    col /= 32.0;
    return float4(col, 1.0);
}
