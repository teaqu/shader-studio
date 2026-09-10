struct CoverageSample
{
    vec3 color;
    float energy;
};

vec3 coveragePalette(float phase)
{
    return 0.5 + 0.5 * cos(phase + vec3(0.0, 2.0, 4.0));
}

float coverageGain(float value) { return value * value; }
vec3 coverageGain(vec3 value) { return value * value; }
