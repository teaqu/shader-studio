[shader("compute")]
[numthreads(1, 1, 1)]
void fill(uint3 id : SV_DispatchThreadID)
{
    float sum = key0.SampleLevel(float2(0.5), 0).r;
    writeOutput(id.xy, float4(sum, 1.0, 0.0, 1.0));
}
