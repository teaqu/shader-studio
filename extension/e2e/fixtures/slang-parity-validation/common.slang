#define PARITY_PALETTE 2

#if PARITY_PALETTE == 1
static const float3 kParityAccent = float3(1.0, 0.25, 0.1);
#elif PARITY_PALETTE == 2
static const float3 kParityAccent = float3(0.1, 0.85, 1.0);
#else
static const float3 kParityAccent = float3(1.0, 0.0, 1.0);
#endif

#undef PARITY_PALETTE

float parityGrid(float2 uv, float scale)
{
    float2 cell = abs(frac(uv * scale) - 0.5);
    return smoothstep(0.48, 0.42, max(cell.x, cell.y));
}

float3 parityPalette(float value)
{
    return 0.5 + 0.5 * cos(6.2831853 * (value + float3(0.0, 0.33, 0.67)));
}
