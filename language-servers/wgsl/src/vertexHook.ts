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
    signature: "fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>)",
    description: "Shader Studio vertex hook called before vertex transforms and varyings are calculated. Modify its parameters to deform geometry or adjust vertex data.",
  }),
  Object.freeze({
    name: "vertexIndex",
    kind: "parameter",
    signature: "vertexIndex: u32",
    description: "Vertex index passed to the hook (`@builtin(vertex_index)`). Fullscreen geometry passes 0, 1 and 2; vertices geometry runs from 0 to iVertexCount - 1 (its configured `vertexCount`); mesh geometry passes the mesh vertex index.",
  }),
  Object.freeze({
    name: "position",
    kind: "parameter",
    signature: "position: ptr<function, vec3f>",
    description: "Mutable vertex position. It is object-space for mesh geometry and vertices geometry in world space (the orbit camera transforms it), and the final clip-space position for fullscreen geometry and vertices geometry in clip space ((-1,-1) bottom-left to (1,1) top-right). Vertices geometry starts every vertex at (0,0,0).",
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
    description: "Mutable vertex texture coordinate. Its perspective-correct interpolated value is available to mainImage as iVertexUv; mesh and world-space vertices also use it to calculate mainImage's coordinate.",
  }),
]);
