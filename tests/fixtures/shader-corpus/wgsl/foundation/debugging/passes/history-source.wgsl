// Black history source for the WGSL debugging viewer.
// WGSL mirror of ../slang/foundation/debugging/passes/history-source.slang.
// history.sha.json feeds this (black) buffer to history.wgsl instead of its
// own previous frame, so only fresh ink shows — no trails.

fn mainImage(coord: vec2f) -> vec4f {
    return vec4f(0.0, 0.0, 0.0, 1.0);
}
