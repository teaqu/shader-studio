// Truchet pattern — Slang port (Book of Shaders style) for the WebGPU pipeline.
//
// Slang differences from GLSL: vecN -> floatN, fract -> frac. The globals
// iResolution/iTime/etc. come from the generated prelude; define mainImage to
// return the colour (no `out` parameter).

#define PI 3.14159265358979323846

float random(float2 st)
{
    return frac(sin(dot(st.xy, float2(12.9898, 78.233))) * 43758.5453123);
}

float2 truchetPattern(float2 st, float index)
{
    index = frac(((index - 0.5) * 2.0));
    if (index > 0.75) {
        // Flip both axes (180 rotation equivalent)
        st = float2(1.0, 1.0) - st;
    } else if (index > 0.5) {
        // Mirror horizontally (flip X axis)
        st = float2(1.0 - st.x, st.y);
    } else if (index > 0.25) {
        // Mirror vertically (flip Y axis)
        st = 1.0 - float2(1.0 - st.x, st.y);
    }
    // else: no flip
    return st;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
    uv *= 2.0;

    float2 ipos = floor(uv); // integer coords
    float2 fpos = frac(uv);  // fractional coords
    float2 tile = truchetPattern(fpos, random(ipos));

    // Maze (swap into the output below to see it)
    float color = smoothstep(tile.x - 0.3, tile.x, tile.y) -
                  smoothstep(tile.x, tile.x + 0.3, tile.y);

    return float4(float3(tile, 0.0), 1.0);
}
