// Baked 48³ R8 density, with explicit LOD for divergent raymarching.
fn density(p: vec3f) -> f32 { return iChannel0SampleLevel(p * 0.5 + 0.5, 0.0).r; }
fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  let angle = iTime * 0.16;
  let ro = vec3f(3.2 * sin(angle),1.1,3.2 * cos(angle));
  let forward = normalize(-ro);
  let right = normalize(cross(forward,vec3f(0.0,1.0,0.0)));
  let up = cross(right,forward);
  let rd = normalize(forward * 1.8 + uv.x * right + uv.y * up);
  let bg = mix(vec3f(0.035,0.07,0.15),vec3f(0.26,0.43,0.62),clamp(uv.y * 0.3 + 0.5,0.0,1.0));
  var accum = vec3f(0.0); var trans = 1.0;
  for (var i = 0; i < 100; i++) {
    let p = ro + rd * (1.5 + f32(i) * 0.045);
    if (max(max(abs(p.x),abs(p.y)),abs(p.z)) > 1.0) { continue; }
    let d = max(density(p) - 0.12,0.0);
    let lightDir = normalize(vec3f(-0.7,1.0,0.5));
    let shadow = density(clamp(p + lightDir * 0.14,vec3f(-1.0),vec3f(1.0))) + density(clamp(p + lightDir * 0.3,vec3f(-1.0),vec3f(1.0)));
    let color = mix(vec3f(0.17,0.27,0.42),vec3f(1.0,0.87,0.66),exp(-shadow * 2.3));
    let alpha = 1.0 - exp(-d * 0.045 * 9.0);
    accum += trans * alpha * color;
    trans *= 1.0 - alpha;
  }
  return vec4f(pow(accum + trans * bg,vec3f(0.8)),1.0);
}
