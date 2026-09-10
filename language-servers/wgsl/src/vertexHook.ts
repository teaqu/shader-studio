export interface WgslVertexHookFeature {
  readonly name: string;
  readonly kind: "function" | "parameter";
  readonly signature: string;
  readonly description: string;
}

/** Shader Studio's WGSL vertex-hook contract, matching the renderer wrapper. */
export const WGSL_VERTEX_HOOK_FEATURES: readonly WgslVertexHookFeature[] = Object.freeze([
  Object.freeze({
    name: "mainVertex",
    kind: "function",
    signature: "fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>)",
    description: "Shader Studio vertex hook called before vertex transforms and varyings are calculated. Modify its parameters to deform geometry or adjust vertex data.",
  }),
  Object.freeze({
    name: "position",
    kind: "parameter",
    signature: "position: ptr<function, vec3f>",
    description: "Mutable vertex position. It is object-space for mesh geometry and becomes the clip-space position for fullscreen geometry.",
  }),
  Object.freeze({
    name: "normal",
    kind: "parameter",
    signature: "normal: ptr<function, vec3f>",
    description: "Mutable object-space vertex normal used to calculate the interpolated mesh normal.",
  }),
  Object.freeze({
    name: "uv",
    kind: "parameter",
    signature: "uv: ptr<function, vec2f>",
    description: "Mutable vertex texture coordinate used to calculate fragment coordinates for mesh geometry.",
  }),
]);
