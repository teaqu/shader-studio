// Five distinct native render outputs, routed into the Image RGB channels.
struct Outputs {
  @location(0) target0: vec4f,
  @location(1) target1: vec4f,
  @location(2) target2: vec4f,
  @location(3) target3: vec4f,
  @location(4) target4: vec4f,
}
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fragment()->Outputs { return Outputs(vec4f(0.1,0,0,1),vec4f(0.2,0,0,1),vec4f(0.3,0,0,1),vec4f(0.4,0,0,1),vec4f(0.5,0,0,1)); }
fn mainImage(coord:vec2f)->vec4f { let uv=coord/iResolution.xy; return vec4f(iChannel0Sample(uv).r+iChannel1Sample(uv).r,iChannel2Sample(uv).r+iChannel3Sample(uv).r,iChannel4Sample(uv).r,1); }
