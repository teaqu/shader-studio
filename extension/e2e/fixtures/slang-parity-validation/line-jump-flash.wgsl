fn mainImage(fragCoord: vec2f) -> vec4f
{
    let lineA: f32 = 0.25;
    let lineB: f32 = 0.9;
    return vec4f(0.0, 1.0, 0.0, 1.0);
}
// Fixture for debug-line-jump-flash-wgsl.e2e.mjs: L3 visualizes lineA (dark
// grey), L4 visualizes lineB (bright grey), untouched renders solid green.
// Comments live down here to hold those line numbers.
