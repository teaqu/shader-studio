// Shared types and helpers for the WGSL feature-coverage test.
// WGSL mirror of ../slang/feature-coverage.common.slang (prepended to the
// renderable passes via the common pass in feature-coverage.sha.json).

struct CoverageSample {
    color: vec3f,
    energy: f32,
};

fn coveragePalette(phase: f32) -> vec3f {
    return 0.5 + 0.5 * cos(phase + vec3f(0.0, 2.0, 4.0));
}

// NOTE: Slang spells these as overloads, but WGSL rejects user-function
// overloading (tint: redeclaration), so the vec3 variant is renamed.
fn coverageGain(value: f32) -> f32 { return value * value; }
fn coverageGainVec(value: vec3f) -> vec3f { return value * value; }
