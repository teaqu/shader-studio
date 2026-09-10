// Textual include: intentionally inherits its including root's language mode.
static const float kFoundationExposure = 1.35;

float3 foundationToneMap(float3 color)
{
    return 1.0 - exp(-color * kFoundationExposure);
}
