// Five distinct native render outputs, routed into the Image RGB channels.
struct Outputs {
  float4 target0 : SV_Target0;
  float4 target1 : SV_Target1;
  float4 target2 : SV_Target2;
  float4 target3 : SV_Target3;
  float4 target4 : SV_Target4;
};
[shader("vertex")] float4 vertex(uint i:SV_VertexID):SV_Position { float2 p[3]={float2(-1,-1),float2(3,-1),float2(-1,3)}; return float4(p[i],0,1); }
[shader("fragment")] Outputs fragment() { Outputs o; o.target0=float4(0.1,0,0,1);o.target1=float4(0.2,0,0,1);o.target2=float4(0.3,0,0,1);o.target3=float4(0.4,0,0,1);o.target4=float4(0.5,0,0,1);return o; }
float4 mainImage(float2 coord) { float2 uv=coord/iResolution.xy; return float4(iChannel0.Sample(uv).r+iChannel1.Sample(uv).r,iChannel2.Sample(uv).r+iChannel3.Sample(uv).r,iChannel4.Sample(uv).r,1); }
