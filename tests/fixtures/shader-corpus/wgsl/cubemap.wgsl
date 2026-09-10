// Cubemap input smoke test for WGSL/WebGPU. WGSL mirror of ../cubemap.slang.
//
// Config: cubemap.sha.json binds ../assets/cubemap-cross.svg to iChannel0.
// Expected face colors: +X red, -X green, +Y blue, -Y yellow,
// +Z magenta, -Z cyan. The left swatches sample those six directions.

fn box(uv: vec2f, lo: vec2f, hi: vec2f) -> f32 {
    let insideLo = step(lo, uv);
    let insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

fn fallbackGrid(uv: vec2f) -> vec3f {
    let cells = abs(fract(uv * 16.0) - vec2f(0.5));
    let line = 1.0 - smoothstep(0.46, 0.50, min(cells.x, cells.y));
    return mix(vec3f(0.035, 0.038, 0.048), vec3f(0.14, 0.14, 0.16), line * 0.35);
}

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    var p = vec2f(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0);
    p = vec2f(p.x * iResolution.x / iResolution.y, p.y);

    let yaw = p.x * 1.55;
    let pitch = p.y * 0.95;
    let dir = normalize(vec3f(sin(yaw), sin(pitch), cos(yaw) * cos(pitch)));
    let cube = iChannel0Sample(dir).rgb;
    var col = mix(fallbackGrid(uv), cube, 0.96);

    let posX = iChannel0Sample(vec3f(1.0, 0.0, 0.0)).rgb;
    let negX = iChannel0Sample(vec3f(-1.0, 0.0, 0.0)).rgb;
    let posY = iChannel0Sample(vec3f(0.0, 1.0, 0.0)).rgb;
    let negY = iChannel0Sample(vec3f(0.0, -1.0, 0.0)).rgb;
    let posZ = iChannel0Sample(vec3f(0.0, 0.0, 1.0)).rgb;
    let negZ = iChannel0Sample(vec3f(0.0, 0.0, -1.0)).rgb;

    if (box(uv, vec2f(0.06, 0.80), vec2f(0.18, 0.92)) > 0.0) { col = posX; }
    if (box(uv, vec2f(0.06, 0.66), vec2f(0.18, 0.78)) > 0.0) { col = negX; }
    if (box(uv, vec2f(0.06, 0.52), vec2f(0.18, 0.64)) > 0.0) { col = posY; }
    if (box(uv, vec2f(0.06, 0.38), vec2f(0.18, 0.50)) > 0.0) { col = negY; }
    if (box(uv, vec2f(0.06, 0.24), vec2f(0.18, 0.36)) > 0.0) { col = posZ; }
    if (box(uv, vec2f(0.06, 0.10), vec2f(0.18, 0.22)) > 0.0) { col = negZ; }

    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
