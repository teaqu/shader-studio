// Keyboard input smoke test for Slang/WebGPU.
//
// Config: keyboard.sha.json binds iChannel0 as { "type": "keyboard" }.
// Expected behavior:
// - Hold A/S/D for red/green/blue panels.
// - Tap Space for a one-frame white flash band.
// - Tap Left/Right arrows to toggle magenta/cyan side badges.

float keyRow(float keyCode, float row)
{
    float2 uv = float2((keyCode + 0.5) / 256.0, (row + 0.5) / 3.0);
    return inputs.iChannel0.Sample(uv).r;
}

float held(float keyCode)
{
    return keyRow(keyCode, 0.0);
}

float pressed(float keyCode)
{
    return keyRow(keyCode, 1.0);
}

float toggled(float keyCode)
{
    return keyRow(keyCode, 2.0);
}

float box(float2 uv, float2 lo, float2 hi)
{
    float2 insideLo = step(lo, uv);
    float2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    float aHeld = held(65.0);      // A
    float sHeld = held(83.0);      // S
    float dHeld = held(68.0);      // D
    float spacePressed = pressed(32.0);
    float leftToggled = toggled(37.0);
    float rightToggled = toggled(39.0);

    float3 col = 0.03 + 0.06 * float3(uv.x, uv.y, 1.0 - uv.x);

    col += box(uv, float2(0.06, 0.25), float2(0.31, 0.75)) * aHeld * float3(1.0, 0.08, 0.05);
    col += box(uv, float2(0.37, 0.25), float2(0.62, 0.75)) * sHeld * float3(0.05, 1.0, 0.12);
    col += box(uv, float2(0.68, 0.25), float2(0.93, 0.75)) * dHeld * float3(0.08, 0.25, 1.0);

    // Space uses the transient pressed row; it should flash for one rendered
    // frame and then clear while held stays unaffected.
    col += box(uv, float2(0.12, 0.84), float2(0.88, 0.94)) * spacePressed * float3(1.0, 1.0, 1.0);

    // Arrow keys use the toggled row; tap once on, tap again off.
    col += box(uv, float2(0.02, 0.08), float2(0.12, 0.92)) * leftToggled * float3(1.0, 0.0, 1.0);
    col += box(uv, float2(0.88, 0.08), float2(0.98, 0.92)) * rightToggled * float3(0.0, 1.0, 1.0);

    // Orientation markers independent of keyboard state.
    if (uv.y > 0.985) col = float3(1.0, 0.0, 0.0);
    if (uv.x < 0.008) col = float3(0.0, 1.0, 0.0);

    return float4(saturate(col), 1.0);
}
