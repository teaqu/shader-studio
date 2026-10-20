import type { GeometryType } from "@shader-studio/types";
import { VR_CONTROLLER_FIELDS } from "@shader-studio/types";
import { stripComments } from "../util/ShaderText";

/** Generated helper the fullscreen Image fragment calls instead of mainImage. */
const WEBGPU_VR_IMAGE_FUNCTION = "_ss_vrImage";

/**
 * Slang and WGSL `mainVR` returns the colour, like their `mainImage`:
 * `mainVR(fragCoord, rayOrigin, rayDirection)`. Only a definition counts.
 */
export function hasWebGpuMainVr(code: string): boolean {
  return /\bmainVR\s*\([^)]*\)\s*(?:->[^{;]*)?\{/.test(stripComments(code));
}

export interface WebGpuVrEntryPass {
  passName?: string;
  passKind?: "render" | "compute";
  geometry?: GeometryType;
  outputKind?: "2d" | "cubemap";
  captureMode?: boolean;
  renderEntryPoints?: { vertex?: string; fragment?: string };
}

/** VR affects only the generated fullscreen Image fragment, as in GLSL. */
export function usesWebGpuVrEntry(pass: WebGpuVrEntryPass, code: string): boolean {
  return pass.passName === "Image"
    && pass.passKind !== "compute"
    && (pass.geometry === undefined || pass.geometry === "fullscreen")
    && pass.outputKind !== "cubemap"
    && pass.captureMode !== true
    && !pass.renderEntryPoints?.vertex
    && !pass.renderEntryPoints?.fragment
    && hasWebGpuMainVr(code);
}

/** The ShaderToy call a fullscreen fragment makes for `coord`. */
export function webGpuImageCall(vr: boolean, coord: string): string {
  return vr ? `${WEBGPU_VR_IMAGE_FUNCTION}(${coord})` : `mainImage(${coord})`;
}

/** WGSL has no preprocessor, so controller globals are emitted only when referenced. */
export function referencesWebGpuVrInputs(code: string): boolean {
  return /\biVR(?:Active|Controller(?:Position|Direction|Buttons|Axes|FaceButtons|Touches|FaceTouches))\b/.test(stripComments(code));
}

/** Uniform-struct members appended after the pointer, matching createShaderToyUniformLayout. */
export function wgslVrUniformFields(): string {
  return [
    "  vrState: vec4<i32>,",
    "  vrViewport: vec4<f32>,",
    "  vrRayTransform: mat4x4<f32>,",
    ...VR_CONTROLLER_FIELDS.map(({ field }) => `  ${field}: array<vec4<f32>, 2>,`),
  ].join("\n");
}

export function wgslVrGlobals(): { declarations: string[]; initialisers: string[] } {
  return {
    declarations: [
      "var<private> iVRActive: bool;",
      ...VR_CONTROLLER_FIELDS.map(({ name }) => `var<private> ${name}: array<vec4<f32>, 2>;`),
    ],
    initialisers: [
      "  iVRActive = _ss_u.vrState.z != 0;",
      ...VR_CONTROLLER_FIELDS.map(({ name, field }) => `  ${name} = _ss_u.${field};`),
    ],
  };
}

/**
 * Immersive eyes use the tracked ray transform; desktop preview builds a
 * 90 degree vertical field of view around iCameraPos/iCameraDir. Both
 * branches depend only on uniforms, so mainImage keeps uniform control flow.
 */
export const WGSL_VR_IMAGE_FUNCTION = `fn ${WEBGPU_VR_IMAGE_FUNCTION}(coord: vec2<f32>) -> vec4<f32> {
  if (_ss_u.vrState.y != 0) {
    let local = coord - _ss_u.vrViewport.xy;
    let ndc = 2.0 * local / _ss_u.resolution.xy - 1.0;
    let ray = normalize((_ss_u.vrRayTransform * vec4<f32>(ndc, 1.0, 0.0)).xyz);
    return mainVR(local, _ss_u.vrRayTransform[3].xyz, ray);
  }
  if (_ss_u.vrState.x == 0) {
    return mainImage(coord);
  }
  let screen = (2.0 * coord - _ss_u.resolution.xy) / max(_ss_u.resolution.y, 1.0);
  let cameraDir = _ss_u.cameraDir.xyz;
  var forward = vec3<f32>(0.0, 0.0, -1.0);
  if (length(cameraDir) > 0.0) {
    forward = normalize(cameraDir);
  }
  var referenceUp = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(forward.y) > 0.999) {
    referenceUp = vec3<f32>(0.0, 0.0, 1.0);
  }
  let right = normalize(cross(forward, referenceUp));
  let up = cross(right, forward);
  return mainVR(coord, _ss_u.cameraPos.xyz, normalize(forward + screen.x * right + screen.y * up));
}
`;

/** Slang indexes matrices by row, so the eye origin comes from the transform's w column via mul. */
export const SLANG_VR_IMAGE_FUNCTION = `float4 ${WEBGPU_VR_IMAGE_FUNCTION}(float2 coord)
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
`;
