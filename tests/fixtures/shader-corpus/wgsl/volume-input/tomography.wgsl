// Three orthogonal planes move through the baked 3D density asset.
fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  let panel = floor(uv.x * 3.0);
  let q = (vec2f(fract(uv.x * 3.0), uv.y) - 0.5) * 1.1 + 0.5;
  let slice = 0.5 + 0.44 * sin(iTime * 0.55);
  var p = vec3f(q.x, slice, q.y);
  if (panel < 1.0) { p = vec3f(q, slice); }
  else if (panel < 2.0) { p = vec3f(slice, q); }
  let density = iChannel0SampleLevel(p, 0.0).r;
  var color = mix(vec3f(0.015,0.025,0.05), vec3f(0.05,0.75,1.0), smoothstep(0.02,0.4,density));
  color = mix(color,vec3f(1.0,0.35,0.12),smoothstep(0.4,0.8,density));
  let contour = 1.0 - smoothstep(0.0,0.06,abs(fract(density * 12.0) - 0.5));
  color += vec3f(contour * 0.13);
  let border = step(0.01,q.x)*step(q.x,0.99)*step(0.01,q.y)*step(q.y,0.99);
  return vec4f(color * border,1.0);
}
