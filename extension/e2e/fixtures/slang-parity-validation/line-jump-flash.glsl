void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    float lineA = 0.25;
    float lineB = 0.9;
    vec3 base = vec3(0.0, 1.0, 0.0);
    fragColor = vec4(base, 1.0);
}
// Fixture for debug-line-jump-flash.e2e.mjs: L3 visualizes lineA (dark grey),
// L4 visualizes lineB (bright grey), untouched renders solid green. The spec
// keys on the terminal statement above (only the untouched compile contains
// it), so keep it intact. Comments live down here to hold those line numbers.
