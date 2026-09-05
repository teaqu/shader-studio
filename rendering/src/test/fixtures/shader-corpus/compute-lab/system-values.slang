// Visualizes the native Slang/WebGPU compute system-value parameters.
// Open system-values.sha.json to run this compute pass and inspect any line.
float4 mainImage(float2 fragCoord)
{
    return inputs.iChannel0.Sample(fragCoord / iResolution.xy);
}
