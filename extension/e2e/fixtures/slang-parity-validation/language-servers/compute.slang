[shader("compute")]
[numthreads(1, 1, 1)]
void computeMain(uint3 dispatchId : SV_DispatchThreadID) {
    writeOutput(dispatchId.xy, float4(1.0));
}
