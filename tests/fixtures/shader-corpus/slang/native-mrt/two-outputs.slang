struct Outputs { float4 normal:SV_Target1; float4 colour:SV_Target0; };
[shader("vertex")] float4 vertex(uint i:SV_VertexID):SV_Position { float2 p[3]={float2(-1,-1),float2(3,-1),float2(-1,3)}; return float4(p[i],0,1); }
[shader("fragment")] Outputs fragment() { Outputs o; o.normal=float4(0,.75,0,1);o.colour=float4(.25,0,0,1);return o; }

float4 mainImage(float2 coord) {
  float2 uv = coord / iResolution.xy;
  return float4(iChannel0.Sample(uv).r, iChannel1.Sample(uv).g, 0, 1);
}
