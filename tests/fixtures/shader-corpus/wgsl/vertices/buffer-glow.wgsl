// BufferA adds up 1536 faint lines into a float buffer (values far above 1.0); Image tone-maps them.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let energy = sample2D(iChannel0Texture, iChannel0Sampler, fragCoord / iResolution.xy).rgb;
    return vec4f(1.0 - exp(-energy), 1.0);
}
