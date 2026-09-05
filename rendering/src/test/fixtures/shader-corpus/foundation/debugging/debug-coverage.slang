#language slang 2026
module debug_coverage_image;
import debugpalette;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 history = inputs.iChannel0.Sample(uv).rgb;

    float phase = uv.x * 1.75 + uv.y * 0.5 + iTime * 0.08;
    float3 paletteColor = debugPalette(phase);
    float scanline = 0.75 + 0.25 * sin(uv.y * iResolution.y * 0.16 + iTime * 3.0);

    float3 mixedColor = lerp(history, paletteColor, 0.28) * scanline;
    float vignette = debugVignette(uv);
    float3 finalColor = debugToneMap(mixedColor * vignette);

    return float4(finalColor, 1.0);
}
