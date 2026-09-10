float4 mainImage(float2 fragCoord) { return inputs.iChannel0.Sample(fragCoord / iResolution.xy); }
