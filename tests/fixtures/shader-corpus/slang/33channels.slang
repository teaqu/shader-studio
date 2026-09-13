float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(0.0);

    // Sample all 33 channels (well beyond the old 16 limit)
    col += iChannel0.Sample(uv).rgb;
    col += iChannel1.Sample(uv).rgb;
    col += iChannel2.Sample(uv).rgb;
    col += iChannel3.Sample(uv).rgb;
    col += iChannel4.Sample(uv).rgb;
    col += iChannel5.Sample(uv).rgb;
    col += iChannel6.Sample(uv).rgb;
    col += iChannel7.Sample(uv).rgb;
    col += iChannel8.Sample(uv).rgb;
    col += iChannel9.Sample(uv).rgb;
    col += iChannel10.Sample(uv).rgb;
    col += iChannel11.Sample(uv).rgb;
    col += iChannel12.Sample(uv).rgb;
    col += iChannel13.Sample(uv).rgb;
    col += iChannel14.Sample(uv).rgb;
    col += iChannel15.Sample(uv).rgb;
    col += iChannel16.Sample(uv).rgb;
    col += iChannel17.Sample(uv).rgb;
    col += iChannel18.Sample(uv).rgb;
    col += iChannel19.Sample(uv).rgb;
    col += iChannel20.Sample(uv).rgb;
    col += iChannel21.Sample(uv).rgb;
    col += iChannel22.Sample(uv).rgb;
    col += iChannel23.Sample(uv).rgb;
    col += iChannel24.Sample(uv).rgb;
    col += iChannel25.Sample(uv).rgb;
    col += iChannel26.Sample(uv).rgb;
    col += iChannel27.Sample(uv).rgb;
    col += iChannel28.Sample(uv).rgb;
    col += iChannel29.Sample(uv).rgb;
    col += iChannel30.Sample(uv).rgb;

    col /= 32.0;
    return float4(col, 1.0);
}
