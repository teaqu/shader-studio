// Textual include: intentionally inherits its including root's language mode.
static const float kWorkspaceExposure = 1.15;

float3 foundationToneMap(float3 color)
{
    return 1.0 - exp(-color * kWorkspaceExposure);
}
