struct Outputs { @location(1) normal: vec4f, @location(0) colour: vec4f, }
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fragment()->Outputs { return Outputs(vec4f(0,0.75,0,1),vec4f(0.25,0,0,1)); }

fn mainImage(coord: vec2f) -> vec4f {
  let uv = coord / iResolution.xy;
  return vec4f(iChannel0Sample(uv).r, iChannel1Sample(uv).g, 0, 1);
}
