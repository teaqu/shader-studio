#language slang 2026
module foundation_import_preview;
import palette;

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float pulse = 0.65 + 0.35 * sin(iTime * 2.0 + uv.x * 8.0);
    return float4(foundationPaletteAccent() * pulse, 1.0);
}
