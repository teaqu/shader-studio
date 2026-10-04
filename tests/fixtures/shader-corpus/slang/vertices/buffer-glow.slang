// BufferA adds up 1536 faint lines into a float buffer (values far above 1.0); Image tone-maps them.
float4 mainImage(float2 fragCoord) {
    float3 energy = iChannel0.Sample(fragCoord / iResolution.xy).rgb;
    return float4(1.0 - exp(-energy), 1.0);
}
