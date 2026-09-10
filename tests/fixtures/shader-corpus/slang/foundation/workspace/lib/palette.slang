#language slang 2026
module palette;

public static const float3 kFoundationWarm = float3(1.0, 0.18, 0.05);
public static const float3 kFoundationCool = float3(0.04, 0.35, 1.0);

public float3 foundationPalette(float phase)
{
    float blend = 0.5 + 0.5 * sin(phase * 6.2831853);
    return lerp(kFoundationCool, kFoundationWarm, blend);
}
