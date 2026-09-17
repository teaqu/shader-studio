fn mainImage(fragCoord: vec2f) -> vec4f
{
    let uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.xy;

    let col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0.0, 2.0, 4.0));

    let sq = max(abs(uv.x), abs(uv.y));
    let sqs = smoothstep(0.0, 1.0, sq);
    let sqs2 = smoothstep(0.0, 0.9, sq);
    let tx = vec4f(sqs2, sq, sqs, 1.0);
d
    let tun = col * sqs;
    return vec4f(col * sqs * 100.0, 1.0) * tx;
}
