// BufferA - self-feedback paint canvas.
//   iChannel0 = BufferA (its OWN previous frame - ping-pong test)
//
// Trails must fall DOWNWARD and mouse paint must appear UNDER the cursor.
// If the v-flip is wrong, feedback mirrors vertically and smears wildly.
// Values exceed [0,1] briefly where ink accumulates - float buffer test.

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 res = iResolution.xy;
    vec2 uv = fragCoord / res;

    // Copy from slightly ABOVE, so ink drifts downward over time.
    vec2 drift = vec2(0.0, 1.5) / res;
    vec3 prev = texture(iChannel0, uv + drift).rgb;

    // Decay old ink.
    prev *= 0.985;

    // Automatic orbiting emitter (works with no interaction).
    vec2 c = res * (vec2(0.5, 0.5) + 0.35 * vec2(cos(iTime * 0.7), sin(iTime * 1.3)));
    vec3 ink = palette(iTime * 0.1) * blob(fragCoord, c, 12.0);

    // Hold the mouse button to paint white - must land under the cursor.
    if (iMouse.z > 0.0)
    {
        ink += vec3(1.0) * blob(fragCoord, iMouse.xy, 10.0);
    }

    fragColor = vec4(prev + ink, 1.0);
}
