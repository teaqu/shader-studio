// Script uniforms (gain, tint, unused) arrive as injected globals, so the
// inspector must type locals from them without listing them as variables.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let uv = fragCoord / iResolution.xy;
    let src = iChannel0Sample(uv);
    let col = glow(src.rgb * tint, gain);
    let depth = src.a;
    return vec4f(col * depth, 1.0);
}
