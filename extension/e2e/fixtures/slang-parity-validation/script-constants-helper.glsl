// A helper with no entry point of its own - it only names mainImage here, in
// prose. Opening it previews the bare file - no config, no script context -
// and that preview must not throw away the shader's uniforms.
float helper(float x) { return x * 2.0; }
