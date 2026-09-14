// Reads a script uniform from a pass other than the debugged one: a debug
// compile must still declare the script's uniforms for every pass.
fn mainImage(coord: vec2f) -> vec4f {
    return vec4f(coord / iResolution.xy, 0.5 + 0.0 * gain, 1.0);
}
