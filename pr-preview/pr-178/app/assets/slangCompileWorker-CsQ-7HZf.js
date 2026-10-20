(function(){"use strict";function ye(t){if(Array.isArray(t))return t;if(t&&typeof t.size=="function"){const n=[],e=t;for(let a=0;a<e.size();a++)n.push(e.get(a));return n}return[]}const Te="world";function j(t){const n=[];let e=0;for(;e<t.length;){const a=t[e];if(/\s/.test(a)){e++;continue}if(t.startsWith("//",e)){const r=t.indexOf(`
`,e+2);e=r<0?t.length:r;continue}if(t.startsWith("/*",e)){let r=1;for(e+=2;e<t.length&&r>0;)t.startsWith("/*",e)?(r++,e+=2):t.startsWith("*/",e)?(r--,e+=2):e++;continue}const o=e++;let i="punctuation";if(a==='"'||a==="'"){for(i="string";e<t.length;)if(t[e]==="\\")e+=2;else if(t[e++]===a)break}else if(/[A-Za-z_]/.test(a))for(i="identifier";e<t.length&&/[A-Za-z0-9_]/.test(t[e]);)e++;n.push({text:t.slice(o,e),kind:i,start:o,end:Math.min(e,t.length)})}return n}function k(t,n){const e=j(t),a=[];let o=0,i=0,r=-1;for(let s=0;s<e.length;s++){const l=e[s];if(l.text==="{")i===0&&(r=s),i++;else if(l.text==="}"){if(i=Math.max(0,i-1),i!==0||r<0)continue;const d=e.slice(o,r),c=_e(d);c&&a.push({name:c.name,stage:c.stage,start:d[0].start,end:l.end,bodyStart:e[r].end,bodyEnd:l.start}),o=s+1,r=-1}else l.text===";"&&i===0&&(o=s+1)}return a}function $e(t){return t==="vertex"||t==="fragment"||t==="compute"}function _e(t,n){return we(t)}function we(t){var a,o,i;let n,e=0;for(let r=0;r<t.length;r++){const s=t[r].text;if(s==="["?e++:s==="]"&&(e=Math.max(0,e-1)),e>0&&s==="shader"&&((a=t[r+1])==null?void 0:a.text)==="("){const l=(o=t[r+2])==null?void 0:o.text,d=l==null?void 0:l.slice(1,-1);l!=null&&l.startsWith('"')&&$e(d)&&(n=d)}if(e===0&&s==="=")return;if(e===0&&s==="("&&((i=t[r-1])==null?void 0:i.kind)==="identifier")return t.some(l=>["struct","class","namespace","interface"].includes(l.text))?void 0:{name:t[r-1].text,stage:n}}}function be(t,n,e,a=[]){const o=k(t);if(!o.length)return t;const i=new Map;for(const u of o)i.set(u.name,[...i.get(u.name)??[],u]);const r=j(t),s=new Set(e),l=[...e],d=u=>{for(let m=0;m<u.length;m++){const S=u[m];S.kind!=="identifier"||!i.has(S.text)||s.has(S.text)||(s.add(S.text),l.push(S.text))}};d(r.filter(u=>!o.some(m=>u.start>=m.start&&u.end<=m.end)));for(const u of a)d(j(u));for(;l.length;)for(const u of i.get(l.pop())??[])d(r.filter(m=>m.start>=u.start&&m.end<=u.end));const c=t.split("");for(const u of o)if(!s.has(u.name))for(let m=u.start;m<u.end;m++)c[m]!==`
`&&c[m]!=="\r"&&(c[m]=" ");return c.join("")}[...Object.values({float:{render:"f32",compute:"f32"},float2:{render:"vec2<f32>",compute:"vec2<f32>"},float3:{render:"vec3<f32>",compute:"vec3<f32>"},float4:{render:"vec4<f32>",compute:"vec4<f32>"},int:{render:"i32",compute:"i32"},int2:{render:"vec2<i32>",compute:"vec2<i32>"},int3:{render:"vec3<i32>",compute:"vec3<i32>"},int4:{render:"vec4<i32>",compute:"vec4<i32>"},uint:{render:"u32",compute:"u32"},uint2:{render:"vec2<u32>",compute:"vec2<u32>"},uint3:{render:"vec3<u32>",compute:"vec3<u32>"},uint4:{render:"vec4<u32>",compute:"vec4<u32>"},"Atomic<uint>":{render:"u32",compute:"atomic<u32>"},"Atomic<int>":{render:"i32",compute:"atomic<i32>"},float2x2:{render:"mat2x2<f32>",compute:"mat2x2<f32>"},float3x3:{render:"mat3x3<f32>",compute:"mat3x3<f32>"},float4x4:{render:"mat4x4<f32>",compute:"mat4x4<f32>"}}).flatMap(({render:t,compute:n})=>[t,n]),...[2,3,4].flatMap(t=>["f16","f32","i32","u32"].map(n=>`vec${t}<${n}>`)),...[2,3,4].flatMap(t=>["h","f","i","u"].map(n=>`vec${t}${n}`)),...[2,3,4].flatMap(t=>[2,3,4].flatMap(n=>[`mat${t}x${n}<f16>`,`mat${t}x${n}<f32>`,`mat${t}x${n}h`,`mat${t}x${n}f`]))];const De=["glsl","frag","vert"],Ce=["slang"],Pe=["wgsl"],ne="struct ShaderStudioPointer { float2 position; int inside; int held; int pressed; int released; int modifiers; int _padding; float2 wheel; float2 wheelDelta; };";function Ee(t){return Object.freeze({...t,languages:Object.freeze([...t.languages]),...t.stages?{stages:Object.freeze([...t.stages])}:{}})}function X(t){return Object.freeze(t.map(Ee))}const Ie=new Set(["fragColor","HW_PERFORMANCE","iResolution","iTime","iTimeDelta","iFrameRate","iMouse","iPointer","ShaderStudioPointer","iFrame","iDate","iChannelTime","iSampleRate","iCameraPos","iCameraDir","iVertexCount","iInstanceCount","iViewMatrix","iProjectionMatrix","iViewProjection","iVRActive","iVRControllerPosition","iVRControllerDirection","iVRControllerButtons","iVRControllerAxes","iVRControllerFaceButtons","iVRControllerTouches","iVRControllerFaceTouches"]),N=X([{name:"iWorldPosition",glslType:"vec3",slangType:"float3",wgslType:"vec3f",glslDeclaration:"vec3 iWorldPosition;",slangDeclaration:"float3 iWorldPosition;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"World-space position of the current fragment; zero for fullscreen geometry."},{name:"iNormal",glslType:"vec3",slangType:"float3",wgslType:"vec3f",glslDeclaration:"vec3 iNormal;",slangDeclaration:"float3 iNormal;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"World-space interpolated normal of the current fragment; zero for fullscreen geometry."},{name:"iCameraPosition",glslType:"vec3",slangType:"float3",wgslType:"vec3f",glslDeclaration:"vec3 iCameraPosition;",slangDeclaration:"float3 iCameraPosition;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"World-space camera position for mesh fragments; zero for fullscreen geometry."},{name:"iVertexUv",glslType:"vec2",slangType:"float2",wgslType:"vec2f",glslDeclaration:"vec2 iVertexUv;",slangDeclaration:"float2 iVertexUv;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"Perspective-correct interpolated UV written by mainVertex for the current fragment."},{name:"iFrontFacing",glslType:"bool",slangType:"bool",wgslType:"bool",glslDeclaration:"bool iFrontFacing;",slangDeclaration:"#define iFrontFacing true",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"Whether the current primitive is front-facing; always true for fullscreen geometry."}]),y=Object.freeze({worldPosition:N[0],normal:N[1],cameraPosition:N[2],vertexUv:N[3],frontFacing:N[4]}),Me=X([{name:"iModelMatrix",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iModelMatrix;",languages:["slang","wgsl"],description:"Model-to-world transform for a native WebGPU mesh pass."},{name:"iViewProjectionMatrix",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iViewProjectionMatrix;",languages:["slang","wgsl"],description:"World-to-clip transform for a native WebGPU mesh pass."},{name:"iNormalMatrix",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iNormalMatrix;",languages:["slang","wgsl"],description:"Normal transform for a native WebGPU mesh pass."}]),Re=X([{name:"iResolution",glslType:"vec3",slangType:"float3",wgslType:"vec3f",slangDeclaration:"float3 iResolution;",languages:["glsl","slang","wgsl"],description:"Canvas dimensions: xy is width and height, z is the aspect ratio."},{name:"iTime",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iTime;",languages:["glsl","slang","wgsl"],description:"Elapsed time in seconds."},{name:"iTimeDelta",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iTimeDelta;",languages:["glsl","slang","wgsl"],description:"Time since the previous frame in seconds."},{name:"iFrameRate",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iFrameRate;",languages:["glsl","slang","wgsl"],description:"Current frames per second."},{name:"iMouse",glslType:"vec4",slangType:"float4",wgslType:"vec4f",slangDeclaration:"float4 iMouse;",languages:["glsl","slang","wgsl"],description:"Mouse position in xy and click position in zw."},{name:"iPointer",glslType:"ShaderStudioPointer",slangType:"ShaderStudioPointer",wgslType:"ShaderStudioPointer",slangDeclaration:`${ne}
ShaderStudioPointer iPointer;`,languages:["glsl","slang","wgsl"],description:"Canvas pointer position, inside state, held/pressed/released button masks, modifiers, accumulated wheel and per-frame wheelDelta."},{name:"iFrame",glslType:"int",slangType:"int",wgslType:"i32",slangDeclaration:"int iFrame;",languages:["glsl","slang","wgsl"],description:"Frame counter starting at zero."},{name:"iDate",glslType:"vec4",slangType:"float4",wgslType:"vec4f",slangDeclaration:"float4 iDate;",languages:["glsl","slang","wgsl"],description:"Year, month, day, and seconds since midnight."},{name:"iChannelTime",glslType:"float[1024]",slangType:"float[1024]",languages:["glsl"],description:"Playback time for each configured input channel."},{name:"iChannelResolution",glslType:"vec3[1024]",slangType:"float3[1024]",languages:["glsl"],description:"Resolution of each configured input channel."},{name:"iSampleRate",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iSampleRate;",languages:["glsl","slang","wgsl"],description:"Audio sample rate in hertz."},{name:"iCameraPos",glslType:"vec3",slangType:"float3",wgslType:"vec3f",slangDeclaration:"float3 iCameraPos;",languages:["glsl","slang","wgsl"],description:"Camera position in world space."},{name:"iCameraDir",glslType:"vec3",slangType:"float3",wgslType:"vec3f",slangDeclaration:"float3 iCameraDir;",languages:["glsl","slang","wgsl"],description:"Normalised camera look direction."},{name:"iVRActive",glslType:"bool",slangType:"bool",languages:["glsl"],description:"True during an immersive WebXR session. Shader Studio extension: opt in with #define SHADER_STUDIO_VR_INPUTS."},{name:"iVRControllerPosition",glslType:"vec4[2]",slangType:"float4[2]",languages:["glsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled: tracked aim-ray origin in shader-world metres; w is 1 when tracked, otherwise 0. Slots are left (0) and right (1)."},{name:"iVRControllerDirection",glslType:"vec4[2]",slangType:"float4[2]",languages:["glsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled: tracked aim-ray direction; w is 1 when tracked, otherwise 0."},{name:"iVRControllerButtons",glslType:"vec4[2]",slangType:"float4[2]",languages:["glsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled: xr-standard trigger (x), grip (y), touchpad click (z), thumbstick click (w), from 0 to 1. Left/right slots 0/1."},{name:"iVRControllerAxes",glslType:"vec4[2]",slangType:"float4[2]",languages:["glsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled: touchpad xy and thumbstick zw, from -1 to 1. Left/right slots 0/1."},{name:"iVRControllerFaceButtons",glslType:"vec4[2]",slangType:"float4[2]",languages:["glsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled: primary/secondary buttons in xy (Quest X/Y left, A/B right), from 0 to 1. zw are zero."},{name:"iVRControllerTouches",glslType:"vec4[2]",slangType:"float4[2]",languages:["glsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled: touch states for trigger, grip, touchpad and thumbstick in xyzw; 0 or 1."},{name:"iVRControllerFaceTouches",glslType:"vec4[2]",slangType:"float4[2]",languages:["glsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled: primary/secondary face-button touch states in xy; zw are zero."},{name:"iVertexCount",glslType:"int",slangType:"uint",wgslType:"u32",slangDeclaration:"uint32_t iVertexCount;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"Vertices drawn by this pass: the configured vertexCount for vertices geometry (default 3), 3 for fullscreen, or the mesh vertex count for plane, cube, sphere, and model geometry. vertexIndex ranges from 0 to iVertexCount - 1."},{name:"iInstanceCount",glslType:"int",slangType:"uint",wgslType:"u32",slangDeclaration:"uint32_t iInstanceCount;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"Instances drawn by this pass: the configured instanceCount (default 1), or 1 for fullscreen geometry. iInstanceIndex ranges from 0 to iInstanceCount - 1."},{name:"iViewMatrix",glslType:"mat4",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iViewMatrix;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"The orbit camera's view matrix: world space to view space, the camera looking down -z. The model matrix is the identity, so world space is the space mainVertex writes for meshes and world-space vertices."},{name:"iProjectionMatrix",glslType:"mat4",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iProjectionMatrix;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"The orbit camera's perspective projection for this pass's aspect ratio: 45° vertical field of view, near 0.01, far 100. Clip-space depth follows the renderer: -1 to 1 in WebGL (GLSL), 0 to 1 in WebGPU (Slang, WGSL)."},{name:"iViewProjection",glslType:"mat4",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iViewProjection;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"iProjectionMatrix * iViewMatrix: takes a world-space point to clip space exactly as meshes and world-space vertices are drawn. Divide by w to get the clip-space position a clip-space vertex writes."},{name:"iInstanceIndex",glslType:"int",slangType:"uint",wgslType:"u32",glslDeclaration:"int iInstanceIndex;",slangDeclaration:"uint32_t iInstanceIndex;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"Zero-based index of the instance being drawn; always 0 for fullscreen geometry. Fragments receive the value of the instance that produced their primitive."},{name:"iDispatch",slangType:"int",wgslType:"i32",slangDeclaration:"int iDispatch;",languages:["slang","wgsl"],stages:["compute"],description:"Zero-based repetition index for the current compute pass dispatch."},{name:"iChannelN",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Any renderer-assigned input channel. Slots follow configured input order and are not inferred from resource names."},{name:"iChannel0",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"First input channel; its texture shape follows the configured resource."},{name:"iChannel1",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Second input channel; its texture shape follows the configured resource."},{name:"iChannel2",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Third input channel; its texture shape follows the configured resource."},{name:"iChannel3",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Fourth input channel; its texture shape follows the configured resource."},{name:"iCh0",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"First input channel with sampler, size, playback time, and loaded state metadata."},{name:"iCh1",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"Second input channel with sampler, size, playback time, and loaded state metadata."},{name:"iCh2",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"Third input channel with sampler, size, playback time, and loaded state metadata."},{name:"iCh3",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"Fourth input channel with sampler, size, playback time, and loaded state metadata."},...N,...Me]),Ve=new Set(["iChannelN"]);function Y(t){return Object.freeze(Re.filter(n=>n.languages.includes(t)&&!Ve.has(n.name)).map(n=>n.name))}const Oe={glsl:Y("glsl"),slang:Y("slang"),wgsl:Y("wgsl")};function Ne(t){return Oe[t]}const x="_st",Ae=Object.freeze([x]),Ue=Object.freeze([`#define iResolution (${x}.resolution.xyz)`,`#define iMouse (${x}.mouse)`,`#define iPointer (${x}.pointer)`,`#define iTime (${x}.time)`,`#define iTimeDelta (${x}.timeDelta)`,`#define iFrameRate (${x}.frameRate)`,`#define iFrame (${x}.frame)`,`#define iSampleRate (${x}.sampleRate)`,`#define iDate (${x}.date)`,`#define iCameraPos (${x}.cameraPos.xyz)`,`#define iCameraDir (${x}.cameraDir.xyz)`,`#define iVertexCount (${x}.vertexCount.x)`,`#define iInstanceCount (${x}.vertexCount.y)`,`#define iViewMatrix (${x}.viewMatrix)`,`#define iProjectionMatrix (${x}.projectionMatrix)`,`#define iViewProjection (${x}.viewProjection)`]);function H(t){const n=new Set;if(t==="glsl")for(const e of Ie)n.add(e);else if(t==="wgsl")n.add("mainImage"),n.add("mainVertex"),n.add("vertexMain"),n.add("fragmentMain"),n.add("writeOutput");else{for(const e of Ae)n.add(e);n.add("writeOutput")}if(t!=="glsl")for(const e of["2D","Cube","3D"])for(const a of["","Level","Grad"])n.add(`sample${e}${a}`);else for(const e of["2D","Cube","3D"])n.add(`ShaderStudioChannel${e}`);for(const e of Ne(t))n.add(e);return n}H("glsl"),H("slang"),H("wgsl");function Fe(t){const{resource:n,slot:e}=t;return{texture:`_ssTexture${e}`,sampler:`_ssSampler${e}`,channelName:n.name}}const Le=["vec","dvec","ivec","uvec","bvec"].flatMap(t=>[2,3,4].map(n=>`${t}${n}`)),ze=["mat","dmat"].flatMap(t=>[...[2,3,4].map(n=>`${t}${n}`),...[2,3,4].flatMap(n=>[2,3,4].map(e=>`${t}${n}x${e}`))]),ae=["1D","2D","3D","Cube","2DRect","1DArray","2DArray","CubeArray","Buffer","2DMS","2DMSArray"],Ge=["","i","u"].flatMap(t=>ae.map(n=>`${t}sampler${n}`)),We=["sampler1DShadow","sampler2DShadow","samplerCubeShadow","sampler2DRectShadow","sampler1DArrayShadow","sampler2DArrayShadow","samplerCubeArrayShadow"],Be=["","i","u"].flatMap(t=>ae.map(n=>`${t}image${n}`)),je=Object.freeze(["void","bool","int","uint","float","double",...Le,...ze]),ke=Object.freeze([...je,"atomic_uint",...Ge,...We,...Be]),Xe=Object.freeze(["void","bool","bool2","bool3","bool4","half","half2","half3","half4","float","float2","float3","float4","double","double2","double3","double4","int","int2","int3","int4","uint","uint2","uint3","uint4","float16_t","float32_t","float64_t","int8_t","uint8_t","int16_t","uint16_t","int32_t","uint32_t","int64_t","uint64_t"]),Ye=Object.freeze([...Xe,"vector","matrix","Texture1D","Texture2D","Texture3D","TextureCube","Texture1DArray","Texture2DArray","Texture3DArray","TextureCubeArray","RWTexture1D","RWTexture2D","RWTexture3D","RWTexture1DArray","RWTexture2DArray","RWTexture3DArray","SamplerState","SamplerComparisonState","Buffer","RWBuffer","StructuredBuffer","RWStructuredBuffer","ByteAddressBuffer","RWByteAddressBuffer","ParameterBlock","ConstantBuffer","RaytracingAccelerationStructure"]);new Set(ke),new Set(Ye);const He=1024;function re(t){if(["float","int","uint","bool","vec2","vec3","vec4"].includes(t))return{base:t};const n=/^(float|int|uint)\[([1-9]\d*)\]$/.exec(t);return!n||Number(n[2])>He?null:{base:n[1],length:Number(n[2])}}function z(t){const n=t==="texture-cube"?"Cube":t==="texture-3d"?"3D":"2D",e=t==="texture-2d"?2:3,a=t==="texture-cube"?"dir":"uv",o=`float${e}`,i=t==="texture-2d"?"float2(uv.x, 1.0 - uv.y)":a,r=s=>t==="texture-2d"?`float2(${s}.x, -${s}.y)`:s;return{shape:n,textureType:`Texture${n}<float4>`,sizeType:t==="texture-3d"?"uint3":"uint2",methods:[{name:"Sample",parameters:`${o} ${a}`,arguments:a,nativeArguments:i,requiresFragment:!0},{name:"SampleLevel",parameters:`${o} ${a}, float lod`,arguments:`${a}, lod`,nativeArguments:`${i}, lod`,requiresFragment:!1},{name:"SampleGrad",parameters:`${o} ${a}, ${o} dx, ${o} dy`,arguments:`${a}, dx, dy`,nativeArguments:`${i}, ${r("dx")}, ${r("dy")}`,requiresFragment:!1}]}}function Ke(t,n){return`sample${z(t).shape}${n==="Sample"?"":n.slice(6)}`}function Ze(t,n,e=!0){const a=[...new Set(t)].map(i=>{const r=z(i);return r.methods.filter(s=>n==="slang").map(s=>{const l=Ke(i,s.name);return`${s.requiresFragment?`[require(wgsl, fragment)]
`:""}float4 ${l}(${r.textureType} texture, SamplerState sampling, ${s.parameters})
{
    return texture.${s.name}(sampling, ${s.nativeArguments});
}`}).join(`
`)}).join(`
`);return t.includes("texture-2d")?`${a}
float4 load2D(Texture2D<float4> texture, int2 pixel)
{
    uint width, height;
    texture.GetDimensions(width, height);
    return texture.Load(int3(pixel.x, int(height) - 1 - pixel.y, 0));
}`:a}function qe(t,n={}){var T;const e=[...t].sort((p,h)=>p.slot-h.slot),a=[...new Set(e.map(({kind:p})=>p))],o=p=>z(p).shape,i=a.map(p=>{const h=z(p),b=h.methods.map(({name:$,parameters:w,arguments:E,nativeArguments:I,requiresFragment:V})=>`
${V?`    [require(wgsl, fragment)]
`:""}    float4 ${$}(SamplerState sampling, ${w})
    {
        return texture.${$}(sampling, ${I});
    }
${V?`    [require(wgsl, fragment)]
`:""}    float4 ${$}(${w})
    {
        return ${$}(sampler, ${E});
    }`).join(`
`),P=p==="texture-2d"?`
    float4 Load(int2 pixel)
    {
        return load2D(texture, pixel);
    }`:"";return`struct ShaderStudioChannel${h.shape}
{
    ${h.textureType} texture;
    SamplerState sampler;
    ${h.sizeType} size;
    float time;
    bool loaded;
${b}
${P}
};`}).join(`

`),r=new Map,s=new Map,l=new Map,d=new Map((T=n.bindings)==null?void 0:T.map(p=>[p.slot,p])),c=e.map(({name:p,slot:h,kind:b},P)=>{const $=Fe({resource:{name:p,kind:b},slot:h}),w=d.get(h),E=(w==null?void 0:w.textureBinding)??1+P*2,I=(w==null?void 0:w.samplerBinding)??2+P*2,V=B=>n.runtime?`[[vk::binding(${B}, 0)]]
`:"",W=[];return r.has(E)||(r.set(E,$.texture),W.push(`${V(E)}Texture${o(b)}<float4> ${$.texture};`)),s.has(I)||(s.set(I,$.sampler),W.push(`${V(I)}SamplerState ${$.sampler};`)),l.set(h,{texture:r.get(E),sampler:s.get(I)}),W.join(`
`)}).join(`
`),u=n.channelCount??Math.max(4,...e.map(({slot:p})=>p+1)),m=n.runtime?"":`float3 _ssChannelResolution[${u}];
float _ssChannelTime[${u}];
float _ssChannelLoaded[${u}];`,S=n.runtime?"_st.channelResolution":"_ssChannelResolution",f=n.runtime?"_st.channelTime":"_ssChannelTime",g=n.runtime?"_st.channelLoaded":"_ssChannelLoaded",C=e.map(({name:p,slot:h,kind:b})=>{const{texture:P,sampler:$}=l.get(h),w=b==="texture-3d"?`uint3(${S}[${h}])`:`uint2(${S}[${h}].xy)`;return`property ShaderStudioChannel${o(b)} ${p}
    {
        get
        {
            ShaderStudioChannel${o(b)} result;
            result.texture = ${P};
            result.sampler = ${$};
            result.size = ${w};
            result.time = ${f}[${h}];
            result.loaded = ${g}[${h}] != 0.0;
            return result;
        }
    }`}).join(`
`);return`${Ze(a,"slang")}
${i}
${c}
${m}
${C}
`}const Je={int:"int",uint:"uint",float:"float",vec2:"float2",vec3:"float3",vec4:"float4",bool:"int"};function Qe(t){return re(t)!==null}function et(t=[],n={worldPosition:"_shaderStudioWorldPosition",normal:"_shaderStudioNormal",cameraPosition:"_shaderStudioCameraPosition",uv:"_shaderStudioVertexUv",frontFacing:"_shaderStudioFrontFacing"},e=4){const a=t.flatMap(({name:r,type:s})=>{const l=re(s);return l?[`    ${Je[l.base]} custom_${r}${l.length?`[${l.length}]`:""};`]:[]}).join(`
`),o=t.flatMap(({name:r,type:s})=>Qe(s)?[s==="bool"?`#define ${r} (${x}.custom_${r} != 0)`:`#define ${r} (${x}.custom_${r})`]:[]).join(`
`),i=[{symbol:y.worldPosition,contextName:n.worldPosition},{symbol:y.normal,contextName:n.normal},{symbol:y.cameraPosition,contextName:n.cameraPosition},{symbol:y.vertexUv,contextName:n.uv},{symbol:y.frontFacing,contextName:n.frontFacing}].map(({symbol:r,contextName:s})=>`static ${r.slangType} ${s};`).join(`
`);return`// ---- shader-studio Slang prelude (generated) ----
${ne}
struct ShaderToyUniforms
{
    float4 resolution;
    float4 mouse;
    float time;
    float timeDelta;
    float frameRate;
    int frame;
    float channelTime[${e}];
    float channelLoaded[${e}];
    float sampleRate;
    float4 date;
    float3 channelResolution[${e}];
    float4 cameraPos;
    float4 cameraDir;
    uint4 vertexCount;
    column_major float4x4 viewMatrix;
    column_major float4x4 projectionMatrix;
    column_major float4x4 viewProjection;
    ShaderStudioPointer pointer;
${a}
};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> ${x};

${Ue.join(`
`)}
${o}
${i}
// Set by the vertex entry from SV_InstanceID and passed flat to the fragment entry.
static uint iInstanceIndex;
`}const tt=Object.values({glsl:{id:"glsl",extensions:De,engine:"webgl",monacoId:"glsl",hasLanguageService:!0,hasDebugger:!0,hasDebugPlan:!1,hasImports:!1,label:"GLSL"},slang:{id:"slang",extensions:Ce,engine:"webgpu",monacoId:"slang",hasLanguageService:!0,hasDebugger:!0,hasDebugPlan:!0,hasImports:!0,label:"Slang"},wgsl:{id:"wgsl",extensions:Pe,engine:"webgpu",monacoId:"wgsl",hasLanguageService:!0,hasDebugger:!0,hasDebugPlan:!0,hasImports:!1,label:"WGSL"}}).flatMap(t=>t.extensions).sort((t,n)=>n.length-t.length);new RegExp(`\\.(${tt.join("|")})$`,"i");function nt(t){const n=[];let e=0,a=!0;for(;e<t.length;){const o=t[e],i=t[e+1];if(/\s/.test(o)){(o===`
`||o==="\r")&&(a=!0),e++;continue}if(o==="/"&&i==="/"){for(;e<t.length&&t[e]!==`
`;)e++;continue}if(o==="/"&&i==="*"){const r=t.indexOf("*/",e+2),s=t.slice(e,r<0?t.length:r+2);/[\r\n]/.test(s)&&(a=!0),e=r<0?t.length:r+2;continue}if(o==='"'||o==="'"){const r=o;for(e++;e<t.length&&t[e]!==r;)t[e]==="\\"&&e++,e++;e++,a=!1;continue}if(/[A-Za-z_]/.test(o)){const r=e++;for(;e<t.length&&/[A-Za-z0-9_]/.test(t[e]);)e++;n.push({value:t.slice(r,e),lineStart:a,offset:r})}else n.push({value:o,lineStart:a,offset:e}),e++;a=!1}return n}function O(t){return!!(t&&/^[A-Za-z_]\w*$/.test(t.value))}function at(t){const n=new Set,e=rt(t);for(const r of e.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)/gm))n.add({value:r[1],offset:r.index+r[0].lastIndexOf(r[1]),lineStart:!0});const a=[];let o=0,i=0;for(const r of nt(t)){if(o===0&&r.value==="#"&&r.lineStart){a.length=0,a.push(r);continue}o===0&&a.push(r),r.value==="("&&i++,r.value===")"&&(i=Math.max(0,i-1)),r.value==="{"?(o===0&&oe(a,n),o++,a.length=0):r.value==="}"?(o=Math.max(0,o-1),a.length=0):r.value===";"&&o===0&&i===0&&(oe(a,n),a.length=0)}return[...new Map([...n].map(r=>[r.offset,{name:r.value,offset:r.offset}])).values()]}function rt(t){const n=[...t];let e=0;for(;e<t.length;){let a=e;if(t.startsWith("//",e)){const o=t.indexOf(`
`,e+2);a=o===-1?t.length:o}else if(t.startsWith("/*",e)){const o=t.indexOf("*/",e+2);if(o===-1)break;a=o+2}if(a>e){for(;e<a;e++)t[e]!=="\r"&&t[e]!==`
`&&(n[e]=" ");continue}e++}return n.join("")}function oe(t,n){var l,d,c,u,m,S;const e=t.filter(({value:f})=>f!=="{");for(;((l=e[0])==null?void 0:l.value)==="[";){let f=0,g=0;do((d=e[g])==null?void 0:d.value)==="["&&f++,((c=e[g])==null?void 0:c.value)==="]"&&f--,g++;while(g<e.length&&f>0);e.splice(0,g)}if(e.length===0)return;if(((u=e[0])==null?void 0:u.value)==="#"&&((m=e[1])==null?void 0:m.value)==="define"&&O(e[2])){n.add(e[2]);return}const a=e.findIndex(({value:f})=>!["public","private","internal","static","extern","const","uniform"].includes(f)),o=e[a];if(!o||["import","module","namespace","using"].includes(o.value))return;if(["struct","class","interface","enum"].includes(o.value)&&O(e[a+1])){n.add(e[a+1]);return}if(o.value==="typedef"){const f=[...e].reverse().find(O);f&&n.add(f);return}if(o.value==="typealias"&&O(e[a+1])){n.add(e[a+1]);return}if(o.value==="property"){const f=[...e].reverse().find(O);f&&n.add(f);return}const i=e.findIndex(({value:f},g)=>g>a&&["=",";","[",",","("].includes(f)),r=e[i-1];if(i<=a+1||!O(r)||(n.add(r),((S=e[i])==null?void 0:S.value)==="("))return;let s=0;for(let f=i;f<e.length-1;f++){const g=e[f].value;["(","[","{"].includes(g)&&s++,[")","]","}"].includes(g)&&s--,g===","&&s===0&&O(e[f+1])&&n.add(e[f+1])}}function R(t){let n=1;const e=[],a=[],o=new Map,i=new Map;return{channels:[...t].sort((s,l)=>s.slot-l.slot).map(s=>{const l=JSON.stringify([s.kind==="cubemap"||s.outputKind==="cubemap"?"cube":s.kind==="volume"?"3d":"2d",s.sampleType??"float",s.textureIdentity??{slot:s.slot}]),d=JSON.stringify([s.samplerType??"filtering",s.samplerIdentity??`slot:${s.slot}`]);let c=o.get(l);c===void 0&&(c=n++,o.set(l,c),e.push({binding:c,slot:s.slot,kind:s.outputKind==="cubemap"?"buffer-cubemap":s.kind,sampleType:s.sampleType}));let u=i.get(d);return u===void 0&&(u=n++,i.set(d,u),a.push({binding:u,slot:s.slot,samplerType:s.samplerType})),{...s,textureBinding:c,samplerBinding:u}}),textures:e,samplers:a,nextBinding:n}}function ie(t){let n="",e=0;for(;e<t.length;){if(t.startsWith("//",e)){const a=t.indexOf(`
`,e+2);if(a===-1)break;n+=`
`,e=a+1;continue}if(t.startsWith("/*",e)){const a=t.indexOf("*/",e+2);if(a===-1){n+=t.slice(e);break}const o=a+2;for(;e<o;e++)t[e]===`
`&&(n+=`
`);continue}n+=t[e],e++}return n}const _={uv:y.vertexUv.name,worldPosition:y.worldPosition.name,normal:y.normal.name,cameraPosition:y.cameraPosition.name,frontFacing:y.frontFacing.name},K="iInstanceIndex";y.vertexUv.glslType,y.worldPosition.glslType,y.normal.glslType,y.cameraPosition.glslType,y.frontFacing.glslType;function se(t){return t!==void 0&&t!=="fullscreen"&&t!=="vertices"}const D="vertexMain",M="fragmentMain";function le(t,n){const e=new Set((t==null?void 0:t.map(({key:o})=>o))??[]);if(e.size===0)return[];const a=new Set;for(const{label:o,source:i}of n)for(const{name:r}of at(i))e.has(r)&&a.add(`Slang channel "${r}" conflicts with an authored declaration in ${o}. Rename the channel or declaration.`);return[...a]}function ue(t=[]){return Math.max(4,...t.map(({slot:n})=>n+1))}function ce(t,n=[]){return et(n,_,t)}function Z(t){return`struct MeshUniforms
{
    column_major float4x4 model;
    column_major float4x4 viewProjection;
    column_major float4x4 normalMatrix;
    float4 cameraPosition;
};

[[vk::binding(${t}, 0)]]
ConstantBuffer<MeshUniforms> _mesh;

#define iModelMatrix _mesh.model
#define iViewProjectionMatrix _mesh.viewProjection
#define iNormalMatrix _mesh.normalMatrix
`}function ot(t,n){return`${t.trim()||(n?"":"void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}")}
struct MixedMeshVertexOut { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; };
[shader("vertex")] MixedMeshVertexOut ${D}([[vk::location(0)]] float3 position : POSITION, [[vk::location(1)]] float3 normal : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0, uint vertexID : SV_VertexID) { mainVertex(vertexID, position, normal, uv); MixedMeshVertexOut output; float4 world = mul(_mesh.model, float4(position, 1)); output.position = mul(_mesh.viewProjection, world); output.uv = uv; output.worldPosition = world.xyz; output.normal = mul(_mesh.normalMatrix, float4(normal, 0)).xyz; return output; }
`}function it(){return`[shader("fragment")] float4 ${M}(float2 uv : TEXCOORD0, float3 worldPosition : TEXCOORD1, float3 normal : TEXCOORD2) : SV_Target { iWorldPosition = worldPosition; iNormal = normal; iCameraPosition = _mesh.cameraPosition.xyz; return mainImage(uv * iResolution.xy); }
`}function st(t,n){return`${t.trim()||(n?"":"void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}")}
[shader("vertex")] float4 ${D}(uint id : SV_VertexID) : SV_Position { float2 p[3] = {float2(-1,-1),float2(3,-1),float2(-1,3)}; float3 position = float3(p[id],0); float3 normal = float3(0,0,1); float2 uv = p[id] * .5 + .5; mainVertex(id,position,normal,uv); return float4(position,1); }
`}function lt(){return`[shader("fragment")] float4 ${M}(float4 p : SV_Position) : SV_Target { return mainImage(float2(p.x, iResolution.y - p.y)); }
`}const G="struct ShaderStudioVertexUvOut { float4 position : SV_Position; float2 uv : TEXCOORD0; };",ut="struct ShaderStudioVertexUvOut { float4 position : SV_Position; float2 uv : TEXCOORD0; nointerpolation uint instanceIndex : TEXCOORD1; };",q="uint instanceID : SV_InstanceID",J=`${K} = instanceID;`;function de(t){const n=t?", bool frontFacing : SV_IsFrontFace":"",e=t?"frontFacing":"true",a=t?` ${K} = input.instanceIndex;`:"";return`[shader("fragment")]
float4 ${M}(ShaderStudioVertexUvOut input${n}) : SV_Target { ${_.uv} = input.uv; ${_.frontFacing} = ${e};${a} return mainImage(float2(input.position.x, _st.resolution.y - input.position.y)); }
`}const fe=`[shader("fragment")]
float4 ${M}(MeshVertexOut input, bool frontFacing : SV_IsFrontFace) : SV_Target {
    ${_.uv} = input.uv;
    ${_.worldPosition} = input.worldPosition;
    ${_.normal} = input.normal;
    ${_.cameraPosition} = _mesh.cameraPosition.xyz;
    ${_.frontFacing} = frontFacing;
    ${K} = input.instanceIndex;
    float4 color = mainImage(input.uv * _st.resolution.xy);
    return color;
}
`,me="struct MeshVertexOut { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; nointerpolation uint instanceIndex : TEXCOORD3; };";function ct(t){return`${t}
${me}
[shader("vertex")]
MeshVertexOut ${D}([[vk::location(0)]] float3 position : POSITION, [[vk::location(1)]] float3 normal : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0, uint vertexID : SV_VertexID, ${q}) { ${J} mainVertex(vertexID, position, normal, uv); MeshVertexOut output; output.instanceIndex = instanceID; float4 worldPosition = mul(_mesh.model, float4(position, 1)); output.position = mul(_mesh.viewProjection, worldPosition); output.uv = uv; output.worldPosition = worldPosition.xyz; output.normal = mul(_mesh.normalMatrix, float4(normal, 0)).xyz; return output; }
${fe}`}function dt(t,n=!1){return!t.trim()&&!n?mt:`${t}
${G}
[shader("vertex")]
ShaderStudioVertexUvOut ${D}(uint vertexID : SV_VertexID) { float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) }; float3 position = float3(verts[vertexID], 0); float3 normal = float3(0, 0, 1); float2 uv = verts[vertexID] * 0.5 + 0.5; mainVertex(vertexID, position, normal, uv); ShaderStudioVertexUvOut output; output.position = float4(position, 1); output.uv = uv; return output; }
${de(!1)}
`}const ge="void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}",pe="float3 position = float3(0, 0, 0); float3 normal = float3(0, 0, 1); float2 uv = float2(0, 0);";function ft(t,n,e=!1){const a=t.trim()?t:e?"":ge;return n==="clip"?`${a}
${ut}
[shader("vertex")]
ShaderStudioVertexUvOut ${D}(uint vertexID : SV_VertexID, ${q}) { ${J} ${pe} mainVertex(vertexID, position, normal, uv); ShaderStudioVertexUvOut output; output.position = float4(position, 1); output.uv = uv; output.instanceIndex = instanceID; return output; }
${de(!0)}
`:`${a}
${me}
[shader("vertex")]
MeshVertexOut ${D}(uint vertexID : SV_VertexID, ${q}) { ${J} ${pe} mainVertex(vertexID, position, normal, uv); MeshVertexOut output; output.instanceIndex = instanceID; float4 worldPosition = mul(_mesh.model, float4(position, 1)); output.position = mul(_mesh.viewProjection, worldPosition); output.uv = uv; output.worldPosition = worldPosition.xyz; output.normal = mul(_mesh.normalMatrix, float4(normal, 0)).xyz; return output; }
${fe}`}const mt=`${G}
// ---- shader-studio Slang entry points (generated) ----
[shader("vertex")]
ShaderStudioVertexUvOut ${D}(uint vertexID : SV_VertexID)
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    ShaderStudioVertexUvOut output;
    output.position = float4(verts[vertexID], 0, 1);
    output.uv = verts[vertexID] * 0.5 + 0.5;
    return output;
}

[shader("fragment")]
float4 ${M}(ShaderStudioVertexUvOut input) : SV_Target
{
    ${_.uv} = input.uv;
    ${_.frontFacing} = true;
    // Flip Y so fragCoord origin is bottom-left, matching ShaderToy.
    float2 coord = float2(input.position.x, _st.resolution.y - input.position.y);
    return mainImage(coord);
}
`;function gt(t){return`${G}
struct CubemapFaceUniforms { uint4 data; };
[[vk::binding(${t}, 0)]] ConstantBuffer<CubemapFaceUniforms> _cubeFace;
float3 cubemapDirection(float2 pixel)
{
    float2 uv = 2.0 * pixel / _st.resolution.xy - 1.0;
    if (_cubeFace.data.x == 0u) return normalize(float3(1.0, -uv.y, -uv.x));
    if (_cubeFace.data.x == 1u) return normalize(float3(-1.0, -uv.y, uv.x));
    if (_cubeFace.data.x == 2u) return normalize(float3(uv.x, 1.0, uv.y));
    if (_cubeFace.data.x == 3u) return normalize(float3(uv.x, -1.0, -uv.y));
    if (_cubeFace.data.x == 4u) return normalize(float3(uv.x, -uv.y, 1.0));
    return normalize(float3(-uv.x, -uv.y, -1.0));
}
[shader("vertex")]
ShaderStudioVertexUvOut ${D}(uint vertexID : SV_VertexID)
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    ShaderStudioVertexUvOut output;
    output.position = float4(verts[vertexID], 0, 1);
    output.uv = verts[vertexID] * 0.5 + 0.5;
    return output;
}
[shader("fragment")]
float4 ${M}(ShaderStudioVertexUvOut input) : SV_Target
{
    ${_.uv} = input.uv;
    ${_.frontFacing} = true;
    float2 coord = input.position.xy;
    return mainCubemap(coord, float3(0.0), cubemapDirection(coord));
}
`}function he(t){return`// ---- shader-studio Slang capture prelude (generated) ----
struct DbgCaptureUniforms
{
    float4 coordGrid;
    int varIndex;
    int isPixelMode;
    int2 _dbgPad;
};

[[vk::binding(${t}, 0)]]
ConstantBuffer<DbgCaptureUniforms> _dbgCapU;

#define _dbgVarIndex (_dbgCapU.varIndex)
`}const pt=`${G}
// ---- shader-studio Slang capture entry points (generated) ----
[shader("vertex")]
ShaderStudioVertexUvOut ${D}(uint vertexID : SV_VertexID)
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    ShaderStudioVertexUvOut output;
    output.position = float4(verts[vertexID], 0, 1);
    output.uv = verts[vertexID] * 0.5 + 0.5;
    return output;
}

[shader("fragment")]
float4 ${M}(ShaderStudioVertexUvOut input) : SV_Target
{
    ${_.uv} = input.uv;
    ${_.frontFacing} = true;
    float2 fragCoord = input.position.xy;
    float2 coord = _dbgCapU.isPixelMode != 0
        ? _dbgCapU.coordGrid.xy
        : fragCoord / _dbgCapU.coordGrid.zw * _st.resolution.xy;
    return mainImage(coord);
}
`;function xe(t=[]){return qe(t.map(({key:n,slot:e,kind:a,outputKind:o})=>({name:n,slot:e,kind:a==="cubemap"||o==="cubemap"?"texture-cube":a==="volume"?"texture-3d":"texture-2d"})),{runtime:!0,bindings:R(t).channels})}function Se(t,n,e,a=1+n*2){const o=e==="compute"?"RWStructuredBuffer":"StructuredBuffer",i=l=>e==="compute"?l:l==="Atomic<uint>"?"uint":l==="Atomic<int>"?"int":l,r=new Set,s=l=>{var c;if(l.streamMaxPerFrame)return`struct _ScriptStream_${l.name} { uint length; uint data[${l.streamMaxPerFrame}]; };
[[vk::binding(${a+l.binding}, 0)]]
StructuredBuffer<_ScriptStream_${l.name}> _scriptStream_${l.name};
#define ${l.name} (_scriptStream_${l.name}[0])
`;const d=r.has(l.elementType)?"":((c=l.structDeclarations)==null?void 0:c.slang)??"";return d&&r.add(l.elementType),`${d}[[vk::binding(${a+l.binding}, 0)]]
${o}<${i(l.elementType)}> ${l.name};
`};return{beforeCommon:t.filter(l=>l.builtin).map(s).join(""),afterCommon:t.filter(l=>!l.builtin).map(s).join("")}}function ht(t,n={}){var c,u,m,S,f,g,C;((c=n.vertexCode)==null?void 0:c.trim())===t.trim()&&(n={...n,vertexCode:void 0});const e=ce(ue(n.channels),n.customUniforms),a=(n.commonCode??"").trim(),o=a?`${a}
`:"",i=xe(n.channels),r=Se(n.storage??[],((u=n.channels)==null?void 0:u.length)??0,n.passKind??"render",R(n.channels??[]).nextBinding);if(n.renderEntryPoints&&(n.renderEntryPoints.vertex||n.renderEntryPoints.fragment)){const T=se(n.geometry),p=R(n.channels??[]).nextBinding+(((m=n.storage)==null?void 0:m.length)??0),h=T?Z(p):"",b=n.captureMode?he(p+(T?1:0)):"",P=((S=n.vertexCode)==null?void 0:S.trim())??"",$=k(`${o}
${t}`).some(I=>I.name==="mainVertex"),w=n.renderEntryPoints.vertex?"":T?ot(P,$):st(P,$),E=n.renderEntryPoints.fragment?"":T?it():lt();return`${e}
${i}
${r.beforeCommon}${o}${r.afterCommon}${h}${b}#line 1
${t}
${w}${E}`}if(n.captureMode){const T=R(n.channels??[]).nextBinding+(((f=n.storage)==null?void 0:f.length)??0),p=he(T);return`${e}
${i}
${r.beforeCommon}${o}${r.afterCommon}${p}
#line 1
${t}
${pt}`}if(n.outputKind==="cubemap"){const T=R(n.channels??[]).nextBinding+(((g=n.storage)==null?void 0:g.length)??0);return`${e}
${i}
${r.beforeCommon}${o}${r.afterCommon}#line 1
${t}
${gt(T)}`}const s=R(n.channels??[]).nextBinding+(((C=n.storage)==null?void 0:C.length)??0),{meshPrelude:l,entryPoints:d}=xt(n,s,`${o}
${t}`);return`${e}
${i}
${r.beforeCommon}${o}${r.afterCommon}${l}#line 1
${t}
${d}`}function xt(t,n,e){var i;const a=((i=t.vertexCode)==null?void 0:i.trim())??"",o=k(e).some(r=>r.name==="mainVertex");if(se(t.geometry))return{meshPrelude:Z(n),entryPoints:ct(a||(o?"":ge))};if(t.geometry==="vertices"){const r=t.vertexSpace??Te;return{meshPrelude:r==="world"?Z(n):"",entryPoints:ft(a,r,o)}}return{meshPrelude:"",entryPoints:dt(a,o)}}function St(t,n,e="rgba16f",a){if(n>1){const o=a==="cubemap",i=o?"pixel":"coord",r=o?"face":"layer",s=o?`${i}.y`:`h - 1 - ${i}.y`;return`// ---- shader-studio Slang compute output (generated) ----
[[vk::binding(${t}, 0)]]
[[vk::image_format("${e}")]]
WTexture2DArray<float4> _outTex;
${o?`
float3 cubemapDirection(uint2 pixel, uint face)
{
    float2 uv = 2.0 * (float2(pixel) + 0.5) / iResolution.xy - 1.0;
    if (face == 0u) return normalize(float3(1.0, -uv.y, -uv.x));
    if (face == 1u) return normalize(float3(-1.0, -uv.y, uv.x));
    if (face == 2u) return normalize(float3(uv.x, 1.0, uv.y));
    if (face == 3u) return normalize(float3(uv.x, -1.0, -uv.y));
    if (face == 4u) return normalize(float3(uv.x, -uv.y, 1.0));
    return normalize(float3(-uv.x, -uv.y, -1.0));
}
`:""}

void writeOutput(uint2 ${i}, uint ${r}, float4 color)
{
    uint w;
    uint h;
    uint layers;
    _outTex.GetDimensions(w, h, layers);
    if (${i}.x >= w || ${i}.y >= h || ${r} >= layers)
    {
        return;
    }
    _outTex.Store(uint3(${i}.x, ${s}, ${r}), color);
}
`}return`// ---- shader-studio Slang compute output (generated) ----
[[vk::binding(${t}, 0)]]
[[vk::image_format("${e}")]]
WTexture2D<float4> _outTex;

void writeOutput(uint2 coord, float4 color)
{
    uint w;
    uint h;
    _outTex.GetDimensions(w, h);
    if (coord.x >= w || coord.y >= h)
    {
        return;
    }
    _outTex.Store(uint2(coord.x, h - 1 - coord.y), color);
}
`}function vt(t){return`struct DispatchUniforms
{
    int4 dispatch;
};

[[vk::binding(${t}, 0)]]
ConstantBuffer<DispatchUniforms> _dsp;

#define iDispatch (_dsp.dispatch.x)
`}function yt(t){const n=ie(t),e=[],a=/\[\s*shader\s*\(\s*["']compute["']\s*\)\s*\]\s*\[\s*numthreads\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\]\s*void\s+([A-Za-z_]\w*)\s*\(/gi;for(const o of n.matchAll(a)){const i=o.slice(1,4).map(Number);i.every(r=>Number.isInteger(r)&&r>0)&&e.push({name:o[4],workgroupSize:[i[0],i[1],i[2]]})}return e}function Tt(t,n,e=""){return be(t,"slang",n,[e])}function $t(t,n){const e=ce(ue(n.channels),n.customUniforms),a=n.channels??[],o=n.storage??[],i=(n.commonCode??"").trim(),r=i?`${i}
`:"",s=xe(a),l=Se(o,a.length,"compute",R(a).nextBinding),d=R(a).nextBinding+o.length,c=n.hasOutput?St(d,n.outputLayers,n.outputImageFormat??"rgba16f",n.outputKind):"",u=d+(n.hasOutput?1:0),m=vt(u);return`${e}
${s}
${l.beforeCommon}${r}${l.afterCommon}${c}${m}#line 1
${t}`}const ve=new WeakMap;class _t{constructor(n){this.slang=n,this.globalSession=null,this.wgslTargetValue=null}compileImagePass(n,e={}){var m,S,f;const a=le(e.channels,[{label:e.sourcePath??"shader source",source:n},...e.commonCode?[{label:"Common",source:e.commonCode}]:[],...e.vertexCode?[{label:"vertex source",source:e.vertexCode}]:[]]);if(a.length>0)return{success:!1,errors:a};let o,i;try{({globalSession:o,target:i}=this.ensureGlobalSession())}catch(g){return{success:!1,errors:[Dt(g)]}}const r=o.createSession(i);if(!r)return{success:!1,errors:[this.lastError("Slang: failed to create session")]};const s=[];let l=null,d=[],c=null,u=null;try{for(const v of e.modules??[]){const L=r.loadModuleFromSource(v.source,v.moduleName,v.path);if(!L)return{success:!1,errors:[this.lastError(`Slang: failed to compile imported module ${v.moduleName} (${v.path})`)]};s.push(L)}const g=wt(n,s.length>0),C=e.passKind==="compute",T=C?yt(g):[],p=e.entryPoint?(m=T.find(({name:v})=>v===e.entryPoint))==null?void 0:m.name:T.length===1?T[0].name:void 0;if(C&&!p)return{success:!1,errors:['Slang: compute source must declare a native `[shader("compute")]` entry point']};const h=Pt(C,p,e),b=h?Tt(g,h,e.commonCode):g,P=C?$t(b,{passName:e.passName,commonCode:e.commonCode,channels:e.channels,storage:e.storage,workgroupSize:e.workgroupSize??[8,8,1],outputLayers:e.outputLayers??1,outputKind:e.outputKind,hasOutput:e.hasOutput===!0,customUniforms:e.customUniforms,outputImageFormat:e.outputImageFormat??"rgba16f"}):ht(b,{passName:e.passName,commonCode:e.commonCode,channels:e.channels,storage:e.storage,passKind:e.passKind??"render",geometry:e.geometry,vertexCode:e.vertexCode,vertexSpace:e.vertexSpace,captureMode:e.captureMode,outputKind:e.outputKind,renderEntryPoints:e.renderEntryPoints,customUniforms:e.customUniforms}),E=((S=ie(g).match(/^\s*module\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/m))==null?void 0:S[1])??(e.passName??"image").toLowerCase(),I=e.sourcePath??`/${E}.slang`;if(l=r.loadModuleFromSource(P,E,I),!l){const v=this.lastError("Slang: failed to compile module"),L=/ambiguous|redefinition|already defined|conflicting/i.test(v)?le((f=e.channels)==null?void 0:f.filter(({key:te})=>v.includes(te)),(e.modules??[]).map(({path:te,source:Rt})=>({label:te,source:Rt}))):[];return L.length>0?{success:!1,errors:L}:{success:!1,errors:[Ct(v)?"Missing mainImage function":v]}}const V=l;if(d=(C?[p]:e.renderEntryPoints?[e.renderEntryPoints.vertex??D,e.renderEntryPoints.fragment??M]:[D,M]).map(v=>V.findEntryPointByName(v)),d.some(v=>!v))return{success:!1,errors:[C?"Slang: configured native compute entry point was not found":e.renderEntryPoints?"Slang: configured native render entry point was not found":"Slang: entry points not found (is `mainImage` defined?)"]};if(c=r.createCompositeComponentType([...s,V,...d]),!c)return{success:!1,errors:[this.lastError("Slang: failed to compose program")]};if(u=c.link(),!u)return{success:!1,errors:[this.lastError("Slang: failed to link program")]};const B=u.getTargetCode(0);return B?{success:!0,wgsl:B}:{success:!1,errors:[this.lastError("Slang: produced empty WGSL")]}}finally{A(u),A(c);for(const g of d)A(g);A(l);for(const g of s)A(g);A(r)}}dispose(){this.globalSession=null,this.wgslTargetValue=null}ensureGlobalSession(){if(this.globalSession&&this.wgslTargetValue!==null)return{globalSession:this.globalSession,target:this.wgslTargetValue};const n=ve.get(this.slang);if(n)return this.globalSession=n.globalSession,this.wgslTargetValue=n.target,n;const e=this.slang.createGlobalSession();if(!e)throw new Error("Slang: createGlobalSession returned null");const a=ye(this.slang.getCompileTargets()),o=a.find(i=>/wgsl/i.test(i.name));if(!o)throw new Error(`Slang: no WGSL compile target (available: ${a.map(i=>i.name).join(", ")||"none"})`);return this.globalSession=e,this.wgslTargetValue=o.value,ve.set(this.slang,{globalSession:e,target:o.value}),{globalSession:e,target:o.value}}lastError(n){var a,o,i,r;const e=(r=(i=(o=(a=this.slang).getLastError)==null?void 0:o.call(a))==null?void 0:i.message)==null?void 0:r.trim();return e&&e.length>0?e:n}}function wt(t,n){return n?t:t.split(`
`).map(e=>bt(e)?"":e).join(`
`)}function bt(t){let n=t.trim();return!n.startsWith("import")||n[6]!==" "&&n[6]!=="	"?!1:(n=n.slice(7).trim(),n.endsWith(";")&&(n=n.slice(0,-1).trimEnd()),n.startsWith('"')?n.length>2&&n.endsWith('"')&&!n.slice(1,-1).includes('"'):n.split(".").every(e=>/^[A-Za-z_]\w*$/.test(e)))}function Dt(t){return t instanceof Error?t.message:String(t)}function Ct(t){return/undefined identifier[\s\S]*['"]mainImage['"]/i.test(t)}function A(t){var n;(n=t==null?void 0:t.delete)==null||n.call(t)}function Pt(t,n,e){if(t)return[n];if(e.renderEntryPoints)return[e.renderEntryPoints.vertex??"mainVertex",e.renderEntryPoints.fragment??"mainImage"]}const Et=()=>typeof window<"u"||"WorkerGlobalScope"in globalThis,It=t=>Et()?import(t):new Function("url","return import(url);")(t);let Q=null;function Mt(t,n){return Q||(Q=It(t).then(e=>e.default({locateFile:()=>n}))),Q}const F=self;let ee=null;function U(t,n,e){F.postMessage({type:"status",label:t,id:n,detail:e})}U("boot"),F.onmessage=async t=>{const n=t.data;try{if(n.type==="init"){U("init-received",n.id),U("load-slang-start",n.id);const a=await Mt(n.scriptUrl,n.wasmUrl);U("load-slang-complete",n.id),ee=new _t(a),U("compiler-created",n.id),F.postMessage({id:n.id,ok:!0});return}if(!ee)throw new Error("compile requested before worker init");const e=ee.compileImagePass(n.source,n.options);F.postMessage({id:n.id,ok:!0,result:e})}catch(e){F.postMessage({id:n.id,ok:!1,error:e instanceof Error?e.message:String(e)}),U("error",n.id,e instanceof Error?e.message:String(e))}}})();
