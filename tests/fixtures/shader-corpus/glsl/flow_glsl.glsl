// Image pass - composites BufferA (sharp paint) + BufferB (half-res glow).
//
// Channels (see flow_glsl.sha.json):
//   iChannel0 = BufferA  (sampled - current frame)
//   iChannel1 = BufferB  (sampled - current frame, half resolution)
//   iChannel2 = BufferA  (declared but NEVER sampled - exercises unused
//                         channel handling)
//
// Orientation markers: RED bar must appear along the TOP edge and GREEN
// along the LEFT edge. If red shows at the bottom, the v-flip is wrong.

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;

    // `palette` comes from common.glsl - proves common code reaches Image.
    vec3 col = palette(uv.x * 0.2 + iTime * 0.02) * 0.06;

    vec3 sharp = texture(iChannel0, uv).rgb;
    vec3 glow = texture(iChannel1, uv).rgb;
    col += sharp + 0.6 * glow * glow;

    if (uv.y > 0.985) col = vec3(1.0, 0.0, 0.0); // TOP edge = red
    if (uv.x < 0.008) col = vec3(0.0, 1.0, 0.0); // LEFT edge = green

    fragColor = vec4(col, 1.0);
}
