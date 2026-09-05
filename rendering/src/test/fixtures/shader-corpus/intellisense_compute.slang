// Displays the output of compute-lab/passes/intellisense-compute.slang.
float4 mainImage(float2 fragCoord)
{
    return inputs.iChannel0.Sample(fragCoord / iResolution.xy);
}
