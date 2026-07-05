// Buffer feedback example — Slang port of a ShaderToy-style BufferA pass.
//
// Demonstrates the multi-pass authoring convention: a buffer pass samples
// its own previous frame via a configured channel input and blends it
// with a new value, producing a fading trail effect. The generated helper
// sampleIChannel0(uv) reads the texture bound to channel slot 0 (this
// buffer's own output from the prior frame in a typical feedback config).

// BufferA
float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float4 previous = sampleIChannel0(uv);
    return lerp(previous, float4(uv.x, uv.y, 0.5 + 0.5 * sin(iTime), 1.0), 0.08);
}
