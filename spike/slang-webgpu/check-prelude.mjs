// Validates the M1 Slang ShaderToy prelude convention against real slang-wasm:
// wraps a sample mainImage exactly as SlangPrelude.ts does and compiles to WGSL.
import createSlangModule from "./vendor/slang-wasm.js";

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v.size === "function") {
    const out = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  }
  return [];
}

// Mirror of rendering/src/webgpu/SlangPrelude.ts
const PRELUDE = `struct ShaderToyUniforms
{
    float4 resolution;
    float4 mouse;
    float time;
    float timeDelta;
    float frameRate;
    int frame;
};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> _st;

#define iResolution (_st.resolution.xyz)
#define iMouse (_st.mouse)
#define iTime (_st.time)
#define iTimeDelta (_st.timeDelta)
#define iFrameRate (_st.frameRate)
#define iFrame (_st.frame)
`;

const ENTRY_POINTS = `
[shader("vertex")]
float4 vertexMain(uint vertexID : SV_VertexID) : SV_Position
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    return float4(verts[vertexID], 0, 1);
}

[shader("fragment")]
float4 fragmentMain(float4 fragCoord : SV_Position) : SV_Target
{
    float2 coord = float2(fragCoord.x, _st.resolution.y - fragCoord.y);
    return mainImage(coord);
}
`;

const USER = `float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));
    return float4(col, 1.0);
}`;

const wrapped = `${PRELUDE}\n#line 1\n${USER}\n${ENTRY_POINTS}`;

const slang = await createSlangModule();
const gs = slang.createGlobalSession();
const target = toArray(slang.getCompileTargets()).find((t) => /wgsl/i.test(t.name));
const session = gs.createSession(target.value);
const module = session.loadModuleFromSource(wrapped, "image", "/image.slang");
if (!module) {
  console.error("COMPILE FAILED:", slang.getLastError().message);
  process.exit(1);
}
const vs = module.findEntryPointByName("vertexMain");
const fs = module.findEntryPointByName("fragmentMain");
const composite = session.createCompositeComponentType([module, vs, fs]);
const wgsl = composite.link().getTargetCode(0);
console.log("PRELUDE COMPILES ✓\n");
console.log(wgsl);
