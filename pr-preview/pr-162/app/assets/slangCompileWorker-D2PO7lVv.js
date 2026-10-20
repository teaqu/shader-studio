(function(){"use strict";function De(e){if(Array.isArray(e))return e;if(e&&typeof e.size=="function"){const n=[],t=e;for(let a=0;a<t.size();a++)n.push(t.get(a));return n}return[]}const be="world";function j(e){const n=[];let t=0;for(;t<e.length;){const a=e[t];if(/\s/.test(a)){t++;continue}if(e.startsWith("//",t)){const r=e.indexOf(`
`,t+2);t=r<0?e.length:r;continue}if(e.startsWith("/*",t)){let r=1;for(t+=2;t<e.length&&r>0;)e.startsWith("/*",t)?(r++,t+=2):e.startsWith("*/",t)?(r--,t+=2):t++;continue}const o=t++;let i="punctuation";if(a==='"'||a==="'"){for(i="string";t<e.length;)if(e[t]==="\\")t+=2;else if(e[t++]===a)break}else if(/[A-Za-z_]/.test(a))for(i="identifier";t<e.length&&/[A-Za-z0-9_]/.test(e[t]);)t++;n.push({text:e.slice(o,t),kind:i,start:o,end:Math.min(t,e.length)})}return n}function k(e,n){const t=j(e),a=[];let o=0,i=0,r=-1;for(let s=0;s<t.length;s++){const l=t[s];if(l.text==="{")i===0&&(r=s),i++;else if(l.text==="}"){if(i=Math.max(0,i-1),i!==0||r<0)continue;const f=t.slice(o,r),c=Pe(f);c&&a.push({name:c.name,stage:c.stage,start:f[0].start,end:l.end,bodyStart:t[r].end,bodyEnd:l.start}),o=s+1,r=-1}else l.text===";"&&i===0&&(o=s+1)}return a}function Ce(e){return e==="vertex"||e==="fragment"||e==="compute"}function Pe(e,n){return Ee(e)}function Ee(e){var a,o,i;let n,t=0;for(let r=0;r<e.length;r++){const s=e[r].text;if(s==="["?t++:s==="]"&&(t=Math.max(0,t-1)),t>0&&s==="shader"&&((a=e[r+1])==null?void 0:a.text)==="("){const l=(o=e[r+2])==null?void 0:o.text,f=l==null?void 0:l.slice(1,-1);l!=null&&l.startsWith('"')&&Ce(f)&&(n=f)}if(t===0&&s==="=")return;if(t===0&&s==="("&&((i=e[r-1])==null?void 0:i.kind)==="identifier")return e.some(l=>["struct","class","namespace","interface"].includes(l.text))?void 0:{name:e[r-1].text,stage:n}}}function Re(e,n,t,a=[]){const o=k(e);if(!o.length)return e;const i=new Map;for(const u of o)i.set(u.name,[...i.get(u.name)??[],u]);const r=j(e),s=new Set(t),l=[...t],f=u=>{for(let m=0;m<u.length;m++){const S=u[m];S.kind!=="identifier"||!i.has(S.text)||s.has(S.text)||(s.add(S.text),l.push(S.text))}};f(r.filter(u=>!o.some(m=>u.start>=m.start&&u.end<=m.end)));for(const u of a)f(j(u));for(;l.length;)for(const u of i.get(l.pop())??[])f(r.filter(m=>m.start>=u.start&&m.end<=u.end));const c=e.split("");for(const u of o)if(!s.has(u.name))for(let m=u.start;m<u.end;m++)c[m]!==`
`&&c[m]!=="\r"&&(c[m]=" ");return c.join("")}[...Object.values({float:{render:"f32",compute:"f32"},float2:{render:"vec2<f32>",compute:"vec2<f32>"},float3:{render:"vec3<f32>",compute:"vec3<f32>"},float4:{render:"vec4<f32>",compute:"vec4<f32>"},int:{render:"i32",compute:"i32"},int2:{render:"vec2<i32>",compute:"vec2<i32>"},int3:{render:"vec3<i32>",compute:"vec3<i32>"},int4:{render:"vec4<i32>",compute:"vec4<i32>"},uint:{render:"u32",compute:"u32"},uint2:{render:"vec2<u32>",compute:"vec2<u32>"},uint3:{render:"vec3<u32>",compute:"vec3<u32>"},uint4:{render:"vec4<u32>",compute:"vec4<u32>"},"Atomic<uint>":{render:"u32",compute:"atomic<u32>"},"Atomic<int>":{render:"i32",compute:"atomic<i32>"},float2x2:{render:"mat2x2<f32>",compute:"mat2x2<f32>"},float3x3:{render:"mat3x3<f32>",compute:"mat3x3<f32>"},float4x4:{render:"mat4x4<f32>",compute:"mat4x4<f32>"}}).flatMap(({render:e,compute:n})=>[e,n]),...[2,3,4].flatMap(e=>["f16","f32","i32","u32"].map(n=>`vec${e}<${n}>`)),...[2,3,4].flatMap(e=>["h","f","i","u"].map(n=>`vec${e}${n}`)),...[2,3,4].flatMap(e=>[2,3,4].flatMap(n=>[`mat${e}x${n}<f16>`,`mat${e}x${n}<f32>`,`mat${e}x${n}h`,`mat${e}x${n}f`]))];const Ve=["glsl","frag","vert"],Ie=["slang"],Me=["wgsl"],re="struct ShaderStudioPointer { float2 position; int inside; int held; int pressed; int released; int modifiers; int _padding; float2 wheel; float2 wheelDelta; };";function Oe(e){return Object.freeze({...e,languages:Object.freeze([...e.languages]),...e.stages?{stages:Object.freeze([...e.stages])}:{}})}function X(e){return Object.freeze(e.map(Oe))}const Ae=new Set(["fragColor","HW_PERFORMANCE","iResolution","iTime","iTimeDelta","iFrameRate","iMouse","iPointer","ShaderStudioPointer","iFrame","iDate","iChannelTime","iSampleRate","iCameraPos","iCameraDir","iVertexCount","iInstanceCount","iViewMatrix","iProjectionMatrix","iViewProjection","iVRActive","iVRControllerPosition","iVRControllerDirection","iVRControllerButtons","iVRControllerAxes","iVRControllerFaceButtons","iVRControllerTouches","iVRControllerFaceTouches"]),A=X([{name:"iWorldPosition",glslType:"vec3",slangType:"float3",wgslType:"vec3f",glslDeclaration:"vec3 iWorldPosition;",slangDeclaration:"float3 iWorldPosition;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"World-space position of the current fragment; zero for fullscreen geometry."},{name:"iNormal",glslType:"vec3",slangType:"float3",wgslType:"vec3f",glslDeclaration:"vec3 iNormal;",slangDeclaration:"float3 iNormal;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"World-space interpolated normal of the current fragment; zero for fullscreen geometry."},{name:"iCameraPosition",glslType:"vec3",slangType:"float3",wgslType:"vec3f",glslDeclaration:"vec3 iCameraPosition;",slangDeclaration:"float3 iCameraPosition;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"World-space camera position for mesh fragments; zero for fullscreen geometry."},{name:"iVertexUv",glslType:"vec2",slangType:"float2",wgslType:"vec2f",glslDeclaration:"vec2 iVertexUv;",slangDeclaration:"float2 iVertexUv;",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"Perspective-correct interpolated UV written by mainVertex for the current fragment."},{name:"iFrontFacing",glslType:"bool",slangType:"bool",wgslType:"bool",glslDeclaration:"bool iFrontFacing;",slangDeclaration:"#define iFrontFacing true",languages:["glsl","slang","wgsl"],stages:["fragment"],description:"Whether the current primitive is front-facing; always true for fullscreen geometry."}]),T=Object.freeze({worldPosition:A[0],normal:A[1],cameraPosition:A[2],vertexUv:A[3],frontFacing:A[4]}),Ne=X([{name:"iModelMatrix",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iModelMatrix;",languages:["slang","wgsl"],description:"Model-to-world transform for a native WebGPU mesh pass."},{name:"iViewProjectionMatrix",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iViewProjectionMatrix;",languages:["slang","wgsl"],description:"World-to-clip transform for a native WebGPU mesh pass."},{name:"iNormalMatrix",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iNormalMatrix;",languages:["slang","wgsl"],description:"Normal transform for a native WebGPU mesh pass."}]),Le=X([{name:"iResolution",glslType:"vec3",slangType:"float3",wgslType:"vec3f",slangDeclaration:"float3 iResolution;",languages:["glsl","slang","wgsl"],description:"Canvas dimensions: xy is width and height, z is the aspect ratio."},{name:"iTime",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iTime;",languages:["glsl","slang","wgsl"],description:"Elapsed time in seconds."},{name:"iTimeDelta",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iTimeDelta;",languages:["glsl","slang","wgsl"],description:"Time since the previous frame in seconds."},{name:"iFrameRate",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iFrameRate;",languages:["glsl","slang","wgsl"],description:"Current frames per second."},{name:"iMouse",glslType:"vec4",slangType:"float4",wgslType:"vec4f",slangDeclaration:"float4 iMouse;",languages:["glsl","slang","wgsl"],description:"Mouse position in xy and click position in zw."},{name:"iPointer",glslType:"ShaderStudioPointer",slangType:"ShaderStudioPointer",wgslType:"ShaderStudioPointer",slangDeclaration:`${re}
ShaderStudioPointer iPointer;`,languages:["glsl","slang","wgsl"],description:"Canvas pointer position, inside state, held/pressed/released button masks, modifiers, accumulated wheel and per-frame wheelDelta."},{name:"iFrame",glslType:"int",slangType:"int",wgslType:"i32",slangDeclaration:"int iFrame;",languages:["glsl","slang","wgsl"],description:"Frame counter starting at zero."},{name:"iDate",glslType:"vec4",slangType:"float4",wgslType:"vec4f",slangDeclaration:"float4 iDate;",languages:["glsl","slang","wgsl"],description:"Year, month, day, and seconds since midnight."},{name:"iChannelTime",glslType:"float[1024]",slangType:"float[1024]",languages:["glsl"],description:"Playback time for each configured input channel."},{name:"iChannelResolution",glslType:"vec3[1024]",slangType:"float3[1024]",languages:["glsl"],description:"Resolution of each configured input channel."},{name:"iSampleRate",glslType:"float",slangType:"float",wgslType:"f32",slangDeclaration:"float iSampleRate;",languages:["glsl","slang","wgsl"],description:"Audio sample rate in hertz."},{name:"iCameraPos",glslType:"vec3",slangType:"float3",wgslType:"vec3f",slangDeclaration:"float3 iCameraPos;",languages:["glsl","slang","wgsl"],description:"Camera position in world space."},{name:"iCameraDir",glslType:"vec3",slangType:"float3",wgslType:"vec3f",slangDeclaration:"float3 iCameraDir;",languages:["glsl","slang","wgsl"],description:"Normalised camera look direction."},{name:"iVRActive",glslType:"bool",slangType:"bool",wgslType:"bool",slangDeclaration:"#define iVRActive false",languages:["glsl","slang","wgsl"],description:"True during an immersive WebXR session. Shader Studio extension: GLSL opts in with #define SHADER_STUDIO_VR_INPUTS; Slang and WGSL always provide it."},{name:"iVRControllerPosition",glslType:"vec4[2]",slangType:"float4[2]",wgslType:"array<vec4f, 2>",slangDeclaration:"float4 iVRControllerPosition[2];",languages:["glsl","slang","wgsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled in GLSL (always in Slang and WGSL): tracked aim-ray origin in shader-world metres; w is 1 when tracked, otherwise 0. Slots are left (0) and right (1)."},{name:"iVRControllerDirection",glslType:"vec4[2]",slangType:"float4[2]",wgslType:"array<vec4f, 2>",slangDeclaration:"float4 iVRControllerDirection[2];",languages:["glsl","slang","wgsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled in GLSL (always in Slang and WGSL): tracked aim-ray direction; w is 1 when tracked, otherwise 0."},{name:"iVRControllerButtons",glslType:"vec4[2]",slangType:"float4[2]",wgslType:"array<vec4f, 2>",slangDeclaration:"float4 iVRControllerButtons[2];",languages:["glsl","slang","wgsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled in GLSL (always in Slang and WGSL): xr-standard trigger (x), grip (y), touchpad click (z), thumbstick click (w), from 0 to 1. Left/right slots 0/1."},{name:"iVRControllerAxes",glslType:"vec4[2]",slangType:"float4[2]",wgslType:"array<vec4f, 2>",slangDeclaration:"float4 iVRControllerAxes[2];",languages:["glsl","slang","wgsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled in GLSL (always in Slang and WGSL): touchpad xy and thumbstick zw, from -1 to 1. Left/right slots 0/1."},{name:"iVRControllerFaceButtons",glslType:"vec4[2]",slangType:"float4[2]",wgslType:"array<vec4f, 2>",slangDeclaration:"float4 iVRControllerFaceButtons[2];",languages:["glsl","slang","wgsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled in GLSL (always in Slang and WGSL): primary/secondary buttons in xy (Quest X/Y left, A/B right), from 0 to 1. zw are zero."},{name:"iVRControllerTouches",glslType:"vec4[2]",slangType:"float4[2]",wgslType:"array<vec4f, 2>",slangDeclaration:"float4 iVRControllerTouches[2];",languages:["glsl","slang","wgsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled in GLSL (always in Slang and WGSL): touch states for trigger, grip, touchpad and thumbstick in xyzw; 0 or 1."},{name:"iVRControllerFaceTouches",glslType:"vec4[2]",slangType:"float4[2]",wgslType:"array<vec4f, 2>",slangDeclaration:"float4 iVRControllerFaceTouches[2];",languages:["glsl","slang","wgsl"],description:"With SHADER_STUDIO_VR_INPUTS enabled in GLSL (always in Slang and WGSL): primary/secondary face-button touch states in xy; zw are zero."},{name:"iVertexCount",glslType:"int",slangType:"uint",wgslType:"u32",slangDeclaration:"uint32_t iVertexCount;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"Vertices drawn by this pass: the configured vertexCount for vertices geometry (default 3), 3 for fullscreen, or the mesh vertex count for plane, cube, sphere, and model geometry. vertexIndex ranges from 0 to iVertexCount - 1."},{name:"iInstanceCount",glslType:"int",slangType:"uint",wgslType:"u32",slangDeclaration:"uint32_t iInstanceCount;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"Instances drawn by this pass: the configured instanceCount (default 1), or 1 for fullscreen geometry. iInstanceIndex ranges from 0 to iInstanceCount - 1."},{name:"iViewMatrix",glslType:"mat4",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iViewMatrix;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"The orbit camera's view matrix: world space to view space, the camera looking down -z. The model matrix is the identity, so world space is the space mainVertex writes for meshes and world-space vertices."},{name:"iProjectionMatrix",glslType:"mat4",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iProjectionMatrix;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"The orbit camera's perspective projection for this pass's aspect ratio: 45° vertical field of view, near 0.01, far 100. Clip-space depth follows the renderer: -1 to 1 in WebGL (GLSL), 0 to 1 in WebGPU (Slang, WGSL)."},{name:"iViewProjection",glslType:"mat4",slangType:"float4x4",wgslType:"mat4x4f",slangDeclaration:"float4x4 iViewProjection;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"iProjectionMatrix * iViewMatrix: takes a world-space point to clip space exactly as meshes and world-space vertices are drawn. Divide by w to get the clip-space position a clip-space vertex writes."},{name:"iInstanceIndex",glslType:"int",slangType:"uint",wgslType:"u32",glslDeclaration:"int iInstanceIndex;",slangDeclaration:"uint32_t iInstanceIndex;",languages:["glsl","slang","wgsl"],stages:["fragment","vertex"],description:"Zero-based index of the instance being drawn; always 0 for fullscreen geometry. Fragments receive the value of the instance that produced their primitive."},{name:"iDispatch",slangType:"int",wgslType:"i32",slangDeclaration:"int iDispatch;",languages:["slang","wgsl"],stages:["compute"],description:"Zero-based repetition index for the current compute pass dispatch."},{name:"iChannelN",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Any renderer-assigned input channel. Slots follow configured input order and are not inferred from resource names."},{name:"iChannel0",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"First input channel; its texture shape follows the configured resource."},{name:"iChannel1",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Second input channel; its texture shape follows the configured resource."},{name:"iChannel2",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Third input channel; its texture shape follows the configured resource."},{name:"iChannel3",glslType:"sampler2D | samplerCube | sampler3D",slangType:"Texture2D<float4> | TextureCube<float4>",languages:["glsl"],description:"Fourth input channel; its texture shape follows the configured resource."},{name:"iCh0",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"First input channel with sampler, size, playback time, and loaded state metadata."},{name:"iCh1",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"Second input channel with sampler, size, playback time, and loaded state metadata."},{name:"iCh2",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"Third input channel with sampler, size, playback time, and loaded state metadata."},{name:"iCh3",glslType:"ShaderToy channel metadata struct",slangType:"ShaderToyChannel2D | ShaderToyChannelCube",languages:["glsl"],description:"Fourth input channel with sampler, size, playback time, and loaded state metadata."},...A,...Ne]),Ue=new Set(["iChannelN"]);function Y(e){return Object.freeze(Le.filter(n=>n.languages.includes(e)&&!Ue.has(n.name)).map(n=>n.name))}const Fe={glsl:Y("glsl"),slang:Y("slang"),wgsl:Y("wgsl")};function Ge(e){return Fe[e]}const H=Object.freeze([{name:"iVRControllerPosition",field:"vrControllerPosition",data:"positions"},{name:"iVRControllerDirection",field:"vrControllerDirection",data:"directions"},{name:"iVRControllerButtons",field:"vrControllerButtons",data:"buttons"},{name:"iVRControllerAxes",field:"vrControllerAxes",data:"axes"},{name:"iVRControllerFaceButtons",field:"vrControllerFaceButtons",data:"faceButtons"},{name:"iVRControllerTouches",field:"vrControllerTouches",data:"touches"},{name:"iVRControllerFaceTouches",field:"vrControllerFaceTouches",data:"faceTouches"}]),h="_st",ze=Object.freeze([h]),We=Object.freeze([`#define iResolution (${h}.resolution.xyz)`,`#define iMouse (${h}.mouse)`,`#define iPointer (${h}.pointer)`,`#define iTime (${h}.time)`,`#define iTimeDelta (${h}.timeDelta)`,`#define iFrameRate (${h}.frameRate)`,`#define iFrame (${h}.frame)`,`#define iSampleRate (${h}.sampleRate)`,`#define iDate (${h}.date)`,`#define iCameraPos (${h}.cameraPos.xyz)`,`#define iCameraDir (${h}.cameraDir.xyz)`,`#define iVertexCount (${h}.vertexCount.x)`,`#define iInstanceCount (${h}.vertexCount.y)`,`#define iViewMatrix (${h}.viewMatrix)`,`#define iProjectionMatrix (${h}.projectionMatrix)`,`#define iViewProjection (${h}.viewProjection)`,`#define iVRActive (${h}.vrState.z != 0)`,...H.map(({name:e,field:n})=>`#define ${e} (${h}.${n})`)]);function K(e){const n=new Set;if(e==="glsl")for(const t of Ae)n.add(t);else if(e==="wgsl")n.add("mainImage"),n.add("mainVertex"),n.add("vertexMain"),n.add("fragmentMain"),n.add("writeOutput");else{for(const t of ze)n.add(t);n.add("writeOutput")}if(e!=="glsl")for(const t of["2D","Cube","3D"])for(const a of["","Level","Grad"])n.add(`sample${t}${a}`);else for(const t of["2D","Cube","3D"])n.add(`ShaderStudioChannel${t}`);for(const t of Ge(e))n.add(t);return n}K("glsl"),K("slang"),K("wgsl");function Be(e){const{resource:n,slot:t}=e;return{texture:`_ssTexture${t}`,sampler:`_ssSampler${t}`,channelName:n.name}}const je=["vec","dvec","ivec","uvec","bvec"].flatMap(e=>[2,3,4].map(n=>`${e}${n}`)),ke=["mat","dmat"].flatMap(e=>[...[2,3,4].map(n=>`${e}${n}`),...[2,3,4].flatMap(n=>[2,3,4].map(t=>`${e}${n}x${t}`))]),oe=["1D","2D","3D","Cube","2DRect","1DArray","2DArray","CubeArray","Buffer","2DMS","2DMSArray"],Xe=["","i","u"].flatMap(e=>oe.map(n=>`${e}sampler${n}`)),Ye=["sampler1DShadow","sampler2DShadow","samplerCubeShadow","sampler2DRectShadow","sampler1DArrayShadow","sampler2DArrayShadow","samplerCubeArrayShadow"],He=["","i","u"].flatMap(e=>oe.map(n=>`${e}image${n}`)),Ke=Object.freeze(["void","bool","int","uint","float","double",...je,...ke]),Ze=Object.freeze([...Ke,"atomic_uint",...Xe,...Ye,...He]),qe=Object.freeze(["void","bool","bool2","bool3","bool4","half","half2","half3","half4","float","float2","float3","float4","double","double2","double3","double4","int","int2","int3","int4","uint","uint2","uint3","uint4","float16_t","float32_t","float64_t","int8_t","uint8_t","int16_t","uint16_t","int32_t","uint32_t","int64_t","uint64_t"]),Je=Object.freeze([...qe,"vector","matrix","Texture1D","Texture2D","Texture3D","TextureCube","Texture1DArray","Texture2DArray","Texture3DArray","TextureCubeArray","RWTexture1D","RWTexture2D","RWTexture3D","RWTexture1DArray","RWTexture2DArray","RWTexture3DArray","SamplerState","SamplerComparisonState","Buffer","RWBuffer","StructuredBuffer","RWStructuredBuffer","ByteAddressBuffer","RWByteAddressBuffer","ParameterBlock","ConstantBuffer","RaytracingAccelerationStructure"]);new Set(Ze),new Set(Je);const Qe=1024;function ie(e){if(["float","int","uint","bool","vec2","vec3","vec4"].includes(e))return{base:e};const n=/^(float|int|uint)\[([1-9]\d*)\]$/.exec(e);return!n||Number(n[2])>Qe?null:{base:n[1],length:Number(n[2])}}function G(e){const n=e==="texture-cube"?"Cube":e==="texture-3d"?"3D":"2D",t=e==="texture-2d"?2:3,a=e==="texture-cube"?"dir":"uv",o=`float${t}`,i=e==="texture-2d"?"float2(uv.x, 1.0 - uv.y)":a,r=s=>e==="texture-2d"?`float2(${s}.x, -${s}.y)`:s;return{shape:n,textureType:`Texture${n}<float4>`,sizeType:e==="texture-3d"?"uint3":"uint2",methods:[{name:"Sample",parameters:`${o} ${a}`,arguments:a,nativeArguments:i,requiresFragment:!0},{name:"SampleLevel",parameters:`${o} ${a}, float lod`,arguments:`${a}, lod`,nativeArguments:`${i}, lod`,requiresFragment:!1},{name:"SampleGrad",parameters:`${o} ${a}, ${o} dx, ${o} dy`,arguments:`${a}, dx, dy`,nativeArguments:`${i}, ${r("dx")}, ${r("dy")}`,requiresFragment:!1}]}}function et(e,n){return`sample${G(e).shape}${n==="Sample"?"":n.slice(6)}`}function tt(e,n,t=!0){const a=[...new Set(e)].map(i=>{const r=G(i);return r.methods.filter(s=>n==="slang").map(s=>{const l=et(i,s.name);return`${s.requiresFragment?`[require(wgsl, fragment)]
`:""}float4 ${l}(${r.textureType} texture, SamplerState sampling, ${s.parameters})
{
    return texture.${s.name}(sampling, ${s.nativeArguments});
}`}).join(`
`)}).join(`
`);return e.includes("texture-2d")?`${a}
float4 load2D(Texture2D<float4> texture, int2 pixel)
{
    uint width, height;
    texture.GetDimensions(width, height);
    return texture.Load(int3(pixel.x, int(height) - 1 - pixel.y, 0));
}`:a}function nt(e,n={}){var y;const t=[...e].sort((p,x)=>p.slot-x.slot),a=[...new Set(t.map(({kind:p})=>p))],o=p=>G(p).shape,i=a.map(p=>{const x=G(p),b=x.methods.map(({name:$,parameters:D,arguments:E,nativeArguments:R,requiresFragment:M})=>`
${M?`    [require(wgsl, fragment)]
`:""}    float4 ${$}(SamplerState sampling, ${D})
    {
        return texture.${$}(sampling, ${R});
    }
${M?`    [require(wgsl, fragment)]
`:""}    float4 ${$}(${D})
    {
        return ${$}(sampler, ${E});
    }`).join(`
`),P=p==="texture-2d"?`
    float4 Load(int2 pixel)
    {
        return load2D(texture, pixel);
    }`:"";return`struct ShaderStudioChannel${x.shape}
{
    ${x.textureType} texture;
    SamplerState sampler;
    ${x.sizeType} size;
    float time;
    bool loaded;
${b}
${P}
};`}).join(`

`),r=new Map,s=new Map,l=new Map,f=new Map((y=n.bindings)==null?void 0:y.map(p=>[p.slot,p])),c=t.map(({name:p,slot:x,kind:b},P)=>{const $=Be({resource:{name:p,kind:b},slot:x}),D=f.get(x),E=(D==null?void 0:D.textureBinding)??1+P*2,R=(D==null?void 0:D.samplerBinding)??2+P*2,M=B=>n.runtime?`[[vk::binding(${B}, 0)]]
`:"",W=[];return r.has(E)||(r.set(E,$.texture),W.push(`${M(E)}Texture${o(b)}<float4> ${$.texture};`)),s.has(R)||(s.set(R,$.sampler),W.push(`${M(R)}SamplerState ${$.sampler};`)),l.set(x,{texture:r.get(E),sampler:s.get(R)}),W.join(`
`)}).join(`
`),u=n.channelCount??Math.max(4,...t.map(({slot:p})=>p+1)),m=n.runtime?"":`float3 _ssChannelResolution[${u}];
float _ssChannelTime[${u}];
float _ssChannelLoaded[${u}];`,S=n.runtime?"_st.channelResolution":"_ssChannelResolution",d=n.runtime?"_st.channelTime":"_ssChannelTime",g=n.runtime?"_st.channelLoaded":"_ssChannelLoaded",_=t.map(({name:p,slot:x,kind:b})=>{const{texture:P,sampler:$}=l.get(x),D=b==="texture-3d"?`uint3(${S}[${x}])`:`uint2(${S}[${x}].xy)`;return`property ShaderStudioChannel${o(b)} ${p}
    {
        get
        {
            ShaderStudioChannel${o(b)} result;
            result.texture = ${P};
            result.sampler = ${$};
            result.size = ${D};
            result.time = ${d}[${x}];
            result.loaded = ${g}[${x}] != 0.0;
            return result;
        }
    }`}).join(`
`);return`${tt(a,"slang")}
${i}
${c}
${m}
${_}
`}const at={int:"int",uint:"uint",float:"float",vec2:"float2",vec3:"float3",vec4:"float4",bool:"int"};function rt(e){return ie(e)!==null}function ot(e=[],n={worldPosition:"_shaderStudioWorldPosition",normal:"_shaderStudioNormal",cameraPosition:"_shaderStudioCameraPosition",uv:"_shaderStudioVertexUv",frontFacing:"_shaderStudioFrontFacing"},t=4){const a=e.flatMap(({name:r,type:s})=>{const l=ie(s);return l?[`    ${at[l.base]} custom_${r}${l.length?`[${l.length}]`:""};`]:[]}).join(`
`),o=e.flatMap(({name:r,type:s})=>rt(s)?[s==="bool"?`#define ${r} (${h}.custom_${r} != 0)`:`#define ${r} (${h}.custom_${r})`]:[]).join(`
`),i=[{symbol:T.worldPosition,contextName:n.worldPosition},{symbol:T.normal,contextName:n.normal},{symbol:T.cameraPosition,contextName:n.cameraPosition},{symbol:T.vertexUv,contextName:n.uv},{symbol:T.frontFacing,contextName:n.frontFacing}].map(({symbol:r,contextName:s})=>`static ${r.slangType} ${s};`).join(`
`);return`// ---- shader-studio Slang prelude (generated) ----
${re}
struct ShaderToyUniforms
{
    float4 resolution;
    float4 mouse;
    float time;
    float timeDelta;
    float frameRate;
    int frame;
    float channelTime[${t}];
    float channelLoaded[${t}];
    float sampleRate;
    float4 date;
    float3 channelResolution[${t}];
    float4 cameraPos;
    float4 cameraDir;
    uint4 vertexCount;
    column_major float4x4 viewMatrix;
    column_major float4x4 projectionMatrix;
    column_major float4x4 viewProjection;
    ShaderStudioPointer pointer;
    int4 vrState;
    float4 vrViewport;
    column_major float4x4 vrRayTransform;
${H.map(({field:r})=>`    float4 ${r}[2];`).join(`
`)}
${a}
};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> ${h};

${We.join(`
`)}
${o}
${i}
// Set by the vertex entry from SV_InstanceID and passed flat to the fragment entry.
static uint iInstanceIndex;
`}const it=Object.values({glsl:{id:"glsl",extensions:Ve,engine:"webgl",monacoId:"glsl",hasLanguageService:!0,hasDebugger:!0,hasDebugPlan:!1,hasImports:!1,label:"GLSL"},slang:{id:"slang",extensions:Ie,engine:"webgpu",monacoId:"slang",hasLanguageService:!0,hasDebugger:!0,hasDebugPlan:!0,hasImports:!0,label:"Slang"},wgsl:{id:"wgsl",extensions:Me,engine:"webgpu",monacoId:"wgsl",hasLanguageService:!0,hasDebugger:!0,hasDebugPlan:!0,hasImports:!1,label:"WGSL"}}).flatMap(e=>e.extensions).sort((e,n)=>n.length-e.length);new RegExp(`\\.(${it.join("|")})$`,"i");function st(e){const n=[];let t=0,a=!0;for(;t<e.length;){const o=e[t],i=e[t+1];if(/\s/.test(o)){(o===`
`||o==="\r")&&(a=!0),t++;continue}if(o==="/"&&i==="/"){for(;t<e.length&&e[t]!==`
`;)t++;continue}if(o==="/"&&i==="*"){const r=e.indexOf("*/",t+2),s=e.slice(t,r<0?e.length:r+2);/[\r\n]/.test(s)&&(a=!0),t=r<0?e.length:r+2;continue}if(o==='"'||o==="'"){const r=o;for(t++;t<e.length&&e[t]!==r;)e[t]==="\\"&&t++,t++;t++,a=!1;continue}if(/[A-Za-z_]/.test(o)){const r=t++;for(;t<e.length&&/[A-Za-z0-9_]/.test(e[t]);)t++;n.push({value:e.slice(r,t),lineStart:a,offset:r})}else n.push({value:o,lineStart:a,offset:t}),t++;a=!1}return n}function O(e){return!!(e&&/^[A-Za-z_]\w*$/.test(e.value))}function lt(e){const n=new Set,t=ut(e);for(const r of t.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)/gm))n.add({value:r[1],offset:r.index+r[0].lastIndexOf(r[1]),lineStart:!0});const a=[];let o=0,i=0;for(const r of st(e)){if(o===0&&r.value==="#"&&r.lineStart){a.length=0,a.push(r);continue}o===0&&a.push(r),r.value==="("&&i++,r.value===")"&&(i=Math.max(0,i-1)),r.value==="{"?(o===0&&se(a,n),o++,a.length=0):r.value==="}"?(o=Math.max(0,o-1),a.length=0):r.value===";"&&o===0&&i===0&&(se(a,n),a.length=0)}return[...new Map([...n].map(r=>[r.offset,{name:r.value,offset:r.offset}])).values()]}function ut(e){const n=[...e];let t=0;for(;t<e.length;){let a=t;if(e.startsWith("//",t)){const o=e.indexOf(`
`,t+2);a=o===-1?e.length:o}else if(e.startsWith("/*",t)){const o=e.indexOf("*/",t+2);if(o===-1)break;a=o+2}if(a>t){for(;t<a;t++)e[t]!=="\r"&&e[t]!==`
`&&(n[t]=" ");continue}t++}return n.join("")}function se(e,n){var l,f,c,u,m,S;const t=e.filter(({value:d})=>d!=="{");for(;((l=t[0])==null?void 0:l.value)==="[";){let d=0,g=0;do((f=t[g])==null?void 0:f.value)==="["&&d++,((c=t[g])==null?void 0:c.value)==="]"&&d--,g++;while(g<t.length&&d>0);t.splice(0,g)}if(t.length===0)return;if(((u=t[0])==null?void 0:u.value)==="#"&&((m=t[1])==null?void 0:m.value)==="define"&&O(t[2])){n.add(t[2]);return}const a=t.findIndex(({value:d})=>!["public","private","internal","static","extern","const","uniform"].includes(d)),o=t[a];if(!o||["import","module","namespace","using"].includes(o.value))return;if(["struct","class","interface","enum"].includes(o.value)&&O(t[a+1])){n.add(t[a+1]);return}if(o.value==="typedef"){const d=[...t].reverse().find(O);d&&n.add(d);return}if(o.value==="typealias"&&O(t[a+1])){n.add(t[a+1]);return}if(o.value==="property"){const d=[...t].reverse().find(O);d&&n.add(d);return}const i=t.findIndex(({value:d},g)=>g>a&&["=",";","[",",","("].includes(d)),r=t[i-1];if(i<=a+1||!O(r)||(n.add(r),((S=t[i])==null?void 0:S.value)==="("))return;let s=0;for(let d=i;d<t.length-1;d++){const g=t[d].value;["(","[","{"].includes(g)&&s++,[")","]","}"].includes(g)&&s--,g===","&&s===0&&O(t[d+1])&&n.add(t[d+1])}}function I(e){let n=1;const t=[],a=[],o=new Map,i=new Map;return{channels:[...e].sort((s,l)=>s.slot-l.slot).map(s=>{const l=JSON.stringify([s.kind==="cubemap"||s.outputKind==="cubemap"?"cube":s.kind==="volume"?"3d":"2d",s.sampleType??"float",s.textureIdentity??{slot:s.slot}]),f=JSON.stringify([s.samplerType??"filtering",s.samplerIdentity??`slot:${s.slot}`]);let c=o.get(l);c===void 0&&(c=n++,o.set(l,c),t.push({binding:c,slot:s.slot,kind:s.outputKind==="cubemap"?"buffer-cubemap":s.kind,sampleType:s.sampleType}));let u=i.get(f);return u===void 0&&(u=n++,i.set(f,u),a.push({binding:u,slot:s.slot,samplerType:s.samplerType})),{...s,textureBinding:c,samplerBinding:u}}),textures:t,samplers:a,nextBinding:n}}function Z(e){let n="",t=0;for(;t<e.length;){if(e.startsWith("//",t)){const a=e.indexOf(`
`,t+2);if(a===-1)break;n+=`
`,t=a+1;continue}if(e.startsWith("/*",t)){const a=e.indexOf("*/",t+2);if(a===-1){n+=e.slice(t);break}const o=a+2;for(;t<o;t++)e[t]===`
`&&(n+=`
`);continue}n+=e[t],t++}return n}const le="_ss_vrImage";function ct(e){return/\bmainVR\s*\([^)]*\)\s*(?:->[^{;]*)?\{/.test(Z(e))}function ft(e,n){var t,a;return e.passName==="Image"&&e.passKind!=="compute"&&(e.geometry===void 0||e.geometry==="fullscreen")&&e.outputKind!=="cubemap"&&e.captureMode!==!0&&!((t=e.renderEntryPoints)!=null&&t.vertex)&&!((a=e.renderEntryPoints)!=null&&a.fragment)&&ct(n)}function ue(e,n){return e?`${le}(${n})`:`mainImage(${n})`}const ce=`float4 ${le}(float2 coord)
{
    if (_st.vrState.y != 0)
    {
        float2 local = coord - _st.vrViewport.xy;
        float2 ndc = 2.0 * local / _st.resolution.xy - 1.0;
        float3 ray = normalize(mul(_st.vrRayTransform, float4(ndc, 1.0, 0.0)).xyz);
        return mainVR(local, mul(_st.vrRayTransform, float4(0.0, 0.0, 0.0, 1.0)).xyz, ray);
    }
    if (_st.vrState.x == 0)
    {
        return mainImage(coord);
    }
    float2 screen = (2.0 * coord - _st.resolution.xy) / max(_st.resolution.y, 1.0);
    float3 cameraDir = _st.cameraDir.xyz;
    float3 forward = length(cameraDir) > 0.0 ? normalize(cameraDir) : float3(0.0, 0.0, -1.0);
    float3 referenceUp = abs(forward.y) > 0.999 ? float3(0.0, 0.0, 1.0) : float3(0.0, 1.0, 0.0);
    float3 right = normalize(cross(forward, referenceUp));
    float3 up = cross(right, forward);
    return mainVR(coord, _st.cameraPos.xyz, normalize(forward + screen.x * right + screen.y * up));
}
`,w={uv:T.vertexUv.name,worldPosition:T.worldPosition.name,normal:T.normal.name,cameraPosition:T.cameraPosition.name,frontFacing:T.frontFacing.name},q="iInstanceIndex";T.vertexUv.glslType,T.worldPosition.glslType,T.normal.glslType,T.cameraPosition.glslType,T.frontFacing.glslType;function fe(e){return e!==void 0&&e!=="fullscreen"&&e!=="vertices"}const C="vertexMain",V="fragmentMain";function de(e,n){const t=new Set((e==null?void 0:e.map(({key:o})=>o))??[]);if(t.size===0)return[];const a=new Set;for(const{label:o,source:i}of n)for(const{name:r}of lt(i))t.has(r)&&a.add(`Slang channel "${r}" conflicts with an authored declaration in ${o}. Rename the channel or declaration.`);return[...a]}function me(e=[]){return Math.max(4,...e.map(({slot:n})=>n+1))}function ge(e){const n=Math.max(4,e),t=48,a=t+n*16,o=a+n*16,i=o+16,r=i+16,s=r+n*16,l=s+16,f=l+16,c=f+16,u=c+64,m=u+64,S=m+64,d=S+48,g=d+16,_=g+16,y=_+64;return{channelCount:n,size:y+H.length*32,offsets:{iResolution:0,iMouse:16,iTime:32,iTimeDelta:36,iFrameRate:40,iFrame:44,iChannelTime:t,iChannelLoaded:a,iSampleRate:o,iDate:i,iChannelResolution:r,iCameraPos:s,iCameraDir:l,iVertexCount:f,iViewMatrix:c,iProjectionMatrix:u,iViewProjection:m,iPointer:S,iVrState:d,iVrViewport:g,iVrRayTransform:_,iVrControllers:y}}}ge(4).size,ge(4).offsets;function pe(e,n=[]){return ot(n,w,e)}function J(e){return`struct MeshUniforms
{
    column_major float4x4 model;
    column_major float4x4 viewProjection;
    column_major float4x4 normalMatrix;
    float4 cameraPosition;
};

[[vk::binding(${e}, 0)]]
ConstantBuffer<MeshUniforms> _mesh;

#define iModelMatrix _mesh.model
#define iViewProjectionMatrix _mesh.viewProjection
#define iNormalMatrix _mesh.normalMatrix
`}function dt(e,n){return`${e.trim()||(n?"":"void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}")}
struct MixedMeshVertexOut { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; };
[shader("vertex")] MixedMeshVertexOut ${C}([[vk::location(0)]] float3 position : POSITION, [[vk::location(1)]] float3 normal : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0, uint vertexID : SV_VertexID) { mainVertex(vertexID, position, normal, uv); MixedMeshVertexOut output; float4 world = mul(_mesh.model, float4(position, 1)); output.position = mul(_mesh.viewProjection, world); output.uv = uv; output.worldPosition = world.xyz; output.normal = mul(_mesh.normalMatrix, float4(normal, 0)).xyz; return output; }
`}function mt(){return`[shader("fragment")] float4 ${V}(float2 uv : TEXCOORD0, float3 worldPosition : TEXCOORD1, float3 normal : TEXCOORD2) : SV_Target { iWorldPosition = worldPosition; iNormal = normal; iCameraPosition = _mesh.cameraPosition.xyz; return mainImage(uv * iResolution.xy); }
`}function gt(e,n){return`${e.trim()||(n?"":"void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}")}
[shader("vertex")] float4 ${C}(uint id : SV_VertexID) : SV_Position { float2 p[3] = {float2(-1,-1),float2(3,-1),float2(-1,3)}; float3 position = float3(p[id],0); float3 normal = float3(0,0,1); float2 uv = p[id] * .5 + .5; mainVertex(id,position,normal,uv); return float4(position,1); }
`}function pt(){return`[shader("fragment")] float4 ${V}(float4 p : SV_Position) : SV_Target { return mainImage(float2(p.x, iResolution.y - p.y)); }
`}const z="struct ShaderStudioVertexUvOut { float4 position : SV_Position; float2 uv : TEXCOORD0; };",ht="struct ShaderStudioVertexUvOut { float4 position : SV_Position; float2 uv : TEXCOORD0; nointerpolation uint instanceIndex : TEXCOORD1; };",Q="uint instanceID : SV_InstanceID",ee=`${q} = instanceID;`;function he(e,n=!1){const t=e?", bool frontFacing : SV_IsFrontFace":"",a=e?"frontFacing":"true",o=e?` ${q} = input.instanceIndex;`:"";return`[shader("fragment")]
float4 ${V}(ShaderStudioVertexUvOut input${t}) : SV_Target { ${w.uv} = input.uv; ${w.frontFacing} = ${a};${o} return ${ue(n,"float2(input.position.x, _st.resolution.y - input.position.y)")}; }
${n?ce:""}`}const xe=`[shader("fragment")]
float4 ${V}(MeshVertexOut input, bool frontFacing : SV_IsFrontFace) : SV_Target {
    ${w.uv} = input.uv;
    ${w.worldPosition} = input.worldPosition;
    ${w.normal} = input.normal;
    ${w.cameraPosition} = _mesh.cameraPosition.xyz;
    ${w.frontFacing} = frontFacing;
    ${q} = input.instanceIndex;
    float4 color = mainImage(input.uv * _st.resolution.xy);
    return color;
}
`,Se="struct MeshVertexOut { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; nointerpolation uint instanceIndex : TEXCOORD3; };";function xt(e){return`${e}
${Se}
[shader("vertex")]
MeshVertexOut ${C}([[vk::location(0)]] float3 position : POSITION, [[vk::location(1)]] float3 normal : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0, uint vertexID : SV_VertexID, ${Q}) { ${ee} mainVertex(vertexID, position, normal, uv); MeshVertexOut output; output.instanceIndex = instanceID; float4 worldPosition = mul(_mesh.model, float4(position, 1)); output.position = mul(_mesh.viewProjection, worldPosition); output.uv = uv; output.worldPosition = worldPosition.xyz; output.normal = mul(_mesh.normalMatrix, float4(normal, 0)).xyz; return output; }
${xe}`}function St(e,n,t){return!e.trim()&&!n?vt(t):`${e}
${z}
[shader("vertex")]
ShaderStudioVertexUvOut ${C}(uint vertexID : SV_VertexID) { float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) }; float3 position = float3(verts[vertexID], 0); float3 normal = float3(0, 0, 1); float2 uv = verts[vertexID] * 0.5 + 0.5; mainVertex(vertexID, position, normal, uv); ShaderStudioVertexUvOut output; output.position = float4(position, 1); output.uv = uv; return output; }
${he(!1,t)}
`}const ye="void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}",ve="float3 position = float3(0, 0, 0); float3 normal = float3(0, 0, 1); float2 uv = float2(0, 0);";function yt(e,n,t=!1){const a=e.trim()?e:t?"":ye;return n==="clip"?`${a}
${ht}
[shader("vertex")]
ShaderStudioVertexUvOut ${C}(uint vertexID : SV_VertexID, ${Q}) { ${ee} ${ve} mainVertex(vertexID, position, normal, uv); ShaderStudioVertexUvOut output; output.position = float4(position, 1); output.uv = uv; output.instanceIndex = instanceID; return output; }
${he(!0)}
`:`${a}
${Se}
[shader("vertex")]
MeshVertexOut ${C}(uint vertexID : SV_VertexID, ${Q}) { ${ee} ${ve} mainVertex(vertexID, position, normal, uv); MeshVertexOut output; output.instanceIndex = instanceID; float4 worldPosition = mul(_mesh.model, float4(position, 1)); output.position = mul(_mesh.viewProjection, worldPosition); output.uv = uv; output.worldPosition = worldPosition.xyz; output.normal = mul(_mesh.normalMatrix, float4(normal, 0)).xyz; return output; }
${xe}`}const vt=e=>`${z}
// ---- shader-studio Slang entry points (generated) ----
[shader("vertex")]
ShaderStudioVertexUvOut ${C}(uint vertexID : SV_VertexID)
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    ShaderStudioVertexUvOut output;
    output.position = float4(verts[vertexID], 0, 1);
    output.uv = verts[vertexID] * 0.5 + 0.5;
    return output;
}

[shader("fragment")]
float4 ${V}(ShaderStudioVertexUvOut input) : SV_Target
{
    ${w.uv} = input.uv;
    ${w.frontFacing} = true;
    // Flip Y so fragCoord origin is bottom-left, matching ShaderToy.
    float2 coord = float2(input.position.x, _st.resolution.y - input.position.y);
    return ${ue(e,"coord")};
}
${e?ce:""}
`;function Tt(e){return`${z}
struct CubemapFaceUniforms { uint4 data; };
[[vk::binding(${e}, 0)]] ConstantBuffer<CubemapFaceUniforms> _cubeFace;
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
ShaderStudioVertexUvOut ${C}(uint vertexID : SV_VertexID)
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    ShaderStudioVertexUvOut output;
    output.position = float4(verts[vertexID], 0, 1);
    output.uv = verts[vertexID] * 0.5 + 0.5;
    return output;
}
[shader("fragment")]
float4 ${V}(ShaderStudioVertexUvOut input) : SV_Target
{
    ${w.uv} = input.uv;
    ${w.frontFacing} = true;
    float2 coord = input.position.xy;
    return mainCubemap(coord, float3(0.0), cubemapDirection(coord));
}
`}function Te(e){return`// ---- shader-studio Slang capture prelude (generated) ----
struct DbgCaptureUniforms
{
    float4 coordGrid;
    int varIndex;
    int isPixelMode;
    int2 _dbgPad;
};

[[vk::binding(${e}, 0)]]
ConstantBuffer<DbgCaptureUniforms> _dbgCapU;

#define _dbgVarIndex (_dbgCapU.varIndex)
`}const $t=`${z}
// ---- shader-studio Slang capture entry points (generated) ----
[shader("vertex")]
ShaderStudioVertexUvOut ${C}(uint vertexID : SV_VertexID)
{
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    ShaderStudioVertexUvOut output;
    output.position = float4(verts[vertexID], 0, 1);
    output.uv = verts[vertexID] * 0.5 + 0.5;
    return output;
}

[shader("fragment")]
float4 ${V}(ShaderStudioVertexUvOut input) : SV_Target
{
    ${w.uv} = input.uv;
    ${w.frontFacing} = true;
    float2 fragCoord = input.position.xy;
    float2 coord = _dbgCapU.isPixelMode != 0
        ? _dbgCapU.coordGrid.xy
        : fragCoord / _dbgCapU.coordGrid.zw * _st.resolution.xy;
    return mainImage(coord);
}
`;function $e(e=[]){return nt(e.map(({key:n,slot:t,kind:a,outputKind:o})=>({name:n,slot:t,kind:a==="cubemap"||o==="cubemap"?"texture-cube":a==="volume"?"texture-3d":"texture-2d"})),{runtime:!0,bindings:I(e).channels})}function we(e,n,t,a=1+n*2){const o=t==="compute"?"RWStructuredBuffer":"StructuredBuffer",i=l=>t==="compute"?l:l==="Atomic<uint>"?"uint":l==="Atomic<int>"?"int":l,r=new Set,s=l=>{var c;if(l.streamMaxPerFrame)return`struct _ScriptStream_${l.name} { uint length; uint data[${l.streamMaxPerFrame}]; };
[[vk::binding(${a+l.binding}, 0)]]
StructuredBuffer<_ScriptStream_${l.name}> _scriptStream_${l.name};
#define ${l.name} (_scriptStream_${l.name}[0])
`;const f=r.has(l.elementType)?"":((c=l.structDeclarations)==null?void 0:c.slang)??"";return f&&r.add(l.elementType),`${f}[[vk::binding(${a+l.binding}, 0)]]
${o}<${i(l.elementType)}> ${l.name};
`};return{beforeCommon:e.filter(l=>l.builtin).map(s).join(""),afterCommon:e.filter(l=>!l.builtin).map(s).join("")}}function wt(e,n={}){var c,u,m,S,d,g,_;((c=n.vertexCode)==null?void 0:c.trim())===e.trim()&&(n={...n,vertexCode:void 0});const t=pe(me(n.channels),n.customUniforms),a=(n.commonCode??"").trim(),o=a?`${a}
`:"",i=$e(n.channels),r=we(n.storage??[],((u=n.channels)==null?void 0:u.length)??0,n.passKind??"render",I(n.channels??[]).nextBinding);if(n.renderEntryPoints&&(n.renderEntryPoints.vertex||n.renderEntryPoints.fragment)){const y=fe(n.geometry),p=I(n.channels??[]).nextBinding+(((m=n.storage)==null?void 0:m.length)??0),x=y?J(p):"",b=n.captureMode?Te(p+(y?1:0)):"",P=((S=n.vertexCode)==null?void 0:S.trim())??"",$=k(`${o}
${e}`).some(R=>R.name==="mainVertex"),D=n.renderEntryPoints.vertex?"":y?dt(P,$):gt(P,$),E=n.renderEntryPoints.fragment?"":y?mt():pt();return`${t}
${i}
${r.beforeCommon}${o}${r.afterCommon}${x}${b}#line 1
${e}
${D}${E}`}if(n.captureMode){const y=I(n.channels??[]).nextBinding+(((d=n.storage)==null?void 0:d.length)??0),p=Te(y);return`${t}
${i}
${r.beforeCommon}${o}${r.afterCommon}${p}
#line 1
${e}
${$t}`}if(n.outputKind==="cubemap"){const y=I(n.channels??[]).nextBinding+(((g=n.storage)==null?void 0:g.length)??0);return`${t}
${i}
${r.beforeCommon}${o}${r.afterCommon}#line 1
${e}
${Tt(y)}`}const s=I(n.channels??[]).nextBinding+(((_=n.storage)==null?void 0:_.length)??0),{meshPrelude:l,entryPoints:f}=_t(n,s,`${o}
${e}`);return`${t}
${i}
${r.beforeCommon}${o}${r.afterCommon}${l}#line 1
${e}
${f}`}function _t(e,n,t){var i;const a=((i=e.vertexCode)==null?void 0:i.trim())??"",o=k(t).some(r=>r.name==="mainVertex");if(fe(e.geometry))return{meshPrelude:J(n),entryPoints:xt(a||(o?"":ye))};if(e.geometry==="vertices"){const r=e.vertexSpace??be;return{meshPrelude:r==="world"?J(n):"",entryPoints:yt(a,r,o)}}return{meshPrelude:"",entryPoints:St(a,o,ft(e,t))}}function Dt(e,n,t="rgba16f",a){if(n>1){const o=a==="cubemap",i=o?"pixel":"coord",r=o?"face":"layer",s=o?`${i}.y`:`h - 1 - ${i}.y`;return`// ---- shader-studio Slang compute output (generated) ----
[[vk::binding(${e}, 0)]]
[[vk::image_format("${t}")]]
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
[[vk::binding(${e}, 0)]]
[[vk::image_format("${t}")]]
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
`}function bt(e){return`struct DispatchUniforms
{
    int4 dispatch;
};

[[vk::binding(${e}, 0)]]
ConstantBuffer<DispatchUniforms> _dsp;

#define iDispatch (_dsp.dispatch.x)
`}function Ct(e){const n=Z(e),t=[],a=/\[\s*shader\s*\(\s*["']compute["']\s*\)\s*\]\s*\[\s*numthreads\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\]\s*void\s+([A-Za-z_]\w*)\s*\(/gi;for(const o of n.matchAll(a)){const i=o.slice(1,4).map(Number);i.every(r=>Number.isInteger(r)&&r>0)&&t.push({name:o[4],workgroupSize:[i[0],i[1],i[2]]})}return t}function Pt(e,n,t=""){return Re(e,"slang",n,[t])}function Et(e,n){const t=pe(me(n.channels),n.customUniforms),a=n.channels??[],o=n.storage??[],i=(n.commonCode??"").trim(),r=i?`${i}
`:"",s=$e(a),l=we(o,a.length,"compute",I(a).nextBinding),f=I(a).nextBinding+o.length,c=n.hasOutput?Dt(f,n.outputLayers,n.outputImageFormat??"rgba16f",n.outputKind):"",u=f+(n.hasOutput?1:0),m=bt(u);return`${t}
${s}
${l.beforeCommon}${r}${l.afterCommon}${c}${m}#line 1
${e}`}const _e=new WeakMap;class Rt{constructor(n){this.slang=n,this.globalSession=null,this.wgslTargetValue=null}compileImagePass(n,t={}){var m,S,d;const a=de(t.channels,[{label:t.sourcePath??"shader source",source:n},...t.commonCode?[{label:"Common",source:t.commonCode}]:[],...t.vertexCode?[{label:"vertex source",source:t.vertexCode}]:[]]);if(a.length>0)return{success:!1,errors:a};let o,i;try{({globalSession:o,target:i}=this.ensureGlobalSession())}catch(g){return{success:!1,errors:[Mt(g)]}}const r=o.createSession(i);if(!r)return{success:!1,errors:[this.lastError("Slang: failed to create session")]};const s=[];let l=null,f=[],c=null,u=null;try{for(const v of t.modules??[]){const F=r.loadModuleFromSource(v.source,v.moduleName,v.path);if(!F)return{success:!1,errors:[this.lastError(`Slang: failed to compile imported module ${v.moduleName} (${v.path})`)]};s.push(F)}const g=Vt(n,s.length>0),_=t.passKind==="compute",y=_?Ct(g):[],p=t.entryPoint?(m=y.find(({name:v})=>v===t.entryPoint))==null?void 0:m.name:y.length===1?y[0].name:void 0;if(_&&!p)return{success:!1,errors:['Slang: compute source must declare a native `[shader("compute")]` entry point']};const x=At(_,p,t),b=x?Pt(g,x,t.commonCode):g,P=_?Et(b,{passName:t.passName,commonCode:t.commonCode,channels:t.channels,storage:t.storage,workgroupSize:t.workgroupSize??[8,8,1],outputLayers:t.outputLayers??1,outputKind:t.outputKind,hasOutput:t.hasOutput===!0,customUniforms:t.customUniforms,outputImageFormat:t.outputImageFormat??"rgba16f"}):wt(b,{passName:t.passName,commonCode:t.commonCode,channels:t.channels,storage:t.storage,passKind:t.passKind??"render",geometry:t.geometry,vertexCode:t.vertexCode,vertexSpace:t.vertexSpace,captureMode:t.captureMode,outputKind:t.outputKind,renderEntryPoints:t.renderEntryPoints,customUniforms:t.customUniforms}),E=((S=Z(g).match(/^\s*module\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/m))==null?void 0:S[1])??(t.passName??"image").toLowerCase(),R=t.sourcePath??`/${E}.slang`;if(l=r.loadModuleFromSource(P,E,R),!l){const v=this.lastError("Slang: failed to compile module"),F=/ambiguous|redefinition|already defined|conflicting/i.test(v)?de((d=t.channels)==null?void 0:d.filter(({key:ae})=>v.includes(ae)),(t.modules??[]).map(({path:ae,source:Ft})=>({label:ae,source:Ft}))):[];return F.length>0?{success:!1,errors:F}:{success:!1,errors:[Ot(v)?"Missing mainImage function":v]}}const M=l;if(f=(_?[p]:t.renderEntryPoints?[t.renderEntryPoints.vertex??C,t.renderEntryPoints.fragment??V]:[C,V]).map(v=>M.findEntryPointByName(v)),f.some(v=>!v))return{success:!1,errors:[_?"Slang: configured native compute entry point was not found":t.renderEntryPoints?"Slang: configured native render entry point was not found":"Slang: entry points not found (is `mainImage` defined?)"]};if(c=r.createCompositeComponentType([...s,M,...f]),!c)return{success:!1,errors:[this.lastError("Slang: failed to compose program")]};if(u=c.link(),!u)return{success:!1,errors:[this.lastError("Slang: failed to link program")]};const B=u.getTargetCode(0);return B?{success:!0,wgsl:B}:{success:!1,errors:[this.lastError("Slang: produced empty WGSL")]}}finally{N(u),N(c);for(const g of f)N(g);N(l);for(const g of s)N(g);N(r)}}dispose(){this.globalSession=null,this.wgslTargetValue=null}ensureGlobalSession(){if(this.globalSession&&this.wgslTargetValue!==null)return{globalSession:this.globalSession,target:this.wgslTargetValue};const n=_e.get(this.slang);if(n)return this.globalSession=n.globalSession,this.wgslTargetValue=n.target,n;const t=this.slang.createGlobalSession();if(!t)throw new Error("Slang: createGlobalSession returned null");const a=De(this.slang.getCompileTargets()),o=a.find(i=>/wgsl/i.test(i.name));if(!o)throw new Error(`Slang: no WGSL compile target (available: ${a.map(i=>i.name).join(", ")||"none"})`);return this.globalSession=t,this.wgslTargetValue=o.value,_e.set(this.slang,{globalSession:t,target:o.value}),{globalSession:t,target:o.value}}lastError(n){var a,o,i,r;const t=(r=(i=(o=(a=this.slang).getLastError)==null?void 0:o.call(a))==null?void 0:i.message)==null?void 0:r.trim();return t&&t.length>0?t:n}}function Vt(e,n){return n?e:e.split(`
`).map(t=>It(t)?"":t).join(`
`)}function It(e){let n=e.trim();return!n.startsWith("import")||n[6]!==" "&&n[6]!=="	"?!1:(n=n.slice(7).trim(),n.endsWith(";")&&(n=n.slice(0,-1).trimEnd()),n.startsWith('"')?n.length>2&&n.endsWith('"')&&!n.slice(1,-1).includes('"'):n.split(".").every(t=>/^[A-Za-z_]\w*$/.test(t)))}function Mt(e){return e instanceof Error?e.message:String(e)}function Ot(e){return/undefined identifier[\s\S]*['"]mainImage['"]/i.test(e)}function N(e){var n;(n=e==null?void 0:e.delete)==null||n.call(e)}function At(e,n,t){if(e)return[n];if(t.renderEntryPoints)return[t.renderEntryPoints.vertex??"mainVertex",t.renderEntryPoints.fragment??"mainImage"]}const Nt=()=>typeof window<"u"||"WorkerGlobalScope"in globalThis,Lt=e=>Nt()?import(e):new Function("url","return import(url);")(e);let te=null;function Ut(e,n){return te||(te=Lt(e).then(t=>t.default({locateFile:()=>n}))),te}const U=self;let ne=null;function L(e,n,t){U.postMessage({type:"status",label:e,id:n,detail:t})}L("boot"),U.onmessage=async e=>{const n=e.data;try{if(n.type==="init"){L("init-received",n.id),L("load-slang-start",n.id);const a=await Ut(n.scriptUrl,n.wasmUrl);L("load-slang-complete",n.id),ne=new Rt(a),L("compiler-created",n.id),U.postMessage({id:n.id,ok:!0});return}if(!ne)throw new Error("compile requested before worker init");const t=ne.compileImagePass(n.source,n.options);U.postMessage({id:n.id,ok:!0,result:t})}catch(t){U.postMessage({id:n.id,ok:!1,error:t instanceof Error?t.message:String(t)}),L("error",n.id,t instanceof Error?t.message:String(t))}}})();
