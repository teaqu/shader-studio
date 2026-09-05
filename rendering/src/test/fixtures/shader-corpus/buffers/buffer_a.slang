// BufferA — self-feedback paint canvas.
//   iChannel0 = BufferA (its OWN previous frame — ping-pong test)
//
// Trails must fall DOWNWARD and mouse paint must appear UNDER the cursor.
// If the v-flip is wrong, feedback mirrors vertically and smears wildly.
// Values exceed [0,1] briefly where ink accumulates — rgba16float test.

float4 mainImage(float2 fragCoord)
{
    float2 res = iResolution.xy;
    float2 uv = fragCoord / res;

    // Copy from slightly ABOVE, so ink drifts downward over time.
    float2 drift = float2(0.0, 1.5) / res;
    float3 prev = inputs.iChannel0.Sample(uv + drift).rgb;

    // Decay old ink.
    prev *= 0.985;

    // Automatic orbiting emitter (works with no interaction).
    float2 c = res * (float2(0.5, 0.5) + 0.35 * float2(cos(iTime * 0.7), sin(iTime * 1.3)));
    float3 ink = palette(iTime * 0.1) * blob(fragCoord, c, 12.0);

    // Hold the mouse button to paint white — must land under the cursor.
    if (iMouse.z > 0.0)
    {
        ink += float3(1.0, 1.0, 1.0) * blob(fragCoord, iMouse.xy, 10.0);
    }

    return float4(prev + ink, 1.0);
}
