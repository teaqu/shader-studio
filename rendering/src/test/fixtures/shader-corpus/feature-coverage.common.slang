struct CoverageSample
{
    float3 color;
    float energy;
};

float3 coveragePalette(float phase)
{
    return 0.5 + 0.5 * cos(phase + float3(0.0, 2.0, 4.0));
}

float coverageGain(float value) { return value * value; }
float3 coverageGain(float3 value) { return value * value; }
