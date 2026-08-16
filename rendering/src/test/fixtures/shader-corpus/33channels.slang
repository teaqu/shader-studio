float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(0.0);

    // Sample all 33 channels (well beyond the old 16 limit)
    col += sampleIChannel0(uv).rgb;
    col += sampleIChannel1(uv).rgb;
    col += sampleIChannel2(uv).rgb;
    col += sampleIChannel3(uv).rgb;
    col += sampleIChannel4(uv).rgb;
    col += sampleIChannel5(uv).rgb;
    col += sampleIChannel6(uv).rgb;
    col += sampleIChannel7(uv).rgb;
    col += sampleIChannel8(uv).rgb;
    col += sampleIChannel9(uv).rgb;
    col += sampleIChannel10(uv).rgb;
    col += sampleIChannel11(uv).rgb;
    col += sampleIChannel12(uv).rgb;
    col += sampleIChannel13(uv).rgb;
    col += sampleIChannel14(uv).rgb;
    col += sampleIChannel15(uv).rgb;
    col += sampleIChannel16(uv).rgb;
    col += sampleIChannel17(uv).rgb;
    col += sampleIChannel18(uv).rgb;
    col += sampleIChannel19(uv).rgb;
    col += sampleIChannel20(uv).rgb;
    col += sampleIChannel21(uv).rgb;
    col += sampleIChannel22(uv).rgb;
    col += sampleIChannel23(uv).rgb;
    col += sampleIChannel24(uv).rgb;
    col += sampleIChannel25(uv).rgb;
    col += sampleIChannel26(uv).rgb;
    col += sampleIChannel27(uv).rgb;
    col += sampleIChannel28(uv).rgb;
    col += sampleIChannel29(uv).rgb;
    col += sampleIChannel30(uv).rgb;

    col /= 32.0;
    return float4(col, 1.0);
}
