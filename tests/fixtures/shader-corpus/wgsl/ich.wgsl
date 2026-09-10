// Four-channel sampling + metadata smoke test for WGSL/WebGPU.
// WGSL mirror of ../ich.slang (the Slang four-channel compatibility test).
//
// Quadrants: texture (top-left), audio (top-right), keyboard (bottom-left),
// cubemap (bottom-right). Each panel samples through the iChannelNSample
// free functions and has a status strip that is green only when size,
// loaded, and time metadata match.
//
// WGSL adaptations vs Slang (see wgsl/README.md):
// - No iChN wrappers: Size()/Loaded()/Time() free functions replace
//   .size/.loaded/.time, and Size() returns vec2u (no z component).
// - No ternary operator: `select` is used instead.
// Like the Slang version, every panel is sampled in uniform control flow
// before the quadrant branch, because derivative-based Sample requires it.

fn box(uv: vec2f, lo: vec2f, hi: vec2f) -> f32 {
    let insideLo = step(lo, uv);
    let insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

fn metadataMatches(actualSize: vec2u, expectedSize: vec2u, loaded: bool, time: f32, timeRuns: bool) -> f32 {
    let sizeOk = all(actualSize == expectedSize);
    let timeOk = select(abs(time) < 0.01, time >= 0.0, timeRuns);
    return select(0.0, 1.0, sizeOk && loaded && timeOk);
}

fn statusColor(ok: f32) -> vec3f {
    return mix(vec3f(0.85, 0.025, 0.025), vec3f(0.025, 0.85, 0.10), ok);
}

fn keyValue(keyCode: f32, row: f32) -> f32 {
    let keyUv = vec2f((keyCode + 0.5) / 256.0, (row + 0.5) / 3.0);
    return iChannel2Sample(keyUv).r;
}

fn texturePanel(p: vec2f) -> vec3f {
    // The source has red/green/blue/yellow edges at top/left/bottom/right.
    // Sampling the full panel makes a vertical inversion immediately visible.
    return iChannel0Sample(p).rgb;
}

fn audioPanel(p: vec2f) -> vec3f {
    let spectrum = iChannel1Sample(vec2f(p.x, 0.25)).r;
    let waveform = iChannel1Sample(vec2f(p.x, 0.75)).r;
    var col = vec3f(0.015, 0.025, 0.045);
    col += select(0.0, 1.0, p.y < spectrum * 0.82) * vec3f(0.02, 0.75, 0.95);
    let waveY = 0.52 + (waveform - 0.5) * 0.55;
    col += select(0.0, 1.0, abs(p.y - waveY) < 0.018) * vec3f(1.0, 0.85, 0.05);
    let marker = fract(iChannel1Time() / 5.0);
    col = mix(col, vec3f(1.0), select(0.0, 0.8, abs(p.x - marker) < 0.006));
    return col;
}

fn keyboardPanel(p: vec2f) -> vec3f {
    let aHeld = keyValue(65.0, 0.0);
    let sHeld = keyValue(83.0, 0.0);
    let dHeld = keyValue(68.0, 0.0);
    let spacePressed = keyValue(32.0, 1.0);
    var col = vec3f(0.025, 0.03, 0.05);
    col += box(p, vec2f(0.08, 0.18), vec2f(0.30, 0.78)) * aHeld * vec3f(1.0, 0.04, 0.03);
    col += box(p, vec2f(0.39, 0.18), vec2f(0.61, 0.78)) * sHeld * vec3f(0.03, 1.0, 0.08);
    col += box(p, vec2f(0.70, 0.18), vec2f(0.92, 0.78)) * dHeld * vec3f(0.04, 0.20, 1.0);
    col += box(p, vec2f(0.08, 0.84), vec2f(0.92, 0.94)) * spacePressed;
    return col;
}

fn cubemapPanel(p: vec2f) -> vec3f {
    let yaw = (p.x * 2.0 - 1.0) * 1.75;
    let pitch = (p.y * 2.0 - 1.0) * 1.05;
    let dir = normalize(vec3f(sin(yaw), sin(pitch), cos(yaw) * cos(pitch)));
    var col = iChannel3Sample(dir).rgb;

    // Six small direction probes, left to right: +X, -X, +Y, -Y, +Z, -Z.
    // Sample every direction before the fragment-varying branch: WGSL's
    // implicit-derivative texture sampling requires uniform control flow.
    let posX = iChannel3Sample(vec3f(1.0, 0.0, 0.0)).rgb;
    let negX = iChannel3Sample(vec3f(-1.0, 0.0, 0.0)).rgb;
    let posY = iChannel3Sample(vec3f(0.0, 1.0, 0.0)).rgb;
    let negY = iChannel3Sample(vec3f(0.0, -1.0, 0.0)).rgb;
    let posZ = iChannel3Sample(vec3f(0.0, 0.0, 1.0)).rgb;
    let negZ = iChannel3Sample(vec3f(0.0, 0.0, -1.0)).rgb;
    let probe = floor(p.x * 6.0);
    if (p.y < 0.15) {
        if (probe < 1.0) { col = posX; }
        else if (probe < 2.0) { col = negX; }
        else if (probe < 3.0) { col = posY; }
        else if (probe < 4.0) { col = negY; }
        else if (probe < 5.0) { col = posZ; }
        else { col = negZ; }
    }
    return col;
}

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;
    let panelUv = fract(uv * 2.0);
    // Evaluate all implicit-derivative samples in uniform control flow, then
    // select the visible quadrant from the already-sampled values.
    let textureCol = texturePanel(panelUv);
    let audioCol = audioPanel(panelUv);
    let keyboardCol = keyboardPanel(panelUv);
    let cubemapCol = cubemapPanel(panelUv);
    var col = vec3f(0.0);
    var metadataOk = 0.0;

    if (uv.y >= 0.5 && uv.x < 0.5) {
        col = textureCol;
        metadataOk = metadataMatches(iChannel0Size(), vec2u(256, 256), iChannel0Loaded(), iChannel0Time(), false);
    } else if (uv.y >= 0.5) {
        col = audioCol;
        metadataOk = metadataMatches(iChannel1Size(), vec2u(512, 2), iChannel1Loaded(), iChannel1Time(), true);
    } else if (uv.x < 0.5) {
        col = keyboardCol;
        metadataOk = metadataMatches(iChannel2Size(), vec2u(256, 3), iChannel2Loaded(), iChannel2Time(), false);
    } else {
        col = cubemapCol;
        metadataOk = metadataMatches(iChannel3Size(), vec2u(128, 128), iChannel3Loaded(), iChannel3Time(), false);
    }

    // Green is success, red exposes the panel whose metadata is wrong.
    if (panelUv.y > 0.96) { col = statusColor(metadataOk); }
    if (abs(uv.x - 0.5) < 0.003 || abs(uv.y - 0.5) < 0.003) { col = vec3f(1.0); }
    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
