// Example Slang image shader for the WebGPU pipeline.
//
// Convention: define `mainImage` returning the pixel colour. The globals
// iResolution (float3), iTime, iTimeDelta, iFrameRate, iFrame and iMouse
// (float4) are available, with the same meaning as ShaderToy.
//
// Multi-pass Slang buffers use the same config shape as GLSL.
// A pass can sample a configured buffer input with sampleIChannel0(uv).

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));
    return float4(col, 1.0);
}
