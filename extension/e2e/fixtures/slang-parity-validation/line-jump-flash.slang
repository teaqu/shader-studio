float4 mainImage(float2 fragCoord)
{
    float lineA = 0.25;
    float lineB = 0.9;
    return float4(0.0, 1.0, 0.0, 1.0);
}
// Fixture for debug-line-jump-flash-slang.e2e.mjs: L3 visualizes lineA (dark
// grey), L4 visualizes lineB (bright grey), untouched renders solid green.
// Comments live down here to hold those line numbers.
