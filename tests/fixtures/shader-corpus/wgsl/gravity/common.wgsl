// common.wgsl — shared types and helpers for the gravity WGSL test.
// WGSL mirror of ../slang/gravity/common.slang. The engine reads the Body
// layout from this file to size the `bodies` storage buffer.

struct Body {
    position: vec4f,   // xyz = position, w = mass
    velocity: vec4f,   // xyz = velocity, w = padding
};

fn gravityForce(a: Body, b: Body) -> vec3f {
    let dir = b.position.xyz - a.position.xyz;
    let dist = length(dir);
    if (dist < 0.001) { return vec3f(0.0, 0.0, 0.0); }
    let strength = b.position.w / (dist * dist);
    return normalize(dir) * strength;
}
