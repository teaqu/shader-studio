// Repeated-substeps display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/repeated-substeps.slang. Three
// iDispatch substeps per frame alternate between laneA and laneB; the
// orbiting blobs must move smoothly, proving every substep ran.

fn mainImage(coord: vec2f) -> vec4f {
    let p = (2.0 * coord - iResolution.xy) / iResolution.y;
    var color = vec3f(0.01, 0.015, 0.03);
    for (var index = 0u; index < 128u; index += 1u) {
        let d = p - laneA[index].xy;
        color += exp(-dot(d, d) * 9000.0) * vec3f(0.2, 0.75, 1.1);
    }
    return vec4f(1.0 - exp(-color), 1.0);
}
