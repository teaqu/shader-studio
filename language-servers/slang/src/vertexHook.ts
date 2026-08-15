export interface SlangVertexHookFeature {
  readonly name: "mainVertex" | "position" | "normal" | "uv";
  readonly kind: "function" | "parameter";
  readonly signature: string;
  readonly description: string;
}

/** Shader Studio's Slang vertex-hook contract, matching the renderer wrapper. */
export const SLANG_VERTEX_HOOK_FEATURES: readonly SlangVertexHookFeature[] = Object.freeze([
  Object.freeze({
    name: "mainVertex",
    kind: "function",
    signature: "void mainVertex(inout float3 position, inout float3 normal, inout float2 uv)",
    description: "Shader Studio vertex hook called before vertex transforms and varyings are calculated. Modify its parameters to deform geometry or adjust vertex data.",
  }),
  Object.freeze({
    name: "position",
    kind: "parameter",
    signature: "inout float3 position",
    description: "Mutable vertex position. It is object-space for mesh geometry and becomes the clip-space position for fullscreen geometry.",
  }),
  Object.freeze({
    name: "normal",
    kind: "parameter",
    signature: "inout float3 normal",
    description: "Mutable object-space vertex normal used to calculate the interpolated mesh normal.",
  }),
  Object.freeze({
    name: "uv",
    kind: "parameter",
    signature: "inout float2 uv",
    description: "Mutable vertex texture coordinate used to calculate fragment coordinates for mesh geometry.",
  }),
]);
