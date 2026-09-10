// Texture input smoke test for WGSL/WebGPU.
//
// Config: texture.sha.json binds assets/orientation-texture.svg to iChannel0.
// Expected orientation: red top, green left, blue bottom, yellow right.

fn mainImage(coord: vec2<f32>) -> vec4<f32> {
    let uv = coord / iResolution.xy;
    let tex = iChannel0Sample(uv).rgb;

    // Light checker underlay makes failed/black texture loads obvious.
    let cells = floor(uv * 16.0);
    let checker = (cells.x + cells.y) - floor((cells.x + cells.y) / 2.0) * 2.0;
    let underlay = mix(vec3<f32>(0.10, 0.10, 0.12), vec3<f32>(0.18, 0.18, 0.20), checker);
    var col = mix(underlay, tex, 0.92);

    // Sample fixed points and display them as verification swatches:
    // top, left, bottom, right, center.
    let topSample = iChannel0Sample(vec2<f32>(0.5, 0.94)).rgb;
    let leftSample = iChannel0Sample(vec2<f32>(0.06, 0.5)).rgb;
    let bottomSample = iChannel0Sample(vec2<f32>(0.5, 0.06)).rgb;
    let rightSample = iChannel0Sample(vec2<f32>(0.94, 0.5)).rgb;
    let centerSample = iChannel0Sample(vec2<f32>(0.5, 0.5)).rgb;

    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.84 && uv.y < 0.96) { col = topSample; }
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.68 && uv.y < 0.80) { col = leftSample; }
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.52 && uv.y < 0.64) { col = bottomSample; }
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.36 && uv.y < 0.48) { col = rightSample; }
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.20 && uv.y < 0.32) { col = centerSample; }

    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
