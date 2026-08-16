#language slang 2026
module debugpalette;
import debugmath;

public float3 debugPalette(float phase)
{
    float blend = debugWave(phase);
    float3 coolColor = float3(0.03, 0.22, 1.0);
    float3 warmColor = float3(1.0, 0.12, 0.38);
    float3 color = lerp(coolColor, warmColor, blend);
    return color;
}
