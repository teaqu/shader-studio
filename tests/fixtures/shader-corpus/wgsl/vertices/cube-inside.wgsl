// A cube with "cull": "front": the near faces are skipped, so you see the inside walls. Drag to orbit.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let grid = step(vec3f(0.94), fract((iWorldPosition + 0.5) * 4.0));
    let lines = max(max(grid.x, grid.y), grid.z);
    let colour = abs(iNormal) * 0.7 + 0.1;
    return vec4f(mix(colour, vec3f(1.0), lines), 1.0);
}
