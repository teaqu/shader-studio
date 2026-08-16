export interface GlslVertexHookFeature {
  readonly name: string;
  readonly kind: "function" | "parameter";
  readonly signature: string;
  readonly description: string;
}

/** Shader Studio's GLSL vertex-hook contract, matching the renderer wrapper. */
export const GLSL_VERTEX_HOOK_FEATURES: readonly GlslVertexHookFeature[] = Object.freeze([
  Object.freeze({
    name: "mainVertex",
    kind: "function",
    signature: "void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv)",
    description: "Shader Studio vertex hook called before vertex transforms and varyings are calculated. Modify its parameters to deform geometry or adjust vertex data.",
  }),
  Object.freeze({
    name: "position",
    kind: "parameter",
    signature: "inout vec3 position",
    description: "Mutable vertex position. It is object-space for mesh geometry and becomes the clip-space position for fullscreen geometry.",
  }),
  Object.freeze({
    name: "normal",
    kind: "parameter",
    signature: "inout vec3 normal",
    description: "Mutable object-space vertex normal used to calculate the interpolated mesh normal.",
  }),
  Object.freeze({
    name: "uv",
    kind: "parameter",
    signature: "inout vec2 uv",
    description: "Mutable vertex texture coordinate used to calculate fragment coordinates for mesh geometry.",
  }),
]);
