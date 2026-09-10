// Keyboard input smoke test for WGSL/WebGPU. WGSL mirror of ../keyboard.slang.
//
// Config: keyboard.sha.json binds iChannel0 as { "type": "keyboard" }.
// Expected behavior:
// - Hold A/S/D for red/green/blue panels.
// - Tap Space for a one-frame white flash band.
// - Tap Left/Right arrows to toggle magenta/cyan side badges.

fn keyRow(keyCode: f32, row: f32) -> f32 {
    let uv = vec2f((keyCode + 0.5) / 256.0, (row + 0.5) / 3.0);
    return iChannel0Sample(uv).r;
}

fn held(keyCode: f32) -> f32 {
    return keyRow(keyCode, 0.0);
}

fn pressed(keyCode: f32) -> f32 {
    return keyRow(keyCode, 1.0);
}

fn toggled(keyCode: f32) -> f32 {
    return keyRow(keyCode, 2.0);
}

fn box(uv: vec2f, lo: vec2f, hi: vec2f) -> f32 {
    let insideLo = step(lo, uv);
    let insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

fn mainImage(coord: vec2f) -> vec4f {
    let uv = coord / iResolution.xy;

    let aHeld = held(65.0);      // A
    let sHeld = held(83.0);      // S
    let dHeld = held(68.0);      // D
    let spacePressed = pressed(32.0);
    let leftToggled = toggled(37.0);
    let rightToggled = toggled(39.0);

    var col = vec3f(0.03) + vec3f(0.06) * vec3f(uv.x, uv.y, 1.0 - uv.x);

    col += box(uv, vec2f(0.06, 0.25), vec2f(0.31, 0.75)) * aHeld * vec3f(1.0, 0.08, 0.05);
    col += box(uv, vec2f(0.37, 0.25), vec2f(0.62, 0.75)) * sHeld * vec3f(0.05, 1.0, 0.12);
    col += box(uv, vec2f(0.68, 0.25), vec2f(0.93, 0.75)) * dHeld * vec3f(0.08, 0.25, 1.0);

    // Space uses the transient pressed row; it should flash for one rendered
    // frame and then clear while held stays unaffected.
    col += box(uv, vec2f(0.12, 0.84), vec2f(0.88, 0.94)) * spacePressed * vec3f(1.0);

    // Arrow keys use the toggled row; tap once on, tap again off.
    col += box(uv, vec2f(0.02, 0.08), vec2f(0.12, 0.92)) * leftToggled * vec3f(1.0, 0.0, 1.0);
    col += box(uv, vec2f(0.88, 0.08), vec2f(0.98, 0.92)) * rightToggled * vec3f(0.0, 1.0, 1.0);

    // Orientation markers independent of keyboard state.
    if (uv.y > 0.985) { col = vec3f(1.0, 0.0, 0.0); }
    if (uv.x < 0.008) { col = vec3f(0.0, 1.0, 0.0); }

    return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
