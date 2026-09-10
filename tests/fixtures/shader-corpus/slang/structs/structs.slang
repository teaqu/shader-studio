// structs.slang — main Image pass: reads struct buffer data and visualizes
float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float4 tex = inputs.iChannel0.Sample(uv);
    return tex;
}