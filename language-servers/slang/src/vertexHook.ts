export interface SlangVertexHookFeature {
  readonly name: string;
  readonly kind: "function" | "parameter";
  readonly signature: string;
  readonly description: string;
}

/** Shader Studio's Slang vertex-hook contract, matching the renderer wrapper. */
export const SLANG_VERTEX_HOOK_FEATURES: readonly SlangVertexHookFeature[] = Object.freeze([
  Object.freeze({
    name: "mainVertex",
    kind: "function",
    signature: "void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv)",
    description: "Shader Studio vertex hook called before vertex transforms and varyings are calculated. Modify its parameters to deform geometry or adjust vertex data.",
  }),
  Object.freeze({
    name: "vertexIndex",
    kind: "parameter",
    signature: "uint vertexIndex",
    description: "Vertex index passed to the hook (`SV_VertexID`). Fullscreen geometry passes 0, 1 and 2; vertices geometry runs from 0 to iVertexCount - 1 (its configured `vertexCount`); mesh geometry passes the mesh vertex index.",
  }),
  Object.freeze({
    name: "position",
    kind: "parameter",
    signature: "inout float3 position",
    description: "Mutable vertex position. It is object-space for mesh geometry and vertices geometry in world space (the orbit camera transforms it), and the final clip-space position for fullscreen geometry and vertices geometry in clip space ((-1,-1) bottom-left to (1,1) top-right). Vertices geometry starts every vertex at (0,0,0).",
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
