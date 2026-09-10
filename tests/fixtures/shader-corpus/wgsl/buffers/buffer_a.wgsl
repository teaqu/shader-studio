// BufferA — self-feedback paint canvas.
//   iChannel0 = BufferA (its OWN previous frame — ping-pong test)
//
// Trails must fall DOWNWARD and mouse paint must appear UNDER the cursor.
// If the v-flip is wrong, feedback mirrors vertically and smears wildly.
// Values exceed [0,1] briefly where ink accumulates — rgba16float test.
//
// WGSL mirror of ../../buffers/buffer_a.slang. `palette`/`blob` come from
// the common pass (../common.wgsl).

fn mainImage(coord: vec2f) -> vec4f {
    let res = iResolution.xy;
    let uv = coord / res;

    // Copy from slightly ABOVE, so ink drifts downward over time.
    let drift = vec2f(0.0, 1.5) / res;
    var prev = iChannel0Sample(uv + drift).rgb;

    // Decay old ink.
    prev *= 0.985;

    // Automatic orbiting emitter (works with no interaction).
    let c = res * (vec2f(0.5, 0.5) + 0.35 * vec2f(cos(iTime * 0.7), sin(iTime * 1.3)));
    var ink = palette(iTime * 0.1) * blob(coord, c, 12.0);

    // Hold the mouse button to paint white — must land under the cursor.
    if (iMouse.z > 0.0) {
        ink += vec3f(1.0) * blob(coord, iMouse.xy, 10.0);
    }

    return vec4f(prev + ink, 1.0);
}
