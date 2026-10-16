// Original 32³ uniform noise, sampled with LINEAR + REPEAT.
fn readNoise(p: vec3f) -> vec4f { return iChannel0SampleLevel(p, 0.0); }
fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  let panel = floor(uv.x * 3.0);
  let q = vec2f(fract(uv.x * 3.0), uv.y);
  var p = vec3f(q * 0.7, iTime * 0.04);
  var result: vec3f;
  if (panel < 1.0) { result = vec3f(readNoise(p).r); }
  else if (panel < 2.0) {
    var value = 0.0; var weight = 0.5;
    for (var octave = 0; octave < 4; octave++) {
      value += readNoise(p).r * weight;
      p = p * 2.03 + vec3f(0.17,0.31,0.23); weight *= 0.5;
    }
    result = vec3f(value / 0.9375);
  } else { result = mix(vec3f(0.05,0.12,0.23), vec3f(1.0,0.85,0.55), smoothstep(0.25,0.75,readNoise(p * 0.25).r)); }
  result *= step(0.015,q.x) * step(q.x,0.985);
  return vec4f(result,1.0);
}
